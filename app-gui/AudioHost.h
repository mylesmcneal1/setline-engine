// set.Line desktop app: the audio device, the engine and the MIDI outputs.
// All public functions are called on the message thread.
#pragma once
#include <mutex>
#include <juce_audio_devices/juce_audio_devices.h>
#include "../core/MidiMap.h"
#include <juce_data_structures/juce_data_structures.h>
#include "../core/Engine.h"
#include "SongMapper.h"
#include <array>
#include <atomic>
#include <functional>
#include <map>

namespace setline::gui {

class AudioHost : private juce::ChangeListener, private juce::AudioIODeviceCallback, private juce::Timer {
public:
    // 9d: a silent break: the MIDI clock stops until the next song starts
    void holdClock(bool on) { if (clockHeld != on) { clockHeld = on; refreshClock(); } }
    explicit AudioHost(juce::PropertiesFile& settings);
    ~AudioHost() override;

    // Opens the saved device, or the best available one on first launch.
    void start();
    // Start-up (loading window): the saved interface couldn't be opened (unplugged...). Its name ("iD14 (ASIO)") and
    // why; empty when it opened. retrySaved: try it again ("" = open now). closeDevice: "Open without audio".
    juce::String savedDeviceLabel() const { return savedLabel; }
    juce::String savedDeviceProblem() const { return savedProblem; }
    // 7a: the saved interface wasn't there at launch, so set.Line plays on this computer ("<interface>"), and goes
    // back to it by itself when it's plugged in while stopped (emit "interfaceBack"). Empty: not falling back.
    juce::String fallbackFrom() const { return autoFrom; }
    juce::String retrySaved();
    void closeDevice();
    // "iD14 · ASIO · 48 kHz · 128" for the open device, or "" if none.
    juce::String deviceSummary();

    // ---- Glue (6c item 7) ----
    // One track's audio from sample a to b exactly as the engine plays it: its clips with their gains and fades,
    // silence between them (not the track's fader, mute or routing), one channel per file channel, at the show
    // rate. Rendered from the song's start, so nothing about starting mid-song (preroll) touches it.
    std::vector<std::vector<float>> bakeTrack(const juce::var& payload, const juce::String& track, int64_t a, int64_t b, int channels, juce::String& err);
    double showRate() const { const double r = sampleRate(); return r > 0 ? r : 48000.0; } // what offline renders use

    // ---- "Listen on this computer" (stored per computer, never in the show) ----
    // The show's routing never changes. Instead of the show's interface, the computer's own output plays:
    //  - everything: every routed track folded to stereo (stereo stays stereo, mono centred at -3 dB),
    //    with all faders, mutes and solos;
    //  - one show output (or pair): exactly what that output gets, on both / left-right.
    // Click and Cues can be left out, MIDI can be held back. Never resampled: the device must run at the
    // show's rate (setListen says so and lists the devices that can).
    // {on, driver, device, rate, mode: "everything" | "output", output: [1-based], click, cues, midi}
    // -> the state ({on, driver, device, mode, output, click, cues, midi, summary}) or {error, devices}
    juce::var setListen(const juce::var& req);
    juce::var listenState() const;
    // The computer's output devices (not ASIO) and whether each runs at rate: [{driver, device, rate ok}]
    juce::var listenDevices(double rate);
    bool listening() const { return listen.on; }

    // ---- audio setup ----
    // {drivers:[{name, devices:[...]}], current:{driver, device, rate, buffer, rates, buffers, outputs, ...}, error}
    juce::var getSetup(bool rescan = false);
    // req: {driver, device, rate, buffer}; missing fields keep their current value.
    // Returns the new state, with "error" set if the device couldn't be opened as asked.
    juce::var setSetup(const juce::var& req);
    juce::var midiOutputs() const;
    // 6g: every MIDI output with its clock settings (this computer): [{name, open, connected, clock, transport}]
    juce::var midiPorts();
    // Clock on/off and "Send Start/Stop/Continue + Song Position" for one port (by name).
    void setMidiPort(const juce::String& name, bool clock, bool transport);
    // Sends raw MIDI now (the setlist's sync point): msgs = [[status, d1, d2], ...]. -> {sent} | {error}
    juce::var sendMidiNow(const juce::String& port, const juce::var& msgs);
    // A MIDI output that came back (unplugged and plugged in again): names, reported to the page.
    std::function<void(const juce::StringArray&)> onMidiReconnected;
    void setEchoGuard(EchoGuard* e) { midiOuts.echo.store(e); } // 7c
    // ---- 7d: backup rig ----
    std::function<int()> rigDelayMs;            // primary: start this much ahead (so the backup hits the same moment)
    std::function<void()> onTransportChange;    // primary: tell the backup now
    std::function<void(int64_t, int64_t)> onJumpQueued; // primary: (at, to) samples
    void setRigMute(bool on, const juce::StringArray& alsoSends);
    juce::var rigStart(int64_t from, double atHostMs); // backup: play from `from` so it leaves at atHostMs
    juce::var rigJump(int64_t at, int64_t to);         // backup: the primary's jump (same song, same samples)
    juce::var rigJumpAtHost(double atHostMs, int64_t to); // backup: re-align
    int64_t rigSampleAt(double atHostMs);              // the sample leaving at atHostMs (playing)
    juce::var rigStop() { eng.stop(); if (emit) emit("transport", transportState()); return transportState(); }

    // ---- songs and transport ----
    // payload: see SongMapper.h. Returns {ok, warnings, seconds, epoch} or {error}.
    juce::var loadSong(const juce::var& payload);
    // req: {cmd: "play" | "stop", fromBar, fromBeat}. Returns the transport state or {error, code}.
    juce::var transport(const juce::var& req);
    // req: {track, db, mute, solo}: live, glitch-free.
    juce::var setTrackLevel(const juce::var& req);
    // req: {fromBar, fromBeat, toBar, toBeat} loops that range inside the engine (sample-exact); null/{} clears it.
    juce::var setLoop(const juce::var& req);
    // ---- the next song (6e) ----
    // payload as loadSong: maps it and loads it into the engine's next slot, primed from its start in the background
    // (the song playing isn't touched). -> {ok, warnings} or {error}.
    juce::var queueNext(const juce::var& payload);
    juce::var updateClicks(const juce::var& payload); // 7a: click edits while playing
    // {loaded, ready, songId, name, segue}
    juce::var nextState();
    // A queued jump (Perform: tap a section while playing): {toBar, toBeat, when: "bar" | "section" | "beat", atBar}
    // jumps to toBar at the next bar line / at atBar (end of the section) / at the next beat; {cancel: true} clears it.
    juce::var queueJump(const juce::var& req);
    void preopenMidi(const juce::String& port) { std::vector<std::string> w; midiOuts.resolve(port, w); } // 8d: before a pedal needs it
    void primeAt(int bar, double beat) { if (loaded && ! eng.isPlaying()) eng.prime(eng.tempoMap().sampleAt(juce::jmax(1, bar), juce::jmax(1.0, beat))); } // 8d
    juce::var transportState();
    // Tests (--test-script): maps the song exactly as loadSong does and renders it offline (no device):
    // {fromBar, seconds, loop: {fromBar, toBar}} -> {rate, bars: [sample per downbeat], outs: [{onsets, peak}], midi: [sample]}
    juce::var renderOffline(const juce::var& payload, const juce::var& opts);
    juce::var engineStats();

    // Called on the message thread: device changed underneath us (unplugged, driver reset, rate changed).
    std::function<void()> onSetupChanged;
    // Events for the UI: "transport" (~30 Hz while playing + on change), "meters" (~30 Hz), "engineStats" (1 Hz).
    std::function<void(const juce::Identifier&, const juce::var&)> emit;

    // Spoken cues for loadSong (set by the Bridge): text + saved voice choice -> audio at `rate`.
    std::function<std::shared_ptr<const std::vector<float>>(const juce::String& text, const juce::var& voice, double rate, std::vector<std::string>& warnings)> cueAudio;
    // Plays audio once on these outputs (0-based) at gain, on top of whatever is playing (cue Preview).
    void playPreview(std::shared_ptr<const std::vector<float>> audio, std::vector<int> outs, float gain);
    double sampleRate() const { auto* d = dm.getCurrentAudioDevice(); return d ? d->getCurrentSampleRate() : 0.0; }

    Engine& engine() { return eng; }
    juce::AudioDeviceManager& deviceManager() { return dm; }
    juce::AudioIODevice* device() const { return dm.getCurrentAudioDevice(); }
    juce::String lastError() const { return error; }

private:
    // MIDI outputs opened by name, kept open. sendNow() runs on the engine's MIDI thread: the list only
    // grows, inside a fixed array, so it never reallocates under that thread.
    struct MidiOuts : MidiSink {
        static constexpr int Max = 32;
        std::array<std::unique_ptr<juce::MidiOutput>, Max> outs;
        std::array<juce::String, Max> names;
        std::atomic<int> count { 0 };
        std::atomic<bool>* enabled = nullptr; // "Listen on this computer" can hold MIDI back
        std::atomic<EchoGuard*> echo { nullptr }; // 7c: what we send, so an input that echoes it back is ignored
        std::atomic<bool> rigMute { false };      // 7d: a paired backup sends no MIDI while the primary is fine...
        std::array<std::atomic<bool>, Max> rigAllow {}; // ...except on ports set to "Backup also sends"
        std::array<std::mutex, Max> locks;    // a port reopened after a reconnect is swapped under its lock
        void sendNow(int port, const uint8_t* d, int len) override
        {
            if (enabled != nullptr && ! enabled->load(std::memory_order_relaxed)) return;
            if (rigMute.load(std::memory_order_relaxed) && (port < 0 || port >= Max || ! rigAllow[(size_t) port].load(std::memory_order_relaxed))) return;
            if (port < 0 || port >= count.load(std::memory_order_acquire)) return;
            std::lock_guard<std::mutex> g(locks[(size_t) port]);
            if (outs[(size_t) port]) outs[(size_t) port]->sendMessageNow(juce::MidiMessage(d, len));
            if (auto* e = echo.load(std::memory_order_relaxed)) e->sent(d, len, juce::Time::getMillisecondCounterHiRes());
        }
        int resolve(const juce::String& want, std::vector<std::string>& warnings);
    };

    juce::String open(const juce::String& driver, const juce::String& device, double rate, int buffer, bool remember = true);
    struct Listen { bool on = false; juce::String driver, device, mode = "everything"; std::vector<int> output; bool click = true, cues = true, midi = true; };
    Listen listen;
    void saveListen();
    // The song as heard on this computer (the show's routing kept, the outputs changed): see setListen.
    static void applyListen(SongDef& def, const Listen& l);
    // "One show output": the engine renders every show output here and the chosen ones go to the device.
    static constexpr int scratchOuts = 64, scratchFrames = 8192;
    std::vector<std::vector<float>> scratch;
    std::array<float*, scratchOuts> scratchPtrs {};
    std::atomic<int> listenOut1 { -1 }, listenOut2 { -1 }; // audio thread reads; -1 = not in "one output" mode
    std::atomic<bool> midiOn { true };
    bool clockHeld = false;
    void refreshClock();   // the engine's clock / transport ports from this computer's settings
    void scanMidiPorts();  // opens clock ports, reopens ports that came back (every 2 s)
    juce::StringArray connectedPorts; int scanTick = 0; int lateSeen[2] = { 0, 0 };
    void save();
    void applyLevels();
    void changeListenerCallback(juce::ChangeBroadcaster*) override;
    void timerCallback() override;

    // AudioIODeviceCallback (audio thread)
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* out, int numOut, int n,
                                          const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice* d) override;
    void audioDeviceStopped() override;

    juce::PropertiesFile& settings;
    juce::AudioDeviceManager dm;
    MidiOuts midiOuts; // declared before the engine: its MIDI thread sends through it until the engine is gone
    Engine eng;
    juce::String error;
    juce::String savedLabel, savedProblem;
    juce::String autoFrom; // the interface missing at launch (7a); cleared when it's back or the user picks
    void checkInterfaceBack();
    juce::String lastDeviceKey;
    bool opening = false;

    // loaded song
    int deviceEpoch = 0, loadedEpoch = -1;
    bool loaded = false;
    juce::String loadedName, loadedId;
    std::map<juce::String, int> trackIds;
    // the next slot: what the engine holds there, and its tracks / levels for when it takes over
    bool nextLoaded = false;
    juce::String nextName, nextId;
    std::map<juce::String, int> nextTrackIds;
    std::map<juce::String, TrackLevel> nextLevels;
    uint64_t seguesSeen = 0;
    void takeOverNext(); // the next song became the one playing (segue, Next, Play)
    MappedSong mapForEngine(const juce::var& payload, Engine::Config& cfg);
    std::map<juce::String, TrackLevel> levels;

    // cue preview: handed to the audio thread through previewIn; finished ones come back through
    // previewDone and are deleted on the message thread (the audio thread never frees memory).
    struct Preview { std::shared_ptr<const std::vector<float>> audio; std::vector<int> outs; float gain = 1; size_t pos = 0; };
    std::atomic<Preview*> previewIn { nullptr };
    Preview* previewNow = nullptr; // audio thread
    std::array<std::atomic<Preview*>, 4> previewDone {};
    void retirePreview(Preview* p); // audio thread
    void collectPreviews();         // message thread

    // events
    bool wasPlaying = false, metersLive = false;
    int tick = 0, xrunBase = 0;
};

} // namespace setline::gui
