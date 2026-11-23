// set.Line engine spike — the playback core.
// process() is the audio callback body: real-time safe (no locks, no allocation, no file I/O).
#pragma once
#include "MidiScheduler.h"
#include "Song.h"
#include "StemStreamer.h"
#include "TempoMap.h"
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace setline {

class Engine {
public:
    struct Config {
        double sampleRate = 48000;
        int numOutputs = 2;
        bool offline = false;      // render/selftest: no device, no threads, disk reads done inline
        double midiOffsetMs = 0;   // user calibration from the loopback test (+ = later)
        int ringFrames = 1 << 17;  // ~2.7 s per stem at 48 kHz
        int chunkFrames = 8192;
    };

    struct Stats {
        std::atomic<int64_t> callbacks { 0 }, underruns { 0 }, cbMaxUs { 0 }, cbOverBudget { 0 };
    };

    struct LoggedMidi { int64_t sample; int port; uint8_t d[3]; int len; };

    Engine();
    ~Engine();

    // Prepares everything (opens streamers, builds the tempo map, click and MIDI lists).
    // Returns an empty string on success, otherwise a readable error.
    std::string load(const SongDef& song, const Config& cfg, std::vector<std::string>& warnings);

    // Device info, called when the device starts (used to time MIDI to the audio output).
    void setDeviceTiming(int bufferSamples, int outputLatencySamples);
    void setDeviceRunning(bool b) { deviceRunning.store(b); }
    void setMidiSink(MidiSink* s);

    // Transport (non-audio threads).
    bool start(int timeoutMs = 5000); // locate to 0, preroll every stem, then play
    void stop();
    bool isPlaying() const { return playing.load(std::memory_order_acquire); }
    bool takeFinished() { return finished.exchange(false); }

    // Audio callback body.
    void process(float* const* outs, int numOuts, int numFrames);

    // Read-only info
    const TempoMap& tempoMap() const { return tmap; }
    int64_t position() const { return pos.load(std::memory_order_relaxed); }
    int64_t lengthSamples() const { return songLen; }
    double sampleRate() const { return cfg.sampleRate; }
    int requiredOutputs() const { return maxOut + 1; }
    Stats stats;
    MidiScheduler midi;
    std::vector<LoggedMidi> midiLog; // offline mode only (pre-reserved)
    struct ClickHit { int64_t sample; bool accent; };
    struct MidiAt { int64_t sample; int port; uint8_t d[3]; int len; };
    const std::vector<ClickHit>& clickList() const { return clicks; }
    const std::vector<MidiAt>& midiList() const { return midiEvents; }

private:
    void diskLoop();
    void waitForCallbackToFinish();

    Config cfg;
    TempoMap tmap;
    std::vector<std::unique_ptr<StemStreamer>> stems;
    std::vector<ClickHit> clicks;
    std::vector<MidiAt> midiEvents;
    std::vector<int> clickOuts;
    float clickGain = 0.5f;
    int64_t songLen = 0;
    int maxOut = 1;

    // audio-thread state
    std::atomic<int64_t> pos { 0 };
    size_t nextClick = 0, nextMidi = 0;
    struct Voice { int remaining = 0; double phase = 0, inc = 0, env = 0, decay = 0; float amp = 0; } voice;

    std::atomic<bool> playing { false }, finished { false }, deviceRunning { false };
    std::atomic<int64_t> serial { 0 };
    std::atomic<int> latencyBase { 0 };

    std::mutex control;
    std::thread disk;
    std::atomic<bool> diskRun { false };
    MidiSink* sink = nullptr;
};

} // namespace setline
