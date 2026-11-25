// Streams one stem from disk into a ring buffer (disk thread) and mixes it into the
// device outputs (audio thread). The audio thread never touches the file.
//
// Two rings: the active one plays; the standby one is filled in the background from the start of
// the armed jump (a loop's start). At the jump the audio thread just switches rings, so loops and
// jumps land on the exact sample with no seek and no gap. After a switch the old ring is refilled
// from the same target, ready for the next pass of a loop.
//
// Clips (step 2): the disk thread renders the track's timeline into the ring by compositing its clips
// (file offset, clip gain, fades, muted clips, silence between them). The result depends only on the
// timeline sample, never on where a chunk, seek or jump starts, so every path plays the same samples.
// The audio thread still does a plain ring read with the live level ramp.
#pragma once
#include "AudioRing.h"
#include "LiveGain.h"
#include "Song.h"
#include <algorithm>
#include <atomic>
#include <string>
#include <cmath>
#include <memory>
#include <vector>

namespace setline {

class StemStreamer {
public:
    StemStreamer(const StemDef& def, int ringFrames, int chunkFrames)
        : src(def.source), outs(def.outs), gain(std::pow(10.0f, def.gainDb / 20.0f)), chunk(chunkFrames)
    {
        const int ch = src->numChannels();
        for (auto& r : rings) r.setSize(ch, ringFrames);
        tmp.assign((size_t) ch, std::vector<float>((size_t) chunk, 0.0f));
        for (auto& t : tmp) tmpPtrs.push_back(t.data());
        srcLength = length = src->length();
        if (def.clips) {
            clips = *def.clips;
            std::sort(clips.begin(), clips.end(), [](auto& a, auto& b) { return a.start < b.start; });
            clipGain.clear();
            length = 0;
            for (auto& c : clips) { clipGain.push_back(std::pow(10.0, c.gainDb / 20.0)); length = std::max(length, c.end); }
            useClips = true;
            src2.assign((size_t) ch, std::vector<float>((size_t) chunk, 0.0f));
            for (auto& t : src2) src2Ptrs.push_back(t.data());
        }
        primeLevel = std::min(ringFrames / 2, ringFrames - chunk);
    }

    const std::string& name() const { return nameStr; }
    void setName(std::string n) { nameStr = std::move(n); }

    // ---- control (any non-audio thread, engine stopped) ----
    void requestSeek(int64_t frame)
    {
        seeking.store(true, std::memory_order_release);
        active.store(0, std::memory_order_release);
        standbyReady.store(false, std::memory_order_release);
        seekReq.store(frame, std::memory_order_release);
        timeline = frame; debt = 0; pending = -1; // audio thread is idle while the engine is stopped
    }
    bool primed() const
    {
        return ! seeking.load(std::memory_order_acquire) && seekReq.load(std::memory_order_acquire) < 0
            && rings[(size_t) active.load(std::memory_order_acquire)].readable() >= primeLevel;
    }

    // ---- control (any non-audio thread, also while playing) ----
    // What the standby ring should hold: the stem from `frame` on (-1 = nothing armed).
    void setJumpTarget(int64_t frame)
    {
        standbyReady.store(false, std::memory_order_release);
        jumpTarget.store(frame, std::memory_order_release);
    }
    bool standbyPrimedFor(int64_t frame) const
    {
        return standbyReady.load(std::memory_order_acquire) && standbyFor.load(std::memory_order_acquire) == frame;
    }

    // ---- disk thread ----
    // Returns true if it did any work.
    bool fill()
    {
        bool worked = false;
        const int64_t s = seekReq.exchange(-1, std::memory_order_acq_rel);
        if (s >= 0) {
            for (auto& r : rings) r.reset();
            filePos[0] = filePos[1] = s;
            diskStandbyFor = -1;
            seeking.store(false, std::memory_order_release);
        }

        // Standby: read the state that a ring switch publishes first, so `active` is current.
        const uint64_t g = gen.load(std::memory_order_acquire);
        const bool ready = standbyReady.load(std::memory_order_acquire);
        const int a = active.load(std::memory_order_acquire), b = 1 - a;
        const int64_t tgt = jumpTarget.load(std::memory_order_acquire);
        if (tgt >= 0 && ! ready) {
            if (diskStandbyFor != tgt || diskGen != g) { // new target, or the ring was just switched out
                rings[(size_t) b].reset();
                filePos[b] = tgt;
                diskStandbyFor = tgt; diskGen = g;
                worked = true;
            }
            if (rings[(size_t) b].readable() < primeLevel && rings[(size_t) b].writable() >= chunk) { readChunk(b); worked = true; }
            if (rings[(size_t) b].readable() >= primeLevel && jumpTarget.load(std::memory_order_acquire) == tgt) {
                standbyFor.store(tgt, std::memory_order_release);
                standbyReady.store(true, std::memory_order_release);
            }
        }

        if (rings[(size_t) a].writable() >= chunk) { readChunk(a); worked = true; }
        return worked;
    }
    int readable() const { return rings[(size_t) active.load(std::memory_order_relaxed)].readable(); }
    // Samples on the timeline: the file's length, or the end of the last clip.
    int64_t timelineLength() const { return length; }

    // ---- audio thread ----
    // Adds n frames into the outputs at the stem's own gain times the live level (ramp).
    // Returns true on an underrun inside the file.
    // After an underrun the frames that were missed are skipped when they arrive ("debt"),
    // so the stem stays locked to the timeline instead of drifting late.
    // peak (optional): the largest level added (after the stem gain and the live level), for the track meter.
    bool mixInto(float* const* out, int numOut, int n, const GainRamp& live = {}, float* peak = nullptr)
    {
        if (pending >= 0) { // a jump came before the disk had the target ready
            if (standbyPrimedFor(pending)) { const int64_t ahead = timeline - pending; swapRings(); debt = (int) ahead; pending = -1; }
            else { const bool inside = timeline < length; timeline += n; return inside; }
        }
        auto& ring = rings[(size_t) active.load(std::memory_order_relaxed)];
        int avail = ring.readable();
        if (debt > 0) { const int d = std::min(debt, avail); ring.consume(d); debt -= d; avail -= d; }
        const int got = std::min(avail, n);
        const int nch = ring.channels();
        ring.peek(got, [&](int c, const float* p, int count, int dstOff) {
            if (peak != nullptr) { float m = 0.0f; for (int i = 0; i < count; ++i) m = std::max(m, std::fabs(p[i])); m *= gain * std::max(live.at(dstOff), live.end); if (m > *peak) *peak = m; }
            if (nch == 1) {
                for (int o : outs) if (o >= 0 && o < numOut && out[o]) addWithGain(out[o] + dstOff, p, count, gain, live, dstOff);
            } else if (outs.size() >= 2) {
                const int o = outs[(size_t) c];
                if (o >= 0 && o < numOut && out[o]) addWithGain(out[o] + dstOff, p, count, gain, live, dstOff);
            } else if (outs.size() == 1) {
                const int o = outs[0];
                if (o >= 0 && o < numOut && out[o]) addWithGain(out[o] + dstOff, p, count, gain * 0.5f, live, dstOff);
            }
        });
        ring.consume(got);
        const bool inside = timeline < length;
        timeline += n;
        if (got < n) { debt += n - got; return inside; }
        return false;
    }

    // Continue from `frame`: switch to the standby ring if it holds the stem from there.
    // Returns false if it wasn't ready (the jump was armed too late for the disk): the stem then
    // goes silent until the disk catches up (counted as an underrun by the caller).
    bool jumpTo(int64_t frame)
    {
        timeline = frame;
        if (standbyPrimedFor(frame)) { swapRings(); debt = 0; pending = -1; return true; }
        // Not ready: silent until the standby ring is, then switch and skip ahead to stay on the timeline.
        pending = frame;
        return false;
    }

private:
    void swapRings() // audio thread
    {
        const int a = active.load(std::memory_order_relaxed);
        active.store(1 - a, std::memory_order_release);
        standbyReady.store(false, std::memory_order_release);
        gen.fetch_add(1, std::memory_order_acq_rel); // tells the disk thread to refill the old ring from the target
    }

    void readChunk(int r)
    {
        if (useClips) { renderClips(filePos[r]); filePos[r] += chunk; rings[(size_t) r].write(tmpPtrs.data(), chunk); return; }
        const int64_t remain = length - filePos[r];
        if (remain > 0) {
            const int n = (int) std::min<int64_t>(chunk, remain);
            if (! src->read(tmpPtrs.data(), filePos[r], n)) for (auto& t : tmp) std::fill(t.begin(), t.begin() + n, 0.0f);
            for (auto& t : tmp) std::fill(t.begin() + n, t.end(), 0.0f);
        } else {
            for (auto& t : tmp) std::fill(t.begin(), t.end(), 0.0f); // past the end: silence
        }
        filePos[r] += chunk;
        rings[(size_t) r].write(tmpPtrs.data(), chunk);
    }

    // tmp = timeline samples [p, p + chunk): every unmuted clip that overlaps, from its file offset, with
    // its gain and fades; silence elsewhere (and where a clip runs past the end of its file).
    void renderClips(int64_t p)
    {
        for (auto& t : tmp) std::fill(t.begin(), t.end(), 0.0f);
        const int64_t q = p + chunk;
        for (size_t k = 0; k < clips.size(); ++k) {
            const auto& c = clips[k];
            if (c.start >= q) break; // sorted by start
            if (c.mute || c.end <= p) continue;
            int64_t a = std::max(p, c.start), b = std::min(q, c.end);
            // only where the file has samples
            a = std::max(a, c.start - c.offset);
            b = std::min(b, c.start + (srcLength - c.offset));
            if (b <= a) continue;
            const int n = (int) (b - a);
            if (! src->read(src2Ptrs.data(), c.offset + (a - c.start), n)) continue;
            for (int i = 0; i < n; ++i) {
                const float g = (float) clipGainAt(c, clipGain[k], a + i);
                for (size_t ch = 0; ch < tmp.size(); ++ch) tmp[ch][(size_t) (a - p + i)] += src2[ch][(size_t) i] * g;
            }
        }
    }

    static void addWithGain(float* d, const float* s, int n, float g, const GainRamp& r, int off)
    {
        if (r.len <= off) { const float gg = g * r.end; for (int i = 0; i < n; ++i) d[i] += s[i] * gg; return; }
        for (int i = 0; i < n; ++i) d[i] += s[i] * g * r.at(off + i);
    }

    std::shared_ptr<SampleSource> src;
    std::vector<int> outs;
    float gain;
    int chunk, primeLevel = 0;
    int64_t length = 0, srcLength = 0;
    std::string nameStr;
    bool useClips = false;
    std::vector<ClipDef> clips;
    std::vector<double> clipGain;
    std::vector<std::vector<float>> src2; // one clip's file samples (disk thread)
    std::vector<float*> src2Ptrs;

    AudioRing rings[2];
    std::vector<std::vector<float>> tmp;
    std::vector<float*> tmpPtrs;
    int64_t filePos[2] { 0, 0 };                 // disk thread
    int64_t diskStandbyFor = -1; uint64_t diskGen = 0;
    std::atomic<int64_t> seekReq { -1 }, jumpTarget { -1 }, standbyFor { -1 };
    std::atomic<bool> seeking { false }, standbyReady { false };
    std::atomic<int> active { 0 };
    std::atomic<uint64_t> gen { 0 };
    int64_t timeline = 0, pending = -1; int debt = 0; // audio thread
};

} // namespace setline
