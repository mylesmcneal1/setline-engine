// set.Line desktop app: opening and saving .setline session files (JSON) through native dialogs.
// Message thread only. Results come back through callbacks, because the dialogs are asynchronous.
#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_data_structures/juce_data_structures.h>
#include <functional>

namespace setline::gui {

class SessionFile {
public:
    using Done = std::function<void(juce::var)>;

    explicit SessionFile(juce::PropertiesFile& settings) : settings(settings) {}

    // {name, path, text} | {cancelled: true} | {error}
    void open(Done done);
    // Writes to the current file, or asks where (like Save As) if there is none. -> {name, path} | {cancelled} | {error}
    void save(const juce::String& text, Done done);
    void saveAs(const juce::String& text, Done done);

    juce::String name() const { return current.existsAsFile() ? current.getFileNameWithoutExtension() : juce::String(); }
    juce::File file() const { return current; }

    static constexpr const char* extension = ".setline";

private:
    juce::var write(const juce::File& f, const juce::String& text);
    juce::File startFolder() const;

    juce::PropertiesFile& settings;
    juce::File current;
    std::unique_ptr<juce::FileChooser> chooser;
};

} // namespace setline::gui
