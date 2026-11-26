#include "Bridge.h"
#include "Dialogs.h"
#include "AudioHost.h"
#include "Log.h"
#include "Package.h"
#include "AbletonImport.h"
#include "Updater.h"
#include "Media.h"
#include "WebUi.h"
#include <set>

namespace {
// an "audioProgress" event for a package being written (6f)
juce::var progressVar(int64_t done, int64_t total, const juce::String& file, bool finished = false, const juce::String& error = {})
{
    auto* o = new juce::DynamicObject();
    o->setProperty("kind", "export"); o->setProperty("done", (double) done); o->setProperty("total", (double) total);
    o->setProperty("file", file); o->setProperty("finished", finished); o->setProperty("error", error);
    return juce::var(o);
}
} // namespace
#include "Folders.h"

#ifndef SETLINE_ORT_VERSION
 #define SETLINE_ORT_VERSION "?"
#endif

namespace setline::gui {

namespace {
juce::var errorVar(const juce::String& msg)
{
    auto* o = new juce::DynamicObject();
    o->setProperty("error", msg);
    return juce::var(o);
}
} // namespace

Bridge::Bridge(AudioHost& host, juce::PropertiesFile& settings) : audio(host), settings(settings), session(settings), media(settings), lib(settings)
{
    audio.onSetupChanged = [this] { emit("audioSetupChanged", audio.getSetup()); };
    audio.emit = [this](const juce::Identifier& id, const juce::var& v) { emit(id, v); };
    midiControl.emit = [this](const juce::String& id, const juce::var& v) { emit(juce::Identifier(id), v); };
    midiControl.fast = [this](const juce::String& a, bool press, double t0) { return pedalFast(a, press, t0); }; // 8d
    audio.setEchoGuard(&midiControl.echo);
    // 7d: the backup rig
    rig.emit = [this](const juce::String& id, const juce::var& v) { rigMute(); emit(juce::Identifier(id), v); };
    rig.stateNow = [this] { const double now = rig.hostMs(); const auto st = audio.transportState(); auto* o = new juce::DynamicObject();
        o->setProperty("playing", st["playing"]); o->setProperty("songId", st["songId"]); o->setProperty("atMs", now); o->setProperty("pos", (juce::int64) audio.rigSampleAt(now)); return juce::var(o); };
    rig.libraryList = [this] { return rigLib; };
    rig.packageArrived = [this](const juce::File& f) { auto* o = new juce::DynamicObject(); o->setProperty("path", f.getFullPathName()); emit("rigPackage", juce::var(o)); };
    audio.rigDelayMs = [this] { return rig.role() == "primary" && rig.paired() ? rig.latencyMs() : 0; };
    audio.onTransportChange = [this] { rig.transportChanged(); };
    audio.onJumpQueued = [this](int64_t at, int64_t to) { auto* o = new juce::DynamicObject(); o->setProperty("kind", "jump"); o->setProperty("at", (juce::int64) at); o->setProperty("to", (juce::int64) to); o->setProperty("songId", audio.transportState()["songId"]); o->setProperty("id", juce::Time::getHighResolutionTicks()); rig.sendCommand(juce::var(o)); };
    rigMute();
    band.serveFile = [](const juce::String& path, juce::MemoryBlock& out, juce::String& mime) {
        auto r = WebUi::serve(path);
        if (! r) return false;
        out.replaceAll(r->data.data(), r->data.size()); mime = r->mimeType; return true;
    };
    band.onMessage = [this](int id, const juce::String& text) { auto* o = new juce::DynamicObject(); o->setProperty("client", id); o->setProperty("text", text); emit("bandMessage", juce::var(o)); };
    band.onClient = [this](int id, bool on, const juce::String& addr) { auto* o = new juce::DynamicObject(); o->setProperty("client", id); o->setProperty("connected", on); o->setProperty("address", addr); emit("bandClient", juce::var(o)); };
    audio.onMidiReconnected = [this](const juce::StringArray& names) { juce::Array<juce::var> l; for (auto& n : names) l.add(n); auto* o = new juce::DynamicObject(); o->setProperty("reconnected", l); emit("midiReconnected", juce::var(o)); };
    media.emit = [this](const juce::Identifier& id, const juce::var& v) { emit(id, v); };
    // Kokoro voices download when the user asks: progress to the page ("voiceDownload": {state, done, total, error}).
    kokoro::setListener([alive_ = alive](const kokoro::Status& st) {
        juce::MessageManager::callAsync([alive_, st] {
            if (*alive_ == nullptr) return;
            auto* r = new juce::DynamicObject();
            r->setProperty("state", kokoro::stateName(st.state));
            r->setProperty("done", (double) st.done);
            r->setProperty("total", (double) st.total);
            r->setProperty("error", st.error);
            (*alive_)->emit("voiceDownload", juce::var(r));
        });
    });
    audio.cueAudio = [this](const juce::String& text, const juce::var& v, double rate, std::vector<std::string>& w) {
        juce::String missingRec;
        const auto c = choiceOf(v, &missingRec);
        juce::String err;
        bool fellBack = false;
        auto a = cues.cached(text, c, rate, fellBack); // rendered before the load (loadSong below)
        if (! a) { auto it = cueErrors.find(text); err = it != cueErrors.end() && it->second.isNotEmpty() ? it->second : juce::String("not ready"); }
        const juce::String q = juce::String::fromUTF8("\xe2\x80\x9c"), qq = juce::String::fromUTF8("\xe2\x80\x9d");
        if (fellBack) {
            const bool kok = kokoro::find(c.voice) != nullptr;
            w.push_back((juce::String("The cue voice ") + q + c.name + qq + (kok ? " isn't downloaded yet, so cues use the computer's voice for now."
                                                                                       : " isn't installed on this computer, so cues use the default voice.")).toStdString());
        }
        if (missingRec.isNotEmpty()) w.push_back((juce::String("The recording ") + q + missingRec + qq + " for the cue " + q + text + qq + " is missing, so the voice says it.").toStdString());
        if (! a) w.push_back((juce::String("Cue ") + q + text + qq + " couldn't be spoken: " + err).toStdString());
        return a;
    };
}

// The cue choice for a {voice, name, speed, pron, rec} the page sent: rec is a recorded word's reference in the
// show (Audio-style path), resolved here; a recording that's missing falls back to the voice (missing = its name).
Cues::Choice Bridge::choiceOf(const juce::var& v, juce::String* missing) const
{
    auto c = Cues::choiceFrom(v);
    const auto rec = v["rec"].toString();
    if (rec.isNotEmpty()) {
        const auto f = Media::resolve(rec, session.file());
        if (f.existsAsFile()) c.recording = f.getFullPathName();
        else if (missing != nullptr) *missing = rec.fromLastOccurrenceOf("/", false, false).fromLastOccurrenceOf("\\", false, false);
    }
    return c;
}

// The cues of the open show are stored in its folder (Cues.h).
// Everything support needs to know, as text: version, OS, audio, listen mode, MIDI, the show, engine stats, the log.
// The rate cues are made at: the device's, or 48 kHz without one (offline renders use the same).
double Bridge::cueRate() const { return audio.sampleRate() > 0 ? audio.sampleRate() : 48000.0; }

// 8d: a mapped pedal's transport action, done natively on the message thread (no page in between). -> the result,
// or void when the page should do it (not armed, not playing, an action that needs the page...).
juce::var Bridge::pedalFast(const juce::String& a, bool press, double t0)
{
    const auto& arm = pedalArmV;
    if (! arm.isObject() || ! press) return {};
    auto ok = [](const juce::var& r) { return r.isObject() && ! r.hasProperty("error"); };
    auto obj = [](std::initializer_list<std::pair<const char*, juce::var>> kv) { auto* o = new juce::DynamicObject(); for (auto& [k, v] : kv) o->setProperty(k, v); return juce::var(o); };
    const auto st = audio.transportState();
    const bool playing = (bool) st["playing"];
    juce::var r;
    double actMs = 0; // when the engine has it: a stop request is posted at once (the 10 ms fade-out follows, no click)
    if (a == "playStop" || a == "play" || a == "stop") {
        if (playing && a != "play") { actMs = juce::Time::getMillisecondCounterHiRes() - t0; r = audio.transport(obj({ { "cmd", "stop" } })); }
        else if (! playing && a != "stop" && (bool) arm["ready"] && arm["songId"].toString() == st["songId"].toString())
            r = audio.transport(obj({ { "cmd", "play" }, { "fromBar", arm["bar"] }, { "fromBeat", arm["beat"] } }));
    } else if (a == "nextSong") {
        if (playing && arm["nextId"].toString().isNotEmpty()) r = audio.transport(obj({ { "cmd", "next" }, { "songId", arm["nextId"] } }));
    } else if (a.startsWith("jump") && a.length() > 4 && a.substring(4).containsOnly("0123456789")) {
        const int n = a.substring(4).getIntValue();
        auto* js = arm["jumps"].getArray();
        if (playing && js && n >= 1 && n <= js->size() && (int) (*js)[n - 1] >= 1) {
            const int bar = (int) st["bar"]; int atBar = 0;
            if (auto* ss = arm["secs"].getArray()) for (auto& x : *ss) if (bar >= (int) x[0] && bar < (int) x[1]) atBar = (int) x[1];
            const auto when = arm["when"].toString();
            r = audio.queueJump(obj({ { "toBar", (*js)[n - 1] }, { "toBeat", 1 }, { "when", when == "section" && atBar ? "section" : when == "beat" ? "beat" : "bar" }, { "atBar", atBar } }));
        }
    } else if (a == "vamp") {
        if (playing && ! (bool) arm["vamp"]) {
            const int bar = (int) st["bar"];
            if (auto* ss = arm["secs"].getArray()) for (auto& x : *ss) if (bar >= (int) x[0] && bar < (int) x[1]) { r = audio.setLoop(obj({ { "fromBar", x[0] }, { "fromBeat", 1 }, { "toBar", x[1] }, { "toBeat", 1 } })); break; }
        }
    } else if (a == "exitLoop") {
        if (playing && (bool) arm["looping"]) r = audio.setLoop(juce::var());
    } else if (a == "syncMidi") {
        if (auto* d = arm["sync"].getArray()) { int n = 0; for (auto& x : *d) n += ok(audio.sendMidiNow(x["port"].toString(), x["msgs"])) ? 1 : 0; if (n) r = obj({ { "sent", n } }); }
    }
    if (! ok(r)) return {};
    const double done = juce::Time::getMillisecondCounterHiRes() - t0, ms = actMs > 0 ? actMs : done;
    if (auto* ro = r.getDynamicObject()) { ro->setProperty("actMs", ms); ro->setProperty("doneMs", done); }
    ++fastCount; fastSum += ms; if (ms > fastMax) { fastMax = ms; fastWorst = a; }
    if (fastCount <= 20 || ms > 5) applog::line("Pedal fast path: " + a + " in " + juce::String(ms, 2) + " ms");
    return r;
}

juce::String Bridge::diagnostics()
{
    juce::StringArray t;
    const auto ver = juce::JUCEApplication::getInstance()->getApplicationVersion();
    t.add("set.Line diagnostics, " + juce::Time::getCurrentTime().toString(true, true, true, true));
    t.add("Version: " + ver + (ver.endsWith(".0") ? " (dev build)" : ""));
    t.add("OS: " + juce::SystemStats::getOperatingSystemName() + (juce::SystemStats::isOperatingSystem64Bit() ? " (64-bit)" : ""));
    t.add("CPU: " + juce::SystemStats::getCpuModel() + ", " + juce::String(juce::SystemStats::getNumCpus()) + " cores, " + juce::String(juce::SystemStats::getMemorySizeInMegabytes()) + " MB RAM");
    const auto setup = audio.getSetup(false);
    const auto c = setup["current"];
    if (c.isObject()) {
        juce::StringArray outs; if (auto* a = c["outputs"].getArray()) for (auto& o : *a) outs.add(o.toString());
        t.add("Audio: " + c["driver"].toString() + " / " + c["device"].toString() + " / " + juce::String((int) (double) c["rate"]) + " Hz / buffer " + c["buffer"].toString()
              + " / " + juce::String(outs.size()) + " outputs (" + outs.joinIntoString(", ") + ")" + (c.hasProperty("latencyMs") ? " / " + juce::String((double) c["latencyMs"], 1) + " ms output latency" : ""));
    } else t.add("Audio: no device open" + (setup["error"].toString().isNotEmpty() ? " (" + setup["error"].toString() + ")" : juce::String()));
    const auto l = audio.listenState();
    if ((bool) l["on"]) {
        juce::StringArray o; if (auto* a = l["output"].getArray()) for (auto& v : *a) o.add(v.toString());
        t.add("Listen: ON, on this computer (" + l["current"].toString() + "), " + (l["mode"].toString() == "output" ? "output " + o.joinIntoString("-") + " only" : juce::String("everything"))
              + ", click " + ((bool) l["click"] ? "on" : "off") + ", cues " + ((bool) l["cues"] ? "on" : "off") + ", MIDI " + ((bool) l["midi"] ? "sent" : "held back"));
    } else t.add("Listen: off (the show's outputs)");
    juce::StringArray ports; if (auto* a = audio.midiOutputs().getArray()) for (auto& p : *a) ports.add(p["name"].toString());
    t.add("MIDI outputs: " + (ports.isEmpty() ? juce::String("none") : ports.joinIntoString(", ")));
    t.add("Show: " + (session.file() == juce::File() ? juce::String("Untitled (not saved)") : session.name() + " (" + session.file().getFullPathName() + ")"));
    const auto st = audio.engineStats();
    auto num = [](const juce::var& v, int dp) { return v.isVoid() || v.toString().isEmpty() ? juce::String("n/a") : juce::String((double) v, dp); };
    t.add("Engine: running " + juce::String((bool) st["running"] ? "yes" : "no") + ", xruns " + (st["xruns"].isVoid() || st["xruns"].toString().isEmpty() ? juce::String("n/a (this driver doesn't report them)") : st["xruns"].toString())
          + ", underruns " + st["underruns"].toString() + ", worst callback " + num(st["callbackMaxMs"], 2) + " ms of " + num(st["budgetMs"], 2) + " ms, CPU " + num((double) st["cpu"] * 100.0, 1) + "%"
          + ", MIDI sent " + st["midiSent"].toString() + ", dropped " + st["midiDropped"].toString() + ", latest " + num(st["midiLateMaxMs"], 2) + " ms");
    t.add("Startup: " + applog::startupSummary());
    { const auto ri = rig.info(); t.add("Backup rig: " + ri["role"].toString() + (rig.paired() ? ", paired with " + ri["peer"].toString() + ", clock offset " + juce::String((double) ri["offsetMs"], 2) + " ms, worst drift " + juce::String((double) ri["driftWorstMs"], 2) + " ms" + ((bool) ri["failover"] ? ", BACKUP IS LIVE" : "") : juce::String(rig.role() == "off" ? "" : ", not paired"))); }
    t.add("MIDI in: " + (midiControl.inputs().isEmpty() ? juce::String("no inputs") : midiControl.inputs().joinIntoString(", ")) + ", " + juce::String(midiControl.mappings().size()) + " mappings" + (midiActCount ? ", " + juce::String(midiActCount) + " pedal actions, slowest " + juce::String(midiActMax, 1) + " ms" : juce::String()));
    t.add("Pedals (fast path): " + (fastCount ? juce::String(fastCount) + " actions straight to the engine, average " + juce::String(fastSum / fastCount, 2) + " ms, worst " + juce::String(fastMax, 2) + " ms (" + fastWorst + ")" : juce::String("none yet")));
    t.add("Show timing (9b): " + (uiTiming.isNotEmpty() ? uiTiming : juce::String("nothing measured yet")));
    t.add("Kokoro voices: " + kokoro::stateName(kokoro::status().state) + "; voice picker: " + cues.voiceListInfo());
    t.add("");
    t.add("Log (last 200 lines of " + applog::current().getFullPathName() + "):");
    t.add(applog::tail(200));
    return t.joinIntoString("\n");
}

// The library just opened (or renamed): its index is the "session file" everything else resolves against.
juce::var Bridge::libraryOpened(const juce::var& r)
{
    if (r["error"].toString().isEmpty()) { session.setCurrent(lib.index()); syncShow(); if (onDocument) onDocument(lib.name(), false); }
    return r;
}

void Bridge::syncShow() { cues.setShowFolder(session.file() == juce::File() ? juce::File() : session.file().getParentDirectory()); }

void Bridge::rigMute() { audio.setRigMute(rig.midiMuted(), juce::StringArray::fromLines(settings.getValue("rigAlsoSends"))); }

Bridge::~Bridge() {
    exportCancel->store(true);
    if (exporter.joinable()) exporter.join(); band.stop(); if (rigSender.joinable()) rigSender.join(); rig.emit = nullptr; audio.rigDelayMs = nullptr; audio.onTransportChange = nullptr; audio.onJumpQueued = nullptr; midiControl.emit = nullptr; midiControl.fast = nullptr; audio.setEchoGuard(nullptr); kokoro::setListener(nullptr); *alive = nullptr; audio.onSetupChanged = nullptr; audio.emit = nullptr; audio.cueAudio = nullptr; media.emit = nullptr; }

Bridge::Options Bridge::add(Options o, const char* name, Fn fn)
{
    return o.withNativeFunction(name, [fn = std::move(fn), name](const juce::Array<juce::var>& args,
                                                                 juce::WebBrowserComponent::NativeFunctionCompletion done) {
        juce::var in;
        if (! args.isEmpty() && args[0].isString() && args[0].toString().isNotEmpty()) {
            if (juce::JSON::parse(args[0].toString(), in).failed()) { done(juce::JSON::toString(errorVar(juce::String(name) + ": bad JSON"), true)); return; }
        }
        juce::var out;
        static const bool trace = juce::SystemStats::getEnvironmentVariable("SETLINE_TRACE_CALLS", {}).isNotEmpty();
        if (trace) applog::line(juce::String("call ") + name);
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
        static const bool trace = juce::SystemStats::getEnvironmentVariable("SETLINE_TRACE_CALLS", {}).isNotEmpty();
        if (trace) applog::line(juce::String("call ") + name + " (async)");
        fn(in, [done, name](juce::var out) { if (trace) applog::line(juce::String("done ") + name); done(juce::JSON::toString(out, true)); });
    });
}

Bridge::Options Bridge::addTo(Options o)
{
    o = add(o, "getAppInfo", [this](const juce::var&) {
        static bool first = true; if (first) { first = false; applog::mark("page script running"); }
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
        if (testScript != juce::File()) { r->setProperty("testScript", testScript.loadFileAsString()); r->setProperty("reopenLast", reopenLastInTests); }
        return juce::var(r);
    });
    // Start-up: the show to reopen (the last one), once per run. {path} or {}.
    o = add(o, "takeStartShow", [this](const juce::var&) {
        auto* r = new juce::DynamicObject();
        if (! startShowTaken && reopenLast && (testScript == juce::File() || reopenLastInTests)) {
            const auto p = session.lastSession();
            if (p.isNotEmpty()) r->setProperty("path", p);
        }
        startShowTaken = true;
        return juce::var(r);
    });
    // ---- standard folders (Folders.h): Shows (changeable), Library, Save by name ----
    o = add(o, "folders", [this](const juce::var&) {
        auto* r = new juce::DynamicObject();
        r->setProperty("shows", folders::shows(settings).getFullPathName());
        r->setProperty("defaultShows", folders::defaultShows().getFullPathName());
        r->setProperty("library", folders::library().getFullPathName());
        return juce::var(r);
    });
    o = add(o, "showTarget", [this](const juce::var& a) { return session.inShows(a["name"].toString(), (bool) a["create"]); });
    o = addAsync(o, "chooseShowsFolder", [this](const juce::var&, auto done) {
        dialogs::open("Shows folder", std::make_unique<juce::FileChooser>("Where new shows are saved", folders::shows(settings)), juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [this, done](const juce::FileChooser& fc) {
            auto* r = new juce::DynamicObject();
            const auto f = fc.getResult();
            if (f == juce::File() || ! f.isDirectory()) r->setProperty("cancelled", true);
            else { settings.setValue("showsFolder", f.getFullPathName()); settings.saveIfNeeded(); applog::line("Shows folder: " + f.getFullPathName()); }
            r->setProperty("shows", folders::shows(settings).getFullPathName());
            done(juce::var(r));
        });
    });
    o = add(o, "resetShowsFolder", [this](const juce::var&) {
        settings.removeValue("showsFolder"); settings.saveIfNeeded();
        auto* r = new juce::DynamicObject(); r->setProperty("shows", folders::shows(settings).getFullPathName()); return juce::var(r);
    });
    o = add(o, "revealFolder", [this](const juce::var& a) {
        const auto which = a["which"].toString();
        const auto f = which == "library" ? folders::library() : which == "logs" ? applog::folder() : folders::shows(settings);
        f.createDirectory();
        f.startAsProcess(); // opens it in Explorer / Finder
        auto* r = new juce::DynamicObject(); r->setProperty("path", f.getFullPathName()); return juce::var(r);
    });
    // Automatic backups (SessionFile.h): the list, and one backup's text (opened as the show, unsaved).
    o = add(o, "listBackups", [this](const juce::var&) { return session.backups(); });
    o = add(o, "readBackup", [this](const juce::var& a) {
        const juce::File f(a["path"].toString());
        auto* r = new juce::DynamicObject();
        // only a file in this show's Backups folder
        if (session.file() == juce::File() || f.getParentDirectory() != session.file().getParentDirectory().getChildFile("Backups") || ! f.existsAsFile())
            r->setProperty("error", "That backup isn't there any more.");
        else { r->setProperty("text", f.loadFileAsString()); applog::line("Opened backup " + f.getFullPathName()); }
        return juce::var(r);
    });
    // Glue (6c item 7): {payload, track, ref, from, to (seconds)} -> a new WAV in the show's Audio folder: the
    // track's file as it is, then the glued stretch exactly as it plays (float, at the show rate). The glued clip
    // plays it from {offset} seconds at 0 dB with no fades; the track's other clips keep their places in the file.
    // -> {ref, offset, frames, channels, rate, seconds} | {error}
    o = add(o, "glueAudio", [this](const juce::var& a) {
        auto fail = [](const juce::String& e) { auto* r = new juce::DynamicObject(); r->setProperty("error", e); return juce::var(r); };
        if (session.file() == juce::File()) return fail("Save the show first: glued audio goes in its Audio folder.");
        const auto src = Media::resolve(a["ref"].toString(), session.file());
        juce::AudioFormatManager fm; fm.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> rd(fm.createReaderFor(src));
        if (! rd) return fail("Couldn't read " + src.getFileName());
        const double sr = audio.showRate();
        if (std::abs(rd->sampleRate - sr) > 0.5) return fail(src.getFileName() + " isn't at the show's rate.");
        const int ch = (int) rd->numChannels; const int64_t L = rd->lengthInSamples;
        const int64_t from = (int64_t) std::llround((double) a["from"] * sr), to = (int64_t) std::llround((double) a["to"] * sr);
        juce::String err;
        if (auto* p = a["payload"].getDynamicObject()) p->setProperty("sessionFile", session.file().getFullPathName()); // stems are relative to it
        auto baked = audio.bakeTrack(a["payload"], a["track"].toString(), from, to, ch, err);
        if (baked.empty()) return fail(err.isNotEmpty() ? err : "Nothing to glue");
        const int64_t N = to - from;
        juce::AudioBuffer<float> all(ch, (int) (L + N));
        all.clear();
        rd->read(&all, 0, (int) L, 0, true, ch > 1);
        for (int c = 0; c < ch; ++c) std::copy(baked[(size_t) c].begin(), baked[(size_t) c].end(), all.getWritePointer(c) + L);
        const auto dir = session.file().getParentDirectory().getChildFile("Audio");
        dir.createDirectory();
        const auto dst = dir.getChildFile(Media::portableName(src.getFileNameWithoutExtension() + " glued.wav")).getNonexistentSibling(true);
        {
            // 32-bit float (bit-exact with what the engine played), written next to it and then moved into place
            juce::TemporaryFile tmp(dst);
            bool ok = false;
            {
                std::unique_ptr<juce::OutputStream> os = std::make_unique<juce::FileOutputStream>(tmp.getFile());
                juce::WavAudioFormat wav;
                const auto opts = juce::AudioFormatWriterOptions {}.withSampleRate(sr).withNumChannels(ch).withBitsPerSample(32)
                                      .withSampleFormat(juce::AudioFormatWriterOptions::SampleFormat::floatingPoint);
                if (auto w = wav.createWriterFor(os, opts)) ok = w->writeFromAudioSampleBuffer(all, 0, all.getNumSamples());
            }
            if (! ok || ! tmp.overwriteTargetFileWithTemporary()) return fail("Couldn't write " + dst.getFullPathName());
        }
        applog::line("Glued \"" + a["track"].toString() + "\" into " + dst.getFullPathName());
        auto* r = new juce::DynamicObject();
        r->setProperty("ref", Media::makeRef(dst, session.file()));
        r->setProperty("offset", (double) L / sr);
        r->setProperty("frames", (juce::int64) (L + N));
        r->setProperty("channels", ch);
        r->setProperty("rate", sr);
        r->setProperty("seconds", (double) (L + N) / sr);
        return juce::var(r);
    });
    // File > Clean up unused audio (Media.h): {text: the show as it is now} -> [{path, name, folder, size}]
    o = add(o, "unusedAudio", [this](const juce::var& a) { return media.unused(session.file(), a["text"].toString()); });
    o = add(o, "trashAudio", [this](const juce::var& a) {
        const auto r = media.trash(session.file(), a["paths"]);
        applog::line("Clean up unused audio: " + r["moved"].toString() + ((int) r["moved"] == 1 ? " file" : " files") + " to the trash");
        return r;
    });
    o = add(o, "forgetLastShow", [this](const juce::var&) { session.forgetLast(); return juce::var(true); });
    o = add(o, "getAudioSetup", [this](const juce::var& a) { return audio.getSetup(a.isObject() && (bool) a["rescan"]); });
    o = add(o, "setAudioSetup", [this](const juce::var& a) {
        if (! a.isObject()) return errorVar("setAudioSetup: expected {driver, device, rate, buffer}");
        return audio.setSetup(a);
    });
    o = add(o, "getMidiOutputs", [this](const juce::var&) { return audio.midiOutputs(); });
    // 6g: MIDI clock per port (this computer) and sending the setlist's sync point
    o = add(o, "midiPorts", [this](const juce::var&) { return audio.midiPorts(); });
    o = add(o, "setMidiPort", [this](const juce::var& a) { audio.setMidiPort(a["name"].toString(), (bool) a["clock"], (bool) a["transport"]); return audio.midiPorts(); });
    o = add(o, "sendMidiNow", [this](const juce::var& a) { return audio.sendMidiNow(a["port"].toString(), a["msgs"]); });
    // Listen on this computer (AudioHost.h): the state, change it, the computer's output devices at a rate.
    // Diagnostics (About / Help): text only, no audio or show contents.
    // 9c: the look (Customize), per computer: kept with the app's preferences as well as in the page
    o = add(o, "lookSet", [this](const juce::var& a) { settings.setValue("look", a["look"].toString().substring(0, 20000)); settings.saveIfNeeded(); return juce::var(true); });
    o = add(o, "lookGet", [this](const juce::var&) { return juce::var(settings.getValue("look", {})); });
    o = add(o, "openUrl", [](const juce::var& a) { // 9c: Help › documentation / report a problem (the project's own pages only)
        const auto u = a["url"].toString();
        if (! u.startsWith("https://github.com/mylesmcneal1/setline-engine")) return juce::var(false);
        return juce::var(juce::URL(u).launchInDefaultBrowser());
    });
    o = add(o, "clockHold", [this](const juce::var& a) { audio.holdClock((bool) a["on"]); return juce::var(true); }); // 9d: a silent break stops the MIDI clock
    o = add(o, "setMenus", [this](const juce::var& a) { if (onMenus) onMenus(a); return juce::var(true); }); // 9c
    o = add(o, "windowCmd", [](const juce::var& a) { // 9c: Window › Minimise / Full screen
        const auto what = a["what"].toString();
        for (int i = 0; i < juce::TopLevelWindow::getNumTopLevelWindows(); ++i)
            if (auto* w = dynamic_cast<juce::DocumentWindow*>(juce::TopLevelWindow::getTopLevelWindow(i)); w && w->isVisible() && w->getName().contains("set.Line")) {
                if (what == "minimise") w->setMinimised(true);
                else if (what == "fullscreen") w->setFullScreen(! w->isFullScreen());
                return juce::var(true);
            }
        return juce::var(false);
    });
    o = add(o, "uiTiming", [this](const juce::var& a) { uiTiming = a["text"].toString().substring(0, 400); return juce::var(true); }); // 9b: folder open / close, zoom frames
    o = add(o, "diagnostics", [this](const juce::var&) { auto* r = new juce::DynamicObject(); r->setProperty("text", diagnostics()); return juce::var(r); });
    o = add(o, "copyDiagnostics", [this](const juce::var&) {
        juce::SystemClipboard::copyTextToClipboard(diagnostics());
        applog::line("Diagnostics copied to the clipboard");
        auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r);
    });
    o = addAsync(o, "saveDiagnostics", [this](const juce::var&, auto done) {
        auto text = diagnostics();
        dialogs::open("Save diagnostics", std::make_unique<juce::FileChooser>("Save diagnostics", juce::File::getSpecialLocation(juce::File::userDesktopDirectory)
                                                              .getChildFile("set.Line diagnostics " + juce::Time::getCurrentTime().formatted("%Y-%m-%d %H-%M") + ".txt"), "*.txt"), juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
                                 [done, text](const juce::FileChooser& fc) {
            auto* r = new juce::DynamicObject();
            const auto f = fc.getResult();
            if (f == juce::File()) r->setProperty("cancelled", true);
            else if (f.replaceWithText(text)) { r->setProperty("path", f.getFullPathName()); applog::line("Diagnostics saved: " + f.getFullPathName()); }
            else r->setProperty("error", "Couldn't write " + f.getFullPathName());
            done(juce::var(r));
        });
    });
    // Library files every show shares (6d: Cue Phrases.json). {name} reads ({text}, "" if none); {name, text} writes it.
    o = add(o, "libraryText", [](const juce::var& a) {
        static const juce::StringArray allowed { "Cue Phrases.json" };
        const auto name = a["name"].toString();
        if (! allowed.contains(name)) return errorVar("libraryText: unknown file " + name);
        const auto f = folders::library().getChildFile(name);
        auto* r = new juce::DynamicObject();
        if (a.hasProperty("text")) {
            juce::TemporaryFile tmp(f); // atomic: written next to it, then swapped in
            if (! tmp.getFile().replaceWithText(a["text"].toString()) || ! tmp.overwriteTargetFileWithTemporary()) return errorVar("Couldn't write " + f.getFullPathName());
            r->setProperty("ok", true);
        } else r->setProperty("text", f.existsAsFile() ? f.loadFileAsString() : juce::String());
        return juce::var(r);
    });
    // Settings › MIDI: "Send MIDI early by" (ms, this computer). The next song load uses it.
    o = add(o, "midiOffset", [this](const juce::var& a) {
        if (a.isObject() && a.hasProperty("ms")) { settings.setValue("midiOffsetMs", juce::jlimit(-200.0, 200.0, (double) a["ms"])); settings.saveIfNeeded(); }
        auto* r = new juce::DynamicObject(); r->setProperty("ms", settings.getDoubleValue("midiOffsetMs", 0.0)); return juce::var(r);
    });
    // Settings › Outputs › Export patch sheet: the page makes the PDF; this saves it ({name, base64}; tests: {to}).
    o = addAsync(o, "savePdf", [this](const juce::var& a, auto done) {
        juce::MemoryOutputStream bytes;
        if (! juce::Base64::convertFromBase64(bytes, a["base64"].toString())) { done(errorVar("savePdf: bad data")); return; }
        auto block = std::make_shared<juce::MemoryBlock>(bytes.getData(), bytes.getDataSize());
        auto write = [block](const juce::File& f) {
            auto* r = new juce::DynamicObject();
            if (f == juce::File()) r->setProperty("cancelled", true);
            else if (f.replaceWithData(block->getData(), block->getSize())) { r->setProperty("path", f.getFullPathName()); applog::line("Patch sheet saved: " + f.getFullPathName()); }
            else r->setProperty("error", "Couldn't write " + f.getFullPathName());
            return juce::var(r);
        };
        if (a["to"].toString().isNotEmpty()) { done(write(juce::File(a["to"].toString()))); return; }
        const auto name = juce::File::createLegalFileName(a["name"].toString().isNotEmpty() ? a["name"].toString() : juce::String("Patch sheet")) + ".pdf";
        dialogs::open("Export patch sheet", std::make_unique<juce::FileChooser>("Export patch sheet", juce::File::getSpecialLocation(juce::File::userDesktopDirectory).getChildFile(name), "*.pdf"), juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
                                [done, write](const juce::FileChooser& fc) { done(write(fc.getResult())); });
    });
    // ---- the band screens (6g): the server, its address, messages both ways ----
    o = add(o, "bandStart", [this](const juce::var& a) {
        const int port = a.hasProperty("port") ? (int) a["port"] : settings.getIntValue("bandPort", 8080);
        auto* r = new juce::DynamicObject(); juce::var rv(r);
        if (! (band.running() && band.port() == port)) {
            const auto err = band.start(port);
            if (err.isNotEmpty()) r->setProperty("error", err);
            else if (! a.hasProperty("test")) { settings.setValue("bandPort", port); settings.saveIfNeeded(); }
        }
        r->setProperty("running", band.running()); r->setProperty("port", band.port());
        juce::Array<juce::var> ips; for (auto& x : BandServer::addresses()) ips.add(x);
        r->setProperty("addresses", ips); r->setProperty("mdns", band.mdnsState()); r->setProperty("clients", band.clientCount());
        r->setProperty("platform", juce::SystemStats::getOperatingSystemName());
        return rv;
    });
    o = add(o, "bandStop", [this](const juce::var&) { band.stop(); return juce::var(true); });
    o = add(o, "bandInfo", [this](const juce::var&) {
        auto* r = new juce::DynamicObject();
        r->setProperty("running", band.running()); r->setProperty("port", band.running() ? band.port() : settings.getIntValue("bandPort", 8080));
        juce::Array<juce::var> ips; for (auto& x : BandServer::addresses()) ips.add(x);
        r->setProperty("addresses", ips); r->setProperty("mdns", band.mdnsState()); r->setProperty("clients", band.clientCount());
        return juce::var(r);
    });
    // {text, to?, state?}: a state message gets the host time and the engine's transport, taken right now
    o = add(o, "bandSend", [this](const juce::var& a) {
        juce::String text = a["text"].toString();
        if ((bool) a["state"] && text.startsWith("{")) {
            const auto tr = juce::JSON::toString(audio.transportState(), true);
            text = "{\"t\":\"state\",\"h\":" + juce::String(juce::Time::getMillisecondCounterHiRes(), 3) + ",\"tr\":" + tr + (text.length() > 2 ? "," + text.substring(1) : "}");
        }
        if (a.hasProperty("to")) band.sendTo((int) a["to"], text); else band.broadcast(text);
        return juce::var(true);
    });
    o = add(o, "bandClose", [this](const juce::var& a) { band.closeClient((int) a["client"]); return juce::var(true); });
    o = add(o, "hostTime", [](const juce::var&) { return juce::var(juce::Time::getMillisecondCounterHiRes()); });
    // ---- the Library (6f): one master bank of songs and setlists, autosaved, replacing Shows ----
    o = add(o, "libraryOpen", [this](const juce::var& a) { return libraryOpened(lib.open(a["name"].toString())); });
    o = add(o, "libraryList", [this](const juce::var&) { return lib.list(); });
    o = add(o, "libraryCreate", [this](const juce::var& a) { return lib.create(a["name"].toString()); });
    o = add(o, "libraryRename", [this](const juce::var& a) { return libraryOpened(lib.rename(a["name"].toString())); });
    o = add(o, "libraryWrite", [this](const juce::var& a) { return lib.write(a["files"], a["remove"]); });
    o = add(o, "libraryBackup", [this](const juce::var& a) { return lib.backup(a["text"].toString(), a["reason"].toString()); });
    o = add(o, "libraryBackups", [this](const juce::var&) { return lib.backups(); });
    o = add(o, "libraryReveal", [this](const juce::var&) { if (lib.folder().isDirectory()) lib.folder().revealToUser(); return juce::var(true); });
    // this computer: the setlist last open in this library, and what to open on launch
    o = add(o, "libraryState", [this](const juce::var& a) {
        if (a.isObject() && a.hasProperty("lastSetlist")) lib.setLastSetlist(a["lastSetlist"].toString());
        if (a.isObject() && a.hasProperty("onLaunch")) { settings.setValue("onLaunch", a["onLaunch"].toString() == "empty" ? "empty" : "last"); settings.saveIfNeeded(); }
        auto* r = new juce::DynamicObject();
        r->setProperty("name", lib.name()); r->setProperty("root", lib.folder().getFullPathName());
        r->setProperty("lastSetlist", lib.lastSetlist()); r->setProperty("onLaunch", settings.getValue("onLaunch", "last"));
        return juce::var(r);
    });
    // Export setlist…: {name, text (the package's setline.json), audio: [refs], to?} -> a .setline zip with the audio and
    // the rendered cues; progress as "audioProgress" {kind: "export"}; {path} | {cancelled} | {error}
    o = addAsync(o, "exportSetlist", [this](const juce::var& a, auto done) {
        if (exporter.joinable()) { done(errorVar("An export is already running.")); return; }
        auto go = [this, a, done](const juce::File& to) {
            if (to == juce::File()) { auto* r = new juce::DynamicObject(); r->setProperty("cancelled", true); done(juce::var(r)); return; }
            std::vector<package::Entry> entries;
            entries.push_back({ "setline.json", {}, a["text"].toString() });
            std::set<juce::String> seen;
            if (auto* refs = a["audio"].getArray())
                for (auto& r : *refs) {
                    const auto ref = r.toString(); const auto f = Media::resolve(ref, lib.index());
                    if (! f.existsAsFile() || ! seen.insert(f.getFileName()).second) continue;
                    entries.push_back({ "Audio/" + f.getFileName(), f, {} });
                }
            for (auto& f : lib.folder().getChildFile("Cues").findChildFiles(juce::File::findFiles, true))
                if (! f.getFileName().endsWith(".part")) entries.push_back({ "Cues/" + f.getRelativePathFrom(lib.folder().getChildFile("Cues")).replaceCharacter('\\', '/'), f, {} });
            exportCancel = std::make_shared<std::atomic<bool>>(false);
            auto cancel = exportCancel; auto alive_ = alive;
            if (exporter.joinable()) exporter.join();
            exporter = std::thread([this, to, entries, cancel, alive_, done] {
                double last = 0;
                std::function<void(int64_t, int64_t, const juce::String&)> onProgress = [&last, alive_](int64_t d, int64_t tot, const juce::String& file) {
                    const double now = juce::Time::getMillisecondCounterHiRes();
                    if (now - last < 80) return;
                    last = now;
                    juce::MessageManager::callAsync([alive_, d, tot, file] { if (*alive_) (*alive_)->emit("audioProgress", progressVar(d, tot, file)); });
                };
                const juce::String err = package::write(to, entries, *cancel, onProgress);
                juce::MessageManager::callAsync([alive_, err, to, done] {
                    if (*alive_ == nullptr) return;
                    (*alive_)->emit("audioProgress", progressVar(0, 0, juce::String(), true, err == "cancelled" ? juce::String() : err));
                    auto* r = new juce::DynamicObject();
                    if (err == "cancelled") r->setProperty("cancelled", true); else if (err.isNotEmpty()) r->setProperty("error", err); else { r->setProperty("path", to.getFullPathName()); applog::line("Exported " + to.getFullPathName()); }
                    done(juce::var(r));
                    if ((*alive_)->exporter.joinable()) (*alive_)->exporter.detach();
                });
            });
        };
        if (a["to"].toString().isNotEmpty()) { go(juce::File(a["to"].toString())); return; }
        const auto name = juce::File::createLegalFileName(a["name"].toString().isNotEmpty() ? a["name"].toString() : juce::String("Setlist")) + ".setline";
        dialogs::open("Export setlist", std::make_unique<juce::FileChooser>("Export setlist", juce::File::getSpecialLocation(juce::File::userDesktopDirectory).getChildFile(name), "*.setline"), juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
                                 [go](const juce::FileChooser& fc) { auto f = fc.getResult(); if (f != juce::File() && ! f.hasFileExtension("setline")) f = f.withFileExtension("setline"); go(f); });
    });
    o = add(o, "cancelExport", [this](const juce::var&) { exportCancel->store(true); return juce::var(true); });
    // Import…: {path?} -> {path, name, text, audio: [names], have: [names already in this library]} | {cancelled} | {error}
    o = addAsync(o, "readPackage", [this](const juce::var& a, auto done) {
        auto read = [this, done](const juce::File& f) {
            auto* r = new juce::DynamicObject(); juce::var rv(r);
            if (f == juce::File()) { r->setProperty("cancelled", true); done(rv); return; }
            std::vector<package::ZipItem> items;
            if (auto e = package::list(f, items); e.isNotEmpty()) { r->setProperty("error", e); done(rv); return; }
            juce::Array<juce::var> audioNames, have;
            juce::String text;
            for (auto& it : items) {
                if (it.name == "setline.json") text = package::readText(f, it);
                else if (it.name.startsWith("Audio/")) { const auto n = it.name.fromFirstOccurrenceOf("Audio/", false, false); audioNames.add(n); if (lib.folder().getChildFile("Audio").getChildFile(n).existsAsFile()) have.add(n); }
            }
            if (text.isEmpty()) { r->setProperty("error", f.getFileName() + " isn't a set.Line setlist package."); done(rv); return; }
            r->setProperty("path", f.getFullPathName()); r->setProperty("name", f.getFileNameWithoutExtension()); r->setProperty("text", text);
            r->setProperty("audio", audioNames); r->setProperty("have", have);
            done(rv);
        };
        if (a["path"].toString().isNotEmpty()) { read(juce::File(a["path"].toString())); return; }
        dialogs::open("Import .setline", std::make_unique<juce::FileChooser>("Import a setlist", juce::File::getSpecialLocation(juce::File::userDesktopDirectory), "*.setline"), juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [read](const juce::FileChooser& fc) { read(fc.getResult()); });
    });
    // {path} -> the package's audio this library doesn't have yet into Audio/, its cues into Cues/ -> {copied} | {error}
    o = addAsync(o, "importPackageAudio", [this](const juce::var& a, auto done) {
        const juce::File f(a["path"].toString());
        const auto dir = lib.folder();
        auto alive_ = alive;
        std::thread([f, dir, done, alive_] {
            std::vector<package::ZipItem> items;
            juce::String err = package::list(f, items);
            int copied = 0;
            const auto tmpCues = juce::File::createTempFile("setline-cues");
            for (auto& it : items) {
                if (err.isNotEmpty()) break;
                juce::File to;
                if (it.name.startsWith("Audio/")) { to = dir.getChildFile("Audio").getChildFile(juce::File::createLegalFileName(it.name.fromFirstOccurrenceOf("Audio/", false, false))); if (to.existsAsFile() && to.getSize() == it.size) continue; }
                else if (it.name.startsWith("Cues/") && ! it.name.contains("..")) to = tmpCues.getChildFile(it.name.fromFirstOccurrenceOf("Cues/", false, false));
                else continue;
                if (! package::extract(f, it, to)) err = "Couldn't copy " + it.name + " out of " + f.getFileName();
                else if (it.name.startsWith("Audio/")) ++copied;
            }
            juce::MessageManager::callAsync([alive_, err, copied, tmpCues, done] {
                if (*alive_ == nullptr) return;
                auto finish = [alive_, err, copied, done] {
                    if (*alive_ == nullptr) return;
                    auto* r = new juce::DynamicObject();
                    if (err.isNotEmpty()) r->setProperty("error", err); else r->setProperty("copied", copied);
                    applog::line("Imported a package: " + juce::String(copied) + (copied == 1 ? " audio file" : " audio files") + (err.isNotEmpty() ? ", " + err : juce::String()));
                    done(juce::var(r));
                };
                // the package's cues are in before the songs are (no cue is spoken with this computer's voice first)
                if (tmpCues.isDirectory()) (*alive_)->cues.mergeStore(tmpCues, finish); else finish();
            });
        }).detach();
    });
    // ---- 7d: backup rig (RigLink.h) ----
    auto ok = [] { auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); };
    o = add(o, "rigInfo", [this](const juce::var&) { return rig.info(); });
    o = add(o, "rigRole", [this, ok](const juce::var& a) { rig.setRole(a["role"].toString()); rigMute(); return ok(); });
    o = add(o, "rigPair", [this, ok](const juce::var& a) { rig.pair(a["ip"].toString().trim(), a["code"].toString().trim()); return ok(); });
    o = add(o, "rigUnpair", [this, ok](const juce::var&) { rig.unpair(); rigMute(); return ok(); });
    o = add(o, "rigOptions", [this, ok](const juce::var& a) { rig.setOptions(a); rigMute(); return ok(); });
    o = add(o, "rigTakeOver", [this, ok](const juce::var&) { rig.takeOver(); rigMute(); return ok(); });
    o = add(o, "rigReturn", [this, ok](const juce::var&) { rig.returnControl(); rigMute(); return ok(); });
    o = add(o, "rigStatus", [this, ok](const juce::var& a) { rig.sendStatus(a); return ok(); });
    o = add(o, "rigSetLibrary", [this, ok](const juce::var& a) { rigLib = a["list"]; return ok(); });
    o = add(o, "rigLibrary", [this, ok](const juce::var&) { rig.requestLibrary(); return ok(); });
    o = add(o, "rigStartAt", [this](const juce::var& a) { return audio.rigStart((int64_t) (juce::int64) a["from"], (double) a["at"]); });
    o = add(o, "rigJump", [this](const juce::var& a) { return audio.rigJump((int64_t) (juce::int64) a["at"], (int64_t) (juce::int64) a["to"]); });
    o = add(o, "rigJumpAt", [this](const juce::var& a) { return audio.rigJumpAtHost((double) a["at"], (int64_t) (juce::int64) a["to"]); });
    o = add(o, "rigSampleAt", [this](const juce::var& a) { return juce::var((juce::int64) audio.rigSampleAt((double) a["at"])); });
    o = add(o, "rigStop", [this](const juce::var&) { return audio.rigStop(); });
    o = add(o, "tempPath", [](const juce::var& a) { return juce::var(juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(juce::File::createLegalFileName(a["name"].toString().isNotEmpty() ? a["name"].toString() : juce::String("setline.tmp"))).getFullPathName()); });
    o = add(o, "hostMs", [this](const juce::var&) { auto* r = new juce::DynamicObject(); r->setProperty("now", juce::Time::getMillisecondCounterHiRes()); r->setProperty("rate", audio.sampleRate()); return juce::var(r); });
    // primary: a setlist package (exported by the page) to the backup, on a thread, with progress
    o = addAsync(o, "rigSendPackage", [this](const juce::var& a, auto done) {
        if (rigSender.joinable()) rigSender.join();
        const juce::File f(a["path"].toString());
        auto alive_ = alive;
        rigSender = std::thread([this, f, done, alive_] {
            const auto err = rig.sendPackage(f, [alive_](double p) { juce::MessageManager::callAsync([alive_, p] { if (*alive_) { auto* o = new juce::DynamicObject(); o->setProperty("fraction", p); (*alive_)->emit("rigProgress", juce::var(o)); } }); });
            juce::MessageManager::callAsync([alive_, err, done] { if (! *alive_) return; auto* r = new juce::DynamicObject(); if (err.isNotEmpty()) r->setProperty("error", err); else r->setProperty("ok", true); done(juce::var(r)); });
        });
    });
    // ---- 7c: footswitches / MIDI controllers (MidiControl.h) ----
    o = add(o, "midiMappings", [this](const juce::var&) { juce::Array<juce::var> ins; for (auto& n : midiControl.inputs()) ins.add(n); auto* r = new juce::DynamicObject(); r->setProperty("list", midiControl.mappings()); r->setProperty("inputs", ins); return juce::var(r); });
    o = add(o, "setMidiMappings", [this](const juce::var& a) { midiControl.setMappings(a["list"]); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    o = add(o, "midiLearn", [this](const juce::var& a) { midiControl.learn((bool) a["on"]); return juce::var(true); });
    // 8d: the pedal fast path's state (the song loaded and ready, where Play starts, the sections in the engine's bars,
    // jump timing, the next song waiting, the sync point's messages) and its numbers
    o = add(o, "pedalArm", [this](const juce::var& a) {
        // the sync point's ports opened now (the first send to a port opens it, which can take ~80 ms)
        if (juce::JSON::toString(a["sync"]) != juce::JSON::toString(pedalArmV["sync"])) if (auto* d = a["sync"].getArray()) for (auto& x : *d) audio.preopenMidi(x["port"].toString());
        pedalArmV = a;
        // stopped, armed: the stems filled from where a pedal's Play starts (no disk wait then)
        if ((bool) a["ready"] && a.hasProperty("bar")) audio.primeAt((int) a["bar"], (double) a["beat"]);
        return juce::var(true);
    });
    o = add(o, "pedalStats", [this](const juce::var&) { auto* r = new juce::DynamicObject(); r->setProperty("count", fastCount); r->setProperty("max", fastMax); r->setProperty("avg", fastCount ? fastSum / fastCount : 0.0); r->setProperty("worst", fastWorst); return juce::var(r); });
    o = add(o, "midiInject", [this](const juce::var& a) { midiControl.inject(a["port"].toString(), a["bytes"]); return juce::var(true); }); // tests: as if a pedal sent it
    // the page ran a pedal's action: how long since the message arrived (logged; Copy diagnostics shows the worst)
    o = add(o, "midiActed", [this](const juce::var& a) {
        const double ms = juce::Time::getMillisecondCounterHiRes() - (double) a["t0"];
        midiActMax = juce::jmax(midiActMax, ms); ++midiActCount;
        if (midiActCount <= 20 || ms > 20) applog::line("MIDI in -> " + a["action"].toString() + " in " + juce::String(ms, 2) + " ms");
        return juce::var(ms);
    });
    o = addAsync(o, "exportMappings", [this](const juce::var& a, auto done) {
        const auto text = a["text"].toString();
        dialogs::open("Export MIDI mappings", std::make_unique<juce::FileChooser>("Export MIDI mappings", juce::File::getSpecialLocation(juce::File::userDesktopDirectory).getChildFile("set.Line controls.json"), "*.json"), juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [text, done](const juce::FileChooser& fc) {
            auto* r = new juce::DynamicObject(); const auto f = fc.getResult();
            if (f == juce::File()) r->setProperty("cancelled", true); else if (f.replaceWithText(text)) r->setProperty("path", f.getFullPathName()); else r->setProperty("error", "Couldn't save " + f.getFileName());
            done(juce::var(r)); });
    });
    o = addAsync(o, "importMappings", [this](const juce::var& a, auto done) {
        auto read = [done](const juce::File& f) { auto* r = new juce::DynamicObject(); if (f == juce::File()) r->setProperty("cancelled", true); else r->setProperty("text", f.loadFileAsString()); done(juce::var(r)); };
        if (a["path"].toString().isNotEmpty()) { read(juce::File(a["path"].toString())); return; }
        dialogs::open("Import MIDI mappings", std::make_unique<juce::FileChooser>("Import MIDI mappings", juce::File::getSpecialLocation(juce::File::userDesktopDirectory), "*.json"), juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [read](const juce::FileChooser& fc) { read(fc.getResult()); });
    });
    // ---- 7b: Ableton Live projects (read only; the project and its files are never changed) ----
    // {path ('' = choose), mode, ports} -> the songs found (AbletonImport.h) | {cancelled} | {error}
    o = addAsync(o, "ableRead", [this](const juce::var& a, auto done) {
        ableton::Options opts;
        opts.mode = a["mode"].toString().isNotEmpty() ? a["mode"].toString() : juce::String("auto");
        if (auto* p = a["ports"].getArray()) for (auto& x : *p) opts.midiPorts.add(x.toString());
        opts.choices = a["choices"]; // 9a: Sort markers
        auto alive_ = alive;
        auto read = [opts, done, alive_](const juce::File& f) {
            if (f == juce::File()) { auto* r = new juce::DynamicObject(); r->setProperty("cancelled", true); done(juce::var(r)); return; }
            std::thread([f, opts, done, alive_] {
                juce::String err;
                auto v = ableton::read(f, opts, err);
                juce::MessageManager::callAsync([v, err, done, alive_] {
                    if (*alive_ == nullptr) return;
                    if (err.isNotEmpty()) { auto* r = new juce::DynamicObject(); r->setProperty("error", err); done(juce::var(r)); return; }
                    done(v);
                });
            }).detach();
        };
        if (a["path"].toString().isNotEmpty()) { read(juce::File(a["path"].toString())); return; }
        dialogs::open("Import Ableton project", std::make_unique<juce::FileChooser>("Import an Ableton Live project", juce::File::getSpecialLocation(juce::File::userMusicDirectory), "*.als"), juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [read](const juce::FileChooser& fc) { read(fc.getResult()); });
    });
    // "Locate…": {names, folder ('' = choose)} -> {found: {name: path}} | {cancelled}
    o = addAsync(o, "ableLocate", [this](const juce::var& a, auto done) {
        juce::StringArray names; if (auto* n = a["names"].getArray()) for (auto& x : *n) names.add(x.toString());
        auto alive_ = alive;
        auto go = [names, done, alive_](const juce::File& dir) {
            if (dir == juce::File()) { auto* r = new juce::DynamicObject(); r->setProperty("cancelled", true); done(juce::var(r)); return; }
            std::thread([dir, names, done, alive_] {
                auto found = ableton::locate(dir, names);
                juce::MessageManager::callAsync([found, done, alive_] { if (*alive_ == nullptr) return; auto* r = new juce::DynamicObject(); r->setProperty("found", found); done(juce::var(r)); });
            }).detach();
        };
        if (a["folder"].toString().isNotEmpty()) { go(juce::File(a["folder"].toString())); return; }
        dialogs::open("Find missing samples", std::make_unique<juce::FileChooser>("Find the missing samples in…", juce::File::getSpecialLocation(juce::File::userMusicDirectory)), juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [go](const juce::FileChooser& fc) { go(fc.getResult()); });
    });
    // {paths} -> {path: content hash} (the Library stores audio by it: Audio/<hash>.<ext>), on a thread
    o = addAsync(o, "hashFiles", [this](const juce::var& a, auto done) {
        juce::StringArray paths; if (auto* n = a["paths"].getArray()) for (auto& x : *n) paths.add(x.toString());
        auto alive_ = alive;
        std::thread([paths, done, alive_] {
            auto* r = new juce::DynamicObject(); juce::var rv(r);
            for (auto& p : paths) if (juce::File(p).existsAsFile()) r->setProperty(p, Media::contentHash(juce::File(p)));
            juce::MessageManager::callAsync([rv, done, alive_] { if (*alive_ != nullptr) done(rv); });
        }).detach();
    });
    // 8b: the pads' parts of their samples as cue words: {items: [{path, start, end, word}]} -> [{word, path}] (WAVs in a
    // temporary folder; importAudio then copies them into the Library)
    o = addAsync(o, "ableCueAudio", [this](const juce::var& a, auto done) {
        const auto items = a["items"];
        auto alive_ = alive;
        std::thread([items, done, alive_] {
            const auto dir = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("setline-ableton-cues").getChildFile(juce::String::toHexString(juce::Random::getSystemRandom().nextInt64()));
            auto v = ableton::cutPadSamples(items, dir);
            juce::MessageManager::callAsync([v, done, alive_] { if (*alive_ != nullptr) done(v); });
        }).detach();
    });
    // ---- 8d: in-app updates (Updater.h): check the "latest" release, download + verify + stage, install / roll back
    auto appVersion = [] { return juce::JUCEApplication::getInstance()->getApplicationVersion(); };
    auto prevVersion = [](const juce::File& prev) -> juce::String {
        if (! prev.exists()) return {};
       #if JUCE_MAC
        const auto plist = prev.getChildFile("Contents/Info.plist").loadFileAsString();
        const auto after = plist.fromFirstOccurrenceOf("<key>CFBundleShortVersionString</key>", false, false);
        const auto v = after.fromFirstOccurrenceOf("<string>", false, false).upToFirstOccurrenceOf("</string>", false, false).trim();
        return v.isNotEmpty() ? v : juce::String("the previous build");
       #else
        return "the previous build";
       #endif
    };
    auto playingNow = [this] { return (bool) audio.transportState()["playing"]; };
    o = add(o, "updateInfo", [this, appVersion, prevVersion](const juce::var&) {
        const auto app = updater::currentApp();
        auto* r = new juce::DynamicObject();
        r->setProperty("current", appVersion());
        r->setProperty("previous", prevVersion(updater::previousApp(app)));
        r->setProperty("cant", updater::cantInstall(app, appVersion()));
        r->setProperty("daily", settings.getBoolValue("updateDaily", true));
        r->setProperty("lastCheck", settings.getDoubleValue("updateLastCheck", 0));
        r->setProperty("hasToken", settings.getValue("updateToken").isNotEmpty());
        r->setProperty("staged", updStaged.exists());
        return juce::var(r);
    });
    o = add(o, "updatePrefs", [this](const juce::var& a) {
        if (a.hasProperty("daily")) settings.setValue("updateDaily", (bool) a["daily"]);
        if (a.hasProperty("token")) settings.setValue("updateToken", a["token"].toString().trim());
        settings.saveIfNeeded();
        auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r);
    });
    o = addAsync(o, "updateCheck", [this, appVersion](const juce::var&, auto done) {
        const auto token = settings.getValue("updateToken"), cur = appVersion();
        settings.setValue("updateLastCheck", (double) juce::Time::currentTimeMillis());
        auto alive_ = alive;
        std::thread([token, cur, done, alive_] {
            juce::String err;
            auto rel = updater::fetchLatest(token, err);
            juce::MessageManager::callAsync([rel, err, cur, done, alive_] {
                if (*alive_ == nullptr) return;
                auto* r = new juce::DynamicObject(); juce::var rv(r);
                r->setProperty("current", cur);
                if (err.isNotEmpty()) { r->setProperty("error", err); done(rv); return; }
                for (auto& [k, v] : rel.getDynamicObject()->getProperties()) r->setProperty(k, v);
                r->setProperty("latest", rel["version"]);
                r->setProperty("newer", updater::compareVersions(rel["version"].toString(), cur) > 0);
                done(rv);
            });
        }).detach();
    });
    o = addAsync(o, "updateDownload", [this, appVersion](const juce::var& a, auto done) {
        const auto app = updater::currentApp();
        const auto why = updater::cantInstall(app, appVersion());
        if (why.isNotEmpty()) { auto* r = new juce::DynamicObject(); r->setProperty("error", why); done(juce::var(r)); return; }
        const auto token = settings.getValue("updateToken"), url = a["asset"]["url"].toString(), sums = a["sums"]["url"].toString(), name = updater::assetName();
        const auto work = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("setline-update");
        auto alive_ = alive;
        std::thread([this, token, url, sums, name, work, app, done, alive_] {
            juce::String err;
            const auto sumsFile = work.getChildFile("SHA256SUMS.txt"), zip = work.getChildFile(name);
            juce::File staged;
            int last = -1;
            auto progress = [alive_, &last](double f) { const int pc = (int) (f * 100); if (pc == last) return; last = pc;
                juce::MessageManager::callAsync([alive_, pc] { if (*alive_ != nullptr) { auto* o = new juce::DynamicObject(); o->setProperty("done", pc); (*alive_)->emit("updateProgress", juce::var(o)); } }); };
            if (updater::download(sums, token, sumsFile, nullptr, err) && updater::download(url, token, zip, progress, err)
                && updater::verify(zip, sumsFile.loadFileAsString(), name, err))
                staged = updater::stage(zip, app, err);
            work.deleteRecursively();
            juce::MessageManager::callAsync([this, staged, err, done, alive_] {
                if (*alive_ == nullptr) return;
                auto* r = new juce::DynamicObject();
                if (err.isNotEmpty() || ! staged.exists()) r->setProperty("error", err.isNotEmpty() ? err : juce::String("The update couldn't be prepared."));
                else { updStaged = staged; r->setProperty("ready", true); applog::line("Update: downloaded, verified and unpacked next to set.Line"); }
                done(juce::var(r));
            });
        }).detach();
    });
    // never while playing: the page waits until it's stopped (and saves the library first), then calls this
    o = add(o, "updateInstall", [this, playingNow](const juce::var&) {
        auto* r = new juce::DynamicObject(); juce::var rv(r);
        if (playingNow()) { r->setProperty("error", "Stop first: set.Line never updates while playing."); return rv; }
        if (! updStaged.exists()) { r->setProperty("error", "Download the update first."); return rv; }
        const auto app = updater::currentApp();
        const auto script = updater::writeSwapScript(juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("setline-update-run"), false, app, updStaged, updater::currentPid(), true);
        if (! updater::runScript(script, false)) { r->setProperty("error", "Couldn't start the installer."); return rv; }
        applog::line("Update: installing; set.Line quits and the new build starts");
        juce::Timer::callAfterDelay(400, [] { juce::JUCEApplication::quit(); });
        r->setProperty("ok", true); return rv;
    });
    o = add(o, "updateRollback", [this, playingNow, appVersion](const juce::var&) {
        auto* r = new juce::DynamicObject(); juce::var rv(r);
        if (playingNow()) { r->setProperty("error", "Stop first: set.Line never changes builds while playing."); return rv; }
        const auto app = updater::currentApp();
        if (! updater::previousApp(app).exists()) { r->setProperty("error", "There's no previous build to go back to."); return rv; }
        const auto why = updater::cantInstall(app, appVersion());
        if (why.isNotEmpty()) { r->setProperty("error", why); return rv; }
        const auto script = updater::writeSwapScript(juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("setline-update-run"), true, app, {}, updater::currentPid(), true);
        if (! updater::runScript(script, false)) { r->setProperty("error", "Couldn't start the rollback."); return rv; }
        applog::line("Update: rolling back to the previous build");
        juce::Timer::callAfterDelay(400, [] { juce::JUCEApplication::quit(); });
        r->setProperty("ok", true); return rv;
    });
    // ---- 8d: crash recovery: where the show is while playing (the page writes it every 2 s); cleared on a normal quit
    o = add(o, "resumeSave", [this](const juce::var& a) { resumeFile().replaceWithText(juce::JSON::toString(a, true)); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    o = add(o, "resumeGet", [this](const juce::var&) { const auto v = juce::JSON::parse(resumeFile().loadFileAsString()); return v.isObject() ? v : juce::var(new juce::DynamicObject()); });
    // the import's summary, next to the Library's migration log -> its path
    o = add(o, "ableLog", [this](const juce::var& a) {
        const auto f = lib.folder().getChildFile("ableton-import-log.txt");
        f.appendText(juce::Time::getCurrentTime().formatted("%Y-%m-%d %H:%M:%S") + "\n" + a["text"].toString() + "\n\n");
        applog::line("Ableton import: " + a["text"].toString().upToFirstOccurrenceOf("\n", false, false));
        return juce::var(f.getFullPathName());
    });
    // ---- migration from Shows (6f): read-only; the shows' folders are never changed ----
    o = add(o, "findShows", [this](const juce::var&) {
        juce::Array<juce::File> found;
        auto add1 = [&](const juce::File& f) { if (f.existsAsFile() && f.hasFileExtension("setline") && f.getParentDirectory().getFileName() != "Backups" && ! found.contains(f)) found.add(f); };
        for (auto dir : { folders::shows(settings), folders::defaultShows() })
            if (dir.isDirectory()) for (auto& f : dir.findChildFiles(juce::File::findFiles, true, "*.setline")) add1(f);
        if (auto* rec = session.recent().getArray()) for (auto& r : *rec) add1(juce::File(r["path"].toString()));
        add1(juce::File(session.lastSession()));
        juce::Array<juce::var> out;
        for (auto& f : found) {
            if (f.isAChildOf(LibraryStore::root())) continue;
            juce::var v; if (juce::JSON::parse(f.loadFileAsString(), v).failed() || ! v["songs"].isArray()) continue;
            juce::int64 bytes = 0;
            for (auto& a : f.getParentDirectory().getChildFile("Audio").findChildFiles(juce::File::findFiles, false)) bytes += a.getSize();
            auto* o2 = new juce::DynamicObject();
            o2->setProperty("path", f.getFullPathName()); o2->setProperty("name", f.getFileNameWithoutExtension());
            o2->setProperty("songs", v["songs"].size()); o2->setProperty("bytes", (double) bytes);
            out.add(juce::var(o2));
        }
        return juce::var(out);
    });
    o = add(o, "readShow", [](const juce::var& a) {
        const juce::File f(a["path"].toString());
        auto* r = new juce::DynamicObject();
        if (! f.existsAsFile()) r->setProperty("error", f.getFullPathName() + " isn't there any more.");
        else { r->setProperty("text", f.loadFileAsString()); r->setProperty("folder", f.getParentDirectory().getFullPathName()); }
        return juce::var(r);
    });
    // a show's stored cues join the library's (copied; the show folder isn't touched)
    o = addAsync(o, "mergeCues", [this](const juce::var& a, auto done) { const juce::File d(a["from"].toString()); if (d.isDirectory()) cues.mergeStore(d, [done] { done(juce::var(true)); }); else done(juce::var(true)); });
    o = add(o, "migrationLog", [this](const juce::var& a) {
        const auto f = lib.folder().getChildFile("migration-log.txt");
        f.appendText(juce::Time::getCurrentTime().formatted("%Y-%m-%d %H:%M:%S") + "\n" + a["text"].toString() + "\n\n");
        settings.setValue("showsMigrated", true); settings.saveIfNeeded();
        return juce::var(f.getFullPathName());
    });
    o = add(o, "migrationAsked", [this](const juce::var& a) { if (a.isObject() && a.hasProperty("set")) { settings.setValue("showsMigrationAsked", (bool) a["set"]); settings.saveIfNeeded(); } return juce::var(settings.getBoolValue("showsMigrationAsked", false)); });
    // A line from the page into the log (e.g. what a show's migration changed).
    o = add(o, "logLine", [](const juce::var& a) { applog::line(a["text"].toString().substring(0, 4000)); return juce::var(true); });
    o = add(o, "getListen", [this](const juce::var&) { return audio.listenState(); });
    o = add(o, "setListen", [this](const juce::var& a) { return audio.setListen(a); });
    o = add(o, "listenDevices", [this](const juce::var& a) { return audio.listenDevices((double) a.getProperty("rate", 0.0)); });
    // Loading a song: its cues are rendered first (on the Cues worker, usually already cached), then the
    // song is mapped and loaded on the message thread, which never waits for speech.
    o = add(o, "updateClicks", [this](const juce::var& a) { return audio.updateClicks(a); });
    o = addAsync(o, "loadSong", [this](const juce::var& a, auto done) {
        if (! a.isObject() || ! a["song"].isObject()) { done(errorVar("loadSong: expected {song, outs, roles, click}")); return; }
        withCues(a, [this, a, done] { done(audio.loadSong(a)); });
    });
    // The next song (6e): loaded into the engine's second slot in the background, its cues rendered first.
    o = addAsync(o, "queueNext", [this](const juce::var& a, auto done) {
        if (! a.isObject() || ! a["song"].isObject()) { done(errorVar("queueNext: expected {song, outs, roles, click}")); return; }
        withCues(a, [this, a, done] { done(audio.queueNext(a)); });
    });
    o = add(o, "nextState", [this](const juce::var&) { return audio.nextState(); });
    o = add(o, "queueJump", [this](const juce::var& a) { return audio.queueJump(a); });
    if (testScript != juce::File()) // tests only: the song rendered offline exactly as it would load (AudioHost::renderOffline)
        o = addAsync(o, "testRender", [this](const juce::var& a, auto done) {
            withCues(a["payload"], [this, a, done] { done(audio.renderOffline(a["payload"], a)); });
        });
    return addRest(o);
}

// Before a song is mapped: stems resolve against the open session, and its cues are rendered (on the Cues
// worker, usually already cached); then "then" runs on the message thread, which never waits for speech.
void Bridge::withCues(const juce::var& a, std::function<void()> then)
{
    if (! a.isObject()) { then(); return; }
    // Stems are stored relative to the session's folder.
    a.getDynamicObject()->setProperty("sessionFile", session.file() == juce::File() ? juce::String() : session.file().getFullPathName());
    std::vector<std::pair<juce::String, Cues::Choice>> list;
    const auto s = a["song"];
    const juce::var v = s["cueVoice"].isObject() ? s["cueVoice"] : a["cueVoice"];
    const auto c = Cues::choiceFrom(v);
    if (auto* cs = s["cues"].getArray())
        for (auto& q : *cs) if (auto t = q["text"].toString().trim(); t.isNotEmpty()) { juce::var qv = q["voice"].isObject() ? q["voice"] : v; if (q["rec"].toString().isNotEmpty()) { auto* o = qv.getDynamicObject() ? qv.getDynamicObject()->clone().release() : new juce::DynamicObject(); o->setProperty("rec", q["rec"]); qv = juce::var(o); } list.push_back({ t, choiceOf(qv) }); }
    const double rate = cueRate(); // no device (e.g. CI): the rate offline renders use
    if (list.empty() || rate <= 0) { then(); return; }
    cues.ensure(std::move(list), rate, [this, then](std::map<juce::String, juce::String> errors) {
        cueErrors = std::move(errors);
        then();
    });
}

Bridge::Options Bridge::addRest(Options o)
{
    o = add(o, "transport", [this](const juce::var& a) { return audio.transport(a); });
    o = add(o, "getTransport", [this](const juce::var&) { return audio.transportState(); });
    o = add(o, "getEngineStats", [this](const juce::var&) { return audio.engineStats(); });
    o = add(o, "setTrackLevel", [this](const juce::var& a) { return audio.setTrackLevel(a); });
    o = add(o, "setLoop", [this](const juce::var& a) { return audio.setLoop(a); });

    // Sessions (.setline): the page sends / receives the session as JSON text.
    o = addAsync(o, "openSession", [this](const juce::var&, auto done) { session.open([this, done](juce::var r) { syncShow(); if (r["path"].toString().isNotEmpty()) applog::line("Opened " + r["path"].toString()); done(r); }); });
    o = addAsync(o, "saveSession", [this](const juce::var& a, auto done) { session.save(a["text"].toString(), [this, done](juce::var r) { syncShow(); done(r); }); });
    o = addAsync(o, "saveSessionAs", [this](const juce::var& a, auto done) { session.saveAs(a["text"].toString(), [this, done](juce::var r) { syncShow(); done(r); }); });
    // Step 2: sessions live in their own folder; audio references are relative to it (see Media.h).
    o = add(o, "getSessionFile", [this](const juce::var&) {
        auto* r = new juce::DynamicObject();
        r->setProperty("path", session.file() == juce::File() ? juce::String() : session.file().getFullPathName());
        r->setProperty("name", session.name());
        return juce::var(r);
    });
    // File menu: Open Recent, Close / New, and quitting once the page has dealt with unsaved changes.
    o = add(o, "getRecentSessions", [this](const juce::var&) { return session.recent(); });
    o = add(o, "clearRecentSessions", [this](const juce::var&) { session.clearRecent(); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    o = add(o, "openSessionPath", [this](const juce::var& a) {
        const auto p = a["path"].toString();
        if (! juce::File::isAbsolutePath(p)) return errorVar("openSessionPath: expected an absolute path");
        auto r = session.openPath(juce::File(p));
        syncShow();
        applog::line(r["error"].toString().isNotEmpty() ? "Couldn't open " + p + ": " + r["error"].toString() : "Opened " + p);
        return r;
    });
    // After a save: every cue of the show stored in <show>/Cues (missing ones rendered), unused ones removed.
    o = addAsync(o, "storeCues", [this](const juce::var& a, auto done) {
        syncShow();
        const double rate = cueRate(); // no device (e.g. CI): the rate offline renders use
        if (rate <= 0) { auto* r = new juce::DynamicObject(); r->setProperty("stored", 0); done(juce::var(r)); return; }
        juce::Array<juce::var> list;
        if (auto* l = a["cues"].getArray()) for (auto& x : *l) { auto* o2 = x.getDynamicObject() ? x.getDynamicObject()->clone().release() : new juce::DynamicObject(); o2->setProperty("recPath", choiceOf(x).recording); list.add(juce::var(o2)); }
        cues.storeShow(list, rate, [done](int stored, int removed) {
            auto* r = new juce::DynamicObject(); r->setProperty("stored", stored); r->setProperty("removed", removed); done(juce::var(r));
        });
    });
    // Tests: where the last cue came from (show / memory / cache / render).
    o = add(o, "cueSource", [this](const juce::var&) { auto* r = new juce::DynamicObject(); r->setProperty("from", cues.lastSource()); return juce::var(r); });
    o = add(o, "closeSession", [this](const juce::var&) { session.close(); syncShow(); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    // ---- start-up (the loading window) ----
    // 7a: start-up timing from the page ("setlist on screen", "waveforms 12 of 12" + how long it took)
    o = add(o, "startupMark", [](const juce::var& a) { applog::mark(a["name"].toString(), a.hasProperty("took") ? (double) a["took"] : -1.0); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    o = add(o, "loadingStep", [this](const juce::var& a) { if (onLoadingStep) onLoadingStep(a); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    o = add(o, "loadingDone", [this](const juce::var&) { loading = false; applog::line("Loading done"); if (onLoadingDone) onLoadingDone(); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    // {refs, session, prepare} -> {ready, total}: waveforms whose cache is there (prepare: start computing the rest)
    o = add(o, "peaksReady", [this](const juce::var& a) {
        const juce::File sessionFile(a["session"].toString());
        int ready = 0, total = 0;
        juce::Array<juce::File> todo;
        if (auto* refs = a["refs"].getArray())
            for (auto& r : *refs) {
                const auto f = Media::resolve(r.toString(), sessionFile);
                ++total;
                if (! f.existsAsFile()) { ++ready; continue; } // missing stems don't block loading
                const auto c = Peaks::cacheFileFor(f, sessionFile);
                if (c.existsAsFile() && c.getLastModificationTime() >= f.getLastModificationTime()) ++ready; else todo.add(f);
            }
        if ((bool) a["prepare"] && ! todo.isEmpty()) peaks.prepare(todo, sessionFile);
        auto* o2 = new juce::DynamicObject(); o2->setProperty("ready", ready); o2->setProperty("total", total); return juce::var(o2);
    });
    // {cues: [{text, voice, name, speed, pron, rec}]} -> {ready, total}: cues already rendered (or stored in the show)
    o = add(o, "cuesReady", [this](const juce::var& a) {
        const double rate = cueRate(); // no device (e.g. CI): the rate offline renders use
        int ready = 0, total = 0;
        if (auto* l = a["cues"].getArray())
            for (auto& x : *l) {
                ++total;
                bool fb = false;
                if (rate <= 0 || cues.cached(x["text"].toString().trim(), choiceOf(x), rate, fb) != nullptr) ++ready;
            }
        auto* o2 = new juce::DynamicObject(); o2->setProperty("ready", ready); o2->setProperty("total", total); return juce::var(o2);
    });
    o = add(o, "quitAnswered", [this](const juce::var&) { if (onQuitAnswered) onQuitAnswered(); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    o = add(o, "quitNow", [this](const juce::var&) {
        dirty = false;
        juce::MessageManager::callAsync([] { juce::JUCEApplication::quit(); });
        auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r);
    });
    o = addAsync(o, "chooseSessionFile", [this](const juce::var&, auto done) { session.chooseLocation(done); });
    o = add(o, "writeSession", [this](const juce::var& a) {
        const auto path = a["path"].toString();
        if (! juce::File::isAbsolutePath(path)) return errorVar("writeSession: expected an absolute path");
        auto r = session.writeTo(juce::File(path), a["text"].toString());
        syncShow();
        applog::line(r["error"].toString().isNotEmpty() ? "Save failed: " + r["error"].toString() : "Saved " + path);
        return r;
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
    o = add(o, "removeImported", [this](const juce::var& a) { // 9a: an import cancelled: its fresh copies go again
        juce::StringArray paths; if (auto* l = a["paths"].getArray()) for (auto& x : *l) paths.add(x.toString());
        return juce::var(media.removeCopies(juce::File(a["session"].toString()), paths));
    });
    o = addAsync(o, "collectAudio", [this](const juce::var& a, auto done) { media.collect(a, done); });
    o = add(o, "checkAudio", [this](const juce::var& a) {
        const auto resumed = media.resumeCopies(juce::File(a["session"].toString())); // an interrupted save: finish it
        auto r = media.check(a);
        if (auto* o2 = r.getDynamicObject()) o2->setProperty("resumed", resumed["resumed"]);
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
    // Spoken cues (Cues.h): the installed voices, rendering ahead of time, Preview on the Cues outputs.
    o = addAsync(o, "getVoices", [this](const juce::var&, auto done) { cues.voicesAsync(done); });
    o = add(o, "prepareCues", [this](const juce::var& a) {
        const double rate = cueRate(); // no device (e.g. CI): the rate offline renders use
        if (rate > 0) {
            juce::Array<juce::var> list; // recordings resolved against the show here
            if (auto* l = a["cues"].getArray()) for (auto& x : *l) { auto* o = x.getDynamicObject() ? x.getDynamicObject()->clone().release() : new juce::DynamicObject(); const auto c = choiceOf(x); o->setProperty("recPath", c.recording); list.add(juce::var(o)); }
            cues.prepare(list, rate);
        }
        auto* r = new juce::DynamicObject(); r->setProperty("ok", rate > 0); return juce::var(r);
    });
    // {text, voice, name, speed, outs: [1-based], db} -> plays once -> {ok, seconds, voice} | {error}
    o = addAsync(o, "previewCue", [this](const juce::var& a, auto done) {
        const double rate = audio.sampleRate();
        if (rate <= 0) { done(errorVar("No audio device is open.")); return; }
        const auto c = choiceOf(a);
        std::vector<int> outs;
        if (auto* o2 = a["outs"].getArray()) for (auto& v : *o2) if ((int) v >= 1) outs.push_back((int) v - 1);
        const float gain = juce::Decibels::decibelsToGain((float) (double) a["db"], -60.0f);
        bool fellBack = false;
        cues.resolve(c, fellBack);
        cues.render(a["text"].toString().trim(), c, rate, [this, done, outs, gain, rate, fellBack](Cues::Audio au, juce::String err) {
            if (! au) { done(errorVar(err.isEmpty() ? juce::String("Couldn't speak that") : err)); return; }
            audio.playPreview(au, outs, gain);
            auto* r = new juce::DynamicObject();
            r->setProperty("ok", true);
            r->setProperty("seconds", (double) au->size() / rate);
            r->setProperty("fellBack", fellBack);
            done(juce::var(r));
        });
    });
    // Kokoro voices (Kokoro.h): {state, done, total, error, folder, engine}; "downloadVoices" starts the download.
    o = add(o, "voiceModel", [](const juce::var&) {
        const auto st = kokoro::status();
        auto* r = new juce::DynamicObject();
        r->setProperty("state", kokoro::stateName(st.state));
        r->setProperty("done", (double) st.done);
        r->setProperty("total", (double) st.total);
        r->setProperty("error", st.error);
        r->setProperty("folder", kokoro::folder().getFullPathName());
        r->setProperty("engine", juce::String("ONNX Runtime ") + SETLINE_ORT_VERSION);
        // 7a: the set.Line voices themselves, so the picker lists them without waiting on the computer's voice list
        juce::Array<juce::var> kv;
        for (auto& v : kokoro::voices()) {
            auto* o = new juce::DynamicObject();
            o->setProperty("id", v.id); o->setProperty("name", v.name); o->setProperty("lang", v.lang); o->setProperty("quality", v.quality);
            o->setProperty("engine", v.engine); o->setProperty("gender", v.gender); o->setProperty("grade", v.grade); o->setProperty("rank", v.rank);
            kv.add(juce::var(o));
        }
        r->setProperty("voices", kv);
        return juce::var(r);
    });
    o = add(o, "downloadVoices", [](const juce::var&) { kokoro::startDownload(); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    o = add(o, "cancelVoiceDownload", [](const juce::var&) { kokoro::cancelDownload(); auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r); });
    // {texts: [...], voice, name, speed, pron} -> {unknown: [words no dictionary knows], phonemes}
    o = addAsync(o, "checkCueWords", [this](const juce::var& a, auto done) {
        juce::StringArray texts;
        if (auto* t = a["texts"].getArray()) for (auto& x : *t) texts.add(x.toString());
        cues.checkWords(texts, Cues::choiceFrom(a), [done](juce::StringArray unknown, juce::String ph) {
            auto* r = new juce::DynamicObject();
            juce::Array<juce::var> u; for (auto& w : unknown) u.add(w);
            r->setProperty("unknown", u);
            r->setProperty("phonemes", ph);
            done(juce::var(r));
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
    if (loading) return; // nothing is dropped until loading has finished
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
