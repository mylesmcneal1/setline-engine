// set.Line (7d): the backup rig's timing. A second computer plays the same thing at the same moment: every transport
// action is a command carrying the primary's host time; the backup turns that into its own host time with an
// NTP-style clock offset (median of recent exchanges) and schedules it (Engine::startAt / jumpAtHost / stopAt).
// No resampling: the two interfaces' clocks drift apart slowly, so every song start and jump re-aligns.
// Plain C++ (no JUCE), unit-tested in the core test.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace setline {

// offset = the backup's clock minus the primary's (ms). One exchange: the backup sends at t0 (its clock), the primary
// receives at t1 and answers at t2 (its clock), the backup receives at t3. offset = ((t0 - t1) + (t3 - t2)) / 2.
class RigClockSync {
public:
    void add(double t0, double t1, double t2, double t3)
    {
        const double off = ((t0 - t1) + (t3 - t2)) / 2.0, rtt = (t3 - t0) - (t2 - t1);
        samples.push_back({ off, rtt });
        if (samples.size() > 9) samples.erase(samples.begin());
    }
    bool ready() const { return samples.size() >= 3; }
    double offset() const // the median of the recent exchanges (a slow one doesn't pull it)
    {
        if (samples.empty()) return 0;
        std::vector<double> o; for (auto& s : samples) o.push_back(s.off);
        std::sort(o.begin(), o.end());
        return o[o.size() / 2];
    }
    double rtt() const { if (samples.empty()) return 0; std::vector<double> r; for (auto& s : samples) r.push_back(s.rtt); std::sort(r.begin(), r.end()); return r[r.size() / 2]; }
    // a time on the primary's clock -> the same moment on this (the backup's) clock
    double toLocal(double primaryMs) const { return primaryMs + offset(); }
private:
    struct S { double off, rtt; };
    std::vector<S> samples;
};

// The primary's heartbeat (every 100 ms): lost after `timeoutMs` without one.
class RigHeartbeat {
public:
    double timeoutMs = 500;
    void beat(double nowMs) { last = nowMs; }
    bool lost(double nowMs) const { return last >= 0 && nowMs - last > timeoutMs; }
    bool seen() const { return last >= 0; }
    double since(double nowMs) const { return last < 0 ? -1 : nowMs - last; }
private:
    double last = -1;
};

// How far the backup's audio is from the primary's (ms, + = the backup is late), per song: the worst one.
class RigDrift {
public:
    void songStart() { worst = 0; samples = 0; }
    void add(double ms) { last = ms; worst = std::max(worst, std::abs(ms)); ++samples; }
    double worstMs() const { return worst; }
    double lastMs() const { return last; }
    int count() const { return samples; }
private:
    double worst = 0, last = 0; int samples = 0;
};

// A transport command from the primary: do `kind` at primary host time `atMs` (song position `pos` in samples).
struct RigCommand {
    enum Kind { Start, Stop, Jump, Realign };
    uint64_t id = 0;
    Kind kind = Start;
    double atMs = 0;   // the primary's clock
    int64_t pos = 0;   // Start: from this sample; Jump / Realign: to this sample
};

} // namespace setline
