// set.Line desktop app: the audio device, the engine and the MIDI outputs.
// All public functions are called on the message thread.
#pragma once
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_data_structures/juce_data_structures.h>
#include "../core/Engine.h"
#include <functional>

namespace setline::gui {

class AudioHost : private juce::ChangeListener, private juce::AudioIODeviceCallback {
public:
    explicit AudioHost(juce::PropertiesFile& settings);
    ~AudioHost() override;

    // Opens the saved device, or the best available one on first launch.
    void start();

    // {drivers:[{name, devices:[...]}], current:{driver, device, rate, buffer, rates, buffers, outputs, ...}, error}
    juce::var getSetup(bool rescan = false);
    // req: {driver, device, rate, buffer}; missing fields keep their current value.
    // Returns the new state, with "error" set if the device couldn't be opened as asked.
    juce::var setSetup(const juce::var& req);
    juce::var midiOutputs() const;

    // Called (message thread) when the device changes underneath us: unplugged, driver reset, rate changed.
    std::function<void()> onSetupChanged;

    Engine& engine() { return eng; }
    juce::AudioDeviceManager& deviceManager() { return dm; }
    juce::AudioIODevice* device() const { return dm.getCurrentAudioDevice(); }
    juce::String lastError() const { return error; }

private:
    juce::String open(const juce::String& driver, const juce::String& device, double rate, int buffer);
    void save();
    void changeListenerCallback(juce::ChangeBroadcaster*) override;

    // AudioIODeviceCallback (audio thread)
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* out, int numOut, int n,
                                          const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart(juce::AudioIODevice* d) override;
    void audioDeviceStopped() override;

    juce::PropertiesFile& settings;
    juce::AudioDeviceManager dm;
    Engine eng;
    juce::String error;
    juce::String lastDeviceKey;
    bool opening = false;
};

} // namespace setline::gui
