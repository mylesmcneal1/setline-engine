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
    std::vector<int> grouping; // 9a: click accent groups for this meter (beats per group, e.g. 2+2+3); empty = the default
};

// 9a: meters. Numerators 1-32, denominators 1, 2, 4, 8, 16, 32. The beat unit is the denominator's note.
inline bool validMeter(int num, int den) { return num >= 1 && num <= 32 && (den == 1 || den == 2 || den == 4 || den == 8 || den == 16 || den == 32); }
// The default accent groups: x/4 (and x/2, x/1): beat 1 only (one group); 5/8 3+2, 7/8 2+2+3, 9/8 3+3+3, 12/8 3+3+3+3,
// other x/8 and x/16: groups of 3 when it divides, else 2s with a 3 at the end.
inline std::vector<int> defaultGrouping(int num, int den)
{
    if (den < 8 || num <= 3) return { num };
    if (num == 5) return { 3, 2 };
    if (num == 7) return { 2, 2, 3 };
    std::vector<int> g;
    if (num % 3 == 0) { for (int k = 0; k < num / 3; ++k) g.push_back(3); return g; }
    int left = num;
    while (left > 3) { g.push_back(2); left -= 2; }
    g.push_back(left);
    return g;
}
// A grouping is usable for a meter if its parts are positive and add up to the numerator.
inline bool validGrouping(const std::vector<int>& g, int num)
{
    int t = 0;
    for (int x : g) { if (x < 1) return false; t += x; }
    return ! g.empty() && t == num;
}

class TempoMap {
public:
    struct Bar { double start; int num, den; double bpm; double beatLen; std::vector<int> grouping; };

    // Builds bars until both minBars and minLengthSamples are covered (plus one closing bar).
    void build(std::vector<TempoChange> changes, double sampleRate, int64_t minLengthSamples, int minBars = 1)
    {
        sr = sampleRate;
        bars.clear();
        std::stable_sort(changes.begin(), changes.end(), [](auto& a, auto& b) { return a.bar < b.bar; });
        double bpm = 120; int num = 4, den = 4; double start = 0; size_t ci = 0;
        std::vector<int> grp = defaultGrouping(4, 4);
        for (int b = 1; b < 100000; ++b) {
            while (ci < changes.size() && changes[ci].bar <= b) {
                if (changes[ci].bpm > 0) bpm = changes[ci].bpm;
                if (changes[ci].num > 0 && changes[ci].den > 0 && validMeter(changes[ci].num, changes[ci].den)) {
                    num = changes[ci].num; den = changes[ci].den;
                    grp = validGrouping(changes[ci].grouping, num) ? changes[ci].grouping : defaultGrouping(num, den);
                }
                ++ci;
            }
            const double beatLen = 60.0 / bpm * 4.0 / den * sr;
            bars.push_back({ start, num, den, bpm, beatLen, grp });
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

    // 9a: a beat's accent: 2 = the bar's first beat, 1 = the start of a group (7/8 as 2+2+3: beats 3 and 5), 0 = other.
    // beat is 0-based.
    int accentOf(int b, int beat) const
    {
        if (beat <= 0) return 2;
        int at = 0;
        for (int g : bar(b).grouping) { at += g; if (at == beat) return 1; if (at > beat) break; }
        return 0;
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
