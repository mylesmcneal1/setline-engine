// set.Line engine spike — tempo map.
// Bars are 1-based. Every position in the engine is an integer sample index derived from
// this map with one rounding rule (llround), so stems, click and MIDI can never disagree.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace setline {

struct TempoChange {
    int bar = 1;
    double bpm = 0;      // 0 = keep previous
    int num = 0, den = 0; // 0 = keep previous meter
    bool ramp = false;   // not supported in the spike (treated as a jump, reported as a warning)
};

class TempoMap {
public:
    struct Bar { double start; int num, den; double bpm; double beatLen; };

    // Builds bars until both minBars and minLengthSamples are covered (plus one closing bar).
    void build(std::vector<TempoChange> changes, double sampleRate, int64_t minLengthSamples, int minBars = 1)
    {
        sr = sampleRate;
        bars.clear();
        std::stable_sort(changes.begin(), changes.end(), [](auto& a, auto& b) { return a.bar < b.bar; });
        double bpm = 120; int num = 4, den = 4; double start = 0; size_t ci = 0;
        for (int b = 1; b < 100000; ++b) {
            while (ci < changes.size() && changes[ci].bar <= b) {
                if (changes[ci].bpm > 0) bpm = changes[ci].bpm;
                if (changes[ci].num > 0 && changes[ci].den > 0) { num = changes[ci].num; den = changes[ci].den; }
                ++ci;
            }
            const double beatLen = 60.0 / bpm * 4.0 / den * sr;
            bars.push_back({ start, num, den, bpm, beatLen });
            if (b > minBars && start >= (double) minLengthSamples) break;
            start += beatLen * num;
        }
    }

    int numBars() const { return (int) bars.size(); }
    const Bar& bar(int b) const { return bars[(size_t) std::clamp(b, 1, numBars()) - 1]; }
    double sampleRate() const { return sr; }

    // Bar and beat are 1-based; beat may be fractional (1.5 = the "and" of beat 1).
    int64_t sampleAt(int b, double beat) const
    {
        if (bars.empty()) return 0;
        if (b < 1) b = 1;
        if (b > numBars()) { // extrapolate past the end with the last bar's tempo
            const auto& l = bars.back();
            return (int64_t) std::llround(l.start + (b - numBars()) * l.beatLen * l.num + (beat - 1) * l.beatLen);
        }
        const auto& x = bars[(size_t) b - 1];
        return (int64_t) std::llround(x.start + (beat - 1) * x.beatLen);
    }

    // The first downbeat after sample s (a queued jump's "Next bar").
    int64_t nextBarStart(int64_t s) const { int b = 1; double beat = 1; barBeatAt(s, b, beat); return sampleAt(b + 1, 1); }

    void barBeatAt(int64_t s, int& outBar, double& outBeat) const
    {
        outBar = 1; outBeat = 1;
        if (bars.empty()) return;
        auto it = std::upper_bound(bars.begin(), bars.end(), (double) s, [](double v, const Bar& x) { return v < x.start; });
        size_t i = it == bars.begin() ? 0 : (size_t) (it - bars.begin()) - 1;
        outBar = (int) i + 1;
        outBeat = 1 + ((double) s - bars[i].start) / bars[i].beatLen;
    }

private:
    double sr = 48000;
    std::vector<Bar> bars;
};

} // namespace setline
