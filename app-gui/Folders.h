// set.Line desktop app: where things live (docs/phase6c.md item 3).
//   Shows    Documents/set.Line/Shows (changeable in Preferences, settings "showsFolder")
//   Library  Documents/set.Line/Library: Cue Words, MIDI Presets, Click Sounds
//   Settings and the recent list: %APPDATA%\set.Line, ~/Library/Application Support/set.Line (juce::PropertiesFile)
//   Caches and models: %LOCALAPPDATA%\set.Line, ~/Library/Caches/set.Line
//   Logs: %LOCALAPPDATA%\set.Line\Logs, ~/Library/Logs/set.Line (Log.h)
// Message thread (folder creation is cheap; nothing here runs on the audio thread).
#pragma once
#include <juce_data_structures/juce_data_structures.h>

namespace setline::gui::folders {

juce::File documentsRoot();          // Documents/set.Line
juce::File defaultShows();           // Documents/set.Line/Shows
juce::File shows(const juce::PropertiesFile& settings); // the chosen one (created), else the default
juce::File library();                // Documents/set.Line/Library (with its subfolders, created)
juce::File libraryCueWords();
juce::File cache();                  // caches and models
juce::File models();                 // the Kokoro model files (cache()/Models, or where they were before moving)
juce::File webViewData();            // Windows: the web view's own data (localStorage) in cache()/WebView2

// Once per computer: moves what earlier builds kept elsewhere (Mac models from Application Support, the Windows
// web view data from Roaming), without losing anything: whatever can't be moved stays used where it is.
// Returns what it did, for the log.
juce::StringArray migrate(juce::PropertiesFile& settings);

} // namespace setline::gui::folders
