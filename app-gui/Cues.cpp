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
} // namespace

Cues::Cues() { worker = std::thread([this] { run(); }); }

Cues::~Cues()
{
    *alive = false;
    { std::lock_guard<std::mutex> g(lock); quit = true; queue.clear(); }
    wake.notify_all();
    if (worker.joinable()) worker.join();
}

juce::File Cues::cacheFolder() { return Peaks::appCacheFolder().getParentDirectory().getChildFile("Cues"); }

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
            wake.wait(g, [this] { return quit || ! queue.empty(); });
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
    auto list = speech::listVoices(def);
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
    for (auto& v : installed) if (v.id == c.voice) return v.id;
    for (auto& v : installed) if (c.name.isNotEmpty() && v.name.equalsIgnoreCase(c.name)) return v.id;
    fellBack = true;
    return {};
}

juce::String Cues::keyOf(const juce::String& text, const juce::String& voiceId, double speed, double rate) const
{
    return text + "|" + voiceId + "|" + juce::String(speed, 2) + "|" + juce::String((int) rate);
}

Cues::Audio Cues::renderNow(const juce::String& text, const juce::String& voiceId, double speed, double rate, juce::String& error)
{
    const auto key = keyOf(text, voiceId, speed, rate);
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
    if (! speech::render(text, voiceId, speed, rate, raw, rawRate, error)) return nullptr;
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
        result->first = renderNow(text, id, c.speed, rate, result->second);
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
    auto it = memo.find(keyOf(text, id, c.speed, rate));
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
            if (! renderNow(text, resolve(c, fb), c.speed, rate, err)) errors[text] = err;
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
            Choice c { x["voice"].toString(), x["name"].toString(), x["speed"].isVoid() ? 1.0 : (double) x["speed"] };
            post([this, text, c, rate] {
                ensureVoices();
                bool fb = false;
                juce::String err;
                renderNow(text, resolve(c, fb), c.speed, rate, err);
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
        auto a = renderNow(text, resolve(c, fb), c.speed, rate, err);
        juce::MessageManager::callAsync([alive_, done, a, err] { if (*alive_) done(a, err); });
    }, true);
}

} // namespace setline::gui
