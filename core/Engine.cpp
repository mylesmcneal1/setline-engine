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
    playing = false;
    waitForCallbackToFinish();
    diskRun = false;
    if (disk.joinable()) disk.join();
    cfg = c;
    stems.clear(); clicks.clear(); midiEvents.clear();

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
    for (int o : song.clickOuts) maxOut = std::max(maxOut, o);
    if (maxOut < 0) maxOut = 1;

    // --- tempo map ---
    int lastBar = 1;
    for (auto& t : song.tempo) { lastBar = std::max(lastBar, t.bar); if (t.ramp) warnings.push_back("Tempo ramp at bar " + std::to_string(t.bar) + " is played as a jump in this spike."); }
    for (auto& m : song.midi) lastBar = std::max(lastBar, m.bar);
    tmap.build(song.tempo, cfg.sampleRate, songLen, lastBar);
    if (songLen == 0) songLen = tmap.sampleAt(lastBar + 1, 1);

    // --- click (generated, sample-exact on every beat) ---
    clickOuts = song.clickOuts;
    clickGain = std::pow(10.0f, song.clickGainDb / 20.0f);
    if (! clickOuts.empty())
        for (int b = 1; b <= tmap.numBars(); ++b) {
            const auto& bar = tmap.bar(b);
            for (int k = 0; k < bar.num; ++k) {
                const int64_t s = tmap.sampleAt(b, k + 1);
                if (s >= songLen) break;
                clicks.push_back({ s, k == 0 });
            }
        }

    // --- MIDI ---
    for (auto& m : song.midi) {
        if (m.port < 0) { warnings.push_back("MIDI event \"" + m.label + "\" at bar " + std::to_string(m.bar) + " has no output port; skipped."); continue; }
        MidiAt e; e.sample = tmap.sampleAt(m.bar, m.beat); e.port = m.port; e.len = m.len;
        std::copy(m.bytes, m.bytes + 3, e.d);
        midiEvents.push_back(e);
    }
    std::stable_sort(midiEvents.begin(), midiEvents.end(), [](auto& a, auto& b) { return a.sample < b.sample; });
    midiLog.clear(); midiLog.reserve(midiEvents.size() + 16);

    pos = 0; nextClick = 0; nextMidi = 0; voice = {};
    if (! cfg.offline) { diskRun = true; disk = std::thread([this] { diskLoop(); }); }
    return {};
}

void Engine::setDeviceTiming(int bufferSamples, int outputLatencySamples)
{
    latencyBase.store(bufferSamples + outputLatencySamples);
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

void Engine::stop()
{
    std::lock_guard<std::mutex> lk(control);
    playing.store(false, std::memory_order_release);
    waitForCallbackToFinish();
    midi.flush();
}

bool Engine::start(int timeoutMs)
{
    std::lock_guard<std::mutex> lk(control);
    playing.store(false, std::memory_order_release);
    waitForCallbackToFinish(); // from here on the audio thread does not touch any stem
    midi.flush();
    for (auto& s : stems) s->requestSeek(0);
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
    pos.store(0); nextClick = 0; nextMidi = 0; voice = {};
    finished = false;
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

    // 1) stems
    for (auto& s : stems) {
        if (cfg.offline) while (s->readable() < n) s->fill();
        if (s->mixInto(outs, numOuts, n)) stats.underruns.fetch_add(1, std::memory_order_relaxed);
    }

    // 2) click: a short decaying cosine burst starting exactly on the beat sample
    if (! clickOuts.empty()) {
        for (int i = 0; i < n; ++i) {
            const int64_t s = p0 + i;
            while (nextClick < clicks.size() && clicks[nextClick].sample < s) ++nextClick; // skip anything missed
            if (nextClick < clicks.size() && clicks[nextClick].sample == s) {
                const bool acc = clicks[nextClick].accent;
                voice.remaining = (int) (0.035 * cfg.sampleRate);
                voice.phase = 0;
                voice.inc = 2.0 * 3.14159265358979 * (acc ? 2000.0 : 1500.0) / cfg.sampleRate;
                voice.env = 1.0;
                voice.decay = std::exp(-1.0 / (0.008 * cfg.sampleRate));
                voice.amp = clickGain * (acc ? 1.0f : 0.6f);
                ++nextClick;
            }
            if (voice.remaining > 0) {
                const float v = voice.amp * (float) (std::cos(voice.phase) * voice.env);
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

    pos.store(p0 + n, std::memory_order_relaxed);
    if (p0 + n >= songLen) { playing.store(false, std::memory_order_release); finished.store(true); }

    // 4) timing stats
    const int64_t us = std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - t0).count();
    stats.callbacks.fetch_add(1, std::memory_order_relaxed);
    if (us > stats.cbMaxUs.load(std::memory_order_relaxed)) stats.cbMaxUs.store(us, std::memory_order_relaxed);
    if (us > (int64_t) (0.7e6 * n / sr)) stats.cbOverBudget.fetch_add(1, std::memory_order_relaxed);
}

} // namespace setline
