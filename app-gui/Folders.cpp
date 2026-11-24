#include "Folders.h"

namespace setline::gui::folders {

namespace {
juce::File made(const juce::File& f) { f.createDirectory(); return f; }

// Where earlier builds kept things.
juce::File oldModels()
{
   #if JUCE_MAC
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Application Support/set.Line/Models");
   #else
    return {};
   #endif
}
juce::File oldWebViewData()
{
   #if JUCE_WINDOWS
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("set.Line/WebView2");
   #else
    return {};
   #endif
}
} // namespace

juce::File documentsRoot() { return juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("set.Line"); }
juce::File defaultShows() { return documentsRoot().getChildFile("Shows"); }

juce::File shows(const juce::PropertiesFile& settings)
{
    const juce::File chosen(settings.getValue("showsFolder"));
    if (chosen != juce::File() && (chosen.isDirectory() || chosen.createDirectory())) return chosen;
    return made(defaultShows());
}

juce::File library()
{
    const auto lib = made(documentsRoot().getChildFile("Library"));
    for (auto* sub : { "Cue Words", "MIDI Presets", "Click Sounds" }) lib.getChildFile(sub).createDirectory();
    return lib;
}
juce::File libraryCueWords() { return library().getChildFile("Cue Words"); }

juce::File cache()
{
   #if JUCE_MAC
    return juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile("Library/Caches/set.Line");
   #elif JUCE_WINDOWS
    return juce::File::getSpecialLocation(juce::File::windowsLocalAppData).getChildFile("set.Line");
   #else
    return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("set.Line");
   #endif
}

juce::File models()
{
    const auto now = cache().getChildFile("Models"), before = oldModels();
    // not moved (yet): keep using them where they are, never download them again
    if (! now.isDirectory() && before != juce::File() && before.isDirectory()) return before;
    return now;
}

juce::File webViewData()
{
    const auto now = cache().getChildFile("WebView2"), before = oldWebViewData();
    if (! now.isDirectory() && before != juce::File() && before.isDirectory()) return before;
    return now;
}

juce::StringArray migrate(juce::PropertiesFile& settings)
{
    juce::StringArray did;
    if (settings.getIntValue("storageVersion", 1) >= 2) return did;
    cache().createDirectory();
    auto move = [&did](const juce::File& from, const juce::File& to, const char* what) {
        if (from == juce::File() || ! from.isDirectory()) return true;
        if (to.exists()) { did.add(juce::String(what) + ": already at " + to.getFullPathName() + " (left " + from.getFullPathName() + ")"); return true; }
        to.getParentDirectory().createDirectory();
        if (from.moveFileTo(to)) { did.add(juce::String(what) + " moved to " + to.getFullPathName()); return true; }
        did.add(juce::String(what) + ": couldn't move " + from.getFullPathName() + ", still used there");
        return false;
    };
    bool ok = move(oldModels(), cache().getChildFile("Models"), "Voice models");
    ok = move(oldWebViewData(), cache().getChildFile("WebView2"), "Page data") && ok;
    // the standard folders exist from the start
    made(defaultShows());
    library();
    if (ok) { settings.setValue("storageVersion", 2); settings.saveIfNeeded(); } // else: tried again next time
    return did;
}

} // namespace setline::gui::folders
