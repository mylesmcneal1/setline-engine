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
        bridge = std::make_unique<Bridge>(*audio);
        bridge->devMode = dev;
        window = std::make_unique<MainWindow>(*settings, *bridge, dev, page);
    }

    void shutdown() override
    {
        window.reset();   // the web view goes first: nothing may call the bridge after this
        bridge.reset();
        audio.reset();
        if (settings) settings->saveIfNeeded();
        settings.reset();
        platform::restoreTimers();
    }

    void systemRequestedQuit() override { quit(); }
    void anotherInstanceStarted(const juce::String&) override { if (window) window->toFront(true); }

private:
    std::unique_ptr<juce::PropertiesFile> settings;
    std::unique_ptr<AudioHost> audio;
    std::unique_ptr<Bridge> bridge;
    std::unique_ptr<MainWindow> window;
};

} // namespace setline::gui

START_JUCE_APPLICATION(setline::gui::SetLineApp)
