#include "AbletonImport.h"
#include <algorithm>
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <set>

namespace setline::gui::ableton {

namespace {

using Xml = juce::XmlElement;

// ---------------------------------------------------------------- small XML helpers (unknown elements: ignored)
const Xml* kid(const Xml* e, const char* name) { return e ? e->getChildByName(name) : nullptr; }
const Xml* path(const Xml* e, std::initializer_list<const char*> names) { for (auto* n : names) e = kid(e, n); return e; }
juce::String val(const Xml* e, std::initializer_list<const char*> names, const juce::String& def = {})
{
    auto* x = path(e, names);
    return x && x->hasAttribute("Value") ? x->getStringAttribute("Value") : def;
}
double num(const Xml* e, std::initializer_list<const char*> names, double def = 0)
{
    const auto s = val(e, names);
    return s.isEmpty() ? def : s.getDoubleValue();
}
bool flag(const Xml* e, std::initializer_list<const char*> names, bool def = false)
{
    const auto s = val(e, names);
    return s.isEmpty() ? def : s.equalsIgnoreCase("true");
}
template <typename F> void each(const Xml* e, const char* name, F f) { if (e) for (auto* c : e->getChildWithTagNameIterator(name)) f(c); }

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> kv)
{
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : kv) o->setProperty(k, v);
    return juce::var(o);
}

std::unique_ptr<Xml> loadXml(const juce::File& f, juce::String& error)
{
    juce::FileInputStream in(f);
    if (! in.openedOk()) { error = "Couldn't open " + f.getFileName() + "."; return {}; }
    juce::MemoryBlock raw;
    in.readIntoMemoryBlock(raw);
    juce::String text;
    const auto* b = static_cast<const unsigned char*>(raw.getData());
    if (raw.getSize() > 2 && b[0] == 0x1f && b[1] == 0x8b) {
        juce::MemoryInputStream mi(raw, false);
        juce::GZIPDecompressorInputStream gz(&mi, false, juce::GZIPDecompressorInputStream::gzipFormat);
        juce::MemoryOutputStream mo;
        mo.writeFromInputStream(gz, -1);
        text = mo.toUTF8();
    } else text = raw.toString();
    if (text.isEmpty()) { error = f.getFileName() + " couldn't be read (not a Live Set?)."; return {}; }
    auto x = juce::XmlDocument::parse(text);
    if (! x || ! x->hasTagName("Ableton")) { error = f.getFileName() + " isn't an Ableton Live Set."; return {}; }
    return x;
}

// ---------------------------------------------------------------- time: Live beats (quarter notes) -> seconds
struct TempoCurve {
    struct P { double beat, bpm, sec; };
    std::vector<P> pts; // the tempo at each automation point; linear in BPM between points (Live's ramps)
    void build(std::vector<std::pair<double, double>> ev, double fallbackBpm)
    {
        std::stable_sort(ev.begin(), ev.end(), [](auto& a, auto& b) { return a.first < b.first; });
        pts.clear();
        double start = fallbackBpm;
        std::vector<std::pair<double, double>> pos;
        for (auto& e : ev) { if (e.first <= 0) start = e.second; else pos.push_back(e); }
        pts.push_back({ 0, start, 0 });
        for (auto& [b, v] : pos) {
            const auto& p = pts.back();
            pts.push_back({ b, v, p.sec + span(p.beat, p.bpm, b, v) });
        }
    }
    static double span(double b0, double v0, double b1, double v1)
    {
        const double d = b1 - b0;
        if (d <= 0) return 0;
        if (std::abs(v1 - v0) < 1e-9) return 60.0 * d / v0;
        const double k = (v1 - v0) / d;
        return 60.0 / k * std::log(v1 / v0);
    }
    double sec(double beat) const
    {
        if (beat <= 0) return 60.0 * beat / pts.front().bpm;
        size_t i = 0;
        while (i + 1 < pts.size() && pts[i + 1].beat <= beat) ++i;
        const auto& p = pts[i];
        if (i + 1 >= pts.size()) return p.sec + 60.0 * (beat - p.beat) / p.bpm;
        const auto& q = pts[i + 1];
        const double v = p.bpm + (q.bpm - p.bpm) * (beat - p.beat) / (q.beat - p.beat);
        return p.sec + span(p.beat, p.bpm, beat, v);
    }
    double beatAt(double s) const // inverse (bisection; for unwarped looping clips)
    {
        double lo = -1, hi = 1;
        while (sec(hi) < s) hi *= 2;
        for (int k = 0; k < 80; ++k) { const double m = (lo + hi) / 2; (sec(m) < s ? lo : hi) = m; }
        return (lo + hi) / 2;
    }
    bool ramps() const { for (size_t i = 1; i < pts.size(); ++i) if (pts[i].beat > pts[i - 1].beat && std::abs(pts[i].bpm - pts[i - 1].bpm) > 1e-9) return true; return false; }
};

struct Meter { double beat; int num, den; };
// Live's time signature automation value: (numerator - 1) + 99 * log2(denominator)
Meter meterFrom(double beat, int v) { return { beat, v % 99 + 1, 1 << std::clamp(v / 99, 0, 6) }; }

// ---------------------------------------------------------------- names
juce::String stripLocator(juce::String n, juce::StringArray* flags = nullptr, bool* nosong = nullptr)
{
    // {description}, [attributes], #tags, +FLAGS (AbleSet notation)
    for (;;) { const int a = n.indexOfChar('{'), b = n.indexOfChar('}'); if (a < 0 || b < a) break; n = n.substring(0, a) + n.substring(b + 1); }
    for (;;) {
        const int a = n.indexOfChar('['), b = n.indexOfChar(']');
        if (a < 0 || b < a) break;
        if (nosong && n.substring(a + 1, b).trim().equalsIgnoreCase("nosong")) *nosong = true;
        n = n.substring(0, a) + n.substring(b + 1);
    }
    juce::StringArray w; w.addTokens(n, " ", "");
    juce::StringArray keep;
    for (auto& t : w) {
        if (t.startsWithChar('#') && t.length() > 1) continue;
        if (t.startsWithChar('+') && t.length() > 1 && t.substring(1).toUpperCase() == t.substring(1) && juce::CharacterFunctions::isLetter(t[1])) { if (flags) flags->add(t.substring(1).upToFirstOccurrenceOf(":", false, false)); continue; }
        if (t.isNotEmpty()) keep.add(t);
    }
    return keep.joinIntoString(" ").trim();
}

juce::String sectionType(const juce::String& name)
{
    const auto n = name.toLowerCase();
    struct R { const char* word; const char* type; };
    static const R rules[] = { { "count", "count-in" }, { "click", "count-in" }, { "pre-chorus", "pre" }, { "prechorus", "pre" }, { "pre chorus", "pre" },
                               { "pre", "pre" }, { "build", "pre" }, { "chorus", "chorus" }, { "hook", "chorus" }, { "refrain", "chorus" },
                               { "verse", "verse" }, { "intro", "intro" }, { "outro", "outro" }, { "ending", "outro" }, { "end", "outro" },
                               { "bridge", "bridge" }, { "middle 8", "bridge" }, { "breakdown", "bridge" }, { "break", "bridge" },
                               { "turn", "turn" }, { "interlude", "turn" }, { "inst", "turn" }, { "solo", "turn" } };
    for (auto& r : rules)
        if (n == r.word || n.startsWith(juce::String(r.word) + " ") || n.startsWith(juce::String(r.word) + "-") || (n.startsWith(r.word) && n.length() > (int) strlen(r.word) && juce::CharacterFunctions::isDigit(n[(int) strlen(r.word)])))
            return r.type;
    return "other";
}

// Live's colour palette (index -> RGB, 70 colours in 5 rows of 14) is approximated by its hue column and row; the
// nearest of set.Line's track colours.
juce::String colourFor(int idx)
{
    static const char* pal[] = { "#ff6b6b", "#ff9f43", "#ffd60a", "#30d158", "#22c3a6", "#64d2ff", "#5aa9ff", "#5e5ce6", "#bf5af2", "#ff375f", "#ac8e68", "#c9cdd4" };
    if (idx < 0) return pal[11];
    const int col = idx % 14, row = idx / 14;
    static const int byCol[14] = { 0, 1, 10, 2, 3, 3, 4, 5, 6, 7, 8, 9, 11, 11 };
    if (row == 4 && col >= 12) return pal[11];
    return pal[byCol[col]];
}

// ---------------------------------------------------------------- samples
juce::String hexToUtf16(const juce::String& hex)
{
    juce::MemoryBlock mb; mb.loadFromHexString(hex);
    if (mb.getSize() < 2) return {};
    juce::String s(juce::CharPointer_UTF16(static_cast<const juce::CharPointer_UTF16::CharType*>(mb.getData())), (size_t) mb.getSize() / 2);
    return s.upToFirstOccurrenceOf(juce::String::charToString(0), false, false);
}

struct Finder {
    juce::File projectDir;
    std::map<juce::String, juce::File> found; // file name (lower case) -> file, from the folder searches
    bool searched = false;
    void search()
    {
        if (searched) return;
        searched = true;
        auto add = [&](const juce::File& dir, bool recursive) {
            if (! dir.isDirectory()) return;
            for (const auto& e : juce::RangedDirectoryIterator(dir, recursive, "*", juce::File::findFiles)) {
                const auto n = e.getFile().getFileName().toLowerCase();
                if (! found.count(n)) found[n] = e.getFile();
            }
        };
        add(projectDir, true); // the project folder and everything in it (Samples/Imported, Recorded, Processed...)
        // its parents, 2 levels up, and the folders beside it (a few levels deep, so a huge Documents folder
        // can't stall the import): "Samples" folders, bounces next to the project...
        int budget = 20000;
        std::function<void(const juce::File&, int)> walk = [&](const juce::File& dir, int depth) {
            for (const auto& e : juce::RangedDirectoryIterator(dir, false, "*", juce::File::findFilesAndDirectories)) {
                if (--budget < 0) return;
                const auto f = e.getFile();
                if (e.isDirectory()) { if (depth > 0 && f != projectDir && ! f.getFileName().startsWithChar('.')) walk(f, depth - 1); continue; }
                const auto n = f.getFileName().toLowerCase();
                if (! found.count(n)) found[n] = f;
            }
        };
        auto p = projectDir;
        for (int up = 0; up < 2 && budget > 0; ++up) { p = p.getParentDirectory(); if (p.isDirectory()) walk(p, 3 - up); }
    }
    // FileRef -> the file, or {} (name = the file name it wants)
    juce::File resolve(const Xml* fileRef, juce::String& name)
    {
        if (! fileRef) return {};
        juce::String abs = val(fileRef, { "Path" }), rel;
        if (auto* r = kid(fileRef, "RelativePath")) {
            if (r->hasAttribute("Value")) rel = r->getStringAttribute("Value");
            else { juce::StringArray parts; each(r, "RelativePathElement", [&](const Xml* x) { parts.add(x->getStringAttribute("Dir")); }); rel = parts.joinIntoString("/"); }
        }
        name = val(fileRef, { "Name" });
        if (abs.isEmpty()) if (auto* d = kid(fileRef, "Data")) { const auto h = d->getAllSubText().removeCharacters(" \r\n\t"); if (h.length() > 8) abs = hexToUtf16(h); }
        if (name.isEmpty()) name = (abs.isNotEmpty() ? abs : rel).replaceCharacter('\\', '/').fromLastOccurrenceOf("/", false, false);
        else if (rel.isNotEmpty() && ! rel.endsWithIgnoreCase(name)) rel = rel + "/" + name;
        if (abs.isNotEmpty() && juce::File::isAbsolutePath(abs) && juce::File(abs).existsAsFile()) return juce::File(abs);
        if (rel.isNotEmpty()) {
            for (auto base : { projectDir, projectDir.getParentDirectory() }) {
                auto f = base.getChildFile(rel.replaceCharacter('\\', '/'));
                if (f.existsAsFile()) return f;
            }
        }
        if (name.isEmpty()) return {};
        search();
        if (auto it = found.find(name.toLowerCase()); it != found.end()) return it->second;
        return {};
    }
};

// ---------------------------------------------------------------- the arrangement, read once
struct Clip {
    double start = 0, end = 0;          // arrangement beats
    double loopStart = 0, loopEnd = 0, startRel = 0; bool loopOn = false;
    bool warped = true, disabled = false;
    std::vector<std::pair<double, double>> warp; // (beatTime, secTime)
    double gain = 1, fadeIn = 0, fadeOut = 0;
    int pitch = 0;
    juce::File file; juce::String fileName;
    // MIDI
    struct Note { double t, d; int key, vel; };
    std::vector<Note> notes;
    int bank = -1, bankFine = -1, program = -1;
    struct CC { int cc; std::vector<std::pair<double, double>> pts; }; // clip-time beat, value 0-127
    std::vector<CC> ccs;
    double startMarker() const { return loopStart + startRel; }
    // clip time (beats if warped, seconds if not) -> seconds into the sample
    double sampleSec(double ct) const
    {
        if (! warped) return ct;
        if (warp.size() < 2) return warp.empty() ? ct * 0.5 : warp[0].second + (ct - warp[0].first) * 0.5;
        size_t i = 0;
        while (i + 2 < warp.size() && warp[i + 1].first <= ct) ++i;
        const auto& a = warp[i]; const auto& b = warp[i + 1];
        return a.second + (ct - a.first) * (b.second - a.second) / (b.first - a.first);
    }
};

struct Track {
    juce::String name, kind; int id = -1, group = -1, color = -1;
    double gainDb = 0; bool mute = false;
    std::vector<Clip> clips;
    juce::String midiOut; int midiCh = 1;
    std::map<int, int> ccTarget; // automation target id -> CC number
    juce::StringArray devices;
};

struct Project {
    juce::String name, live;
    TempoCurve tempo; std::vector<Meter> meters;
    struct Loc { double beat; juce::String name; };
    std::vector<Loc> locators;
    std::vector<Track> tracks;
    juce::StringArray ignored, warnings, missing;
    double endBeat = 0;
};

juce::StringArray deviceNames(const Xml* chain)
{
    juce::StringArray out;
    auto* devs = path(chain, { "DeviceChain", "Devices" });
    if (! devs) return out;
    for (auto* d : devs->getChildIterator()) {
        juce::String n = val(d, { "UserName" });
        if (n.isEmpty()) n = val(d, { "PluginDesc", "VstPluginInfo", "PlugName" });
        if (n.isEmpty()) n = val(d, { "PluginDesc", "Vst3PluginInfo", "Name" });
        if (n.isEmpty()) n = val(d, { "PluginDesc", "AuPluginInfo", "Name" });
        if (n.isEmpty()) n = d->getTagName();
        out.addIfNotAlreadyThere(n);
    }
    return out;
}

void readClipCommon(const Xml* c, Clip& k)
{
    k.start = num(c, { "CurrentStart" }, c->getDoubleAttribute("Time"));
    k.end = num(c, { "CurrentEnd" }, k.start);
    k.loopStart = num(c, { "Loop", "LoopStart" });
    k.loopEnd = num(c, { "Loop", "LoopEnd" });
    k.startRel = num(c, { "Loop", "StartRelative" });
    k.loopOn = flag(c, { "Loop", "LoopOn" });
    k.disabled = flag(c, { "Disabled" });
}

Project readProject(const Xml& root, const juce::File& als, const Options& opts)
{
    Project P;
    P.name = als.getFileNameWithoutExtension();
    P.live = root.getStringAttribute("Creator", "Ableton Live");
    auto* set = root.getChildByName("LiveSet");
    auto* master = kid(set, "MasterTrack"); if (! master) master = kid(set, "MainTrack");
    auto* mixer = path(master, { "DeviceChain", "Mixer" });
    // tempo + time signature: the master track's values and their automation
    const double bpm0 = num(mixer, { "Tempo", "Manual" }, 120);
    auto targetId = [&](const char* what) { auto* a = path(mixer, { what, "AutomationTarget" }); return a ? a->getIntAttribute("Id", -1) : -1; };
    const int tempoId = targetId("Tempo"), tsTarget = targetId("TimeSignature");
    std::vector<std::pair<double, double>> tev; std::vector<Meter> mev;
    const int ts0 = (int) num(mixer, { "TimeSignature", "Manual" }, 201);
    mev.push_back(meterFrom(0, ts0));
    each(path(master, { "AutomationEnvelopes", "Envelopes" }), "AutomationEnvelope", [&](const Xml* env) {
        const int target = (int) num(env, { "EnvelopeTarget", "PointeeId" }, -2);
        auto* evs = path(env, { "Automation", "Events" });
        if (target == tempoId) each(evs, "FloatEvent", [&](const Xml* e) { tev.push_back({ e->getDoubleAttribute("Time"), e->getDoubleAttribute("Value") }); });
        if (target == tsTarget) each(evs, "EnumEvent", [&](const Xml* e) { const double t = e->getDoubleAttribute("Time"); auto m = meterFrom(std::max(0.0, t), e->getIntAttribute("Value")); if (t <= 0) mev[0] = m; else mev.push_back(m); });
    });
    P.tempo.build(tev, bpm0);
    std::stable_sort(mev.begin(), mev.end(), [](auto& a, auto& b) { return a.beat < b.beat; });
    for (auto& m : mev) if (P.meters.empty() || m.num != P.meters.back().num || m.den != P.meters.back().den) { if (! P.meters.empty() && std::abs(P.meters.back().beat - m.beat) < 1e-9) P.meters.back() = m; else P.meters.push_back(m); }
    // locators
    each(path(set, { "Locators", "Locators" }), "Locator", [&](const Xml* l) { P.locators.push_back({ num(l, { "Time" }), val(l, { "Name" }) }); });
    std::stable_sort(P.locators.begin(), P.locators.end(), [](auto& a, auto& b) { return a.beat < b.beat; });
    // tracks
    Finder finder; finder.projectDir = als.getParentDirectory();
    std::set<juce::String> missing;
    if (auto* tracks = kid(set, "Tracks"))
        for (auto* t : tracks->getChildIterator()) {
            const auto tag = t->getTagName();
            Track T;
            T.id = t->getIntAttribute("Id", -1);
            T.name = val(t, { "Name", "UserName" }); if (T.name.isEmpty()) T.name = val(t, { "Name", "EffectiveName" }, tag);
            T.group = (int) num(t, { "TrackGroupId" }, -1);
            T.color = (int) num(t, { "Color" }, num(t, { "ColorIndex" }, -1));
            const double vol = num(t, { "DeviceChain", "Mixer", "Volume", "Manual" }, 1);
            T.gainDb = vol > 1e-6 ? 20.0 * std::log10(vol) : -96.0;
            T.mute = ! flag(t, { "DeviceChain", "Mixer", "Speaker", "Manual" }, true);
            for (auto& d : deviceNames(kid(t, "DeviceChain"))) T.devices.addIfNotAlreadyThere(d);
            if (tag == "ReturnTrack") { for (auto& d : T.devices) P.ignored.addIfNotAlreadyThere(d + " (return " + T.name + ")"); P.ignored.addIfNotAlreadyThere("Return track " + T.name); continue; }
            if (tag == "GroupTrack") { T.kind = "group"; P.tracks.push_back(T); continue; }
            if (tag == "AudioTrack") {
                T.kind = "audio";
                each(path(t, { "DeviceChain", "MainSequencer", "Sample", "ArrangerAutomation", "Events" }), "AudioClip", [&](const Xml* c) {
                    Clip k; readClipCommon(c, k);
                    k.warped = flag(c, { "IsWarped" }, true);
                    each(kid(c, "WarpMarkers"), "WarpMarker", [&](const Xml* w) { k.warp.push_back({ w->getDoubleAttribute("BeatTime"), w->getDoubleAttribute("SecTime") }); });
                    std::stable_sort(k.warp.begin(), k.warp.end());
                    k.gain = num(c, { "SampleVolume" }, 1);
                    k.fadeIn = num(c, { "Fades", "FadeInLength" }); k.fadeOut = num(c, { "Fades", "FadeOutLength" });
                    k.pitch = (int) num(c, { "PitchCoarse" }) * 100 + (int) num(c, { "PitchFine" });
                    k.file = finder.resolve(path(c, { "SampleRef", "FileRef" }), k.fileName);
                    if (! k.file.existsAsFile() && k.fileName.isNotEmpty()) missing.insert(k.fileName);
                    T.clips.push_back(k);
                });
            } else if (tag == "MidiTrack") {
                T.kind = "midi";
                // CC automation targets: MidiControllers/ControllerTargets.N (N: 0 pitch bend, 1 pressure, 2.. = CC 0..)
                if (auto* mc = path(t, { "DeviceChain", "MainSequencer", "MidiControllers" }))
                    for (auto* x : mc->getChildIterator())
                        if (auto tg = x->getTagName(); tg.startsWith("ControllerTargets.")) {
                            const int n = tg.fromFirstOccurrenceOf(".", false, false).getIntValue();
                            if (n >= 2 && n < 130) T.ccTarget[x->getIntAttribute("Id", -1)] = n - 2;
                        }
                auto* rt = path(t, { "DeviceChain", "MidiOutputRouting" });
                const auto target = val(rt, { "Target" }), upper = val(rt, { "UpperDisplayString" }), lower = val(rt, { "LowerDisplayString" });
                if (! target.containsIgnoreCase("None") && upper.isNotEmpty() && ! upper.equalsIgnoreCase("No Output")) T.midiOut = upper;
                if (lower.containsIgnoreCase("Ch.")) T.midiCh = juce::jlimit(1, 16, lower.fromFirstOccurrenceOf("Ch.", false, true).trim().getIntValue());
                each(path(t, { "DeviceChain", "MainSequencer", "ClipTimeable", "ArrangerAutomation", "Events" }), "MidiClip", [&](const Xml* c) {
                    Clip k; readClipCommon(c, k); k.warped = true;
                    each(path(c, { "Notes", "KeyTracks" }), "KeyTrack", [&](const Xml* kt) {
                        const int key = (int) num(kt, { "MidiKey" }, 60);
                        each(kid(kt, "Notes"), "MidiNoteEvent", [&](const Xml* n) {
                            if (n->hasAttribute("IsEnabled") && ! n->getBoolAttribute("IsEnabled")) return;
                            k.notes.push_back({ n->getDoubleAttribute("Time"), n->getDoubleAttribute("Duration"), key, (int) std::lround(n->getDoubleAttribute("Velocity", 100)) });
                        });
                    });
                    k.bank = (int) num(c, { "BankSelectCoarse" }, -1); k.bankFine = (int) num(c, { "BankSelectFine" }, -1); k.program = (int) num(c, { "ProgramChange" }, -1);
                    each(path(c, { "Envelopes", "Envelopes" }), "ClipEnvelope", [&](const Xml* env) {
                        const int id = (int) num(env, { "EnvelopeTarget", "PointeeId" }, -2);
                        auto it = T.ccTarget.find(id);
                        if (it == T.ccTarget.end()) return;
                        Clip::CC cc { it->second, {} };
                        each(path(env, { "Automation", "Events" }), "FloatEvent", [&](const Xml* e) { cc.pts.push_back({ e->getDoubleAttribute("Time"), e->getDoubleAttribute("Value") }); });
                        if (! cc.pts.empty()) k.ccs.push_back(cc);
                    });
                    T.clips.push_back(k);
                });
            } else continue;
            for (auto& k : T.clips) P.endBeat = std::max(P.endBeat, k.end);
            for (auto& d : T.devices) P.ignored.addIfNotAlreadyThere(d + " (" + T.name + ")");
            P.tracks.push_back(T);
        }
    for (auto& d : deviceNames(kid(master, "DeviceChain"))) P.ignored.addIfNotAlreadyThere(d + " (master)");
    for (auto& m : missing) P.missing.add(m);
    for (auto& l : P.locators) P.endBeat = std::max(P.endBeat, l.beat);
    (void) opts;
    return P;
}

// ---------------------------------------------------------------- one song: [b0, b1) of the arrangement
struct Grid {
    std::vector<double> start; // bar start beats (arrangement), plus the end
    std::vector<std::pair<int, int>> sig;
    int barAt(double beat) const { int k = 0; while (k + 1 < (int) start.size() - 1 && start[(size_t) k + 1] <= beat + 1e-9) ++k; return k; }
};

Grid gridFor(const Project& P, double b0, double b1, juce::StringArray& warn)
{
    Grid g;
    double cur = b0;
    auto meterAt = [&](double b) { Meter m = P.meters.empty() ? Meter { 0, 4, 4 } : P.meters[0]; for (auto& x : P.meters) if (x.beat <= b + 1e-9) m = x; return m; };
    for (int guard = 0; cur < b1 - 1e-9 && guard < 20000; ++guard) {
        const auto m = meterAt(cur);
        double q = m.num * 4.0 / m.den;
        int num = m.num, den = m.den;
        for (auto& x : P.meters)
            if (x.beat > cur + 1e-9 && x.beat < cur + q - 1e-9) { // a meter change inside the bar: a short bar up to it
                const double len = x.beat - cur;
                for (int d : { den, 8, 16, 32 }) if (std::abs(len * d / 4.0 - std::round(len * d / 4.0)) < 1e-6) { den = d; num = (int) std::lround(len * d / 4.0); break; }
                q = len;
                warn.addIfNotAlreadyThere("A meter change in Live falls inside a bar; set.Line starts a short bar there.");
                break;
            }
        g.start.push_back(cur); g.sig.push_back({ num, den });
        cur += q;
    }
    g.start.push_back(cur);
    return g;
}

struct SongSpec { juce::String name; double b0, b1; struct Sec { double beat; juce::String name; bool loop; }; std::vector<Sec> secs; };

juce::var makeSong(const Project& P, const SongSpec& sp, const Options& opts)
{
    juce::StringArray warn;
    const Grid g = gridFor(P, sp.b0, sp.b1, warn);
    const int bars = (int) g.sig.size();
    const double s0 = P.tempo.sec(sp.b0);
    auto secOf = [&](double beat) { return P.tempo.sec(beat) - s0; };
    // tempo map: one BPM per bar, so every bar line is where Live has it (ramps become steps, bar by bar)
    juce::Array<juce::var> tmap;
    double lastBpm = -1; std::pair<int, int> lastSig { 0, 0 };
    for (int k = 0; k < bars; ++k) {
        const double q = g.start[(size_t) k + 1] - g.start[(size_t) k], dur = P.tempo.sec(g.start[(size_t) k + 1]) - P.tempo.sec(g.start[(size_t) k]);
        const double bpm = dur > 0 ? q * 60.0 / dur : 120.0;
        if (std::abs(bpm - lastBpm) > 1e-7 || g.sig[(size_t) k] != lastSig) {
            juce::Array<juce::var> sg; sg.add(g.sig[(size_t) k].first); sg.add(g.sig[(size_t) k].second);
            tmap.add(obj({ { "bar", k + 1 }, { "bpm", bpm }, { "sig", sg } }));
            lastBpm = bpm; lastSig = g.sig[(size_t) k];
        }
    }
    if (P.tempo.ramps()) warn.addIfNotAlreadyThere("Tempo ramps come in bar by bar (each bar at its average tempo, bar lines exactly where Live has them).");
    // sections
    juce::Array<juce::var> secs;
    for (size_t i = 0; i < sp.secs.size(); ++i) {
        const auto& s = sp.secs[i];
        int k = g.barAt(s.beat);
        if (k + 1 < (int) g.start.size() - 1 && std::abs(g.start[(size_t) k + 1] - s.beat) < std::abs(g.start[(size_t) k] - s.beat)) ++k;
        if (std::abs(g.start[(size_t) k] - s.beat) > 1e-3) warn.addIfNotAlreadyThere("Locator \"" + s.name + "\" isn't on a bar line; its section starts on the nearest bar.");
        int end = bars;
        if (i + 1 < sp.secs.size()) { int e = g.barAt(sp.secs[i + 1].beat); if (e + 1 < (int) g.start.size() - 1 && std::abs(g.start[(size_t) e + 1] - sp.secs[i + 1].beat) < std::abs(g.start[(size_t) e] - sp.secs[i + 1].beat)) ++e; end = e; }
        if (end <= k) continue;
        secs.add(obj({ { "name", s.name }, { "type", sectionType(s.name) }, { "start", k + 1 }, { "bars", end - k }, { "end", s.loop ? "loop" : "continue" } }));
    }
    // tracks: group names as a prefix; a track's group mute / volume carried down
    std::map<int, const Track*> byId; for (auto& t : P.tracks) byId[t.id] = &t;
    auto prefix = [&](const Track& t, double& gain, bool& mute) {
        juce::StringArray chain; int gid = t.group;
        for (int guard = 0; gid >= 0 && byId.count(gid) && guard < 16; ++guard) { const auto* G = byId[gid]; chain.insert(0, G->name); gain += G->gainDb; mute |= G->mute; gid = G->group; }
        chain.add(t.name); return chain.joinIntoString(" / ");
    };
    auto barBeat = [&](double beat, int& bar, double& bt) { const int k = g.barAt(beat); bar = k + 1; bt = 1.0 + (beat - g.start[(size_t) k]) * g.sig[(size_t) k].second / 4.0; };
    juce::Array<juce::var> tracks;
    int nAudio = 0, nMidi = 0;
    std::set<juce::String> used;
    auto uniq = [&](juce::String n) { const auto b = n; for (int k = 2; used.count(n.toLowerCase()); ++k) n = b + " (" + juce::String(k) + ")"; used.insert(n.toLowerCase()); return n; };
    for (auto& t : P.tracks) {
        if (t.kind == "group") continue;
        double gain = t.gainDb; bool mute = t.mute;
        const auto name = prefix(t, gain, mute);
        if (t.kind == "audio") {
            // clips by file (a set.Line track plays one file): "Vox", "Vox (2)" when a track uses several
            std::vector<juce::String> order; std::map<juce::String, juce::Array<juce::var>> byFile; std::map<juce::String, const Clip*> firstOf;
            std::map<juce::String, bool> stretched;
            for (auto& k : t.clips) {
                if (k.end <= sp.b0 + 1e-9 || k.start >= sp.b1 - 1e-9) continue;
                const juce::String key = k.file.existsAsFile() ? k.file.getFullPathName() : "missing:" + k.fileName;
                if (! byFile.count(key)) { order.push_back(key); firstOf[key] = &k; }
                // segments: [arrangement beat a, b) playing from clip time ct
                struct Seg { double a, b, ct; };
                std::vector<Seg> segs;
                const double sm = k.startMarker();
                auto arrBeatsFor = [&](double fromBeat, double clipLen) { // clip-time length -> arrangement beats
                    if (k.warped) return clipLen;
                    return P.tempo.beatAt(P.tempo.sec(fromBeat) + clipLen) - fromBeat;
                };
                if (! k.loopOn) segs.push_back({ k.start, k.end, sm });
                else {
                    double a = k.start, ct = sm;
                    for (int guard = 0; a < k.end - 1e-9 && guard < 10000; ++guard) {
                        const double len = std::max(1e-6, k.loopEnd - ct), b = std::min(k.end, a + arrBeatsFor(a, len));
                        segs.push_back({ a, b, ct }); a = b; ct = k.loopStart;
                    }
                }
                // stretch: the sample's seconds per arrangement second must be 1 (set.Line never stretches)
                bool str = false;
                if (k.warped)
                    for (auto& s : segs) {
                        const int steps = 8;
                        for (int i = 0; i < steps && ! str; ++i) {
                            const double x0 = s.a + (s.b - s.a) * i / steps, x1 = s.a + (s.b - s.a) * (i + 1) / steps;
                            const double arr = P.tempo.sec(x1) - P.tempo.sec(x0), smp = k.sampleSec(s.ct + (x1 - s.a)) - k.sampleSec(s.ct + (x0 - s.a));
                            if (arr > 1e-6 && std::abs(smp / arr - 1.0) > 0.002) str = true;
                        }
                    }
                if (k.pitch != 0) str = true;
                stretched[key] = stretched[key] || str;
                for (size_t i = 0; i < segs.size(); ++i) {
                    auto s = segs[i];
                    double ct = s.ct;
                    if (s.a < sp.b0) { ct += k.warped ? sp.b0 - s.a : P.tempo.sec(sp.b0) - P.tempo.sec(s.a); s.a = sp.b0; }
                    s.b = std::min(s.b, sp.b1);
                    if (s.b <= s.a + 1e-9) continue;
                    const double st = secOf(s.a), en = secOf(s.b);
                    const double fi = i == 0 && s.a == std::max(k.start, sp.b0) ? std::max(0.0, secOf(s.a + k.fadeIn) - st) : 0.0;
                    const double fo = i + 1 == segs.size() ? std::max(0.0, en - secOf(s.b - k.fadeOut)) : 0.0;
                    auto c = obj({ { "start", st }, { "end", en }, { "off", std::max(0.0, k.sampleSec(ct)) }, { "gain", k.gain > 1e-6 ? 20.0 * std::log10(k.gain) : -96.0 }, { "fi", fi }, { "fo", fo } });
                    if (k.disabled) c.getDynamicObject()->setProperty("mute", true);
                    byFile[key].add(c);
                }
            }
            for (size_t i = 0; i < order.size(); ++i) {
                const auto& key = order[i]; const Clip* k = firstOf[key];
                const bool found = k->file.existsAsFile();
                auto tr = obj({ { "name", uniq(i == 0 ? name : name + " (" + juce::String((int) i + 1) + ")") }, { "kind", "audio" }, { "col", colourFor(t.color) }, { "gainDb", gain }, { "mute", mute },
                                { "file", obj({ { "path", found ? k->file.getFullPathName() : juce::String() }, { "name", k->fileName }, { "found", found }, { "bytes", found ? (double) k->file.getSize() : 0.0 } }) },
                                { "clips", byFile[key] }, { "stretched", stretched[key] }, { "source", t.name } });
                if (stretched[key]) warn.addIfNotAlreadyThere("\"" + name + "\": a clip was time-stretched in Ableton. Bounce/export it at the song's tempo and replace the file.");
                if (! found) warn.addIfNotAlreadyThere("\"" + name + "\": " + k->fileName + " is missing.");
                tracks.add(tr); ++nAudio;
            }
        } else if (t.kind == "midi") {
            juce::Array<juce::var> evs;
            bool any = false;
            for (auto& k : t.clips) {
                if (k.disabled || k.end <= sp.b0 + 1e-9 || k.start >= sp.b1 - 1e-9) continue;
                any = true;
                const double sm = k.startMarker(), a0 = std::max(k.start, sp.b0), a1 = std::min(k.end, sp.b1);
                if (k.program >= 0 && k.start >= sp.b0 - 1e-9) { // Bank Select + Program Change at the clip's start
                    int bar; double bt; barBeat(k.start, bar, bt);
                    auto e = obj({ { "kind", "pc" }, { "bar", bar }, { "beat", bt }, { "pc", juce::jlimit(0, 127, k.program) } });
                    if (k.bank >= 0) e.getDynamicObject()->setProperty("msb", juce::jlimit(0, 127, k.bank));
                    if (k.bankFine >= 0) e.getDynamicObject()->setProperty("lsb", juce::jlimit(0, 127, k.bankFine));
                    evs.add(e);
                }
                // clip time -> arrangement beats, looped
                auto place = [&](double ct, std::function<void(double)> at) {
                    if (! k.loopOn) { const double ab = k.start + (ct - sm); if (ct >= sm - 1e-9 && ab >= a0 - 1e-9 && ab < a1 - 1e-9) at(ab); return; }
                    const double L = k.loopEnd - k.loopStart; if (L <= 1e-9) return;
                    double first = k.start + (ct - sm);
                    if (ct < sm - 1e-9 || ct >= k.loopEnd - 1e-9) { if (ct < k.loopStart - 1e-9 || ct >= k.loopEnd - 1e-9) return; first = k.start + (k.loopEnd - sm) + (ct - k.loopStart); }
                    for (double ab = first; ab < a1 - 1e-9; ab += L) if (ab >= a0 - 1e-9) at(ab);
                };
                for (auto& n : k.notes)
                    place(n.t, [&](double ab) { int bar; double bt; barBeat(ab, bar, bt); evs.add(obj({ { "kind", "note" }, { "bar", bar }, { "beat", bt }, { "note", juce::jlimit(0, 127, n.key) }, { "vel", juce::jlimit(1, 127, n.vel) }, { "len", std::max(0.01, n.d * g.sig[(size_t) (bar - 1)].second / 4.0) } })); });
                for (auto& cc : k.ccs) {
                    // each point, and 16ths along a ramp between two points
                    std::vector<std::pair<double, double>> pts;
                    for (size_t i = 0; i < cc.pts.size(); ++i) {
                        const auto [t0, v0] = cc.pts[i]; pts.push_back({ std::max(t0, 0.0), v0 });
                        if (i + 1 < cc.pts.size()) { const auto [t1, v1] = cc.pts[i + 1]; if (t1 > t0 && std::lround(v1) != std::lround(v0)) for (double x = std::max(0.0, t0) + 0.25; x < t1 - 1e-9; x += 0.25) pts.push_back({ x, v0 + (v1 - v0) * (x - t0) / (t1 - t0) }); }
                    }
                    int last = -1;
                    for (auto& [ct, v] : pts) {
                        const int iv = juce::jlimit(0, 127, (int) std::lround(v));
                        if (iv == last) continue; last = iv;
                        place(ct, [&](double ab) { int bar; double bt; barBeat(ab, bar, bt); evs.add(obj({ { "kind", "cc" }, { "bar", bar }, { "beat", bt }, { "cc", cc.cc }, { "val", iv } })); });
                    }
                }
            }
            if (! any) continue;
            juce::String port;
            if (t.midiOut.isNotEmpty())
                for (auto& p : opts.midiPorts) if (p.containsIgnoreCase(t.midiOut) || t.midiOut.containsIgnoreCase(p) || p.removeCharacters(" ()").containsIgnoreCase(t.midiOut.removeCharacters(" ()"))) { port = p; break; }
            if (port.isEmpty()) warn.addIfNotAlreadyThere("MIDI track \"" + name + "\": " + (t.midiOut.isNotEmpty() ? "its output \"" + t.midiOut + "\" isn't a MIDI port here" : juce::String("it has no MIDI output in Live")) + "; choose a port on its header.");
            tracks.add(obj({ { "name", uniq(name) }, { "kind", "midi" }, { "col", colourFor(t.color) }, { "mute", mute }, { "midi", obj({ { "port", port }, { "wanted", t.midiOut }, { "ch", t.midiCh }, { "events", evs } }) }, { "source", t.name } }));
            ++nMidi;
        }
    }
    juce::Array<juce::var> w; for (auto& x : warn) w.add(x);
    return obj({ { "name", sp.name }, { "startBeat", sp.b0 }, { "endBeat", sp.b1 }, { "seconds", secOf(sp.b1) }, { "total", bars }, { "tmap", tmap }, { "secs", secs },
                 { "tracks", tracks }, { "audioTracks", nAudio }, { "midiTracks", nMidi }, { "warnings", w } });
}

// ---------------------------------------------------------------- songs from locators
std::vector<SongSpec> splitSongs(const Project& P, juce::String mode, juce::String& used)
{
    std::vector<SongSpec> out;
    const double end = std::max(P.endBeat, 1.0);
    auto isAbleSet = [&] {
        for (auto& l : P.locators) {
            const auto n = l.name.trim(), u = stripLocator(n).toUpperCase();
            if (n.startsWithChar('>') || u == "STOP" || u == "AUTOSTOP" || u == "SONG END") return true;
        }
        return false;
    };
    if (mode == "auto") mode = isAbleSet() ? "ableset" : "single";
    used = mode;
    if (mode == "single" || P.locators.empty()) {
        SongSpec s { P.name, 0, end, {} };
        for (auto& l : P.locators) { juce::StringArray f; const auto n = stripLocator(l.name.trim().trimCharactersAtStart(">+").trim(), &f); if (n.isNotEmpty() && ! l.name.trim().startsWithChar('*')) s.secs.push_back({ l.beat, n, f.contains("LOOP") || f.contains("LOOPFULL") }); }
        if (s.secs.empty() || s.secs.front().beat > 1e-6) { /* bars before the first locator have no section */ }
        out.push_back(s);
        return out;
    }
    if (mode == "each") {
        for (size_t i = 0; i < P.locators.size(); ++i) {
            const auto n = stripLocator(P.locators[i].name.trim());
            if (n.isEmpty() || P.locators[i].name.trim().startsWithChar('*')) continue;
            out.push_back({ n, P.locators[i].beat, i + 1 < P.locators.size() ? P.locators[i + 1].beat : end, {} });
        }
        return out;
    }
    if (mode == "plus") {
        for (auto& l : P.locators) {
            const auto raw = l.name.trim();
            if (raw.startsWithChar('+')) { if (! out.empty()) out.back().b1 = l.beat; out.push_back({ stripLocator(raw.substring(1)), l.beat, end, {} }); }
            else if (! out.empty() && raw.isNotEmpty() && ! raw.startsWithChar('*')) { juce::StringArray f; out.back().secs.push_back({ l.beat, stripLocator(raw, &f), f.contains("LOOP") || f.contains("LOOPFULL") }); }
        }
        return out;
    }
    // AbleSet (ableset.com/docs/locator-notation): a plain locator starts a song; "> Name" / ">> Name" a section
    // ("Intro >>> Verse": the part before >>>); "SONG END", "STOP" / "AUTOSTOP" end it; "*" and ClyphX "[...]"
    // locators are ignored; "[nosong]" marks a part that isn't a song; "{...}", "#tags", "+FLAGS" aren't part of the
    // name (+LOOP makes a looping section).
    bool open = false;
    for (auto& l : P.locators) {
        const auto raw = l.name.trim();
        if (raw.isEmpty() || raw.startsWithChar('*') || raw.startsWithChar('[')) continue;
        juce::StringArray f; bool nosong = false;
        if (raw.startsWithChar('>')) {
            if (! open) continue;
            auto n = raw.trimCharactersAtStart(">").trim();
            if (n.contains(">>>")) n = n.upToFirstOccurrenceOf(">>>", false, false).trim();
            out.back().secs.push_back({ l.beat, stripLocator(n, &f), f.contains("LOOP") || f.contains("LOOPFULL") });
            continue;
        }
        const auto n = stripLocator(raw.startsWithChar('.') ? raw.substring(1) : raw, &f, &nosong), u = n.toUpperCase();
        if (u == "STOP" || u == "AUTOSTOP" || u == "SONG END") { if (open) { out.back().b1 = l.beat; open = false; } continue; }
        if (open) out.back().b1 = l.beat;
        if (nosong || n.isEmpty()) { open = false; continue; }
        out.push_back({ n, l.beat, end, {} }); open = true;
    }
    return out;
}

} // namespace

juce::var read(const juce::File& als, const Options& opts, juce::String& error)
{
    auto x = loadXml(als, error);
    if (! x) return {};
    const auto P = readProject(*x, als, opts);
    juce::String used;
    const auto specs = splitSongs(P, opts.mode, used);
    juce::Array<juce::var> songs;
    for (auto& s : specs) if (s.b1 > s.b0 + 1e-6) songs.add(makeSong(P, s, opts));
    juce::Array<juce::var> ig, miss, warn;
    for (auto& s : P.ignored) ig.add(s);
    for (auto& s : P.missing) miss.add(s);
    for (auto& s : P.warnings) warn.add(s);
    return obj({ { "project", P.name }, { "live", P.live }, { "mode", used }, { "songs", songs }, { "ignored", ig }, { "missing", miss }, { "warnings", warn }, { "path", als.getFullPathName() } });
}

juce::var locate(const juce::File& folder, const juce::StringArray& names)
{
    auto* o = new juce::DynamicObject();
    std::map<juce::String, juce::String> want;
    for (auto& n : names) want[n.toLowerCase()] = n;
    if (folder.isDirectory())
        for (const auto& e : juce::RangedDirectoryIterator(folder, true, "*", juce::File::findFiles)) {
            auto it = want.find(e.getFile().getFileName().toLowerCase());
            if (it != want.end() && ! o->hasProperty(it->second)) o->setProperty(it->second, e.getFile().getFullPathName());
        }
    return juce::var(o);
}

} // namespace setline::gui::ableton
