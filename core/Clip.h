// set.Line — audio clips on a stem's timeline (step 2).
// A clip plays part of the stem's file: timeline samples [start, end) hear file samples from `offset` on.
// Clip gain and fades shape it; a muted clip is silent; between clips the track is digital silence.
// Every position is a whole sample: the app converts the Edit page's seconds with llround(seconds * rate),
// the same rounding rule as the tempo map.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace setline {

struct ClipDef {
    int64_t start = 0, end = 0; // timeline samples, end exclusive
    int64_t offset = 0;         // file sample heard at `start`
    float gainDb = 0;
    int64_t fadeIn = 0, fadeOut = 0; // samples
    bool mute = false;
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
    if (c.fadeIn > 0 && t < c.start + c.fadeIn) g *= fadeCurve((double) (t - c.start) / (double) c.fadeIn);
    if (c.fadeOut > 0 && t > c.end - c.fadeOut) g *= fadeCurve((double) (c.end - t) / (double) c.fadeOut);
    return g;
}

} // namespace setline
