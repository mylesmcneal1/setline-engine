#include "TestSong.h"
#include "Engine.h"
#include "TempoMap.h"
#include "Wav.h"
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <thread>

namespace setline {

std::vector<TempoChange> testTempo()
{
    // 120 in 4/4, one bar of 7/8 at 140, back to 4/4 at 140, then 96 from bar 17.
    return { { 1, 120, 4, 4 }, { 9, 140, 7, 8 }, { 10, 0, 4, 4 }, { 17, 96, 0, 0 } };
}

static const char* kStemNames[] = { "Drums", "Bass", "Keys", "Guitars", "BGVs", "Synth", "FX", "Strings",
                                    "Perc", "Organ", "Pads", "Choir", "Brass", "Loops", "Vox FX", "Sub" };

static std::vector<std::vector<float>> musicStem(int k, int64_t len, double sr)
{
    std::vector<std::vector<float>> ch(2, std::vector<float>((size_t) len));
    const double f = 110.0 * (1 + k % 8) * (k >= 8 ? 1.5 : 1.0);
    const double a = std::pow(10.0, -30.0 / 20.0);
    for (int64_t i = 0; i < len; ++i) {
        const double t = i / sr;
        const double trem = 0.75 + 0.25 * std::sin(2 * 3.14159265358979 * 0.5 * t + k);
        const float v = (float) (a * trem * std::sin(2 * 3.14159265358979 * f * t));
        ch[0][(size_t) i] = v; ch[1][(size_t) i] = v * 0.9f;
    }
    return ch;
}

// A 2 ms full-scale-ish block starting exactly on every downbeat. Easy to find on a scope or in a DAW.
static std::vector<std::vector<float>> markerStem(const TempoMap& tm, int64_t len, double sr)
{
    std::vector<std::vector<float>> ch(1, std::vector<float>((size_t) len, 0.0f));
    const int w = (int) (0.002 * sr);
    for (int b = 1; b <= tm.numBars(); ++b) {
        const int64_t s = tm.sampleAt(b, 1);
        for (int i = 0; i < w && s + i < len; ++i) ch[0][(size_t) (s + i)] = 0.8f;
    }
    return ch;
}

static void addMidi(SongDef& s, int port, int bar, double beat, uint8_t a, uint8_t b, uint8_t c, int len, std::string label)
{
    MidiEventDef m; m.port = port; m.bar = bar; m.beat = beat; m.bytes[0] = a; m.bytes[1] = b; m.bytes[2] = c; m.len = len; m.label = std::move(label);
    s.midi.push_back(m);
}

SongDef makeTestSong(int musicStems, double seconds, double sr, int midiPort)
{
    SongDef s;
    s.name = "set.Line test song";
    s.tempo = testTempo();
    const int64_t len = (int64_t) (seconds * sr);
    TempoMap tm; tm.build(s.tempo, sr, len, 17);

    auto mk = [&](std::string name, std::vector<std::vector<float>> data, std::vector<int> outs) {
        auto src = std::make_shared<InMemorySource>(); src->data = std::move(data); src->sr = sr;
        StemDef d; d.name = std::move(name); d.source = src; d.outs = std::move(outs); s.stems.push_back(d);
    };
    mk("Marker", markerStem(tm, len, sr), { 2 });
    for (int k = 0; k < musicStems; ++k) mk(kStemNames[k % 16], musicStem(k, len, sr), { 0, 1 });
    s.clickOuts = { 3 };
    s.clickGainDb = -6;

    addMidi(s, midiPort, 1, 1, 0xC0, 0, 0, 2, "PC 1 (bar 1)");
    addMidi(s, midiPort, 9, 1, 0xC0, 1, 0, 2, "PC 2 (bar 9, 7/8)");
    addMidi(s, midiPort, 10, 1, 0xC0, 2, 0, 2, "PC 3 (bar 10)");
    addMidi(s, midiPort, 17, 1, 0xC0, 3, 0, 2, "PC 4 (bar 17, 96 BPM)");
    for (int b = 1; b <= tm.numBars(); ++b) {
        if (tm.sampleAt(b, 1) >= len) break;
        addMidi(s, midiPort, b, 1, 0x9F, 60, 100, 3, "probe on");
        addMidi(s, midiPort, b, 1.5, 0x8F, 60, 0, 3, "probe off");
    }
    return s;
}

static std::string jsonEsc(const std::string& x) { std::string o; for (char c : x) { if (c == '"' || c == '\\') o += '\\'; o += c; } return o; }

std::string writeTestSong(const std::string& dir, int musicStems, double seconds, double sr)
{
    namespace fs = std::filesystem;
    std::error_code ec; fs::create_directories(dir, ec);
    if (ec) return "Can't create " + dir + ": " + ec.message();
    // Only the marker is held in memory; music stems are generated and written one at a time.
    SongDef s = makeTestSong(0, seconds, sr, 0);
    const int64_t len = (int64_t) (seconds * sr);
    std::string stemsJson;
    auto addStem = [&](int idx, const std::string& name, const std::vector<std::vector<float>>& data, const std::string& outs) {
        char fn[64]; std::snprintf(fn, sizeof fn, "%02d %s.wav", idx, name.c_str());
        if (! writeWav((fs::path(dir) / fn).string(), data, sr)) return std::string("Can't write ") + fn;
        stemsJson += std::string(idx ? ",\n" : "") + "    { \"file\": \"" + jsonEsc(fn) + "\", \"out\": [" + outs + "], \"gain_db\": 0 }";
        return std::string();
    };
    if (auto e = addStem(0, "Marker", static_cast<InMemorySource*>(s.stems[0].source.get())->data, "3"); ! e.empty()) return e;
    s.stems.clear();
    for (int k = 0; k < musicStems; ++k)
        if (auto e = addStem(k + 1, kStemNames[k % 16], musicStem(k, len, sr), "1, 2"); ! e.empty()) return e;

    std::string tempoJson;
    for (size_t i = 0; i < s.tempo.size(); ++i) {
        auto& t = s.tempo[i];
        tempoJson += std::string(i ? ",\n" : "") + "    { \"bar\": " + std::to_string(t.bar);
        if (t.bpm > 0) tempoJson += ", \"bpm\": " + std::to_string((int) t.bpm);
        if (t.num > 0) tempoJson += ", \"sig\": [" + std::to_string(t.num) + ", " + std::to_string(t.den) + "]";
        tempoJson += " }";
    }
    std::string midiJson;
    for (size_t i = 0; i < s.midi.size(); ++i) {
        auto& m = s.midi[i];
        const int type = m.bytes[0] & 0xF0, ch = (m.bytes[0] & 0x0F) + 1;
        char beat[32]; std::snprintf(beat, sizeof beat, "%g", m.beat);
        std::string e = "    { \"port\": \"\", \"bar\": " + std::to_string(m.bar) + ", \"beat\": " + beat + ", \"ch\": " + std::to_string(ch);
        if (type == 0xC0) e += ", \"type\": \"pc\", \"program\": " + std::to_string(m.bytes[1]);
        else if (type == 0x90) e += ", \"type\": \"note_on\", \"note\": " + std::to_string(m.bytes[1]) + ", \"velocity\": " + std::to_string(m.bytes[2]);
        else if (type == 0x80) e += ", \"type\": \"note_off\", \"note\": " + std::to_string(m.bytes[1]);
        midiJson += std::string(i ? ",\n" : "") + e + " }";
    }
    std::ofstream j(fs::path(dir) / "song.json");
    j << "{\n  \"name\": \"" << jsonEsc(s.name) << "\",\n"
      << "  \"tempo\": [\n" << tempoJson << "\n  ],\n"
      << "  \"stems\": [\n" << stemsJson << "\n  ],\n"
      << "  \"click\": { \"out\": [4], \"gain_db\": -6 },\n"
      << "  \"midi\": [\n" << midiJson << "\n  ]\n}\n";
    return j ? "" : "Can't write song.json";
}

// ------------------------------------------------------------------ self-test

namespace {
int64_t firstAbove(const std::vector<float>& x, int64_t from, int64_t to, float thr)
{
    from = std::max<int64_t>(0, from); to = std::min<int64_t>((int64_t) x.size(), to);
    for (int64_t i = from; i < to; ++i) if (std::fabs(x[(size_t) i]) > thr) return i;
    return -1;
}

struct Rendered { std::vector<std::vector<float>> out; std::vector<Engine::LoggedMidi> midi; int64_t underruns = 0; };

Rendered renderOffline(const SongDef& song, double sr, int block, int ring, int chunk, Engine& e)
{
    Engine::Config cfg; cfg.sampleRate = sr; cfg.numOutputs = 4; cfg.offline = true; cfg.ringFrames = ring; cfg.chunkFrames = chunk;
    std::vector<std::string> warn;
    Rendered r;
    if (! e.load(song, cfg, warn).empty()) return r;
    e.start();
    std::vector<std::vector<float>> buf(4, std::vector<float>((size_t) block));
    float* ptrs[4] = { buf[0].data(), buf[1].data(), buf[2].data(), buf[3].data() };
    r.out.assign(4, {});
    while (e.isPlaying()) {
        e.process(ptrs, 4, block);
        for (int c = 0; c < 4; ++c) r.out[(size_t) c].insert(r.out[(size_t) c].end(), buf[(size_t) c].begin(), buf[(size_t) c].end());
    }
    r.midi = e.midiLog;
    r.underruns = e.stats.underruns.load();
    return r;
}

struct FakeSink : MidiSink { std::atomic<int> n { 0 }; void sendNow(int, const uint8_t*, int) override { ++n; } };
} // namespace

bool runSelfTest(bool verbose)
{
    bool ok = true;
    auto check = [&](bool cond, const std::string& what) {
        if (! cond) ok = false;
        if (verbose || ! cond) std::printf("  [%s] %s\n", cond ? "ok" : "FAIL", what.c_str());
    };
    const double sr = 48000;
    std::printf("set.Line engine self-test\n");

    // 1) Sample accuracy across odd block sizes and a deliberately tiny ring buffer.
    for (int block : { 128, 97, 1024, 33 }) {
        SongDef song = makeTestSong(3, 45, sr);
        Engine e;
        Rendered r = renderOffline(song, sr, block, block == 33 ? 3000 : 1 << 15, block == 33 ? 512 : 4096, e);
        const auto& tm = e.tempoMap();
        const int64_t len = e.lengthSamples();
        int barsChecked = 0, markerOk = 0, beatsChecked = 0, clickOk = 0;
        for (int b = 1; b <= tm.numBars(); ++b) {
            const int64_t s = tm.sampleAt(b, 1);
            if (s + 2000 >= len) break;
            ++barsChecked;
            if (firstAbove(r.out[2], s - 400, s + 400, 0.05f) == s) ++markerOk;
        }
        for (auto& c : e.clickList()) {
            if (c.sample + 2000 >= len) break;
            ++beatsChecked;
            if (firstAbove(r.out[3], c.sample - 60, c.sample + 60, 0.05f) == c.sample) ++clickOk;
        }
        int midiOk = 0;
        const auto& expect = e.midiList();
        for (size_t i = 0; i < r.midi.size() && i < expect.size(); ++i) if (r.midi[i].sample == expect[i].sample) ++midiOk;
        const std::string tag = "block " + std::to_string(block) + ": ";
        check(barsChecked > 20 && markerOk == barsChecked, tag + "stem marker lands on the exact downbeat sample (" + std::to_string(markerOk) + "/" + std::to_string(barsChecked) + " bars)");
        check(beatsChecked > 60 && clickOk == beatsChecked, tag + "click starts on the exact beat sample (" + std::to_string(clickOk) + "/" + std::to_string(beatsChecked) + " beats)");
        check(! expect.empty() && midiOk == (int) expect.size() && r.midi.size() == expect.size(), tag + "MIDI events fire on the exact sample (" + std::to_string(midiOk) + "/" + std::to_string(expect.size()) + ")");
        check(r.underruns == 0, tag + "no disk underruns");
    }

    // 2) Tempo map arithmetic: bar 9 is 7/8 at 140, so bar 10 starts 3.5 beats of 140 later.
    {
        TempoMap tm; tm.build(testTempo(), sr, 0, 20);
        const int64_t b9 = tm.sampleAt(9, 1), b10 = tm.sampleAt(10, 1);
        const double expectB9 = 8 * 4 * 0.5 * sr;                 // 8 bars of 4/4 at 120
        const double expectBar9Len = 7 * (60.0 / 140 * 0.5) * sr; // seven 8ths at 140
        check(b9 == std::llround(expectB9), "bar 9 starts at 16.000 s");
        check(b10 - b9 == std::llround(expectBar9Len), "the 7/8 bar is exactly 1.500 s");
    }

    // 3) Real-time simulation: a fake device thread calls the engine every 128 samples for 6 s.
    {
        SongDef song = makeTestSong(8, 8, sr);
        Engine e; FakeSink sink;
        Engine::Config cfg; cfg.sampleRate = sr; cfg.numOutputs = 4;
        std::vector<std::string> warn;
        e.load(song, cfg, warn);
        e.setMidiSink(&sink);
        e.setDeviceTiming(128, 64);
        e.setDeviceRunning(true);
        std::atomic<bool> run { true };
        std::thread dev([&] {
            std::vector<std::vector<float>> buf(4, std::vector<float>(128));
            float* p[4] = { buf[0].data(), buf[1].data(), buf[2].data(), buf[3].data() };
            auto next = Clock::now();
            while (run) { e.process(p, 4, 128); next += std::chrono::microseconds(2667); std::this_thread::sleep_until(next); }
        });
        const bool started = e.start();
        std::this_thread::sleep_for(std::chrono::seconds(6));
        run = false; dev.join();
        e.setDeviceRunning(false);
        e.stop();
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        check(started, "real-time: preroll finished and playback started");
        check(e.stats.underruns.load() == 0, "real-time: no disk underruns with 9 stems streaming");
        check(e.midi.dropped.load() == 0, "real-time: no MIDI events dropped");
        const int64_t n = e.midi.sent.load();
        char line[200];
        std::snprintf(line, sizeof line, "real-time: %lld MIDI sends, lateness avg %.3f ms, max %.3f ms (informational on shared CI machines)",
                      (long long) n, n ? e.midi.lateSumUs.load() / 1000.0 / n : 0.0, e.midi.lateMaxUs.load() / 1000.0);
        check(n >= 5, line);
        if (e.midi.lateMaxUs.load() > 2000) std::printf("  [warn] MIDI was over 2 ms late at least once. If this repeats on a real --soak run, MIDI timing fails.\n");
        std::snprintf(line, sizeof line, "real-time: worst callback %.3f ms of a 2.667 ms budget", e.stats.cbMaxUs.load() / 1000.0);
        check(true, line);
    }

    std::printf(ok ? "ALL CHECKS PASSED\n" : "SOME CHECKS FAILED\n");
    return ok;
}

} // namespace setline
