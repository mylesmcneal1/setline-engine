// Live, glitch-free level control: the message thread sets a target gain through an atomic,
// the audio thread ramps to it linearly over a few milliseconds. No locks, no allocation.
#pragma once
#include <algorithm>
#include <atomic>
#include <cmath>

namespace setline {

// The gain over one audio block: g0 + inc * i for the first len samples, then end.
struct GainRamp {
    float g0 = 1, inc = 0, end = 1; int len = 0;
    float at(int i) const { return i < len ? g0 + inc * (float) i : end; }
    bool flat() const { return len == 0; }
};

struct LiveGain {
    // ---- message thread ----
    void set(float linear) { target.store(linear, std::memory_order_relaxed); }
    float get() const { return target.load(std::memory_order_relaxed); }

    // ---- audio thread (or any thread while the audio thread is guaranteed idle) ----
    void snap() { aim = cur = target.load(std::memory_order_relaxed); left = 0; inc = 0; }
    // Describes the gain for the next n samples and advances past them.
    GainRamp next(int n, int rampSamples)
    {
        const float t = target.load(std::memory_order_relaxed);
        if (t != aim) { aim = t; left = std::max(1, rampSamples); inc = (aim - cur) / (float) left; }
        GainRamp r { cur, inc, aim, std::min(left, n) };
        if (left > 0) {
            const int k = std::min(left, n);
            left -= k;
            cur = left == 0 ? aim : cur + inc * (float) k;
        }
        return r;
    }

    static float dbToGain(float db) { return std::pow(10.0f, db / 20.0f); }

private:
    std::atomic<float> target { 1.0f };
    float cur = 1.0f, aim = 1.0f, inc = 0.0f;
    int left = 0;
};

} // namespace setline
