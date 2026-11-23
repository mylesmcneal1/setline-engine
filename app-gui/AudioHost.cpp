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
    dm.removeChangeListener(this);
    eng.stop();
    dm.removeAudioCallback(this);
    dm.closeAudioDevice();
}

void AudioHost::start()
{
    dm.getAvailableDeviceTypes(); // creates the driver types and scans them
    dm.addAudioCallback(this);

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

    if (auto err = dm.setAudioDeviceSetup(s, true); err.isNotEmpty()) return err;
    auto* d = dm.getCurrentAudioDevice();
    if (d == nullptr) return "The device didn't open.";
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
        key << dm.getCurrentAudioDeviceType() << "|" << d->getName() << "|" << d->getCurrentSampleRate() << "|" << d->getCurrentBufferSizeSamples();
    if (key == lastDeviceKey) return;
    lastDeviceKey = key;
    if (key.isEmpty()) error = "The audio device stopped (unplugged or driver reset).";
    if (onSetupChanged) onSetupChanged();
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
