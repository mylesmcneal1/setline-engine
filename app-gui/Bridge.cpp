#include "Bridge.h"
#include "AudioHost.h"

namespace setline::gui {

namespace {
juce::var errorVar(const juce::String& msg)
{
    auto* o = new juce::DynamicObject();
    o->setProperty("error", msg);
    return juce::var(o);
}
} // namespace

Bridge::Bridge(AudioHost& host, juce::PropertiesFile& settings) : audio(host), session(settings)
{
    audio.onSetupChanged = [this] { emit("audioSetupChanged", audio.getSetup()); };
    audio.emit = [this](const juce::Identifier& id, const juce::var& v) { emit(id, v); };
}

Bridge::~Bridge() { audio.onSetupChanged = nullptr; audio.emit = nullptr; }

Bridge::Options Bridge::add(Options o, const char* name, Fn fn)
{
    return o.withNativeFunction(name, [fn = std::move(fn), name](const juce::Array<juce::var>& args,
                                                                 juce::WebBrowserComponent::NativeFunctionCompletion done) {
        juce::var in;
        if (! args.isEmpty() && args[0].isString() && args[0].toString().isNotEmpty()) {
            if (juce::JSON::parse(args[0].toString(), in).failed()) { done(juce::JSON::toString(errorVar(juce::String(name) + ": bad JSON"), true)); return; }
        }
        juce::var out;
        try { out = fn(in); }
        catch (const std::exception& e) { out = errorVar(juce::String(name) + ": " + e.what()); }
        done(juce::JSON::toString(out, true));
    });
}

Bridge::Options Bridge::addAsync(Options o, const char* name, AsyncFn fn)
{
    return o.withNativeFunction(name, [fn = std::move(fn), name](const juce::Array<juce::var>& args,
                                                                 juce::WebBrowserComponent::NativeFunctionCompletion done) {
        juce::var in;
        if (! args.isEmpty() && args[0].isString() && args[0].toString().isNotEmpty()
            && juce::JSON::parse(args[0].toString(), in).failed()) { done(juce::JSON::toString(errorVar(juce::String(name) + ": bad JSON"), true)); return; }
        fn(in, [done](juce::var out) { done(juce::JSON::toString(out, true)); });
    });
}

Bridge::Options Bridge::addTo(Options o)
{
    o = add(o, "getAppInfo", [this](const juce::var&) {
        auto* r = new juce::DynamicObject();
        r->setProperty("name", juce::JUCEApplication::getInstance()->getApplicationName());
        r->setProperty("version", juce::JUCEApplication::getInstance()->getApplicationVersion());
        r->setProperty("platform", juce::SystemStats::getOperatingSystemName());
        #if JUCE_MAC
        r->setProperty("mac", true);
       #else
        r->setProperty("mac", false);
       #endif
        r->setProperty("dev", devMode);
        if (roundTripIn != juce::File()) {
            auto* rt = new juce::DynamicObject(); rt->setProperty("in", roundTripIn.getFullPathName()); rt->setProperty("out", roundTripOut.getFullPathName());
            r->setProperty("roundTrip", juce::var(rt));
        }
        return juce::var(r);
    });
    o = add(o, "getAudioSetup", [this](const juce::var& a) { return audio.getSetup(a.isObject() && (bool) a["rescan"]); });
    o = add(o, "setAudioSetup", [this](const juce::var& a) {
        if (! a.isObject()) return errorVar("setAudioSetup: expected {driver, device, rate, buffer}");
        return audio.setSetup(a);
    });
    o = add(o, "getMidiOutputs", [this](const juce::var&) { return audio.midiOutputs(); });
    o = add(o, "loadSong", [this](const juce::var& a) {
        if (! a.isObject() || ! a["song"].isObject()) return errorVar("loadSong: expected {song, routing, roles, click}");
        return audio.loadSong(a);
    });
    o = add(o, "transport", [this](const juce::var& a) { return audio.transport(a); });
    o = add(o, "getTransport", [this](const juce::var&) { return audio.transportState(); });
    o = add(o, "getEngineStats", [this](const juce::var&) { return audio.engineStats(); });
    o = add(o, "setTrackLevel", [this](const juce::var& a) { return audio.setTrackLevel(a); });
    o = add(o, "setLoop", [this](const juce::var& a) { return audio.setLoop(a); });

    // Sessions (.setline): the page sends / receives the session as JSON text.
    o = addAsync(o, "openSession", [this](const juce::var&, auto done) { session.open(done); });
    o = addAsync(o, "saveSession", [this](const juce::var& a, auto done) { session.save(a["text"].toString(), done); });
    o = addAsync(o, "saveSessionAs", [this](const juce::var& a, auto done) { session.saveAs(a["text"].toString(), done); });
    o = add(o, "roundTripRead", [this](const juce::var&) {
        auto* r = new juce::DynamicObject(); r->setProperty("text", roundTripIn.loadFileAsString()); return juce::var(r);
    });
    o = add(o, "roundTripDone", [this](const juce::var& a) {
        const bool ok = roundTripOut.replaceWithText(a["text"].toString(), false, false, "\n");
        juce::MessageManager::callAsync([] { juce::JUCEApplication::quit(); });
        auto* r = new juce::DynamicObject(); r->setProperty("ok", ok); return juce::var(r);
    });
    o = add(o, "setDocument", [this](const juce::var& a) {
        dirty = (bool) a["dirty"];
        if (onDocument) onDocument(a["name"].toString(), dirty);
        auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r);
    });
    return o;
}

void Bridge::emit(const juce::Identifier& event, const juce::var& payload)
{
    if (browser != nullptr) browser->emitEventIfBrowserIsVisible(event, payload);
}

} // namespace setline::gui
