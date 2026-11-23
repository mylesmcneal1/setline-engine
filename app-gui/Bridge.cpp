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

Bridge::Bridge(AudioHost& host) : audio(host)
{
    audio.onSetupChanged = [this] { emit("audioSetupChanged", audio.getSetup()); };
}

Bridge::~Bridge() { audio.onSetupChanged = nullptr; }

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
        return juce::var(r);
    });
    o = add(o, "getAudioSetup", [this](const juce::var& a) { return audio.getSetup(a.isObject() && (bool) a["rescan"]); });
    o = add(o, "setAudioSetup", [this](const juce::var& a) {
        if (! a.isObject()) return errorVar("setAudioSetup: expected {driver, device, rate, buffer}");
        return audio.setSetup(a);
    });
    o = add(o, "getMidiOutputs", [this](const juce::var&) { return audio.midiOutputs(); });
    return o;
}

void Bridge::emit(const juce::Identifier& event, const juce::var& payload)
{
    if (browser != nullptr) browser->emitEventIfBrowserIsVisible(event, payload);
}

} // namespace setline::gui
