// set.Line desktop app: the audio device, the engine and the MIDI outputs.
// All public functions are called on the message thread.
#pragma once
#include <juce_audio_devices/juce_audio_devices.h>
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
    explicit AudioHost(juce::PropertiesFile& settings);
    ~AudioHost() override;

    // Opens the saved device, or the best available one on first launch.
    void start();

    // ---- audio setup ----
    // {drivers:[{name, devices:[...]}], current:{driver, device, rate, buffer, rates, buffers, outputs, ...}, error}
    juce::var getSetup(bool rescan = false);
    // req: {driver, device, rate, buffer}; missing fields keep their current value.
    // Returns the new state, with "error" set if the device couldn't be opened as asked.
    juce::var setSetup(const juce::var& req);
    juce::var midiOutputs() const;

    // ---- songs and transport ----
    // payload: see SongMapper.h. Returns {ok, warnings, seconds, epoch} or {error}.
    juce::var loadSong(const juce::var& payload);
    // req: {cmd: "play" | "stop", fromBar, fromBeat}. Returns the transport state or {error, code}.
    juce::var transport(const juce::var& req);
    // req: {track, db, mute, solo}: live, glitch-free.
    juce::var setTrackLevel(const juce::var& req);
    juce::var transportState();
    juce::var engineStats();

    // Called on the message thread: device changed underneath us (unplugged, driver reset, rate changed).
    std::function<void()> onSetupChanged;
    // Events for the UI: "transport" (~30 Hz while playing + on change), "meters" (~30 Hz), "engineStats" (1 Hz).
    std::function<void(const juce::Identifier&, const juce::var&)> emit;

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
        void sendNow(int port, const uint8_t* d, int len) override
        {
            if (port >= 0 && port < count.load(std::memory_order_acquire) && outs[(size_t) port])
                outs[(size_t) port]->sendMessageNow(juce::MidiMessage(d, len));
        }
        int resolve(const juce::String& want, std::vector<std::string>& warnings);
    };

    juce::String open(const juce::String& driver, const juce::String& device, double rate, int buffer);
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
    juce::String lastDeviceKey;
    bool opening = false;

    // loaded song
    int deviceEpoch = 0, loadedEpoch = -1;
    bool loaded = false;
    juce::String loadedName;
    std::map<juce::String, int> trackIds;
    std::map<juce::String, TrackLevel> levels;

    // events
    bool wasPlaying = false, metersLive = false;
    int tick = 0, xrunBase = 0;
};

} // namespace setline::gui
