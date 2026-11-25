// set.Line — audio clips on a stem's timeline (step 2).
// A clip plays part of the stem's file: timeline samples [start, end) hear file samples from `offset` on.
// Clip gain and fades shape it; a muted clip is silent; between clips the track is digital silence.
// Every position is a whole sample: the app converts the Edit page's seconds with llround(seconds * rate),
// the same rounding rule as the tempo map.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace setline {

struct ClipDef {
    int64_t start = 0, end = 0; // timeline samples, end exclusive
    int64_t offset = 0;         // file sample heard at `start`
    float gainDb = 0;
    int64_t fadeIn = 0, fadeOut = 0; // samples
    bool mute = false;
    // A piece of a clip (a song version cuts clips at its section joins, 6e): its fades stay where the whole clip had
    // them. envStart / envEnd = the whole clip's start and end on this timeline (Unset: this clip's own).
    static constexpr int64_t Unset = std::numeric_limits<int64_t>::min();
    int64_t envStart = Unset, envEnd = Unset;
    // Equal-power crossfades at a version's joins: fade in from silence over [xInAt, xInAt + xInLen), fade out to
    // silence over [xOutAt, xOutAt + xOutLen). Length 0 = none. sin/cos curves, so a join's two sides sum to constant power.
    int64_t xInAt = 0, xInLen = 0, xOutAt = 0, xOutLen = 0;
};

// The fade curve the Edit page draws: a quadratic Bezier from silence to full level with its control
// point 20% of the way in at full level, P0 = (0, 0), P1 = (0.2, 1), P2 = (1, 1). u = position in the fade
// (0 = silent end, 1 = full level). Solved for the curve parameter s from x(s) = 0.4 s + 0.6 s^2;
// the gain is y(s) = 2 s - s^2. The page uses the same formula (fadeCurve in ui/1-arrange.html).
inline double fadeCurve(double u)
{
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    const double s = (std::sqrt(0.16 + 2.4 * u) - 0.4) / 1.2;
    return s * (2 - s);
}

// Gain of clip c at timeline sample t (inside the clip): clip gain times fade-in and fade-out.
// Fade-in: u = (t - start) / fadeIn. Fade-out: u = (end - t) / fadeOut. (The page: clipEnv.)
inline double clipGainAt(const ClipDef& c, double linGain, int64_t t)
{
    double g = linGain;
    const int64_t s = c.envStart == ClipDef::Unset ? c.start : c.envStart, e = c.envEnd == ClipDef::Unset ? c.end : c.envEnd;
    if (c.fadeIn > 0 && t < s + c.fadeIn) g *= fadeCurve((double) (t - s) / (double) c.fadeIn);
    if (c.fadeOut > 0 && t > e - c.fadeOut) g *= fadeCurve((double) (e - t) / (double) c.fadeOut);
    constexpr double halfPi = 1.57079632679489661923;
    if (c.xInLen > 0 && t < c.xInAt + c.xInLen) g *= t < c.xInAt ? 0.0 : std::sin(halfPi * (double) (t - c.xInAt) / (double) c.xInLen);
    if (c.xOutLen > 0 && t >= c.xOutAt) g *= t >= c.xOutAt + c.xOutLen ? 0.0 : std::cos(halfPi * (double) (t - c.xOutAt) / (double) c.xOutLen);
    return g;
}

} // namespace setline
