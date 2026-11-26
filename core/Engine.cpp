#include "Engine.h"
#include "Platform.h"
#include <algorithm>
#include <chrono>
#include <cmath>

namespace setline {

Engine::Engine()
{
    progs[0] = std::make_unique<Program>();
    progs[1] = std::make_unique<Program>();
}

Engine::~Engine()
{
    stop();
    diskRun = false;
    if (disk.joinable()) disk.join();
    midi.stop();
    midiClock.stop();
    delete clickIn.exchange(nullptr);
    delete clickOut.exchange(nullptr);
}

void Engine::setMidiSink(MidiSink* s)
{
    sink = s;
    if (! cfg.offline) { midi.start(sink); midiClock.start(sink); }
}

void Engine::ensureDisk()
{
    if (cfg.offline || diskRun.load()) return;
    if (disk.joinable()) disk.join();
    diskRun = true;
    disk = std::thread([this] { diskLoop(); });
}

// Builds one song into P (any thread; P isn't playing).
std::string Engine::build(Program& P, const SongDef& song, std::vector<std::string>& warnings)
{
    P.name = song.name;
    P.stems.clear(); P.clickLanes.clear(); P.midiEvents.clear(); P.cues.clear();

    // --- stems: same sample rate as the device, always. No resampling, no stretching. ---
    P.songLen = 0; P.maxOut = -1;
    for (auto& s : song.stems) {
        if (! s.source) return "Stem \"" + s.name + "\" could not be opened.";
        if (s.source->numChannels() < 1 || s.source->numChannels() > 2)
            return "Stem \"" + s.name + "\" has " + std::to_string(s.source->numChannels()) + " channels. Use mono or stereo files.";
        if (std::abs(s.source->sampleRate() - cfg.sampleRate) > 0.5)
            return "Stem \"" + s.name + "\" is " + std::to_string((int) s.source->sampleRate()) + " Hz but the device runs at "
                 + std::to_string((int) cfg.sampleRate) + " Hz. set.Line never resamples; export the stems at the show rate.";
        if (s.outs.empty()) { warnings.push_back("Stem \"" + s.name + "\" has no outputs; it will be silent."); }
        for (int o : s.outs) P.maxOut = std::max(P.maxOut, o);
        auto st = std::make_unique<StemStreamer>(s, cfg.ringFrames, cfg.chunkFrames);
        P.songLen = std::max(P.songLen, st->timelineLength()); // the file, or the end of its last clip
        st->setName(s.name);
        P.stems.push_back(std::move(st));
    }
    // Live levels: a new song starts at 0 dB, unmuted; the app sets its levels after loading.
    P.stemGains = std::make_unique<LiveGain[]>(P.stems.size());
    for (auto& m : P.midiMuted) m.store(false, std::memory_order_relaxed);
    P.cueLive.set(1.0f);
    for (int o : song.clickOuts) P.maxOut = std::max(P.maxOut, o);
    for (auto& c : song.moreClicks) for (int o : c.outs) P.maxOut = std::max(P.maxOut, o);
    if (P.maxOut < 0) P.maxOut = 1;

    // --- tempo map: long enough for the stems, the tempo changes and all the content ---
    int lastBar = std::max(1, song.lengthBars);
    for (auto& t : song.tempo) { lastBar = std::max(lastBar, t.bar); if (t.ramp) warnings.push_back("Tempo ramp at bar " + std::to_string(t.bar) + " is played as a jump for now."); }
    for (auto& m : song.midi) lastBar = std::max(lastBar, m.bar);
    if (song.clickHits) for (auto& h : *song.clickHits) lastBar = std::max(lastBar, h.bar);
    for (auto& c : song.moreClicks) for (auto& h : c.hits) lastBar = std::max(lastBar, h.bar);
    for (auto& c : song.cues) lastBar = std::max(lastBar, c.bar);
    P.tmap.build(song.tempo, cfg.sampleRate, P.songLen, lastBar);
    // With stems, the song is as long as its longest stem (as before). Without stems it lasts until the
    // end of the last bar of its tempo map / content. lengthBars, when given, is a minimum either way.
    if (P.stems.empty()) P.songLen = P.tmap.sampleAt(lastBar + 1, 1);
    else if (song.lengthBars > 0) P.songLen = std::max(P.songLen, P.tmap.sampleAt(song.lengthBars + 1, 1));

    // --- click tracks: [0] the main click, then the song's other click tracks, each on its own outputs ---
    // Exactly the hits the user entered, nothing generated (except the main click of the test song / spike).
    auto hitsOf = [&](const std::vector<ClickHitDef>& defs) { return hitsFor(P.tmap, P.songLen, defs); };
    P.clickLanes.resize(1 + song.moreClicks.size());
    P.clickLanes[0].outs = song.clickOuts;
    P.clickLanes[0].gain = LiveGain::dbToGain(song.clickGainDb);
    for (size_t k = 0; k < song.moreClicks.size(); ++k) {
        auto& c = P.clickLanes[k + 1];
        c.outs = song.moreClicks[k].outs;
        c.gain = LiveGain::dbToGain(song.moreClicks[k].gainDb);
        if (! c.outs.empty()) c.hits = hitsOf(song.moreClicks[k].hits);
    }
    P.clickLives = std::make_unique<LiveGain[]>(P.clickLanes.size());
    for (size_t k = 0; k < P.clickLanes.size(); ++k) P.clickLives[k].set(1.0f);
    auto& clicks = P.clickLanes[0].hits;
    if (! P.clickLanes[0].outs.empty()) {
        if (song.clickHits) {
            clicks = hitsOf(*song.clickHits);
        } else {
            // Every beat (test song / spike).
            for (int b = 1; b <= P.tmap.numBars(); ++b) {
                const auto& bar = P.tmap.bar(b);
                for (int k = 0; k < bar.num; ++k) {
                    const int64_t s = P.tmap.sampleAt(b, k + 1);
                    if (s >= P.songLen) break;
                    clicks.push_back({ s, k == 0, 1.0f });
                }
            }
        }
    }

    // --- spoken cues: preloaded one-shots from their bar's sample ---
    P.cueOuts = song.cueOuts;
    P.cueGain = LiveGain::dbToGain(song.cueGainDb);
    for (int o : P.cueOuts) P.maxOut = std::max(P.maxOut, o);
    P.longestCue = 0;
    for (auto& c : song.cues) {
        if (! c.audio || c.audio->empty() || c.bar < 1) continue;
        const int64_t s = P.tmap.sampleAt(c.bar, std::max(1.0, c.beat));
        if (s >= P.songLen) { warnings.push_back("Cue \"" + c.text + "\" at bar " + std::to_string(c.bar) + " is after the end of the song."); continue; }
        P.cues.push_back({ s - c.lead, c.audio }); // 7a: the word's onset on the beat
        P.longestCue = std::max(P.longestCue, (int64_t) c.audio->size());
    }
    std::stable_sort(P.cues.begin(), P.cues.end(), [](auto& a, auto& b) { return a.sample < b.sample; });

    // --- MIDI ---
    for (auto& m : song.midi) {
        if (m.port < 0) { warnings.push_back("MIDI event \"" + m.label + "\" at bar " + std::to_string(m.bar) + " has no output port; skipped."); continue; }
        MidiAt e; e.port = m.port; e.len = m.len; e.track = m.track;
        e.sample = std::max<int64_t>(0, P.tmap.sampleAt(m.bar, m.beat) - (int64_t) std::llround(m.earlySeconds * cfg.sampleRate));
        std::copy(m.bytes, m.bytes + 3, e.d);
        P.midiEvents.push_back(e);
    }
    std::stable_sort(P.midiEvents.begin(), P.midiEvents.end(), [](auto& a, auto& b) { return a.sample < b.sample; });
    // --- MIDI clock: 24 ticks per quarter note through every bar (7/8 = 84 ticks), up to the end of the song ---
    P.clockTicks.clear();
    for (int b = 1; b <= P.tmap.numBars(); ++b) {
        const auto& x = P.tmap.bar(b);
        const double tick = 60.0 / x.bpm * cfg.sampleRate / 24.0;
        const int nt = (int) std::lround(96.0 * x.num / x.den);
        bool done = false;
        for (int k = 0; k < nt; ++k) { const int64_t s = (int64_t) std::llround(x.start + k * tick); if (s >= P.songLen) { done = true; break; } P.clockTicks.push_back(s); }
        if (done) break;
    }
    seekClicks(P, 0);
    return {};
}

std::vector<Engine::ClickHit> Engine::hitsFor(const TempoMap& tmap, int64_t songLen, const std::vector<ClickHitDef>& defs)
{
    std::vector<ClickHit> v;
    for (auto& h : defs) {
        if (h.bar < 1 || h.beat < 1) continue;
        const int64_t s = tmap.sampleAt(h.bar, h.beat);
        if (s < songLen) v.push_back({ s, h.accent, LiveGain::dbToGain(h.gainDb) });
    }
    std::stable_sort(v.begin(), v.end(), [](auto& a, auto& b) { return a.sample < b.sample; });
    // Two hits on the same sample play once (the louder / accented one).
    std::vector<ClickHit> unique;
    for (auto& h : v) {
        if (! unique.empty() && unique.back().sample == h.sample) {
            unique.back().accent |= h.accent; unique.back().gain = std::max(unique.back().gain, h.gain);
        } else unique.push_back(h);
    }
    return unique;
}

bool Engine::updateClicks(const SongDef& song)
{
    std::lock_guard<std::mutex> lk(control);
    collect();
    const Program& P = cur();
    if (P.clickLanes.size() != 1 + song.moreClicks.size() || ! song.clickHits) return false;
    auto u = std::make_unique<ClickSwap>();
    u->target = &P; u->gen = loadGen.load(std::memory_order_acquire);
    u->lanes.resize(P.clickLanes.size());
    if (! P.clickLanes[0].outs.empty()) u->lanes[0] = hitsFor(P.tmap, P.songLen, *song.clickHits);
    for (size_t k = 0; k < song.moreClicks.size(); ++k)
        if (! P.clickLanes[k + 1].outs.empty()) u->lanes[k + 1] = hitsFor(P.tmap, P.songLen, song.moreClicks[k].hits);
    delete clickIn.exchange(u.release(), std::memory_order_acq_rel); // one the audio thread never took: replaced
    if (! deviceRunning.load() || cfg.offline) { // no callback to pick it up (offline: rendered on this thread)
        if (auto* x = clickIn.exchange(nullptr, std::memory_order_acq_rel)) { takeClicks(x); delete clickOut.exchange(nullptr); }
    }
    return true;
}

void Engine::takeClicks(ClickSwap* u)
{
    Program& P = cur();
    if (u->target == &P && u->gen == loadGen.load(std::memory_order_acquire) && u->lanes.size() == P.clickLanes.size()) {
        const int64_t p = pos.load(std::memory_order_relaxed);
        for (size_t k = 0; k < P.clickLanes.size(); ++k) {
            auto& c = P.clickLanes[k];
            if (c.outs.empty()) continue;
            std::swap(c.hits, u->lanes[k]); // O(1): the old hits go back in u
            c.next = (size_t) (std::lower_bound(c.hits.begin(), c.hits.end(), p, [](const ClickHit& h, int64_t x) { return h.sample < x; }) - c.hits.begin());
        }
    }
    clickOut.store(u, std::memory_order_release); // freed by the control thread (collect)
}

void Engine::collect() { delete clickOut.exchange(nullptr, std::memory_order_acq_rel); }

std::string Engine::load(const SongDef& song, const Config& c, std::vector<std::string>& warnings)
{
    std::lock_guard<std::mutex> lk(control);
    loadGen.fetch_add(1, std::memory_order_acq_rel);
    fadeOutAndStop(); // switching songs while playing: fade out first, never cut
    const bool reconfig = c.sampleRate != cfg.sampleRate || c.ringFrames != cfg.ringFrames || c.chunkFrames != cfg.chunkFrames || c.offline != cfg.offline;
    cfg = c;
    rampSamples = std::max(1, (int) std::lround(0.010 * cfg.sampleRate));    // live level changes
    fadeOutSamples = std::max(1, (int) std::lround(0.010 * cfg.sampleRate)); // stop
    auto P = std::make_unique<Program>();
    auto err = build(*P, song, warnings);
    if (! err.empty()) return err;
    {
        std::lock_guard<std::mutex> dl(diskMx); // the disk thread never sees a slot being replaced
        progs[(size_t) curIdx.load()] = std::move(P);
        if (reconfig) { progs[(size_t) (1 - curIdx.load())] = std::make_unique<Program>(); nextLoaded = false; } // built for the old setup
    }
    nextFresh = false;
    midiLog.clear(); if (cfg.offline) midiLog.reserve(std::max<size_t>(cur().midiEvents.size() * 4 + cur().clockTicks.size() * 8 + 64, 1 << 16)); // loops replay events

    pos = 0; nextMidi = 0; nextTick = 0;
    ctlJump = {}; publishJump(); rtJump = {}; rtSeq = jumpSeq.load(); rtDoneSeq = ~0ull; // a new song has no loop
    fadeInLeft = fadeInLen = fadeOutLeft = 0;
    ensureDisk();
    return {};
}

// ------------------------------------------------------------------ the next song

std::string Engine::prepareNext(const SongDef& song, std::vector<std::string>& warnings)
{
    std::lock_guard<std::mutex> lk(control);
    // The audio thread may only hand over to a complete slot: stop it from doing so, and make sure no callback that
    // decided otherwise is still running, before the slot changes.
    nextLoaded.store(false, std::memory_order_release);
    if (playing.load()) waitForCallbackToFinish();
    auto P = std::make_unique<Program>();
    auto err = build(*P, song, warnings);
    if (! err.empty()) { std::lock_guard<std::mutex> dl(diskMx); progs[(size_t) (1 - curIdx.load())] = std::make_unique<Program>(); return err; }
    for (auto& s : P->stems) s->requestSeek(0);
    for (size_t i = 0; i < P->stems.size(); ++i) P->stemGains[i].snap();
    for (size_t k = 0; k < P->clickLanes.size(); ++k) P->clickLives[k].snap();
    P->cueLive.snap();
    {
        std::lock_guard<std::mutex> dl(diskMx);
        progs[(size_t) (1 - curIdx.load())] = std::move(P);
    }
    if (cfg.offline) { auto& N = *other(); for (auto& s : N.stems) while (! s->primed()) s->fill(); }
    nextLoaded.store(true, std::memory_order_release);
    ensureDisk();
    return {};
}

void Engine::clearNext()
{
    std::lock_guard<std::mutex> lk(control);
    nextLoaded.store(false, std::memory_order_release);
    segueArmed.store(false, std::memory_order_release);
    if (playing.load()) waitForCallbackToFinish();
    std::lock_guard<std::mutex> dl(diskMx);
    progs[(size_t) (1 - curIdx.load())] = std::make_unique<Program>();
}

bool Engine::nextReady() const
{
    if (! nextLoaded.load(std::memory_order_acquire)) return false;
    auto* N = other();
    return N && N->primed();
}

std::string Engine::nextName() const
{
    return nextLoaded.load(std::memory_order_acquire) && other() ? other()->name : std::string();
}

bool Engine::promoteNext()
{
    std::lock_guard<std::mutex> lk(control);
    if (! nextLoaded.load()) return false;
    fadeOutAndStop();
    nextLoaded.store(false, std::memory_order_release);
    segueArmed.store(false, std::memory_order_release);
    curIdx.store(1 - curIdx.load());
    nextFresh = true; // its stems are primed at sample 0: a start there doesn't seek again
    pos = 0; nextMidi = 0; nextTick = 0;
    ctlJump = {}; publishJump(); rtJump = {}; rtSeq = jumpSeq.load(); rtDoneSeq = ~0ull;
    fadeInLeft = fadeInLen = fadeOutLeft = 0;
    return true;
}

bool Engine::switchToNext(int timeoutMs)
{
    if (! promoteNext()) return false; // fades the playing song out (10 ms) and stops it first
    return start(0, timeoutMs);
}

// Audio thread: the song playing ended on sample p; the next one takes over at its sample 0, in this callback.
void Engine::handOver(int64_t& p)
{
    curIdx.store(1 - curIdx.load(std::memory_order_relaxed), std::memory_order_release);
    nextLoaded.store(false, std::memory_order_release);
    segueArmed.store(false, std::memory_order_release);
    p = 0;
    nextMidi = 0;
    seekClicks(cur(), 0);
    rtJump = {}; rtDoneSeq = rtSeq; // the old song's loop / jump doesn't apply to this one
    segueCount.fetch_add(1, std::memory_order_acq_rel);
}

void Engine::setDeviceTiming(int bufferSamples, int outputLatencySamples)
{
    latencyBase.store(bufferSamples + outputLatencySamples);
}

void Engine::seekClicks(Program& P, int64_t p)
{
    for (auto& c : P.clickLanes) {
        c.next = (size_t) (std::lower_bound(c.hits.begin(), c.hits.end(), p, [](const ClickHit& h, int64_t x) { return h.sample < x; }) - c.hits.begin());
        c.voice = {};
    }
    nextTick = (size_t) (std::lower_bound(P.clockTicks.begin(), P.clockTicks.end(), p) - P.clockTicks.begin());
}

void Engine::setTrackLevel(int track, float db, bool mute, bool next)
{
    Program* P = next ? other() : &cur();
    if (P == nullptr) return;
    const float g = mute ? 0.0f : LiveGain::dbToGain(db);
    if (track <= -200) { const int k = -200 - track; if (k < MaxMidiTracks) P->midiMuted[(size_t) k].store(mute, std::memory_order_relaxed); }
    else if (track == ClickTrack || track <= -101) {
        const int k = track == ClickTrack ? 0 : -100 - track;
        if (P->clickLives && k < (int) P->clickLanes.size()) P->clickLives[(size_t) k].set(g);
    } else if (track == CueTrack) P->cueLive.set(g);
    else if (track >= 0 && track < (int) P->stems.size() && P->stemGains) P->stemGains[(size_t) track].set(g);
}

void Engine::diskLoop()
{
    platform::makeThisThreadHighPriority();
    while (diskRun) {
        bool worked = false;
        {
            std::lock_guard<std::mutex> dl(diskMx);
            for (auto& P : progs) if (P) for (auto& s : P->stems) worked |= s->fill();
        }
        if (! worked) std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
}

void Engine::waitForCallbackToFinish()
{
    if (! deviceRunning.load()) return;
    const int64_t s0 = serial.load();
    const auto until = Clock::now() + std::chrono::milliseconds(500);
    while (serial.load() < s0 + 2 && Clock::now() < until) std::this_thread::sleep_for(std::chrono::microseconds(200));
}

void Engine::fadeOutAndStop()
{
    const bool was = playing.load(std::memory_order_acquire);
    if (was && deviceRunning.load() && ! cfg.offline) {
        // Let the callback fade out (10 ms) and stop by itself; give up waiting after 250 ms.
        stopReq.store(true, std::memory_order_release);
        const auto until = Clock::now() + std::chrono::milliseconds(250);
        while (playing.load(std::memory_order_acquire) && Clock::now() < until) std::this_thread::sleep_for(std::chrono::microseconds(500));
    }
    playing.store(false, std::memory_order_release);
    stopReq.store(false, std::memory_order_release);
    // from here on the audio thread does not touch any stem. 8d: already stopped, and a callback has seen it
    // stopped since: none can be in the middle of reading a stem, so no need to wait two more callbacks
    if (was || idleRuns.load(std::memory_order_acquire) < 1) waitForCallbackToFinish();
}

void Engine::stop()
{
    std::lock_guard<std::mutex> lk(control);
    startAtNs.store(0); stopAtNs.store(0); // a scheduled start / stop (7d) no longer applies
    fadeOutAndStop();
    midi.flush();
}

bool Engine::startAt(int64_t fromSample, Clock::time_point when, int timeoutMs)
{
    startAtNs.store(nsOf(when), std::memory_order_release); // before playing is set: the first callback already waits
    stopAtNs.store(0);
    if (start(fromSample, timeoutMs)) return true;
    startAtNs.store(0);
    return false;
}

void Engine::stopAt(Clock::time_point when) { if (playing.load()) stopAtNs.store(nsOf(when), std::memory_order_release); }

int64_t Engine::sampleAtHost(Clock::time_point when) const
{
    return lastPos.load(std::memory_order_relaxed) + (int64_t) std::llround((double) (nsOf(when) - lastOutNs.load(std::memory_order_acquire)) * 1e-9 * cfg.sampleRate);
}

void Engine::jumpAtHost(Clock::time_point when, int64_t to)
{
    const int64_t at = std::max(sampleAtHost(when), pos.load(std::memory_order_relaxed) + 1);
    setJump(at, to, false);
}

void Engine::prime(int64_t fromSample)
{
    std::lock_guard<std::mutex> lk(control);
    if (playing.load(std::memory_order_acquire) || cfg.offline) return;
    auto& P = cur();
    if (fromSample < 0 || fromSample >= P.songLen) return;
    const int64_t audioFrom = fromSample - std::min<int64_t>(fromSample, std::lround(0.005 * cfg.sampleRate)); // as start() does
    for (auto& s : P.stems) if (! s->primedAt(audioFrom)) s->requestSeek(audioFrom);
}

bool Engine::start(int64_t fromSample, int timeoutMs)
{
    std::lock_guard<std::mutex> lk(control);
    fadeOutAndStop();
    midi.flush();
    auto& P = cur();
    if (fromSample < 0) fromSample = 0;
    if (fromSample >= P.songLen) return false;

    // Audio starts up to 5 ms early so the fade-in is over by fromSample; click and MIDI start at fromSample.
    const int64_t preroll = std::min<int64_t>(fromSample, std::lround(0.005 * cfg.sampleRate));
    const int64_t audioFrom = fromSample - preroll;
    if (! (nextFresh.exchange(false) && audioFrom == 0)) for (auto& s : P.stems) if (! s->primedAt(audioFrom)) s->requestSeek(audioFrom); // 8d: primed there already: no seek
    armStems(); // an armed loop's target is prepared again from the new position
    if (cfg.offline) {
        for (auto& s : P.stems) while (! s->primed()) s->fill();
    } else {
        const auto until = Clock::now() + std::chrono::milliseconds(timeoutMs);
        while (! P.primed()) {
            if (Clock::now() > until) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    }
    seekClicks(P, fromSample);
    startedFrom = fromSample; clockWasPlaying = false; // Song Position + Start / Continue go out on the first callback
    nextMidi = (size_t) (std::lower_bound(P.midiEvents.begin(), P.midiEvents.end(), fromSample, [](const MidiAt& m, int64_t s) { return m.sample < s; }) - P.midiEvents.begin());
    fadeInLeft = fadeInLen = (int) preroll;
    fadeOutLeft = 0;
    rtDoneSeq = ~0ull; // a one-shot jump that already happened is armed again for this run
    for (size_t i = 0; i < P.stems.size(); ++i) P.stemGains[i].snap(); // levels set while stopped apply at once
    for (size_t k = 0; k < P.clickLanes.size(); ++k) P.clickLives[k].snap();
    P.cueLive.snap();
    pos.store(audioFrom);
    finished = false;
    stopReq.store(false);
    playing.store(true, std::memory_order_release);
    return true;
}

// ------------------------------------------------------------------ loops and jumps (control side)

void Engine::publishJump()
{
    // Sequence lock: odd while writing, even when complete. The audio thread only takes complete copies.
    const uint64_t s = jumpSeq.load(std::memory_order_relaxed);
    jumpSeq.store(s + 1, std::memory_order_release);
    jAt.store(ctlJump.at, std::memory_order_release);
    jTo.store(ctlJump.to, std::memory_order_release);
    jRepeat.store(ctlJump.repeat, std::memory_order_release);
    jumpSeq.store(s + 2, std::memory_order_release);
}

void Engine::armStems()
{
    auto& P = cur();
    for (auto& s : P.stems) s->setJumpTarget(ctlJump.at >= 0 ? ctlJump.to : -1);
    if (cfg.offline && ctlJump.at >= 0) // no disk thread: prepare the target right away
        for (auto& s : P.stems) while (! s->standbyPrimedFor(ctlJump.to)) s->fill();
}

void Engine::setJump(int64_t at, int64_t to, bool repeat)
{
    std::lock_guard<std::mutex> lk(control);
    if (at <= 0 || to < 0 || at == to || (repeat && to >= at)) { ctlJump = {}; }
    else ctlJump = { at, to, repeat };
    armStems();     // stems first: the standby rings start filling before the audio thread sees the jump
    publishJump();
}

void Engine::clearJump()
{
    std::lock_guard<std::mutex> lk(control);
    ctlJump = {};
    armStems();
    publishJump();
}

// ------------------------------------------------------------------ audio thread

void Engine::process(float* const* outs, int numOuts, int n)
{
    const int64_t tn = testNowNs.load(std::memory_order_relaxed);
    const auto t0 = tn != 0 ? Clock::time_point(std::chrono::duration_cast<Clock::duration>(std::chrono::nanoseconds(tn))) : Clock::now();
    for (int c = 0; c < numOuts; ++c) if (outs[c]) std::fill(outs[c], outs[c] + n, 0.0f);
    serial.fetch_add(1, std::memory_order_acq_rel);
    // 7a: new click hits (only when the last ones have been collected, so the hand-back slot is always free)
    if (clickOut.load(std::memory_order_acquire) == nullptr)
        if (auto* u = clickIn.exchange(nullptr, std::memory_order_acq_rel)) takeClicks(u);
    if (! playing.load(std::memory_order_acquire)) { idleRuns.fetch_add(1, std::memory_order_acq_rel); clockIdle(n, t0); return; }
    idleRuns.store(0, std::memory_order_release);
    // 7d: when this block's first sample leaves the interface; a start / stop scheduled for a host time
    const double srate = cfg.sampleRate;
    const int64_t outNs = nsOf(t0) + (int64_t) std::llround(latencyBase.load(std::memory_order_relaxed) / srate * 1e9);
    int startOff = 0;
    if (const int64_t sa = startAtNs.load(std::memory_order_acquire); sa != 0) {
        const double k = (double) (sa - outNs) * 1e-9 * srate;
        if (k >= n) return; // not yet: silence, nothing moves
        startOff = (int) std::clamp<int64_t>(std::llround(k), 0, n - 1);
        startAtNs.store(0, std::memory_order_release);
    }
    if (const int64_t so = stopAtNs.load(std::memory_order_acquire); so != 0 && (double) (so - outNs) * 1e-9 * srate < n) { stopAtNs.store(0); stopReq.store(true, std::memory_order_release); }
    lastPos.store(pos.load(std::memory_order_relaxed), std::memory_order_relaxed);
    lastOutNs.store(outNs + (int64_t) std::llround(startOff / srate * 1e9), std::memory_order_release);
    if (! clockWasPlaying) { // Song Position (in 16ths) + Start from the top / Continue from inside the song
        clockWasPlaying = true;
        const int64_t p0 = pos.load(std::memory_order_relaxed);
        const int off = (int) std::clamp<int64_t>(startedFrom - p0 + startOff, 0, n - 1);
        const auto& ticks = cur().clockTicks;
        const int spp = (int) ((std::lower_bound(ticks.begin(), ticks.end(), startedFrom) - ticks.begin()) / 6);
        const uint32_t tm = transportMask.load(std::memory_order_relaxed);
        for (int port = 0; port < clockPortCount.load(std::memory_order_relaxed); ++port)
            if ((tm >> port) & 1u) sendAt(port, 0xF2, (uint8_t) (spp & 0x7f), (uint8_t) ((spp >> 7) & 0x7f), 3, startedFrom, off, t0, true);
        clockTransport(startedFrom == 0 ? 0xFA : 0xFB, startedFrom, off, t0);
    }

    // Pick up a new loop / jump (complete copies only).
    if (const uint64_t s1 = jumpSeq.load(std::memory_order_acquire); (s1 & 1) == 0 && s1 != rtSeq) {
        const Jump j { jAt.load(std::memory_order_acquire), jTo.load(std::memory_order_acquire), jRepeat.load(std::memory_order_acquire) };
        if (jumpSeq.load(std::memory_order_acquire) == s1) { rtJump = j; rtSeq = s1; rtDoneSeq = ~0ull; }
    }

    // Render in segments: a jump splits the block exactly at its sample and playback continues from
    // the target inside the same block; so does a segue at the end of the song (the next song from its sample 0).
    int64_t p = pos.load(std::memory_order_relaxed);
    for (int done = startOff; done < n;) {
        Program& P = cur();
        const bool chain = segueArmed.load(std::memory_order_acquire) && nextLoaded.load(std::memory_order_acquire) && other() != nullptr && other()->primed();
        if (chain && p >= P.songLen) { handOver(p); continue; }
        const bool armed = rtJump.at >= 0 && rtDoneSeq != rtSeq;
        int seg = n - done;
        if (armed && rtJump.at > p && rtJump.at - p < seg) seg = (int) (rtJump.at - p);
        if (chain && P.songLen - p < seg) seg = (int) (P.songLen - p);
        renderSegment(P, outs, numOuts, done, seg, p, t0);
        p += seg; done += seg;
        if (armed && p == rtJump.at) {
            for (auto& s : P.stems) s->jumpTo(rtJump.to); // a stem that isn't ready yet counts underruns until it is
            p = rtJump.to;
            for (auto& c : P.clickLanes) c.next = (size_t) (std::lower_bound(c.hits.begin(), c.hits.end(), p, [](const ClickHit& h, int64_t x) { return h.sample < x; }) - c.hits.begin());
            nextMidi = (size_t) (std::lower_bound(P.midiEvents.begin(), P.midiEvents.end(), p, [](const MidiAt& m, int64_t x) { return m.sample < x; }) - P.midiEvents.begin());
            nextTick = (size_t) (std::lower_bound(P.clockTicks.begin(), P.clockTicks.end(), p) - P.clockTicks.begin());
            if (! rtJump.repeat) rtDoneSeq = rtSeq;
            stats.jumps.fetch_add(1, std::memory_order_relaxed);
        }
        if (chain && p >= P.songLen) handOver(p);
    }

    // Fades: in when starting inside the song, out when stopping (never a hard cut).
    bool stopNow = false;
    if (fadeInLeft > 0) {
        const int k = std::min(fadeInLeft, n);
        for (int i = 0; i < k; ++i) {
            const float g = 1.0f - (float) (fadeInLeft - i) / (float) fadeInLen;
            for (int c = 0; c < numOuts; ++c) if (outs[c]) outs[c][i] *= g;
        }
        fadeInLeft -= k;
    }
    if (stopReq.load(std::memory_order_acquire)) {
        if (fadeOutLeft == 0) fadeOutLeft = fadeOutSamples;
        int i = 0;
        for (; i < n && fadeOutLeft > 0; ++i, --fadeOutLeft) {
            const float g = (float) (fadeOutLeft - 1) / (float) fadeOutSamples;
            for (int c = 0; c < numOuts; ++c) if (outs[c]) outs[c][i] *= g;
        }
        for (int c = 0; c < numOuts; ++c) if (outs[c]) std::fill(outs[c] + i, outs[c] + n, 0.0f);
        if (fadeOutLeft == 0) stopNow = true;
    }

    // Output meters (peak since the UI last read them).
    for (int c = 0; c < numOuts && c < MaxMeters; ++c) {
        if (! outs[c]) continue;
        float pk = 0.0f;
        for (int i = 0; i < n; ++i) pk = std::max(pk, std::fabs(outs[c][i]));
        auto& m = meters[(size_t) c];
        if (pk > m.load(std::memory_order_relaxed)) m.store(pk, std::memory_order_relaxed);
    }

    pos.store(p, std::memory_order_relaxed);
    if (stopNow) { stopReq.store(false, std::memory_order_release); playing.store(false, std::memory_order_release); clockTransport(0xFC, p, n - 1, t0); idleAcc = 0; }
    else if (p >= cur().songLen) { playing.store(false, std::memory_order_release); finished.store(true); clockTransport(0xFC, p, n - 1, t0); idleAcc = 0; }

    // Timing stats.
    const double sr = cfg.sampleRate;
    const int64_t us = std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - t0).count();
    stats.callbacks.fetch_add(1, std::memory_order_relaxed);
    if (us > stats.cbMaxUs.load(std::memory_order_relaxed)) stats.cbMaxUs.store(us, std::memory_order_relaxed);
    if (us > (int64_t) (0.7e6 * n / sr)) stats.cbOverBudget.fetch_add(1, std::memory_order_relaxed);
}

// Renders `count` frames of song time starting at song sample p into outs[*][off ...].
void Engine::renderSegment(Program& P, float* const* outs, int numOuts, int off, int count, int64_t p, Clock::time_point t0)
{
    if (count <= 0) return;
    constexpr int MaxOuts = 256;
    float* seg[MaxOuts];
    const int no = std::min(numOuts, MaxOuts);
    for (int c = 0; c < no; ++c) seg[c] = outs[c] ? outs[c] + off : nullptr;

    // 1) stems, each at its live level
    for (size_t k = 0; k < P.stems.size(); ++k) {
        auto& s = P.stems[k];
        if (cfg.offline) while (s->readable() < count) s->fill();
        float pk = 0.0f;
        if (s->mixInto(seg, no, count, P.stemGains[k].next(count, rampSamples), &pk)) stats.underruns.fetch_add(1, std::memory_order_relaxed);
        meterTrack(meterSlot((int) k), pk);
    }

    // 2) clicks, per click track: a short decaying cosine burst starting exactly on the hit's sample
    for (size_t k = 0; k < P.clickLanes.size(); ++k) {
        auto& c = P.clickLanes[k];
        if (c.outs.empty()) continue;
        const GainRamp live = P.clickLives[k].next(count, rampSamples);
        auto& voice = c.voice;
        float pk = 0.0f;
        for (int i = 0; i < count; ++i) {
            const int64_t s = p + i;
            while (c.next < c.hits.size() && c.hits[c.next].sample < s) ++c.next; // skip anything missed
            if (c.next < c.hits.size() && c.hits[c.next].sample == s) {
                const auto& h = c.hits[c.next];
                voice.remaining = (int) (0.035 * cfg.sampleRate);
                voice.phase = 0;
                voice.inc = 2.0 * 3.14159265358979 * (h.accent ? 2000.0 : 1500.0) / cfg.sampleRate;
                voice.env = 1.0;
                voice.decay = std::exp(-1.0 / (0.008 * cfg.sampleRate));
                voice.amp = c.gain * (h.accent ? 1.0f : 0.6f) * h.gain;
                ++c.next;
            }
            if (voice.remaining > 0) {
                const float v = voice.amp * (float) (std::cos(voice.phase) * voice.env) * live.at(i);
                pk = std::max(pk, std::fabs(v));
                for (int o : c.outs) if (o >= 0 && o < no && seg[o]) seg[o][i] += v;
                voice.phase += voice.inc; voice.env *= voice.decay; --voice.remaining;
            }
        }
        meterTrack(meterSlot(clickTrackId((int) k)), pk);
    }

    // 2b) spoken cues: what plays at song sample s depends only on s (sample s - start of every cue that
    // has started and not finished), so a start, jump or loop into the middle of a cue plays exactly
    // the right part of it. Under the Cues track's live level.
    if (! P.cueOuts.empty() && ! P.cues.empty()) {
        const GainRamp live = P.cueLive.next(count, rampSamples);
        const int64_t end = p + count;
        // first cue that could still be sounding at p
        auto it = std::lower_bound(P.cues.begin(), P.cues.end(), p - P.longestCue, [](const CueAt& c, int64_t x) { return c.sample < x; });
        float pk = 0.0f;
        for (; it != P.cues.end() && it->sample < end; ++it) {
            const auto& a = *it->audio;
            const int64_t from = std::max(p, it->sample), to = std::min(end, it->sample + (int64_t) a.size());
            for (int64_t s = from; s < to; ++s) {
                const int i = (int) (s - p);
                const float v = a[(size_t) (s - it->sample)] * live.at(i) * P.cueGain;
                pk = std::max(pk, std::fabs(v));
                for (int o : P.cueOuts) if (o >= 0 && o < no && seg[o]) seg[o][i] += v;
            }
        }
        meterTrack(meterSlot(CueTrack), pk);
    }

    // 3) MIDI: schedule each event for the moment its sample leaves the interface
    const double sr = cfg.sampleRate;
    while (nextMidi < P.midiEvents.size() && P.midiEvents[nextMidi].sample < p + count) {
        const auto& e = P.midiEvents[nextMidi++];
        if (e.track >= 0 && e.track < MaxMidiTracks && P.midiMuted[(size_t) e.track].load(std::memory_order_relaxed)) continue; // a muted MIDI track
        const int64_t at = std::max<int64_t>(p, e.sample);
        if (cfg.offline) {
            if (midiLog.size() < midiLog.capacity()) { LoggedMidi l; l.sample = at; l.port = e.port; l.len = e.len; std::copy(e.d, e.d + 3, l.d); midiLog.push_back(l); }
        } else {
            MidiScheduler::Item it;
            it.port = e.port; it.len = e.len; std::copy(e.d, e.d + 3, it.d);
            const int blockOffset = off + (int) (at - p);
            const double secs = (latencyBase.load(std::memory_order_relaxed) + blockOffset) / sr + cfg.midiOffsetMs / 1000.0;
            it.target = t0 + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(secs));
            midi.push(it);
        }
    }
    // 4) MIDI clock: the song's ticks in this segment, to every clock port
    const uint32_t cm = clockMask.load(std::memory_order_relaxed);
    const int np = clockPortCount.load(std::memory_order_relaxed);
    while (nextTick < P.clockTicks.size() && P.clockTicks[nextTick] < p + count) {
        const int64_t at = std::max<int64_t>(p, P.clockTicks[nextTick++]);
        for (int port = 0; port < np; ++port) if ((cm >> port) & 1u) sendAt(port, 0xF8, 0, 0, 1, at, off + (int) (at - p), t0, true);
    }
}

void Engine::sendAt(int port, uint8_t a, uint8_t b, uint8_t c, int len, int64_t logSample, int blockOffset, Clock::time_point t0, bool sys)
{
    if (cfg.offline) {
        if (midiLog.size() < midiLog.capacity()) { LoggedMidi l; l.sample = logSample; l.port = port; l.len = len; l.d[0] = a; l.d[1] = b; l.d[2] = c; midiLog.push_back(l); }
        return;
    }
    MidiScheduler::Item it;
    it.port = port; it.len = len; it.d[0] = a; it.d[1] = b; it.d[2] = c; it.sys = sys;
    const double secs = (latencyBase.load(std::memory_order_relaxed) + blockOffset) / cfg.sampleRate + cfg.midiOffsetMs / 1000.0;
    it.target = t0 + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(secs));
    (sys ? midiClock : midi).push(it);
}

void Engine::clockTransport(uint8_t status, int64_t logSample, int blockOffset, Clock::time_point t0)
{
    const uint32_t tm = transportMask.load(std::memory_order_relaxed);
    for (int port = 0; port < clockPortCount.load(std::memory_order_relaxed); ++port)
        if ((tm >> port) & 1u) sendAt(port, status, 0, 0, 1, logSample, blockOffset, t0, true);
}

// Stopped: the clock keeps running at the next song's starting tempo (delays and modulation stay right). In offline
// mode the ticks are logged against a running sample count of the stopped time.
void Engine::clockIdle(int n, Clock::time_point t0)
{
    const uint32_t cm = clockMask.load(std::memory_order_relaxed);
    const int np = clockPortCount.load(std::memory_order_relaxed);
    if (np <= 0 || cm == 0 || cfg.sampleRate <= 0) { idleSample += n; return; }
    // the next song (waiting in the next slot) if there is one, else the loaded one
    const Program* nx = nextLoaded.load(std::memory_order_acquire) ? other() : nullptr;
    const auto& tm = (nx && nx->tmap.numBars() > 0 ? *nx : cur()).tmap;
    const double bpm = tm.numBars() > 0 && tm.bar(1).bpm > 0 ? tm.bar(1).bpm : 120.0;
    const double tick = 60.0 / bpm * cfg.sampleRate / 24.0;
    if (idleAcc > tick) idleAcc = tick; // the tempo went up: never wait longer than one tick
    while (idleAcc < n) {
        const int off = (int) idleAcc;
        for (int port = 0; port < np; ++port) if ((cm >> port) & 1u) sendAt(port, 0xF8, 0, 0, 1, idleSample + off, off, t0, true);
        idleAcc += tick;
    }
    idleAcc -= n; idleSample += n;
}

} // namespace setline
