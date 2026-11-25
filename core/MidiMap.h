// set.Line (7c): footswitch / MIDI controller mappings. Turns incoming MIDI into actions (the page's action list:
// Play/Stop, Next song, Vamp...). No JUCE, no allocation per message; the app feeds it from its MIDI input thread.
// - Note On (velocity > 0) triggers; Note Off / velocity 0 releases (momentary mappings only).
// - CC: triggers when its value crosses up through 64 (default), on any change ("any"), or press on the way up and
//   release on the way down ("momentary", e.g. hold to Vamp).
// - Program Change triggers on its program number.
// - Each mapping: any port or one port, a channel (0 = any), a debounce (repeats inside it are ignored).
// - MIDI clock, active sensing and other realtime / system messages never trigger anything.
#pragma once
#include <array>
#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

namespace setline {

struct MidiMapping {
    enum Type { Note, CC, PC };
    enum Mode { Cross, Any, Momentary };
    std::string id, action;   // action: an id from the page's action list ("playStop", "nextSong", "jump3"...)
    std::string port;         // "" = any port
    Type type = Note;
    int ch = 0;               // 1-16, 0 = any
    int num = 0;              // note / CC / program number
    Mode mode = Cross;        // CC (and Note: Momentary also releases)
    double debounceMs = 150;
};

struct MidiIn { std::string port; uint8_t b[3] {}; int len = 0; double timeMs = 0; };

// What a message is, for Learn and the Activity line. kind: 0 none (realtime / system / ignored), 1 note on,
// 2 note off, 3 CC, 4 program change. ch 1-16.
struct MidiKind { int kind = 0, ch = 0, num = 0, val = 0; };
inline MidiKind classify(const MidiIn& m)
{
    MidiKind k;
    if (m.len < 1 || m.b[0] < 0x80 || m.b[0] >= 0xF0) return k; // running status / system / clock / active sensing
    const int st = m.b[0] & 0xF0;
    k.ch = (m.b[0] & 0x0F) + 1;
    if (st == 0x90 && m.len >= 3) { k.kind = m.b[2] > 0 ? 1 : 2; k.num = m.b[1]; k.val = m.b[2]; }
    else if (st == 0x80 && m.len >= 3) { k.kind = 2; k.num = m.b[1]; }
    else if (st == 0xB0 && m.len >= 3) { k.kind = 3; k.num = m.b[1]; k.val = m.b[2]; }
    else if (st == 0xC0 && m.len >= 2) { k.kind = 4; k.num = m.b[1]; }
    return k;
}

class MidiMapper {
public:
    struct Fire { int mapping; bool press; }; // press = false: a momentary release

    void set(std::vector<MidiMapping> list)
    {
        maps = std::move(list);
        state.assign(maps.size(), State {});
    }
    const std::vector<MidiMapping>& mappings() const { return maps; }

    // The mappings this message triggers (in mapping order). out is cleared first; reserve it once.
    void feed(const MidiIn& m, std::vector<Fire>& out)
    {
        out.clear();
        const MidiKind k = classify(m);
        if (k.kind == 0) return;
        for (size_t i = 0; i < maps.size(); ++i) {
            const auto& p = maps[i];
            auto& s = state[i];
            if (! p.port.empty() && p.port != m.port) continue;
            if (p.ch != 0 && p.ch != k.ch) continue;
            bool press = false, release = false;
            if (p.type == MidiMapping::Note && (k.kind == 1 || k.kind == 2) && k.num == p.num) {
                if (k.kind == 1) press = true; else release = p.mode == MidiMapping::Momentary;
            } else if (p.type == MidiMapping::CC && k.kind == 3 && k.num == p.num) {
                const int prev = s.last;
                s.last = k.val;
                if (p.mode == MidiMapping::Any) press = prev != k.val;
                else {
                    const bool up = k.val >= 64 && (prev < 64), down = k.val < 64 && prev >= 64;
                    press = up;
                    release = down && p.mode == MidiMapping::Momentary;
                }
            } else if (p.type == MidiMapping::PC && k.kind == 4 && k.num == p.num) press = true;
            if (press) {
                if (s.lastFire >= 0 && m.timeMs - s.lastFire < p.debounceMs) continue; // a bounce / repeat
                s.lastFire = m.timeMs;
                out.push_back({ (int) i, true });
            } else if (release) out.push_back({ (int) i, false });
        }
    }

    // Learn: would this message be another mapping's? -> its index, or -1
    int conflict(const MidiMapping& want) const
    {
        for (size_t i = 0; i < maps.size(); ++i) {
            const auto& p = maps[i];
            if (p.type == want.type && p.num == want.num && (p.ch == 0 || want.ch == 0 || p.ch == want.ch) && (p.port.empty() || want.port.empty() || p.port == want.port))
                return (int) i;
        }
        return -1;
    }

private:
    struct State { int last = -1; double lastFire = -1; };
    std::vector<MidiMapping> maps;
    std::vector<State> state;
};

// Recently sent messages (set.Line's own output), so a port that echoes them back doesn't trigger anything.
// Written by the MIDI sending threads, read by the input thread: a small ring of (bytes, time), no locks.
class EchoGuard {
public:
    void sent(const uint8_t* b, int len, double nowMs)
    {
        const uint32_t key = pack(b, len);
        const unsigned i = w.fetch_add(1, std::memory_order_relaxed) % N;
        ring[i].t.store(nowMs, std::memory_order_relaxed);
        ring[i].key.store(key, std::memory_order_release);
    }
    bool isEcho(const uint8_t* b, int len, double nowMs, double windowMs = 40) const
    {
        const uint32_t key = pack(b, len);
        for (auto& e : ring)
            if (e.key.load(std::memory_order_acquire) == key && nowMs - e.t.load(std::memory_order_relaxed) <= windowMs) return true;
        return false;
    }
private:
    static uint32_t pack(const uint8_t* b, int len) { return (uint32_t) len << 24 | (uint32_t) (len > 0 ? b[0] : 0) << 16 | (uint32_t) (len > 1 ? b[1] : 0) << 8 | (uint32_t) (len > 2 ? b[2] : 0); }
    static constexpr unsigned N = 64;
    struct E { std::atomic<uint32_t> key { 0 }; std::atomic<double> t { -1e18 }; };
    std::array<E, N> ring {};
    std::atomic<unsigned> w { 0 };
};

} // namespace setline
