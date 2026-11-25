// set.Line desktop app (7c): footswitches and MIDI controllers. Opens every MIDI input (USB, Bluetooth through the
// OS, IAC / loopMIDI), off the audio thread, turns mapped messages into actions (core/MidiMap.h) and hands them to the
// page, which runs them exactly like a keyboard shortcut. Mappings belong to this computer (the settings file).
#pragma once
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_data_structures/juce_data_structures.h>
#include <atomic>
#include <functional>
#include <mutex>
#include "../core/MidiMap.h"

namespace setline::gui {

class MidiControl : private juce::MidiInputCallback, private juce::Timer {
public:
    explicit MidiControl(juce::PropertiesFile& settings);
    ~MidiControl() override;

    // set.Line's own output: what was just sent, so a port that echoes it back triggers nothing
    EchoGuard echo;
    // emit(name, payload) on the message thread: "midiAction" {action, press, mapping, port, t0, label},
    // "midiIn" {port, text, kind, ch, num, val} (the Activity line, throttled), "midiLearned" {port, type, ch, num, val}
    std::function<void(const juce::String&, const juce::var&)> emit;

    juce::var mappings() const;                 // [{id, action, port, type, ch, num, mode, debounce, feedback}]
    void setMappings(const juce::var& list);    // saved to the settings
    juce::StringArray inputs() const;           // the open inputs' names
    void learn(bool on) { learning.store(on); }
    // tests: a message as if it came in on `port` (from another thread, like a real input)
    void inject(const juce::String& port, const juce::var& bytes);
    void scan();                                // open new inputs, drop gone ones

private:
    void handleIncomingMidiMessage(juce::MidiInput* source, const juce::MidiMessage& m) override;
    void incoming(const juce::String& port, const uint8_t* d, int len);
    void timerCallback() override { scan(); }

    juce::PropertiesFile& settings;
    mutable std::mutex lock;       // the mapper (input threads) vs. setMappings (message thread)
    MidiMapper mapper;
    juce::var saved;               // the mappings as the page sent them (extra fields kept)
    std::vector<MidiMapper::Fire> fires;
    std::vector<std::unique_ptr<juce::MidiInput>> ins;
    std::atomic<bool> learning { false };
    std::atomic<double> lastActivity { 0 };
    std::shared_ptr<MidiControl*> alive = std::make_shared<MidiControl*>(this);
};

} // namespace setline::gui
