// set.Line engine spike — the playback core.
// process() is the audio callback body: real-time safe (no locks, no allocation, no file I/O).
//
// Two song slots (6e): the song playing, and the next one, loaded and primed from its start in the background (the
// setlist's next song, in the version it plays). At the end of a song with Segue armed, the next one starts on the very
// next sample, inside the same audio callback (no gap, no overlap). Next while playing fades the current song out
// (10 ms) and starts the next one at once; Play on a song that's waiting in the next slot starts without loading.
#pragma once
#include "LiveGain.h"
#include "MidiScheduler.h"
#include <array>
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
        std::atomic<int64_t> callbacks { 0 }, underruns { 0 }, cbMaxUs { 0 }, cbOverBudget { 0 }, jumps { 0 };
    };

    struct LoggedMidi { int64_t sample; int port; uint8_t d[3]; int len; };

    Engine();
    ~Engine();

    // Prepares everything (opens streamers, builds the tempo map, click and MIDI lists) as the song to play.
    // Returns an empty string on success, otherwise a readable error.
    std::string load(const SongDef& song, const Config& cfg, std::vector<std::string>& warnings);

    // ---- the next song (6e) ----
    // Loads `song` into the next slot and primes it from its start in the background; also while playing (the song
    // playing is never touched). Uses the Config of the last load(). Empty = fine, else why not.
    std::string prepareNext(const SongDef& song, std::vector<std::string>& warnings);
    void clearNext();
    bool hasNext() const { return nextLoaded.load(std::memory_order_acquire); }
    bool nextReady() const;                       // loaded and every stem primed from its start
    std::string nextName() const;
    // Segue: when the song playing ends, the next one continues on the next sample (it must be ready by then; if it
    // isn't, playback stops as at any other end).
    void setSegue(bool on) { segueArmed.store(on, std::memory_order_release); }
    bool segueOn() const { return segueArmed.load(std::memory_order_acquire); }
    // Stopped: the next song becomes the one to play (instant, it's primed). Returns false if there is none.
    bool promoteNext();
    // Playing: fade the current song out (10 ms), then play the next one from its start. False if there's none ready.
    bool switchToNext(int timeoutMs = 3000);
    // How many automatic hand-overs (segues) have happened; the app notices a change.
    uint64_t segues() const { return segueCount.load(std::memory_order_acquire); }

    // Device info, called when the device starts (used to time MIDI to the audio output).
    void setDeviceTiming(int bufferSamples, int outputLatencySamples);
    void setDeviceRunning(bool b) { deviceRunning.store(b); }
    void setMidiSink(MidiSink* s);

    // Transport (non-audio threads).
    // Starts playing from any sample: seeks every stem, skips click and MIDI events before that point,
    // and plays them sample-exact from there. A start inside the song fades the stems in over the
    // 5 ms *before* fromSample, so the audio is at full level exactly on fromSample.
    // Returns false if the disk couldn't preroll in time or fromSample is past the end.
    bool start(int64_t fromSample = 0, int timeoutMs = 5000);
    // Fades every output out over 10 ms, then stops (immediately in offline mode).
    void stop();
    // Non-blocking stop: the audio thread fades out and stops by itself (also usable offline).
    void requestStop() { if (playing.load()) stopReq.store(true, std::memory_order_release); }
    bool isPlaying() const { return playing.load(std::memory_order_acquire); }

    // Loops and jumps (control thread, also while playing): when playback reaches sample `at` it continues
    // from sample `to`, exactly on that sample inside the audio callback. repeat = a loop (every pass),
    // otherwise once. Stems are prepared in the background, so arm a jump some time before it's due.
    struct Jump { int64_t at = -1, to = -1; bool repeat = false; };
    void setJump(int64_t at, int64_t to, bool repeat);
    void setLoop(int64_t start, int64_t end) { setJump(end, start, true); }
    void clearJump();
    Jump currentJump() const { return ctlJump; }

    // Live levels (any thread, glitch-free: ramped over 10 ms in the callback).
    // track: 0..numStems()-1 for stems, or ClickTrack / CueTrack. next: the song in the next slot.
    static constexpr int ClickTrack = -1, CueTrack = -2;
    // Click track k (0 = the main click, 1.. = SongDef::moreClicks[k-1]) for setTrackLevel.
    static constexpr int clickTrackId(int k) { return k == 0 ? ClickTrack : -100 - k; }
    // MIDI track k (MidiEventDef::track) for setTrackLevel: only its mute counts (a muted MIDI track sends nothing).
    static constexpr int midiTrackId(int k) { return -200 - k; }
    static constexpr int MaxMidiTracks = 64;
    void setTrackLevel(int track, float db, bool mute, bool next = false);
    int numStems() const { return (int) cur().stems.size(); }

    // Output meters: the peak of each device output since the last call (audio thread writes, UI reads).
    static constexpr int MaxMeters = 64;
    float takeOutputPeak(int output) { return output >= 0 && output < MaxMeters ? meters[(size_t) output].exchange(0.0f, std::memory_order_relaxed) : 0.0f; }
    // Track meters: the peak of one track after its fader (an engine track id as for setTrackLevel), since the last call.
    static constexpr int MaxTrackMeters = 128;
    static int meterSlot(int track) { return track >= 0 ? (track < 96 ? track : -1) : track == CueTrack ? 120 : track == ClickTrack ? 96 : (track <= -101 && track > -124) ? 96 + (-100 - track) : -1; }
    float takeTrackPeak(int track) { const int k = meterSlot(track); return k >= 0 ? trackMeters[(size_t) k].exchange(0.0f, std::memory_order_relaxed) : 0.0f; }
    bool takeFinished() { return finished.exchange(false); }

    // Audio callback body.
    void process(float* const* outs, int numOuts, int numFrames);

    // Read-only info (the song playing)
    const TempoMap& tempoMap() const { return cur().tmap; }
    int64_t position() const { return pos.load(std::memory_order_relaxed); }
    int64_t lengthSamples() const { return cur().songLen; }
    const std::string& songName() const { return cur().name; }
    double sampleRate() const { return cfg.sampleRate; }
    int requiredOutputs() const { return cur().maxOut + 1; }
    Stats stats;
    MidiScheduler midi;
    std::vector<LoggedMidi> midiLog; // offline mode only (pre-reserved)
    struct ClickHit { int64_t sample; bool accent; float gain = 1; };
    struct MidiAt { int64_t sample; int port; uint8_t d[3]; int len; int track = -1; };
    const std::vector<ClickHit>& clickList(int k = 0) const { static const std::vector<ClickHit> none; return k < (int) cur().clickLanes.size() ? cur().clickLanes[(size_t) k].hits : none; }
    int numClickTracks() const { return (int) cur().clickLanes.size(); }
    const std::vector<MidiAt>& midiList() const { return cur().midiEvents; }
    struct CueAt { int64_t sample; std::shared_ptr<const std::vector<float>> audio; };
    const std::vector<CueAt>& cueList() const { return cur().cues; }

private:
    struct Voice { int remaining = 0; double phase = 0, inc = 0, env = 0, decay = 0; float amp = 0; };
    // Click tracks: [0] the main click, then SongDef::moreClicks. Built in load, never resized while playing;
    // next / voice are audio-thread state.
    struct ClickLane { std::vector<ClickHit> hits; std::vector<int> outs; float gain = 0.5f; size_t next = 0; Voice voice; };
    // Everything about one song: what load / prepareNext build, what the audio thread plays.
    struct Program {
        std::string name;
        TempoMap tmap;
        std::vector<std::unique_ptr<StemStreamer>> stems;
        std::unique_ptr<LiveGain[]> stemGains;
        std::vector<MidiAt> midiEvents;
        std::vector<CueAt> cues;   // sorted by sample; audio preloaded (never rendered during playback)
        std::vector<int> cueOuts;
        int64_t longestCue = 0;
        LiveGain cueLive;
        float cueGain = 1.0f;
        std::vector<ClickLane> clickLanes;
        std::unique_ptr<LiveGain[]> clickLives;
        std::array<std::atomic<bool>, MaxMidiTracks> midiMuted {};
        int64_t songLen = 0;
        int maxOut = 1;
        bool primed() const { for (auto& s : stems) if (! s->primed()) return false; return true; }
    };
    std::string build(Program& P, const SongDef& song, std::vector<std::string>& warnings);
    Program& cur() const { return *progs[(size_t) curIdx.load(std::memory_order_acquire)]; }
    Program* other() const { return progs[(size_t) (1 - curIdx.load(std::memory_order_acquire))].get(); }

    void diskLoop();
    void ensureDisk();
    void waitForCallbackToFinish();
    void fadeOutAndStop(); // control lock held
    void publishJump();
    void armStems();
    void seekClicks(Program& P, int64_t p); // audio thread (or idle)
    void handOver(int64_t& p);              // audio thread: the next song takes over at its sample 0
    void renderSegment(Program& P, float* const* outs, int numOuts, int off, int count, int64_t p, Clock::time_point t0);
    void meterTrack(int slot, float pk) { if (slot >= 0 && slot < MaxTrackMeters && pk > trackMeters[(size_t) slot].load(std::memory_order_relaxed)) trackMeters[(size_t) slot].store(pk, std::memory_order_relaxed); }

    Config cfg;
    std::unique_ptr<Program> progs[2];
    std::atomic<int> curIdx { 0 };
    std::atomic<bool> nextLoaded { false }, segueArmed { false }, nextFresh { false };
    std::atomic<uint64_t> segueCount { 0 };
    std::array<std::atomic<float>, MaxMeters> meters {};
    std::array<std::atomic<float>, MaxTrackMeters> trackMeters {};
    int rampSamples = 480, fadeOutSamples = 480;

    // audio-thread state
    std::atomic<int64_t> pos { 0 };
    size_t nextMidi = 0;
    int fadeInLeft = 0, fadeInLen = 0, fadeOutLeft = 0;

    // jump / loop: the control side publishes {at, to, repeat} under a sequence number; the audio
    // thread copies it when the sequence is even (complete) and new.
    Jump ctlJump;
    std::atomic<uint64_t> jumpSeq { 0 };
    std::atomic<int64_t> jAt { -1 }, jTo { -1 };
    std::atomic<bool> jRepeat { false };
    Jump rtJump; uint64_t rtSeq = 0, rtDoneSeq = ~0ull; // audio thread

    std::atomic<bool> playing { false }, finished { false }, deviceRunning { false }, stopReq { false };
    std::atomic<int64_t> serial { 0 };
    std::atomic<int> latencyBase { 0 };

    std::mutex control;
    std::mutex diskMx;  // the disk thread fills both slots; a slot is only replaced while holding this
    std::thread disk;
    std::atomic<bool> diskRun { false };
    MidiSink* sink = nullptr;
};

} // namespace setline
