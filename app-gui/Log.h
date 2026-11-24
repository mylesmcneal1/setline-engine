// set.Line desktop app: one log file per run (docs/phase6c.md), for diagnostics and support.
// Windows: %LOCALAPPDATA%\set.Line\Logs; macOS: ~/Library/Logs/set.Line. The last 20 runs are kept.
// Message thread or any thread (juce::Logger is thread-safe); never from the audio thread.
#pragma once
#include <juce_core/juce_core.h>

namespace setline::gui::applog {

// Starts this run's log (call once, first thing).
void start(const juce::String& version);
void stop();
// One line, timestamped.
void line(const juce::String& text);
juce::File folder();
juce::File current();
// The last n lines of this run's log.
juce::String tail(int n);

} // namespace setline::gui::applog
