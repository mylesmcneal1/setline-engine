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

    // Step 2: a session lives in its own folder (with Audio/ next to it). Asks where to save and returns
    // <chosen folder>/<name>/<name>.setline, creating the folder. Nothing is written yet.
    // -> {path, name} | {cancelled} | {error}
    void chooseLocation(Done done);
    // Save into the Shows folder by name: <Shows>/<name>/<name>.setline (portable name). create: makes the folder.
    // -> {path, name, folder, exists}
    juce::var inShows(const juce::String& name, bool create);
    // Automatic backups: before a save replaces the show file, the previous one goes to <show>/Backups as
    // "<name> YYYY-MM-DD HH-MM-SS.setline"; the last 10 are kept. -> [{name, path, time (ms), size}] newest first
    juce::var backups() const;
    static constexpr int keepBackups = 10;
    // Writes text to path (atomically) and makes it the current session. -> {name, path} | {error}
    juce::var writeTo(const juce::File& f, const juce::String& text) { return write(f, text); }

    // Open Recent: the last sessions opened or saved, newest first -> [{name, path, exists}].
    juce::var recent() const;
    void clearRecent() { settings.setValue("recentSessions", juce::String()); }
    // The show open when set.Line last closed (reopened at start-up).
    juce::String lastSession() const { return settings.getValue("lastSession"); }
    // New / Close: nothing to reopen next time.
    void forgetLast() { settings.setValue("lastSession", juce::String()); }
    // Opens a session by path (Open Recent) -> {name, path, text} | {error}
    juce::var openPath(const juce::File& f);
    // Close / New: no current file (the next Save asks where).
    void close() { current = juce::File(); }
    // 6f: the open Library's index file stands in for the show file (relative audio, Cues/, Backups/ resolve against it)
    void setCurrent(const juce::File& f) { current = f; }

    juce::String name() const { return current.existsAsFile() ? current.getFileNameWithoutExtension() : juce::String(); }
    juce::File file() const { return current; }

    static constexpr const char* extension = ".setline";

private:
    juce::var write(const juce::File& f, const juce::String& text);
    juce::var readSession(const juce::File& f);
    void addRecent(const juce::File& f);
    juce::File startFolder() const;

    juce::PropertiesFile& settings;
    juce::File current;
    std::unique_ptr<juce::FileChooser> chooser;
};

} // namespace setline::gui
