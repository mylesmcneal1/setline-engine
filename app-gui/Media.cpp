#include "Media.h"
#include <map>
#include <mutex>
#include <thread>
#if JUCE_WINDOWS
 #include <windows.h>
#elif JUCE_MAC
 #include <copyfile.h>
#endif

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

// One file with the OS's own copy (what Explorer / Finder use; a clone on APFS). bytes: called as data moves.
// cancel stops a copy in progress. dst must not exist.
bool osCopy(const juce::File& src, const juce::File& dst, std::atomic<bool>& cancel, const std::function<void(juce::int64)>& bytes, juce::String& error)
{
   #if JUCE_WINDOWS
    struct Ctx { std::atomic<bool>* cancel; const std::function<void(juce::int64)>* bytes; } ctx { &cancel, &bytes };
    auto routine = [](LARGE_INTEGER, LARGE_INTEGER done, LARGE_INTEGER, LARGE_INTEGER, DWORD, DWORD, HANDLE, HANDLE, LPVOID p) -> DWORD {
        auto* c = static_cast<Ctx*>(p);
        (*c->bytes)((juce::int64) done.QuadPart);
        return c->cancel->load() ? PROGRESS_CANCEL : PROGRESS_CONTINUE;
    };
    BOOL stop = FALSE;
    if (CopyFileExW(src.getFullPathName().toWideCharPointer(), dst.getFullPathName().toWideCharPointer(), routine, &ctx, &stop, 0)) return true;
    const auto e = GetLastError();
    error = e == ERROR_REQUEST_ABORTED ? juce::String("Copy cancelled")
          : e == ERROR_DISK_FULL ? "The disk is full: " + dst.getParentDirectory().getFullPathName()
          : "Couldn't copy " + src.getFileName() + " (error " + juce::String((int) e) + ")";
    return false;
   #elif JUCE_MAC
    if (cancel.load()) { error = "Copy cancelled"; return false; }
    if (copyfile(src.getFullPathName().toRawUTF8(), dst.getFullPathName().toRawUTF8(), nullptr, COPYFILE_ALL | COPYFILE_CLONE) == 0) { bytes(src.getSize()); return true; }
    error = "Couldn't copy " + src.getFileName() + " (" + juce::String(strerror(errno)) + ")";
    return false;
   #else
    if (cancel.load()) { error = "Copy cancelled"; return false; }
    if (src.copyFileTo(dst)) { bytes(src.getSize()); return true; }
    error = "Couldn't copy " + src.getFileName();
    return false;
   #endif
}

// The same file already there: same size and (copies keep it) the same modified time.
bool sameFile(const juce::File& a, const juce::File& b)
{
    return b.existsAsFile() && a.getSize() == b.getSize()
        && std::abs(a.getLastModificationTime().toMilliseconds() - b.getLastModificationTime().toMilliseconds()) < 2000;
}

juce::File journalFor(const juce::File& folder) { return folder.getChildFile(".setline-copying.json"); }

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
    juce::String kind = "import"; // "import" | "save" (the page shows them differently)
};

Media::Media(juce::PropertiesFile& s) : settings(s) { formats.registerBasicFormats(); }

Media::~Media()
{
    *alive = false;
    cancel->store(true); // a copy in progress stops; its journal lets the next open finish it
    worker.reset();
}

bool Media::copying() const { return worker != nullptr && worker->isThreadRunning(); }
void Media::cancelCopies() { cancel->store(true); if (worker) worker->stopThread(15000); }

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
    // Identical files already there are never copied again.
    std::vector<Job::Copy> todo;
    for (auto& c : job->copies) if (! sameFile(c.src, c.dst)) todo.push_back(c);
    job->copies = todo;
    if (job->copies.empty()) { job->finish({}); return; }
    juce::int64 total = 0;
    for (auto& c : job->copies) total += c.src.getSize();

    std::shared_ptr<Job> shared(std::move(job));
    auto alive_ = alive;
    auto emit_ = emit;
    const auto kind = shared->kind;
    const int files = (int) shared->copies.size();
    auto progress = [alive_, emit_, kind, files](juce::int64 done, juce::int64 all, int filesDone, const juce::String& file, bool finished, const juce::String& error, double ms = 0) {
        juce::MessageManager::callAsync([=] {
            if (*alive_ && emit_) emit_("audioProgress", obj({ { "done", (double) done }, { "total", (double) all }, { "file", file }, { "finished", finished },
                                                               { "files", files }, { "filesDone", filesDone }, { "kind", kind }, { "error", error }, { "ms", ms } }));
        });
    };
    // The journal: what's still to copy, next to where it goes (removed once every file is there).
    std::map<juce::String, juce::Array<juce::var>> byFolder;
    for (auto& c : shared->copies) byFolder[c.dst.getParentDirectory().getFullPathName()].add(obj({ { "src", c.src.getFullPathName() }, { "dst", c.dst.getFileName() } }));
    for (auto& [dir, list] : byFolder) {
        juce::File(dir).createDirectory();
        journalFor(juce::File(dir)).replaceWithText(juce::JSON::toString(obj({ { "copies", list } })));
    }
    cancel = std::make_shared<std::atomic<bool>>(false);
    auto stop = cancel;

    worker = std::make_unique<Worker>([shared, total, progress, alive_, stop, byFolder](juce::Thread& t) {
        // 3 files at a time, each with the OS copy, each to "<name>.part" and renamed when complete.
        std::atomic<size_t> next { 0 };
        std::atomic<juce::int64> bytesDone { 0 };
        std::atomic<int> filesDone { 0 };
        std::atomic<double> lastDone { 0 };
        std::mutex errLock;
        juce::String error, current;
        auto one = [&] {
            for (;;) {
                const size_t i = next++;
                if (i >= shared->copies.size() || stop->load() || t.threadShouldExit()) return;
                const auto& c = shared->copies[i];
                { std::lock_guard<std::mutex> g(errLock); if (error.isNotEmpty()) return; current = c.src.getFileName(); }
                if (! c.dst.getParentDirectory().createDirectory()) { std::lock_guard<std::mutex> g(errLock); if (error.isEmpty()) error = "Couldn't create " + c.dst.getParentDirectory().getFullPathName(); return; }
                const auto tmp = c.dst.getSiblingFile(c.dst.getFileName() + ".part");
                tmp.deleteFile();
                juce::int64 mine = 0;
                juce::String err;
                bool ok = osCopy(c.src, tmp, *stop, [&](juce::int64 b) { bytesDone += b - mine; mine = b; }, err);
                if (ok) { c.dst.deleteFile(); ok = tmp.moveFileTo(c.dst); }
                if (! ok) {
                    tmp.deleteFile();
                    std::lock_guard<std::mutex> g(errLock);
                    if (error.isEmpty()) error = err.isNotEmpty() ? err : "Couldn't write " + c.dst.getFullPathName();
                    return;
                }
                ++filesDone;
                lastDone = juce::Time::getMillisecondCounterHiRes();
            }
        };
        const auto t0 = juce::Time::getMillisecondCounterHiRes();
        std::thread a(one), b(one), c(one);
        for (;;) {
            if (filesDone.load() >= (int) shared->copies.size()) break;
            { std::lock_guard<std::mutex> g(errLock); if (error.isNotEmpty()) break; }
            if (stop->load() || t.threadShouldExit()) break;
            juce::String file;
            { std::lock_guard<std::mutex> g(errLock); file = current; }
            progress(bytesDone.load(), total, filesDone.load(), file, false, {});
            juce::Thread::sleep(120);
        }
        if (t.threadShouldExit()) stop->store(true); // quitting: stop the copies in progress
        a.join(); b.join(); c.join();
        const double ms = (lastDone.load() > 0 ? lastDone.load() : juce::Time::getMillisecondCounterHiRes()) - t0; // the copy itself (reported for tests)
        if (error.isEmpty() && filesDone.load() < (int) shared->copies.size()) error = "Copy cancelled";
        if (error.isEmpty()) for (auto& [dir, list] : byFolder) journalFor(juce::File(dir)).deleteFile(); // all there
        progress(bytesDone.load(), total, filesDone.load(), {}, true, error, ms);
        juce::MessageManager::callAsync([shared, error, alive_] { if (*alive_) shared->finish(error); });
    });
    worker->startThread(juce::Thread::Priority::normal);
}

juce::var Media::resumeCopies(const juce::File& sessionFile)
{
    const auto folder = sessionFolder(sessionFile);
    int resumed = 0, cleaned = 0;
    if (folder == juce::File()) return obj({ { "resumed", 0 }, { "cleaned", 0 } });
    auto job = std::make_unique<Job>();
    job->kind = "save";
    for (auto dir : { folder.getChildFile("Audio"), folder.getChildFile("Cues").getChildFile("Words") }) {
        // half-copied files from an interrupted copy
        for (auto& f : dir.findChildFiles(juce::File::findFiles, false, "*.part")) { f.deleteFile(); ++cleaned; }
        const auto j = journalFor(dir);
        if (! j.existsAsFile()) continue;
        bool pending = false;
        const auto journal = juce::JSON::parse(j); // keep it alive while its list is read
        if (auto* list = journal["copies"].getArray())
            for (auto& c : *list) {
                const juce::File src(c["src"].toString());
                const auto dst = dir.getChildFile(c["dst"].toString());
                if (src.existsAsFile() && ! sameFile(src, dst)) { job->copies.push_back({ src, dst }); pending = true; }
            }
        if (! pending) j.deleteFile();
    }
    resumed = (int) job->copies.size();
    job->finish = [](const juce::String&) {};
    if (resumed > 0 && ! copying()) runJob(std::move(job));
    return obj({ { "resumed", resumed }, { "cleaned", cleaned } });
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
    // A save always goes through (a plain Save has nothing to copy; Save As elsewhere replaces a running copy).
    if (! (bool) arg["background"] && copying()) { done(obj({ { "error", "Still copying files; try again when that finishes." } })); return; }
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
    if ((bool) arg["background"]) { // Save / Save As: the session saves now, the audio follows
        job->kind = "save";
        const int n = (int) job->copies.size();
        job->finish = [](const juce::String&) {};
        if (n > 0 && copying()) cancelCopies(); // Save As elsewhere while copying: the new copy replaces it (its journal covers it)
        runJob(std::move(job));
        done(obj({ { "map", mapVar }, { "missing", missing }, { "copying", n } }));
        return;
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
    // files an interrupted save is still copying (resumeCopies) aren't missing
    juce::StringArray pending;
    if (folder != juce::File())
        for (auto dir : { folder.getChildFile("Audio"), folder.getChildFile("Cues").getChildFile("Words") })
            if (const auto journal = juce::JSON::parse(journalFor(dir)); auto* l = journal["copies"].getArray())
                for (auto& c : *l) pending.add(dir.getChildFile(c["dst"].toString()).getFullPathName());
    auto* map = new juce::DynamicObject();
    juce::var mapVar(map);
    if (auto* refs = arg["refs"].getArray())
        for (auto& r : *refs) {
            const auto ref = r.toString();
            if (resolve(ref, session).existsAsFile() || pending.contains(resolve(ref, session).getFullPathName())) continue;
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
