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
    // "Listen to one output": scratch outputs allocated once, here (the audio thread never allocates)
    scratch.assign(scratchOuts, std::vector<float>((size_t) scratchFrames, 0.0f));
    for (int c = 0; c < scratchOuts; ++c) scratchPtrs[(size_t) c] = scratch[(size_t) c].data();
    midiOuts.enabled = &midiOn;
    // listen settings (this computer only)
    const auto l = juce::JSON::parse(settings.getValue("listen"));
    if (l.isObject()) {
        listen.on = (bool) l["on"]; listen.driver = l["driver"].toString(); listen.device = l["device"].toString();
        listen.mode = l["mode"].toString() == "output" ? "output" : "everything";
        if (auto* o = l["output"].getArray()) for (auto& v : *o) if ((int) v >= 1) listen.output.push_back((int) v - 1);
        listen.click = l.hasProperty("click") ? (bool) l["click"] : true; listen.cues = l.hasProperty("cues") ? (bool) l["cues"] : true; listen.midi = l.hasProperty("midi") ? (bool) l["midi"] : true;
        midiOn.store(! listen.on || listen.midi);
    }
}

AudioHost::~AudioHost()
{
    stopTimer();
    dm.removeChangeListener(this);
    eng.stop();
    dm.removeAudioCallback(this);
    dm.closeAudioDevice();
    delete previewIn.exchange(nullptr);
    delete previewNow;
    collectPreviews();
}

void AudioHost::start()
{
    dm.getAvailableDeviceTypes(); // creates the driver types and scans them
    dm.addAudioCallback(this);
    eng.setMidiSink(&midiOuts);   // starts the engine's MIDI thread
    startTimerHz(30);            // transport / meters / stats events

    juce::String note;
    const auto saved = juce::JSON::parse(settings.getValue("audio"));
    // Listening on this computer when set.Line was last closed: start there again (the show's interface stays saved).
    if (listen.on && listen.device.isNotEmpty()) {
        const double rate = saved.isObject() && (double) saved["rate"] > 0 ? (double) saved["rate"] : 48000.0;
        if (open(listen.driver, listen.device, rate, 0, false).isEmpty()) return;
        listen.on = false; saveListen(); // that device is gone: back to the show's interface
    }
    if (saved.isObject()) {
        const auto err = open(saved["driver"].toString(), saved["device"].toString(), (double) saved["rate"], (int) saved["buffer"]);
        if (err.isEmpty()) return;
        savedLabel = saved["device"].toString() + " (" + saved["driver"].toString() + ")";
        savedProblem = err;
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

juce::String AudioHost::retrySaved()
{
    const auto saved = juce::JSON::parse(settings.getValue("audio"));
    if (! saved.isObject()) return "No saved device.";
    const auto err = open(saved["driver"].toString(), saved["device"].toString(), (double) saved["rate"], (int) saved["buffer"]);
    if (err.isEmpty()) { savedProblem = {}; error = {}; }
    return err;
}

void AudioHost::closeDevice() { dm.closeAudioDevice(); }

juce::String AudioHost::deviceSummary()
{
    auto* d = dm.getCurrentAudioDevice();
    if (d == nullptr) return {};
    const double r = d->getCurrentSampleRate();
    const juce::String khz = std::fmod(r, 1000.0) == 0 ? juce::String((int) (r / 1000)) : juce::String(r / 1000.0, 1);
    const juce::String dot = juce::String::fromUTF8(" \xc2\xb7 ");
    return d->getName() + dot + dm.getCurrentAudioDeviceType() + dot + khz + " kHz" + dot + juce::String(d->getCurrentBufferSizeSamples());
}

juce::String AudioHost::open(const juce::String& driver, const juce::String& device, double rate, int buffer, bool remember)
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
    if (remember) save(); // the listen device never replaces the show's interface in the settings
    return {};
}

// ---------------------------------------------------------------- listen on this computer
namespace {
bool isComputerDriver(const juce::String& t) { return t != "ASIO"; } // Windows Audio / DirectSound / CoreAudio
}

void AudioHost::saveListen()
{
    juce::Array<juce::var> out; for (int o : listen.output) out.add(o + 1);
    settings.setValue("listen", juce::JSON::toString(obj({ { "on", listen.on }, { "driver", listen.driver }, { "device", listen.device }, { "mode", listen.mode },
                                                           { "output", out }, { "click", listen.click }, { "cues", listen.cues }, { "midi", listen.midi } }), true));
    settings.saveIfNeeded();
}

juce::var AudioHost::listenState() const
{
    juce::Array<juce::var> out; for (int o : listen.output) out.add(o + 1);
    auto* d = dm.getCurrentAudioDevice();
    return obj({ { "on", listen.on }, { "driver", listen.driver }, { "device", listen.device }, { "mode", listen.mode }, { "output", out },
                 { "click", listen.click }, { "cues", listen.cues }, { "midi", listen.midi },
                 { "current", d ? d->getName() : juce::String() }, { "rate", d ? d->getCurrentSampleRate() : 0.0 } });
}

juce::var AudioHost::listenDevices(double rate)
{
    juce::Array<juce::var> list;
    for (auto* t : dm.getAvailableDeviceTypes()) {
        if (! isComputerDriver(t->getTypeName())) continue;
        t->scanForDevices();
        const auto names = t->getDeviceNames(false);
        const int def = t->getDefaultDeviceIndex(false);
        for (int i = 0; i < names.size(); ++i) {
            bool ok = rate <= 0;
            auto* cur = dm.getCurrentAudioDevice();
            if (! ok && cur != nullptr && dm.getCurrentAudioDeviceType() == t->getTypeName() && cur->getName() == names[i]) ok = cur->getAvailableSampleRates().contains(rate);
            else if (! ok) if (std::unique_ptr<juce::AudioIODevice> probe { t->createDevice(names[i], {}) }) ok = probe->getAvailableSampleRates().contains(rate);
            list.add(obj({ { "driver", t->getTypeName() }, { "device", names[i] }, { "default", i == def }, { "rateOk", ok } }));
        }
    }
    return list;
}

juce::var AudioHost::setListen(const juce::var& req)
{
    auto next = listen;
    if (req.hasProperty("on")) next.on = (bool) req["on"];
    if (req.hasProperty("driver")) next.driver = req["driver"].toString();
    if (req.hasProperty("device")) next.device = req["device"].toString();
    if (req.hasProperty("mode")) next.mode = req["mode"].toString() == "output" ? "output" : "everything";
    if (auto* o = req["output"].getArray()) { next.output.clear(); for (auto& v : *o) if ((int) v >= 1) next.output.push_back((int) v - 1); }
    if (req.hasProperty("click")) next.click = (bool) req["click"];
    if (req.hasProperty("cues")) next.cues = (bool) req["cues"];
    if (req.hasProperty("midi")) next.midi = (bool) req["midi"];
    if (next.mode == "output" && next.output.empty()) next.mode = "everything";
    const double rate = (double) req.getProperty("rate", sampleRate() > 0 ? sampleRate() : 48000.0);

    const bool deviceChange = next.on != listen.on || (next.on && (next.driver != listen.driver || next.device != listen.device));
    if (next.on && deviceChange) {
        // The computer's default output if none is chosen yet (Windows Audio / CoreAudio first).
        if (next.device.isEmpty()) {
            for (auto* t : dm.getAvailableDeviceTypes()) {
                if (! isComputerDriver(t->getTypeName()) || t->getTypeName() == "DirectSound") continue;
                t->scanForDevices();
                const auto names = t->getDeviceNames(false);
                if (names.isEmpty()) continue;
                next.driver = t->getTypeName();
                next.device = names[juce::jmax(0, t->getDefaultDeviceIndex(false))];
                break;
            }
        }
        if (next.device.isEmpty()) return obj({ { "error", "This computer has no audio output." } });
        if (auto err = open(next.driver, next.device, rate, 0, false); err.isNotEmpty()) {
            // Never resampled: say so, and which devices can run at the show's rate.
            juce::Array<juce::var> can;
            if (auto* l = listenDevices(rate).getArray()) for (auto& d : *l) if ((bool) d["rateOk"]) can.add(d);
            retrySaved();
            return obj({ { "error", err.contains("can't run at") ? "\"" + next.device + "\" can't run at the show's rate (" + juce::String(rate / 1000.0, 1) + " kHz), and set.Line never resamples."
                                                                : err },
                         { "devices", can } });
        }
    } else if (! next.on && deviceChange) {
        listen.on = false; // the show's interface again (saved in the settings)
        const auto err = retrySaved();
        if (err.isNotEmpty()) error = err;
    }
    listen = next;
    midiOn.store(! listen.on || listen.midi);
    loaded = false; ++deviceEpoch; // the song is mapped again for the new outputs
    saveListen();
    return listenState();
}

// The fold-down (see setListen). Tracks the show doesn't route stay silent; Click / Cues can be left out.
void AudioHost::applyListen(SongDef& def, const Listen& l)
{
    constexpr float centre = -3.0103f; // a mono track in the middle of a stereo pair: -3 dB on each side
    if (l.mode == "everything") {
        for (auto& s : def.stems) {
            if (s.outs.empty()) continue;
            const bool mono = s.source && s.source->numChannels() == 1;
            s.outs = { 0, 1 };
            if (mono) s.gainDb += centre;
        }
        if (! def.clickOuts.empty()) { def.clickOuts = { 0, 1 }; def.clickGainDb += centre; }
        for (auto& c : def.moreClicks) if (! c.outs.empty()) { c.outs = { 0, 1 }; c.gainDb += centre; }
        if (! def.cueOuts.empty()) { def.cueOuts = { 0, 1 }; def.cueGainDb += centre; }
    }
    if (! l.click) { def.clickOuts.clear(); for (auto& c : def.moreClicks) c.outs.clear(); }
    if (! l.cues) def.cueOuts.clear();
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
    if (listen.on) { listen.on = false; midiOn.store(true); saveListen(); } // choosing the show's interface ends "Listen on this computer"
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

    auto mapped = mapSong(payload, sr, outs, [this](const juce::String& port, std::vector<std::string>& w) { return midiOuts.resolve(port, w); },
                          [this, sr](const juce::String& text, const juce::var& voice, std::vector<std::string>& w) {
                              return cueAudio ? cueAudio(text, voice, sr, w) : std::shared_ptr<const std::vector<float>>();
                          });
    Engine::Config cfg;
    cfg.sampleRate = sr;
    cfg.numOutputs = outs;
    cfg.midiOffsetMs = settings.getDoubleValue("midiOffsetMs", 0.0);
    if (listen.on) {
        applyListen(mapped.def, listen);
        if (listen.mode == "output") cfg.numOutputs = scratchOuts; // every show output, into the scratch buffers
    }
    listenOut1.store(listen.on && listen.mode == "output" && ! listen.output.empty() ? listen.output[0] : -1);
    listenOut2.store(listen.on && listen.mode == "output" && listen.output.size() > 1 ? listen.output[1] : (listen.on && listen.mode == "output" && ! listen.output.empty() ? listen.output[0] : -1));
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
    // One track {track, db, mute, solo}, or several: {tracks: [{track, db, mute, solo}, ...]}.
    auto one = [this](const juce::var& r) {
        auto& lv = levels[r["track"].toString()];
        if (r.hasProperty("db")) lv.db = (float) (double) r["db"];
        if (r.hasProperty("mute")) lv.mute = (bool) r["mute"];
        if (r.hasProperty("solo")) lv.solo = (bool) r["solo"];
    };
    if (auto* list = req["tracks"].getArray()) for (auto& r : *list) one(r); else one(req);
    const auto t = req["track"].toString();
    applyLevels();
    auto* o = new juce::DynamicObject();
    o->setProperty("ok", true);
    o->setProperty("live", trackIds.count(t) > 0); // false: the track has no sound in the engine (yet)
    return juce::var(o);
}

juce::var AudioHost::setLoop(const juce::var& req)
{
    if (! loaded) return errorObj("Load the song first.", "reload");
    if (! req.isObject() || ! req.hasProperty("toBar")) { eng.clearJump(); }
    else {
        const auto& tm = eng.tempoMap();
        const int64_t from = tm.sampleAt(juce::jmax(1, (int) req["fromBar"]), juce::jmax(1.0, (double) req["fromBeat"]));
        const int64_t to = tm.sampleAt(juce::jmax(1, (int) req["toBar"]), juce::jmax(1.0, (double) req["toBeat"]));
        if (to <= from) return errorObj("The loop ends before it starts.");
        eng.setLoop(from, juce::jmin(to, eng.lengthSamples()));
    }
    auto* o = new juce::DynamicObject();
    const auto j = eng.currentJump();
    o->setProperty("looping", j.at >= 0);
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
    collectPreviews();
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
    const int l1 = listenOut1.load(std::memory_order_relaxed), l2 = listenOut2.load(std::memory_order_relaxed);
    if (l1 >= 0 && l1 < scratchOuts && l2 < scratchOuts) {
        // "Listen to one output": every show output into the scratch buffers, the chosen one(s) to the device
        for (int c = 0; c < numOut; ++c) if (out[c]) std::fill(out[c], out[c] + n, 0.0f);
        for (int done = 0; done < n;) {
            const int k = std::min(n - done, (int) scratchFrames);
            eng.process(scratchPtrs.data(), scratchOuts, k);
            if (numOut > 0 && out[0]) std::copy(scratchPtrs[(size_t) l1], scratchPtrs[(size_t) l1] + k, out[0] + done);
            if (numOut > 1 && out[1]) std::copy(scratchPtrs[(size_t) l2], scratchPtrs[(size_t) l2] + k, out[1] + done);
            done += k;
        }
    } else {
        eng.process(out, numOut, n);
    }
    if (auto* p = previewIn.exchange(nullptr, std::memory_order_acq_rel)) { if (previewNow) retirePreview(previewNow); previewNow = p; }
    if (auto* p = previewNow) {
        const auto& a = *p->audio;
        const int k = (int) std::min<size_t>((size_t) n, a.size() - p->pos);
        for (int o : p->outs)
            if (o >= 0 && o < numOut && out[o]) for (int i = 0; i < k; ++i) out[o][i] += a[p->pos + (size_t) i] * p->gain;
        p->pos += (size_t) k;
        if (p->pos >= a.size()) { retirePreview(p); previewNow = nullptr; }
    }
}

void AudioHost::retirePreview(Preview* p)
{
    for (auto& slot : previewDone) { Preview* none = nullptr; if (slot.compare_exchange_strong(none, p, std::memory_order_acq_rel)) return; }
    // All slots full (four previews ended within one timer tick): leave it; a few bytes, never on stage.
}

void AudioHost::collectPreviews()
{
    for (auto& slot : previewDone) delete slot.exchange(nullptr, std::memory_order_acq_rel);
}

void AudioHost::playPreview(std::shared_ptr<const std::vector<float>> audio, std::vector<int> outs, float gain)
{
    if (! audio || audio->empty()) return;
    if (listen.on) { outs = { 0, 1 }; gain *= 0.7071f; } // listening on this computer: the cue preview in the middle
    auto* p = new Preview { std::move(audio), std::move(outs), gain, 0 };
    delete previewIn.exchange(p, std::memory_order_acq_rel); // a preview the audio thread hadn't taken yet
}

void AudioHost::audioDeviceAboutToStart(juce::AudioIODevice* d)
{
    eng.setDeviceTiming(d->getCurrentBufferSizeSamples(), d->getOutputLatencyInSamples());
    eng.setDeviceRunning(true);
}

void AudioHost::audioDeviceStopped() { eng.setDeviceRunning(false); }

} // namespace setline::gui

namespace setline::gui {

juce::var AudioHost::renderOffline(const juce::var& payload, const juce::var& opts)
{
    auto* d = dm.getCurrentAudioDevice();
    const double sr = d ? d->getCurrentSampleRate() : 48000.0;
    const int numOut = opts.hasProperty("outputs") ? juce::jlimit(1, 64, (int) opts["outputs"]) // tests: as if the interface had this many
                     : d ? d->getActiveOutputChannels().countNumberOfSetBits() : 8;
    // MIDI is only logged offline: every port resolves to 0, so no device is opened.
    auto mapped = mapSong(payload, sr, numOut, [](const juce::String&, std::vector<std::string>&) { return 0; },
                          [this, sr](const juce::String& text, const juce::var& voice, std::vector<std::string>& w) {
                              return cueAudio ? cueAudio(text, voice, sr, w) : std::shared_ptr<const std::vector<float>>();
                          });
    // opts.listen ({mode, output, click, cues}): the song as "Listen on this computer" plays it
    Listen lo;
    const bool listenTest = opts["listen"].isObject();
    if (listenTest) {
        const auto lv = opts["listen"];
        lo.on = true; lo.mode = lv["mode"].toString() == "output" ? "output" : "everything";
        if (auto* o = lv["output"].getArray()) for (auto& v : *o) lo.output.push_back((int) v - 1);
        lo.click = lv.hasProperty("click") ? (bool) lv["click"] : true;
        lo.cues = lv.hasProperty("cues") ? (bool) lv["cues"] : true;
        applyListen(mapped.def, lo);
    }
    Engine e;
    Engine::Config cfg; cfg.sampleRate = sr; cfg.numOutputs = numOut; cfg.offline = true;
    std::vector<std::string> warnings = mapped.warnings;
    if (auto err = e.load(mapped.def, cfg, warnings); ! err.empty()) { auto* o = new juce::DynamicObject(); o->setProperty("error", juce::String(err)); return juce::var(o); }
    for (auto& [name, id] : mapped.engineTrack) { const auto& lv = mapped.levels[name]; e.setTrackLevel(id, lv.db, lv.mute || lv.db <= -60.0f); }
    const auto& tm = e.tempoMap();
    if (opts["loop"].isObject()) e.setLoop(tm.sampleAt((int) opts["loop"]["fromBar"], 1), tm.sampleAt((int) opts["loop"]["toBar"], 1));
    const int64_t from = tm.sampleAt(juce::jmax(1, (int) opts.getProperty("fromBar", 1)), 1);
    const int64_t total = (int64_t) ((double) opts.getProperty("seconds", 10.0) * sr);
    std::vector<std::vector<float>> out((size_t) numOut, std::vector<float>((size_t) total, 0.0f));
    const int block = 128;
    std::vector<std::vector<float>> buf((size_t) numOut, std::vector<float>(block));
    std::vector<float*> ptrs; for (auto& b : buf) ptrs.push_back(b.data());
    juce::Array<juce::var> res;
    int64_t first = 0;
    if (e.start(from)) {
        first = e.position();
        for (int64_t done = 0; done < total && e.isPlaying(); done += block) {
            e.process(ptrs.data(), numOut, block);
            for (int c = 0; c < numOut; ++c) for (int i = 0; i < block && done + i < total; ++i) out[(size_t) c][(size_t) (done + i)] = buf[(size_t) c][(size_t) i];
        }
    }
    if (listenTest && lo.mode == "output" && ! lo.output.empty()) { // what the device gets: the chosen output(s) on L / R
        const int a = lo.output[0], b = lo.output.size() > 1 ? lo.output[1] : lo.output[0];
        std::vector<std::vector<float>> two(2, std::vector<float>((size_t) total, 0.0f));
        if (a < numOut) two[0] = out[(size_t) a];
        if (b < numOut) two[1] = out[(size_t) b];
        out.swap(two);
    }
    auto* samples = new juce::DynamicObject(); // tests: a few samples of every output, to compare exactly
    for (size_t c = 0; c < out.size(); ++c) { juce::Array<juce::var> v; for (int64_t i = 0; i < total && v.size() < 4096; i += 97) v.add(out[c][(size_t) i]); samples->setProperty(juce::Identifier("o" + juce::String((int) c)), v); }
    for (int c = 0; c < (int) out.size(); ++c) {
        juce::Array<juce::var> on;
        float peak = 0; int64_t lastLoud = -1000000;
        const auto& x = out[(size_t) c];
        for (int64_t i = 0; i < total; ++i) {
            const float a = std::abs(x[(size_t) i]);
            peak = juce::jmax(peak, a);
            if (a > 1e-4f) { if (i - lastLoud > 2400 && on.size() < 64) on.add((double) i); lastLoud = i; } // after 50 ms of silence
        }
        auto* o = new juce::DynamicObject(); o->setProperty("onsets", on); o->setProperty("peak", peak);
        res.add(juce::var(o));
    }
    juce::Array<juce::var> bars, midi, w;
    for (int b = 1; b <= tm.numBars(); ++b) bars.add((double) tm.sampleAt(b, 1));
    for (auto& m : e.midiLog) midi.add((double) m.sample);
    for (auto& s : warnings) w.add(juce::String(s));
    auto* o = new juce::DynamicObject();
    o->setProperty("rate", sr);
    o->setProperty("first", (double) first); // song sample of stream index 0 (a start mid-song prerolls 5 ms)
    o->setProperty("bars", bars);
    o->setProperty("outs", res);
    o->setProperty("midi", midi);
    o->setProperty("warnings", w);
    o->setProperty("samples", juce::var(samples));
    return juce::var(o);
}

} // namespace setline::gui
