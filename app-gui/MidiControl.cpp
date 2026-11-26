#include "MidiControl.h"
#include "Log.h"
#include <juce_events/juce_events.h>

namespace setline::gui {

namespace {
juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> kv)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : kv) o->setProperty(k, v);
    return juce::var(o);
}
MidiMapping fromVar(const juce::var& v)
{
    MidiMapping m;
    m.id = v["id"].toString().toStdString();
    m.action = v["action"].toString().toStdString();
    m.port = v["port"].toString().toStdString();
    const auto t = v["type"].toString();
    m.type = t == "cc" ? MidiMapping::CC : t == "pc" ? MidiMapping::PC : MidiMapping::Note;
    m.ch = juce::jlimit(0, 16, (int) v["ch"]);
    m.num = juce::jlimit(0, 127, (int) v["num"]);
    const auto mode = v["mode"].toString();
    m.mode = mode == "any" ? MidiMapping::Any : mode == "momentary" ? MidiMapping::Momentary : MidiMapping::Cross;
    m.debounceMs = v.hasProperty("debounce") ? juce::jlimit(0.0, 2000.0, (double) v["debounce"]) : 150.0;
    return m;
}
juce::String describe(const MidiKind& k)
{
    switch (k.kind) {
        case 1: return "Note " + juce::String(k.num) + " on (vel " + juce::String(k.val) + "), ch " + juce::String(k.ch);
        case 2: return "Note " + juce::String(k.num) + " off, ch " + juce::String(k.ch);
        case 3: return "CC " + juce::String(k.num) + " = " + juce::String(k.val) + ", ch " + juce::String(k.ch);
        case 4: return "Program " + juce::String(k.num) + ", ch " + juce::String(k.ch);
        default: return {};
    }
}
} // namespace

MidiControl::MidiControl(juce::PropertiesFile& s) : settings(s)
{
    fires.reserve(16);
    const auto v = juce::JSON::parse(settings.getValue("midiMappings"));
    if (v.isArray()) setMappings(v);
    scan();
    startTimer(2000); // a pedal plugged in later
}

MidiControl::~MidiControl()
{
    stopTimer();
    *alive = nullptr;
    for (auto& i : ins) if (i) i->stop();
    ins.clear();
}

juce::var MidiControl::mappings() const { std::lock_guard<std::mutex> g(lock); return saved.isArray() ? saved : juce::var(juce::Array<juce::var>()); }

void MidiControl::setMappings(const juce::var& list)
{
    std::vector<MidiMapping> m;
    if (auto* a = list.getArray()) for (auto& x : *a) if (x.isObject() && x["action"].toString().isNotEmpty()) m.push_back(fromVar(x));
    {
        std::lock_guard<std::mutex> g(lock);
        mapper.set(std::move(m));
        saved = list.isArray() ? list : juce::var(juce::Array<juce::var>());
    }
    settings.setValue("midiMappings", juce::JSON::toString(saved, true));
    settings.saveIfNeeded();
}

juce::StringArray MidiControl::inputs() const
{
    juce::StringArray n;
    for (auto& i : ins) if (i) n.add(i->getName());
    return n;
}

void MidiControl::scan()
{
    const auto avail = juce::MidiInput::getAvailableDevices();
    // gone: close
    for (auto it = ins.begin(); it != ins.end();) {
        bool there = false;
        for (auto& d : avail) there |= d.identifier == (*it)->getIdentifier();
        if (! there) { applog::line("MIDI in: " + (*it)->getName() + " is gone"); (*it)->stop(); it = ins.erase(it); } else ++it;
    }
    // new: open (every input; set.Line only reacts to mapped messages)
    for (auto& d : avail) {
        bool open = false;
        for (auto& i : ins) open |= i->getIdentifier() == d.identifier;
        if (open) continue;
        if (auto in = juce::MidiInput::openDevice(d.identifier, this)) {
            in->start();
            applog::line("MIDI in: " + d.name);
            ins.push_back(std::move(in));
        }
    }
}

void MidiControl::handleIncomingMidiMessage(juce::MidiInput* source, const juce::MidiMessage& m)
{
    if (m.getRawDataSize() < 1 || m.getRawDataSize() > 3) return; // SysEx and the like: never an action
    incoming(source ? source->getName() : juce::String(), m.getRawData(), m.getRawDataSize());
}

void MidiControl::inject(const juce::String& port, const juce::var& bytes)
{
    uint8_t d[3] {}; int n = 0;
    if (auto* a = bytes.getArray()) for (auto& b : *a) if (n < 3) d[n++] = (uint8_t) (int) b;
    std::thread([this, port, d, n, alive_ = alive] { if (*alive_) incoming(port, d, n); }).detach();
}

// Any MIDI input thread. Clock / active sensing / system: ignored. Our own messages echoing back: ignored.
void MidiControl::incoming(const juce::String& port, const uint8_t* d, int len)
{
    const double now = juce::Time::getMillisecondCounterHiRes();
    MidiIn in; in.port = port.toStdString(); in.len = len; for (int i = 0; i < len && i < 3; ++i) in.b[i] = d[i]; in.timeMs = now;
    const MidiKind k = classify(in);
    if (k.kind == 0) return;
    if (echo.isEcho(d, len, now)) return;
    auto alive_ = alive;
    if (learning.load() && (k.kind == 1 || k.kind == 3 || k.kind == 4)) {
        learning.store(false);
        const juce::String type = k.kind == 1 ? "note" : k.kind == 3 ? "cc" : "pc";
        juce::MessageManager::callAsync([alive_, port, type, k] { if (*alive_ && (*alive_)->emit) (*alive_)->emit("midiLearned", obj({ { "port", port }, { "type", type }, { "ch", k.ch }, { "num", k.num }, { "val", k.val } })); });
        return;
    }
    // the mapped actions, straight to the page (the same path as a key press)
    juce::Array<juce::var> acts;
    {
        std::lock_guard<std::mutex> g(lock);
        mapper.feed(in, fires);
        for (auto& f : fires) {
            const auto& m = mapper.mappings()[(size_t) f.mapping];
            acts.add(obj({ { "action", juce::String(m.action) }, { "mapping", juce::String(m.id) }, { "press", f.press }, { "port", port }, { "t0", now } }));
        }
    }
    const juce::String text = describe(k);
    const bool show = now - lastActivity.load() > 40 || ! acts.isEmpty(); // the Activity line: at most ~25 a second
    if (show) lastActivity.store(now);
    if (acts.isEmpty() && ! show) return;
    juce::MessageManager::callAsync([alive_, acts, port, text, k, show] {
        if (! *alive_ || ! (*alive_)->emit) return;
        for (auto a : acts) {
            if ((*alive_)->fast) {
                const double t1 = juce::Time::getMillisecondCounterHiRes();
                const auto r = (*alive_)->fast(a["action"].toString(), (bool) a["press"], (double) a["t0"]);
                if (! r.isVoid()) if (auto* o = a.getDynamicObject()) { o->setProperty("fast", true); o->setProperty("fastMs", r.hasProperty("actMs") ? (double) r["actMs"] : juce::Time::getMillisecondCounterHiRes() - (double) a["t0"]); o->setProperty("doneMs", juce::Time::getMillisecondCounterHiRes() - (double) a["t0"]); o->setProperty("fastResult", r); o->setProperty("hopMs", t1 - (double) a["t0"]); }
            }
            (*alive_)->emit("midiAction", a);
        }
        if (show) (*alive_)->emit("midiIn", obj({ { "port", port }, { "text", text }, { "kind", k.kind }, { "ch", k.ch }, { "num", k.num }, { "val", k.val }, { "mapped", ! acts.isEmpty() } }));
    });
}

} // namespace setline::gui
