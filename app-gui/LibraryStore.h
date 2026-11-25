// set.Line desktop app: the Library (phase 6f), the band's master bank of songs and setlists, replacing Shows.
//
// On disk: Documents/set.Line/Libraries/<name>/
//   library.json           everything that isn't a song or a setlist (song fields, dashboards, cue phrases, patch name
//                          lists, presets, click and cue voice defaults...) plus the order of songs and setlists
//   songs/<id>/song.json   one file per song (all its versions): a save rewrites only what changed, a bad write
//                          only ever touches one song
//   setlists/<id>.json     one file per setlist
//   Audio/<hash>.<ext>     every audio file, named by a quick content hash: the same file imported twice is stored once
//   Cues/                  rendered cue audio (as before), Cues/Words: recorded cue words
//   Backups/               whole-library snapshots (one JSON file each), on launch and every few minutes; the last 20
// Every path stored inside is relative to the library folder, so a Library moves between Windows and macOS.
// Each file is written atomically (a temporary file, then swapped in). Message thread only.
#pragma once
#include <juce_data_structures/juce_data_structures.h>

namespace setline::gui {

class LibraryStore {
public:
    explicit LibraryStore(juce::PropertiesFile& settings) : settings(settings) {}

    // Where Libraries live: Documents/set.Line/Libraries (tests: SETLINE_LIBRARIES, or a temp folder).
    static juce::File root();
    static void setTestRoot(const juce::File& f);
    // [{name, path, current, songs}]
    juce::var list() const;
    // Opens a library by name (default: the last one; none at all: creates "My Library").
    // -> {name, root, index (library.json path), text: the whole library as one JSON object, created}
    juce::var open(const juce::String& name = {});
    // -> {name, root} | {error}
    juce::var create(const juce::String& name);
    juce::var rename(const juce::String& name);
    // Writes the parts that changed: files {relative path: text}; remove: [relative path] (song folders / setlists
    // that were deleted). -> {ok, written, removed} | {error}
    juce::var write(const juce::var& files, const juce::var& remove);
    // A snapshot of the whole library (its JSON) into Backups/; the last keep are kept. -> {path} | {error}
    juce::var backup(const juce::String& text, const juce::String& reason);
    // newest first: [{name, path, time, size, reason}]
    juce::var backups() const;
    static constexpr int keep = 20;

    juce::File folder() const { return current; }
    juce::File index() const { return current.getChildFile("library.json"); }
    juce::String name() const { return current == juce::File() ? juce::String() : current.getFileName(); }
    // this computer: the setlist last open in a library; what to open on launch ("last" | "empty")
    juce::String lastSetlist() const { return settings.getValue("lastSetlist:" + name()); }
    void setLastSetlist(const juce::String& id) { settings.setValue("lastSetlist:" + name(), id); settings.saveIfNeeded(); }

    // Text of one JSON object assembled from a library folder (also used by tests and the migration).
    static juce::String assemble(const juce::File& folder);

private:
    juce::PropertiesFile& settings;
    juce::File current;
    static juce::File testRoot;
};

} // namespace setline::gui
