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
        settings = std::make_unique<juce::PropertiesFile>(settingsOptions());
        audio = std::make_unique<AudioHost>(*settings);
        audio->start();
        bridge = std::make_unique<Bridge>(*audio, *settings);
        bridge->devMode = dev;
        if (const int rt = args.indexOf("--session-roundtrip"); rt >= 0 && rt + 2 < args.size()) {
            bridge->roundTripIn = juce::File::getCurrentWorkingDirectory().getChildFile(args[rt + 1].unquoted());
            bridge->roundTripOut = juce::File::getCurrentWorkingDirectory().getChildFile(args[rt + 2].unquoted());
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
    std::unique_ptr<juce::PropertiesFile> settings;
    std::unique_ptr<AudioHost> audio;
    std::unique_ptr<Bridge> bridge;
    std::unique_ptr<MainWindow> window;
};

} // namespace setline::gui

START_JUCE_APPLICATION(setline::gui::SetLineApp)
