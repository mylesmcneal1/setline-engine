#include "Kokoro.h"
#include "Ort.h"
#include "Folders.h"
#include <onnxruntime_c_api.h>
#include <juce_cryptography/juce_cryptography.h>
#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstring>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <mutex>
#include <optional>
#include <thread>
#include <unordered_map>

namespace setline::gui::kokoro {

// ==================================================================================== voices
const std::vector<VoiceInfo>& voiceTable()
{
    // Grades: the overall grade on the model card (hexgrad/Kokoro-82M VOICES.md).
    static const std::vector<VoiceInfo> t = {
        { "af_heart", "Heart", "en-US", 'F', "A", 10 },     { "af_bella", "Bella", "en-US", 'F', "A-", 9 },
        { "af_nicole", "Nicole", "en-US", 'F', "B-", 7 },   { "af_aoede", "Aoede", "en-US", 'F', "C+", 6 },
        { "af_kore", "Kore", "en-US", 'F', "C+", 6 },       { "af_sarah", "Sarah", "en-US", 'F', "C+", 6 },
        { "af_alloy", "Alloy", "en-US", 'F', "C", 5 },      { "af_nova", "Nova", "en-US", 'F', "C", 5 },
        { "af_sky", "Sky", "en-US", 'F', "C-", 4 },         { "af_jessica", "Jessica", "en-US", 'F', "D", 2 },
        { "af_river", "River", "en-US", 'F', "D", 2 },
        { "am_fenrir", "Fenrir", "en-US", 'M', "C+", 6 },   { "am_michael", "Michael", "en-US", 'M', "C+", 6 },
        { "am_puck", "Puck", "en-US", 'M', "C+", 6 },       { "am_echo", "Echo", "en-US", 'M', "D", 2 },
        { "am_eric", "Eric", "en-US", 'M', "D", 2 },        { "am_liam", "Liam", "en-US", 'M', "D", 2 },
        { "am_onyx", "Onyx", "en-US", 'M', "D", 2 },        { "am_santa", "Santa", "en-US", 'M', "D-", 1 },
        { "am_adam", "Adam", "en-US", 'M', "F+", 0 },
        { "bf_emma", "Emma", "en-GB", 'F', "B-", 7 },       { "bf_isabella", "Isabella", "en-GB", 'F', "C", 5 },
        { "bf_alice", "Alice", "en-GB", 'F', "D", 2 },      { "bf_lily", "Lily", "en-GB", 'F', "D", 2 },
        { "bm_fable", "Fable", "en-GB", 'M', "C", 5 },      { "bm_george", "George", "en-GB", 'M', "C", 5 },
        { "bm_lewis", "Lewis", "en-GB", 'M', "D+", 3 },     { "bm_daniel", "Daniel", "en-GB", 'M', "D", 2 },
    };
    return t;
}

std::vector<speech::Voice> voices()
{
    std::vector<speech::Voice> v;
    for (auto& x : voiceTable()) {
        speech::Voice s;
        s.id = juce::String(prefix) + x.code;
        s.name = x.name;
        s.lang = x.lang;
        s.quality = x.rank >= 9 ? 3 : x.rank >= 6 ? 2 : 1;
        s.engine = "kokoro";
        s.gender = juce::String::charToString((juce::juce_wchar) x.gender);
        s.grade = x.grade;
        s.rank = x.rank;
        v.push_back(s);
    }
    return v;
}

bool isKokoro(const juce::String& voiceId) { return voiceId.startsWith(prefix); }

const VoiceInfo* find(const juce::String& voiceId)
{
    if (! isKokoro(voiceId)) return nullptr;
    const auto code = voiceId.fromFirstOccurrenceOf(prefix, false, false);
    for (auto& x : voiceTable()) if (code == x.code) return &x;
    return nullptr;
}

juce::String defaultVoiceId() { return juce::String(prefix) + "af_heart"; }

// ==================================================================================== files
namespace {
#define HF "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/"
#define MISAKI "https://raw.githubusercontent.com/hexgrad/misaki/fba1236595f2d2bf21d414ba6e57d25256afada3/misaki/data/"
struct FileSpec { const char* rel; const char* url; const char* sha256; juce::int64 size; };
// Pinned: Kokoro-82M v1.0 ONNX (onnx-community, revision 1939ad2a) and misaki's dictionaries (commit fba12365).
const FileSpec fileSpecs[] = {
    { "model.onnx", HF "onnx/model.onnx", "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb", 325532232 },
    { "voices/af_alloy.bin", HF "voices/af_alloy.bin", "c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45", 522240 },
    { "voices/af_aoede.bin", HF "voices/af_aoede.bin", "4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361", 522240 },
    { "voices/af_bella.bin", HF "voices/af_bella.bin", "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b", 522240 },
    { "voices/af_heart.bin", HF "voices/af_heart.bin", "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b", 522240 },
    { "voices/af_jessica.bin", HF "voices/af_jessica.bin", "a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8", 522240 },
    { "voices/af_kore.bin", HF "voices/af_kore.bin", "9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e", 522240 },
    { "voices/af_nicole.bin", HF "voices/af_nicole.bin", "cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a", 522240 },
    { "voices/af_nova.bin", HF "voices/af_nova.bin", "18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f", 522240 },
    { "voices/af_river.bin", HF "voices/af_river.bin", "00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30", 522240 },
    { "voices/af_sarah.bin", HF "voices/af_sarah.bin", "4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a", 522240 },
    { "voices/af_sky.bin", HF "voices/af_sky.bin", "4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9", 522240 },
    { "voices/am_adam.bin", HF "voices/am_adam.bin", "162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716", 522240 },
    { "voices/am_echo.bin", HF "voices/am_echo.bin", "3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3", 522240 },
    { "voices/am_eric.bin", HF "voices/am_eric.bin", "e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832", 522240 },
    { "voices/am_fenrir.bin", HF "voices/am_fenrir.bin", "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43", 522240 },
    { "voices/am_liam.bin", HF "voices/am_liam.bin", "52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade", 522240 },
    { "voices/am_michael.bin", HF "voices/am_michael.bin", "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1", 522240 },
    { "voices/am_onyx.bin", HF "voices/am_onyx.bin", "da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6", 522240 },
    { "voices/am_puck.bin", HF "voices/am_puck.bin", "fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0", 522240 },
    { "voices/am_santa.bin", HF "voices/am_santa.bin", "61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a", 522240 },
    { "voices/bf_alice.bin", HF "voices/bf_alice.bin", "08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573", 522240 },
    { "voices/bf_emma.bin", HF "voices/bf_emma.bin", "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73", 522240 },
    { "voices/bf_isabella.bin", HF "voices/bf_isabella.bin", "3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f", 522240 },
    { "voices/bf_lily.bin", HF "voices/bf_lily.bin", "5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335", 522240 },
    { "voices/bm_daniel.bin", HF "voices/bm_daniel.bin", "6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8", 522240 },
    { "voices/bm_fable.bin", HF "voices/bm_fable.bin", "f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1", 522240 },
    { "voices/bm_george.bin", HF "voices/bm_george.bin", "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc", 522240 },
    { "voices/bm_lewis.bin", HF "voices/bm_lewis.bin", "b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97", 522240 },
    { "misaki/us_gold.json", MISAKI "us_gold.json", "dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f", 3000469 },
    { "misaki/us_silver.json", MISAKI "us_silver.json", "de8f67be911bb6c659187b4a65fd966b6a30e56350e0f790d763210b053ac475", 3099517 },
    { "misaki/gb_gold.json", MISAKI "gb_gold.json", "29e62f4b60261c88f7f3c2c7811ca3825978948090b72d2b27d565b729282f71", 2838552 },
    { "misaki/gb_silver.json", MISAKI "gb_silver.json", "48131e2d92ccc41655f4543e87e0f938e71463eb5a54be7f0693bb712ebb6bce", 3663898 },
};
#undef HF
#undef MISAKI

juce::File modelDir() { return folder().getChildFile("kokoro-v1.0"); }

struct Downloader {
    std::mutex m;
    Status st;
    bool checked = false;
    std::thread th;
    std::atomic<bool> quit { false }, cancel { false };
    std::function<void(const Status&)> listener;
    std::condition_variable changed;
    ~Downloader() { quit = true; if (th.joinable()) th.join(); }
};
Downloader& dl() { static Downloader d; return d; }

void notify()
{
    auto& d = dl();
    Status s; std::function<void(const Status&)> fn;
    { std::lock_guard<std::mutex> g(d.m); s = d.st; fn = d.listener; }
    d.changed.notify_all();
    if (fn) fn(s);
}

// verified.txt: "<rel> <size> <modified ms> <sha256>" per file, written after its hash matched, so a start-up
// check is a size + date comparison rather than hashing 330 MB again.
std::map<juce::String, juce::String> readMarker()
{
    std::map<juce::String, juce::String> m;
    juce::StringArray lines;
    lines.addLines(modelDir().getChildFile("verified.txt").loadFileAsString());
    for (auto& l : lines) if (l.contains(" ")) m[l.upToFirstOccurrenceOf(" ", false, false)] = l.fromFirstOccurrenceOf(" ", false, false);
    return m;
}
juce::String markOf(const juce::File& f, const FileSpec& s)
{
    return juce::String(f.getSize()) + " " + juce::String(f.getLastModificationTime().toMilliseconds()) + " " + s.sha256;
}
void writeMarker(const std::map<juce::String, juce::String>& m)
{
    juce::String t;
    for (auto& [k, v] : m) t << k << " " << v << "\n";
    modelDir().getChildFile("verified.txt").replaceWithText(t);
}

bool fileOk(const FileSpec& s, const std::map<juce::String, juce::String>& marker)
{
    const auto f = modelDir().getChildFile(s.rel);
    if (! f.existsAsFile() || f.getSize() != s.size) return false;
    auto it = marker.find(s.rel);
    return it != marker.end() && it->second == markOf(f, s);
}

void checkFiles()
{
    auto& d = dl();
    { std::lock_guard<std::mutex> g(d.m); if (d.checked) return; }
    const auto marker = readMarker();
    juce::int64 total = 0, have = 0;
    for (auto& s : fileSpecs) { total += s.size; if (fileOk(s, marker)) have += s.size; }
    std::lock_guard<std::mutex> g(d.m);
    if (d.checked) return;
    d.checked = true;
    d.st.total = total;
    d.st.done = have;
    d.st.state = have == total ? State::ready : State::missing;
}

bool downloadOne(const FileSpec& s, juce::int64 base, juce::String& error)
{
    auto& d = dl();
    const auto f = modelDir().getChildFile(s.rel);
    f.getParentDirectory().createDirectory();
    const auto part = f.getSiblingFile(f.getFileName() + ".part");
    for (int attempt = 0; attempt < 3 && ! d.quit && ! d.cancel; ++attempt) {
        part.deleteFile();
        int code = 0;
        auto in = juce::URL(s.url).createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                                                          .withConnectionTimeoutMs(30000)
                                                          .withNumRedirectsToFollow(10)
                                                          .withStatusCode(&code));
        if (in == nullptr || (code != 0 && code != 200)) { error = "Couldn't reach the download (" + juce::String(code) + ") for " + s.rel; continue; }
        juce::int64 got = 0;
        {
            juce::FileOutputStream out(part);
            if (! out.openedOk()) { error = "Couldn't write " + part.getFullPathName(); return false; }
            juce::HeapBlock<char> buf(1 << 16);
            auto last = std::chrono::steady_clock::now();
            for (;;) {
                if (d.quit || d.cancel) { out.flush(); break; }
                const int n = in->read(buf.get(), 1 << 16);
                if (n <= 0) break;
                if (! out.write(buf.get(), (size_t) n)) { error = "Couldn't write " + part.getFullPathName() + " (disk full?)"; return false; }
                got += n;
                if (auto now = std::chrono::steady_clock::now(); now - last > std::chrono::milliseconds(250)) {
                    last = now;
                    { std::lock_guard<std::mutex> g(d.m); d.st.done = base + got; }
                    notify();
                }
            }
            out.flush();
        }
        if (d.cancel) { part.deleteFile(); error = "cancelled"; return false; }
        if (got != s.size) { error = "The download of " + juce::String(s.rel) + " stopped early (" + juce::String(got) + " of " + juce::String(s.size) + " bytes)."; continue; }
        if (juce::SHA256(part).toHexString() != s.sha256) { error = juce::String(s.rel) + " failed its check (SHA-256), so it wasn't used."; part.deleteFile(); continue; }
        f.deleteFile();
        if (! part.moveFileTo(f)) { error = "Couldn't move " + part.getFullPathName(); return false; }
        return true;
    }
    part.deleteFile();
    return false;
}

void downloadAll()
{
    auto& d = dl();
    auto marker = readMarker();
    juce::int64 base = 0;
    juce::String error;
    bool ok = true;
    for (auto& s : fileSpecs) {
        if (d.quit) return;
        if (! fileOk(s, marker)) {
            const auto f = modelDir().getChildFile(s.rel);
            // A complete file from an earlier run without a marker: hash it instead of downloading again.
            const bool reuse = f.existsAsFile() && f.getSize() == s.size && juce::SHA256(f).toHexString() == s.sha256;
            if (! reuse && ! downloadOne(s, base, error)) { ok = false; break; }
            marker[s.rel] = markOf(f, s);
            writeMarker(marker);
        }
        base += s.size;
        { std::lock_guard<std::mutex> g(d.m); d.st.done = base; }
        notify();
    }
    if (! ok && d.cancel) { // cancelled: back to "not downloaded", keeping the files that finished
        { std::lock_guard<std::mutex> g(d.m); d.checked = false; }
        checkFiles();
        { std::lock_guard<std::mutex> g(d.m); d.st.state = State::missing; d.st.error = {}; }
        notify();
        return;
    }
    {
        std::lock_guard<std::mutex> g(d.m);
        d.st.state = ok ? State::ready : State::failed;
        d.st.error = ok ? juce::String() : error;
    }
    notify();
}
} // namespace

juce::File folder()
{
    const auto env = juce::SystemStats::getEnvironmentVariable("SETLINE_MODELS_DIR", {});
    if (env.isNotEmpty()) return juce::File(env);
    return folders::models(); // %LOCALAPPDATA%/set.Line/Models, ~/Library/Caches/set.Line/Models (Folders.h)
}

juce::String stateName(State s)
{
    switch (s) { case State::missing: return "missing"; case State::downloading: return "downloading"; case State::ready: return "ready"; case State::failed: return "failed"; }
    return {};
}

Status status() { checkFiles(); auto& d = dl(); std::lock_guard<std::mutex> g(d.m); return d.st; }

void startDownload()
{
    checkFiles();
    auto& d = dl();
    std::thread old;
    {
        std::lock_guard<std::mutex> g(d.m);
        if (d.st.state == State::ready || d.st.state == State::downloading) return;
        old = std::move(d.th); // a finished (failed or cancelled) earlier attempt
    }
    if (old.joinable()) old.join(); // outside the lock: its last notify() takes it
    {
        std::lock_guard<std::mutex> g(d.m);
        if (d.st.state == State::ready || d.st.state == State::downloading) return;
        d.st.state = State::downloading;
        d.st.error = {};
        d.cancel = false;
        d.th = std::thread([] { downloadAll(); });
    }
    notify();
}

void cancelDownload()
{
    auto& d = dl();
    std::lock_guard<std::mutex> g(d.m);
    if (d.st.state == State::downloading) d.cancel = true;
}

bool waitReady(int timeoutMs, juce::String& error)
{
    startDownload();
    auto& d = dl();
    std::unique_lock<std::mutex> g(d.m);
    d.changed.wait_for(g, std::chrono::milliseconds(timeoutMs), [&] { return d.st.state == State::ready || d.st.state == State::failed; });
    if (d.st.state == State::ready) return true;
    error = d.st.state == State::failed ? d.st.error : juce::String("The voice download took too long.");
    return false;
}

void setListener(std::function<void(const Status&)> fn) { auto& d = dl(); std::lock_guard<std::mutex> g(d.m); d.listener = std::move(fn); }

// ==================================================================================== text -> phonemes
namespace {
using P = std::u32string; // phonemes

P utf32(const juce::String& s);
P utf32(const std::string& s) { return utf32(juce::String::fromUTF8(s.data(), (int) s.size())); }
P utf32(const juce::String& s) { return P(reinterpret_cast<const char32_t*>(s.toUTF32().getAddress())); }
juce::String toJuce(const P& p) { return juce::String(juce::CharPointer_UTF32(reinterpret_cast<const juce::CharPointer_UTF32::CharType*>(p.c_str()))); }

// A flat JSON object of "word": "phonemes" | {"DEFAULT": "phonemes", ...} (misaki's dictionaries).
bool parseLexicon(const juce::File& f, std::unordered_map<std::string, P>& out, juce::String& error)
{
    juce::MemoryBlock mb;
    if (! f.loadFileAsData(mb)) { error = "Couldn't read " + f.getFullPathName(); return false; }
    const char* p = static_cast<const char*>(mb.getData());
    const char* end = p + mb.getSize();
    auto ws = [&] { while (p < end && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t')) ++p; };
    auto str = [&](std::string& s) -> bool {
        ws(); if (p >= end || *p != '"') return false; ++p; s.clear();
        while (p < end && *p != '"') {
            if (*p == '\\' && p + 1 < end) {
                ++p;
                if (*p == 'u' && p + 4 < end) {
                    const auto cp = (juce::juce_wchar) std::strtol(std::string(p + 1, 4).c_str(), nullptr, 16);
                    s += juce::String::charToString(cp).toStdString(); p += 5; continue;
                }
                s += *p == 'n' ? '\n' : *p == 't' ? '\t' : *p; ++p; continue;
            }
            s += *p++;
        }
        if (p >= end) return false;
        ++p; return true;
    };
    auto skipValue = [&] { // null or a string
        ws(); if (p < end && *p == 'n') { p += 4; return; }
        std::string t; str(t);
    };
    ws(); if (p >= end || *p != '{') { error = "Not a dictionary: " + f.getFileName(); return false; }
    ++p;
    std::string k, v;
    for (;;) {
        ws(); if (p < end && *p == '}') break;
        if (! str(k)) { error = "Damaged dictionary: " + f.getFileName(); return false; }
        ws(); if (p >= end || *p != ':') return false; ++p; ws();
        if (p < end && *p == '"') { str(v); out.emplace(k, utf32(v)); }
        else if (p < end && *p == '{') {
            ++p;
            for (;;) {
                ws(); if (p < end && *p == '}') { ++p; break; }
                std::string tag; if (! str(tag)) return false;
                ws(); ++p; ws(); // ':'
                if (tag == "DEFAULT" && p < end && *p == '"') { str(v); out.emplace(k, utf32(v)); } else skipValue();
                ws(); if (p < end && *p == ',') ++p;
            }
        } else skipValue();
        ws(); if (p < end && *p == ',') ++p;
    }
    return true;
}

struct Lexicon {
    bool british = false, loaded = false;
    std::unordered_map<std::string, P> gold, silver;
    const P* get(const std::string& w) const
    {
        if (auto it = gold.find(w); it != gold.end()) return &it->second;
        if (auto it = silver.find(w); it != silver.end()) return &it->second;
        return nullptr;
    }
};

std::mutex lexLock;
Lexicon lexUS, lexGB;

const Lexicon* lexicon(bool british, juce::String& error)
{
    std::lock_guard<std::mutex> g(lexLock);
    auto& L = british ? lexGB : lexUS;
    if (L.loaded) return &L;
    const auto dir = modelDir().getChildFile("misaki");
    const juce::String pre = british ? "gb" : "us";
    if (! parseLexicon(dir.getChildFile(pre + "_gold.json"), L.gold, error) || ! parseLexicon(dir.getChildFile(pre + "_silver.json"), L.silver, error)) {
        L.gold.clear(); L.silver.clear(); return nullptr;
    }
    L.british = british;
    L.loaded = true;
    return &L;
}

std::string lower(std::string s) { for (auto& c : s) c = (char) std::tolower((unsigned char) c); return s; }
std::string capital(std::string s) { s = lower(s); if (! s.empty()) s[0] = (char) std::toupper((unsigned char) s[0]); return s; }
bool allUpper(const std::string& s) { bool any = false; for (char c : s) { if (std::islower((unsigned char) c)) return false; any |= (bool) std::isupper((unsigned char) c); } return any; }

// Music words the dictionaries get wrong or don't have (US, GB).
const std::map<std::string, std::pair<const char*, const char*>>& musicWords()
{
    static const std::map<std::string, std::pair<const char*, const char*>> m = {
        { "bass", { "bˈAs", "bˈAs" } },              // the instrument, not the fish
        { "basses", { "bˈAsᵻz", "bˈAsɪz" } },
        { "prechorus", { "pɹˌikˈɔɹəs", "pɹˌiːkˈɔːɹəs" } }, { "pre-chorus", { "pɹˌikˈɔɹəs", "pɹˌiːkˈɔːɹəs" } },
        { "postchorus", { "pˌOstkˈɔɹəs", "pˌQstkˈɔːɹəs" } }, { "post-chorus", { "pˌOstkˈɔɹəs", "pˌQstkˈɔːɹəs" } },
        { "acapella", { "ˌɑkəpˈɛlə", "ˌakəpˈɛlə" } }, { "a-cappella", { "ˌɑkəpˈɛlə", "ˌakəpˈɛlə" } }, { "cappella", { "kəpˈɛlə", "kəpˈɛlə" } },
        { "lead", { "lˈid", "lˈiːd" } },             // lead vocal / lead guitar
        { "vox", { "vˈɑks", "vˈɒks" } },
        { "rit", { "ɹˈɪt", "ɹˈɪt" } }, { "ritard", { "ɹɪtˈɑɹd", "ɹɪtˈɑːd" } }, // ritardando, as musicians say it
        { "rall", { "ɹˈæl", "ɹˈal" } },
    };
    return m;
}

struct G2P {
    const Lexicon& L;
    const Pronunciations& pron;
    juce::StringArray* unknown;
    int depth = 0;

    const P* known(const std::string& w) const
    {
        if (auto* p = L.get(w)) return p;
        if (auto* p = L.get(lower(w))) return p;
        if (auto* p = L.get(capital(w))) return p;
        return nullptr;
    }
    static char32_t last(const P& p) { return p.empty() ? 0 : p.back(); }
    bool isTau(char32_t c) const { return P(U"AIOWYiuæɑəɛɪɹʊʌ").find(c) != P::npos; }
    // misaki's -s / -ed / -ing rules (en.py: _s, _ed, _ing)
    P s_(const P& stem) const
    {
        if (P(U"ptkfθ").find(last(stem)) != P::npos) return stem + U"s";
        if (P(U"szʃʒʧʤ").find(last(stem)) != P::npos) return stem + (L.british ? U"ɪz" : U"ᵻz");
        return stem + U"z";
    }
    P ed_(const P& stem) const
    {
        const auto c = last(stem);
        if (P(U"pkfθʃsʧ").find(c) != P::npos) return stem + U"t";
        if (c == U'd') return stem + (L.british ? U"ɪd" : U"ᵻd");
        if (c != U't') return stem + U"d";
        if (L.british || stem.size() < 2) return stem + U"ɪd";
        if (isTau(stem[stem.size() - 2])) return stem.substr(0, stem.size() - 1) + U"ɾᵻd";
        return stem + U"ᵻd";
    }
    std::optional<P> ing_(const P& stem) const
    {
        if (L.british) { if (P(U"əː").find(last(stem)) != P::npos) return std::nullopt; }
        else if (stem.size() > 1 && last(stem) == U't' && isTau(stem[stem.size() - 2])) return stem.substr(0, stem.size() - 1) + U"ɾɪŋ";
        return stem + U"ɪŋ";
    }
    std::optional<P> stems(const std::string& w) const
    {
        const auto n = w.size();
        auto ends = [&](const char* e) { const auto k = std::strlen(e); return n >= k && w.compare(n - k, k, e) == 0; };
        if (n >= 3 && ends("s")) {
            if (! ends("ss")) if (auto* p = known(w.substr(0, n - 1))) return s_(*p);
            if ((ends("'s") || (n > 4 && ends("es") && ! ends("ies")))) if (auto* p = known(w.substr(0, n - 2))) return s_(*p);
            if (n > 4 && ends("ies")) if (auto* p = known(w.substr(0, n - 3) + "y")) return s_(*p);
        }
        if (n >= 4 && ends("d")) {
            if (! ends("dd")) if (auto* p = known(w.substr(0, n - 1))) return ed_(*p);
            if (n > 4 && ends("ed") && ! ends("eed")) if (auto* p = known(w.substr(0, n - 2))) return ed_(*p);
        }
        if (n >= 5 && ends("ing")) {
            if (n > 5) if (auto* p = known(w.substr(0, n - 3))) return ing_(*p);
            if (auto* p = known(w.substr(0, n - 3) + "e")) return ing_(*p);
            if (n > 5 && w[n - 4] == w[n - 5]) if (auto* p = known(w.substr(0, n - 4))) return ing_(*p);
        }
        return std::nullopt;
    }
    // Letters spelled out, with the stress on the last one (misaki's get_NNP).
    std::optional<P> spell(const std::string& w) const
    {
        P out;
        for (char c : w) {
            if (! std::isalpha((unsigned char) c)) continue;
            auto* p = L.get(std::string(1, (char) std::toupper((unsigned char) c)));
            if (p == nullptr) return std::nullopt;
            out += *p;
        }
        for (auto& c : out) if (c == U'ˈ') c = U'ˌ';
        if (auto i = out.rfind(U'ˌ'); i != P::npos) out[i] = U'ˈ';
        return out;
    }
    // Two real words run together ("drumfill"): the longest first part that leaves a word, both at least 3
    // letters and from the gold dictionary (the silver one has abbreviations that would match anything).
    const P* goldWord(const std::string& w) const
    {
        for (const auto& k : { w, capital(w) }) if (auto it = L.gold.find(k); it != L.gold.end()) return &it->second;
        return nullptr;
    }
    std::optional<P> compound(const std::string& w) const
    {
        const auto lw = lower(w);
        if (lw.size() < 6) return std::nullopt;
        for (size_t i = lw.size() - 3; i >= 3; --i) {
            auto* a = goldWord(lw.substr(0, i));
            if (a == nullptr) continue;
            if (auto* b = goldWord(lw.substr(i))) {
                P second = *b; // one primary stress per word: the second part's becomes secondary
                for (auto& c : second) if (c == U'ˈ') c = U'ˌ';
                return *a + second;
            }
        }
        return std::nullopt;
    }
    // A word nobody knows, sounded out from its spelling with plain English rules (better than spelling it
    // letter by letter; the panel still lists it so the show can say how it really sounds).
    static P soundOut(const std::string& lw)
    {
        static const std::vector<std::pair<const char*, const char32_t*>> rules = {
            { "tch", U"ʧ" }, { "dge", U"ʤ" }, { "igh", U"I" }, { "ough", U"ʌf" },
            { "dj", U"ʤ" }, { "sh", U"ʃ" }, { "ch", U"ʧ" }, { "th", U"θ" }, { "ph", U"f" }, { "wh", U"w" }, { "ck", U"k" },
            { "ng", U"ŋ" }, { "qu", U"kw" }, { "kn", U"n" }, { "wr", U"ɹ" },
            { "ee", U"i" }, { "ea", U"i" }, { "oo", U"u" }, { "ou", U"W" }, { "ow", U"W" }, { "ai", U"A" }, { "ay", U"A" },
            { "oa", U"O" }, { "oi", U"Y" }, { "oy", U"Y" }, { "au", U"ɔ" }, { "aw", U"ɔ" }, { "ie", U"i" }, { "ue", U"u" }, { "ew", U"u" },
            { "ar", U"ɑɹ" }, { "or", U"ɔɹ" }, { "er", U"ɜɹ" }, { "ir", U"ɜɹ" }, { "ur", U"ɜɹ" },
            { "a", U"æ" }, { "e", U"ɛ" }, { "i", U"ɪ" }, { "o", U"ɑ" }, { "u", U"ʌ" }, { "y", U"ɪ" },
            { "b", U"b" }, { "d", U"d" }, { "f", U"f" }, { "g", U"ɡ" }, { "h", U"h" }, { "j", U"ʤ" }, { "k", U"k" }, { "l", U"l" },
            { "m", U"m" }, { "n", U"n" }, { "p", U"p" }, { "r", U"ɹ" }, { "s", U"s" }, { "t", U"t" }, { "v", U"v" }, { "w", U"w" },
            { "x", U"ks" }, { "z", U"z" },
        };
        static const P longV = U"AiIOu"; // a e i o u as in "made, theme, time, tone, tune"
        auto isV = [](char c) { return std::strchr("aeiou", c) != nullptr; };
        P out;
        bool stressed = false;
        size_t i = 0;
        const auto n = lw.size();
        while (i < n) {
            const char c = lw[i];
            if (! std::isalpha((unsigned char) c)) { ++i; continue; }
            if (c == 'e' && i == n - 1 && n > 2) break;                               // silent final e
            if (c == 'c') { out += (i + 1 < n && std::strchr("eiy", lw[i + 1])) ? U"s" : U"k"; ++i; continue; }
            if (c == 'y' && i == n - 1 && n > 1) { out += U"i"; ++i; continue; }    // "happy"
            // vowel + consonant + final e: the long vowel ("djent" stays short, "gate" is long)
            if (isV(c) && c != 'y' && i + 2 == n - 1 && lw[n - 1] == 'e' && ! isV(lw[i + 1])) {
                if (! stressed) { out += U'ˈ'; stressed = true; }
                out += longV[(size_t) (std::strchr("aeiou", c) - "aeiou")];
                ++i; continue;
            }
            bool matched = false;
            for (auto& [g, ph] : rules) {
                const auto len = std::strlen(g);
                if (lw.compare(i, len, g) != 0) continue;
                const P phs = ph;
                const bool vowel = phs.find_first_of(U"æɛɪɑʌiuAIOWYɔɜ") != P::npos;
                if (vowel && ! stressed) { out += U'ˈ'; stressed = true; }
                out += phs;
                i += len;
                matched = true;
                break;
            }
            if (! matched) ++i;
        }
        return out;
    }
    P word(const std::string& w)
    {
        const auto lw = lower(w);
        if (auto it = pron.find(juce::String::fromUTF8(lw.c_str())); it != pron.end() && depth == 0) {
            const auto v = it->second.trim();
            if (v.length() > 2 && v.startsWith("/") && v.endsWith("/")) return utf32(v.substring(1, v.length() - 1));
            G2P inner { L, pron, nullptr, depth + 1 };
            return inner.text(v);
        }
        if (auto it = musicWords().find(lw); it != musicWords().end()) return utf32(std::string(L.british ? it->second.second : it->second.first));
        if (allUpper(w) && w.size() > 1) {
            if (auto* p = L.get(w)) return *p;          // a capitalised entry (acronym the dictionary knows)
            if (auto* p = known(lw)) return *p;          // "CHORUS"
            if (auto s = stems(lw)) return *s;
            if (auto s = spell(w)) return *s;            // "BVS" -> B V S
        }
        if (auto* p = known(w)) return *p;
        if (auto s = stems(lw)) return *s;
        if (auto c = compound(w)) return *c;
        if (unknown != nullptr) unknown->addIfNotAlreadyThere(juce::String::fromUTF8(w.c_str()));
        return soundOut(lw);
    }

    // ---- numbers
    static std::string under1000(int n, bool british)
    {
        static const char* ones[] = { "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
                                      "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen" };
        static const char* tens[] = { "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety" };
        std::string s;
        if (n >= 100) { s = std::string(ones[n / 100]) + " hundred"; n %= 100; if (n == 0) return s; s += british ? " and " : " "; }
        if (n < 20) return s + ones[n];
        s += tens[n / 10];
        if (n % 10) s += std::string(" ") + ones[n % 10];
        return s;
    }
    static std::string cardinal(long long n, bool british)
    {
        if (n < 1000) return under1000((int) n, british);
        if (n < 1000000) {
            auto s = under1000((int) (n / 1000), british) + " thousand";
            const int r = (int) (n % 1000);
            if (r) s += (r < 100 && british ? " and " : " ") + under1000(r, british);
            return s;
        }
        auto s = cardinal(n / 1000000, british) + " million";
        if (n % 1000000) s += " " + cardinal(n % 1000000, british);
        return s;
    }
    static std::string ordinal(long long n, bool british)
    {
        auto s = cardinal(n, british);
        const auto sp = s.rfind(' ');
        auto lastW = s.substr(sp == std::string::npos ? 0 : sp + 1);
        auto head = s.substr(0, sp == std::string::npos ? 0 : sp + 1);
        static const std::map<std::string, std::string> irregular = { { "one", "first" }, { "two", "second" }, { "three", "third" }, { "five", "fifth" },
                                                                      { "eight", "eighth" }, { "nine", "ninth" }, { "twelve", "twelfth" } };
        if (auto it = irregular.find(lastW); it != irregular.end()) return head + it->second;
        if (! lastW.empty() && lastW.back() == 'y') return head + lastW.substr(0, lastW.size() - 1) + "ieth";
        return head + lastW + "th";
    }

    // ---- a whole cue
    P text(const juce::String& in)
    {
        // Spoken forms: "&" -> and, "x2" / "2x" -> times two / two times, digits -> words.
        auto t = in.replace("&", " and ").replace(juce::String::fromUTF8("\xc3\x97"), "x").replace("/", " ").replace("_", " ").trim();
        P out;
        bool needSpace = false;
        auto addWords = [&](const std::string& words) {
            juce::StringArray ws; ws.addTokens(juce::String(words), " ", "");
            for (auto& w : ws) if (w.isNotEmpty()) { if (needSpace) out += U' '; out += word(w.toStdString()); needSpace = true; }
        };
        const auto s = t.toStdString();
        size_t i = 0;
        const P punct = U",.!?;:—…";
        while (i < s.size()) {
            const unsigned char c = (unsigned char) s[i];
            if (std::isalpha(c) || std::isdigit(c) || c == '\'') {
                size_t j = i;
                while (j < s.size() && (std::isalnum((unsigned char) s[j]) || s[j] == '\'' || s[j] == '-'
                                        || (s[j] == '.' && j > i && j + 1 < s.size() && std::isdigit((unsigned char) s[j - 1]) && std::isdigit((unsigned char) s[j + 1]))))
                    ++j;
                std::string tok = s.substr(i, j - i);
                while (! tok.empty() && (tok.back() == '-' || tok.back() == '\'')) tok.pop_back();
                i = j;
                if (tok.empty()) continue;
                const auto lt = lower(tok);
                if (musicWords().count(lt) || pron.count(juce::String::fromUTF8(lt.c_str()))) { addWords(tok); continue; }
                // x2 / 2x / 1st / 1.5 / 12
                auto isNum = [](const std::string& x) { return ! x.empty() && std::all_of(x.begin(), x.end(), [](char ch) { return std::isdigit((unsigned char) ch); }); };
                if (lt.size() > 1 && lt[0] == 'x' && isNum(lt.substr(1))) { addWords("times " + cardinal(std::stoll(lt.substr(1)), L.british)); continue; }
                if (lt.size() > 1 && lt.back() == 'x' && isNum(lt.substr(0, lt.size() - 1))) { addWords(cardinal(std::stoll(lt.substr(0, lt.size() - 1)), L.british) + " times"); continue; }
                if (lt.size() > 2 && isNum(lt.substr(0, lt.size() - 2))) {
                    const auto suf = lt.substr(lt.size() - 2);
                    if (suf == "st" || suf == "nd" || suf == "rd" || suf == "th") { addWords(ordinal(std::stoll(lt.substr(0, lt.size() - 2)), L.british)); continue; }
                }
                if (isNum(lt) && lt.size() <= 12) { addWords(cardinal(std::stoll(lt), L.british)); continue; }
                if (auto dot = lt.find('.'); dot != std::string::npos && isNum(lt.substr(0, dot)) && isNum(lt.substr(dot + 1))) {
                    std::string w = cardinal(std::stoll(lt.substr(0, dot)), L.british) + " point";
                    for (char d : lt.substr(dot + 1)) w += " " + under1000(d - '0', L.british);
                    addWords(w); continue;
                }
                // hyphenated words: the parts ("count-in")
                juce::StringArray parts; parts.addTokens(juce::String(tok), "-", "");
                for (auto& p : parts) {
                    if (p.isEmpty()) continue;
                    const auto ps = p.toStdString();
                    // letters and digits mixed ("V2"): split into runs
                    std::string run;
                    auto flush = [&] { if (run.empty()) return; if (isNum(run)) addWords(cardinal(std::stoll(run.substr(0, 12)), L.british)); else addWords(run); run.clear(); };
                    for (char ch : ps) { if (! run.empty() && (bool) std::isdigit((unsigned char) ch) != (bool) std::isdigit((unsigned char) run.back())) flush(); run += ch; }
                    flush();
                }
                continue;
            }
            // punctuation Kokoro knows: kept (pauses, intonation); anything else separates words
            const auto cp = utf32(juce::String::fromUTF8(s.data() + i, (int) std::min<size_t>(4, s.size() - i)));
            const size_t len = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
            if (! cp.empty() && punct.find(cp[0]) != P::npos) { out += cp[0]; needSpace = true; }
            i += len;
        }
        return out;
    }
};

// Kokoro v1.0 vocab: phoneme code point -> token id.
const std::pair<char32_t, int> vocab[] = {{0x3b,1},{0x3a,2},{0x2c,3},{0x2e,4},{0x21,5},{0x3f,6},{0x2014,9},{0x2026,10},{0x22,11},{0x28,12},{0x29,13},{0x201c,14},{0x201d,15},{0x20,16},{0x303,17},{0x2a3,18},{0x2a5,19},{0x2a6,20},{0x2a8,21},{0x1d5d,22},{0xab67,23},{0x41,24},{0x49,25},{0x4f,31},{0x51,33},{0x53,35},{0x54,36},{0x57,39},{0x59,41},{0x1d4a,42},{0x61,43},{0x62,44},{0x63,45},{0x64,46},{0x65,47},{0x66,48},{0x68,50},{0x69,51},{0x6a,52},{0x6b,53},{0x6c,54},{0x6d,55},{0x6e,56},{0x6f,57},{0x70,58},{0x71,59},{0x72,60},{0x73,61},{0x74,62},{0x75,63},{0x76,64},{0x77,65},{0x78,66},{0x79,67},{0x7a,68},{0x251,69},{0x250,70},{0x252,71},{0xe6,72},{0x3b2,75},{0x254,76},{0x255,77},{0xe7,78},{0x256,80},{0xf0,81},{0x2a4,82},{0x259,83},{0x25a,85},{0x25b,86},{0x25c,87},{0x25f,90},{0x261,92},{0x265,99},{0x268,101},{0x26a,102},{0x29d,103},{0x26f,110},{0x270,111},{0x14b,112},{0x273,113},{0x272,114},{0x274,115},{0xf8,116},{0x278,118},{0x3b8,119},{0x153,120},{0x279,123},{0x27e,125},{0x27b,126},{0x281,128},{0x27d,129},{0x282,130},{0x283,131},{0x288,132},{0x2a7,133},{0x28a,135},{0x28b,136},{0x28c,138},{0x263,139},{0x264,140},{0x3c7,142},{0x28e,143},{0x292,147},{0x294,148},{0x2c8,156},{0x2cc,157},{0x2d0,158},{0x2b0,162},{0x2b2,164},{0x2193,169},{0x2192,171},{0x2197,172},{0x2198,173},{0x1d7b,177}};

int tokenOf(char32_t c)
{
    static const std::unordered_map<char32_t, int> m = [] { std::unordered_map<char32_t, int> x; for (auto& [k, v] : vocab) x[k] = v; return x; }();
    auto it = m.find(c);
    return it == m.end() ? -1 : it->second;
}
} // namespace

juce::String phonemes(const juce::String& text, bool british, const Pronunciations& pron, juce::StringArray* unknown)
{
    juce::String err;
    auto* L = lexicon(british, err);
    if (L == nullptr) return {};
    G2P g { *L, pron, unknown };
    return toJuce(g.text(text));
}

// ==================================================================================== the model
namespace {
struct Model {
    const OrtApi* A = nullptr;
    OrtEnv* env = nullptr;
    OrtSessionOptions* opts = nullptr;
    OrtSession* session = nullptr;
    OrtMemoryInfo* mem = nullptr;
    std::string idsName, styleName, speedName, outName;
    ONNXTensorElementDataType speedType = ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT;
    std::map<std::string, std::vector<float>> styles;
    double lastSeconds = 0;

    bool check(OrtStatus* s, juce::String& error)
    {
        if (s == nullptr) return true;
        error = juce::String("Voice engine: ") + A->GetErrorMessage(s);
        A->ReleaseStatus(s);
        return false;
    }

    bool load(juce::String& error)
    {
        if (session != nullptr) return true;
        if (A == nullptr && (A = ort::api(error)) == nullptr) return false;
        if (env == nullptr && ! check(A->CreateEnv(ORT_LOGGING_LEVEL_ERROR, "setline", &env), error)) return false;
        if (opts == nullptr) {
            if (! check(A->CreateSessionOptions(&opts), error)) return false;
            // Two threads: renders happen while you edit, maybe during playback; keep the machine free.
            check(A->SetIntraOpNumThreads(opts, 2), error);
            check(A->SetInterOpNumThreads(opts, 1), error);
            check(A->SetSessionGraphOptimizationLevel(opts, ORT_ENABLE_ALL), error);
        }
        const auto file = modelDir().getChildFile("model.onnx");
       #if JUCE_WINDOWS
        if (! check(A->CreateSession(env, file.getFullPathName().toWideCharPointer(), opts, &session), error)) return false;
       #else
        if (! check(A->CreateSession(env, file.getFullPathName().toRawUTF8(), opts, &session), error)) return false;
       #endif
        if (mem == nullptr && ! check(A->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mem), error)) return false;

        OrtAllocator* alloc = nullptr;
        if (! check(A->GetAllocatorWithDefaultOptions(&alloc), error)) return false;
        size_t nIn = 0, nOut = 0;
        if (! check(A->SessionGetInputCount(session, &nIn), error) || ! check(A->SessionGetOutputCount(session, &nOut), error)) return false;
        idsName = styleName = speedName = outName = {};
        for (size_t i = 0; i < nIn; ++i) {
            char* name = nullptr;
            if (! check(A->SessionGetInputName(session, i, alloc, &name), error)) return false;
            const std::string n = name;
            alloc->Free(alloc, name);
            if (n.find("ids") != std::string::npos || n.find("token") != std::string::npos) idsName = n;
            else if (n.find("style") != std::string::npos || n == "ref_s") styleName = n;
            else if (n.find("speed") != std::string::npos) {
                speedName = n;
                OrtTypeInfo* ti = nullptr;
                const OrtTensorTypeAndShapeInfo* tsi = nullptr;
                if (check(A->SessionGetInputTypeInfo(session, i, &ti), error)) {
                    if (check(A->CastTypeInfoToTensorInfo(ti, &tsi), error) && tsi != nullptr) check(A->GetTensorElementType(tsi, &speedType), error);
                    A->ReleaseTypeInfo(ti);
                }
            }
        }
        if (nOut > 0) {
            char* name = nullptr;
            if (! check(A->SessionGetOutputName(session, 0, alloc, &name), error)) return false;
            outName = name;
            alloc->Free(alloc, name);
        }
        if (idsName.empty() || styleName.empty() || speedName.empty() || outName.empty()) {
            error = "The voice model has unexpected inputs.";
            release();
            return false;
        }
        return true;
    }

    const std::vector<float>* style(const std::string& code, juce::String& error)
    {
        if (auto it = styles.find(code); it != styles.end()) return &it->second;
        juce::MemoryBlock mb;
        if (! modelDir().getChildFile("voices").getChildFile(juce::String(code) + ".bin").loadFileAsData(mb) || mb.getSize() != 510 * 256 * sizeof(float)) {
            error = "The voice file for " + juce::String(code) + " is missing.";
            return nullptr;
        }
        std::vector<float> v(510 * 256);
        std::memcpy(v.data(), mb.getData(), mb.getSize()); // little-endian float32 [510][1][256], as on every platform we build
        return &(styles[code] = std::move(v));
    }

    bool run(const std::vector<int64_t>& tokens, const std::string& code, float speed, std::vector<float>& out, juce::String& error)
    {
        if (! load(error)) return false;
        auto* st = style(code, error);
        if (st == nullptr) return false;
        // input_ids: 0, tokens..., 0. The style row is picked by the number of tokens (as in Kokoro's own code).
        std::vector<int64_t> ids;
        ids.reserve(tokens.size() + 2);
        ids.push_back(0);
        ids.insert(ids.end(), tokens.begin(), tokens.end());
        ids.push_back(0);
        const size_t row = std::min<size_t>(tokens.size(), 509);
        std::vector<float> s(st->begin() + (std::ptrdiff_t) (row * 256), st->begin() + (std::ptrdiff_t) (row * 256 + 256));
        float sp32 = speed;
        double sp64 = speed;
        int32_t spI = (int32_t) std::lround(speed);
        const int64_t idsShape[] = { 1, (int64_t) ids.size() }, styleShape[] = { 1, 256 }, speedShape[] = { 1 };
        OrtValue* in[3] = {};
        OrtValue* result = nullptr;
        auto cleanup = [&] { for (auto* v : in) if (v) A->ReleaseValue(v); if (result) A->ReleaseValue(result); };
        bool ok = check(A->CreateTensorWithDataAsOrtValue(mem, ids.data(), ids.size() * sizeof(int64_t), idsShape, 2, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &in[0]), error)
               && check(A->CreateTensorWithDataAsOrtValue(mem, s.data(), s.size() * sizeof(float), styleShape, 2, ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &in[1]), error);
        if (ok) {
            void* p = &sp32; size_t bytes = sizeof(float);
            if (speedType == ONNX_TENSOR_ELEMENT_DATA_TYPE_DOUBLE) { p = &sp64; bytes = sizeof(double); }
            else if (speedType == ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32) { p = &spI; bytes = sizeof(int32_t); }
            ok = check(A->CreateTensorWithDataAsOrtValue(mem, p, bytes, speedShape, 1, speedType, &in[2]), error);
        }
        if (! ok) { cleanup(); return false; }
        const char* inNames[] = { idsName.c_str(), styleName.c_str(), speedName.c_str() };
        const char* outNames[] = { outName.c_str() };
        const auto t0 = std::chrono::steady_clock::now();
        ok = check(A->Run(session, nullptr, inNames, in, 3, outNames, 1, &result), error);
        lastSeconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        if (ok) {
            float* data = nullptr;
            OrtTensorTypeAndShapeInfo* info = nullptr;
            size_t n = 0;
            ok = check(A->GetTensorMutableData(result, reinterpret_cast<void**>(&data)), error) && check(A->GetTensorTypeAndShape(result, &info), error)
                 && check(A->GetTensorShapeElementCount(info, &n), error);
            if (info) A->ReleaseTensorTypeAndShapeInfo(info);
            if (ok) out.assign(data, data + n);
        }
        cleanup();
        return ok;
    }

    void release()
    {
        if (A == nullptr) return;
        if (session) { A->ReleaseSession(session); session = nullptr; }
        styles.clear();
    }
};
Model& model() { static Model m; return m; }
std::mutex modelLock;
} // namespace

extern std::atomic<int> renders;
bool render(const juce::String& text, const juce::String& voiceId, double speed, const Pronunciations& pron,
            std::vector<float>& out, double& rate, juce::String& error)
{
    const auto* v = find(voiceId);
    if (v == nullptr) { error = "Unknown Kokoro voice " + voiceId; return false; }
    const auto st = status();
    if (st.state != State::ready) { // never downloads by itself: the user starts it (Cue voice panel)
        error = st.state == State::downloading ? juce::String("The Kokoro voices are still downloading.") : juce::String("The Kokoro voices aren't downloaded.");
        return false;
    }
    const bool british = juce::String(v->lang) == "en-GB";
    auto* L = lexicon(british, error);
    if (L == nullptr) return false;
    G2P g { *L, pron, nullptr };
    const auto ph = g.text(text);
    std::vector<int64_t> tokens;
    for (auto c : ph) if (const int t = tokenOf(c); t >= 0) tokens.push_back(t);
    while (! tokens.empty() && tokens.back() == 16) tokens.pop_back(); // trailing space
    if (tokens.empty()) { error = "Nothing to say."; return false; }
    if (tokens.size() > 500) tokens.resize(500);
    std::lock_guard<std::mutex> lk(modelLock);
    if (! model().run(tokens, v->code, (float) juce::jlimit(0.5, 2.0, speed), out, error)) return false;
    rate = 24000.0;
    ++renders;
    return true;
}

std::atomic<int> renders { 0 };
int renderCount() { return renders.load(); }

void unload() { std::lock_guard<std::mutex> lk(modelLock); model().release(); }
double lastRenderSeconds() { std::lock_guard<std::mutex> lk(modelLock); return model().lastSeconds; }

} // namespace setline::gui::kokoro
