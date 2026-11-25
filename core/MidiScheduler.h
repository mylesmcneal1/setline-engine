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
    void resetStats() { sent = 0; dropped = 0; lateMaxUs = 0; lateSumUs = 0; over1ms = 0; lateCount.store(0, std::memory_order_release); }

    // 7a: every send over 2 ms late, with what the thread was doing (written by the scheduler thread, read by anyone
    // up to lateCount). late = sent - target; wakeLate = when the thread started the send - target (it woke late);
    // sendUs = how long the driver call took (it blocked); before = what happened just before: the last sleep (asked
    // vs took) and the previous send (its duration, and how long ago it ended); queued = events waiting behind it.
    struct Late { int64_t lateUs, wakeLateUs, sendUs, sleepAskUs, sleepTookUs, prevSendUs, sincePrevUs; int queued, port; uint8_t status; bool sys; };
    static constexpr int MaxLate = 256;
    std::atomic<int> lateCount { 0 };
    const Late& late(int i) const { return lates[(size_t) i]; }

private:
    static constexpr uint64_t Q = 4096;

    void run()
    {
        platform::makeThisThreadTimeCritical();
        std::vector<Item> pending; pending.reserve(Q);
        int64_t sleepAsk = 0, sleepTook = 0, prevSend = 0; Clock::time_point prevEnd {};
        auto nap = [&](int64_t us) { const auto a = Clock::now(); platform::preciseSleep(std::chrono::microseconds(us)); sleepAsk = us; sleepTook = std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - a).count(); };
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
            if (pending.empty()) { nap(250); continue; }
            const Item f = pending.front();
            const auto now = Clock::now();
            // Sleep in short precise steps while the event is far away, then spin for the last 1.5 ms.
            if (f.target - now > std::chrono::microseconds(1500)) { nap(500); continue; }
            while (Clock::now() < f.target) std::this_thread::yield(); // final approach: spin for sub-ms accuracy
            const auto sendAt = Clock::now();
            if (sink && f.port >= 0) sink->sendNow(f.port, f.d, f.len);
            const auto end = Clock::now();
            const int64_t late = std::chrono::duration_cast<std::chrono::microseconds>(end - f.target).count();
            const int64_t took = std::chrono::duration_cast<std::chrono::microseconds>(end - sendAt).count();
            sent.fetch_add(1); lateSumUs.fetch_add(late);
            if (late > lateMaxUs.load()) lateMaxUs.store(late);
            if (late > 1000) over1ms.fetch_add(1);
            if (late > 2000) {
                const int n = lateCount.load(std::memory_order_relaxed);
                if (n < MaxLate) {
                    lates[(size_t) n] = { late, std::chrono::duration_cast<std::chrono::microseconds>(sendAt - f.target).count(), took, sleepAsk, sleepTook, prevSend,
                                          prevEnd == Clock::time_point {} ? -1 : std::chrono::duration_cast<std::chrono::microseconds>(sendAt - prevEnd).count(),
                                          (int) pending.size() - 1, f.port, f.d[0], f.sys };
                    lateCount.store(n + 1, std::memory_order_release);
                }
            }
            prevSend = took; prevEnd = end; sleepAsk = sleepTook = 0;
            pending.erase(pending.begin());
        }
    }

    MidiSink* sink = nullptr;
    std::atomic<bool> running { false }, flushReq { false };
    std::thread th;
    // On the heap (allocated once, never on the audio thread): ~100 KB inline would make every Engine huge
    // and overflow the 1 MB Windows stack when several are locals (the self-test).
    std::unique_ptr<Item[]> q { new Item[Q] {} };
    std::unique_ptr<Late[]> lates { new Late[MaxLate] {} };
    std::atomic<uint64_t> w { 0 }, r { 0 };
};

} // namespace setline
