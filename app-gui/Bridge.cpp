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

Bridge::Bridge(AudioHost& host, juce::PropertiesFile& settings) : audio(host), session(settings), media(settings)
{
    audio.onSetupChanged = [this] { emit("audioSetupChanged", audio.getSetup()); };
    audio.emit = [this](const juce::Identifier& id, const juce::var& v) { emit(id, v); };
    media.emit = [this](const juce::Identifier& id, const juce::var& v) { emit(id, v); };
}

Bridge::~Bridge() { audio.onSetupChanged = nullptr; audio.emit = nullptr; media.emit = nullptr; }

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
        if (testScript != juce::File()) r->setProperty("testScript", testScript.loadFileAsString());
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
    // Step 2: sessions live in their own folder; audio references are relative to it (see Media.h).
    o = add(o, "getSessionFile", [this](const juce::var&) {
        auto* r = new juce::DynamicObject();
        r->setProperty("path", session.file() == juce::File() ? juce::String() : session.file().getFullPathName());
        r->setProperty("name", session.name());
        return juce::var(r);
    });
    o = addAsync(o, "chooseSessionFile", [this](const juce::var&, auto done) { session.chooseLocation(done); });
    o = add(o, "writeSession", [this](const juce::var& a) {
        const auto path = a["path"].toString();
        if (! juce::File::isAbsolutePath(path)) return errorVar("writeSession: expected an absolute path");
        return session.writeTo(juce::File(path), a["text"].toString());
    });
    // Windows: the page posts dropped files with chrome.webview.postMessageWithAdditionalObjects; the
    // JUCE patch (cmake/PatchJuce.cmake) adds their real paths to the payload. Sent back to the page as
    // a "fileDrag" drop, the same event the macOS window drop (WebUi) produces.
    o = o.withEventListener("setlineDrop", [this](const juce::var& p) {
        juce::StringArray paths;
        if (auto* a = p["paths"].getArray()) for (auto& v : *a) paths.add(v.toString());
        fileDrag("drop", { (int) p["x"], (int) p["y"] }, paths);
    });
    o = addAsync(o, "pickAudioFiles", [this](const juce::var& a, auto done) { media.pick(a, done); });
    o = add(o, "probeAudio", [this](const juce::var& a) { return media.probePaths(a); });
    o = addAsync(o, "importAudio", [this](const juce::var& a, auto done) {
        const juce::File sessionFile(a["session"].toString());
        media.import(a, [this, done, sessionFile](juce::var r) {
            juce::Array<juce::var> refs; // waveforms are computed right after the copy, in the background
            if (auto* f = r["files"].getArray()) for (auto& x : *f) refs.add(x["ref"]);
            preparePeaks(refs, sessionFile);
            done(r);
        });
    });
    o = addAsync(o, "collectAudio", [this](const juce::var& a, auto done) { media.collect(a, done); });
    o = add(o, "checkAudio", [this](const juce::var& a) {
        auto r = media.check(a);
        // Opening a session: waveforms not cached yet are computed in the background (found files only).
        juce::Array<juce::var> refs;
        if (auto* list = a["refs"].getArray())
            for (auto& ref : *list) {
                const auto moved = r["map"][juce::Identifier(ref.toString())];
                refs.add(moved.isVoid() ? ref : moved);
            }
        preparePeaks(refs, juce::File(a["session"].toString()));
        return r;
    });
    // Waveform of one file at about `spp` frames per value: {rate, frames, channels, spp, peaks: base64, cache} | {error}.
    o = addAsync(o, "getPeaks", [this](const juce::var& a, auto done) {
        const auto f = Media::resolve(a["ref"].toString(), session.file());
        if (f == juce::File()) { done(errorVar("No such file")); return; }
        const int spp = a["spp"].isVoid() ? 1024 : (int) a["spp"];
        const auto cache = Peaks::cacheFileFor(f, session.file()).getFullPathName(); // reported for tests and support
        peaks.get(f, session.file(), [done, spp, cache](std::shared_ptr<const Peaks::Data> d, const juce::String& error) {
            if (d == nullptr) { done(errorVar(error)); return; }
            auto r = Peaks::toVar(*d, spp);
            r.getDynamicObject()->setProperty("cache", cache);
            done(r);
        });
    });
    o = addAsync(o, "locateAudio", [this](const juce::var& a, auto done) { media.locate(a, done); });

    o = add(o, "roundTripRead", [this](const juce::var&) {
        auto* r = new juce::DynamicObject(); r->setProperty("text", roundTripIn.loadFileAsString()); return juce::var(r);
    });
    o = add(o, "roundTripDone", [this](const juce::var& a) {
        const bool ok = roundTripOut.replaceWithText(a["text"].toString(), false, false, "\n");
        juce::MessageManager::callAsync([] { juce::JUCEApplication::quit(); });
        auto* r = new juce::DynamicObject(); r->setProperty("ok", ok); return juce::var(r);
    });
    o = add(o, "testDone", [this](const juce::var& a) {
        const bool ok = testOut.replaceWithText(a["text"].toString(), false, false, "\n");
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

void Bridge::preparePeaks(const juce::var& refs, const juce::File& sessionFile)
{
    juce::Array<juce::File> files;
    if (auto* a = refs.getArray())
        for (auto& r : *a)
            if (auto f = Media::resolve(r.toString(), sessionFile); f.existsAsFile()) files.add(f);
    peaks.prepare(files, sessionFile);
}

void Bridge::fileDrag(const juce::String& state, juce::Point<int> at, const juce::StringArray& paths)
{
    auto* o = new juce::DynamicObject();
    o->setProperty("state", state);
    o->setProperty("x", at.x);
    o->setProperty("y", at.y);
    juce::Array<juce::var> list;
    for (auto& p : paths) list.add(p);
    o->setProperty("paths", list);
    emit("fileDrag", juce::var(o));
}

void Bridge::emit(const juce::Identifier& event, const juce::var& payload)
{
    if (browser != nullptr) browser->emitEventIfBrowserIsVisible(event, payload);
}

} // namespace setline::gui
