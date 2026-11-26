#include "AudioHost.h"
#include "Log.h"
#include <algorithm>
#include <cstring>
#include <cmath>

namespace setline::gui {

namespace {
bool isComputerDriver(const juce::String& t) { return t != "ASIO"; } // Windows Audio / DirectSound / CoreAudio

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
        // 7a: the interface isn't connected: play on this computer (at the show's rate), and say so. It comes back by
        // itself when it's plugged in while stopped (timerCallback).
        {
            auto* req = new juce::DynamicObject();
            req->setProperty("on", true); req->setProperty("driver", juce::String()); req->setProperty("device", juce::String());
            req->setProperty("rate", (double) saved["rate"] > 0 ? (double) saved["rate"] : 48000.0);
            listen.device = {}; listen.driver = {};
            const auto r = setListen(juce::var(req));
            if (r["error"].toString().isEmpty() && dm.getCurrentAudioDevice() != nullptr) {
                autoFrom = saved["device"].toString();
                saveListen(); // saved as not listening: the next launch tries the interface first again
                applog::line("Start-up: " + autoFrom + " not found, playing on this computer (" + deviceSummary() + ")");
                return;
            }
            listen.on = false; saveListen();
        }
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

// 7a: falling back to this computer since launch: once the saved interface is connected again, and only while
// stopped, switch back to it (the page shows a toast). Never while playing.
void AudioHost::checkInterfaceBack()
{
    if (autoFrom.isEmpty() || eng.isPlaying()) return;
    if (! listen.on) { autoFrom = {}; return; } // the user went back themselves
    const auto saved = juce::JSON::parse(settings.getValue("audio"));
    if (! saved.isObject()) { autoFrom = {}; return; }
    juce::AudioIODeviceType* type = nullptr;
    for (auto* t : dm.getAvailableDeviceTypes()) if (t->getTypeName() == saved["driver"].toString()) type = t;
    if (type == nullptr) return;
    type->scanForDevices();
    if (! type->getDeviceNames(false).contains(saved["device"].toString())) return;
    auto* req = new juce::DynamicObject(); req->setProperty("on", false);
    const auto r = setListen(juce::var(req));
    if (listen.on || dm.getCurrentAudioDevice() == nullptr || error.isNotEmpty()) return; // not yet: try again later
    const auto name = autoFrom; autoFrom = {}; savedProblem = {};
    applog::line(name + " is back: playing on it again (" + deviceSummary() + ")");
    if (emit) emit("interfaceBack", obj({ { "device", name }, { "listen", listenState() } }));
    if (onSetupChanged) onSetupChanged();
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
    applog::line("Audio device: " + deviceSummary() + (remember ? "" : " (listening on this computer)"));
    return {};
}

// ---------------------------------------------------------------- listen on this computer

void AudioHost::saveListen()
{
    juce::Array<juce::var> out; for (int o : listen.output) out.add(o + 1);
    settings.setValue("listen", juce::JSON::toString(obj({ { "on", listen.on && autoFrom.isEmpty() }, { "driver", listen.driver }, { "device", listen.device }, { "mode", listen.mode },
                                                           { "output", out }, { "click", listen.click }, { "cues", listen.cues }, { "midi", listen.midi } }), true));
    settings.saveIfNeeded();
}

juce::var AudioHost::listenState() const
{
    juce::Array<juce::var> out; for (int o : listen.output) out.add(o + 1);
    auto* d = dm.getCurrentAudioDevice();
    return obj({ { "on", listen.on }, { "driver", listen.driver }, { "device", listen.device }, { "mode", listen.mode }, { "output", out },
                 { "click", listen.click }, { "cues", listen.cues }, { "midi", listen.midi },
                 { "current", d ? d->getName() : juce::String() }, { "rate", d ? d->getCurrentSampleRate() : 0.0 }, { "missing", autoFrom } });
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

std::vector<std::vector<float>> AudioHost::bakeTrack(const juce::var& payload, const juce::String& track, int64_t a, int64_t b, int channels, juce::String& err)
{
    const double sr = showRate();
    std::vector<std::vector<float>> out;
    if (b <= a || channels < 1 || channels > 2) { err = "Nothing to glue"; return out; }
    auto mapped = mapSong(payload, sr, channels, [](const juce::String&, std::vector<std::string>&) { return 0; },
                          [](const juce::String&, const juce::var&, std::vector<std::string>&) { return std::shared_ptr<const std::vector<float>>(); });
    auto& def = mapped.def;
    // only this track, straight to its own channels at unity (the fader / mute / routing aren't part of the clip audio)
    def.stems.erase(std::remove_if(def.stems.begin(), def.stems.end(), [&](const StemDef& st) { return juce::String(st.name) != track; }), def.stems.end());
    if (def.stems.size() != 1) { err = "\"" + track + "\" has no audio to glue"; return out; }
    def.stems[0].outs = channels == 1 ? std::vector<int> { 0 } : std::vector<int> { 0, 1 };
    def.stems[0].gainDb = 0;
    def.clickOuts.clear(); for (auto& c : def.moreClicks) c.outs.clear(); def.cueOuts.clear();
    Engine e;
    Engine::Config cfg; cfg.sampleRate = sr; cfg.numOutputs = channels; cfg.offline = true;
    std::vector<std::string> warnings;
    if (auto loadErr = e.load(def, cfg, warnings); ! loadErr.empty()) { err = juce::String(loadErr); return out; }
    for (auto& [name, id] : mapped.engineTrack) e.setTrackLevel(id, 0.0f, false);
    out.assign((size_t) channels, std::vector<float>((size_t) (b - a), 0.0f));
    const int block = 512;
    std::vector<std::vector<float>> buf((size_t) channels, std::vector<float>(block));
    std::vector<float*> ptrs; for (auto& x : buf) ptrs.push_back(x.data());
    if (! e.start(0)) { err = "Couldn't render \"" + track + "\""; out.clear(); return out; }
    for (int64_t pos = e.position(); pos < b && e.isPlaying(); pos += block) {
        e.process(ptrs.data(), channels, block);
        for (int c = 0; c < channels; ++c)
            for (int i = 0; i < block; ++i) { const int64_t t = pos + i; if (t >= a && t < b) out[(size_t) c][(size_t) (t - a)] = buf[(size_t) c][(size_t) i]; }
    }
    return out;
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
    eng.stop(); eng.clearNext(); loaded = false; nextLoaded = false; ++deviceEpoch;
    if (key.isEmpty()) error = "The audio device stopped (unplugged or driver reset).";
    if (onSetupChanged) onSetupChanged();
}

// ------------------------------------------------------------------ MIDI outputs

namespace {
juce::StringArray nameList(juce::PropertiesFile& s, const char* key)
{
    juce::StringArray out; const auto v = juce::JSON::parse(s.getValue(key));
    if (auto* a = v.getArray()) for (auto& x : *a) out.add(x.toString());
    return out;
}
// Never clocked unless asked: the software synth that ships with Windows
bool clockByDefault(const juce::String& name) { return ! name.containsIgnoreCase("GS Wavetable"); }
} // namespace

void AudioHost::refreshClock()
{
    const auto off = nameList(settings, "midiClockOff"), on = nameList(settings, "midiClockOn"), tr = nameList(settings, "midiTransport");
    uint32_t cm = 0, tm = 0;
    const int n = midiOuts.count.load();
    for (int i = 0; i < n && i < 32; ++i) {
        const auto& nm = midiOuts.names[(size_t) i];
        if ((clockByDefault(nm) && ! off.contains(nm)) || on.contains(nm)) cm |= 1u << i;
        if (tr.contains(nm)) tm |= 1u << i;
    }
    if (clockHeld) cm = 0; // 9d: a silent break: no clock until the next song starts
    eng.setMidiClock(cm, tm, n);
}

void AudioHost::scanMidiPorts()
{
    const auto avail = juce::MidiOutput::getAvailableDevices();
    juce::StringArray now; for (auto& d : avail) now.add(d.name);
    const auto off = nameList(settings, "midiClockOff"), on = nameList(settings, "midiClockOn");
    juce::StringArray back;
    std::vector<std::string> w;
    for (auto& d : avail) {
        int idx = -1; for (int i = 0; i < midiOuts.count.load(); ++i) if (midiOuts.names[(size_t) i] == d.name) idx = i;
        const bool wantClock = (clockByDefault(d.name) && ! off.contains(d.name)) || on.contains(d.name);
        if (idx < 0 && wantClock) midiOuts.resolve(d.name, w); // MIDI clock goes to every output: open it
        else if (idx >= 0 && connectedPorts.size() && ! connectedPorts.contains(d.name)) {
            // it was gone and came back: the old handle is dead, open it again
            if (auto o = juce::MidiOutput::openDevice(d.identifier)) { std::lock_guard<std::mutex> g(midiOuts.locks[(size_t) idx]); midiOuts.outs[(size_t) idx] = std::move(o); }
            back.add(d.name);
        }
    }
    for (auto& x : w) applog::line("MIDI: " + juce::String(x));
    const bool first = connectedPorts.isEmpty();
    connectedPorts = now;
    if (connectedPorts.isEmpty()) connectedPorts.add({}); // (scanned once)
    refreshClock();
    if (! first && back.size()) { applog::line("MIDI: reconnected " + back.joinIntoString(", ")); if (onMidiReconnected) onMidiReconnected(back); }
}

juce::var AudioHost::midiPorts()
{
    scanMidiPorts();
    const auto off = nameList(settings, "midiClockOff"), on = nameList(settings, "midiClockOn"), tr = nameList(settings, "midiTransport");
    juce::Array<juce::var> list; juce::StringArray seen;
    auto add = [&](const juce::String& nm, bool connected) {
        if (seen.contains(nm)) return; seen.add(nm);
        bool open = false; for (int i = 0; i < midiOuts.count.load(); ++i) open |= midiOuts.names[(size_t) i] == nm;
        auto* o = new juce::DynamicObject();
        o->setProperty("name", nm); o->setProperty("open", open); o->setProperty("connected", connected);
        o->setProperty("clock", (clockByDefault(nm) && ! off.contains(nm)) || on.contains(nm)); o->setProperty("transport", tr.contains(nm));
        list.add(juce::var(o));
    };
    for (auto& d : juce::MidiOutput::getAvailableDevices()) add(d.name, true);
    for (int i = 0; i < midiOuts.count.load(); ++i) add(midiOuts.names[(size_t) i], false);
    return list;
}

void AudioHost::setMidiPort(const juce::String& name, bool clock, bool transport)
{
    auto off = nameList(settings, "midiClockOff"), on = nameList(settings, "midiClockOn"), tr = nameList(settings, "midiTransport");
    off.removeString(name); on.removeString(name); tr.removeString(name);
    if (! clock && clockByDefault(name)) off.add(name);
    if (clock && ! clockByDefault(name)) on.add(name);
    if (transport) tr.add(name);
    auto save = [this](const char* k, const juce::StringArray& a) { juce::Array<juce::var> v; for (auto& x : a) v.add(x); settings.setValue(k, juce::JSON::toString(v, true)); };
    save("midiClockOff", off); save("midiClockOn", on); save("midiTransport", tr);
    settings.saveIfNeeded();
    scanMidiPorts();
}

juce::var AudioHost::sendMidiNow(const juce::String& port, const juce::var& msgs)
{
    std::vector<std::string> w;
    const int i = midiOuts.resolve(port, w);
    if (i < 0) { auto* o = new juce::DynamicObject(); o->setProperty("error", w.empty() ? "MIDI output \"" + port + "\" isn't connected." : juce::String(w.front())); return juce::var(o); }
    refreshClock();
    int sent = 0;
    if (auto* a = msgs.getArray())
        for (auto& m : *a) {
            uint8_t b[3] = { 0, 0, 0 }; int len = 0;
            if (auto* bytes = m.getArray()) for (auto& x : *bytes) if (len < 3) b[len++] = (uint8_t) (int) x;
            if (len == 0 || (b[0] & 0x80) == 0) continue;
            midiOuts.sendNow(i, b, len); ++sent;
        }
    auto* o = new juce::DynamicObject(); o->setProperty("sent", sent); return juce::var(o);
}

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

// Maps a song for the engine on the open device (listen mode applied). cfg is filled for Engine::load.
MappedSong AudioHost::mapForEngine(const juce::var& payload, Engine::Config& cfg)
{
    auto* d = dm.getCurrentAudioDevice();
    const double sr = d->getCurrentSampleRate();
    const int outs = d->getActiveOutputChannels().countNumberOfSetBits();
    auto mapped = mapSong(payload, sr, outs, [this](const juce::String& port, std::vector<std::string>& w) { return midiOuts.resolve(port, w); },
                          [this, sr](const juce::String& text, const juce::var& voice, std::vector<std::string>& w) {
                              return cueAudio ? cueAudio(text, voice, sr, w) : std::shared_ptr<const std::vector<float>>();
                          });
    cfg.sampleRate = sr;
    cfg.numOutputs = outs;
    cfg.midiOffsetMs = settings.getDoubleValue("midiOffsetMs", 0.0);
    refreshClock();
    if (listen.on) {
        applyListen(mapped.def, listen);
        if (listen.mode == "output") cfg.numOutputs = scratchOuts; // every show output, into the scratch buffers
    }
    return mapped;
}

juce::var AudioHost::loadSong(const juce::var& payload)
{
    auto* d = dm.getCurrentAudioDevice();
    if (d == nullptr) return errorObj("No audio device is open. Choose one in Settings › Audio.", "nodevice");
    const double sr = d->getCurrentSampleRate();
    Engine::Config cfg;
    auto mapped = mapForEngine(payload, cfg);
    listenOut1.store(listen.on && listen.mode == "output" && ! listen.output.empty() ? listen.output[0] : -1);
    listenOut2.store(listen.on && listen.mode == "output" && listen.output.size() > 1 ? listen.output[1] : (listen.on && listen.mode == "output" && ! listen.output.empty() ? listen.output[0] : -1));
    std::vector<std::string> warnings = mapped.warnings;
    if (auto err = eng.load(mapped.def, cfg, warnings); ! err.empty()) { loaded = false; applog::line("Song \"" + juce::String(mapped.def.name) + "\" didn't load: " + juce::String(err)); return errorObj(err); }
    applog::line("Loaded \"" + juce::String(mapped.def.name) + "\"" + (listen.on ? " (listening on this computer)" : "") + (warnings.empty() ? juce::String() : ", " + juce::String((int) warnings.size()) + (warnings.size() == 1 ? " warning: " : " warnings: ") + juce::String(warnings.front())));
    eng.setSegue(false); // a song loaded directly: whatever waits in the next slot was queued for another song
    loaded = true;
    loadedEpoch = deviceEpoch;
    loadedName = juce::String(mapped.def.name);
    loadedId = payload["song"]["id"].toString();
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

// 7a: the click of the song playing edited (a region added or extended): the engine swaps in the new hits without
// stopping. {ok} or {error, code: "reload"} when it can't (another song, other click tracks).
juce::var AudioHost::updateClicks(const juce::var& payload)
{
    if (dm.getCurrentAudioDevice() == nullptr || ! loaded || loadedEpoch != deviceEpoch || payload["song"]["id"].toString() != loadedId)
        return errorObj("Not the song loaded.", "reload");
    Engine::Config cfg;
    auto mapped = mapForEngine(payload, cfg);
    if (! eng.updateClicks(mapped.def)) return errorObj("The click tracks changed.", "reload");
    applog::line("Click of \"" + loadedName + "\" updated while playing");
    auto* o = new juce::DynamicObject(); o->setProperty("ok", true); o->setProperty("clickHits", (int) (mapped.def.clickHits ? mapped.def.clickHits->size() : 0));
    return juce::var(o);
}

juce::var AudioHost::queueNext(const juce::var& payload)
{
    auto* d = dm.getCurrentAudioDevice();
    if (d == nullptr) return errorObj("No audio device is open. Choose one in Settings › Audio.", "nodevice");
    if (! loaded || loadedEpoch != deviceEpoch) return errorObj("Load the song first.", "reload");
    Engine::Config cfg;
    auto mapped = mapForEngine(payload, cfg);
    std::vector<std::string> warnings = mapped.warnings;
    if (auto err = eng.prepareNext(mapped.def, warnings); ! err.empty()) { nextLoaded = false; return errorObj(err); }
    nextLoaded = true;
    nextName = juce::String(mapped.def.name);
    nextId = payload["song"]["id"].toString();
    nextTrackIds = mapped.engineTrack;
    nextLevels = mapped.levels;
    // its levels are in place before it can take over (same rule as applyLevels)
    bool anySolo = false;
    for (auto& [name, lv] : nextLevels) anySolo |= lv.solo;
    for (auto& [name, id] : nextTrackIds) {
        const auto& lv = nextLevels[name];
        eng.setTrackLevel(id, lv.db, id <= -200 ? lv.mute : lv.mute || (anySolo && ! lv.solo) || lv.db <= -60.0f, true);
    }
    eng.setSegue((bool) payload["segue"]);
    applog::line("Next: \"" + nextName + "\"" + ((bool) payload["segue"] ? " (segue)" : ""));
    auto* o = new juce::DynamicObject();
    o->setProperty("ok", true);
    juce::Array<juce::var> wa; for (auto& s : warnings) wa.addIfNotAlreadyThere(juce::String(s));
    o->setProperty("warnings", wa);
    return juce::var(o);
}

juce::var AudioHost::nextState()
{
    auto* o = new juce::DynamicObject();
    const bool l = nextLoaded && eng.hasNext();
    o->setProperty("loaded", l);
    o->setProperty("ready", l && eng.nextReady());
    o->setProperty("songId", l ? nextId : juce::String());
    o->setProperty("name", l ? nextName : juce::String());
    o->setProperty("segue", l && eng.segueOn());
    return juce::var(o);
}

void AudioHost::takeOverNext()
{
    loadedName = nextName; loadedId = nextId;
    trackIds = nextTrackIds; levels = nextLevels;
    nextLoaded = false; nextName = {}; nextId = {}; nextTrackIds.clear(); nextLevels.clear();
    seguesSeen = eng.segues();
}

juce::var AudioHost::queueJump(const juce::var& req)
{
    if (! loaded) return errorObj("Load the song first.", "reload");
    auto* o = new juce::DynamicObject();
    if ((bool) req["cancel"]) { eng.clearJump(); o->setProperty("queued", false); return juce::var(o); }
    const auto& tm = eng.tempoMap();
    const double sr = eng.sampleRate() > 0 ? eng.sampleRate() : 48000.0;
    // armed a little ahead of the position (the disk prepares the target meanwhile)
    const int64_t now = eng.position() + (int64_t) (0.06 * sr);
    const auto when = req["when"].toString();
    int64_t at;
    if (when == "section") { at = tm.sampleAt(juce::jmax(1, (int) req["atBar"]), 1); if (at <= now) at = tm.nextBarStart(now); }
    else if (when == "beat") { int b = 1; double beat = 1; tm.barBeatAt(now, b, beat); at = tm.sampleAt(b, std::floor(beat) + 1); }
    else at = tm.nextBarStart(now);
    const int64_t to = tm.sampleAt(juce::jmax(1, (int) req["toBar"]), juce::jmax(1.0, (double) req.getProperty("toBeat", 1.0)));
    if (to >= eng.lengthSamples()) return errorObj("That's past the end of the song.");
    eng.setJump(at, to, false);
    if (onJumpQueued) onJumpQueued(at, to); // 7d: the backup jumps on the same sample
    int ab = 1; double abt = 1; tm.barBeatAt(at, ab, abt);
    o->setProperty("queued", true);
    o->setProperty("atBar", ab);
    o->setProperty("atBeat", abt);
    o->setProperty("atSeconds", (double) at / sr);
    return juce::var(o);
}

juce::var AudioHost::transport(const juce::var& req)
{
    const auto cmd = req["cmd"].toString();
    if (cmd == "stop") {
        eng.stop();
        if (loaded) eng.prime(eng.position()); // 8d: Play usually starts again from here: its audio ready now
    } else if (cmd == "next") { // Next while playing: the song waiting in the next slot, faded over (10 ms)
        if (! nextLoaded || ! eng.hasNext()) return errorObj("The next song isn't loaded yet.", "nonext");
        if (req["songId"].toString().isNotEmpty() && req["songId"].toString() != nextId) return errorObj("Another song is waiting.", "nonext");
        if (! eng.switchToNext()) return errorObj("The disk couldn't load the audio in time.", "preroll");
        takeOverNext();
        applyLevels();
    } else if (cmd == "segue") {
        eng.setSegue((bool) req["on"]);
    } else if (cmd == "play") {
        // the song asked for is waiting in the next slot (primed): it becomes the song, no loading
        if (req["songId"].toString().isNotEmpty() && nextLoaded && eng.hasNext() && req["songId"].toString() == nextId && eng.promoteNext()) { takeOverNext(); applyLevels(); }
        if (dm.getCurrentAudioDevice() == nullptr) return errorObj("No audio device is open. Choose one in Settings › Audio.", "nodevice");
        if (! loaded || loadedEpoch != deviceEpoch) return errorObj("Load the song first.", "reload");
        const int bar = juce::jmax(1, (int) req.getProperty("fromBar", 1));
        const double beat = juce::jmax(1.0, (double) req.getProperty("fromBeat", 1.0));
        const int64_t from = eng.tempoMap().sampleAt(bar, beat);
        if (from >= eng.lengthSamples()) return errorObj("That position is past the end of the song.", "end");
        const int ahead = rigDelayMs ? rigDelayMs() : 0; // 7d: a paired primary starts a moment ahead, with the backup
        if (! (ahead > 0 ? eng.startAt(from, Clock::now() + std::chrono::milliseconds(ahead)) : eng.start(from))) return errorObj("The disk couldn't load the audio in time.", "preroll");
    } else {
        return errorObj("transport: unknown cmd \"" + cmd + "\"");
    }
    auto st = transportState();
    if (emit) emit("transport", st);
    wasPlaying = eng.isPlaying();
    if (onTransportChange) onTransportChange();
    return st;
}

// ---- 7d: backup rig
namespace { Clock::time_point fromHostMs(double ms) { return Clock::now() + std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double, std::milli>(ms - juce::Time::getMillisecondCounterHiRes())); } }
void AudioHost::setRigMute(bool on, const juce::StringArray& also)
{
    for (int i = 0; i < MidiOuts::Max; ++i) midiOuts.rigAllow[(size_t) i].store(i < midiOuts.count.load() && also.contains(midiOuts.names[(size_t) i]));
    midiOuts.rigMute.store(on);
}
juce::var AudioHost::rigStart(int64_t from, double atHostMs)
{
    if (dm.getCurrentAudioDevice() == nullptr || ! loaded || loadedEpoch != deviceEpoch) return errorObj("Load the song first.", "reload");
    if (from < 0 || from >= eng.lengthSamples()) return errorObj("Past the end.");
    if (! eng.startAt(from, fromHostMs(atHostMs))) return errorObj("The disk couldn't load the audio in time.", "preroll");
    if (emit) emit("transport", transportState());
    wasPlaying = true;
    return transportState();
}
juce::var AudioHost::rigJump(int64_t at, int64_t to) { if (! loaded) return errorObj("Load the song first."); eng.setJump(at, to, false); auto* o = new juce::DynamicObject(); o->setProperty("ok", true); return juce::var(o); }
juce::var AudioHost::rigJumpAtHost(double atHostMs, int64_t to) { if (! eng.isPlaying()) return errorObj("Not playing"); eng.jumpAtHost(fromHostMs(atHostMs), to); auto* o = new juce::DynamicObject(); o->setProperty("ok", true); return juce::var(o); }
int64_t AudioHost::rigSampleAt(double atHostMs) { return eng.isPlaying() ? eng.sampleAtHost(fromHostMs(atHostMs)) : -1; }

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
        // a MIDI track has M only: soloing audio never stops the MIDI (a guitar rig, lights)
        const bool off = id <= -200 ? lv.mute : lv.mute || (anySolo && ! lv.solo) || lv.db <= -60.0f;
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
    o->setProperty("songId", loadedId);
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
    const auto sent = eng.midi.sent.load() + eng.midiClock.sent.load();
    o->setProperty("running", d != nullptr && d->isPlaying());
    o->setProperty("xruns", xr < 0 ? juce::var() : juce::var(xr - xrunBase)); // null: the driver doesn't report them
    o->setProperty("underruns", (juce::int64) eng.stats.underruns.load());
    o->setProperty("midiSent", (juce::int64) sent);
    o->setProperty("midiDropped", (juce::int64) (eng.midi.dropped.load() + eng.midiClock.dropped.load()));
    o->setProperty("midiLateMaxMs", juce::jmax(eng.midi.lateMaxUs.load(), eng.midiClock.lateMaxUs.load()) / 1000.0);
    o->setProperty("midiLateAvgMs", sent ? (eng.midi.lateSumUs.load() + eng.midiClock.lateSumUs.load()) / 1000.0 / (double) sent : 0.0);
    o->setProperty("cpu", dm.getCpuUsage() * 100.0);
    o->setProperty("callbackMaxMs", eng.stats.cbMaxUs.load() / 1000.0);
    o->setProperty("budgetMs", sr > 0 ? 1000.0 * buf / sr : 0.0);
    o->setProperty("overBudget", (juce::int64) eng.stats.cbOverBudget.load());
    return juce::var(o);
}

void AudioHost::timerCallback()
{
    collectPreviews();
    eng.collect(); // old click hits handed back by the audio thread (7a)
    if (scanTick % 30 == 0) { // 7a: each MIDI send over 2 ms late goes to the log once, with what the sender was doing
        MidiScheduler* sch[2] = { &eng.midi, &eng.midiClock };
        for (int k = 0; k < 2; ++k)
            for (const int n = sch[k]->lateCount.load(std::memory_order_acquire); lateSeen[k] < n; ++lateSeen[k]) {
                const auto& L = sch[k]->late(lateSeen[k]);
                applog::line(juce::String("MIDI late: ") + (k ? "clock " : "") + juce::String::toHexString((int) L.status).toUpperCase() + " port " + juce::String(L.port + 1) + " "
                             + juce::String(L.lateUs / 1000.0, 2) + " ms (woke " + juce::String(L.wakeLateUs / 1000.0, 2) + " ms late, driver call " + juce::String(L.sendUs / 1000.0, 2)
                             + " ms; before: slept " + juce::String(L.sleepTookUs / 1000.0, 2) + " of " + juce::String(L.sleepAskUs / 1000.0, 2) + " ms, previous send " + juce::String(L.prevSendUs / 1000.0, 2)
                             + " ms; " + juce::String(L.queued) + " queued)");
            }
    }
    if (++scanTick % 60 == 1) scanMidiPorts(); // MIDI outputs: clock on new ones, reopen ones that came back
    if (scanTick % 60 == 31 && autoFrom.isNotEmpty()) checkInterfaceBack(); // 7a: the missing interface plugged back in
    if (! emit) return;
    bool segued = false;
    if (eng.segues() != seguesSeen) { takeOverNext(); applyLevels(); segued = true; applog::line("Segue into \"" + loadedName + "\""); }
    const bool playing = eng.isPlaying();
    if (playing || playing != wasPlaying || segued) {
        auto st = transportState();
        if (segued) st.getDynamicObject()->setProperty("segued", true);
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
        // each track after its fader (the header meters), by track name
        auto* tr = new juce::DynamicObject();
        for (auto& [name, id] : trackIds) if (id > -200 && name.isNotEmpty()) { const float p = eng.takeTrackPeak(id); any |= p > 0.0f; tr->setProperty(name, p); }
        o->setProperty("tracks", juce::var(tr));
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
    o->setProperty("length", (double) e.lengthSamples()); // the song (version) as the engine plays it, in samples
    o->setProperty("first", (double) first); // song sample of stream index 0 (a start mid-song prerolls 5 ms)
    o->setProperty("bars", bars);
    o->setProperty("outs", res);
    o->setProperty("midi", midi);
    o->setProperty("warnings", w);
    o->setProperty("samples", juce::var(samples));
    juce::Array<juce::var> hashes; // FNV-1a over the float bits of each whole output
    for (auto& ch : out) { uint64_t h = 1469598103934665603ull; for (float v : ch) { uint32_t u; std::memcpy(&u, &v, 4); for (int k = 0; k < 4; ++k) { h ^= (u >> (8 * k)) & 0xff; h *= 1099511628211ull; } } hashes.add(juce::String::toHexString((juce::int64) h)); }
    o->setProperty("hashes", hashes);
    return juce::var(o);
}

} // namespace setline::gui
