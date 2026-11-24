#include "TestSong.h"
#include "LiveGain.h"
#include "Engine.h"
#include "TempoMap.h"
#include "Wav.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <functional>
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

// Offline engine driver for the step-1 checks: load, start anywhere, call process() block by block.
struct OfflineRun {
    Engine e;
    int outs = 4, block = 128;
    std::vector<std::vector<float>> out;  // everything rendered, per output
    int64_t firstSample = 0;              // song sample of out[*][0]
    std::vector<std::vector<float>> buf;
    std::vector<float*> ptrs;

    bool load(const SongDef& s, double sr, int numOuts = 4, int blk = 128)
    {
        outs = numOuts; block = blk;
        Engine::Config cfg; cfg.sampleRate = sr; cfg.numOutputs = outs; cfg.offline = true; cfg.ringFrames = 1 << 15; cfg.chunkFrames = 4096;
        std::vector<std::string> w;
        buf.assign((size_t) outs, std::vector<float>((size_t) block)); ptrs.clear();
        for (auto& b : buf) ptrs.push_back(b.data());
        return e.load(s, cfg, w).empty();
    }
    bool start(int64_t from) { out.assign((size_t) outs, {}); const bool ok = e.start(from); firstSample = e.position(); return ok; }
    void step()
    {
        e.process(ptrs.data(), outs, block);
        for (int c = 0; c < outs; ++c) out[(size_t) c].insert(out[(size_t) c].end(), buf[(size_t) c].begin(), buf[(size_t) c].end());
    }
    void runToEnd(int64_t maxBlocks = 1 << 22) { while (e.isPlaying() && maxBlocks-- > 0) step(); }
    float at(int c, int64_t songSample) const
    {
        const int64_t i = songSample - firstSample;
        return (i >= 0 && i < (int64_t) out[(size_t) c].size()) ? out[(size_t) c][(size_t) i] : 0.0f;
    }
};

// A mono stem holding a constant value: makes gain ramps and fades easy to measure.
StemDef constantStem(float v, int64_t len, double sr, int out)
{
    auto src = std::make_shared<InMemorySource>(); src->sr = sr; src->data.assign(1, std::vector<float>((size_t) len, v));
    StemDef d; d.name = "Const"; d.source = src; d.outs = { out }; return d;
}

// Song samples where a click starts on an output: a sample above thr after at least `quiet` silent samples.
std::vector<int64_t> onsets(const OfflineRun& r, int c, float thr = 0.02f, int quiet = 1000)
{
    std::vector<int64_t> v; int64_t lastLoud = -1000000;
    const auto& x = r.out[(size_t) c];
    for (size_t i = 0; i < x.size(); ++i)
        if (std::fabs(x[i]) > thr) { if ((int64_t) i - lastLoud > quiet) v.push_back(r.firstSample + (int64_t) i); lastLoud = (int64_t) i; }
    return v;
}

float maxStep(const std::vector<float>& x, size_t from, size_t to)
{
    float m = 0; to = std::min(to, x.size());
    for (size_t i = from + 1; i < to; ++i) m = std::max(m, std::fabs(x[i] - x[i - 1]));
    return m;
}
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

    // ---------------------------------------------------------------- step 1 engine additions
    std::printf("Step 1 engine additions\n");

    // 1) Start from any position: bar 9 lands marker, click and MIDI on the same samples as playing from bar 1.
    {
        SongDef song = makeTestSong(3, 45, sr);
        OfflineRun full, from9;
        full.load(song, sr); full.start(0); full.runToEnd();
        from9.load(song, sr);
        const int64_t s9 = from9.e.tempoMap().sampleAt(9, 1);
        const bool started = from9.start(s9);
        from9.runToEnd();
        const auto& tm = from9.e.tempoMap();
        const int64_t len = from9.e.lengthSamples();
        int bars = 0, markerOk = 0;
        for (int b = 9; b <= tm.numBars(); ++b) {
            const int64_t s = tm.sampleAt(b, 1);
            if (s + 2000 >= len) break;
            ++bars;
            const int64_t i = firstAbove(from9.out[2], s - from9.firstSample - 400, s - from9.firstSample + 400, 0.05f);
            if (i >= 0 && i + from9.firstSample == s) ++markerOk;
        }
        int clicksExpected = 0, clicksOk = 0;
        for (auto& c : from9.e.clickList()) {
            if (c.sample < s9 || c.sample + 2000 >= len) continue;
            ++clicksExpected;
            const int64_t i = firstAbove(from9.out[3], c.sample - from9.firstSample - 60, c.sample - from9.firstSample + 60, 0.05f);
            if (i >= 0 && i + from9.firstSample == c.sample) ++clicksOk;
        }
        std::vector<int64_t> expectMidi;
        for (auto& m : full.e.midiLog) if (m.sample >= s9) expectMidi.push_back(m.sample);
        bool midiSame = expectMidi.size() == from9.e.midiLog.size();
        for (size_t i = 0; midiSame && i < expectMidi.size(); ++i) midiSame = from9.e.midiLog[i].sample == expectMidi[i];
        // From bar 9 on, every output is bit-identical to the full render.
        float diff = 0;
        for (int c = 0; c < 4; ++c)
            for (int64_t s = s9; s < s9 + (int64_t) (10 * sr); ++s) diff = std::max(diff, std::fabs(from9.at(c, s) - full.at(c, s)));
        const auto clickOn = onsets(from9, 3);
        const bool nothingBefore = clickOn.empty() || clickOn.front() >= s9;
        check(started && from9.firstSample == s9 - (int64_t) std::lround(0.005 * sr), "start at bar 9: audio prerolls 5 ms, playback begins at bar 9");
        check(bars > 8 && markerOk == bars, "start at bar 9: marker lands on the exact downbeat sample (" + std::to_string(markerOk) + "/" + std::to_string(bars) + " bars)");
        check(clicksExpected > 30 && clicksOk == clicksExpected && nothingBefore, "start at bar 9: click on the exact beat samples (" + std::to_string(clicksOk) + "/" + std::to_string(clicksExpected) + "), nothing earlier");
        check(midiSame && ! expectMidi.empty(), "start at bar 9: MIDI on the same samples as from bar 1 (" + std::to_string(from9.e.midiLog.size()) + " events), none before");
        check(diff == 0.0f, "start at bar 9: every output identical to playing from bar 1 (10 s compared)");

        // Mid-beat start (bar 12, beat 2.37): the next click still lands exactly, nothing earlier.
        OfflineRun mid; mid.load(song, sr);
        const int64_t sm = mid.e.tempoMap().sampleAt(12, 2.37);
        mid.start(sm); for (int k = 0; k < 400; ++k) mid.step();
        int64_t nextClick = -1; for (auto& c : mid.e.clickList()) if (c.sample >= sm) { nextClick = c.sample; break; }
        const auto on = onsets(mid, 3);
        check(! on.empty() && on.front() == nextClick, "start mid-beat (bar 12 beat 2.37): first click on its exact sample, none earlier");
    }

    // 2) Explicit click hits: exactly the entered hits play, nothing generated.
    {
        SongDef song; song.name = "clicks"; song.tempo = testTempo(); song.clickOuts = { 0 }; song.clickGainDb = 0;
        song.clickHits = std::vector<ClickHitDef> { { 2, 1, true }, { 2, 2.5, false }, { 9, 4, false }, { 12, 1, false, -12 }, { 12, 1, false } };
        OfflineRun r; r.load(song, sr, 2); r.start(0); r.runToEnd();
        const auto& tm = r.e.tempoMap();
        const std::vector<int64_t> expect { tm.sampleAt(2, 1), tm.sampleAt(2, 2.5), tm.sampleAt(9, 4), tm.sampleAt(12, 1) };
        const auto got = onsets(r, 0);
        check(got == expect, "click hits: exactly the entered hits play (" + std::to_string(got.size()) + " found, " + std::to_string(expect.size()) + " expected, duplicates merged), nothing generated");
        float pkAcc = 0, pkQuiet = 0;
        for (int64_t s = expect[0]; s < expect[0] + 1000; ++s) pkAcc = std::max(pkAcc, std::fabs(r.at(0, s)));
        SongDef q = song; q.clickHits = std::vector<ClickHitDef> { { 2, 1, false, -12 } };
        OfflineRun rq; rq.load(q, sr, 2); rq.start(0); rq.runToEnd();
        for (int64_t s = expect[0]; s < expect[0] + 1000; ++s) pkQuiet = std::max(pkQuiet, std::fabs(rq.at(0, s)));
        check(pkAcc > 0 && std::fabs(pkQuiet / pkAcc - 0.6f * LiveGain::dbToGain(-12)) < 0.01f, "click hits: accent and per-hit level (-12 dB) applied");
        SongDef none = song; none.clickHits = std::vector<ClickHitDef> {};
        OfflineRun rn; rn.load(none, sr, 2); const bool st = rn.start(0); rn.runToEnd();
        check(st && onsets(rn, 0).empty(), "click hits: an empty list means no click at all (not the every-beat click)");
    }

    // 3) Live track level: ramped over 10 ms, no steps; works for stems and the click.
    {
        const int ramp = (int) std::lround(0.010 * sr);
        SongDef song; song.name = "level"; song.tempo = { { 1, 120, 4, 4 } };
        song.stems.push_back(constantStem(0.5f, (int64_t) (4 * sr), sr, 0));
        OfflineRun r; r.load(song, sr, 2); r.start(0);
        for (int k = 0; k < 10; ++k) r.step();
        const size_t muteAt = r.out[0].size();
        r.e.setTrackLevel(0, 0, true);
        for (int k = 0; k < 10; ++k) r.step();
        const size_t dbAt = r.out[0].size();
        r.e.setTrackLevel(0, -6, false);
        for (int k = 0; k < 10; ++k) r.step();
        const auto& x = r.out[0];
        const float stepMax = 0.5f / (float) ramp * 1.01f + 1e-6f;
        const bool before = x[muteAt - 1] == 0.5f;
        const bool rampDown = maxStep(x, muteAt - 1, dbAt) <= stepMax && x[muteAt + (size_t) ramp] == 0.0f && x[muteAt + (size_t) ramp / 2] > 0.2f;
        const float target = 0.5f * LiveGain::dbToGain(-6);
        const bool rampUp = maxStep(x, dbAt - 1, x.size()) <= stepMax && std::fabs(x[dbAt + (size_t) ramp] - target) < 1e-5f && std::fabs(x.back() - target) < 1e-5f;
        check(before && rampDown, "track level: mute ramps a stem to silence over 10 ms (no step larger than the ramp)");
        check(rampUp, "track level: -6 dB ramps smoothly and settles exactly at -6 dB");

        SongDef ck; ck.name = "click level"; ck.tempo = { { 1, 120, 4, 4 } }; ck.clickOuts = { 0 }; ck.clickGainDb = 0;
        ck.clickHits = std::vector<ClickHitDef> { { 1, 1, true }, { 2, 1, true }, { 3, 1, true } };
        OfflineRun rc; rc.load(ck, sr, 1); rc.e.setTrackLevel(Engine::ClickTrack, -6, false); rc.start(0);
        while (rc.e.position() < rc.e.tempoMap().sampleAt(2, 1) + 2000) rc.step();
        rc.e.setTrackLevel(Engine::ClickTrack, 0, true);
        rc.runToEnd();
        float p1 = 0, p3 = 0;
        const int64_t b1 = rc.e.tempoMap().sampleAt(1, 1), b3 = rc.e.tempoMap().sampleAt(3, 1);
        for (int64_t s = b1; s < b1 + 1000; ++s) p1 = std::max(p1, std::fabs(rc.at(0, s)));
        for (int64_t s = b3; s < b3 + 1000; ++s) p3 = std::max(p3, std::fabs(rc.at(0, s)));
        check(std::fabs(p1 - LiveGain::dbToGain(-6)) < 0.01f && p3 == 0.0f, "track level: click level set before play applies at once (-6 dB); mute silences it");
    }

    // 4) Output meters: peak per output since the last read.
    {
        SongDef song = makeTestSong(1, 10, sr);
        OfflineRun r; r.load(song, sr); r.start(0);
        for (int k = 0; k < 4; ++k) r.step(); // the first click and marker are in these blocks
        const float click = r.e.takeOutputPeak(3), marker = r.e.takeOutputPeak(2), music = r.e.takeOutputPeak(0);
        const float again = r.e.takeOutputPeak(3);
        float expectClick = 0; for (int i = 0; i < 512; ++i) expectClick = std::max(expectClick, std::fabs(r.out[3][(size_t) i]));
        check(expectClick > 0.1f && std::fabs(click - expectClick) < 1e-6f && marker > 0.79f && music > 0.0f && again == 0.0f,
              "meters: each output reports its exact peak, and resets after reading");
    }

    // 5) Songs without stems play click and MIDI for as long as their tempo map and content say.
    {
        SongDef song; song.name = "no stems"; song.tempo = { { 1, 120, 4, 4 } }; song.clickOuts = { 0 };
        song.clickHits = std::vector<ClickHitDef> {}; for (int b = 1; b <= 8; ++b) song.clickHits->push_back({ b, 1, true });
        addMidi(song, 0, 8, 3, 0xC0, 5, 0, 2, "PC at bar 8");
        OfflineRun r; r.load(song, sr, 1);
        const bool st = r.start(0); r.runToEnd();
        const int64_t eightBars = (int64_t) (8 * 2.0 * sr);
        check(st && r.e.lengthSamples() == eightBars && (int64_t) r.out[0].size() >= eightBars && (int64_t) r.out[0].size() < eightBars + 128
                  && onsets(r, 0).size() == 8 && r.e.midiLog.size() == 1,
              "no stems: plays its 8 bars of click + MIDI and stops at the end of bar 8");
        song.lengthBars = 12;
        OfflineRun r12; r12.load(song, sr, 1); r12.start(0); r12.runToEnd();
        check(r12.e.lengthSamples() == (int64_t) (12 * 2.0 * sr), "no stems: a song length of 12 bars plays all 12 bars");
    }

    // MIDI "send early": an event can go out a set time before its bar/beat (never before the song starts).
    {
        SongDef song; song.name = "early"; song.tempo = { { 1, 120, 4, 4 } }; song.lengthBars = 4;
        addMidi(song, 0, 3, 1, 0xC0, 1, 0, 2, "PC bar 3, 100 ms early"); song.midi.back().earlySeconds = 0.1;
        addMidi(song, 0, 1, 1, 0xC0, 2, 0, 2, "PC bar 1, early but clamped"); song.midi.back().earlySeconds = 0.05;
        OfflineRun r; r.load(song, sr, 1); r.start(0); r.runToEnd();
        const auto& log = r.e.midiLog;
        check(log.size() == 2 && log[0].sample == 0 && log[1].sample == r.e.tempoMap().sampleAt(3, 1) - (int64_t) (0.1 * sr),
              "MIDI send early: 100 ms before bar 3 exactly; an early event at bar 1 goes at the song start");
    }

    // Stop fades out over 10 ms instead of cutting; a start inside the song fades in before its first sample.
    {
        const int fade = (int) std::lround(0.010 * sr), fin = (int) std::lround(0.005 * sr);
        SongDef song; song.name = "fade"; song.tempo = { { 1, 120, 4, 4 } };
        song.stems.push_back(constantStem(0.5f, (int64_t) (4 * sr), sr, 0));
        OfflineRun r; r.load(song, sr, 1); r.start(0);
        for (int k = 0; k < 10; ++k) r.step();
        const size_t at = r.out[0].size();
        r.e.requestStop(); r.runToEnd(100);
        const auto& x = r.out[0];
        check(! r.e.isPlaying() && x[at] < 0.5f && x[at] > 0.49f && x[at + (size_t) fade - 1] == 0.0f && maxStep(x, at - 1, x.size()) <= 0.5f / (float) fade * 1.01f,
              "stop: fades out over 10 ms (no click), then stops");
        OfflineRun s; s.load(song, sr, 1);
        const int64_t from = (int64_t) sr; s.start(from); for (int k = 0; k < 10; ++k) s.step();
        check(s.at(0, from - fin) < 0.01f && s.at(0, from) == 0.5f && maxStep(s.out[0], 0, (size_t) fin + 10) <= 0.5f / (float) fin * 1.01f,
              "start inside the song: 5 ms fade-in ends exactly on the start sample");
        check(! s.e.start(s.e.lengthSamples()), "start past the end of the song is refused");
    }


    // Loops and jumps happen inside process(), on the exact sample, with stems streaming.
    {
        const int blk = 97; // odd block size: the loop point falls in the middle of a block
        SongDef song = makeTestSong(3, 45, sr);
        OfflineRun full; full.load(song, sr, 4, blk); full.start(0); full.runToEnd();
        const auto& tm = full.e.tempoMap();
        const int64_t B = tm.sampleAt(3, 1), A = tm.sampleAt(5, 1), L = A - B; // loop bars 3-4
        auto expectLoop = [&](int64_t i) { return i < A ? i : B + (i - A) % L; }; // song sample heard at stream index i

        OfflineRun lp; lp.load(song, sr, 4, blk); lp.e.setLoop(B, A); lp.start(0);
        const int64_t total = A + 3 * L + 1000;
        while ((int64_t) lp.out[0].size() < total) lp.step();
        int64_t bad = -1;
        for (int c = 0; c < 4 && bad < 0; ++c)
            for (int64_t i = 0; i < total; ++i)
                if (lp.out[(size_t) c][(size_t) i] != full.out[(size_t) c][(size_t) expectLoop(i)]) { bad = i; break; }
        check(bad < 0 && lp.e.stats.underruns.load() == 0,
              "loop bars 3-4: every output (stems, marker, click) sample-exact through 3+ passes, wrapping mid-block"
              + (bad >= 0 ? " (first difference at stream sample " + std::to_string(bad) + ")" : std::string()));
        const auto on = onsets(lp, 2, 0.05f, 100); // marker blips = downbeats heard
        bool markerOk = true; int wraps = 0;
        for (int64_t k = 0; k < 3; ++k) {
            const int64_t wrapAt = A + k * L; // stream index where pass k+2 starts: must be bar 3's downbeat
            markerOk &= std::find(on.begin(), on.end(), wrapAt) != on.end(); ++wraps;
        }
        check(markerOk, "loop: bar 3's downbeat marker lands exactly on the wrap sample, " + std::to_string(wraps) + " passes");

        std::vector<int64_t> expectMidi;
        for (auto& m : full.e.midiLog) if (m.sample < A) expectMidi.push_back(m.sample);
        int perPass = 0;
        for (int pass = 0; pass < 3; ++pass)
            for (auto& m : full.e.midiLog) if (m.sample >= B && m.sample < A) { expectMidi.push_back(m.sample); if (pass == 0) ++perPass; }
        bool midiOk = lp.e.midiLog.size() >= expectMidi.size();
        for (size_t i = 0; midiOk && i < expectMidi.size(); ++i) midiOk = lp.e.midiLog[i].sample == expectMidi[i];
        check(midiOk && perPass >= 4, "loop: the " + std::to_string(perPass) + " MIDI events inside the loop fire again on every pass, on the same samples; the one on the loop end doesn't");
        int clicksPerPass = 0; for (auto& c : full.e.clickList()) if (c.sample >= B && c.sample < A) ++clicksPerPass;
        int clickHeard = 0;
        for (auto i : onsets(lp, 3)) if (i >= A && i < A + 3 * L) ++clickHeard;
        check(clicksPerPass == 8 && clickHeard == 3 * clicksPerPass, "loop: all " + std::to_string(clicksPerPass) + " clicks inside the loop play on every pass (" + std::to_string(clickHeard) + " in 3 passes)");

        // Clearing the loop during a pass: playback runs on past the loop end, no wrap.
        OfflineRun cl; cl.load(song, sr, 4, blk); cl.e.setLoop(B, A); cl.start(0);
        while ((int64_t) cl.out[0].size() < A + L / 2) cl.step();
        cl.e.clearJump();
        const int64_t endAt = A + L + L;
        while ((int64_t) cl.out[0].size() < endAt) cl.step();
        bool on2 = true;
        for (int64_t i = A + L / 2 + blk; i < endAt && on2; ++i) on2 = cl.out[2][(size_t) i] == full.out[2][(size_t) (B + (i - A))] && cl.out[3][(size_t) i] == full.out[3][(size_t) (B + (i - A))];
        check(on2, "loop cleared during a pass: playback continues straight past the old loop end");

        // A one-shot jump armed while playing (skip bars 4-8): lands exactly, happens once.
        OfflineRun jp; jp.load(song, sr, 4, blk); jp.start(0);
        while ((int64_t) jp.out[0].size() < tm.sampleAt(2, 1)) jp.step();
        const int64_t at = tm.sampleAt(4, 1), to = tm.sampleAt(9, 1);
        jp.e.setJump(at, to, false);
        while ((int64_t) jp.out[0].size() < at + 3 * (int64_t) sr) jp.step();
        bool jOk = true;
        for (int c = 0; c < 4 && jOk; ++c)
            for (int64_t i = at - 1000; i < at + 3 * (int64_t) sr && jOk; ++i)
                jOk = jp.out[(size_t) c][(size_t) i] == full.out[(size_t) c][(size_t) (i < at ? i : to + (i - at))];
        check(jOk && jp.e.stats.jumps.load() == 1, "jump armed while playing (bar 4 -> bar 9): exact on the sample, once");
    }

    // Real time: a one-bar loop with 9 stems streaming from the disk thread.
    {
        SongDef song = makeTestSong(8, 12, sr);
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
        e.setLoop(0, e.tempoMap().sampleAt(2, 1)); // bar 1, wraps every 2 s
        const bool started = e.start();
        std::this_thread::sleep_for(std::chrono::seconds(6));
        const int64_t jumps = e.stats.jumps.load(), under = e.stats.underruns.load();
        run = false; dev.join();
        e.setDeviceRunning(false);
        e.stop();
        check(started && jumps >= 2 && under == 0, "real-time: a 1-bar loop with 9 stems wraps " + std::to_string(jumps) + " times with no disk underruns");
    }

    // ---- Step 2: audio clips (offset, gain, fades, gaps, mute, split, jump, loop) ----
    {
        // A mono file whose every sample is different and non-zero, so any misplaced sample shows.
        const int64_t fileLen = 10 * (int64_t) sr;
        auto src = std::make_shared<InMemorySource>(); src->sr = sr;
        src->data.assign(1, std::vector<float>((size_t) fileLen));
        for (int64_t i = 0; i < fileLen; ++i) {
            const double f = std::fmod((double) i * 0.6180339887, 1.0);
            src->data[0][(size_t) i] = (float) ((i & 1 ? -1 : 1) * (0.1 + 0.4 * f));
        }
        const auto& file = src->data[0];
        auto songWith = [&](std::vector<ClipDef> clips) {
            SongDef s; s.name = "Clips"; s.tempo = { { 1, 120, 4, 4 } };
            StemDef d; d.name = "Clip stem"; d.source = src; d.outs = { 0 }; d.clips = std::move(clips);
            s.stems.push_back(d);
            return s;
        };
        // What the clips should produce at timeline sample t (one clip at a time here).
        auto expectAt = [&](const std::vector<ClipDef>& clips, int64_t t) {
            float v = 0.0f;
            for (auto& c : clips) {
                if (c.mute || t < c.start || t >= c.end) continue;
                const int64_t i = c.offset + (t - c.start);
                if (i < 0 || i >= fileLen) continue;
                v += file[(size_t) i] * (float) clipGainAt(c, std::pow(10.0, c.gainDb / 20.0), t);
            }
            return v;
        };
        auto render = [&](const std::vector<ClipDef>& clips, int blk) {
            auto r = std::make_unique<OfflineRun>(); r->load(songWith(clips), sr, 4, blk); r->start(0); r->runToEnd();
            return r;
        };
        auto firstDiff = [&](const OfflineRun& r, const std::vector<ClipDef>& clips, int64_t from, int64_t to) -> int64_t {
            for (int64_t t = from; t < to; ++t) if (r.at(0, t) != expectAt(clips, t)) return t;
            return -1;
        };

        // 1) a clip starting mid-file at a non-zero offset
        const std::vector<ClipDef> one = { { 12345, 60001, 7777, 0, 0, 0, false } };
        bool okAll = true;
        for (int blk : { 128, 97, 33, 1024 }) {
            auto r = render(one, blk);
            okAll &= r->at(0, 12344) == 0.0f && r->at(0, 12345) == file[7777] && firstDiff(*r, one, 0, 70000) < 0
                  && r->e.lengthSamples() >= 60001;
        }
        check(okAll, "clips: a clip starting at sample 12345 with file offset 7777 lands on the exact sample (blocks 128, 97, 33, 1024)");

        // 2) a split clip plays back identically to the unsplit clip (gain, fades included)
        const int64_t fi = 4800, fo = 9600;
        const std::vector<ClipDef> whole = { { 1000, 200000, 500, -3.0f, fi, fo, false } };
        const int64_t cut = 77777;
        const std::vector<ClipDef> split = { { 1000, cut, 500, -3.0f, fi, 0, false }, { cut, 200000, 500 + (cut - 1000), -3.0f, 0, fo, false } };
        auto rw = render(whole, 97), rs = render(split, 97);
        bool same = rw->out[0].size() == rs->out[0].size();
        for (size_t i = 0; same && i < rw->out[0].size(); ++i) same = rw->out[0][i] == rs->out[0][i];
        check(same && firstDiff(*rw, whole, 0, 210000) < 0, "clips: a clip split at sample 77777 plays back identically to the unsplit clip");

        // 3) fades follow the curve the page draws (Bezier (0,0) (0.2,1) (1,1)), sample by sample
        bool curveOk = true;
        for (int k = 0; k <= 1000; ++k) { // the formula is the Bezier itself
            const double s = k / 1000.0, x = 0.4 * s + 0.6 * s * s, y = 2 * s - s * s;
            curveOk &= std::fabs(fadeCurve(x) - y) < 1e-9;
        }
        const float g3 = (float) std::pow(10.0, -3.0 / 20.0);
        bool fadeOk = rw->at(0, 1000) == 0.0f;
        for (int64_t t = 1000; t < 1000 + fi && fadeOk; ++t)
            fadeOk = std::fabs(rw->at(0, t) - file[(size_t) (500 + t - 1000)] * (float) (g3 * fadeCurve((double) (t - 1000) / (double) fi))) < 1e-7f;
        for (int64_t t = 200000 - fo; t < 200000 && fadeOk; ++t)
            fadeOk = std::fabs(rw->at(0, t) - file[(size_t) (500 + t - 1000)] * (float) (g3 * fadeCurve((double) (200000 - t) / (double) fo))) < 1e-7f;
        const int64_t mid = 1000 + fi / 2; // halfway through the fade-in: the curve's value there, not a straight line's 0.5
        fadeOk &= std::fabs(rw->at(0, mid) / (file[(size_t) (500 + mid - 1000)] * g3) - (float) fadeCurve(0.5)) < 1e-5f && fadeCurve(0.5) > 0.7;
        fadeOk &= rw->at(0, 1000 + fi) == file[(size_t) (500 + fi)] * g3; // full level (-3 dB) right after the fade
        check(curveOk && fadeOk, "clips: fade-in and fade-out sample values match the page's curve (and -3 dB clip gain)");

        // 4) a gap between clips is digital silence; 5) a muted clip is silent
        const std::vector<ClipDef> gap = { { 1000, 20000, 0, 0, 0, 0, false }, { 30000, 50000, 100, 0, 0, 0, false }, { 60000, 90000, 200, 0, 0, 0, true } };
        auto rg = render(gap, 128);
        bool silent = true, mutedSilent = true;
        for (int64_t t = 20000; t < 30000; ++t) silent &= rg->at(0, t) == 0.0f;
        for (int64_t t = 0; t < 1000; ++t) silent &= rg->at(0, t) == 0.0f;
        for (int64_t t = 60000; t < 90000; ++t) mutedSilent &= rg->at(0, t) == 0.0f;
        check(silent && rg->at(0, 19999) != 0.0f && rg->at(0, 30000) == file[100], "clips: the gap between two clips (and before the first) is digital silence");
        check(mutedSilent && firstDiff(*rg, gap, 0, 95000) < 0, "clips: a muted clip is silent");

        // 6) jumping into the middle of a clip is sample-exact: starting there, and a jump armed while playing
        const std::vector<ClipDef> two = { { 0, 50000, 3000, -2.0f, 2400, 2400, false }, { 50000, 150000, 90000, 1.5f, 1200, 4800, false } };
        auto full = render(two, 97);
        OfflineRun st; st.load(songWith(two), sr, 4, 97);
        const int64_t from = 76543; // inside the second clip
        bool jumpOk = st.start(from) && st.firstSample == from - (int64_t) std::lround(0.005 * sr);
        st.runToEnd();
        for (int64_t t = from; t < 150000 && jumpOk; ++t) jumpOk = st.at(0, t) == full->at(0, t);
        OfflineRun jp; jp.load(songWith(two), sr, 4, 97); jp.start(0);
        jp.e.setJump(20000, 101234, false); // from inside clip 1 to inside clip 2
        while ((int64_t) jp.out[0].size() < 20000 + 40000) jp.step();
        for (int64_t i = 0; i < 20000 + 40000 && jumpOk; ++i) jumpOk = jp.out[0][(size_t) i] == expectAt(two, i < 20000 ? i : 101234 + (i - 20000));
        check(jumpOk && jp.e.stats.jumps.load() == 1, "clips: starting at, and jumping to, the middle of a clip is sample-exact");

        // 7) looping across a clip boundary is sample-exact on every pass
        const int64_t B = 40000, A = 70000, L = A - B; // loop 40000-70000 crosses the boundary at 50000
        OfflineRun lp; lp.load(songWith(two), sr, 4, 97); lp.e.setLoop(B, A); lp.start(0);
        const int64_t total = A + 4 * L;
        while ((int64_t) lp.out[0].size() < total) lp.step();
        bool loopOk = lp.e.stats.underruns.load() == 0;
        for (int64_t i = 0; i < total && loopOk; ++i) loopOk = lp.out[0][(size_t) i] == expectAt(two, i < A ? i : B + (i - A) % L);
        check(loopOk && lp.e.stats.jumps.load() >= 4, "clips: a loop across a clip boundary is sample-exact on every pass (" + std::to_string(lp.e.stats.jumps.load()) + " passes)");
    }

    // ---- Step 2: spoken cues (preloaded one-shots on their bar) ----
    {
        // Cue audio with every sample different and non-zero (0.3 s), so its first sample and any offset show.
        auto cueAudio = [&](float base) {
            auto v = std::make_shared<std::vector<float>>((size_t) (0.3 * sr));
            for (size_t i = 0; i < v->size(); ++i) (*v)[i] = base + 0.2f * (float) std::fmod((double) i * 0.6180339887, 1.0) + 0.01f;
            return std::shared_ptr<const std::vector<float>>(v);
        };
        SongDef s; s.name = "Cues"; s.tempo = { { 1, 120, 4, 4 }, { 4, 97, 0, 0 } }; s.lengthBars = 8;
        s.cueOuts = { 1 };
        CueDef c1; c1.bar = 3; c1.audio = cueAudio(0.3f); c1.text = "Verse";
        CueDef c2; c2.bar = 5; c2.beat = 2.5; c2.audio = cueAudio(-0.6f); c2.text = "Chorus";
        s.cues = { c1, c2 };
        auto expectCue = [&](const OfflineRun& r, int64_t t) { // what the cue output should hold at song sample t
            float v = 0;
            for (auto& c : r.e.cueList()) if (t >= c.sample && t < c.sample + (int64_t) c.audio->size()) v += (*c.audio)[(size_t) (t - c.sample)];
            return v;
        };
        bool onBar = true, exact = true;
        for (int blk : { 128, 97, 33, 1024 }) {
            OfflineRun r; r.load(s, sr, 4, blk); r.start(0); r.runToEnd();
            const int64_t b3 = r.e.tempoMap().sampleAt(3, 1), b5 = r.e.tempoMap().sampleAt(5, 2.5);
            onBar &= r.e.cueList().size() == 2 && r.e.cueList()[0].sample == b3 && r.e.cueList()[1].sample == b5
                  && r.at(1, b3 - 1) == 0.0f && r.at(1, b3) == (*c1.audio)[0] && r.at(1, b5 - 1) == 0.0f && r.at(1, b5) == (*c2.audio)[0];
            for (int64_t t = 0; t < r.e.lengthSamples() && exact; ++t) exact = r.at(1, t) == expectCue(r, t) && r.at(0, t) == 0.0f;
        }
        check(onBar, "cues: each cue starts on its bar's exact sample (bar 3, and bar 5 beat 2.5 after a tempo change; blocks 128/97/33/1024)");
        check(exact, "cues: every cue sample is exact, only on the Cues output, silence elsewhere");

        // starting in the middle of a cue, a loop across a cue, a jump onto a cue
        OfflineRun full; full.load(s, sr, 4, 97); full.start(0); full.runToEnd();
        const int64_t b3 = full.e.tempoMap().sampleAt(3, 1);
        OfflineRun mid; mid.load(s, sr, 4, 97);
        bool midOk = mid.start(b3 + 1000); mid.runToEnd();
        for (int64_t t = b3 + 1000; t < b3 + 20000 && midOk; ++t) midOk = mid.at(1, t) == full.at(1, t);
        check(midOk, "cues: starting inside a cue plays the rest of it from the exact sample");
        const int64_t B = full.e.tempoMap().sampleAt(2, 1), A = full.e.tempoMap().sampleAt(4, 1), L = A - B; // bars 2-3
        OfflineRun lp; lp.load(s, sr, 4, 97); lp.e.setLoop(B, A); lp.start(0);
        while ((int64_t) lp.out[1].size() < A + 3 * L) lp.step();
        bool loopOk = true;
        for (int64_t i = 0; i < A + 3 * L && loopOk; ++i) loopOk = lp.out[1][(size_t) i] == full.at(1, i < A ? i : B + (i - A) % L);
        check(loopOk, "cues: a loop over the cue's bar plays it from its first sample on every pass");
        OfflineRun jp; jp.load(s, sr, 4, 97); jp.start(0);
        jp.e.setJump(full.e.tempoMap().sampleAt(2, 1), b3 + 500, false);
        while ((int64_t) jp.out[1].size() < B + 20000) jp.step();
        bool jumpOk = true;
        for (int64_t i = B; i < B + 20000 && jumpOk; ++i) jumpOk = jp.out[1][(size_t) i] == full.at(1, b3 + 500 + (i - B));
        check(jumpOk, "cues: a jump into a cue plays it from the exact sample");

        // live level: the Cues track muted -> silent
        OfflineRun mu; mu.load(s, sr, 4, 128); mu.e.setTrackLevel(Engine::CueTrack, 0, true); mu.start(0); mu.runToEnd();
        bool muted = true;
        for (auto x : mu.out[1]) muted &= x == 0.0f;
        check(muted, "cues: muting the Cues track silences them");
    }

    // ---- Step 2: everything together. Click hits, MIDI, audio clips and cues all come from the same tempo
    // map and rounding rule: every one of them must land on the same sample, from the top, from a start
    // or jump anywhere, and on every pass of a loop, at any block size.
    {
        SongDef s; s.name = "Together";
        s.tempo = { { 1, 120, 4, 4 }, { 5, 97, 7, 8 }, { 7, 133.7, 3, 4 } }; // tempo and meter changes
        s.lengthBars = 12;
        TempoMap tm; tm.build(s.tempo, sr, 0, 14);
        // a stem: digital silence except a run of 0.5 starting at every clip's start; one clip per bar 2..11
        const int64_t fileLen = tm.sampleAt(13, 1);
        auto src = std::make_shared<InMemorySource>(); src->sr = sr; src->data.assign(1, std::vector<float>((size_t) fileLen, 0.0f));
        std::vector<ClipDef> clips;
        for (int b = 2; b <= 11; ++b) {
            const int64_t at = tm.sampleAt(b, 1);
            for (int64_t i = at; i < at + 200; ++i) src->data[0][(size_t) i] = 0.5f;
            clips.push_back({ at, tm.sampleAt(b + 1, 1), at, 0, 0, 0, false }); // each bar its own clip, file offset = timeline
        }
        StemDef st; st.name = "Stem"; st.source = src; st.outs = { 0 }; st.clips = clips;
        s.stems.push_back(st);
        s.clickOuts = { 1 };
        std::vector<ClickHitDef> hits;
        for (int b = 2; b <= 11; ++b) hits.push_back({ b, 1, true, 0 });
        s.clickHits = hits;
        auto cueA = std::make_shared<std::vector<float>>((size_t) 2000, 0.4f);
        s.cueOuts = { 2 };
        for (int b = 2; b <= 11; ++b) { CueDef c; c.bar = b; c.audio = cueA; c.text = "Bar"; s.cues.push_back(c); }
        for (int b = 2; b <= 11; ++b) { MidiEventDef m; m.port = 0; m.bar = b; m.beat = 1; m.bytes[0] = 0x90; m.bytes[1] = 60; m.bytes[2] = 100; m.len = 3; m.label = "probe"; s.midi.push_back(m); }

        // What a run heard: per bar downbeat (as a song sample), did stem, click and cue start exactly there,
        // and did MIDI fire exactly there?
        auto bars = [&](const OfflineRun& r, int64_t fromStream, int64_t toStream, const std::function<int64_t(int64_t)>& songAt) {
            int good = 0, seen = 0;
            for (int64_t i = std::max<int64_t>(fromStream, 1); i < toStream; ++i) {
                const int64_t t = songAt(i);
                bool isDown = false;
                for (int b = 2; b <= 11; ++b) isDown |= tm.sampleAt(b, 1) == t;
                if (! isDown) continue;
                ++seen;
                const bool stem = r.out[0][(size_t) i] == 0.5f && r.out[0][(size_t) i - 1] == 0.0f;
                const bool click = std::fabs(r.out[1][(size_t) i]) > 0.05f && r.out[1][(size_t) i - 1] == 0.0f;
                const bool cue = r.out[2][(size_t) i] == 0.4f && r.out[2][(size_t) i - 1] == 0.0f;
                if (stem && click && cue) ++good;
            }
            return std::pair<int, int>(good, seen);
        };
        bool topOk = true; std::string topWhy;
        for (int blk : { 128, 97, 33, 1024, 2048 }) {
            OfflineRun r; r.load(s, sr, 4, blk); r.start(0); r.runToEnd();
            const auto [g, n] = bars(r, 0, (int64_t) r.out[0].size(), [](int64_t i) { return i; });
            int midiOk = 0;
            for (auto& x : r.e.midiLog) for (int b = 2; b <= 11; ++b) midiOk += x.sample == tm.sampleAt(b, 1);
            if (! (n == 10 && g == 10 && midiOk == 10 && (int) r.e.midiLog.size() == 10 && r.e.stats.underruns.load() == 0)) {
                topOk = false; topWhy += " block " + std::to_string(blk) + ": " + std::to_string(g) + "/" + std::to_string(n) + " bars, MIDI " + std::to_string(midiOk);
            }
        }
        check(topOk, "together: stem clip, click, cue and MIDI start on the same sample at all 10 downbeats (tempo + meter changes; blocks 128/97/33/1024/2048)" + topWhy);

        // From a start mid-song and from a jump
        OfflineRun st5; st5.load(s, sr, 4, 97);
        const int64_t b5 = tm.sampleAt(5, 1);
        bool fromOk = st5.start(b5); st5.runToEnd();
        {
            const auto [g, n] = bars(st5, 0, (int64_t) st5.out[0].size(), [&](int64_t i) { return st5.firstSample + i; });
            int midiOk = 0; for (auto& x : st5.e.midiLog) for (int b = 5; b <= 11; ++b) midiOk += x.sample == tm.sampleAt(b, 1);
            fromOk &= n == 7 && g == 7 && midiOk == 7 && st5.e.midiLog.size() == 7;
        }
        OfflineRun jp; jp.load(s, sr, 4, 97); jp.start(0);
        const int64_t at = tm.sampleAt(3, 2.5), to = tm.sampleAt(8, 1) - 1; // lands one sample before bar 8's downbeat
        jp.e.setJump(at, to, false);
        jp.runToEnd();
        {
            const auto [g, n] = bars(jp, at + 1, (int64_t) jp.out[0].size(), [&](int64_t i) { return to + (i - at); });
            fromOk &= n == 4 && g == 4 && jp.e.stats.jumps.load() == 1; // bars 8..11 after the jump
            int midiAfter = 0; for (auto& x : jp.e.midiLog) for (int b = 8; b <= 11; ++b) midiAfter += x.sample == tm.sampleAt(b, 1);
            fromOk &= midiAfter == 4;
        }
        check(fromOk, "together: from a start at bar 5 and after a jump (bar 3 beat 2.5 -> just before bar 8) everything still lands on each downbeat");

        // Across a loop (bars 5-6: a 7/8 bar at 97 BPM and the next), several passes
        const int64_t B = tm.sampleAt(5, 1), A = tm.sampleAt(7, 1), L = A - B;
        OfflineRun lp; lp.load(s, sr, 4, 97); lp.e.setLoop(B, A); lp.start(0);
        while ((int64_t) lp.out[0].size() < A + 4 * L + 10) lp.step();
        const auto [g, n] = bars(lp, A, A + 4 * L, [&](int64_t i) { return B + (i - A) % L; });
        int midiPass = 0; for (auto& x : lp.e.midiLog) if (x.sample == B || x.sample == tm.sampleAt(6, 1)) ++midiPass;
        check(n == 8 && g == 8 && midiPass >= 2 + 8 && lp.e.stats.underruns.load() == 0,
              "together: a loop over bars 5-6 keeps stem, click, cue and MIDI on the downbeats on every pass (" + std::to_string(g) + "/" + std::to_string(n) + ")");
    }

    // ---- Phase 6b: two click tracks ("Click (band)" on output 1, "Click (drums)" on output 2), each with its own
    // hits and level, both sample-exact across a meter change, at any block size, from a start mid-song.
    {
        SongDef s; s.name = "Two clicks";
        s.tempo = { { 1, 120, 4, 4 }, { 3, 97, 7, 8 } };
        s.lengthBars = 5;
        TempoMap tm; tm.build(s.tempo, sr, 0, 7);
        std::vector<ClickHitDef> band, drums;
        for (int b = 1; b <= 5; ++b) band.push_back({ b, 1, true, 0 });                           // downbeats
        for (int b = 1; b <= 5; ++b) for (double bt : { 1.5, 2.5, 3.5 }) drums.push_back({ b, bt, false, 0 }); // off-beats
        s.clickOuts = { 0 };
        s.clickHits = band;
        ClickTrackDef d; d.name = "Click (drums)"; d.outs = { 1 }; d.gainDb = -12; d.hits = drums;
        s.moreClicks.push_back(d);
        auto onsets = [](const std::vector<float>& x, int64_t first) {
            std::vector<int64_t> v;
            for (size_t i = 0; i < x.size(); ++i) if (x[i] != 0.0f && (i == 0 || x[i - 1] == 0.0f)) v.push_back(first + (int64_t) i);
            return v;
        };
        std::vector<int64_t> wantBand, wantDrums;
        for (auto& h : band) wantBand.push_back(tm.sampleAt(h.bar, h.beat));
        for (auto& h : drums) wantDrums.push_back(tm.sampleAt(h.bar, h.beat));
        bool exact = true; std::string why;
        float peakBand = 0, peakDrums = 0;
        for (int blk : { 128, 97, 33, 1024 }) {
            OfflineRun r; r.load(s, sr, 2, blk); r.start(0); r.runToEnd();
            const auto a = onsets(r.out[0], 0), b = onsets(r.out[1], 0);
            if (a != wantBand || b != wantDrums || r.e.numClickTracks() != 2) { exact = false; why += " block " + std::to_string(blk) + ": " + std::to_string(a.size()) + "/" + std::to_string(b.size()) + " onsets"; }
            for (float x : r.out[0]) peakBand = std::max(peakBand, std::fabs(x));
            for (float x : r.out[1]) peakDrums = std::max(peakDrums, std::fabs(x));
        }
        check(exact, "two click tracks: each plays only its own hits on its own output, sample-exact across a meter change (blocks 128/97/33/1024)" + why);
        // per-track level: drums are 6 dB below the band's -6 and unaccented (x0.6)
        check(std::fabs(peakDrums / peakBand - 0.5012f * 0.6f) < 0.01f, "two click tracks: each at its own level (" + std::to_string(peakDrums / peakBand) + ")");
        // from a start mid-song, and muting one track leaves the other untouched
        OfflineRun m; m.load(s, sr, 2, 97);
        m.e.setTrackLevel(Engine::clickTrackId(1), 0, true);
        const int64_t from = tm.sampleAt(3, 2);
        m.start(from); m.runToEnd();
        std::vector<int64_t> bandFrom; for (auto x : wantBand) if (x >= from) bandFrom.push_back(x);
        bool silent = true; for (float x : m.out[1]) if (x != 0.0f) silent = false;
        check(onsets(m.out[0], m.firstSample) == bandFrom && silent, "two click tracks: from bar 3 beat 2 the band click is still exact while the muted drums click is silent");
    }

    // ---- Phase 6b: count-in cues on beats and between them ("1, 2, 3, 4" before bar 3 in 4/4; 8ths "1 & 2 &";
    // every eighth-beat of a 7/8 bar): each starts on its beat's exact sample, at any block size, also from mid-song.
    {
        SongDef s; s.name = "Count-in";
        s.tempo = { { 1, 120, 4, 4 }, { 4, 97, 7, 8 } };
        s.lengthBars = 6;
        TempoMap tm; tm.build(s.tempo, sr, 0, 8);
        s.cueOuts = { 0 };
        auto a = std::make_shared<std::vector<float>>((size_t) 2000, 0.3f);
        std::vector<std::pair<int, double>> at;
        for (double b : { 1.0, 2.0, 3.0, 4.0 }) at.push_back({ 2, b });              // 1, 2, 3, 4 into bar 3
        for (double b : { 1.0, 1.5, 2.0, 2.5, 3.0, 3.5 }) at.push_back({ 3, b });    // 8ths
        for (double b : { 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0 }) at.push_back({ 4, b }); // every beat of 7/8 (an 8th)
        for (auto& [bar, beat] : at) { CueDef c; c.bar = bar; c.beat = beat; c.audio = a; c.text = "count"; s.cues.push_back(c); }
        std::vector<int64_t> want;
        for (auto& [bar, beat] : at) want.push_back(tm.sampleAt(bar, beat));
        auto onsets = [](const std::vector<float>& x, int64_t first) {
            std::vector<int64_t> v;
            for (size_t i = 0; i < x.size(); ++i) if (x[i] != 0.0f && (i == 0 || x[i - 1] == 0.0f)) v.push_back(first + (int64_t) i);
            return v;
        };
        bool exact = true; std::string why;
        for (int blk : { 128, 97, 33, 1024 }) {
            OfflineRun r; r.load(s, sr, 1, blk); r.start(0); r.runToEnd();
            if (onsets(r.out[0], 0) != want) { exact = false; why += " block " + std::to_string(blk); }
        }
        OfflineRun m; m.load(s, sr, 1, 97);
        const int64_t from = tm.sampleAt(3, 1.75);
        m.start(from); m.runToEnd();
        std::vector<int64_t> rest; for (auto x : want) if (x >= from) rest.push_back(x);
        const auto got = onsets(m.out[0], m.firstSample);
        check(exact && got == rest, "count-in cues on beats, 8ths and 7/8 beats start on their exact samples (blocks 128/97/33/1024, and from bar 3 beat 1.75)" + why);
    }

    // ---- Listen on this computer: the cues' fixed level (-3 dB when folded to the centre of a stereo pair)
    {
        SongDef s; s.name = "Cue level"; s.tempo = { { 1, 120, 4, 4 } }; s.lengthBars = 3;
        auto a = std::make_shared<std::vector<float>>((size_t) 4000, 0.5f);
        CueDef c; c.bar = 2; c.audio = a; c.text = "x"; s.cues.push_back(c);
        s.cueOuts = { 0, 1 };
        s.cueGainDb = -3.0103f;
        OfflineRun r; r.load(s, sr, 2, 128); r.start(0); r.runToEnd();
        float peak0 = 0, peak1 = 0;
        for (float x : r.out[0]) peak0 = std::max(peak0, std::fabs(x));
        for (float x : r.out[1]) peak1 = std::max(peak1, std::fabs(x));
        const float want = 0.5f * std::pow(10.0f, -3.0103f / 20.0f);
        check(std::fabs(peak0 - want) < 1e-5f && std::fabs(peak1 - want) < 1e-5f, "cue level: a cue at -3 dB plays at exactly 0.7071 of its level on both sides");
    }

    std::printf(ok ? "ALL CHECKS PASSED\n" : "SOME CHECKS FAILED\n");
    return ok;
}

} // namespace setline
