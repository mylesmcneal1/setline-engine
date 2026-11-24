// set.Line desktop app: the operating system's text-to-speech voices (step 2, spoken cues).
// Windows: SAPI 5 (the desktop voices plus the OneCore voices SAPI can use). macOS: AVSpeechSynthesizer.
// Speech is rendered to audio ahead of time (Cues.h); nothing here runs during playback.
// Both functions block; call them from one background thread (the Cues worker).
#pragma once
#include <juce_core/juce_core.h>
#include <vector>

namespace setline::gui::speech {

struct Voice {
    juce::String id;   // platform identifier (SAPI token id / AVSpeechSynthesisVoice identifier)
    juce::String name; // "Microsoft Zira", "Samantha"...
    juce::String lang; // "en-US"
    int quality = 1;   // 1 standard, 2 enhanced, 3 premium (macOS's rating; Windows: OneCore 2, desktop 1)
};

// Installed voices; defaultId = the system's default voice.
std::vector<Voice> listVoices(juce::String& defaultId);

// Speaks text with voice id ("" = default) at speed (1 = normal) into mono samples. The backend picks the
// sample rate: wantRate if it can render at that rate, else its own; rateOut says which.
bool render(const juce::String& text, const juce::String& voiceId, double speed, double wantRate,
            std::vector<float>& out, double& rateOut, juce::String& error);

} // namespace setline::gui::speech
