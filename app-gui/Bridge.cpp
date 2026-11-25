#include "Bridge.h"
#include "AudioHost.h"
#include "Log.h"
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

Bridge::Bridge(AudioHost& host, juce::PropertiesFile& settings) : audio(host), settings(settings), session(settings), media(settings)
{
    audio.onSetupChanged = [this] { emit("audioSetupChanged", audio.getSetup()); };
    audio.emit = [this](const juce::Identifier& id, const juce::var& v) { emit(id, v); };
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
    t.add("Kokoro voices: " + kokoro::stateName(kokoro::status().state));
    t.add("");
    t.add("Log (last 200 lines of " + applog::current().getFullPathName() + "):");
    t.add(applog::tail(200));
    return t.joinIntoString("\n");
}

void Bridge::syncShow() { cues.setShowFolder(session.file() == juce::File() ? juce::File() : session.file().getParentDirectory()); }

Bridge::~Bridge() { kokoro::setListener(nullptr); *alive = nullptr; audio.onSetupChanged = nullptr; audio.emit = nullptr; audio.cueAudio = nullptr; media.emit = nullptr; }

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
        folderChooser = std::make_unique<juce::FileChooser>("Where new shows are saved", folders::shows(settings));
        folderChooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories, [this, done](const juce::FileChooser& fc) {
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
        applog::line("Clean up unused audio: " + r["moved"].toString() + " file(s) to the trash");
        return r;
    });
    o = add(o, "forgetLastShow", [this](const juce::var&) { session.forgetLast(); return juce::var(true); });
    o = add(o, "getAudioSetup", [this](const juce::var& a) { return audio.getSetup(a.isObject() && (bool) a["rescan"]); });
    o = add(o, "setAudioSetup", [this](const juce::var& a) {
        if (! a.isObject()) return errorVar("setAudioSetup: expected {driver, device, rate, buffer}");
        return audio.setSetup(a);
    });
    o = add(o, "getMidiOutputs", [this](const juce::var&) { return audio.midiOutputs(); });
    // Listen on this computer (AudioHost.h): the state, change it, the computer's output devices at a rate.
    // Diagnostics (About / Help): text only, no audio or show contents.
    o = add(o, "diagnostics", [this](const juce::var&) { auto* r = new juce::DynamicObject(); r->setProperty("text", diagnostics()); return juce::var(r); });
    o = add(o, "copyDiagnostics", [this](const juce::var&) {
        juce::SystemClipboard::copyTextToClipboard(diagnostics());
        applog::line("Diagnostics copied to the clipboard");
        auto* r = new juce::DynamicObject(); r->setProperty("ok", true); return juce::var(r);
    });
    o = addAsync(o, "saveDiagnostics", [this](const juce::var&, auto done) {
        auto text = diagnostics();
        diagChooser = std::make_unique<juce::FileChooser>("Save diagnostics", juce::File::getSpecialLocation(juce::File::userDesktopDirectory)
                                                              .getChildFile("set.Line diagnostics " + juce::Time::getCurrentTime().formatted("%Y-%m-%d %H-%M") + ".txt"), "*.txt");
        diagChooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
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
        pdfChooser = std::make_unique<juce::FileChooser>("Export patch sheet", juce::File::getSpecialLocation(juce::File::userDesktopDirectory).getChildFile(name), "*.pdf");
        pdfChooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles | juce::FileBrowserComponent::warnAboutOverwriting,
                                [done, write](const juce::FileChooser& fc) { done(write(fc.getResult())); });
    });
    // A line from the page into the log (e.g. what a show's migration changed).
    o = add(o, "logLine", [](const juce::var& a) { applog::line(a["text"].toString().substring(0, 4000)); return juce::var(true); });
    o = add(o, "getListen", [this](const juce::var&) { return audio.listenState(); });
    o = add(o, "setListen", [this](const juce::var& a) { return audio.setListen(a); });
    o = add(o, "listenDevices", [this](const juce::var& a) { return audio.listenDevices((double) a.getProperty("rate", 0.0)); });
    // Loading a song: its cues are rendered first (on the Cues worker, usually already cached), then the
    // song is mapped and loaded on the message thread, which never waits for speech.
    o = addAsync(o, "loadSong", [this](const juce::var& a, auto done) {
        if (! a.isObject() || ! a["song"].isObject()) { done(errorVar("loadSong: expected {song, outs, roles, click}")); return; }
        withCues(a, [this, a, done] { done(audio.loadSong(a)); });
    });
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
