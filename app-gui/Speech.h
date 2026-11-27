// set.Line desktop app: a cue voice's description. 13 §16: cues come from your recordings or the natural voices
// (Kokoro, Kokoro.h), never the computer's own voices (SAPI / AVSpeechSynthesizer are gone).
#pragma once
#include <juce_core/juce_core.h>

namespace setline::gui::speech {

struct Voice {
    juce::String id;   // "kokoro:af_heart"...
    juce::String name; // "Heart"
    juce::String lang; // "en-US"
    int quality = 1;
    juce::String engine = "kokoro";
    juce::String gender, grade; // "F"/"M", the model card's grade
    int rank = 0;               // grade as a number, higher = better
};

} // namespace setline::gui::speech
