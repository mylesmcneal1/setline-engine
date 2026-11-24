#include "Peaks.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace setline::gui {

namespace {
constexpr char magic[4] = { 'S', 'L', 'P', 'K' };
constexpr int version = 1;

} // namespace

juce::File Peaks::appCacheFolder()
{
   #if JUCE_MAC
    return juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Library/Caches/set.Line/Peaks");
   #elif JUCE_WINDOWS
    return juce::File::getSpecialLocation(juce::File::windowsLocalAppData).getChildFile("set.Line/Cache/Peaks");
   #else
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("set.Line/Peaks");
   #endif
}

juce::File Peaks::cacheFileFor(const juce::File& audio, const juce::File& sessionFile)
{
    if (sessionFile != juce::File()) {
        const auto folder = sessionFile.getParentDirectory(), audioDir = folder.getChildFile("Audio");
        if (audio.isAChildOf(audioDir))
            return folder.getChildFile("Cache/Peaks").getChildFile(audio.getRelativePathFrom(audioDir) + ".peaks");
    }
    const auto key = audio.getFullPathName() + "|" + juce::String(audio.getSize()) + "|" + juce::String(audio.getLastModificationTime().toMilliseconds());
    return appCacheFolder().getChildFile(audio.getFileNameWithoutExtension().retainCharacters("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_").substring(0, 40)
                                         + "-" + juce::String::toHexString(key.hashCode64()) + ".peaks");
}

namespace {

std::shared_ptr<Peaks::Data> readCache(const juce::File& f, const juce::File& audio)
{
    juce::FileInputStream in(f);
    if (! in.openedOk()) return nullptr;
    char m[4] = {};
    if (in.read(m, 4) != 4 || std::memcmp(m, magic, 4) != 0 || in.readInt() != version) return nullptr;
    if (in.readInt64() != audio.getSize() || in.readInt64() != audio.getLastModificationTime().toMilliseconds()) return nullptr;
    auto d = std::make_shared<Peaks::Data>();
    d->rate = in.readDouble();
    d->frames = in.readInt64();
    d->channels = in.readInt();
    if (in.readInt() != Peaks::numLevels) return nullptr;
    for (int i = 0; i < Peaks::numLevels; ++i) {
        const int spp = in.readInt(), count = in.readInt();
        if (spp != Peaks::levels[i] || count < 0 || count != (int) ((d->frames + spp - 1) / spp)) return nullptr;
        d->level[i].setSize((size_t) count);
        if (in.read(d->level[i].getData(), count) != count) return nullptr;
    }
    return d;
}

bool writeCache(const juce::File& f, const juce::File& audio, const Peaks::Data& d)
{
    if (! f.getParentDirectory().createDirectory()) return false;
    const auto tmp = f.getSiblingFile(f.getFileName() + ".part");
    bool ok = false;
    {
        juce::FileOutputStream out(tmp);
        if (! out.openedOk() || ! out.setPosition(0) || ! out.truncate().wasOk()) return false;
        out.write(magic, 4);
        out.writeInt(version);
        out.writeInt64(audio.getSize());
        out.writeInt64(audio.getLastModificationTime().toMilliseconds());
        out.writeDouble(d.rate);
        out.writeInt64(d.frames);
        out.writeInt(d.channels);
        out.writeInt(Peaks::numLevels);
        for (int i = 0; i < Peaks::numLevels; ++i) {
            out.writeInt(Peaks::levels[i]);
            out.writeInt((int) d.level[i].getSize());
            out.write(d.level[i].getData(), d.level[i].getSize());
        }
        out.flush();
        ok = out.getStatus().wasOk();
    }
    if (! ok || ! tmp.moveFileTo(f)) { tmp.deleteFile(); return false; }
    return true;
}

juce::uint8 toByte(float v) { return (juce::uint8) juce::roundToInt(std::sqrt(juce::jlimit(0.0f, 1.0f, v)) * 255.0f); }
} // namespace

Peaks::Peaks()
{
    for (int i = 0; i < 2; ++i) threads.emplace_back([this] { run(); });
}

Peaks::~Peaks()
{
    *alive = false;
    { std::lock_guard<std::mutex> g(lock); quit = true; queue.clear(); }
    wake.notify_all();
    for (auto& t : threads) t.join();
}


std::shared_ptr<Peaks::Data> Peaks::compute(const juce::File& audio, juce::AudioFormatManager& fm, juce::String& error)
{
    std::unique_ptr<juce::AudioFormatReader> r(fm.createReaderFor(audio));
    if (r == nullptr) { error = audio.existsAsFile() ? "Can't read " + audio.getFileName() : "File not found"; return nullptr; }
    auto d = std::make_shared<Data>();
    d->rate = r->sampleRate;
    d->frames = r->lengthInSamples;
    d->channels = (int) r->numChannels;
    const int base = levels[0];
    const auto count = (size_t) ((d->frames + base - 1) / base);
    std::vector<float> peak(count, 0.0f);
    const int ch = juce::jmax(1, juce::jmin(2, (int) r->numChannels));
    const int block = base * 256;
    juce::AudioBuffer<float> buf(ch, block);
    for (juce::int64 pos = 0; pos < d->frames; pos += block) {
        const int n = (int) juce::jmin<juce::int64>(block, d->frames - pos);
        buf.clear();
        if (! r->read(&buf, 0, n, pos, true, ch > 1)) { error = "Can't read " + audio.getFileName(); return nullptr; }
        for (int c = 0; c < ch; ++c) {
            const float* x = buf.getReadPointer(c);
            for (int i = 0; i < n; ++i) {
                auto& p = peak[(size_t) ((pos + i) / base)];
                const float a = std::abs(x[i]);
                if (a > p) p = a;
            }
        }
    }
    for (int l = 0; l < numLevels; ++l) {
        const int k = levels[l] / base;
        const auto n = (size_t) ((d->frames + levels[l] - 1) / levels[l]);
        d->level[l].setSize(n);
        auto* out = static_cast<juce::uint8*>(d->level[l].getData());
        for (size_t i = 0; i < n; ++i) {
            float m = 0;
            for (size_t j = i * (size_t) k; j < juce::jmin(count, (i + 1) * (size_t) k); ++j) m = juce::jmax(m, peak[j]);
            out[i] = toByte(m);
        }
    }
    return d;
}

std::shared_ptr<const Peaks::Data> Peaks::load(const juce::File& audio, const juce::File& cache, juce::AudioFormatManager& fm,
                                               juce::String& error, bool* fromCache)
{
    if (fromCache) *fromCache = false;
    if (! audio.existsAsFile()) { error = "File not found"; return nullptr; }
    // A show folder that can't be written (e.g. read-only media) keeps its cache in the app's data folder.
    const auto fallback = cacheFileFor(audio, {});
    for (auto& f : { cache, fallback })
        if (auto d = readCache(f, audio)) { if (fromCache) *fromCache = true; return d; }
    auto d = compute(audio, fm, error);
    if (d == nullptr) return nullptr;
    if (! writeCache(cache, audio, *d) && cache != fallback) writeCache(fallback, audio, *d);
    return d;
}

void Peaks::run()
{
    juce::AudioFormatManager fm; // one per thread
    fm.registerBasicFormats();
    for (;;) {
        Item it;
        {
            std::unique_lock<std::mutex> g(lock);
            wake.wait(g, [this] { return quit || ! queue.empty(); });
            if (quit) return;
            it = queue.front();
            queue.pop_front();
        }
        juce::String error;
        auto d = load(it.audio, it.cache, fm, error);
        auto alive_ = alive;
        const auto path = it.audio.getFullPathName();
        juce::MessageManager::callAsync([this, alive_, path, d, error] { if (*alive_) finish(path, d, error); });
    }
}

void Peaks::finish(const juce::String& path, std::shared_ptr<const Data> d, const juce::String& error)
{
    if (d != nullptr) memo[path] = d;
    auto it = waiting.find(path);
    if (it == waiting.end()) return;
    auto list = std::move(it->second);
    waiting.erase(it);
    for (auto& w : list) w(d, error);
}

void Peaks::get(const juce::File& audio, const juce::File& sessionFile, Ready done)
{
    const auto path = audio.getFullPathName();
    if (auto it = memo.find(path); it != memo.end()) {
        // A file changed on disk since (re-exported stem) is read again.
        if (audio.existsAsFile()) { done(it->second, {}); return; }
        memo.erase(it);
    }
    auto& w = waiting[path];
    w.push_back(std::move(done));
    std::lock_guard<std::mutex> g(lock);
    for (auto it = queue.begin(); it != queue.end(); ++it)
        if (it->audio == audio) { queue.erase(it); break; }
    queue.push_front({ audio, cacheFileFor(audio, sessionFile) });
    wake.notify_one();
}

void Peaks::prepare(const juce::Array<juce::File>& audio, const juce::File& sessionFile)
{
    std::lock_guard<std::mutex> g(lock);
    for (auto& f : audio) {
        if (memo.count(f.getFullPathName()) || std::any_of(queue.begin(), queue.end(), [&](const Item& i) { return i.audio == f; })) continue;
        queue.push_back({ f, cacheFileFor(f, sessionFile) });
    }
    wake.notify_all();
}

juce::var Peaks::toVar(const Data& d, int spp)
{
    int l = 0;
    while (l + 1 < numLevels && levels[l + 1] <= spp) ++l;
    auto* o = new juce::DynamicObject();
    o->setProperty("rate", d.rate);
    o->setProperty("frames", (double) d.frames);
    o->setProperty("channels", d.channels);
    o->setProperty("spp", levels[l]);
    o->setProperty("peaks", juce::Base64::toBase64(d.level[l].getData(), d.level[l].getSize()));
    return juce::var(o);
}

} // namespace setline::gui
