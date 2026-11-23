// Small OS-specific helpers so timing behaves the same on macOS and Windows.
#pragma once
#include <chrono>

namespace setline::platform {

// Windows: raise the system timer to 1 ms (default is ~15.6 ms, which would make every
// sleep in the MIDI scheduler far too coarse). No-op elsewhere. Call once at startup.
void enableHighResolutionTimers();
void restoreTimers();

// Marks the calling thread as time-critical:
//  - Windows: MMCSS "Pro Audio" task (what DAWs use) + time-critical priority
//  - macOS:   user-interactive QoS so it isn't parked on an efficiency core or throttled
void makeThisThreadTimeCritical();

// For the disk thread: above normal, but below the audio and MIDI threads.
void makeThisThreadHighPriority();

// Sleeps for about the given time with sub-millisecond accuracy.
// Windows: a high-resolution waitable timer (plain sleeps can last 15.6 ms there, even with
// timeBeginPeriod, when Windows 11 decides the process is in the background).
void preciseSleep(std::chrono::microseconds d);

} // namespace setline::platform
