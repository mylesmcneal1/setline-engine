#include "SessionFile.h"

namespace setline::gui {

namespace {
juce::var result(std::initializer_list<std::pair<const char*, juce::var>> props)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}
} // namespace

juce::File SessionFile::startFolder() const
{
    const juce::File last(settings.getValue("sessionFolder"));
    return last.isDirectory() ? last : juce::File::getSpecialLocation(juce::File::userDocumentsDirectory);
}

void SessionFile::open(Done done)
{
    chooser = std::make_unique<juce::FileChooser>("Open a set.Line session", startFolder(), juce::String("*") + extension);
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                         [this, done](const juce::FileChooser& fc) {
        const auto f = fc.getResult();
        if (f == juce::File()) { done(result({ { "cancelled", true } })); return; }
        done(readSession(f));
    });
}

juce::var SessionFile::readSession(const juce::File& f)
{
    juce::String text;
    if (! f.existsAsFile() || (text = f.loadFileAsString()).isEmpty()) return result({ { "error", "Couldn't read " + f.getFullPathName() } });
    if (! juce::JSON::parse(text).isObject()) return result({ { "error", f.getFileName() + " isn't a set.Line session." } });
    current = f;
    settings.setValue("sessionFolder", f.getParentDirectory().getFullPathName());
    settings.setValue("lastSession", f.getFullPathName());
    addRecent(f);
    return result({ { "name", f.getFileNameWithoutExtension() }, { "path", f.getFullPathName() }, { "text", text } });
}

juce::var SessionFile::openPath(const juce::File& f) { return readSession(f); }

void SessionFile::addRecent(const juce::File& f)
{
    juce::StringArray list;
    list.addLines(settings.getValue("recentSessions"));
    list.removeString(f.getFullPathName());
    list.removeEmptyStrings();
    list.insert(0, f.getFullPathName());
    while (list.size() > 10) list.remove(list.size() - 1);
    settings.setValue("recentSessions", list.joinIntoString("\n"));
    settings.saveIfNeeded();
}

juce::var SessionFile::recent() const
{
    juce::StringArray list;
    list.addLines(settings.getValue("recentSessions"));
    juce::Array<juce::var> out;
    for (auto& p : list) {
        if (p.isEmpty() || ! juce::File::isAbsolutePath(p)) continue;
        const juce::File f(p);
        out.add(result({ { "name", f.getFileNameWithoutExtension() }, { "path", f.getFullPathName() }, { "exists", f.existsAsFile() } }));
    }
    return out;
}

void SessionFile::save(const juce::String& text, Done done)
{
    if (current == juce::File()) { saveAs(text, std::move(done)); return; }
    done(write(current, text));
}

void SessionFile::saveAs(const juce::String& text, Done done)
{
    const auto suggested = current != juce::File() ? current : startFolder().getChildFile(juce::String("Untitled session") + extension);
    chooser = std::make_unique<juce::FileChooser>("Save the set.Line session", suggested, juce::String("*") + extension);
    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                             | juce::FileBrowserComponent::warnAboutOverwriting,
                         [this, text, done](const juce::FileChooser& fc) {
        auto f = fc.getResult();
        if (f == juce::File()) { done(result({ { "cancelled", true } })); return; }
        if (! f.hasFileExtension(extension)) f = f.withFileExtension(extension);
        done(write(f, text));
    });
}

void SessionFile::chooseLocation(Done done)
{
    // Suggest next to the current session's folder (or in the last folder used).
    const auto base = current != juce::File() ? current.getParentDirectory().getParentDirectory() : startFolder();
    const auto name = current != juce::File() ? current.getFileNameWithoutExtension() : juce::String("Untitled session");
    chooser = std::make_unique<juce::FileChooser>("Save the set.Line session", base.getChildFile(name + extension), juce::String("*") + extension);
    chooser->launchAsync(juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                             | juce::FileBrowserComponent::warnAboutOverwriting,
                         [this, done](const juce::FileChooser& fc) {
        auto f = fc.getResult();
        if (f == juce::File()) { done(result({ { "cancelled", true } })); return; }
        if (! f.hasFileExtension(extension)) f = f.withFileExtension(extension);
        const auto stem = f.getFileNameWithoutExtension();
        // Already inside a folder of the same name (e.g. saving over a session): keep it there.
        auto target = f.getParentDirectory().getFileName() == stem ? f : f.getParentDirectory().getChildFile(stem).getChildFile(stem + extension);
        auto finish = [this, target, done] {
            if (! target.getParentDirectory().createDirectory()) { done(result({ { "error", "Couldn't create the folder " + target.getParentDirectory().getFullPathName() } })); return; }
            settings.setValue("sessionFolder", target.getParentDirectory().getParentDirectory().getFullPathName());
            done(result({ { "name", target.getFileNameWithoutExtension() }, { "path", target.getFullPathName() } }));
        };
        if (target != f && target.existsAsFile()) {
            juce::AlertWindow::showOkCancelBox(juce::MessageBoxIconType::WarningIcon, "Replace the session?",
                "A session called \"" + stem + "\" already exists in\n" + target.getParentDirectory().getFullPathName() + "\nReplace it?",
                "Replace", "Cancel", nullptr, juce::ModalCallbackFunction::create([finish, done](int ok) {
                    if (ok) finish(); else done(result({ { "cancelled", true } }));
                }));
            return;
        }
        finish();
    });
}

juce::var SessionFile::write(const juce::File& f, const juce::String& text)
{
    // Write next to the file, then replace it: a crash mid-save never leaves a half-written session.
    juce::TemporaryFile tmp(f);
    if (! tmp.getFile().replaceWithText(text, false, false, "\n") || ! tmp.overwriteTargetFileWithTemporary())
        return result({ { "error", "Couldn't save " + f.getFullPathName() } });
    current = f;
    settings.setValue("sessionFolder", f.getParentDirectory().getFullPathName());
    settings.setValue("lastSession", f.getFullPathName());
    addRecent(f);
    return result({ { "name", f.getFileNameWithoutExtension() }, { "path", f.getFullPathName() } });
}

} // namespace setline::gui
