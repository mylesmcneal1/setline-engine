// set.Line desktop app: application, main window and settings.
// The interface is the web UI in ui/ (shown by WebUi); the playback engine is core/ (driven by AudioHost).

#include <juce_gui_extra/juce_gui_extra.h>
#include "../core/Platform.h"
#include "AudioHost.h"
#include "Bridge.h"
#include "LibraryStore.h"
#include "WebUi.h"
#include "Ort.h"
#include "Splash.h"
#include "Log.h"
#include "Folders.h"

namespace setline::gui {

void setWindowIcon(void* nativeHandle); // WinIcon.cpp (Windows); nothing elsewhere

static juce::PropertiesFile::Options settingsOptions()
{
    juce::PropertiesFile::Options o;
    o.applicationName = "setline"; // -> set.Line/setline.settings ("set.Line" would lose ".Line" as an extension)
    o.filenameSuffix = ".settings";
    o.folderName = "set.Line";
    o.osxLibrarySubFolder = "Application Support";
    o.storageFormat = juce::PropertiesFile::storeAsXML;
    return o;
}

class MainWindow : public juce::DocumentWindow {
public:
    // visible = false: created behind the loading window (the page loads meanwhile) and shown when it's done.
    MainWindow(juce::PropertiesFile& s, Bridge& bridge, bool dev, const juce::String& page, bool visible = true)
        : DocumentWindow("set.Line", juce::Colour(0xff0b0c0e), DocumentWindow::allButtons), settings(s)
    {
        setUsingNativeTitleBar(true);
        setResizable(true, false);
        setResizeLimits(960, 600, 10000, 10000);

        ui = std::make_unique<WebUi>(dev, [&bridge](WebUi::Options o) { return bridge.addTo(o); });
        bridge.attach(&ui->browser());
        ui->onFileDrag = [&bridge](const juce::String& state, juce::Point<int> at, const juce::StringArray& files) { bridge.fileDrag(state, at, files); };
        setContentNonOwned(ui.get(), false);

        const auto saved = settings.getValue("windowState");
        if (saved.isEmpty() || ! restoreWindowStateFromString(saved)) centreWithSize(1440, 900);
        setVisible(visible);
        ui->loadStartPage(page);
    }

    ~MainWindow() override
    {
        settings.setValue("windowState", getWindowStateAsString());
        settings.saveIfNeeded();
        clearContentComponent();
    }

    void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
    // The window is created hidden behind the loading window; its native window (and icon) exists once shown.
    void visibilityChanged() override
    {
        DocumentWindow::visibilityChanged();
        if (auto* p = getPeer(); p != nullptr && isVisible()) setWindowIcon(p->getNativeHandle()); // title bar, taskbar, Alt+Tab
    }

private:
    juce::PropertiesFile& settings;
    std::unique_ptr<WebUi> ui;
};

class SetLineApp : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override { return JUCE_APPLICATION_NAME_STRING; }
    const juce::String getApplicationVersion() override { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override { return false; }

    void initialise(const juce::String&) override
    {
        platform::enableHighResolutionTimers();
        const auto args = getCommandLineParameterArray();
        const bool dev = args.contains("--dev");
        const int pi = args.indexOf("--page"); // open another page first (testing), e.g. --page band.html
        const juce::String page = pi >= 0 ? args[pi + 1] : juce::String();
        if (const int kt = args.indexOf("--kokoro-test"); kt >= 0 && kt + 1 < args.size()) {
            kokoroTest(juce::File::getCurrentWorkingDirectory().getChildFile(args[kt + 1].unquoted()));
            return;
        }
        if (const int st = args.indexOf("--speech-test"); st >= 0 && st + 1 < args.size()) {
            speechTest(juce::File::getCurrentWorkingDirectory().getChildFile(args[st + 1].unquoted()));
            return;
        }
        settings = std::make_unique<juce::PropertiesFile>(settingsOptions());
        applog::start(JUCE_APPLICATION_VERSION_STRING);
        applog::line("Started: " + args.joinIntoString(" "));
        applog::mark("app code running");
        for (auto& m : folders::migrate(*settings)) applog::line("Folders: " + m); // once: what earlier builds kept elsewhere
        // The loading window first (not in test runs unless asked: --with-splash); the rest starts once it has
        // painted, so set.Line shows up at once.
        const bool testRun = args.indexOf("--test-script") >= 0 || args.indexOf("--session-roundtrip") >= 0;
        if (! testRun || args.contains("--with-splash")) {
            splash = std::make_unique<Splash>(versionText());
            splash->setStep(Splash::audio, Splash::State::running);
        }
        startArgs = args;
        startDev = dev;
        startPage = page;
        // one frame for the loading window to paint, then the web UI and the audio device start together (7a)
        juce::Timer::callAfterDelay(splash ? 16 : 0, [this] { startAll(); });
    }

    // 7a: the main window's web UI starts loading first (its browser process boots on its own), and the audio device
    // opens meanwhile on this thread; the page's first calls are answered once both are under way.
    void startAll()
    {
        if (splash) applog::mark("loading window shown");
        audio = std::make_unique<AudioHost>(*settings);
        double t = juce::Time::getMillisecondCounterHiRes();
        openMain(startPage);
        applog::mark("web UI started", juce::Time::getMillisecondCounterHiRes() - t);
        startAudio();
    }

    // "0.1.<CI run>" ("0.1 (dev build)" for a local build).
    static juce::String versionText()
    {
        const juce::String v = JUCE_APPLICATION_VERSION_STRING;
        return v.endsWith(".0") ? v.dropLastCharacters(2) + " (dev build)" : v;
    }

    // Step 1: the audio interface. The saved one missing (unplugged): the loading window asks what to do.
    void startAudio()
    {
        const double t = juce::Time::getMillisecondCounterHiRes();
        audio->start();
        applog::mark("audio device open", juce::Time::getMillisecondCounterHiRes() - t);
        const auto summary = audio->deviceSummary();
        // --loading-error audio | show: show that error screen (to check how it looks without unplugging anything)
        const auto forced = startArgs.indexOf("--loading-error") >= 0 ? startArgs[startArgs.indexOf("--loading-error") + 1] : juce::String();
        if (splash && forced == "show") { audioDecided = true; splash->setStep(Splash::audio, Splash::State::done, summary); juce::Timer::callAfterDelay(400, [this] { splash->setStep(Splash::show, Splash::State::failed); askShow("The file is damaged (it isn't valid JSON)."); }); return; }
        if (splash && (forced == "audio" || summary.isEmpty())) { askAudio(); return; }
        if (splash) splash->setStep(Splash::audio, Splash::State::done, audio->fallbackFrom().isNotEmpty() ? audio->fallbackFrom() + " not found: this computer" : summary);
        audioDone();
    }
    void audioDone() { audioDecided = true; if (audio && audio->onSetupChanged) audio->onSetupChanged(); finishLoading(); }
    void askAudio()
    {
        applog::line("Start-up: audio interface problem: " + audio->savedDeviceLabel() + " " + audio->savedDeviceProblem());
        const auto label = audio->savedDeviceLabel();
        splash->setStep(Splash::audio, Splash::State::failed);
        splash->showError(label.isNotEmpty() ? "Your audio interface isn't connected" : "No audio output found",
            (label.isNotEmpty() ? "set.Line couldn't find \"" + label + "\". " : juce::String("set.Line couldn't open an audio output. "))
                + "Plug it in and press Try again, or open the show without audio to keep working.",
            { { "Try again", [this] {
                  const auto err = audio->retrySaved();
                  if (err.isNotEmpty() && audio->deviceSummary().isEmpty()) { askAudio(); return; }
                  if (err.isNotEmpty()) { askAudio(); return; }
                  splash->setStep(Splash::audio, Splash::State::done, audio->deviceSummary());
                  audioDone();
              } },
              { juce::String::fromUTF8("Choose another output\xe2\x80\xa6"), [this] { // the show, with Settings › Audio open (every device)
                  splash->setStep(Splash::audio, Splash::State::done, audio->deviceSummary().isNotEmpty() ? audio->deviceSummary() : juce::String("choose in Settings"));
                  audioDone();
                  sendMenu("prefsAudio");
              } },
              { "Listen on this computer", [this] { // the show's routing stays; this computer's speakers / headphones play it
                  auto* req = new juce::DynamicObject();
                  req->setProperty("on", true);
                  const auto r = audio->setListen(juce::var(req));
                  if (r["error"].toString().isNotEmpty()) { askAudio(); return; }
                  splash->setStep(Splash::audio, Splash::State::done, "Listening on " + r["current"].toString());
                  audioDone();
              } },
              { "Open without audio", [this] {
                  audio->closeDevice();
                  splash->setStep(Splash::audio, Splash::State::done, "no audio");
                  audioDone();
              } } });
    }

    // Step 2: the main window, hidden behind the loading window while its page loads the show, waveforms and cues.
    void openMain(const juce::String& page)
    {
        const auto& args = startArgs;
        const bool dev = startDev;
        bridge = std::make_unique<Bridge>(*audio, *settings);
        bridge->devMode = dev;
        if (const int rt = args.indexOf("--session-roundtrip"); rt >= 0 && rt + 2 < args.size()) {
            bridge->roundTripIn = juce::File::getCurrentWorkingDirectory().getChildFile(args[rt + 1].unquoted());
            bridge->roundTripOut = juce::File::getCurrentWorkingDirectory().getChildFile(args[rt + 2].unquoted());
        }
        if (const int ts = args.indexOf("--test-script"); ts >= 0 && ts + 2 < args.size()) {
            bridge->testScript = juce::File::getCurrentWorkingDirectory().getChildFile(args[ts + 1].unquoted());
            bridge->testOut = juce::File::getCurrentWorkingDirectory().getChildFile(args[ts + 2].unquoted());
        }
        bridge->reopenLastInTests = args.contains("--reopen-last");
        // Tests never touch the real Libraries: SETLINE_LIBRARIES, else a fresh temporary folder per run.
        if (bridge->testScript != juce::File() && juce::SystemStats::getEnvironmentVariable("SETLINE_LIBRARIES", {}).isEmpty())
            LibraryStore::setTestRoot(juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("setline-test-libraries").getNonexistentChildFile("run", ""));
        bridge->onLoadingStep = [this](const juce::var& a) {
            if (! splash) return;
            const auto id = a["id"].toString();
            const auto step = id == "show" ? Splash::show : id == "waveforms" ? Splash::waveforms : id == "cues" ? Splash::cues : Splash::numSteps;
            if (step == Splash::numSteps) return;
            const auto st = a["state"].toString();
            splash->setStep(step, st == "done" ? Splash::State::done : st == "failed" ? Splash::State::failed : Splash::State::running,
                            a["detail"].toString(), (float) (double) a["fraction"]);
            if (step == Splash::show && st == "failed") askShow(a["detail"].toString());
            if (step == Splash::show && st == "done") finishLoading(); // e.g. after Retry
        };
        bridge->onLoadingDone = [this] { pageReady = true; finishLoading(); };
        window = std::make_unique<MainWindow>(*settings, *bridge, dev, page, splash == nullptr);
        if (! splash) bridge->loading = false;
        else {
            splash->setStep(Splash::show, Splash::State::running);
            // Never stuck behind the loading window: after 45 s the main window shows anyway.
            juce::Timer::callAfterDelay(45000, [this] { if (splash && ! splash->finished() && ! showError) { pageReady = true; finishLoading(); } });
        }
        // Window title: "<session> — set.Line", with a dot while there are unsaved changes.
        bridge->onDocument = [this](const juce::String& name, bool dirty) {
            static const juce::String dot = juce::CharPointer_UTF8("\xe2\x80\xa2 "), dash = juce::CharPointer_UTF8(" \xe2\x80\x94 set.Line");
            if (window) window->setName((dirty ? dot : juce::String()) + (name.isEmpty() ? juce::String("Library") : name) + dash);
        };
       #if JUCE_MAC
        menu = std::make_unique<MacMenu>(*bridge);
        {
            juce::PopupMenu apple; // set.Line > About set.Line (the page shows the build)
            apple.addItem(juce::PopupMenu::Item("About set.Line").setID(9).setAction([this] { sendMenu("about"); }));
            apple.addSeparator();
            apple.addItem(juce::PopupMenu::Item(juce::String::fromUTF8("Settings\xe2\x80\xa6")).setID(10).setAction([this] { sendMenu("prefs"); }));
            juce::MenuBarModel::setMacMainMenu(menu.get(), &apple);
        }
       #endif
    }

    // The show couldn't be opened: the page has started an empty session; the user picks what's next.
    void askShow(const juce::String& why)
    {
        applog::line("Start-up: the show couldn't be opened: " + why);
        showError = true;
        splash->showError("The library couldn't be opened", why + " Try again, or carry on with an empty setlist.",
            { { "Retry", [this] { showError = false; splash->setStep(Splash::show, Splash::State::running); sendMenu("retryShow"); } },
              { "Empty setlist", [this] { showError = false; if (! bridge) openMain(startPage); sendMenu("new"); finishLoading(); } } });
    }
    void sendMenu(const char* cmd)
    {
        if (! bridge) return;
        auto* o = new juce::DynamicObject(); o->setProperty("cmd", cmd);
        bridge->emit("menu", juce::var(o));
    }
    void finishLoading()
    {
        if (! splash || ! pageReady || ! audioDecided || showError || splash->finished()) return;
        splash->finish([this] { if (window) { window->setVisible(true); window->toFront(true); } if (bridge) bridge->loading = false; applog::mark("window visible"); });
    }

    void shutdown() override
    {
        applog::line("Quit");
        splash.reset();
        if (testThread.joinable()) testThread.join();
        testCues.reset();
       #if JUCE_MAC
        juce::MenuBarModel::setMacMainMenu(nullptr);
        menu.reset();
       #endif
        window.reset();   // the web view goes first: nothing may call the bridge after this
        bridge.reset();
        audio.reset();
        if (settings) settings->saveIfNeeded();
        settings.reset();
        platform::restoreTimers();
        applog::stop();
    }

    void systemRequestedQuit() override
    {
        if (! bridge || ! bridge->isDirty()) { quit(); return; }
        // The page asks Save / Don't save / Cancel (it can save with the stems collected); if it doesn't answer
        // within 2 s (page not loaded), the plain question below.
        quitAnswered = false;
        bridge->onQuitAnswered = [this] { quitAnswered = true; };
        auto* o = new juce::DynamicObject(); o->setProperty("cmd", "quit");
        bridge->emit("menu", juce::var(o));
        juce::Timer::callAfterDelay(2000, [this] { if (bridge && ! quitAnswered) askQuitNative(); });
    }
    bool quitAnswered = false;
    void askQuitNative()
    {
        juce::AlertWindow::showOkCancelBox(juce::MessageBoxIconType::WarningIcon, "Quit set.Line?",
                                           "The last change hasn't reached the disk yet. Quit anyway?", "Quit", "Cancel", nullptr,
                                           juce::ModalCallbackFunction::create([](int ok) { if (ok) juce::JUCEApplication::quit(); }));
    }
    void anotherInstanceStarted(const juce::String&) override
    {
        if (window && window->isVisible()) window->toFront(true);
        else if (splash) splash->toFront(true);
    }

private:
   #if JUCE_MAC
    // macOS menu bar: File > Open / Save / Save As with the usual ⌘ shortcuts (the page does the work).
    struct MacMenu : juce::MenuBarModel {
        explicit MacMenu(Bridge& b) : bridge(b) {}
        juce::StringArray getMenuBarNames() override { return { "File", "Help" }; }
        juce::PopupMenu getMenuForIndex(int index, const juce::String&) override
        {
            juce::PopupMenu m;
            if (index == 1) { // Help
                m.addItem(juce::PopupMenu::Item("Copy diagnostics").setID(21).setAction([this] { send("copyDiagnostics"); }));
                m.addItem(juce::PopupMenu::Item("Save diagnostics...").setID(22).setAction([this] { send("saveDiagnostics"); }));
                return m;
            }
            // 6f: there is no Open or Save: the Library saves itself
            m.addItem(juce::PopupMenu::Item("New Setlist").setID(4).setAction([this] { send("new"); }));
            m.addItem(juce::PopupMenu::Item("Duplicate Setlist").setID(1).setAction([this] { send("dupSetlist"); }));
            m.addSeparator();
            m.addItem(juce::PopupMenu::Item("Export Setlist...").setID(2).setAction([this] { send("export"); }));
            m.addItem(juce::PopupMenu::Item("Import...").setID(3).setAction([this] { send("import"); }));
            m.addSeparator();
            m.addItem(juce::PopupMenu::Item("Backups...").setID(6).setAction([this] { send("openBackup"); }));
            m.addItem(juce::PopupMenu::Item("Clean Up Unused Audio...").setID(5).setAction([this] { send("cleanUp"); }));
            return m;
        }
        void menuItemSelected(int, int) override {}
        void send(const char* cmd) { auto* o = new juce::DynamicObject(); o->setProperty("cmd", cmd); bridge.emit("menu", juce::var(o)); }
        Bridge& bridge;
    };
    std::unique_ptr<MacMenu> menu;
   #endif
    // --speech-test <dir>: lists the installed voices, speaks a cue with each (at 48 kHz, through the same
    // render + cache path as the show), writes <dir>/<voice>.wav and <dir>/speech-test.txt, then quits
    // (exit code 1 if nothing could be spoken). No window or audio device: CI runs it on Windows and macOS.
    void speechTest(const juce::File& dir)
    {
        dir.createDirectory();
        testCues = std::make_unique<Cues>();
        testThread = std::thread([this, dir] {
            juce::StringArray report;
            auto progress = [](const juce::String& m) { std::fprintf(stderr, "speech-test: %s\n", m.toRawUTF8()); std::fflush(stderr); };
            progress("listing voices");
            const auto list = testCues->voices();
            progress(juce::String(list.size()) + " voices");
            report.add("voices: " + juce::String(list.size()));
            int spoken = 0;
            auto speak = [&](const Cues::Choice& c, const juce::String& label) {
                progress("speaking with " + label);
                juce::String err;
                bool fellBack = false;
                const auto t0 = juce::Time::getMillisecondCounterHiRes();
                auto a = testCues->get("Verse one", c, 48000, err, fellBack);
                const auto ms = juce::Time::getMillisecondCounterHiRes() - t0;
                progress(a ? "spoken" : "failed: " + err);
                if (! a) { report.add("FAIL " + label + ": " + err); return; }
                float peak = 0;
                for (float x : *a) peak = juce::jmax(peak, std::abs(x));
                report.add("ok   " + label + ": " + juce::String((double) a->size() / 48000.0, 2) + " s, peak " + juce::String(peak, 2)
                           + ", first sample above -48 dB at " + juce::String((int) (std::find_if(a->begin(), a->end(), [](float x) { return std::abs(x) >= 0.004f; }) - a->begin()))
                           + ", " + juce::String((int) ms) + " ms" + (fellBack ? " (fell back to the default voice)" : ""));
                juce::WavAudioFormat wav;
                std::unique_ptr<juce::OutputStream> os = dir.getChildFile(juce::File::createLegalFileName(label) + ".wav").createOutputStream();
                if (os) {
                    static_cast<juce::FileOutputStream*>(os.get())->setPosition(0);
                    static_cast<juce::FileOutputStream*>(os.get())->truncate();
                    const auto opts = juce::AudioFormatWriterOptions {}.withSampleRate(48000).withNumChannels(1).withBitsPerSample(24);
                    if (auto w = wav.createWriterFor(os, opts)) { const float* ch[] = { a->data() }; w->writeFromFloatArrays(ch, 1, (int) a->size()); }
                }
                ++spoken;
            };
            speak({}, "default voice");
            if (auto* arr = list.getArray())
                for (auto& v : *arr)
                    if (v["engine"].toString() != "kokoro") // the computer's voices only (--kokoro-test covers Kokoro)
                        speak({ v["id"].toString(), v["name"].toString(), 1.0, {} }, v["name"].toString() + " [" + v["lang"].toString() + "]");
            // A voice from another computer: falls back to the default voice.
            juce::String err;
            bool fellBack = false;
            auto a = testCues->get("Verse one", { "com.example.not-installed", "Not Installed Voice", 1.0, {} }, 48000, err, fellBack);
            report.add(juce::String(a && fellBack ? "ok   " : "FAIL ") + "voice not installed here: falls back to the default voice");
            // Same cue again: from the cache, no new rendering.
            const auto t0 = juce::Time::getMillisecondCounterHiRes();
            auto again = testCues->get("Verse one", {}, 48000, err, fellBack);
            report.add(juce::String(again ? "ok   " : "FAIL ") + "cached cue: " + juce::String((int) (juce::Time::getMillisecondCounterHiRes() - t0)) + " ms");
            // 7a: a count-in on the beat (the computer's default voice)
            {
                const auto line = countInCheck(*testCues, {}, "default voice");
                report.add(line);
                if (line.startsWith("FAIL")) spoken = 0;
            }
            report.add(spoken > 0 ? "SPEECH OK" : "SPEECH FAILED");
            dir.getChildFile("speech-test.txt").replaceWithText(report.joinIntoString("\n") + "\n");
            std::printf("%s\n", report.joinIntoString("\n").toRawUTF8());
            juce::MessageManager::callAsync([spoken] { juce::JUCEApplication::getInstance()->setApplicationReturnValue(spoken > 0 ? 0 : 1); juce::JUCEApplication::quit(); });
        });
    }
    // 7a: "1 2 3 4" at 120 BPM through the engine (each word placed with its onset lead, as a show does): every word's
    // onset (Cues::onsetOf on what the engine played) is within 2 ms of its beat. Says how late the raw words were.
    static juce::String countInCheck(Cues& cues, const Cues::Choice& voice, const juce::String& label)
    {
        const double sr = 48000;
        const char* words[] = { "one", "two", "three", "four" };
        juce::StringArray late, off;
        bool ok = true;
        for (int k = 0; k < 4; ++k) {
            juce::String err; bool fb = false;
            auto a = cues.get(words[k], voice, sr, err, fb);
            if (! a || a->empty()) return "FAIL count-in (" + label + "): \"" + juce::String(words[k]) + "\" couldn't be spoken: " + err;
            setline::SongDef s; s.name = "Count-in"; s.tempo = { { 1, 120, 4, 4 } }; s.lengthBars = 3; s.cueOuts = { 0 }; s.cueGainDb = 0;
            setline::CueDef d; d.bar = 2; d.beat = k + 1; d.audio = a; d.text = words[k]; d.lead = Cues::onsetOf(*a, sr);
            s.cues.push_back(d);
            setline::Engine e; setline::Engine::Config cfg; cfg.sampleRate = sr; cfg.numOutputs = 1; cfg.offline = true;
            std::vector<std::string> w;
            if (! e.load(s, cfg, w).empty()) return "FAIL count-in (" + label + "): the song didn't load";
            e.start(0);
            std::vector<float> out, buf(256); float* ptr[] = { buf.data() };
            while (e.isPlaying()) { e.process(ptr, 1, 256); out.insert(out.end(), buf.begin(), buf.end()); }
            const int64_t beat = 96000 + (int64_t) k * 24000, got = Cues::onsetOf(out, sr);
            const double errMs = (double) (got - beat) * 1000.0 / sr;
            late.add(juce::String((int) std::lround(d.lead * 1000.0 / sr)));
            off.add(juce::String(errMs, 2));
            if (std::abs(errMs) > 2.0) ok = false;
        }
        return juce::String(ok ? "ok   " : "FAIL ") + "count-in on the beat (" + label + ", 120 BPM): onsets " + off.joinIntoString(" / ") + " ms from the beats (the raw words start " + late.joinIntoString(" / ") + " ms late; now moved earlier by that)";
    }

    // --kokoro-test <dir>: the built-in voices end to end, without a window or audio device (CI, both platforms).
    // Downloads + verifies the model (or finds it), checks how the common cue words are pronounced, renders
    // every English voice saying each of them (render, resample to 48 kHz, trim, as a show does), then the
    // cache and "edit one cue, re-render one cue". Writes <dir>/kokoro-test.txt and a few WAVs to listen to;
    // prints KOKORO OK (exit 0) or KOKORO FAILED (exit 1).
    void kokoroTest(const juce::File& dir)
    {
        dir.createDirectory();
        Cues::cacheOverride = dir.getChildFile("cue-cache"); // fresh every run: render counts and times are real
        Cues::cacheOverride.deleteRecursively();
        testCues = std::make_unique<Cues>();
        testThread = std::thread([this, dir] {
            juce::StringArray report;
            int fails = 0;
            auto progress = [](const juce::String& m) { std::fprintf(stderr, "kokoro-test: %s\n", m.toRawUTF8()); std::fflush(stderr); };
            auto check = [&](bool ok, const juce::String& what) { report.add((ok ? "ok   " : "FAIL ") + what); if (! ok) ++fails; progress((ok ? "ok   " : "FAIL ") + what); };
            auto finish = [&] {
                report.add(fails == 0 ? "KOKORO OK" : "KOKORO FAILED");
                dir.getChildFile("kokoro-test.txt").replaceWithText(report.joinIntoString("\n") + "\n");
                std::printf("%s\n", report.joinIntoString("\n").toRawUTF8());
                juce::MessageManager::callAsync([fails] { juce::JUCEApplication::getInstance()->setApplicationReturnValue(fails == 0 ? 0 : 1); juce::JUCEApplication::quit(); });
            };
            const auto U = [](const char* s) { return juce::String::fromUTF8(s); };

            // 1. The model files: downloaded on first use, every file's SHA-256 checked.
            const auto t0 = juce::Time::getMillisecondCounterHiRes();
            const auto before = kokoro::status();
            report.add("models folder: " + kokoro::folder().getFullPathName());
            report.add("files before: " + kokoro::stateName(before.state) + " (" + juce::String(before.done / 1048576) + " of " + juce::String(before.total / 1048576) + " MB)");
            juce::String err;
            const bool ready = kokoro::waitReady(45 * 60 * 1000, err);
            check(ready, "model, voices and dictionaries present and verified (SHA-256)"
                             + (ready ? ", " + juce::String((juce::Time::getMillisecondCounterHiRes() - t0) / 1000.0, 1) + " s" : ": " + err));
            if (! ready) { finish(); return; }

            // 2. Pronunciation: the common cue words, American and British, with no word left unknown.
            const juce::StringArray words { "Intro", "Verse", "Verse one", "Verse two", "Pre-Chorus", "Chorus", "Post-Chorus", "Bridge", "Breakdown",
                                            "Interlude", "Solo", "Outro", "Tag", "Ending", "Count in", "All in", "Drums", "Bass", "Guitar", "Keys",
                                            "Vocals", "A cappella", "Build", "Drop", "Last time", "Half time", "Key change", "Chorus x2", "1st verse", "3" };
            for (bool gb : { false, true }) {
                juce::StringArray unknown, lines;
                for (auto& w : words) lines.add(w + " = " + kokoro::phonemes(w, gb, {}, &unknown));
                report.add((gb ? "British: " : "American: ") + lines.joinIntoString(" | "));
                check(unknown.isEmpty(), juce::String(gb ? "British" : "American") + ": every common cue word is in the dictionaries"
                                             + (unknown.isEmpty() ? juce::String() : ": unknown " + unknown.joinIntoString(", ")));
            }
            const auto bassUS = kokoro::phonemes("Bass", false, {}), x2 = kokoro::phonemes("Chorus x2", false, {}), first = kokoro::phonemes("1st verse", false, {});
            check(bassUS.contains(U("b\xcb\x88" "As")), "Bass is the instrument (" + bassUS + ")");
            check(x2.contains(U("t\xcb\x88" "Imz")) && x2.contains(U("t\xcb\x88" "u")), "x2 reads 'times two' (" + x2 + ")");
            check(first.startsWith(U("f\xcb\x88\xc9\x9c\xc9\xb9st")), "1st reads 'first' (" + first + ")");
            {
                juce::StringArray unknown, unknown2;
                const auto guessed = kokoro::phonemes("Vlorbix", false, {}, &unknown);
                report.add("unknown word sounded out: Vlorbix = " + guessed);
                const auto fixed = kokoro::phonemes("Vlorbix", false, { { "vlorbix", "floor bicks" } }, &unknown2);
                check(unknown.contains("Vlorbix") && unknown2.isEmpty() && fixed.isNotEmpty(), "an unknown word is reported, and the show's pronunciation fixes it (" + fixed + ")");
            }

            // 3. Every English voice says every common word: not silent, a sensible length, starting at once.
            const auto list = kokoro::voices();
            const double rate = 48000;
            int rendered = 0;
            double total = 0, worst = 0, firstLoad = 0;
            juce::StringArray bad;
            for (auto& v : list) {
                for (auto& w : words) {
                    const auto t1 = juce::Time::getMillisecondCounterHiRes();
                    bool fb = false;
                    auto a = testCues->get(w, { v.id, v.name, 1.0, {} }, rate, err, fb);
                    const double ms = juce::Time::getMillisecondCounterHiRes() - t1;
                    if (rendered == 0) firstLoad = ms;
                    else { total += ms; worst = juce::jmax(worst, ms); }
                    ++rendered;
                    float peak = 0;
                    if (a) for (float x : *a) peak = juce::jmax(peak, std::abs(x));
                    const double secs = a ? (double) a->size() / rate : 0;
                    const int onset = a ? (int) (std::find_if(a->begin(), a->end(), [](float x) { return std::abs(x) >= 0.004f; }) - a->begin()) : -1;
                    const bool ok = a && ! fb && peak > 0.05f && secs > 0.15 && secs < 4.0 && onset >= 0 && onset <= (int) (0.003 * rate);
                    if (! ok) bad.add(v.name + " '" + w + "': " + (a ? juce::String(secs, 2) + " s, peak " + juce::String(peak, 2) + ", onset " + juce::String(onset) : err));
                    if (a && (w == "Chorus" || w == "Verse one") && (v.rank >= 6 || v.name == "George" || v.name == "Fable")) {
                        juce::WavAudioFormat wav;
                        std::unique_ptr<juce::OutputStream> os = dir.getChildFile(v.name + " - " + w + ".wav").createOutputStream();
                        if (os) {
                            static_cast<juce::FileOutputStream*>(os.get())->setPosition(0);
                            static_cast<juce::FileOutputStream*>(os.get())->truncate();
                            const auto opts = juce::AudioFormatWriterOptions {}.withSampleRate(rate).withNumChannels(1).withBitsPerSample(24);
                            if (auto wr = wav.createWriterFor(os, opts)) { const float* ch[] = { a->data() }; wr->writeFromFloatArrays(ch, 1, (int) a->size()); }
                        }
                    }
                }
                progress(v.name + " done");
            }
            check(bad.isEmpty(), juce::String((int) list.size()) + " voices x " + juce::String(words.size()) + " words: all spoken, not silent, 0.15-4 s, voice within 3 ms of the start"
                                     + (bad.isEmpty() ? juce::String() : ": " + bad.joinIntoString("; ")));
            report.add("render time per cue: " + juce::String(total / juce::jmax(1, rendered - 1), 0) + " ms average, " + juce::String(worst, 0)
                       + " ms slowest, first " + juce::String(firstLoad, 0) + " ms (includes loading the model); " + juce::SystemStats::getCpuModel()
                       + ", ONNX Runtime " + ort::loadedVersion());

            // 4. Cache: the same cue again is instant; changing one cue re-renders only that one.
            const Cues::Choice heart { kokoro::defaultVoiceId(), "Heart", 1.0, {} };
            const auto t2 = juce::Time::getMillisecondCounterHiRes();
            bool fb = false;
            auto again = testCues->get("Chorus", heart, rate, err, fb);
            const double hitMs = juce::Time::getMillisecondCounterHiRes() - t2;
            check(again != nullptr && hitMs < 20, "cached cue: " + juce::String(hitMs, 2) + " ms, no render");
            const int n0 = kokoro::renderCount();
            for (auto* w : { "Verse", "Chorus", "Bridge" }) testCues->get(w, heart, rate, err, fb);
            const int n1 = kokoro::renderCount();
            for (auto* w : { "Verse", "Chorus two", "Bridge" }) testCues->get(w, heart, rate, err, fb); // one cue edited
            const int n2 = kokoro::renderCount();
            { const auto ci = countInCheck(*testCues, heart, "Heart"); check(ci.startsWith("ok"), ci.fromFirstOccurrenceOf(" ", false, false).trim()); }
            check(n1 == n0 && n2 == n1 + 1, "editing one cue re-renders only that cue (" + juce::String(n1 - n0) + " then " + juce::String(n2 - n1) + " renders)");
            auto withPron = heart;
            withPron.pron = { { "bridge", "bridge" } };
            const int n3 = kokoro::renderCount();
            for (auto* w : { "Verse", "Bridge" }) testCues->get(w, withPron, rate, err, fb);
            check(kokoro::renderCount() == n3 + 1, "a pronunciation re-renders only the cues with that word");
            finish();
        });
    }
    std::unique_ptr<Cues> testCues;
    std::thread testThread;

    std::unique_ptr<Splash> splash;
    juce::StringArray startArgs;
    bool startDev = false, pageReady = false, showError = false, audioDecided = false;
    juce::String startPage;
    std::unique_ptr<juce::PropertiesFile> settings;
    std::unique_ptr<AudioHost> audio;
    std::unique_ptr<Bridge> bridge;
    std::unique_ptr<MainWindow> window;
};

} // namespace setline::gui

START_JUCE_APPLICATION(setline::gui::SetLineApp)
