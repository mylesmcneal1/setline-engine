// Sends MIDI at an exact wall-clock time, decoupled from the audio thread.
// The audio callback works out *when* each event must leave (the moment the matching audio
// sample reaches the output) and pushes it here lock-free. A dedicated thread waits until
// that moment and sends it. Lateness of every send is measured.
#pragma once
#include "Platform.h"
#include <algorithm>
#include <array>
#include <memory>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <thread>
#include <vector>

namespace setline {

using Clock = std::chrono::steady_clock;

struct MidiSink {
    virtual ~MidiSink() = default;
    virtual void sendNow(int port, const uint8_t* data, int len) = 0;
};

class MidiScheduler {
public:
    // sys: MIDI clock and transport (Start / Stop / Continue / Song Position): a flush (stop, locate) keeps them
    struct Item { int port; uint8_t d[3]; int len; Clock::time_point target; bool sys = false; };

    ~MidiScheduler() { stop(); }

    void start(MidiSink* s)
    {
        stop();
        sink = s; running = true;
        th = std::thread([this] { run(); });
    }
    void stop()
    {
        running = false;
        if (th.joinable()) th.join();
    }
    // Drop anything queued (called on stop/locate).
    void flush() { flushReq.store(true, std::memory_order_release); }

    // Audio thread. Lock-free, no allocation.
    bool push(const Item& it)
    {
        const uint64_t wp = w.load(std::memory_order_relaxed);
        if (wp - r.load(std::memory_order_acquire) >= Q) { dropped.fetch_add(1, std::memory_order_relaxed); return false; }
        q[wp % Q] = it;
        w.store(wp + 1, std::memory_order_release);
        return true;
    }

    // Stats (microseconds)
    std::atomic<int64_t> sent { 0 }, dropped { 0 }, lateMaxUs { 0 }, lateSumUs { 0 }, over1ms { 0 };
    void resetStats() { sent = 0; dropped = 0; lateMaxUs = 0; lateSumUs = 0; over1ms = 0; }

private:
    static constexpr uint64_t Q = 4096;

    void run()
    {
        platform::makeThisThreadTimeCritical();
        std::vector<Item> pending; pending.reserve(Q);
        while (running) {
            if (flushReq.exchange(false)) {
                pending.erase(std::remove_if(pending.begin(), pending.end(), [](const Item& x) { return ! x.sys; }), pending.end());
                const uint64_t wp = w.load(std::memory_order_acquire);
                for (uint64_t rp = r.load(std::memory_order_relaxed); rp != wp; ++rp)
                    if (q[rp % Q].sys) { auto at = pending.end(); while (at != pending.begin() && (at - 1)->target > q[rp % Q].target) --at; pending.insert(at, q[rp % Q]); }
                r.store(wp, std::memory_order_release);
            }
            for (uint64_t rp = r.load(std::memory_order_relaxed); rp != w.load(std::memory_order_acquire); ++rp) {
                const Item& it = q[rp % Q];
                auto pos = pending.end(); // keep sorted by target (normally already in order)
                while (pos != pending.begin() && (pos - 1)->target > it.target) --pos;
                pending.insert(pos, it);
                r.store(rp + 1, std::memory_order_release);
            }
            if (pending.empty()) { platform::preciseSleep(std::chrono::microseconds(250)); continue; }
            const Item f = pending.front();
            const auto now = Clock::now();
            // Sleep in short precise steps while the event is far away, then spin for the last 1.5 ms.
            if (f.target - now > std::chrono::microseconds(1500)) { platform::preciseSleep(std::chrono::microseconds(500)); continue; }
            while (Clock::now() < f.target) std::this_thread::yield(); // final approach: spin for sub-ms accuracy
            if (sink && f.port >= 0) sink->sendNow(f.port, f.d, f.len);
            const int64_t late = std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - f.target).count();
            sent.fetch_add(1); lateSumUs.fetch_add(late);
            if (late > lateMaxUs.load()) lateMaxUs.store(late);
            if (late > 1000) over1ms.fetch_add(1);
            pending.erase(pending.begin());
        }
    }

    MidiSink* sink = nullptr;
    std::atomic<bool> running { false }, flushReq { false };
    std::thread th;
    // On the heap (allocated once, never on the audio thread): ~100 KB inline would make every Engine huge
    // and overflow the 1 MB Windows stack when several are locals (the self-test).
    std::unique_ptr<Item[]> q { new Item[Q] {} };
    std::atomic<uint64_t> w { 0 }, r { 0 };
};

} // namespace setline
