// Streams one stem from disk into a ring buffer (disk thread) and mixes it into the
// device outputs (audio thread). The audio thread never touches the file.
#pragma once
#include "AudioRing.h"
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
        ring.setSize(ch, ringFrames);
        tmp.assign((size_t) ch, std::vector<float>((size_t) chunk, 0.0f));
        for (auto& t : tmp) tmpPtrs.push_back(t.data());
        length = src->length();
    }

    const std::string& name() const { return nameStr; }
    void setName(std::string n) { nameStr = std::move(n); }

    // ---- control (any non-audio thread, engine stopped) ----
    void requestSeek(int64_t frame)
    {
        seeking.store(true, std::memory_order_release);
        seekReq.store(frame, std::memory_order_release);
        timeline = frame; debt = 0; // audio thread is idle while the engine is stopped
    }
    bool primed() const
    {
        return ! seeking.load(std::memory_order_acquire) && seekReq.load(std::memory_order_acquire) < 0
            && ring.readable() >= std::min(ring.capacity() / 2, ring.capacity() - chunk);
    }

    // ---- disk thread ----
    // Returns true if it did any work.
    bool fill()
    {
        const int64_t s = seekReq.exchange(-1, std::memory_order_acq_rel);
        if (s >= 0) { ring.reset(); filePos = s; seeking.store(false, std::memory_order_release); }
        if (ring.writable() < chunk) return false;
        const int64_t remain = length - filePos;
        if (remain > 0) {
            const int n = (int) std::min<int64_t>(chunk, remain);
            if (! src->read(tmpPtrs.data(), filePos, n)) for (auto& t : tmp) std::fill(t.begin(), t.begin() + n, 0.0f);
            for (auto& t : tmp) std::fill(t.begin() + n, t.end(), 0.0f);
            filePos += n;
        } else {
            for (auto& t : tmp) std::fill(t.begin(), t.end(), 0.0f); // past the end: silence
        }
        ring.write(tmpPtrs.data(), chunk);
        return true;
    }
    int readable() const { return ring.readable(); }

    // ---- audio thread ----
    // Adds n frames into the outputs. Returns true on an underrun inside the file.
    // After an underrun the frames that were missed are skipped when they arrive ("debt"),
    // so the stem stays locked to the timeline instead of drifting late.
    bool mixInto(float* const* out, int numOut, int n)
    {
        int avail = ring.readable();
        if (debt > 0) { const int d = std::min(debt, avail); ring.consume(d); debt -= d; avail -= d; }
        const int got = std::min(avail, n);
        const int nch = ring.channels();
        ring.peek(got, [&](int c, const float* p, int count, int dstOff) {
            if (nch == 1) {
                for (int o : outs) if (o >= 0 && o < numOut && out[o]) addWithGain(out[o] + dstOff, p, count, gain);
            } else if (outs.size() >= 2) {
                const int o = outs[(size_t) c];
                if (o >= 0 && o < numOut && out[o]) addWithGain(out[o] + dstOff, p, count, gain);
            } else if (outs.size() == 1) {
                const int o = outs[0];
                if (o >= 0 && o < numOut && out[o]) addWithGain(out[o] + dstOff, p, count, gain * 0.5f);
            }
        });
        ring.consume(got);
        const bool inside = timeline < length;
        timeline += n;
        if (got < n) { debt += n - got; return inside; }
        return false;
    }

private:
    static void addWithGain(float* d, const float* s, int n, float g) { for (int i = 0; i < n; ++i) d[i] += s[i] * g; }

    std::shared_ptr<SampleSource> src;
    std::vector<int> outs;
    float gain;
    int chunk;
    int64_t length = 0;
    std::string nameStr;

    AudioRing ring;
    std::vector<std::vector<float>> tmp;
    std::vector<float*> tmpPtrs;
    int64_t filePos = 0;                     // disk thread
    std::atomic<int64_t> seekReq { -1 };
    std::atomic<bool> seeking { false };
    int64_t timeline = 0; int debt = 0;      // audio thread
};

} // namespace setline
