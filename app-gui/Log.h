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

// 7a start-up timing: mark("audio device open") logs "Startup: audio device open at 840 ms" (time since the process
// started), or with a duration: mark("peaks", 1200) logs "... at 2.4 s (took 1200 ms)". summary() is the
// "Startup:" line for Copy diagnostics.
void mark(const juce::String& what, double tookMs = -1);
juce::String startupSummary();
double sinceProcessStartMs();

} // namespace setline::gui::applog
