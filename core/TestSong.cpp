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

    std::printf(ok ? "ALL CHECKS PASSED\n" : "SOME CHECKS FAILED\n");
    return ok;
}

} // namespace setline
