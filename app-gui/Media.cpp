#include "Media.h"

namespace setline::gui {

namespace {
juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}
juce::String khz(double r) { return juce::String(r / 1000.0, r == std::floor(r / 1000.0) * 1000.0 ? 0 : 1) + " kHz"; }

juce::File sessionFolder(const juce::File& sessionFile)
{
    return sessionFile == juce::File() ? juce::File() : sessionFile.getParentDirectory();
}

// A free name in dir for src: the same name, or "name 2.wav", "name 3.wav"...
// An existing file of the same name and size is taken to be this file (copied before).
juce::File destinationFor(const juce::File& dir, const juce::File& src, bool& alreadyThere)
{
    alreadyThere = false;
    auto f = dir.getChildFile(src.getFileName());
    if (! f.exists()) return f;
    if (f.getSize() == src.getSize()) { alreadyThere = true; return f; }
    for (int n = 2;; ++n) {
        f = dir.getChildFile(src.getFileNameWithoutExtension() + " " + juce::String(n) + src.getFileExtension());
        if (! f.exists()) return f;
        if (f.getSize() == src.getSize()) { alreadyThere = true; return f; }
    }
}

// Worker thread running one function; joined on destruction.
struct Worker : juce::Thread {
    explicit Worker(std::function<void(juce::Thread&)> f) : juce::Thread("set.Line copy"), fn(std::move(f)) {}
    ~Worker() override { stopThread(60000); }
    void run() override { fn(*this); }
    std::function<void(juce::Thread&)> fn;
};
} // namespace

// One batch of copies. `finish` runs on the message thread with the error text ("" = all copied).
struct Media::Job {
    struct Copy { juce::File src, dst; };
    std::vector<Copy> copies;
    std::function<void(const juce::String& error)> finish;
};

Media::Media(juce::PropertiesFile& s) : settings(s) { formats.registerBasicFormats(); }

Media::~Media()
{
    *alive = false;
    worker.reset(); // waits for a copy in progress
}

bool Media::isAudioFile(const juce::File& f)
{
    return f.hasFileExtension("wav;wave;aif;aiff;flac");
}

juce::File Media::startFolder() const
{
    const juce::File last(settings.getValue("audioFolder"));
    return last.isDirectory() ? last : juce::File::getSpecialLocation(juce::File::userMusicDirectory);
}

juce::File Media::resolve(const juce::String& ref, const juce::File& sessionFile)
{
    if (ref.isEmpty()) return {};
    if (juce::File::isAbsolutePath(ref)) return juce::File(ref);
    const auto folder = sessionFolder(sessionFile);
    if (folder == juce::File()) return {};
    return folder.getChildFile(ref.replaceCharacter('\\', '/'));
}

juce::String Media::makeRef(const juce::File& f, const juce::File& sessionFile)
{
    const auto folder = sessionFolder(sessionFile);
    if (folder != juce::File() && f.isAChildOf(folder))
        return f.getRelativePathFrom(folder).replaceCharacter('\\', '/');
    return f.getFullPathName();
}

juce::var Media::probe(const juce::File& f, double sessionRate)
{
    auto* o = new juce::DynamicObject();
    juce::var out(o);
    o->setProperty("path", f.getFullPathName());
    o->setProperty("name", f.getFileName());
    o->setProperty("ok", false);
    if (! f.existsAsFile()) { o->setProperty("error", "File not found"); return out; }
    if (! isAudioFile(f)) { o->setProperty("error", "Not a WAV, AIFF or FLAC file"); return out; }
    std::unique_ptr<juce::AudioFormatReader> r(formats.createReaderFor(f));
    if (r == nullptr) { o->setProperty("error", "Couldn't read this file as audio"); return out; }
    o->setProperty("channels", (int) r->numChannels);
    o->setProperty("rate", r->sampleRate);
    o->setProperty("frames", (juce::int64) r->lengthInSamples);
    o->setProperty("seconds", r->sampleRate > 0 ? (double) r->lengthInSamples / r->sampleRate : 0.0);
    o->setProperty("format", r->getFormatName());
    o->setProperty("bits", (int) r->bitsPerSample);
    if (r->numChannels < 1 || r->numChannels > 2) {
        o->setProperty("error", "This file has " + juce::String(r->numChannels) + " channels. set.Line plays mono and stereo files only; export it as mono or stereo stems.");
        return out;
    }
    if (sessionRate > 0 && std::abs(r->sampleRate - sessionRate) > 0.5) {
        o->setProperty("error", "This file is " + khz(r->sampleRate) + ", the show runs at " + khz(sessionRate) + "; export it at " + khz(sessionRate) + ".");
        return out;
    }
    if (r->lengthInSamples <= 0) { o->setProperty("error", "This file is empty"); return out; }
    o->setProperty("ok", true);
    return out;
}

juce::var Media::probePaths(const juce::var& arg)
{
    juce::Array<juce::var> list;
    if (auto* paths = arg["paths"].getArray())
        for (auto& p : *paths) list.add(probe(juce::File(p.toString()), (double) arg["rate"]));
    return obj({ { "files", list } });
}

void Media::pick(const juce::var& arg, Done done)
{
    const double rate = arg["rate"];
    const bool multiple = arg.hasProperty("multiple") ? (bool) arg["multiple"] : true;
    chooser = std::make_unique<juce::FileChooser>(multiple ? "Choose stem files" : "Choose an audio file", startFolder(), audioWildcard);
    auto flags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles;
    if (multiple) flags |= juce::FileBrowserComponent::canSelectMultipleItems;
    chooser->launchAsync(flags, [this, rate, done](const juce::FileChooser& fc) {
        const auto files = fc.getResults();
        if (files.isEmpty()) { done(obj({ { "cancelled", true } })); return; }
        settings.setValue("audioFolder", files[0].getParentDirectory().getFullPathName());
        juce::Array<juce::var> list;
        for (auto& f : files) list.add(probe(f, rate));
        done(obj({ { "files", list } }));
    });
}

void Media::runJob(std::unique_ptr<Job> job)
{
    if (job->copies.empty()) { job->finish({}); return; }
    juce::int64 total = 0;
    for (auto& c : job->copies) total += c.src.getSize();

    std::shared_ptr<Job> shared(std::move(job));
    auto alive_ = alive;
    auto emit_ = emit;
    auto progress = [alive_, emit_](juce::int64 done, juce::int64 total, const juce::String& file, bool finished) {
        juce::MessageManager::callAsync([=] {
            if (*alive_ && emit_) emit_("audioProgress", obj({ { "done", (double) done }, { "total", (double) total }, { "file", file }, { "finished", finished } }));
        });
    };

    worker = std::make_unique<Worker>([shared, total, progress, alive_](juce::Thread& t) {
        juce::String error;
        juce::int64 copied = 0;
        auto lastReport = juce::Time::getMillisecondCounter();
        juce::HeapBlock<char> buf(1 << 20);
        for (auto& c : shared->copies) {
            if (t.threadShouldExit()) { error = "Copy cancelled"; break; }
            if (! c.dst.getParentDirectory().createDirectory()) { error = "Couldn't create " + c.dst.getParentDirectory().getFullPathName(); break; }
            // Copy to a temporary name first, so an interrupted copy never looks like a finished file.
            const auto tmp = c.dst.getSiblingFile(c.dst.getFileName() + ".part");
            {
                juce::FileInputStream in(c.src);
                juce::FileOutputStream out(tmp);
                if (! in.openedOk()) { error = "Couldn't read " + c.src.getFullPathName(); break; }
                if (! out.openedOk() || ! out.setPosition(0) || ! out.truncate().wasOk()) { error = "Couldn't write " + tmp.getFullPathName(); break; }
                for (;;) {
                    const auto n = in.read(buf.get(), 1 << 20);
                    if (n <= 0) break;
                    if (! out.write(buf.get(), (size_t) n)) { error = "Couldn't write " + c.dst.getFullPathName() + " (disk full?)"; break; }
                    copied += n;
                    const auto now = juce::Time::getMillisecondCounter();
                    if (now - lastReport > 100) { lastReport = now; progress(copied, total, c.src.getFileName(), false); }
                    if (t.threadShouldExit()) { error = "Copy cancelled"; break; }
                }
                out.flush();
                if (error.isEmpty() && out.getStatus().failed()) error = "Couldn't write " + c.dst.getFullPathName();
            }
            if (error.isNotEmpty() || ! tmp.moveFileTo(c.dst)) {
                tmp.deleteFile();
                if (error.isEmpty()) error = "Couldn't write " + c.dst.getFullPathName();
                break;
            }
        }
        progress(copied, total, {}, true);
        juce::MessageManager::callAsync([shared, error, alive_] { if (*alive_) shared->finish(error); });
    });
    worker->startThread(juce::Thread::Priority::low);
}

// Where copies go inside the show: Audio (stems) or Cues/Words (recorded cue words).
static juce::String copyFolder(const juce::var& arg) { return arg["sub"].toString() == "Cues/Words" ? "Cues/Words" : "Audio"; }

void Media::import(const juce::var& arg, Done done)
{
    if (worker != nullptr && worker->isThreadRunning()) { done(obj({ { "error", "Still copying files; try again when that finishes." } })); return; }
    const juce::File session(arg["session"].toString());
    const bool copy = arg["copy"];
    const auto folder = sessionFolder(session);
    auto job = std::make_unique<Job>();
    juce::Array<juce::var> results;
    juce::Array<juce::File> sources;
    if (auto* files = arg["files"].getArray())
        for (auto& p : *files) {
            const juce::File src(p.toString());
            juce::String ref = src.getFullPathName();
            if (copy && folder != juce::File() && ! src.isAChildOf(folder)) {
                bool there = false;
                auto dst = destinationFor(folder.getChildFile(copyFolder(arg)), src, there);
                // Two picked files can't both claim the same free name.
                for (auto& c : job->copies) if (c.dst == dst) { there = false; dst = dst.getSiblingFile(dst.getFileNameWithoutExtension() + " (" + juce::String(job->copies.size() + 1) + ")" + dst.getFileExtension()); }
                if (! there) job->copies.push_back({ src, dst });
                ref = makeRef(dst, session);
            } else if (folder != juce::File()) {
                ref = makeRef(src, session);
            }
            results.add(obj({ { "path", src.getFullPathName() }, { "ref", ref } }));
        }
    job->finish = [done, results](const juce::String& error) {
        if (error.isNotEmpty()) done(obj({ { "error", error } }));
        else done(obj({ { "files", results } }));
    };
    runJob(std::move(job));
}

void Media::collect(const juce::var& arg, Done done)
{
    if (worker != nullptr && worker->isThreadRunning()) { done(obj({ { "error", "Still copying files; try again when that finishes." } })); return; }
    const juce::File from(arg["from"].toString()), to(arg["to"].toString());
    const auto folder = sessionFolder(to);
    auto job = std::make_unique<Job>();
    auto* map = new juce::DynamicObject();
    juce::var mapVar(map);
    juce::Array<juce::var> missing;
    if (auto* files = arg["files"].getArray())
        for (auto& f : *files) {
            const auto ref = f["ref"].toString();
            if (ref.isEmpty() || map->hasProperty(ref)) continue;
            auto src = resolve(ref, from);
            if (! src.existsAsFile()) {
                // Already where the new session expects it (copied before)?
                const auto there = resolve(ref, to);
                if (there.existsAsFile()) { map->setProperty(ref, makeRef(there, to)); continue; }
                missing.add(ref);
                continue;
            }
            if ((bool) f["copy"] && ! src.isAChildOf(folder)) {
                bool there = false;
                auto dst = destinationFor(folder.getChildFile(f["sub"].toString() == "Cues/Words" ? "Cues/Words" : "Audio"), src, there);
                for (auto& c : job->copies) if (c.dst == dst) { there = false; dst = dst.getSiblingFile(dst.getFileNameWithoutExtension() + " (" + juce::String(job->copies.size() + 1) + ")" + dst.getFileExtension()); }
                if (! there) job->copies.push_back({ src, dst });
                map->setProperty(ref, makeRef(dst, to));
            } else {
                map->setProperty(ref, makeRef(src, to));
            }
        }
    job->finish = [done, mapVar, missing](const juce::String& error) {
        if (error.isNotEmpty()) done(obj({ { "error", error } }));
        else done(obj({ { "map", mapVar }, { "missing", missing } }));
    };
    runJob(std::move(job));
}

juce::var Media::check(const juce::var& arg)
{
    const juce::File session(arg["session"].toString());
    const auto folder = sessionFolder(session);
    juce::Array<juce::var> missing;
    auto* map = new juce::DynamicObject();
    juce::var mapVar(map);
    if (auto* refs = arg["refs"].getArray())
        for (auto& r : *refs) {
            const auto ref = r.toString();
            if (resolve(ref, session).existsAsFile()) continue;
            // Moved with the session but stored elsewhere (e.g. an absolute path from the other computer).
            const auto name = ref.fromLastOccurrenceOf("/", false, false).fromLastOccurrenceOf("\\", false, false);
            if (folder != juce::File() && name.isNotEmpty()) {
                const auto inAudio = folder.getChildFile("Audio").getChildFile(name);
                if (inAudio.existsAsFile()) { map->setProperty(ref, makeRef(inAudio, session)); continue; }
            }
            missing.addIfNotAlreadyThere(ref);
        }
    return obj({ { "missing", missing }, { "map", mapVar } });
}

void Media::locate(const juce::var& arg, Done done)
{
    const juce::File session(arg["session"].toString());
    juce::StringArray missing;
    if (auto* m = arg["missing"].getArray()) for (auto& r : *m) missing.add(r.toString());
    if (missing.isEmpty()) { done(obj({ { "cancelled", true } })); return; }
    const auto firstName = missing[0].fromLastOccurrenceOf("/", false, false).fromLastOccurrenceOf("\\", false, false);
    chooser = std::make_unique<juce::FileChooser>("Locate \"" + firstName + "\"", startFolder(), audioWildcard);
    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                         [this, session, missing, done](const juce::FileChooser& fc) {
        const auto picked = fc.getResult();
        if (picked == juce::File()) { done(obj({ { "cancelled", true } })); return; }
        settings.setValue("audioFolder", picked.getParentDirectory().getFullPathName());
        auto* map = new juce::DynamicObject();
        juce::var mapVar(map);
        // The picked file replaces the first missing one; the rest are looked for by name in the same folder.
        map->setProperty(missing[0], makeRef(picked, session));
        const auto dir = picked.getParentDirectory();
        for (int i = 1; i < missing.size(); ++i) {
            const auto name = missing[i].fromLastOccurrenceOf("/", false, false).fromLastOccurrenceOf("\\", false, false);
            const auto f = dir.getChildFile(name);
            if (name.isNotEmpty() && f.existsAsFile()) map->setProperty(missing[i], makeRef(f, session));
        }
        done(obj({ { "map", mapVar } }));
    });
}

} // namespace setline::gui
