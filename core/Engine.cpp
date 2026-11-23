#include "Engine.h"
#include "Platform.h"
#include <algorithm>
#include <chrono>
#include <cmath>

namespace setline {

Engine::Engine() = default;

Engine::~Engine()
{
    stop();
    diskRun = false;
    if (disk.joinable()) disk.join();
    midi.stop();
}

void Engine::setMidiSink(MidiSink* s)
{
    sink = s;
    if (! cfg.offline) midi.start(sink);
}

std::string Engine::load(const SongDef& song, const Config& c, std::vector<std::string>& warnings)
{
    std::lock_guard<std::mutex> lk(control);
    fadeOutAndStop(); // switching songs while playing: fade out first, never cut
    diskRun = false;
    if (disk.joinable()) disk.join();
    cfg = c;
    stems.clear(); clicks.clear(); midiEvents.clear();
    rampSamples = std::max(1, (int) std::lround(0.010 * cfg.sampleRate));    // live level changes
    fadeOutSamples = std::max(1, (int) std::lround(0.010 * cfg.sampleRate)); // stop

    // --- stems: same sample rate as the device, always. No resampling, no stretching. ---
    songLen = 0; maxOut = -1;
    for (auto& s : song.stems) {
        if (! s.source) return "Stem \"" + s.name + "\" could not be opened.";
        if (s.source->numChannels() < 1 || s.source->numChannels() > 2)
            return "Stem \"" + s.name + "\" has " + std::to_string(s.source->numChannels()) + " channels. Use mono or stereo files.";
        if (std::abs(s.source->sampleRate() - cfg.sampleRate) > 0.5)
            return "Stem \"" + s.name + "\" is " + std::to_string((int) s.source->sampleRate()) + " Hz but the device runs at "
                 + std::to_string((int) cfg.sampleRate) + " Hz. set.Line never resamples; export the stems at the show rate.";
        if (s.outs.empty()) { warnings.push_back("Stem \"" + s.name + "\" has no outputs; it will be silent."); }
        for (int o : s.outs) maxOut = std::max(maxOut, o);
        songLen = std::max(songLen, s.source->length());
        auto st = std::make_unique<StemStreamer>(s, cfg.ringFrames, cfg.chunkFrames);
        st->setName(s.name);
        stems.push_back(std::move(st));
    }
    // Live levels: a new song starts at 0 dB, unmuted; the app sets its levels after loading.
    stemGains = std::make_unique<LiveGain[]>(stems.size());
    clickLive.set(1.0f); cueLive.set(1.0f);
    for (int o : song.clickOuts) maxOut = std::max(maxOut, o);
    if (maxOut < 0) maxOut = 1;

    // --- tempo map: long enough for the stems, the tempo changes and all the content ---
    int lastBar = std::max(1, song.lengthBars);
    for (auto& t : song.tempo) { lastBar = std::max(lastBar, t.bar); if (t.ramp) warnings.push_back("Tempo ramp at bar " + std::to_string(t.bar) + " is played as a jump for now."); }
    for (auto& m : song.midi) lastBar = std::max(lastBar, m.bar);
    if (song.clickHits) for (auto& h : *song.clickHits) lastBar = std::max(lastBar, h.bar);
    tmap.build(song.tempo, cfg.sampleRate, songLen, lastBar);
    // With stems, the song is as long as its longest stem (as before). Without stems it lasts until the
    // end of the last bar of its tempo map / content. lengthBars, when given, is a minimum either way.
    if (stems.empty()) songLen = tmap.sampleAt(lastBar + 1, 1);
    else if (song.lengthBars > 0) songLen = std::max(songLen, tmap.sampleAt(song.lengthBars + 1, 1));

    // --- click ---
    clickOuts = song.clickOuts;
    clickGain = LiveGain::dbToGain(song.clickGainDb);
    if (! clickOuts.empty()) {
        if (song.clickHits) {
            // Exactly what the user entered, nothing generated.
            for (auto& h : *song.clickHits) {
                if (h.bar < 1 || h.beat < 1) continue;
                const int64_t s = tmap.sampleAt(h.bar, h.beat);
                if (s < songLen) clicks.push_back({ s, h.accent, LiveGain::dbToGain(h.gainDb) });
            }
            std::stable_sort(clicks.begin(), clicks.end(), [](auto& a, auto& b) { return a.sample < b.sample; });
            // Two hits on the same sample play once (the louder / accented one).
            std::vector<ClickHit> unique;
            for (auto& h : clicks) {
                if (! unique.empty() && unique.back().sample == h.sample) {
                    unique.back().accent |= h.accent; unique.back().gain = std::max(unique.back().gain, h.gain);
                } else unique.push_back(h);
            }
            clicks.swap(unique);
        } else {
            // Every beat (test song / spike).
            for (int b = 1; b <= tmap.numBars(); ++b) {
                const auto& bar = tmap.bar(b);
                for (int k = 0; k < bar.num; ++k) {
                    const int64_t s = tmap.sampleAt(b, k + 1);
                    if (s >= songLen) break;
                    clicks.push_back({ s, k == 0, 1.0f });
                }
            }
        }
    }

    // --- MIDI ---
    for (auto& m : song.midi) {
        if (m.port < 0) { warnings.push_back("MIDI event \"" + m.label + "\" at bar " + std::to_string(m.bar) + " has no output port; skipped."); continue; }
        MidiAt e; e.port = m.port; e.len = m.len;
        e.sample = std::max<int64_t>(0, tmap.sampleAt(m.bar, m.beat) - (int64_t) std::llround(m.earlySeconds * cfg.sampleRate));
        std::copy(m.bytes, m.bytes + 3, e.d);
        midiEvents.push_back(e);
    }
    std::stable_sort(midiEvents.begin(), midiEvents.end(), [](auto& a, auto& b) { return a.sample < b.sample; });
    midiLog.clear(); midiLog.reserve(midiEvents.size() + 16);

    pos = 0; nextClick = 0; nextMidi = 0; voice = {};
    fadeInLeft = fadeInLen = fadeOutLeft = 0;
    if (! cfg.offline) { diskRun = true; disk = std::thread([this] { diskLoop(); }); }
    return {};
}

void Engine::setDeviceTiming(int bufferSamples, int outputLatencySamples)
{
    latencyBase.store(bufferSamples + outputLatencySamples);
}

void Engine::setTrackLevel(int track, float db, bool mute)
{
    const float g = mute ? 0.0f : LiveGain::dbToGain(db);
    if (track == ClickTrack) clickLive.set(g);
    else if (track == CueTrack) cueLive.set(g); // cue audio arrives with step 2; the level is ready for it
    else if (track >= 0 && track < (int) stems.size() && stemGains) stemGains[(size_t) track].set(g);
}

void Engine::diskLoop()
{
    platform::makeThisThreadHighPriority();
    while (diskRun) {
        bool worked = false;
        for (auto& s : stems) worked |= s->fill();
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
    if (playing.load(std::memory_order_acquire) && deviceRunning.load() && ! cfg.offline) {
        // Let the callback fade out (10 ms) and stop by itself; give up waiting after 250 ms.
        stopReq.store(true, std::memory_order_release);
        const auto until = Clock::now() + std::chrono::milliseconds(250);
        while (playing.load(std::memory_order_acquire) && Clock::now() < until) std::this_thread::sleep_for(std::chrono::microseconds(500));
    }
    playing.store(false, std::memory_order_release);
    stopReq.store(false, std::memory_order_release);
    waitForCallbackToFinish(); // from here on the audio thread does not touch any stem
}

void Engine::stop()
{
    std::lock_guard<std::mutex> lk(control);
    fadeOutAndStop();
    midi.flush();
}

bool Engine::start(int64_t fromSample, int timeoutMs)
{
    std::lock_guard<std::mutex> lk(control);
    fadeOutAndStop();
    midi.flush();
    if (fromSample < 0) fromSample = 0;
    if (fromSample >= songLen) return false;

    // Audio starts up to 5 ms early so the fade-in is over by fromSample; click and MIDI start at fromSample.
    const int64_t preroll = std::min<int64_t>(fromSample, std::lround(0.005 * cfg.sampleRate));
    const int64_t audioFrom = fromSample - preroll;
    for (auto& s : stems) s->requestSeek(audioFrom);
    if (cfg.offline) {
        for (auto& s : stems) while (! s->primed()) s->fill();
    } else {
        const auto until = Clock::now() + std::chrono::milliseconds(timeoutMs);
        auto allPrimed = [&] { for (auto& s : stems) if (! s->primed()) return false; return true; };
        while (! allPrimed()) {
            if (Clock::now() > until) return false;
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    }
    nextClick = (size_t) (std::lower_bound(clicks.begin(), clicks.end(), fromSample, [](const ClickHit& h, int64_t s) { return h.sample < s; }) - clicks.begin());
    nextMidi = (size_t) (std::lower_bound(midiEvents.begin(), midiEvents.end(), fromSample, [](const MidiAt& m, int64_t s) { return m.sample < s; }) - midiEvents.begin());
    voice = {};
    fadeInLeft = fadeInLen = (int) preroll;
    fadeOutLeft = 0;
    for (size_t i = 0; i < stems.size(); ++i) stemGains[i].snap(); // levels set while stopped apply at once
    clickLive.snap(); cueLive.snap();
    pos.store(audioFrom);
    finished = false;
    stopReq.store(false);
    playing.store(true, std::memory_order_release);
    return true;
}

void Engine::process(float* const* outs, int numOuts, int n)
{
    const auto t0 = Clock::now();
    for (int c = 0; c < numOuts; ++c) if (outs[c]) std::fill(outs[c], outs[c] + n, 0.0f);
    serial.fetch_add(1, std::memory_order_acq_rel);
    if (! playing.load(std::memory_order_acquire)) return;

    const int64_t p0 = pos.load(std::memory_order_relaxed);

    // 1) stems, each at its live level
    for (size_t k = 0; k < stems.size(); ++k) {
        auto& s = stems[k];
        if (cfg.offline) while (s->readable() < n) s->fill();
        if (s->mixInto(outs, numOuts, n, stemGains[k].next(n, rampSamples))) stats.underruns.fetch_add(1, std::memory_order_relaxed);
    }

    // 2) click: a short decaying cosine burst starting exactly on the hit's sample
    if (! clickOuts.empty()) {
        const GainRamp live = clickLive.next(n, rampSamples);
        for (int i = 0; i < n; ++i) {
            const int64_t s = p0 + i;
            while (nextClick < clicks.size() && clicks[nextClick].sample < s) ++nextClick; // skip anything missed
            if (nextClick < clicks.size() && clicks[nextClick].sample == s) {
                const auto& h = clicks[nextClick];
                voice.remaining = (int) (0.035 * cfg.sampleRate);
                voice.phase = 0;
                voice.inc = 2.0 * 3.14159265358979 * (h.accent ? 2000.0 : 1500.0) / cfg.sampleRate;
                voice.env = 1.0;
                voice.decay = std::exp(-1.0 / (0.008 * cfg.sampleRate));
                voice.amp = clickGain * (h.accent ? 1.0f : 0.6f) * h.gain;
                ++nextClick;
            }
            if (voice.remaining > 0) {
                const float v = voice.amp * (float) (std::cos(voice.phase) * voice.env) * live.at(i);
                for (int o : clickOuts) if (o >= 0 && o < numOuts && outs[o]) outs[o][i] += v;
                voice.phase += voice.inc; voice.env *= voice.decay; --voice.remaining;
            }
        }
    }

    // 3) MIDI: schedule each event for the moment its sample leaves the interface
    const double sr = cfg.sampleRate;
    while (nextMidi < midiEvents.size() && midiEvents[nextMidi].sample < p0 + n) {
        const auto& e = midiEvents[nextMidi++];
        const int off = (int) std::max<int64_t>(0, e.sample - p0);
        if (cfg.offline) {
            if (midiLog.size() < midiLog.capacity()) { LoggedMidi l; l.sample = p0 + off; l.port = e.port; l.len = e.len; std::copy(e.d, e.d + 3, l.d); midiLog.push_back(l); }
        } else {
            MidiScheduler::Item it;
            it.port = e.port; it.len = e.len; std::copy(e.d, e.d + 3, it.d);
            const double secs = (latencyBase.load(std::memory_order_relaxed) + off) / sr + cfg.midiOffsetMs / 1000.0;
            it.target = t0 + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(secs));
            midi.push(it);
        }
    }

    // 4) fades: in when starting inside the song, out when stopping (never a hard cut)
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

    // 5) output meters (peak since the UI last read them)
    for (int c = 0; c < numOuts && c < MaxMeters; ++c) {
        if (! outs[c]) continue;
        float pk = 0.0f;
        for (int i = 0; i < n; ++i) pk = std::max(pk, std::fabs(outs[c][i]));
        auto& m = meters[(size_t) c];
        if (pk > m.load(std::memory_order_relaxed)) m.store(pk, std::memory_order_relaxed);
    }

    pos.store(p0 + n, std::memory_order_relaxed);
    if (stopNow) { stopReq.store(false, std::memory_order_release); playing.store(false, std::memory_order_release); }
    else if (p0 + n >= songLen) { playing.store(false, std::memory_order_release); finished.store(true); }

    // 6) timing stats
    const int64_t us = std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - t0).count();
    stats.callbacks.fetch_add(1, std::memory_order_relaxed);
    if (us > stats.cbMaxUs.load(std::memory_order_relaxed)) stats.cbMaxUs.store(us, std::memory_order_relaxed);
    if (us > (int64_t) (0.7e6 * n / sr)) stats.cbOverBudget.fetch_add(1, std::memory_order_relaxed);
}

} // namespace setline
