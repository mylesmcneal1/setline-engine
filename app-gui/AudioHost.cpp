#include "AudioHost.h"
#include <cmath>

namespace setline::gui {

namespace {

// When several drivers reach the same interface, prefer the lowest-latency one.
int driverRank(const juce::String& type)
{
    static const juce::StringArray pref { "ASIO", "Exclusive", "Low Latency", "Windows Audio", "CoreAudio", "DirectSound" };
    for (int i = 0; i < pref.size(); ++i) if (type.containsIgnoreCase(pref[i])) return i;
    return pref.size();
}

juce::var toVar(const juce::StringArray& a) { juce::Array<juce::var> v; for (auto& s : a) v.add(s); return v; }

template <typename T> juce::var toVar(const juce::Array<T>& a) { juce::Array<juce::var> v; for (auto x : a) v.add(x); return v; }

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

} // namespace

AudioHost::AudioHost(juce::PropertiesFile& s) : settings(s)
{
    dm.addChangeListener(this);
}

AudioHost::~AudioHost()
{
    stopTimer();
    dm.removeChangeListener(this);
    eng.stop();
    dm.removeAudioCallback(this);
    dm.closeAudioDevice();
}

void AudioHost::start()
{
    dm.getAvailableDeviceTypes(); // creates the driver types and scans them
    dm.addAudioCallback(this);
    eng.setMidiSink(&midiOuts);   // starts the engine's MIDI thread
    startTimerHz(30);            // transport / meters / stats events

    juce::String note;
    const auto saved = juce::JSON::parse(settings.getValue("audio"));
    if (saved.isObject()) {
        const auto err = open(saved["driver"].toString(), saved["device"].toString(), (double) saved["rate"], (int) saved["buffer"]);
        if (err.isEmpty()) return;
        note = "Couldn't open the saved device (" + saved["driver"].toString() + " / " + saved["device"].toString() + "): " + err;
    }

    // First launch (or the saved device is gone): the best driver that has a device, its first device,
    // 48 kHz and a 128-sample buffer where the device offers them.
    juce::Array<juce::AudioIODeviceType*> types;
    for (auto* t : dm.getAvailableDeviceTypes()) types.add(t);
    std::stable_sort(types.begin(), types.end(), [](auto* a, auto* b) { return driverRank(a->getTypeName()) < driverRank(b->getTypeName()); });
    for (auto* t : types) {
        const auto names = t->getDeviceNames(false);
        if (names.isEmpty()) continue;
        if (open(t->getTypeName(), names[0], 48000, 128).isEmpty()) { error = note; return; }
    }
    if (error.isEmpty()) error = note.isNotEmpty() ? note : juce::String("No audio output device found.");
}

juce::String AudioHost::open(const juce::String& driver, const juce::String& device, double rate, int buffer)
{
    const juce::ScopedValueSetter<bool> busy(opening, true);
    juce::AudioIODeviceType* type = nullptr;
    for (auto* t : dm.getAvailableDeviceTypes()) if (t->getTypeName() == driver) type = t;
    if (type == nullptr) return "Driver \"" + driver + "\" isn't available on this computer.";
    if (! type->getDeviceNames(false).contains(device)) return "\"" + device + "\" isn't connected (" + driver + ").";

    eng.stop();
    if (dm.getCurrentAudioDeviceType() != driver) dm.setCurrentAudioDeviceType(driver, true);

    juce::AudioDeviceManager::AudioDeviceSetup s;
    dm.getAudioDeviceSetup(s);
    s.outputDeviceName = device;
    s.inputDeviceName = {};
    s.useDefaultInputChannels = false; s.inputChannels.clear();
    s.useDefaultOutputChannels = false; s.outputChannels.clear(); s.outputChannels.setRange(0, 256, true); // every output
    s.sampleRate = rate > 0 ? rate : 0;
    s.bufferSize = buffer > 0 ? buffer : 0;

    // Snap to what the device offers: the requested rate must be exact (set.Line never resamples),
    // the buffer goes to the nearest available size. Read the options from the open device when it's
    // the same one; otherwise close it first (an ASIO driver usually can't be loaded twice).
    juce::Array<double> rates; juce::Array<int> sizes;
    auto* cur = dm.getCurrentAudioDevice();
    if (cur != nullptr && dm.getCurrentAudioDeviceType() == driver && cur->getName() == device) {
        rates = cur->getAvailableSampleRates(); sizes = cur->getAvailableBufferSizes();
    } else {
        dm.closeAudioDevice();
        if (std::unique_ptr<juce::AudioIODevice> probe { type->createDevice(device, {}) }) {
            rates = probe->getAvailableSampleRates(); sizes = probe->getAvailableBufferSizes();
        }
    }
    if (s.sampleRate > 0 && ! rates.isEmpty() && ! rates.contains(s.sampleRate))
        return "\"" + device + "\" can't run at " + juce::String(s.sampleRate / 1000.0, 1) + " kHz.";
    if (s.bufferSize > 0 && ! sizes.isEmpty() && ! sizes.contains(s.bufferSize)) {
        int best = sizes[0];
        for (int b : sizes) if (std::abs(b - s.bufferSize) < std::abs(best - s.bufferSize)) best = b;
        s.bufferSize = best;
    }

    loaded = false; ++deviceEpoch; // a loaded song was prepared for the old device: load it again
    if (auto err = dm.setAudioDeviceSetup(s, true); err.isNotEmpty()) return err;
    auto* d = dm.getCurrentAudioDevice();
    if (d == nullptr) return "The device didn't open.";
    xrunBase = d->getXRunCount();
    lastDeviceKey = dm.getCurrentAudioDeviceType() + "|" + d->getName() + "|" + juce::String(d->getCurrentSampleRate()) + "|" + juce::String(d->getCurrentBufferSizeSamples());
    error.clear();
    save();
    return {};
}

void AudioHost::save()
{
    if (auto* d = dm.getCurrentAudioDevice())
        settings.setValue("audio", juce::JSON::toString(obj({ { "driver", dm.getCurrentAudioDeviceType() },
                                                              { "device", d->getName() },
                                                              { "rate", d->getCurrentSampleRate() },
                                                              { "buffer", d->getCurrentBufferSizeSamples() } }), true));
    settings.saveIfNeeded();
}

juce::var AudioHost::getSetup(bool rescan)
{
    juce::Array<juce::var> drivers;
    auto& types = dm.getAvailableDeviceTypes();
    juce::Array<juce::AudioIODeviceType*> sorted;
    for (auto* t : types) sorted.add(t);
    std::stable_sort(sorted.begin(), sorted.end(), [](auto* a, auto* b) { return driverRank(a->getTypeName()) < driverRank(b->getTypeName()); });
    for (auto* t : sorted) {
        if (rescan) t->scanForDevices();
        drivers.add(obj({ { "name", t->getTypeName() }, { "devices", toVar(t->getDeviceNames(false)) } }));
    }

    juce::var current;
    if (auto* d = dm.getCurrentAudioDevice()) {
        const double sr = d->getCurrentSampleRate();
        const int buf = d->getCurrentBufferSizeSamples(), outLat = d->getOutputLatencyInSamples();
        current = obj({ { "driver", dm.getCurrentAudioDeviceType() },
                        { "device", d->getName() },
                        { "rate", sr },
                        { "buffer", buf },
                        { "rates", toVar(d->getAvailableSampleRates()) },
                        { "buffers", toVar(d->getAvailableBufferSizes()) },
                        { "outputs", toVar(d->getOutputChannelNames()) },
                        { "activeOutputs", d->getActiveOutputChannels().countNumberOfSetBits() },
                        { "outputLatency", outLat },
                        { "latencyMs", sr > 0 ? (buf + outLat) * 1000.0 / sr : 0.0 },
                        { "running", d->isPlaying() },
                        { "hasControlPanel", d->hasControlPanel() } });
    }
    return obj({ { "drivers", drivers }, { "current", current }, { "error", error } });
}

juce::var AudioHost::setSetup(const juce::var& req)
{
    auto* d = dm.getCurrentAudioDevice();
    const auto driver = req.hasProperty("driver") ? req["driver"].toString() : dm.getCurrentAudioDeviceType();
    juce::String device = req.hasProperty("device") ? req["device"].toString() : (d ? d->getName() : juce::String());
    double rate = req.hasProperty("rate") ? (double) req["rate"] : (d ? d->getCurrentSampleRate() : 48000.0);
    int buffer = req.hasProperty("buffer") ? (int) req["buffer"] : (d ? d->getCurrentBufferSizeSamples() : 128);

    // Switching driver without naming a device: take that driver's first device.
    if (device.isEmpty() || (req.hasProperty("driver") && ! req.hasProperty("device")))
        for (auto* t : dm.getAvailableDeviceTypes())
            if (t->getTypeName() == driver) {
                const auto names = t->getDeviceNames(false);
                device = names.contains(device) ? device : names[0];
            }

    const auto prevDriver = dm.getCurrentAudioDeviceType();
    const auto prevDevice = d ? d->getName() : juce::String();
    const double prevRate = d ? d->getCurrentSampleRate() : 0;
    const int prevBuffer = d ? d->getCurrentBufferSizeSamples() : 0;

    auto err = open(driver, device, rate, buffer);
    if (err.isNotEmpty()) {
        // Put the previous device back so the show isn't left without audio.
        if (prevDevice.isNotEmpty() && open(prevDriver, prevDevice, prevRate, prevBuffer).isEmpty())
            err << " Still using " << prevDevice << ".";
        error = err;
    }
    auto state = getSetup();
    if (err.isNotEmpty()) state.getDynamicObject()->setProperty("error", err);
    return state;
}

juce::var AudioHost::midiOutputs() const
{
    juce::Array<juce::var> list;
    for (auto& m : juce::MidiOutput::getAvailableDevices()) list.add(obj({ { "name", m.name }, { "id", m.identifier } }));
    return list;
}

void AudioHost::changeListenerCallback(juce::ChangeBroadcaster*)
{
    if (opening) return;
    // Report only real changes (device gone, driver reset, rate/buffer changed in the driver's panel).
    juce::String key;
    if (auto* d = dm.getCurrentAudioDevice())
        key = dm.getCurrentAudioDeviceType() + "|" + d->getName() + "|" + juce::String(d->getCurrentSampleRate()) + "|" + juce::String(d->getCurrentBufferSizeSamples());
    if (key == lastDeviceKey) return;
    lastDeviceKey = key;
    eng.stop(); loaded = false; ++deviceEpoch;
    if (key.isEmpty()) error = "The audio device stopped (unplugged or driver reset).";
    if (onSetupChanged) onSetupChanged();
}

// ------------------------------------------------------------------ MIDI outputs

int AudioHost::MidiOuts::resolve(const juce::String& want, std::vector<std::string>& warnings)
{
    const int n = count.load();
    for (int i = 0; i < n; ++i) if (names[(size_t) i].equalsIgnoreCase(want)) return i;
    // Match an available port: same name, else one name containing the other ("Quad Cortex" ~ "Quad Cortex MIDI 1").
    const auto avail = juce::MidiOutput::getAvailableDevices();
    const juce::MidiDeviceInfo* pick = nullptr;
    for (auto& d : avail) if (d.name.equalsIgnoreCase(want)) pick = &d;
    if (! pick && want.isNotEmpty())
        for (auto& d : avail) if (d.name.containsIgnoreCase(want) || want.containsIgnoreCase(d.name)) { pick = &d; break; }
    if (! pick) return -1;
    for (int i = 0; i < n; ++i) if (names[(size_t) i] == pick->name) return i;
    if (n >= Max) { warnings.push_back("Too many MIDI outputs open."); return -1; }
    auto o = juce::MidiOutput::openDevice(pick->identifier);
    if (! o) { warnings.push_back("Couldn't open MIDI output " + pick->name.toStdString() + " (is another program using it?)"); return -1; }
    outs[(size_t) n] = std::move(o);
    names[(size_t) n] = pick->name;
    count.store(n + 1, std::memory_order_release);
    return n;
}

// ------------------------------------------------------------------ songs and transport

namespace {
juce::var errorObj(const juce::String& msg, const juce::String& code = {})
{
    auto* o = new juce::DynamicObject();
    o->setProperty("error", msg);
    if (code.isNotEmpty()) o->setProperty("code", code);
    return juce::var(o);
}
} // namespace

juce::var AudioHost::loadSong(const juce::var& payload)
{
    auto* d = dm.getCurrentAudioDevice();
    if (d == nullptr) return errorObj("No audio device is open. Choose one on the Outputs & MIDI page.", "nodevice");
    const double sr = d->getCurrentSampleRate();
    const int outs = d->getActiveOutputChannels().countNumberOfSetBits();

    auto mapped = mapSong(payload, sr, outs, [this](const juce::String& port, std::vector<std::string>& w) { return midiOuts.resolve(port, w); });
    Engine::Config cfg;
    cfg.sampleRate = sr;
    cfg.numOutputs = outs;
    cfg.midiOffsetMs = settings.getDoubleValue("midiOffsetMs", 0.0);
    std::vector<std::string> warnings = mapped.warnings;
    if (auto err = eng.load(mapped.def, cfg, warnings); ! err.empty()) { loaded = false; return errorObj(err); }
    loaded = true;
    loadedEpoch = deviceEpoch;
    loadedName = juce::String(mapped.def.name);
    trackIds = mapped.engineTrack;
    levels = mapped.levels;
    applyLevels();

    juce::StringArray w;
    for (auto& s : warnings) w.addIfNotAlreadyThere(juce::String(s));
    auto* o = new juce::DynamicObject();
    o->setProperty("ok", true);
    juce::Array<juce::var> wa; for (auto& s : w) wa.add(s);
    o->setProperty("warnings", wa);
    o->setProperty("seconds", (double) eng.lengthSamples() / sr);
    o->setProperty("clickHits", (int) eng.clickList().size());
    o->setProperty("midiEvents", (int) eng.midiList().size());
    o->setProperty("epoch", deviceEpoch);
    if (emit) emit("transport", transportState());
    return juce::var(o);
}

juce::var AudioHost::transport(const juce::var& req)
{
    const auto cmd = req["cmd"].toString();
    if (cmd == "stop") {
        eng.stop();
    } else if (cmd == "play") {
        if (dm.getCurrentAudioDevice() == nullptr) return errorObj("No audio device is open. Choose one on the Outputs & MIDI page.", "nodevice");
        if (! loaded || loadedEpoch != deviceEpoch) return errorObj("Load the song first.", "reload");
        const int bar = juce::jmax(1, (int) req.getProperty("fromBar", 1));
        const double beat = juce::jmax(1.0, (double) req.getProperty("fromBeat", 1.0));
        const int64_t from = eng.tempoMap().sampleAt(bar, beat);
        if (from >= eng.lengthSamples()) return errorObj("That position is past the end of the song.", "end");
        if (! eng.start(from)) return errorObj("The disk couldn't load the audio in time.", "preroll");
    } else {
        return errorObj("transport: unknown cmd \"" + cmd + "\"");
    }
    auto st = transportState();
    if (emit) emit("transport", st);
    wasPlaying = eng.isPlaying();
    return st;
}

juce::var AudioHost::setTrackLevel(const juce::var& req)
{
    const auto t = req["track"].toString();
    auto& lv = levels[t];
    if (req.hasProperty("db")) lv.db = (float) (double) req["db"];
    if (req.hasProperty("mute")) lv.mute = (bool) req["mute"];
    if (req.hasProperty("solo")) lv.solo = (bool) req["solo"];
    applyLevels();
    auto* o = new juce::DynamicObject();
    o->setProperty("ok", true);
    o->setProperty("live", trackIds.count(t) > 0); // false: the track has no sound in the engine (yet)
    return juce::var(o);
}

void AudioHost::applyLevels()
{
    // Same rule as the Edit page (isOff): muted, or another track is soloed. -60 dB on the fader is off.
    bool anySolo = false;
    for (auto& [name, lv] : levels) anySolo |= lv.solo;
    for (auto& [name, id] : trackIds) {
        const auto& lv = levels[name];
        const bool off = lv.mute || (anySolo && ! lv.solo) || lv.db <= -60.0f;
        eng.setTrackLevel(id, lv.db, off);
    }
}

juce::var AudioHost::transportState()
{
    auto* o = new juce::DynamicObject();
    const int64_t s = eng.position();
    const double sr = eng.sampleRate() > 0 ? eng.sampleRate() : 48000.0;
    int bar = 1; double beat = 1;
    if (loaded) eng.tempoMap().barBeatAt(s, bar, beat);
    o->setProperty("playing", eng.isPlaying());
    o->setProperty("loaded", loaded);
    o->setProperty("song", loadedName);
    o->setProperty("sample", (juce::int64) s);
    o->setProperty("seconds", (double) s / sr);
    o->setProperty("bar", bar);
    o->setProperty("beat", beat);
    o->setProperty("length", (double) eng.lengthSamples() / sr);
    return juce::var(o);
}

juce::var AudioHost::engineStats()
{
    auto* o = new juce::DynamicObject();
    auto* d = dm.getCurrentAudioDevice();
    const int xr = d ? d->getXRunCount() : -1;
    const double sr = d ? d->getCurrentSampleRate() : 0.0;
    const int buf = d ? d->getCurrentBufferSizeSamples() : 0;
    const auto sent = eng.midi.sent.load();
    o->setProperty("running", d != nullptr && d->isPlaying());
    o->setProperty("xruns", xr < 0 ? juce::var() : juce::var(xr - xrunBase)); // null: the driver doesn't report them
    o->setProperty("underruns", (juce::int64) eng.stats.underruns.load());
    o->setProperty("midiSent", (juce::int64) sent);
    o->setProperty("midiDropped", (juce::int64) eng.midi.dropped.load());
    o->setProperty("midiLateMaxMs", eng.midi.lateMaxUs.load() / 1000.0);
    o->setProperty("midiLateAvgMs", sent ? eng.midi.lateSumUs.load() / 1000.0 / (double) sent : 0.0);
    o->setProperty("cpu", dm.getCpuUsage() * 100.0);
    o->setProperty("callbackMaxMs", eng.stats.cbMaxUs.load() / 1000.0);
    o->setProperty("budgetMs", sr > 0 ? 1000.0 * buf / sr : 0.0);
    o->setProperty("overBudget", (juce::int64) eng.stats.cbOverBudget.load());
    return juce::var(o);
}

void AudioHost::timerCallback()
{
    if (! emit) return;
    const bool playing = eng.isPlaying();
    if (playing || playing != wasPlaying) {
        auto st = transportState();
        if (! playing && eng.takeFinished()) st.getDynamicObject()->setProperty("ended", true);
        emit("transport", st);
    }
    wasPlaying = playing;

    // Meters: while playing, and until they have fallen back to silence.
    if (auto* d = dm.getCurrentAudioDevice(); d && (playing || metersLive)) {
        juce::Array<juce::var> peaks;
        bool any = false;
        const int n = juce::jmin(Engine::MaxMeters, d->getActiveOutputChannels().countNumberOfSetBits());
        for (int c = 0; c < n; ++c) { const float p = eng.takeOutputPeak(c); any |= p > 0.0f; peaks.add(p); }
        auto* o = new juce::DynamicObject();
        o->setProperty("peaks", peaks);
        emit("meters", juce::var(o));
        metersLive = any || playing;
    }

    if (++tick % 30 == 0) emit("engineStats", engineStats());
}

// ------------------------------------------------------------------ audio thread

void AudioHost::audioDeviceIOCallbackWithContext(const float* const*, int, float* const* out, int numOut, int n,
                                                 const juce::AudioIODeviceCallbackContext&)
{
    eng.process(out, numOut, n);
}

void AudioHost::audioDeviceAboutToStart(juce::AudioIODevice* d)
{
    eng.setDeviceTiming(d->getCurrentBufferSizeSamples(), d->getOutputLatencyInSamples());
    eng.setDeviceRunning(true);
}

void AudioHost::audioDeviceStopped() { eng.setDeviceRunning(false); }

} // namespace setline::gui
