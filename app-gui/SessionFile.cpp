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
        juce::String text;
        if (! f.existsAsFile() || (text = f.loadFileAsString()).isEmpty()) { done(result({ { "error", "Couldn't read " + f.getFullPathName() } })); return; }
        if (! juce::JSON::parse(text).isObject()) { done(result({ { "error", f.getFileName() + " isn't a set.Line session." } })); return; }
        current = f;
        settings.setValue("sessionFolder", f.getParentDirectory().getFullPathName());
        settings.setValue("lastSession", f.getFullPathName());
        done(result({ { "name", f.getFileNameWithoutExtension() }, { "path", f.getFullPathName() }, { "text", text } }));
    });
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

juce::var SessionFile::write(const juce::File& f, const juce::String& text)
{
    // Write next to the file, then replace it: a crash mid-save never leaves a half-written session.
    juce::TemporaryFile tmp(f);
    if (! tmp.getFile().replaceWithText(text, false, false, "\n") || ! tmp.overwriteTargetFileWithTemporary())
        return result({ { "error", "Couldn't save " + f.getFullPathName() } });
    current = f;
    settings.setValue("sessionFolder", f.getParentDirectory().getFullPathName());
    settings.setValue("lastSession", f.getFullPathName());
    return result({ { "name", f.getFileNameWithoutExtension() }, { "path", f.getFullPathName() } });
}

} // namespace setline::gui
