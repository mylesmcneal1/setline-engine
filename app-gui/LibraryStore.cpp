#include "LibraryStore.h"
#include "Folders.h"
#include "Log.h"
#include "Media.h"
#include <algorithm>
#include <map>

namespace setline::gui {

juce::File LibraryStore::testRoot;

namespace {
juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> kv)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : kv) o->setProperty(k, v);
    return juce::var(o);
}
juce::var err(const juce::String& e) { return obj({ { "error", e } }); }

bool writeAtomic(const juce::File& f, const juce::String& text)
{
    if (! f.getParentDirectory().createDirectory()) return false;
    if (f.existsAsFile() && f.loadFileAsString() == text) return true; // nothing changed
    juce::TemporaryFile tmp(f);
    return tmp.getFile().replaceWithText(text, false, false, "\n") && tmp.overwriteTargetFileWithTemporary();
}

// A relative path inside a library: songs/<id>/song.json, setlists/<id>.json or library.json; nothing that climbs out.
bool safeRel(const juce::String& rel)
{
    if (rel.isEmpty() || rel.contains("..") || rel.startsWithChar('/') || rel.containsChar('\\') || rel.containsChar(':')) return false;
    return rel == "library.json" || rel.startsWith("songs/") || rel.startsWith("setlists/");
}

juce::var parse(const juce::File& f)
{
    juce::var v;
    if (f.existsAsFile() && juce::JSON::parse(f.loadFileAsString(), v).wasOk()) return v;
    return {};
}
} // namespace

void LibraryStore::setTestRoot(const juce::File& f) { testRoot = f; }

juce::File LibraryStore::root()
{
    const auto env = juce::SystemStats::getEnvironmentVariable("SETLINE_LIBRARIES", {});
    juce::File r = env.isNotEmpty() ? juce::File(env) : testRoot != juce::File() ? testRoot : folders::documentsRoot().getChildFile("Libraries");
    r.createDirectory();
    return r;
}

juce::var LibraryStore::list() const
{
    juce::Array<juce::var> out;
    for (const auto& d : root().findChildFiles(juce::File::findDirectories, false)) {
        if (! d.getChildFile("library.json").existsAsFile()) continue;
        const int songs = d.getChildFile("songs").findChildFiles(juce::File::findDirectories, false).size();
        out.add(obj({ { "name", d.getFileName() }, { "path", d.getFullPathName() }, { "current", d == current }, { "songs", songs } }));
    }
    return out;
}

juce::String LibraryStore::assemble(const juce::File& folder)
{
    juce::var lib = parse(folder.getChildFile("library.json"));
    auto* o = lib.getDynamicObject() ? lib.getDynamicObject()->clone().release() : new juce::DynamicObject();
    juce::var all(o);
    // songs and setlists in their saved order; anything not in the order (a file written before the index) after it
    auto collect = [&](const juce::String& order, const juce::Array<juce::File>& files, auto idOf) {
        juce::Array<juce::var> out;
        std::map<juce::String, juce::var> byId;
        juce::StringArray fileOrder;
        for (auto& f : files) { auto v = parse(f); if (! v.isObject()) { applog::line("Library: couldn't read " + f.getFullPathName()); continue; } const auto id = idOf(f, v); byId[id] = v; fileOrder.add(id); }
        if (auto* ids = lib[juce::Identifier(order)].getArray())
            for (auto& id : *ids) if (auto it = byId.find(id.toString()); it != byId.end()) { out.add(it->second); byId.erase(it); }
        fileOrder.sort(true);
        for (auto& id : fileOrder) if (auto it = byId.find(id); it != byId.end()) { out.add(it->second); byId.erase(it); }
        return out;
    };
    juce::Array<juce::File> songFiles, setFiles;
    for (auto& d : folder.getChildFile("songs").findChildFiles(juce::File::findDirectories, false)) if (d.getChildFile("song.json").existsAsFile()) songFiles.add(d.getChildFile("song.json"));
    for (auto& f : folder.getChildFile("setlists").findChildFiles(juce::File::findFiles, false, "*.json")) setFiles.add(f);
    o->setProperty("songs", collect("songOrder", songFiles, [](const juce::File& f, const juce::var& v) { return v["id"].toString().isNotEmpty() ? v["id"].toString() : f.getParentDirectory().getFileName(); }));
    o->setProperty("setlists", collect("setlistOrder", setFiles, [](const juce::File& f, const juce::var& v) { return v["id"].toString().isNotEmpty() ? v["id"].toString() : f.getFileNameWithoutExtension(); }));
    o->removeProperty("songOrder"); o->removeProperty("setlistOrder");
    if (! o->hasProperty("format")) o->setProperty("format", "setline-library");
    return juce::JSON::toString(all, false);
}

juce::var LibraryStore::open(const juce::String& wanted)
{
    const auto r = root();
    juce::String name = wanted.isNotEmpty() ? wanted : settings.getValue("lastLibrary");
    juce::File dir = name.isNotEmpty() ? r.getChildFile(Media::portableName(name)) : juce::File();
    bool created = false;
    if (dir == juce::File() || ! dir.getChildFile("library.json").existsAsFile()) {
        if (wanted.isNotEmpty()) return err("There's no library called “" + wanted + "”.");
        // the last one is gone (or there never was one): the first library there is, else a new "My Library"
        dir = juce::File();
        for (const auto& d : r.findChildFiles(juce::File::findDirectories, false)) if (d.getChildFile("library.json").existsAsFile()) { dir = d; break; }
        if (dir == juce::File()) {
            dir = r.getChildFile("My Library");
            if (! writeAtomic(dir.getChildFile("library.json"), juce::JSON::toString(obj({ { "format", "setline-library" }, { "version", 1 }, { "name", "My Library" } }))))
                return err("Couldn't create " + dir.getFullPathName());
            created = true;
            applog::line("Library: created " + dir.getFullPathName());
        }
    }
    for (auto* sub : { "songs", "setlists", "Audio", "Cues", "Backups" }) dir.getChildFile(sub).createDirectory();
    current = dir;
    settings.setValue("lastLibrary", dir.getFileName());
    settings.saveIfNeeded();
    applog::line("Library: opened " + dir.getFullPathName());
    return obj({ { "name", dir.getFileName() }, { "root", dir.getFullPathName() }, { "index", index().getFullPathName() }, { "text", assemble(dir) }, { "created", created } });
}

juce::var LibraryStore::create(const juce::String& wanted)
{
    const auto name = Media::portableName(wanted.trim());
    if (name.isEmpty()) return err("Give the library a name.");
    const auto dir = root().getChildFile(name);
    if (dir.exists()) return err("There's already a library called “" + name + "”.");
    if (! writeAtomic(dir.getChildFile("library.json"), juce::JSON::toString(obj({ { "format", "setline-library" }, { "version", 1 }, { "name", name } }))))
        return err("Couldn't create " + dir.getFullPathName());
    return obj({ { "name", name }, { "root", dir.getFullPathName() } });
}

juce::var LibraryStore::rename(const juce::String& wanted)
{
    if (current == juce::File()) return err("No library is open.");
    const auto name = Media::portableName(wanted.trim());
    if (name.isEmpty()) return err("Give the library a name.");
    if (name == current.getFileName()) return obj({ { "name", name }, { "root", current.getFullPathName() } });
    const auto dir = root().getChildFile(name);
    if (dir.exists()) return err("There's already a library called “" + name + "”.");
    if (! current.moveFileTo(dir)) return err("Couldn't rename the library folder (is a file in it open elsewhere?).");
    current = dir;
    settings.setValue("lastLibrary", name);
    applog::line("Library: renamed to " + dir.getFullPathName());
    return obj({ { "name", name }, { "root", dir.getFullPathName() }, { "index", index().getFullPathName() } });
}

juce::var LibraryStore::remove(const juce::String& wanted)
{
    const auto name = Media::portableName(wanted.trim());
    if (name.isEmpty()) return err("Which library?");
    const auto dir = root().getChildFile(name);
    if (! dir.getChildFile("library.json").existsAsFile()) return err("There's no library called “" + name + "”.");
    if (dir == current) return err("That library is open: switch to another one first.");
    if (! dir.moveToTrash()) return err("Couldn't move the library to the Trash (is a file in it open elsewhere?).");
    if (settings.getValue("lastLibrary") == name) settings.removeValue("lastLibrary");
    applog::line("Library: moved to the Trash: " + dir.getFullPathName());
    return obj({ { "ok", true }, { "name", name } });
}

juce::var LibraryStore::write(const juce::var& files, const juce::var& remove)
{
    if (current == juce::File()) return err("No library is open.");
    int written = 0, removed = 0;
    if (auto* o = files.getDynamicObject())
        for (auto& p : o->getProperties()) {
            const auto rel = p.name.toString();
            if (! safeRel(rel)) return err("Not a library file: " + rel);
            if (! writeAtomic(current.getChildFile(rel), p.value.toString())) return err("Couldn't write " + current.getChildFile(rel).getFullPathName());
            ++written;
        }
    if (auto* a = remove.getArray())
        for (auto& r : *a) {
            const auto rel = r.toString();
            if (! safeRel(rel) || rel == "library.json") continue;
            auto f = current.getChildFile(rel);
            if (f.existsAsFile()) { f.deleteFile(); ++removed; }
            if (rel.startsWith("songs/")) { auto d = f.getParentDirectory(); if (d.isDirectory() && d.getParentDirectory() == current.getChildFile("songs") && d.getNumberOfChildFiles(juce::File::findFilesAndDirectories) == 0) d.deleteFile(); }
        }
    return obj({ { "ok", true }, { "written", written }, { "removed", removed } });
}

juce::var LibraryStore::backup(const juce::String& text, const juce::String& reason)
{
    if (current == juce::File()) return err("No library is open.");
    const auto dir = current.getChildFile("Backups");
    dir.createDirectory();
    // the newest backup already holds exactly this: nothing to do
    auto files = dir.findChildFiles(juce::File::findFiles, false, "*.setline");
    files.sort();
    if (! files.isEmpty() && files.getLast().loadFileAsString() == text) return obj({ { "path", files.getLast().getFullPathName() }, { "same", true } });
    const auto f = dir.getChildFile(current.getFileName() + " " + juce::Time::getCurrentTime().formatted("%Y-%m-%d %H-%M-%S") + (reason.isNotEmpty() ? " " + reason : juce::String()) + ".setline").getNonexistentSibling();
    if (! writeAtomic(f, text)) return err("Couldn't write " + f.getFullPathName());
    files = dir.findChildFiles(juce::File::findFiles, false, "*.setline");
    std::sort(files.begin(), files.end(), [](const juce::File& a, const juce::File& b) { return a.getLastModificationTime() < b.getLastModificationTime(); });
    for (int i = 0; i < files.size() - keep; ++i) files.getReference(i).deleteFile();
    return obj({ { "path", f.getFullPathName() } });
}

juce::var LibraryStore::backups() const
{
    juce::Array<juce::var> out;
    if (current == juce::File()) return out;
    auto files = current.getChildFile("Backups").findChildFiles(juce::File::findFiles, false, "*.setline");
    std::sort(files.begin(), files.end(), [](const juce::File& a, const juce::File& b) { return a.getLastModificationTime() > b.getLastModificationTime(); });
    for (auto& f : files)
        out.add(obj({ { "name", f.getFileNameWithoutExtension() }, { "path", f.getFullPathName() }, { "time", (double) f.getLastModificationTime().toMilliseconds() }, { "size", (double) f.getSize() } }));
    return out;
}

} // namespace setline::gui
