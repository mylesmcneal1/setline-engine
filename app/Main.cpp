// set.Line engine spike — command-line app.
// JUCE is only used here: the audio device, MIDI ports, reading stem files and song.json.
// All timing-critical work happens in core/ (plain C++, tested without JUCE).

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>

#include "../core/Engine.h"
#include "../core/Platform.h"
#include "../core/TestSong.h"
#include "../core/Wav.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <iostream>
#include <string>
#include <thread>

using namespace setline;

// ------------------------------------------------------------------ helpers

static void say(const juce::String& s) { std::cout << s.toStdString() << std::endl; }

struct Args {
    juce::StringArray a;
    bool has(const juce::String& k) const { return a.contains(k); }
    juce::String get(const juce::String& k, const juce::String& def = {}) const
    {
        const int i = a.indexOf(k);
        return (i >= 0 && i + 1 < a.size()) ? a[i + 1] : def;
    }
};

// Stem files are read through JUCE (WAV, AIFF, FLAC), one chunk at a time, on the disk thread.
struct JuceSource : SampleSource {
    std::unique_ptr<juce::AudioFormatReader> r;
    int numChannels() const override { return (int) r->numChannels; }
    int64_t length() const override { return (int64_t) r->lengthInSamples; }
    double sampleRate() const override { return r->sampleRate; }
    bool read(float* const* dest, int64_t start, int n) override
    {
        juce::AudioBuffer<float> b(dest, numChannels(), n);
        r->read(&b, 0, n, (juce::int64) start, true, numChannels() > 1);
        return true;
    }
};

struct JuceMidiSink : MidiSink {
    std::vector<std::unique_ptr<juce::MidiOutput>> outs;
    juce::StringArray names;
    void sendNow(int port, const uint8_t* d, int len) override
    {
        if (port >= 0 && port < (int) outs.size() && outs[(size_t) port])
            outs[(size_t) port]->sendMessageNow(juce::MidiMessage(d, len));
    }
    // "" = first available port, otherwise a case-insensitive part of the port name.
    int resolve(const juce::String& want, std::vector<std::string>& warnings)
    {
        const auto avail = juce::MidiOutput::getAvailableDevices();
        for (const auto& info : avail) {
            if (want.isNotEmpty() && ! info.name.containsIgnoreCase(want)) continue;
            const int already = names.indexOf(info.name);
            if (already >= 0) return already;
            auto o = juce::MidiOutput::openDevice(info.identifier);
            if (! o) { warnings.push_back("Couldn't open MIDI output " + info.name.toStdString()); return -1; }
            outs.push_back(std::move(o)); names.add(info.name);
            return (int) outs.size() - 1;
        }
        warnings.push_back(want.isEmpty() ? std::string("No MIDI outputs found; MIDI events are skipped.")
                                          : "No MIDI output matches \"" + want.toStdString() + "\"; its events are skipped.");
        return -1;
    }
};

// ------------------------------------------------------------------ song.json

static juce::String loadSong(const juce::File& dir, SongDef& song, double& rate, juce::AudioFormatManager& fm,
                             JuceMidiSink* midiSink, const juce::String& portOverride, std::vector<std::string>& warnings)
{
    const auto jf = dir.getChildFile("song.json");
    if (! jf.existsAsFile()) return "No song.json in " + dir.getFullPathName();
    const juce::var v = juce::JSON::parse(jf);
    if (! v.isObject()) return "song.json isn't valid JSON";

    song.name = v.getProperty("name", dir.getFileName()).toString().toStdString();

    if (auto* arr = v["tempo"].getArray())
        for (auto& t : *arr) {
            TempoChange c;
            c.bar = (int) t.getProperty("bar", 1);
            c.bpm = (double) t.getProperty("bpm", 0.0);
            if (auto* sig = t["sig"].getArray(); sig && sig->size() == 2) { c.num = (int) (*sig)[0]; c.den = (int) (*sig)[1]; }
            c.ramp = (bool) t.getProperty("ramp", false);
            song.tempo.push_back(c);
        }
    if (song.tempo.empty()) warnings.push_back("No tempo in song.json; using 120 BPM 4/4.");

    rate = 0;
    if (auto* arr = v["stems"].getArray())
        for (auto& s : *arr) {
            const auto file = dir.getChildFile(s.getProperty("file", "").toString());
            StemDef d;
            d.name = file.getFileNameWithoutExtension().toStdString();
            auto src = std::make_shared<JuceSource>();
            src->r = std::unique_ptr<juce::AudioFormatReader>(fm.createReaderFor(file));
            if (! src->r) return "Can't read stem " + file.getFullPathName();
            if (rate == 0) rate = src->r->sampleRate;
            d.source = src;
            if (auto* outs = s["out"].getArray()) for (auto& o : *outs) d.outs.push_back((int) o - 1);
            d.gainDb = (float) (double) s.getProperty("gain_db", 0.0);
            song.stems.push_back(d);
        }
    if (song.stems.empty()) return "song.json has no stems";

    if (v.hasProperty("click")) {
        const auto& c = v["click"];
        if (auto* outs = c["out"].getArray()) for (auto& o : *outs) song.clickOuts.push_back((int) o - 1);
        song.clickGainDb = (float) (double) c.getProperty("gain_db", -6.0);
    }

    if (auto* arr = v["midi"].getArray())
        for (auto& m : *arr) {
            MidiEventDef e;
            e.bar = (int) m.getProperty("bar", 1);
            e.beat = (double) m.getProperty("beat", 1.0);
            const int ch = juce::jlimit(1, 16, (int) m.getProperty("ch", 1)) - 1;
            const auto type = m.getProperty("type", "pc").toString();
            if (type == "pc") { e.bytes[0] = (uint8_t) (0xC0 | ch); e.bytes[1] = (uint8_t) juce::jlimit(0, 127, (int) m.getProperty("program", 0)); e.len = 2; }
            else if (type == "cc") { e.bytes[0] = (uint8_t) (0xB0 | ch); e.bytes[1] = (uint8_t) juce::jlimit(0, 127, (int) m.getProperty("cc", 0)); e.bytes[2] = (uint8_t) juce::jlimit(0, 127, (int) m.getProperty("value", 0)); e.len = 3; }
            else if (type == "note_on") { e.bytes[0] = (uint8_t) (0x90 | ch); e.bytes[1] = (uint8_t) juce::jlimit(0, 127, (int) m.getProperty("note", 60)); e.bytes[2] = (uint8_t) juce::jlimit(1, 127, (int) m.getProperty("velocity", 100)); e.len = 3; }
            else if (type == "note_off") { e.bytes[0] = (uint8_t) (0x80 | ch); e.bytes[1] = (uint8_t) juce::jlimit(0, 127, (int) m.getProperty("note", 60)); e.len = 3; }
            else { warnings.push_back("Unknown MIDI type \"" + type.toStdString() + "\" skipped."); continue; }
            e.label = type.toStdString() + " bar " + std::to_string(e.bar);
            const juce::String want = portOverride.isNotEmpty() ? portOverride : m.getProperty("port", "").toString();
            e.port = midiSink ? midiSink->resolve(want, warnings) : 0;
            song.midi.push_back(e);
        }
    return {};
}

static void printWarnings(std::vector<std::string>& w)
{
    std::sort(w.begin(), w.end()); w.erase(std::unique(w.begin(), w.end()), w.end());
    for (auto& s : w) say("  ! " + juce::String(s));
}

// ------------------------------------------------------------------ --list

static void listDevices()
{
    juce::AudioDeviceManager dm;
    dm.initialise(0, 2, nullptr, true);
    say("Audio outputs");
    for (auto* type : dm.getAvailableDeviceTypes()) {
        type->scanForDevices();
        for (auto& name : type->getDeviceNames(false)) {
            std::unique_ptr<juce::AudioIODevice> d(type->createDevice(name, {}));
            juce::String line = "  [" + type->getTypeName() + "] " + name;
            if (d) {
                juce::StringArray rates, sizes;
                for (auto r : d->getAvailableSampleRates()) rates.add(juce::String((int) r));
                for (auto s : d->getAvailableBufferSizes()) sizes.add(juce::String(s));
                line << "  |  " << d->getOutputChannelNames().size() << " outputs  |  rates " << rates.joinIntoString("/")
                     << "  |  buffers " << sizes.joinIntoString("/");
            }
            say(line);
            if (d) { const auto names = d->getOutputChannelNames(); for (int i = 0; i < names.size(); ++i) say("      out " + juce::String(i + 1).paddedLeft(' ', 2) + "  " + names[i]); }
        }
    }
    say("MIDI outputs");
    for (auto& m : juce::MidiOutput::getAvailableDevices()) say("  " + m.name);
}

// ------------------------------------------------------------------ --play

struct Callback : juce::AudioIODeviceCallback {
    Engine& e;
    explicit Callback(Engine& en) : e(en) {}
    void audioDeviceIOCallbackWithContext(const float* const*, int, float* const* out, int numOut, int n,
                                          const juce::AudioIODeviceCallbackContext&) override
    {
        e.process(out, numOut, n);
    }
    void audioDeviceAboutToStart(juce::AudioIODevice* d) override
    {
        e.setDeviceTiming(d->getCurrentBufferSizeSamples(), d->getOutputLatencyInSamples());
        e.setDeviceRunning(true);
    }
    void audioDeviceStopped() override { e.setDeviceRunning(false); }
};

static int play(const Args& args)
{
    const juce::File dir(juce::File::getCurrentWorkingDirectory().getChildFile(args.get("--play")));
    juce::AudioFormatManager fm; fm.registerBasicFormats();
    JuceMidiSink midiSink;
    SongDef song; double rate = 0; std::vector<std::string> warn;
    if (auto err = loadSong(dir, song, rate, fm, &midiSink, args.get("--midi-port"), warn); err.isNotEmpty()) { say("Error: " + err); return 2; }

    int needOuts = 1;
    for (auto& s : song.stems) for (int o : s.outs) needOuts = std::max(needOuts, o + 1);
    for (int o : song.clickOuts) needOuts = std::max(needOuts, o + 1);

    // --- open the device at the stems' sample rate ---
    juce::AudioDeviceManager dm;
    dm.initialise(0, needOuts, nullptr, true);
    juce::String chosen;
    const juce::String want = args.get("--device"), driver = args.get("--driver");
    if (want.isNotEmpty() || driver.isNotEmpty()) {
        // Any interface works; only the driver differs. When several drivers reach the same interface,
        // prefer the lowest-latency one. Windows: ASIO, then WASAPI exclusive / low-latency, then shared.
        // macOS: Core Audio (class-compliant and vendor-driver interfaces alike).
        const juce::StringArray pref { "ASIO", "Exclusive", "Low Latency", "Windows Audio", "CoreAudio", "DirectSound" };
        juce::Array<juce::AudioIODeviceType*> types;
        for (auto* t : dm.getAvailableDeviceTypes()) if (driver.isEmpty() || t->getTypeName().containsIgnoreCase(driver)) types.add(t);
        auto rank = [&](juce::AudioIODeviceType* t) { for (int i = 0; i < pref.size(); ++i) if (t->getTypeName().containsIgnoreCase(pref[i])) return i; return pref.size(); };
        std::stable_sort(types.begin(), types.end(), [&](auto* a, auto* b) { return rank(a) < rank(b); });
        for (auto* type : types) {
            if (chosen.isNotEmpty()) break;
            type->scanForDevices();
            for (auto& name : type->getDeviceNames(false))
                if (want.isEmpty() || name.containsIgnoreCase(want)) { dm.setCurrentAudioDeviceType(type->getTypeName(), true); chosen = name; break; }
        }
        if (chosen.isEmpty()) { say("Error: no audio output matches device \"" + want + "\"" + (driver.isNotEmpty() ? " on driver \"" + driver + "\"" : juce::String()) + ". Run --list to see them."); return 2; }
    }
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    dm.getAudioDeviceSetup(setup);
    if (chosen.isNotEmpty()) setup.outputDeviceName = chosen;
    setup.inputDeviceName = {};
    setup.sampleRate = rate;
    setup.bufferSize = args.get("--buffer", "128").getIntValue();
    setup.useDefaultOutputChannels = false; setup.outputChannels.clear(); setup.outputChannels.setRange(0, needOuts, true);
    setup.useDefaultInputChannels = false; setup.inputChannels.clear();
    if (auto err = dm.setAudioDeviceSetup(setup, true); err.isNotEmpty()) { say("Error opening the device: " + err); return 2; }
    auto* dev = dm.getCurrentAudioDevice();
    if (! dev) { say("Error: no audio device"); return 2; }
    if (std::abs(dev->getCurrentSampleRate() - rate) > 0.5) {
        say("Error: the device is running at " + juce::String(dev->getCurrentSampleRate()) + " Hz but the stems are " + juce::String(rate)
            + " Hz. set.Line never resamples; set the interface to the stems' rate (Audio MIDI Setup on Mac, the interface's control panel on Windows) or export at the show rate.");
        return 2;
    }
    if (dev->getActiveOutputChannels().countNumberOfSetBits() < needOuts) {
        say("Error: the song needs " + juce::String(needOuts) + " outputs but " + dev->getName() + " only opened "
            + juce::String(dev->getActiveOutputChannels().countNumberOfSetBits()) + ".");
        return 2;
    }

    // --- engine ---
    Engine engine;
    Engine::Config cfg; cfg.sampleRate = rate; cfg.numOutputs = needOuts; cfg.midiOffsetMs = args.get("--midi-offset", "0").getDoubleValue();
    if (auto err = engine.load(song, cfg, warn); ! err.empty()) { say("Error: " + juce::String(err)); return 2; }
    engine.setMidiSink(&midiSink);
    // --midi-clock: 24 ppqn on every MIDI port in use (6g); --midi-transport adds Start/Stop/Continue + Song Position
    if (args.has("--midi-clock")) engine.setMidiClock(0xffffffffu, args.has("--midi-transport") ? 0xffffffffu : 0u, midiSink.names.size());
    Callback cb(engine);
    dm.addAudioCallback(&cb);

    const double bufMs = 1000.0 * dev->getCurrentBufferSizeSamples() / rate;
    say("set.Line engine spike");
    say("  song    " + juce::String(song.name) + "  (" + juce::String((int) song.stems.size()) + " stems, " + juce::String(engine.lengthSamples() / rate, 1) + " s)");
    say("  device  " + dev->getTypeName() + " / " + dev->getName() + "  @ " + juce::String((int) rate) + " Hz, buffer "
        + juce::String(dev->getCurrentBufferSizeSamples()) + " (" + juce::String(bufMs, 2) + " ms), output latency "
        + juce::String(dev->getOutputLatencyInSamples()) + " samples");
    say("  midi    " + (midiSink.names.isEmpty() ? juce::String("none") : midiSink.names.joinIntoString(", ")) + "   offset " + juce::String(cfg.midiOffsetMs, 2) + " ms");
    printWarnings(warn);

    const double soakMin = args.get("--soak", "0").getDoubleValue();
    int loops = args.get("--loops", "0").getIntValue();
    const bool autoplay = soakMin > 0 || args.has("--autoplay") || loops > 0;
    static std::atomic<int> cmd { 0 }; // 1 toggle, 2 quit (static: the stdin thread may outlive this function)
    if (soakMin <= 0) {
        say("\n  Enter = play/stop    q + Enter = quit\n");
        std::thread([] { std::string line; while (std::getline(std::cin, line)) { cmd = (line == "q" || line == "Q") ? 2 : 1; if (cmd == 2) break; } }).detach();
    } else say("\n  Soak test: " + juce::String(soakMin, 1) + " min, looping the song. Ctrl+C to abort.\n");

    auto startPlay = [&] { if (! engine.start()) say("  ! preroll timed out: the disk can't fill the buffers in 5 s"); };
    if (autoplay) startPlay();

    const auto t0 = std::chrono::steady_clock::now();
    int songsPlayed = 0, tick = 0;
    const int xr0 = dev->getXRunCount();
    while (true) {
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
        if (cmd == 2) break;
        if (cmd == 1) { cmd = 0; if (engine.isPlaying()) engine.stop(); else startPlay(); }
        if (engine.takeFinished()) {
            ++songsPlayed;
            if (soakMin > 0 || --loops > 0) startPlay(); else say("  end of song");
        }
        const double elapsedMin = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count() / 60.0;
        if (soakMin > 0 && elapsedMin >= soakMin) break;
        if (++tick % (soakMin > 0 ? 40 : 4) != 0) continue;

        int bar; double beat; engine.tempoMap().barBeatAt(engine.position(), bar, beat);
        const auto sent = engine.midi.sent.load();
        const int xr = dev->getXRunCount();
        juce::String line;
        line << (engine.isPlaying() ? "  > " : "    ") << "bar " << juce::String(bar).paddedLeft(' ', 3) << "." << (int) beat
             << "  " << juce::String(engine.position() / rate, 1).paddedLeft(' ', 6) << " s"
             << " | cpu " << juce::String(dm.getCpuUsage() * 100.0, 1) << "%"
             << " | worst cb " << juce::String(engine.stats.cbMaxUs.load() / 1000.0, 2) << "/" << juce::String(bufMs, 2) << " ms"
             << " | xruns " << (xr < 0 ? juce::String("n/a") : juce::String(xr - xr0))
             << " | underruns " << engine.stats.underruns.load()
             << " | midi " << sent << " sent, late avg " << juce::String(sent ? engine.midi.lateSumUs.load() / 1000.0 / (double) sent : 0.0, 2)
             << " max " << juce::String(engine.midi.lateMaxUs.load() / 1000.0, 2) << " ms";
        say(line);
    }

    engine.stop();
    dm.removeAudioCallback(&cb);
    const int xr = dev->getXRunCount();
    const auto sent = engine.midi.sent.load();
    const bool pass = engine.stats.underruns.load() == 0 && (xr < 0 || xr - xr0 == 0) && engine.midi.dropped.load() == 0
                   && engine.midi.lateMaxUs.load() < 2000 && engine.stats.cbOverBudget.load() == 0;
    say("\nSummary");
    say("  songs played        " + juce::String(songsPlayed));
    say("  audio callbacks     " + juce::String(engine.stats.callbacks.load()) + ", worst " + juce::String(engine.stats.cbMaxUs.load() / 1000.0, 3)
        + " ms of " + juce::String(bufMs, 3) + " ms, over 70% of budget: " + juce::String(engine.stats.cbOverBudget.load()));
    say("  device xruns        " + (xr < 0 ? juce::String("not reported by this driver") : juce::String(xr - xr0)));
    say("  disk underruns      " + juce::String(engine.stats.underruns.load()));
    say("  MIDI                " + juce::String(sent) + " sent, " + juce::String(engine.midi.dropped.load()) + " dropped, late avg "
        + juce::String(sent ? engine.midi.lateSumUs.load() / 1000.0 / (double) sent : 0.0, 3) + " ms, max "
        + juce::String(engine.midi.lateMaxUs.load() / 1000.0, 3) + " ms, over 1 ms: " + juce::String(engine.midi.over1ms.load()));
    if (soakMin > 0) say(pass ? "  RESULT: PASS" : "  RESULT: FAIL");
    return (soakMin > 0 && ! pass) ? 1 : 0;
}

// ------------------------------------------------------------------ --render

static int render(const Args& args)
{
    const juce::File dir(juce::File::getCurrentWorkingDirectory().getChildFile(args.get("--render")));
    const juce::File outFile(juce::File::getCurrentWorkingDirectory().getChildFile(args.get("--out", "render.wav")));
    juce::AudioFormatManager fm; fm.registerBasicFormats();
    SongDef song; double rate = 0; std::vector<std::string> warn;
    if (auto err = loadSong(dir, song, rate, fm, nullptr, {}, warn); err.isNotEmpty()) { say("Error: " + err); return 2; }
    for (auto& m : song.midi) m.port = 0;
    Engine engine; Engine::Config cfg; cfg.sampleRate = rate; cfg.offline = true;
    int needOuts = 1;
    for (auto& s : song.stems) for (int o : s.outs) needOuts = std::max(needOuts, o + 1);
    for (int o : song.clickOuts) needOuts = std::max(needOuts, o + 1);
    cfg.numOutputs = needOuts;
    if (auto err = engine.load(song, cfg, warn); ! err.empty()) { say("Error: " + juce::String(err)); return 2; }
    printWarnings(warn);
    const int block = args.get("--buffer", "512").getIntValue();
    std::vector<std::vector<float>> buf((size_t) needOuts, std::vector<float>((size_t) block)), all((size_t) needOuts);
    std::vector<float*> ptrs; for (auto& b : buf) ptrs.push_back(b.data());
    engine.start();
    while (engine.isPlaying()) {
        engine.process(ptrs.data(), needOuts, block);
        for (size_t c = 0; c < buf.size(); ++c) all[c].insert(all[c].end(), buf[c].begin(), buf[c].end());
    }
    if (! writeWav(outFile.getFullPathName().toStdString(), all, rate, true)) { say("Error: can't write " + outFile.getFullPathName()); return 2; }
    say("Rendered " + juce::String(needOuts) + " outputs to " + outFile.getFullPathName());
    say("MIDI events (sample, seconds, bytes):");
    for (auto& m : engine.midiLog) {
        juce::String b; for (int i = 0; i < m.len; ++i) b << juce::String::toHexString((int) m.d[i]).paddedLeft('0', 2) << " ";
        say("  " + juce::String(m.sample).paddedLeft(' ', 9) + "  " + juce::String(m.sample / rate, 4).paddedLeft(' ', 9) + "  " + b);
    }
    return 0;
}

// ------------------------------------------------------------------ main

static void usage()
{
    say("set.Line engine spike\n"
        "  setline-spike --list\n"
        "  setline-spike --selftest\n"
        "  setline-spike --make-test <folder> [--stems 8] [--seconds 120] [--rate 48000]\n"
        "  setline-spike --play <folder> [--device \"<part of name>\"] [--driver ASIO] [--buffer 128] [--midi-port \"Quad\"] [--midi-offset 0]\n"
        "                [--autoplay] [--loops N] [--soak <minutes>] [--midi-clock [--midi-transport]]\n"
        "  setline-spike --render <folder> [--out render.wav]");
}

int main(int argc, char* argv[])
{
    juce::ScopedJuceInitialiser_GUI juceInit;
    platform::enableHighResolutionTimers();
    struct RestoreTimers { ~RestoreTimers() { platform::restoreTimers(); } } restoreTimers;
    Args args; for (int i = 1; i < argc; ++i) args.a.add(juce::String::fromUTF8(argv[i]));

    if (args.has("--selftest")) return runSelfTest(true) ? 0 : 1;
    if (args.has("--list")) { listDevices(); return 0; }
    if (args.has("--make-test")) {
        const auto dir = juce::File::getCurrentWorkingDirectory().getChildFile(args.get("--make-test"));
        const int stems = juce::jlimit(1, 32, args.get("--stems", "8").getIntValue());
        const double secs = juce::jlimit(10.0, 3600.0, args.get("--seconds", "120").getDoubleValue());
        const double rate = args.get("--rate", "48000").getDoubleValue();
        say("Writing " + juce::String(stems + 1) + " stems (" + juce::String(secs, 0) + " s, " + juce::String((int) rate) + " Hz, 24-bit) to " + dir.getFullPathName());
        const auto err = writeTestSong(dir.getFullPathName().toStdString(), stems, secs, rate);
        if (! err.empty()) { say("Error: " + juce::String(err)); return 2; }
        say("Done. Edit song.json to change outputs, then: setline-spike --play \"" + dir.getFullPathName() + "\"");
        return 0;
    }
    if (args.has("--play")) return play(args);
    if (args.has("--render")) return render(args);
    usage();
    return 0;
}
