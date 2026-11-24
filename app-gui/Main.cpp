// set.Line desktop app: application, main window and settings.
// The interface is the web UI in ui/ (shown by WebUi); the playback engine is core/ (driven by AudioHost).

#include <juce_gui_extra/juce_gui_extra.h>
#include "../core/Platform.h"
#include "AudioHost.h"
#include "Bridge.h"
#include "WebUi.h"

namespace setline::gui {

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
    MainWindow(juce::PropertiesFile& s, Bridge& bridge, bool dev, const juce::String& page)
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
        setVisible(true);
        ui->loadStartPage(page);
    }

    ~MainWindow() override
    {
        settings.setValue("windowState", getWindowStateAsString());
        settings.saveIfNeeded();
        clearContentComponent();
    }

    void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }

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
        const int pi = args.indexOf("--page"); // open another page first (testing), e.g. --page 2-routing.html
        const juce::String page = pi >= 0 ? args[pi + 1] : juce::String();
        if (const int st = args.indexOf("--speech-test"); st >= 0 && st + 1 < args.size()) {
            speechTest(juce::File::getCurrentWorkingDirectory().getChildFile(args[st + 1].unquoted()));
            return;
        }
        settings = std::make_unique<juce::PropertiesFile>(settingsOptions());
        audio = std::make_unique<AudioHost>(*settings);
        audio->start();
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
        window = std::make_unique<MainWindow>(*settings, *bridge, dev, page);
        // Window title: "<session> — set.Line", with a dot while there are unsaved changes.
        bridge->onDocument = [this](const juce::String& name, bool dirty) {
            static const juce::String dot = juce::CharPointer_UTF8("\xe2\x80\xa2 "), dash = juce::CharPointer_UTF8(" \xe2\x80\x94 set.Line");
            if (window) window->setName((dirty ? dot : juce::String()) + (name.isEmpty() ? juce::String("Untitled session") : name) + dash);
        };
       #if JUCE_MAC
        menu = std::make_unique<MacMenu>(*bridge);
        juce::MenuBarModel::setMacMainMenu(menu.get());
       #endif
    }

    void shutdown() override
    {
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
    }

    void systemRequestedQuit() override
    {
        if (! bridge || ! bridge->isDirty()) { quit(); return; }
        juce::AlertWindow::showOkCancelBox(juce::MessageBoxIconType::WarningIcon, "Quit set.Line?",
                                           "The session has unsaved changes. Quit without saving?", "Quit", "Cancel", nullptr,
                                           juce::ModalCallbackFunction::create([](int ok) { if (ok) juce::JUCEApplication::quit(); }));
    }
    void anotherInstanceStarted(const juce::String&) override { if (window) window->toFront(true); }

private:
   #if JUCE_MAC
    // macOS menu bar: File > Open / Save / Save As with the usual ⌘ shortcuts (the page does the work).
    struct MacMenu : juce::MenuBarModel {
        explicit MacMenu(Bridge& b) : bridge(b) {}
        juce::StringArray getMenuBarNames() override { return { "File" }; }
        juce::PopupMenu getMenuForIndex(int, const juce::String&) override
        {
            juce::PopupMenu m;
            m.addItem(juce::PopupMenu::Item("Open...").setID(1).setAction([this] { send("open"); }));
            m.addItem(juce::PopupMenu::Item("Save").setID(2).setAction([this] { send("save"); }));
            m.addItem(juce::PopupMenu::Item("Save As...").setID(3).setAction([this] { send("saveAs"); }));
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
            const auto list = testCues->voices();
            report.add("voices: " + juce::String(list.size()));
            int spoken = 0;
            auto speak = [&](const Cues::Choice& c, const juce::String& label) {
                juce::String err;
                bool fellBack = false;
                const auto t0 = juce::Time::getMillisecondCounterHiRes();
                auto a = testCues->get("Verse one", c, 48000, err, fellBack);
                const auto ms = juce::Time::getMillisecondCounterHiRes() - t0;
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
                for (auto& v : *arr) speak({ v["id"].toString(), v["name"].toString(), 1.0 }, v["name"].toString() + " [" + v["lang"].toString() + "]");
            // A voice from another computer: falls back to the default voice.
            juce::String err;
            bool fellBack = false;
            auto a = testCues->get("Verse one", { "com.example.not-installed", "Not Installed Voice", 1.0 }, 48000, err, fellBack);
            report.add(juce::String(a && fellBack ? "ok   " : "FAIL ") + "voice not installed here: falls back to the default voice");
            // Same cue again: from the cache, no new rendering.
            const auto t0 = juce::Time::getMillisecondCounterHiRes();
            auto again = testCues->get("Verse one", {}, 48000, err, fellBack);
            report.add(juce::String(again ? "ok   " : "FAIL ") + "cached cue: " + juce::String((int) (juce::Time::getMillisecondCounterHiRes() - t0)) + " ms");
            report.add(spoken > 0 ? "SPEECH OK" : "SPEECH FAILED");
            dir.getChildFile("speech-test.txt").replaceWithText(report.joinIntoString("\n") + "\n");
            std::printf("%s\n", report.joinIntoString("\n").toRawUTF8());
            juce::MessageManager::callAsync([spoken] { juce::JUCEApplication::getInstance()->setApplicationReturnValue(spoken > 0 ? 0 : 1); juce::JUCEApplication::quit(); });
        });
    }
    std::unique_ptr<Cues> testCues;
    std::thread testThread;

    std::unique_ptr<juce::PropertiesFile> settings;
    std::unique_ptr<AudioHost> audio;
    std::unique_ptr<Bridge> bridge;
    std::unique_ptr<MainWindow> window;
};

} // namespace setline::gui

START_JUCE_APPLICATION(setline::gui::SetLineApp)
