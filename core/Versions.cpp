#include "Versions.h"
#include "TempoMap.h"
#include <algorithm>
#include <cmath>
#include <limits>

namespace setline {

namespace {

struct TempoState { double bpm = 120; int num = 4, den = 4; };

TempoState stateAt(const std::vector<TempoChange>& sorted, int bar)
{
    TempoState s;
    for (auto& c : sorted) {
        if (c.bar > bar) break;
        if (c.bpm > 0) s.bpm = c.bpm;
        if (c.num > 0 && c.den > 0) { s.num = c.num; s.den = c.den; }
    }
    return s;
}

} // namespace

SongDef applyVersion(const SongDef& src, const VersionDef& vin, double sr, std::vector<std::string>& warnings, VersionLayout* layoutOut)
{
    constexpr int64_t Inf = std::numeric_limits<int64_t>::max() / 4;

    // Merge parts that are contiguous in the source: no join between them at all.
    std::vector<VersionPart> parts;
    for (auto p : vin.parts) {
        if (p.bars <= 0) continue;
        if (p.bar < 1) p.bar = 0;
        if (! parts.empty() && p.bar >= 1 && parts.back().bar >= 1 && parts.back().bar + parts.back().bars == p.bar) parts.back().bars += p.bars;
        else parts.push_back(p);
    }

    auto tempo = src.tempo;
    std::stable_sort(tempo.begin(), tempo.end(), [](auto& a, auto& b) { return a.bar < b.bar; });
    if (tempo.empty()) tempo.push_back({ 1, 120, 4, 4 });

    // The source's length: its longest stem (clips or whole file), its bars and content.
    int64_t srcLen = 0;
    for (auto& s : src.stems) {
        if (s.clips) for (auto& c : *s.clips) srcLen = std::max(srcLen, c.end);
        else if (s.source) srcLen = std::max(srcLen, s.source->length());
    }
    int srcBars = std::max(1, src.lengthBars);
    for (auto& t : tempo) srcBars = std::max(srcBars, t.bar);
    TempoMap sm;
    sm.build(tempo, sr, srcLen, srcBars + 1);
    int srcLastBar = src.lengthBars > 0 ? src.lengthBars : 0;
    if (srcLastBar == 0) { int b = 1; double beat = 1; sm.barBeatAt(std::max<int64_t>(0, srcLen - 1), b, beat); srcLastBar = b; }

    // ---- the version's tempo map ----
    std::vector<TempoChange> vt;
    VersionLayout lay;
    int vb = 1;
    for (size_t k = 0; k < parts.size(); ++k) {
        const auto& p = parts[k];
        const bool extra = p.bar < 1;
        TempoState st;
        if (! extra) st = stateAt(tempo, p.bar);
        else {
            if (k + 1 < parts.size() && parts[k + 1].bar >= 1) st = stateAt(tempo, parts[k + 1].bar);
            else if (k > 0 && parts[k - 1].bar >= 1) st = stateAt(tempo, parts[k - 1].bar + parts[k - 1].bars - 1);
            else st = stateAt(tempo, 1);
            if (p.bpm > 0) st.bpm = p.bpm;
            if (p.num > 0 && p.den > 0) { st.num = p.num; st.den = p.den; }
        }
        vt.push_back({ vb, st.bpm, st.num, st.den, false });
        if (! extra)
            for (auto& c : tempo) if (c.bar > p.bar && c.bar < p.bar + p.bars) vt.push_back({ vb + (c.bar - p.bar), c.bpm, c.num, c.den, c.ramp });
        VersionLayout::Part lp; lp.srcBar = extra ? 0 : p.bar; lp.verBar = vb; lp.bars = p.bars; lp.extra = extra; lp.tag = p.tag;
        lay.parts.push_back(lp);
        vb += p.bars;
    }
    const int verBars = vb - 1;
    TempoMap vm;
    vm.build(vt, sr, 0, verBars + 2);
    for (auto& lp : lay.parts) {
        lp.verStart = vm.sampleAt(lp.verBar, 1);
        lp.verEnd = vm.sampleAt(lp.verBar + lp.bars, 1);
        lp.srcStart = lp.extra ? 0 : sm.sampleAt(lp.srcBar, 1);
    }
    const int64_t xf = std::max<int64_t>(2, (int64_t) std::llround(vin.crossfadeMs * sr / 1000.0)) & ~int64_t(1); // even: centred
    const int64_t half = xf / 2;
    lay.crossfade = xf;
    const auto& last = lay.parts.empty() ? VersionLayout::Part() : lay.parts.back();
    lay.tail = ! lay.parts.empty() && ! last.extra && last.srcBar + last.bars - 1 >= srcLastBar;

    SongDef out;
    out.name = src.name;
    out.tempo = vt;
    out.lengthBars = verBars;
    out.clickOuts = src.clickOuts; out.clickGainDb = src.clickGainDb;
    out.cueOuts = src.cueOuts; out.cueGainDb = src.cueGainDb;
    if (parts.empty()) { warnings.push_back("This version has no sections, so it plays nothing."); if (layoutOut) *layoutOut = lay; out.clickHits = std::vector<ClickHitDef> {}; return out; }

    // ---- stems: clips cut to the parts, moved, with crossfades at the joins ----
    const size_t n = lay.parts.size();
    for (auto& s : src.stems) {
        StemDef d; d.name = s.name; d.source = s.source; d.outs = s.outs; d.gainDb = s.gainDb;
        std::vector<ClipDef> srcClips;
        if (s.clips) srcClips = *s.clips;
        else if (s.source) srcClips.push_back({ 0, s.source->length(), 0, 0, 0, 0, false });
        std::vector<ClipDef> pieces;
        for (size_t k = 0; k < n; ++k) {
            const auto& lp = lay.parts[k];
            if (lp.extra) continue;
            const bool fadeIn = k > 0 || lp.srcBar > 1;              // a join before it, or it starts inside the song
            const bool tailHere = k == n - 1 && lay.tail;
            const bool fadeOut = k < n - 1 || ! tailHere;             // a join after it, or the version ends early
            const int64_t inAt = k > 0 ? lp.verStart - half : lp.verStart;
            const int64_t outAt = k < n - 1 ? lp.verEnd - half : lp.verEnd - xf;
            const int64_t vs = inAt, ve = k < n - 1 ? lp.verEnd + half : tailHere ? Inf : lp.verEnd;
            const int64_t delta = lp.verStart - lp.srcStart;          // version sample = source sample + delta
            const int64_t ws = std::max<int64_t>(0, vs - delta), we = ve == Inf ? Inf : ve - delta;
            for (auto& c : srcClips) {
                const int64_t a = std::max(c.start, ws), b = std::min(c.end, we);
                if (b <= a) continue;
                ClipDef q = c;
                q.start = a + delta; q.end = b + delta;
                q.offset = c.offset + (a - c.start);
                q.envStart = (c.envStart == ClipDef::Unset ? c.start : c.envStart) + delta;
                q.envEnd = (c.envEnd == ClipDef::Unset ? c.end : c.envEnd) + delta;
                q.xInAt = q.xInLen = q.xOutAt = q.xOutLen = 0;
                if (fadeIn) { q.xInAt = inAt; q.xInLen = k > 0 ? xf : xf; }
                if (fadeOut) { q.xOutAt = outAt; q.xOutLen = xf; }
                pieces.push_back(q);
            }
        }
        std::sort(pieces.begin(), pieces.end(), [](auto& a, auto& b) { return a.start < b.start; });
        d.clips = std::move(pieces);
        out.stems.push_back(std::move(d));
    }

    // ---- bar-based content follows its part ----
    auto mapBar = [&](int bar, int& vbar) {
        for (size_t k = 0; k < n; ++k) {
            const auto& lp = lay.parts[k];
            if (lp.extra) continue;
            const bool tailHere = k == n - 1 && lay.tail;
            if (bar >= lp.srcBar && (bar < lp.srcBar + lp.bars || tailHere)) { vbar = lp.verBar + (bar - lp.srcBar); return true; }
        }
        return false;
    };
    auto mapHits = [&](const std::vector<ClickHitDef>& hs) {
        std::vector<ClickHitDef> o;
        for (auto h : hs) { int b; if (mapBar(h.bar, b)) { h.bar = b; o.push_back(h); } }
        return o;
    };
    if (src.clickHits) out.clickHits = mapHits(*src.clickHits);
    for (auto c : src.moreClicks) { c.hits = mapHits(c.hits); out.moreClicks.push_back(std::move(c)); }
    for (auto c : src.cues) { int b; if (mapBar(c.bar, b)) { c.bar = b; out.cues.push_back(std::move(c)); } }
    for (auto m : src.midi) { int b; if (mapBar(m.bar, b)) { m.bar = b; out.midi.push_back(std::move(m)); } }
    if (layoutOut) *layoutOut = lay;
    return out;
}

} // namespace setline
