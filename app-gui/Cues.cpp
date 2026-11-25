#include "Cues.h"
#include "Peaks.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>
#include <cmath>
#include <cstring>
#include <future>
#include <set>

namespace setline::gui {

namespace {
constexpr char magic[4] = { 'S', 'L', 'C', 'U' };

// Resampled once, here, at render time (see Cues.h). Windowed-sinc, so the speech stays clean.
std::vector<float> resample(const std::vector<float>& in, double inRate, double outRate)
{
    if (std::abs(inRate - outRate) < 0.5 || in.empty()) return in;
    const double ratio = inRate / outRate;
    const auto n = (size_t) std::ceil((double) in.size() / ratio);
    std::vector<float> padded(in);
    padded.resize(in.size() + 256, 0.0f);
    std::vector<float> out(n, 0.0f);
    juce::WindowedSincInterpolator interp;
    interp.process(ratio, padded.data(), out.data(), (int) n);
    return out;
}

// Speech engines start with a little silence: trim it (keeping 2 ms) so the voice starts on the bar.
// Trailing silence goes too, and the last 5 ms fade out so a cut never clicks.
void trim(std::vector<float>& a, double rate)
{
    const float thr = 0.004f; // about -48 dBFS
    size_t first = 0, last = a.size();
    while (first < a.size() && std::fabs(a[first]) < thr) ++first;
    while (last > first && std::fabs(a[last - 1]) < thr) --last;
    if (first >= last) { a.clear(); return; }
    const auto keep = (size_t) (0.002 * rate);
    first = first > keep ? first - keep : 0;
    last = std::min(a.size(), last + (size_t) (0.02 * rate));
    std::vector<float> b(a.begin() + (std::ptrdiff_t) first, a.begin() + (std::ptrdiff_t) last);
    const auto fade = std::min(b.size(), (size_t) (0.005 * rate));
    for (size_t i = 0; i < fade; ++i) b[b.size() - 1 - i] *= (float) i / (float) fade;
    a.swap(b);
}
// The show's pronunciations that matter for this text, as "word=sounds like;..." (part of the cache key, so
// changing how a word sounds re-renders only the cues that use it).
juce::String pronKey(const juce::String& text, const kokoro::Pronunciations& pron)
{
    if (pron.empty()) return {};
    juce::StringArray words;
    words.addTokens(text.toLowerCase(), " ,.!?;:/&", "\"");
    juce::String k;
    for (auto& [w, v] : pron) if (words.contains(w) || text.toLowerCase().contains(w + "-") || text.toLowerCase().contains("-" + w)) k << w << "=" << v << ";";
    return k;
}

// The computer's voices can't take phonemes, but they can take a respelling: "Djentworth" -> "jent worth".
juce::String respell(const juce::String& text, const kokoro::Pronunciations& pron)
{
    if (pron.empty()) return text;
    juce::String out, word;
    auto flush = [&] {
        if (word.isEmpty()) return;
        auto it = pron.find(word.toLowerCase());
        const bool phon = it != pron.end() && it->second.trim().startsWith("/");
        out << (it != pron.end() && ! phon ? it->second : word);
        word.clear();
    };
    for (auto c : text) { if (juce::CharacterFunctions::isLetterOrDigit(c) || c == '\'') word += c; else { flush(); out += c; } }
    flush();
    return out;
}
} // namespace

Cues::Choice Cues::choiceFrom(const juce::var& v)
{
    Choice c { v["voice"].toString(), v["name"].toString(), v["speed"].isVoid() ? 1.0 : (double) v["speed"], {}, v["recPath"].toString() };
    if (auto* o = v["pron"].getDynamicObject())
        for (auto& p : o->getProperties())
            if (auto w = p.name.toString().trim().toLowerCase(); w.isNotEmpty() && p.value.toString().trim().isNotEmpty()) c.pron[w] = p.value.toString().trim();
    return c;
}

Cues::Cues() { worker = std::thread([this] { run(); }); }

Cues::~Cues()
{
    *alive = false;
    { std::lock_guard<std::mutex> g(lock); quit = true; queue.clear(); }
    wake.notify_all();
    if (worker.joinable()) worker.join();
}

juce::File Cues::cacheOverride;
juce::File Cues::cacheFolder()
{
    if (cacheOverride != juce::File()) return cacheOverride;
    const auto env = juce::SystemStats::getEnvironmentVariable("SETLINE_CUE_CACHE", {}); // tests: "another computer"
    if (env.isNotEmpty()) return juce::File(env);
    return Peaks::appCacheFolder().getParentDirectory().getChildFile("Cues");
}

void Cues::post(std::function<void()> fn, bool urgent)
{
    { std::lock_guard<std::mutex> g(lock); if (urgent) queue.push_front(std::move(fn)); else queue.push_back(std::move(fn)); }
    wake.notify_one();
}

void Cues::run()
{
    for (;;) {
        std::function<void()> fn;
        {
            std::unique_lock<std::mutex> g(lock);
            if (! wake.wait_for(g, std::chrono::seconds(60), [this] { return quit || ! queue.empty(); })) {
                g.unlock();
                kokoro::unload(); // a minute idle: give the model's memory back (it reloads in about a second)
                continue;
            }
            if (quit) return;
            fn = std::move(queue.front());
            queue.pop_front();
        }
        fn();
    }
}

void Cues::ensureVoices()
{
    { std::lock_guard<std::mutex> g(dataLock); if (listed) return; }
    juce::String def;
    auto list = kokoro::voices();
    for (auto& v : speech::listVoices(def)) list.push_back(v);
    std::lock_guard<std::mutex> g(dataLock);
    installed = std::move(list);
    defaultId = def;
    listed = true;
}

juce::var Cues::voices()
{
    bool have;
    { std::lock_guard<std::mutex> g(dataLock); have = listed; }
    if (! have) {
        auto p = std::make_shared<std::promise<void>>();
        auto f = p->get_future();
        post([this, p] { ensureVoices(); p->set_value(); }, true);
        if (f.wait_for(std::chrono::seconds(20)) != std::future_status::ready) return juce::Array<juce::var>();
    }
    std::lock_guard<std::mutex> g(dataLock);
    juce::Array<juce::var> a;
    for (auto& v : installed) {
        auto* o = new juce::DynamicObject();
        o->setProperty("id", v.id);
        o->setProperty("name", v.name);
        o->setProperty("lang", v.lang);
        o->setProperty("quality", v.quality);
        o->setProperty("engine", v.engine);
        if (v.engine == "kokoro") { o->setProperty("gender", v.gender); o->setProperty("grade", v.grade); o->setProperty("rank", v.rank); }
        o->setProperty("isDefault", v.id == defaultId);
        a.add(juce::var(o));
    }
    return a;
}

void Cues::voicesAsync(std::function<void(juce::var)> done)
{
    auto alive_ = alive;
    post([this, done, alive_] {
        ensureVoices();
        juce::MessageManager::callAsync([this, done, alive_] { if (*alive_) done(voices()); }); // listed: voices() returns at once
    }, true);
}

juce::String Cues::resolve(const Choice& c, bool& fellBack)
{
    std::lock_guard<std::mutex> g(dataLock);
    return resolveLocked(c, fellBack);
}

juce::String Cues::resolveLocked(const Choice& c, bool& fellBack) const
{
    fellBack = false;
    if (c.voice.isEmpty() && c.name.isEmpty()) return {};
    juce::String id;
    for (auto& v : installed) if (v.id == c.voice) { id = v.id; break; }
    if (id.isEmpty() && ! kokoro::isKokoro(c.voice)) // ids differ between computers; Kokoro's never do
        for (auto& v : installed) if (c.name.isNotEmpty() && v.engine == "system" && v.name.equalsIgnoreCase(c.name)) { id = v.id; break; }
    if (id.isNotEmpty() && kokoro::isKokoro(id) && kokoro::status().state != kokoro::State::ready)
        id = {}; // not downloaded (yet): the computer's default voice stands in
    fellBack = id.isEmpty();
    return id;
}

juce::String Cues::fallbackReason(const Choice& c)
{
    if (c.recording.isNotEmpty()) return {};
    bool fb = false;
    resolve(c, fb);
    if (! fb) return {};
    if (kokoro::find(c.voice) != nullptr) return "notDownloaded";
    return "missing";
}

void Cues::checkWords(juce::StringArray texts, Choice c, std::function<void(juce::StringArray, juce::String)> done)
{
    auto alive_ = alive;
    post([texts, c, done, alive_] {
        juce::StringArray unknown;
        juce::String ph;
        const auto* v = kokoro::find(c.voice);
        if (kokoro::status().state == kokoro::State::ready)
            for (auto& t : texts) ph << kokoro::phonemes(t, v != nullptr && juce::String(v->lang) == "en-GB", c.pron, &unknown) << "\n";
        juce::MessageManager::callAsync([alive_, done, unknown, ph] { if (*alive_) done(unknown, ph.trimEnd()); });
    }, true);
}

juce::String Cues::keyOf(const juce::String& text, const juce::String& voiceId, const Choice& c, double rate) const
{
    if (c.recording.isNotEmpty()) { // the file itself (a new recording under the same name is a new key)
        const juce::File f(c.recording);
        return "rec|" + f.getFullPathName() + "|" + juce::String(f.getSize()) + "|" + juce::String(f.getLastModificationTime().toMilliseconds()) + "|" + juce::String((int) rate);
    }
    // Kokoro renders carry the model's name, so a future model never reuses them.
    return text + "|" + voiceId + "|" + juce::String(c.speed, 2) + "|" + juce::String((int) rate)
         + (kokoro::isKokoro(voiceId) ? "|kokoro-v1.0" : "") + (pronKey(text, c.pron).isNotEmpty() ? "|" + pronKey(text, c.pron) : juce::String());
}

// A recorded cue word: WAV / AIFF / FLAC at any rate, mono or stereo (mixed to mono). Worker thread.
bool Cues::readRecording(const juce::File& f, std::vector<float>& out, double& rate, juce::String& error)
{
    static juce::AudioFormatManager fm;
    static const bool registered = [] { fm.registerBasicFormats(); return true; }();
    (void) registered;
    std::unique_ptr<juce::AudioFormatReader> r(f.existsAsFile() ? fm.createReaderFor(f) : nullptr);
    if (r == nullptr) { error = "The recording " + f.getFileName() + (f.existsAsFile() ? " can't be read." : " is missing."); return false; }
    const auto n = (int) std::min<juce::int64>(r->lengthInSamples, (juce::int64) (r->sampleRate * 30)); // a cue word, not a song
    if (n <= 0) { error = "The recording " + f.getFileName() + " is empty."; return false; }
    juce::AudioBuffer<float> b((int) r->numChannels, n);
    r->read(&b, 0, n, 0, true, true);
    out.assign((size_t) n, 0.0f);
    const float k = 1.0f / (float) b.getNumChannels();
    for (int ch = 0; ch < b.getNumChannels(); ++ch)
        for (int i = 0; i < n; ++i) out[(size_t) i] += b.getSample(ch, i) * k;
    rate = r->sampleRate;
    return true;
}

// ---- cues stored in the show (part 3) ----
// The cue as the show asked for it: the saved voice id (or name), not what's installed here; a recording by its
// file name and size (the show's copy moves with the show). base: the same without the rate.
juce::String Cues::storeKeyOf(const juce::String& text, const Choice& c, double rate, juce::String* base) const
{
    juce::String b;
    if (c.recording.isNotEmpty()) {
        const juce::File f(c.recording);
        b = "rec|" + f.getFileName() + "|" + juce::String(f.getSize());
    } else {
        const auto v = c.voice.isNotEmpty() ? c.voice : c.name.isNotEmpty() ? "name:" + c.name : juce::String("default");
        const auto pk = pronKey(text, c.pron);
        b = "say|" + text + "|" + v + "|" + juce::String(c.speed, 2) + (kokoro::isKokoro(v) ? "|kokoro-v1.0" : "") + (pk.isNotEmpty() ? "|" + pk : juce::String());
    }
    if (base != nullptr) *base = b;
    return b + "|" + juce::String((int) rate);
}

void Cues::setShowFolder(const juce::File& folder)
{
    {
        std::lock_guard<std::mutex> g(dataLock);
        if (folder == showDir) return;
    }
    // Another show: the cues it stored win over anything this computer made earlier with the same key (the
    // start-up show, another show), so they sound exactly as they did where the show was made.
    juce::StringArray stored;
    if (folder != juce::File()) {
        const auto m = juce::JSON::parse(folder.getChildFile("Cues").getChildFile("cues.json")); // (kept alive while read)
        if (auto* l = m["cues"].getArray()) for (auto& e : *l) stored.add(e["key"].toString());
    }
    std::lock_guard<std::mutex> g(dataLock);
    ++showGen;
    showDir = folder;
    for (auto& k : stored) memo.erase(k);
}

void Cues::mergeStore(const juce::File& from, std::function<void()> done)
{
    auto alive_ = alive;
    post([this, from, done, alive_] {
        struct Done { std::function<void()> fn; std::shared_ptr<bool> a; ~Done() { if (fn) { auto f = fn; auto al = a; juce::MessageManager::callAsync([f, al] { if (*al) f(); }); } } } fin { done, alive_ };
        juce::File dir;
        { std::lock_guard<std::mutex> g(dataLock); if (showDir != juce::File()) dir = showDir.getChildFile("Cues"); }
        if (dir == juce::File() || ! dir.createDirectory()) return;
        const auto src = juce::JSON::parse(from.getChildFile("cues.json"));
        auto* list = manifest(dir)["cues"].getArray();
        if (list == nullptr) return;
        int added = 0;
        if (auto* sl = src["cues"].getArray())
            for (auto& e : *sl) {
                const auto key = e["key"].toString(), file = e["file"].toString();
                if (key.isEmpty() || file.isEmpty() || file.contains("..")) continue;
                bool have = false;
                for (auto& x : *list) if (x["key"].toString() == key) { have = true; break; }
                if (have) continue;
                const auto f = from.getChildFile(file), dst = dir.getChildFile(file);
                if (! f.existsAsFile() || (! dst.existsAsFile() && ! f.copyFileTo(dst))) continue;
                list->add(e); ++added;
                std::lock_guard<std::mutex> g(dataLock); memo.erase(key);
            }
        if (added) writeManifest(dir);
    }, true);
}

juce::var& Cues::manifest(const juce::File& dir)
{
    if (manifestDir != dir) {
        manifestDir = dir;
        manifestData = juce::JSON::parse(dir.getChildFile("cues.json"));
        if (! manifestData.isObject() || ! manifestData["cues"].isArray()) {
            auto* o = new juce::DynamicObject();
            o->setProperty("version", 1);
            o->setProperty("about", "set.Line: the show's spoken cues, rendered once. Each entry is one WAV in this folder (mono, 32-bit float, at the show rate).");
            o->setProperty("cues", juce::Array<juce::var>());
            manifestData = juce::var(o);
        }
    }
    return manifestData;
}

void Cues::writeManifest(const juce::File& dir)
{
    const auto f = dir.getChildFile("cues.json");
    juce::TemporaryFile tmp(f);
    if (tmp.getFile().replaceWithText(juce::JSON::toString(manifestData, false), false, false, "\n")) tmp.overwriteTargetFileWithTemporary();
}

Cues::Audio Cues::loadStored(const juce::File& dir, const juce::String& key, const juce::String& base, double rate)
{
    if (! dir.isDirectory()) return nullptr;
    auto* list = manifest(dir)["cues"].getArray();
    if (list == nullptr) return nullptr;
    const juce::var* exact = nullptr, *other = nullptr;
    for (auto& e : *list) { if (e["key"].toString() == key) { exact = &e; break; } if (e["base"].toString() == base && other == nullptr) other = &e; }
    const auto* e = exact != nullptr ? exact : other;
    if (e == nullptr) return nullptr;
    static juce::AudioFormatManager fm;
    static const bool registered = [] { fm.registerBasicFormats(); return true; }();
    (void) registered;
    std::unique_ptr<juce::AudioFormatReader> r(fm.createReaderFor(dir.getChildFile((*e)["file"].toString())));
    if (r == nullptr || r->lengthInSamples <= 0 || r->lengthInSamples > (juce::int64) r->sampleRate * 60) return nullptr;
    juce::AudioBuffer<float> b(1, (int) r->lengthInSamples);
    r->read(&b, 0, (int) r->lengthInSamples, 0, true, false);
    std::vector<float> v(b.getReadPointer(0), b.getReadPointer(0) + b.getNumSamples());
    if (exact == nullptr) { // stored at another rate (the show runs at a new rate): resampled once, and stored too
        auto a = std::make_shared<std::vector<float>>(resample(v, r->sampleRate, rate));
        Choice c; // metadata copied from the other entry
        c.voice = (*e)["voice"].toString(); c.name = (*e)["name"].toString(); c.speed = (double) (*e)["speed"];
        saveStored(dir, key, base, a, rate, (*e)["text"].toString(), c, (*e)["source"].toString() == "recording" ? juce::String() : c.voice);
        return a;
    }
    return std::make_shared<std::vector<float>>(std::move(v));
}

void Cues::saveStored(const juce::File& dir, const juce::String& key, const juce::String& base, const Audio& a, double rate,
                      const juce::String& text, const Choice& c, const juce::String& voiceId)
{
    if (! dir.createDirectory()) return;
    const auto name = juce::String::toHexString(key.hashCode64()) + ".wav";
    const auto f = dir.getChildFile(name);
    {
        juce::TemporaryFile tmp(f);
        bool ok = false;
        {
            std::unique_ptr<juce::OutputStream> os = std::make_unique<juce::FileOutputStream>(tmp.getFile());
            juce::WavAudioFormat wav;
            const auto opts = juce::AudioFormatWriterOptions {}.withSampleRate(rate).withNumChannels(1).withBitsPerSample(32)
                                  .withSampleFormat(juce::AudioFormatWriterOptions::SampleFormat::floatingPoint);
            if (auto w = wav.createWriterFor(os, opts)) { const float* ch[] = { a->data() }; ok = w->writeFromFloatArrays(ch, 1, (int) a->size()); }
        }
        if (! ok || ! tmp.overwriteTargetFileWithTemporary()) return;
    }
    auto& m = manifest(dir);
    auto* list = m["cues"].getArray();
    for (int i = list->size(); --i >= 0;) if ((*list)[i]["key"].toString() == key) list->remove(i);
    auto* o = new juce::DynamicObject();
    o->setProperty("key", key); o->setProperty("base", base); o->setProperty("file", name);
    o->setProperty("text", text); o->setProperty("rate", rate); o->setProperty("samples", (int) a->size());
    if (c.recording.isNotEmpty()) { o->setProperty("source", "recording"); o->setProperty("recording", juce::File(c.recording).getFileName()); }
    else {
        o->setProperty("source", kokoro::isKokoro(voiceId) ? "kokoro" : "system");
        o->setProperty("voice", c.voice); o->setProperty("name", c.name); o->setProperty("speed", c.speed);
        if (kokoro::isKokoro(voiceId)) o->setProperty("model", "Kokoro-82M v1.0");
    }
    o->setProperty("rendered", juce::Time::getCurrentTime().toISO8601(true));
    list->add(juce::var(o));
    writeManifest(dir);
}

Cues::Audio Cues::renderNow(const juce::String& text, const juce::String& voiceId, const Choice& c, double rate, juce::String& error, bool fellBack)
{
    juce::String base;
    const auto skey = storeKeyOf(text, c, rate, &base);
    juce::File dir;
    Audio known;
    const int gen = showGen.load(); // the show this render is for
    {
        std::lock_guard<std::mutex> g(dataLock);
        if (showDir != juce::File()) dir = showDir.getChildFile("Cues");
        if (auto it = memo.find(skey); it != memo.end()) { lastFrom = "memory"; known = it->second; }
    }
    if (known) { // rendered before the show had a folder (or for another show): make sure this show has it too
        if (dir != juce::File()) {
            bool there = false;
            if (auto* l = manifest(dir)["cues"].getArray()) for (auto& e : *l) if (e["key"].toString() == skey) { there = true; break; }
            if (! there) saveStored(dir, skey, base, known, rate, text, c, voiceId);
        }
        return known;
    }
    // 1. the show's own copy: exactly what was rendered where the show was made
    if (dir != juce::File())
        if (auto a = loadStored(dir, skey, base, rate)) { std::lock_guard<std::mutex> g(dataLock); lastFrom = "show"; return memo[skey] = a; }
    // 2. this computer: memo / cache / render with the voice that's here
    auto a = renderRaw(text, voiceId, c, rate, error);
    if (a && ! fellBack) { // the real voice (or the recording): keep it, and store it in the show
        if (dir != juce::File()) saveStored(dir, skey, base, a, rate, text, c, voiceId);
        std::lock_guard<std::mutex> g(dataLock);
        // another show opened while this rendered (e.g. the start-up show's cues on a slow computer): don't let
        // this computer's voice stand in for that show's own stored cue
        if (gen == showGen.load()) memo[skey] = a;
    }
    return a;
}

Cues::Audio Cues::renderRaw(const juce::String& text, const juce::String& voiceId, const Choice& c, double rate, juce::String& error)
{
    const auto key = keyOf(text, voiceId, c, rate);
    { std::lock_guard<std::mutex> g(dataLock); if (auto it = memo.find(key); it != memo.end()) { lastFrom = "memory"; return it->second; } }

    const auto file = cacheFolder().getChildFile(juce::String::toHexString(key.hashCode64()) + ".cue");
    {   // disk cache: magic, key, rate, count, samples
        juce::FileInputStream in(file);
        char m[4] = {};
        if (in.openedOk() && in.read(m, 4) == 4 && std::memcmp(m, magic, 4) == 0 && in.readString() == key && in.readDouble() == rate) {
            const int n = in.readInt();
            if (n > 0 && n < 48000 * 60) {
                auto a = std::make_shared<std::vector<float>>((size_t) n);
                if (in.read(a->data(), n * (int) sizeof(float)) == n * (int) sizeof(float)) {
                    std::lock_guard<std::mutex> g(dataLock);
                    lastFrom = "cache";
                    return memo[key] = a;
                }
            }
        }
    }

    std::vector<float> raw;
    double rawRate = 0;
    if (c.recording.isNotEmpty()) { if (! readRecording(juce::File(c.recording), raw, rawRate, error)) return nullptr; }
    else if (kokoro::isKokoro(voiceId) ? ! kokoro::render(text, voiceId, c.speed, c.pron, raw, rawRate, error)
                                       : ! speech::render(respell(text, c.pron), voiceId, c.speed, rate, raw, rawRate, error))
        return nullptr;
    auto a = std::make_shared<std::vector<float>>(resample(raw, rawRate, rate));
    trim(*a, rate);
    if (a->empty()) { error = "The voice produced only silence."; return nullptr; }

    if (cacheFolder().createDirectory()) {
        const auto tmp = file.getSiblingFile(file.getFileName() + ".part");
        bool ok = false;
        {
            juce::FileOutputStream out(tmp);
            if (out.openedOk() && out.setPosition(0) && out.truncate().wasOk()) {
                out.write(magic, 4); out.writeString(key); out.writeDouble(rate); out.writeInt((int) a->size());
                out.write(a->data(), a->size() * sizeof(float));
                out.flush();
                ok = out.getStatus().wasOk();
            }
        }
        if (! ok || ! tmp.moveFileTo(file)) tmp.deleteFile();
    }
    std::lock_guard<std::mutex> g(dataLock);
    lastFrom = "render";
    return memo[key] = a;
}

void Cues::storeShow(const juce::var& list, double rate, std::function<void(int, int)> done)
{
    std::vector<std::pair<juce::String, Choice>> items;
    if (auto* a = list.getArray()) for (auto& x : *a) if (auto t = x["text"].toString().trim(); t.isNotEmpty()) items.push_back({ t, choiceFrom(x) });
    auto alive_ = alive;
    post([this, items, rate, done, alive_] {
        ensureVoices();
        juce::File dir;
        { std::lock_guard<std::mutex> g(dataLock); if (showDir != juce::File()) dir = showDir.getChildFile("Cues"); }
        int stored = 0, removed = 0;
        if (dir != juce::File()) {
            std::set<juce::String> keep;
            for (auto& [text, c] : items) {
                bool fb = false;
                juce::String err;
                const auto id = c.recording.isNotEmpty() ? juce::String() : resolve(c, fb);
                renderNow(text, id, c, rate, err, fb);
                { std::lock_guard<std::mutex> g(dataLock); if (memo.count(storeKeyOf(text, c, rate))) ++stored; } // from the show, or rendered with the real voice
                keep.insert(storeKeyOf(text, c, rate));
                for (double r : { 44100.0, 48000.0, 88200.0, 96000.0 }) keep.insert(storeKeyOf(text, c, r)); // the same cue at other rates stays
            }
            auto& m = manifest(dir);
            if (auto* l = m["cues"].getArray()) {
                for (int i = l->size(); --i >= 0;)
                    if (keep.count((*l)[i]["key"].toString()) == 0) { dir.getChildFile((*l)[i]["file"].toString()).deleteFile(); l->remove(i); ++removed; }
                writeManifest(dir);
            }
        }
        juce::MessageManager::callAsync([alive_, done, stored, removed] { if (*alive_ && done) done(stored, removed); });
    }, false);
}

Cues::Audio Cues::get(const juce::String& text, const Choice& c, double rate, juce::String& error, bool& fellBack)
{
    auto result = std::make_shared<std::pair<Audio, juce::String>>();
    auto fb = std::make_shared<bool>(false);
    auto p = std::make_shared<std::promise<void>>();
    auto f = p->get_future();
    post([this, text, c, rate, result, fb, p] {
        ensureVoices();
        const auto id = c.recording.isNotEmpty() ? juce::String() : resolve(c, *fb);
        if (c.recording.isNotEmpty()) *fb = false;
        result->first = renderNow(text, id, c, rate, result->second, *fb);
        p->set_value();
    }, true);
    if (f.wait_for(std::chrono::seconds(20)) != std::future_status::ready) { error = "Speech took too long."; return nullptr; }
    fellBack = *fb;
    error = result->second;
    return result->first;
}

Cues::Audio Cues::cached(const juce::String& text, const Choice& c, double rate, bool& fellBack)
{
    std::lock_guard<std::mutex> g(dataLock);
    fellBack = false;
    if (! listed) return nullptr;
    if (auto it = memo.find(storeKeyOf(text, c, rate)); it != memo.end()) return it->second; // the show's cue, or the real voice's
    const auto id = c.recording.isNotEmpty() ? juce::String() : resolveLocked(c, fellBack);
    if (c.recording.isNotEmpty()) fellBack = false;
    auto it = memo.find(keyOf(text, id, c, rate));
    return it != memo.end() ? it->second : nullptr;
}

void Cues::ensure(std::vector<std::pair<juce::String, Choice>> list, double rate, std::function<void(std::map<juce::String, juce::String>)> done)
{
    auto alive_ = alive;
    post([this, list = std::move(list), rate, done, alive_] {
        ensureVoices();
        std::map<juce::String, juce::String> errors;
        for (auto& [text, c] : list) {
            bool fb = false;
            juce::String err;
            const auto id = c.recording.isNotEmpty() ? juce::String() : resolve(c, fb);
            if (! renderNow(text, id, c, rate, err, fb && c.recording.isEmpty())) errors[text] = err;
        }
        juce::MessageManager::callAsync([alive_, done, errors] { if (*alive_) done(errors); });
    }, true);
}

void Cues::prepare(const juce::var& list, double rate)
{
    if (auto* a = list.getArray())
        for (auto& x : *a) {
            const auto text = x["text"].toString().trim();
            if (text.isEmpty()) continue;
            const auto c = choiceFrom(x);
            const int gen = showGen.load();
            post([this, text, c, rate, gen] {
                if (gen != showGen.load()) return; // another show is open now: the page prepares its cues
                ensureVoices();
                bool fb = false;
                juce::String err;
                const auto id = c.recording.isNotEmpty() ? juce::String() : resolve(c, fb);
                renderNow(text, id, c, rate, err, fb && c.recording.isEmpty());
            }, false);
        }
}

void Cues::render(const juce::String& text, const Choice& c, double rate, std::function<void(Audio, juce::String)> done)
{
    auto alive_ = alive;
    post([this, text, c, rate, done, alive_] {
        ensureVoices();
        bool fb = false;
        juce::String err;
        const auto id = c.recording.isNotEmpty() ? juce::String() : resolve(c, fb);
        auto a = renderNow(text, id, c, rate, err, fb && c.recording.isEmpty());
        juce::MessageManager::callAsync([alive_, done, a, err] { if (*alive_) done(a, err); });
    }, true);
}

} // namespace setline::gui
