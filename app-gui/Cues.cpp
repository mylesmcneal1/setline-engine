#include "Cues.h"
#include "Peaks.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_events/juce_events.h>
#include <cmath>
#include <cstring>
#include <future>

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
    Choice c { v["voice"].toString(), v["name"].toString(), v["speed"].isVoid() ? 1.0 : (double) v["speed"], {} };
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
juce::File Cues::cacheFolder() { return cacheOverride != juce::File() ? cacheOverride : Peaks::appCacheFolder().getParentDirectory().getChildFile("Cues"); }

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
    // Kokoro renders carry the model's name, so a future model never reuses them.
    return text + "|" + voiceId + "|" + juce::String(c.speed, 2) + "|" + juce::String((int) rate)
         + (kokoro::isKokoro(voiceId) ? "|kokoro-v1.0" : "") + (pronKey(text, c.pron).isNotEmpty() ? "|" + pronKey(text, c.pron) : juce::String());
}

Cues::Audio Cues::renderNow(const juce::String& text, const juce::String& voiceId, const Choice& c, double rate, juce::String& error)
{
    const auto key = keyOf(text, voiceId, c, rate);
    { std::lock_guard<std::mutex> g(dataLock); if (auto it = memo.find(key); it != memo.end()) return it->second; }

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
                    return memo[key] = a;
                }
            }
        }
    }

    std::vector<float> raw;
    double rawRate = 0;
    if (kokoro::isKokoro(voiceId) ? ! kokoro::render(text, voiceId, c.speed, c.pron, raw, rawRate, error)
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
    return memo[key] = a;
}

Cues::Audio Cues::get(const juce::String& text, const Choice& c, double rate, juce::String& error, bool& fellBack)
{
    auto result = std::make_shared<std::pair<Audio, juce::String>>();
    auto fb = std::make_shared<bool>(false);
    auto p = std::make_shared<std::promise<void>>();
    auto f = p->get_future();
    post([this, text, c, rate, result, fb, p] {
        ensureVoices();
        const auto id = resolve(c, *fb);
        result->first = renderNow(text, id, c, rate, result->second);
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
    const auto id = resolveLocked(c, fellBack);
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
            if (! renderNow(text, resolve(c, fb), c, rate, err)) errors[text] = err;
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
            post([this, text, c, rate] {
                ensureVoices();
                bool fb = false;
                juce::String err;
                renderNow(text, resolve(c, fb), c, rate, err);
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
        auto a = renderNow(text, resolve(c, fb), c, rate, err);
        juce::MessageManager::callAsync([alive_, done, a, err] { if (*alive_) done(a, err); });
    }, true);
}

} // namespace setline::gui
