// Single-producer / single-consumer multichannel ring buffer (disk thread -> audio thread).
// Lock-free: monotonic 64-bit counters, no allocation after setSize().
#pragma once
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <vector>

namespace setline {

class AudioRing {
public:
    void setSize(int channels, int capacityFrames)
    {
        ch = channels; cap = capacityFrames;
        data.assign((size_t) ch * (size_t) cap, 0.0f);
        w.store(0); r.store(0);
    }
    int channels() const { return ch; }
    int capacity() const { return cap; }

    int readable() const { return (int) (w.load(std::memory_order_acquire) - r.load(std::memory_order_relaxed)); }
    int writable() const { return cap - (int) (w.load(std::memory_order_relaxed) - r.load(std::memory_order_acquire)); }

    // Producer side. n must be <= writable().
    void write(const float* const* src, int n)
    {
        const uint64_t wp = w.load(std::memory_order_relaxed);
        for (int c = 0; c < ch; ++c) {
            float* base = &data[(size_t) c * (size_t) cap];
            const int i0 = (int) (wp % (uint64_t) cap);
            const int a = std::min(n, cap - i0);
            std::memcpy(base + i0, src[c], sizeof(float) * (size_t) a);
            if (n > a) std::memcpy(base, src[c] + a, sizeof(float) * (size_t) (n - a));
        }
        w.store(wp + (uint64_t) n, std::memory_order_release);
    }

    // Consumer side: calls fn(channel, const float* src, int count, int dstOffset) for up to two segments.
    template <typename Fn> void peek(int n, Fn&& fn) const
    {
        const uint64_t rp = r.load(std::memory_order_relaxed);
        const int i0 = (int) (rp % (uint64_t) cap);
        const int a = std::min(n, cap - i0);
        for (int c = 0; c < ch; ++c) {
            const float* base = &data[(size_t) c * (size_t) cap];
            fn(c, base + i0, a, 0);
            if (n > a) fn(c, base, n - a, a);
        }
    }
    void consume(int n) { r.store(r.load(std::memory_order_relaxed) + (uint64_t) n, std::memory_order_release); }

    // Only call while the consumer is guaranteed idle (engine stopped and the audio callback has returned).
    void reset() { r.store(0); w.store(0); }

private:
    int ch = 0, cap = 0;
    std::vector<float> data;
    std::atomic<uint64_t> w { 0 }, r { 0 };
};

} // namespace setline
