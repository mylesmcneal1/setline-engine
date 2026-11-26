// 7b: --ableton-test. Writes small synthetic Live Sets (gzipped XML, the way Live saves them) with tiny WAVs, imports
// them with ableton::read and checks the result against the numbers worked out by hand from the fixture.
#include "AbletonImport.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>

namespace setline::gui::ableton {

namespace {

juce::String V(const char* tag, const juce::String& v) { return "<" + juce::String(tag) + " Value=\"" + v + "\" />"; }
juce::String V(const char* tag, double v) { return V(tag, juce::String(v, 6)); }

void wav(const juce::File& f, double seconds)
{
    f.getParentDirectory().createDirectory();
    f.deleteFile();
    juce::WavAudioFormat fmt;
    std::unique_ptr<juce::OutputStream> os = f.createOutputStream();
    const auto opts = juce::AudioFormatWriterOptions {}.withSampleRate(48000).withNumChannels(1).withBitsPerSample(16);
    if (auto w = fmt.createWriterFor(os, opts)) {
        juce::AudioBuffer<float> b(1, (int) (seconds * 48000)); b.clear();
        for (int i = 0; i < b.getNumSamples(); ++i) b.setSample(0, i, 0.1f * (float) std::sin(i * 0.05));
        w->writeFromAudioSampleBuffer(b, 0, b.getNumSamples());
    }
}

void als(const juce::File& f, const juce::String& liveSet, const juce::String& creator = "Ableton Live 11.3.13")
{
    f.getParentDirectory().createDirectory();
    f.deleteFile();
    const juce::String xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Ableton MajorVersion=\"5\" MinorVersion=\"11.0_433\" Creator=\"" + creator + "\" Revision=\"x\">\n<LiveSet>\n" + liveSet + "\n</LiveSet>\n</Ableton>\n";
    juce::FileOutputStream fo(f);
    juce::GZIPCompressorOutputStream gz(fo, 6, juce::GZIPCompressorOutputStream::windowBitsGZIP);
    gz.write(xml.toRawUTF8(), xml.getNumBytesAsUTF8());
    gz.flush();
}

// a master track with tempo / time signature automation: tempo [(beat, bpm)], meters [(beat, num, den)]
juce::String master(double bpm0, std::vector<std::pair<double, double>> tempo, std::vector<std::tuple<double, int, int>> meters)
{
    auto ts = [](int n, int d) { int k = 0; while ((1 << k) < d) ++k; return (n - 1) + 99 * k; };
    juce::String te = "<FloatEvent Id=\"1\" Time=\"-63072000\" Value=\"" + juce::String(bpm0, 14) + "\" />";
    int id = 2;
    for (auto& [b, v] : tempo) te += "<FloatEvent Id=\"" + juce::String(id++) + "\" Time=\"" + juce::String(b) + "\" Value=\"" + juce::String(v, 14) + "\" />";
    juce::String me;
    for (auto& [b, n, d] : meters) me += "<EnumEvent Id=\"" + juce::String(id++) + "\" Time=\"" + juce::String(b > 0 ? b : -63072000.0) + "\" Value=\"" + juce::String(ts(n, d)) + "\" />";
    return "<MasterTrack><DeviceChain><Mixer>"
           "<Tempo><Manual Value=\"" + juce::String(bpm0, 14) + "\" /><AutomationTarget Id=\"8\" /></Tempo>"
           "<TimeSignature><Manual Value=\"201\" /><AutomationTarget Id=\"9\" /></TimeSignature>"
           "</Mixer><DeviceChain><Devices><Limiter Id=\"0\" /></Devices></DeviceChain></DeviceChain>"
           "<AutomationEnvelopes><Envelopes>"
           "<AutomationEnvelope Id=\"0\"><EnvelopeTarget><PointeeId Value=\"8\" /></EnvelopeTarget><Automation><Events>" + te + "</Events></Automation></AutomationEnvelope>"
           "<AutomationEnvelope Id=\"1\"><EnvelopeTarget><PointeeId Value=\"9\" /></EnvelopeTarget><Automation><Events>" + me + "</Events></Automation></AutomationEnvelope>"
           "</Envelopes></AutomationEnvelopes></MasterTrack>";
}

juce::String locators(std::vector<std::pair<double, juce::String>> l)
{
    juce::String s = "<Locators><Locators>";
    int id = 0;
    for (auto& [b, n] : l) s += "<Locator Id=\"" + juce::String(id++) + "\">" + V("Time", b) + V("Name", n) + "</Locator>";
    return s + "</Locators></Locators>";
}

struct AClip { double start, end, loopStart = 0, startRel = 0, loopEnd = 0; bool loop = false, warped = false; std::vector<std::pair<double, double>> warp; double vol = 1, fi = 0, fo = 0; juce::String rel, abs, name; bool live10 = false; };

juce::String audioClip(const AClip& c, int id)
{
    juce::String wm;
    int k = 0;
    for (auto& [b, s] : c.warp) wm += "<WarpMarker Id=\"" + juce::String(k++) + "\" SecTime=\"" + juce::String(s, 6) + "\" BeatTime=\"" + juce::String(b, 6) + "\" />";
    juce::String ref;
    if (c.live10) {
        juce::StringArray parts; parts.addTokens(c.rel, "/", ""); const auto name = parts[parts.size() - 1]; parts.remove(parts.size() - 1);
        juce::String els; int e = 0; for (auto& p : parts) els += "<RelativePathElement Id=\"" + juce::String(e++) + "\" Dir=\"" + p + "\" />";
        ref = "<FileRef><HasRelativePath Value=\"true\" /><RelativePathType Value=\"3\" /><RelativePath>" + els + "</RelativePath>" + V("Name", name) + "</FileRef>";
    } else ref = "<FileRef>" + V("RelativePathType", "3") + V("RelativePath", c.rel) + V("Path", c.abs) + "</FileRef>";
    return "<AudioClip Id=\"" + juce::String(id) + "\" Time=\"" + juce::String(c.start) + "\">" + V("CurrentStart", c.start) + V("CurrentEnd", c.end)
           + "<Loop>" + V("LoopStart", c.loopStart) + V("LoopEnd", c.loopEnd > 0 ? c.loopEnd : c.loopStart + 1000) + V("StartRelative", c.startRel) + V("LoopOn", c.loop ? "true" : "false") + "</Loop>"
           + V("Name", c.name) + V("Disabled", "false") + V("IsWarped", c.warped ? "true" : "false") + "<WarpMarkers>" + wm + "</WarpMarkers>"
           + "<SampleRef>" + ref + "</SampleRef>" + V("SampleVolume", c.vol) + "<Fades>" + V("FadeInLength", c.fi) + V("FadeOutLength", c.fo) + "</Fades></AudioClip>";
}

juce::String audioTrack(int id, const juce::String& name, int color, double vol, std::vector<AClip> clips, int group = -1, bool on = true)
{
    juce::String cl; int k = 0;
    for (auto& c : clips) cl += audioClip(c, k++);
    return "<AudioTrack Id=\"" + juce::String(id) + "\">" + V("TrackGroupId", juce::String(group)) + "<Name>" + V("EffectiveName", name) + V("UserName", name) + "</Name>" + V("Color", juce::String(color))
           + "<DeviceChain><Mixer><Volume>" + V("Manual", vol) + "</Volume><Speaker>" + V("Manual", on ? "true" : "false") + "</Speaker></Mixer>"
           + "<MainSequencer><Sample><ArrangerAutomation><Events>" + cl + "</Events></ArrangerAutomation></Sample></MainSequencer>"
           + "<DeviceChain><Devices><PluginDevice Id=\"0\"><PluginDesc><VstPluginInfo Id=\"0\">" + V("PlugName", "FabFilter Pro-Q 3") + "</VstPluginInfo></PluginDesc></PluginDevice></Devices></DeviceChain></DeviceChain></AudioTrack>";
}

juce::var findTrack(const juce::var& song, const juce::String& name) { if (auto* a = song["tracks"].getArray()) for (auto& t : *a) if (t["name"].toString() == name) return t; return {}; }
// bar start seconds from a set.Line tempo map (bpm per quarter note, as the engine plays it)
double barStart(const juce::var& tmap, int bar)
{
    double t = 0, bpm = 120; int num = 4, den = 4; size_t i = 0;
    auto* a = tmap.getArray();
    for (int b = 1; b < bar; ++b) {
        while (a && (int) i < a->size() && (int) (*a)[(int) i]["bar"] <= b) { bpm = (*a)[(int) i]["bpm"]; num = (*a)[(int) i]["sig"][0]; den = (*a)[(int) i]["sig"][1]; ++i; }
        t += num * 4.0 / den * 60.0 / bpm;
    }
    return t;
}
juce::String sigAt(const juce::var& tmap, int bar) { juce::String s = "4/4"; if (auto* a = tmap.getArray()) for (auto& e : *a) if ((int) e["bar"] <= bar) s = e["sig"][0].toString() + "/" + e["sig"][1].toString(); return s; }

} // namespace

juce::StringArray selfTest(const juce::File& dir)
{
    juce::StringArray out;
    bool ok = true;
    auto check = [&](bool c, const juce::String& what) { out.add((c ? "ok   " : "FAIL ") + what); ok = ok && c; };
    auto near = [](double a, double b, double tol = 1e-6) { return std::abs(a - b) <= tol; };
    dir.deleteRecursively();
    // ---- A: one song, tempo step + ramp, meter changes, clips, a group, a missing sample in a sibling folder, MIDI
    const auto projA = dir.getChildFile("Song A Project");
    wav(projA.getChildFile("Samples/Imported/drums.wav"), 12);
    wav(projA.getChildFile("Samples/Imported/pad.wav"), 6);
    wav(projA.getChildFile("Samples/Recorded/stretchy.wav"), 6);
    wav(projA.getChildFile("Samples/Imported/bgv.wav"), 4);
    wav(dir.getChildFile("Bounces/vox.wav"), 5); // not where the project says: found beside it
    {
        juce::String t;
        t += "<GroupTrack Id=\"50\">" + V("TrackGroupId", "-1") + "<Name>" + V("EffectiveName", "Vox") + V("UserName", "Vox") + "</Name>" + V("Color", "8") + "<DeviceChain><Mixer><Volume>" + V("Manual", 1.0) + "</Volume><Speaker>" + V("Manual", "true") + "</Speaker></Mixer></DeviceChain></GroupTrack>";
        t += audioTrack(1, "Drums", 0, 0.5, { { 4, 20, 0.5, 0, 0, false, false, {}, 0.5, 1, 2, "Samples/Imported/drums.wav", "C:/nowhere/drums.wav", "drums" } });
        t += audioTrack(2, "Pad", 6, 1.0, { { 0, 8, 0, 0, 0, false, true, { { 0, 0 }, { 8, 4 } }, 1, 1, 0.5, "Samples/Imported/pad.wav", "", "pad" } });
        t += audioTrack(3, "Stretchy", 6, 1.0, { { 0, 8, 0, 0, 0, false, true, { { 0, 0 }, { 8, 5 } }, 1, 0, 0, "Samples/Recorded/stretchy.wav", "", "stretchy" } });
        t += audioTrack(4, "Lead", 12, 1.0, { { 16, 24, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/vox.wav", "", "vox" } });
        t += audioTrack(8, "Bass", 1, 1.0, { { 0, 78, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/drums.wav", "", "bass" } });
        t += audioTrack(5, "BGV 1", 3, 1.0, { { 32, 40, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/bgv.wav", "", "bgv", true } }, 50);
        t += "<MidiTrack Id=\"6\">" + V("TrackGroupId", "-1") + "<Name>" + V("EffectiveName", "Guitar rig") + V("UserName", "Guitar rig") + "</Name>" + V("Color", "16")
             + "<DeviceChain><Mixer><Volume>" + V("Manual", 1.0) + "</Volume><Speaker>" + V("Manual", "true") + "</Speaker></Mixer>"
             + "<MidiOutputRouting>" + V("Target", "MidiOut/External.All/-1") + V("UpperDisplayString", "loopMIDI Port") + V("LowerDisplayString", "Ch. 3") + "</MidiOutputRouting>"
             + "<MainSequencer><MidiControllers><ControllerTargets.0 Id=\"700\" /><ControllerTargets.9 Id=\"907\" /></MidiControllers>"
             + "<ClipTimeable><ArrangerAutomation><Events><MidiClip Id=\"0\" Time=\"16\">" + V("CurrentStart", 16.0) + V("CurrentEnd", 32.0)
             + "<Loop>" + V("LoopStart", 0.0) + V("LoopEnd", 16.0) + V("StartRelative", 0.0) + V("LoopOn", "false") + "</Loop>" + V("Disabled", "false")
             + "<Notes><KeyTracks><KeyTrack Id=\"0\"><Notes><MidiNoteEvent Time=\"0\" Duration=\"1\" Velocity=\"100\" OffVelocity=\"64\" IsEnabled=\"true\" /><MidiNoteEvent Time=\"2\" Duration=\"0.5\" Velocity=\"90\" OffVelocity=\"64\" IsEnabled=\"true\" /></Notes>" + V("MidiKey", "60") + "</KeyTrack></KeyTracks></Notes>"
             + V("BankSelectCoarse", "1") + V("BankSelectFine", "-1") + V("ProgramChange", "4")
             + "<Envelopes><Envelopes><ClipEnvelope Id=\"0\"><EnvelopeTarget>" + V("PointeeId", "907") + "</EnvelopeTarget><Automation><Events><FloatEvent Id=\"0\" Time=\"0\" Value=\"0\" /><FloatEvent Id=\"1\" Time=\"4\" Value=\"127\" /></Events></Automation></ClipEnvelope></Envelopes></Envelopes>"
             + "</MidiClip></Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain></MidiTrack>";
        t += "<ReturnTrack Id=\"7\"><Name>" + V("EffectiveName", "A-Reverb") + V("UserName", "A-Reverb") + "</Name><DeviceChain><DeviceChain><Devices><Reverb Id=\"0\" /></Devices></DeviceChain></DeviceChain></ReturnTrack>";
        // 120 to beat 16 (bar 5), a step to 100, a ramp 100 -> 140 over beats 32-48 (bars 9-12), then 140;
        // 3/4 at beat 64 (bar 17) for two bars, 4/4 again at beat 70 (bar 19); the arrangement ends at beat 78
        const auto set = "<Tracks>" + t + "</Tracks>" + master(120, { { 16, 120 }, { 16, 100 }, { 32, 100 }, { 48, 140 } }, { { 0, 4, 4 }, { 64, 3, 4 }, { 70, 4, 4 } })
                         + locators({ { 0, "Intro" }, { 16, "Verse 1" }, { 32, "Chorus" }, { 64, "Weird Part" }, { 70, "Outro" } })
;
        als(projA.getChildFile("Song A.als"), set);
    }
    Options oa; oa.midiPorts = { "Microsoft GS Wavetable Synth", "loopMIDI Port" };
    juce::String err;
    const auto A = read(projA.getChildFile("Song A.als"), oa, err);
    check(err.isEmpty() && A["songs"].size() == 1 && A["mode"].toString() == "single", "A: one song per project (no AbleSet locators): " + juce::String(A["songs"].size()) + " song, mode " + A["mode"].toString() + (err.isNotEmpty() ? ", " + err : juce::String()));
    const auto a = A["songs"][0];
    const auto tm = a["tmap"];
    // Live's own times: 0-16 at 120 = 8 s; 16-32 at 100 = 9.6 s; the ramp 100->140 over 16 beats = 60*16/40*ln(1.4) s
    const double t32 = 17.6, t48 = t32 + 24.0 * std::log(1.4), t64 = t48 + 60.0 * 16 / 140;
    check(a["name"].toString() == "Song A", "A: the project name is the song name");
    check(near(barStart(tm, 5), 8.0) && near(barStart(tm, 9), t32) && near(barStart(tm, 13), t48) && near(barStart(tm, 17), t64),
          "A: tempo map: bar lines exactly where Live has them through the step and the ramp (bar 13 at " + juce::String(barStart(tm, 13), 6) + " s, Live " + juce::String(t48, 6) + " s)");
    check(near((double) tm[0]["bpm"], 120) && (int) tm[1]["bar"] == 5 && near((double) tm[1]["bpm"], 100), "A: tempo 120, then 100 from bar 5");
    check(sigAt(tm, 16) == "4/4" && sigAt(tm, 17) == "3/4" && sigAt(tm, 18) == "3/4" && sigAt(tm, 19) == "4/4", "A: meter 3/4 at bars 17-18, 4/4 again at 19");
    const auto secs = a["secs"];
    auto secIs = [&](int i, const char* name, const char* type, int start, int bars) { return secs[i]["name"].toString() == name && secs[i]["type"].toString() == type && (int) secs[i]["start"] == start && (int) secs[i]["bars"] == bars; };
    check(secs.size() == 5 && secIs(0, "Intro", "intro", 1, 4) && secIs(1, "Verse 1", "verse", 5, 4) && secIs(2, "Chorus", "chorus", 9, 8) && secIs(3, "Weird Part", "other", 17, 2) && secIs(4, "Outro", "outro", 19, 2),
          "A: locators -> sections (Intro 1+4, Verse 1 5+4, Chorus 9+8, Weird Part (Other) 17+2, Outro 19+2): " + juce::JSON::toString(secs, true).substring(0, 300));
    const auto dr = findTrack(a, "Drums"), dc = dr["clips"][0];
    check(dr.isObject() && dr["file"]["found"] && near((double) dc["start"], 2.0) && near((double) dc["end"], 8.0 + 4 * 0.6) && near((double) dc["off"], 0.5) && near((double) dc["gain"], 20 * std::log10(0.5), 1e-4)
              && near((double) dc["fi"], 1.0) && near((double) dc["fo"], 2.0) && near((double) dr["gainDb"], 20 * std::log10(0.5), 1e-4),
          "A: audio clip with an offset, gain and fades (2.0-10.4 s, from 0.5 s in, -6 dB; unwarped, so its fades are seconds: 1 / 2 s); the track volume as a trim: " + juce::JSON::toString(dc, true));
    const auto pdc = findTrack(a, "Pad")["clips"][0];
    check(near((double) pdc["fi"], 0.5) && near((double) pdc["fo"], 0.25), "A: a warped clip's fades are beats (1 / 0.5 beat at 120 = 0.5 / 0.25 s): " + juce::JSON::toString(pdc, true));
    check(! (bool) findTrack(a, "Pad")["stretched"] && (bool) findTrack(a, "Stretchy")["stretched"], "A: a warped clip at ratio 1 comes in; one that would need stretching is flagged");
    bool flagged = false; if (auto* w = a["warnings"].getArray()) for (auto& x : *w) flagged |= x.toString().contains("Stretchy") && x.toString().contains("Bounce/export");
    check(flagged, "A: the stretched clip is in the warnings: \"Bounce/export it at the song's tempo and replace the file\"");
    const auto ld = findTrack(a, "Lead");
    check(ld["file"]["found"] && ld["file"]["path"].toString().contains("Bounces"), "A: a missing sample is found in a folder beside the project: " + ld["file"]["path"].toString());
    check(findTrack(a, "Vox / BGV 1").isObject() && findTrack(a, "Vox / BGV 1")["file"]["found"], "A: a group's track keeps the group name as a prefix (\"Vox / BGV 1\"); Live 10's RelativePathElement file reference");
    const auto gr = findTrack(a, "Guitar rig"), ev = gr["midi"]["events"];
    juce::var pc, n1, n2; int ccs = 0, cc0 = -1, ccLast = -1;
    if (auto* e = ev.getArray()) for (auto& x : *e) {
        if (x["kind"] == "pc") pc = x;
        if (x["kind"] == "note" && ! n1.isObject()) n1 = x; else if (x["kind"] == "note") n2 = x;
        if (x["kind"] == "cc" && (int) x["cc"] == 7) { ++ccs; if (cc0 < 0) cc0 = x["val"]; ccLast = x["val"]; }
    }
    check(gr["midi"]["port"].toString() == "loopMIDI Port" && (int) gr["midi"]["ch"] == 3, "A: the MIDI track's output -> set.Line's port by name, channel 3");
    check(pc.isObject() && (int) pc["pc"] == 4 && (int) pc["msb"] == 1 && (int) pc["bar"] == 5 && near((double) pc["beat"], 1), "A: the clip's Bank 1 + Program 4 at its start (bar 5)");
    check(n1.isObject() && n2.isObject() && (int) n1["bar"] == 5 && near((double) n1["beat"], 1) && (int) n1["note"] == 60 && near((double) n1["len"], 1) && near((double) n2["beat"], 3) && (int) n2["vel"] == 90,
          "A: notes at bar 5 beats 1 and 3 with their lengths and velocities");
    check(ccs >= 3 && cc0 == 0 && ccLast == 127, "A: the CC 7 envelope in the clip (0 -> 127 over a bar): " + juce::String(ccs) + " CC events");
    bool ign = false; if (auto* g = A["ignored"].getArray()) for (auto& x : *g) ign |= x.toString().contains("Pro-Q");
    check(ign, "A: plug-ins / return tracks listed as not imported");

    // ---- B: a whole set in one project (AbleSet locators): 3 songs
    const auto projB = dir.getChildFile("Whole Set Project");
    wav(projB.getChildFile("Samples/Imported/click.wav"), 40);
    {
        const auto set = "<Tracks>" + audioTrack(1, "Click", 13, 1.0, { { 0, 64, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/click.wav", "", "click" } }) + "</Tracks>"
                         + master(120, { { 16, 120 }, { 16, 90 }, { 32, 90 }, { 32, 150 } }, { { 0, 4, 4 }, { 32, 6, 8 } })
                         + locators({ { 0, "Song One" }, { 0, "> Verse" }, { 8, "> Chorus +LOOP" }, { 16, "Song Two {Capo 2}" }, { 16, "> Intro >>> Verse" }, { 28, "STOP" }, { 30, "* fix this" },
                                      { 32, "Song Three #rock" }, { 32, ">> Main" }, { 50, "SONG END" }, { 52, "Encore [nosong]" } });
        als(projB.getChildFile("Whole Set.als"), set, "Ableton Live 12.1");
    }
    const auto B = read(projB.getChildFile("Whole Set.als"), {}, err);
    const auto bs = B["songs"];
    check(B["mode"].toString() == "ableset" && bs.size() == 3 && bs[0]["name"] == "Song One" && bs[1]["name"] == "Song Two" && bs[2]["name"] == "Song Three",
          "B: a whole-set project (AbleSet locators) splits into 3 songs, names without {description} / #tags: " + juce::String(bs.size()) + " songs");
    check(near((double) bs[1]["seconds"], 12 * 60.0 / 90) && near((double) bs[1]["tmap"][0]["bpm"], 90) && (int) bs[1]["total"] == 3,
          "B: Song Two starts at bar 1 at 90 BPM and ends at STOP (12 beats = 8 s, 3 bars)");
    check(bs[0]["secs"].size() == 2 && bs[0]["secs"][1]["name"] == "Chorus" && bs[0]["secs"][1]["end"] == "loop" && bs[1]["secs"][0]["name"] == "Intro",
          "B: \"> Section\" locators are sections; +LOOP makes a looping section; \">>>\" jumps keep the section name");
    check(sigAt(bs[2]["tmap"], 1) == "6/8" && near((double) bs[2]["tmap"][0]["bpm"], 150) && near((double) bs[2]["seconds"], 18 * 60.0 / 150),
          "B: Song Three in 6/8 at 150 from its own bar 1, ends at SONG END");
    const auto ck = findTrack(bs[1], "Click")["clips"][0];
    check(near((double) ck["start"], 0) && near((double) ck["off"], 8.0) && near((double) ck["end"], 8.0), "B: each song's audio from its own start (Song Two's click from 8 s into the file)");

    // ---- C: a whole set laid out with a SONG marker track, a SECTION track (AbleSet's Sections track), unnamed
    // locators where songs end, and click / cue samples played by Simpler inside Live
    const auto projC = dir.getChildFile("Clip Set Project");
    wav(projC.getChildFile("Samples/Imported/bt.wav"), 40);
    {
        auto markerClip = [](int id, double a, double b, const juce::String& name) {
            return "<MidiClip Id=\"" + juce::String(id) + "\" Time=\"" + juce::String(a) + "\">" + V("CurrentStart", a) + V("CurrentEnd", b)
                   + "<Loop>" + V("LoopStart", 0.0) + V("LoopEnd", b - a) + V("StartRelative", 0.0) + V("LoopOn", "false") + "</Loop>" + V("Name", name) + V("Disabled", "false")
                   + "<Notes><KeyTracks /></Notes>" + V("BankSelectCoarse", "-1") + V("BankSelectFine", "-1") + V("ProgramChange", "-1") + "</MidiClip>";
        };
        auto midiTrack = [](int id, const juce::String& name, const juce::String& clips, const juce::String& devices) {
            return "<MidiTrack Id=\"" + juce::String(id) + "\">" + V("TrackGroupId", "-1") + "<Name>" + V("EffectiveName", name) + V("UserName", name) + "</Name>" + V("Color", "2")
                   + "<DeviceChain><Mixer><Volume>" + V("Manual", 1.0) + "</Volume><Speaker>" + V("Manual", "true") + "</Speaker></Mixer>"
                   + "<MidiOutputRouting>" + V("Target", "MidiOut/None") + V("UpperDisplayString", "None") + V("LowerDisplayString", "") + "</MidiOutputRouting>"
                   + "<MainSequencer><ClipTimeable><ArrangerAutomation><Events>" + clips + "</Events></ArrangerAutomation></ClipTimeable></MainSequencer>"
                   + "<DeviceChain><Devices>" + devices + "</Devices></DeviceChain></DeviceChain></MidiTrack>";
        };
        const juce::String clickClip = "<MidiClip Id=\"0\" Time=\"0\">" + V("CurrentStart", 0.0) + V("CurrentEnd", 4.0) + "<Loop>" + V("LoopStart", 0.0) + V("LoopEnd", 4.0) + V("StartRelative", 0.0) + V("LoopOn", "false") + "</Loop>" + V("Name", "click") + V("Disabled", "false")
                   + "<Notes><KeyTracks><KeyTrack Id=\"0\"><Notes><MidiNoteEvent Time=\"0\" Duration=\"0.25\" Velocity=\"100\" OffVelocity=\"64\" IsEnabled=\"true\" /></Notes>" + V("MidiKey", "60") + "</KeyTrack></KeyTracks></Notes>"
                   + V("BankSelectCoarse", "-1") + V("BankSelectFine", "-1") + V("ProgramChange", "-1") + "</MidiClip>";
        juce::String t;
        t += midiTrack(1, "SONG", markerClip(0, 0, 16, "Alpha") + markerClip(1, 20, 36, "Beta"), "");
        t += midiTrack(2, "SECTION", markerClip(0, 0, 8, "INTRO") + markerClip(1, 8, 16, "CHORUS +LOOP") + markerClip(2, 20, 28, "VERSE 1") + markerClip(3, 28, 36, "OUTRO"), "");
        t += midiTrack(3, "CLICK", clickClip, "<OriginalSimpler Id=\"0\" />");
        // Backtrack: "Sends Only", sent to return A at 0.5 (-6 dB); PRACTICE records the return (it routes into its Track In)
        t += audioTrack(4, "Backtrack", 5, 1.0, { { 0, 36, 0, 0, 0, false, false, {}, 1, 0.004, 0.004, "Samples/Imported/bt.wav", "", "bt" } })
                 .replace("<Mixer>", "<AudioOutputRouting>" + V("Target", "AudioOut/None") + "</AudioOutputRouting><Mixer><Sends><TrackSendHolder Id=\"0\"><Send>" + V("Manual", 0.5) + "</Send></TrackSendHolder><TrackSendHolder Id=\"1\"><Send>" + V("Manual", 0.0003162277571) + "</Send></TrackSendHolder></Sends>");
        t += audioTrack(5, "PRACTICE", 5, 1.0, { { 0, 36, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/bt.wav", "", "rec" } });
        t += "<ReturnTrack Id=\"9\"><Name>" + V("EffectiveName", "A-TRAX") + V("UserName", "TRAX") + "</Name><DeviceChain>" + "<AudioOutputRouting>" + V("Target", "AudioOut/Track.5/TrackIn") + "</AudioOutputRouting>" + "<DeviceChain><Devices /></DeviceChain></DeviceChain></ReturnTrack>";
        const auto set = "<Tracks>" + t + "</Tracks>" + master(120, {}, { { 0, 4, 4 } })
                         + locators({ { 0, "Alpha" }, { 16, "" }, { 20, "Beta" }, { 36, "" } });
        als(projC.getChildFile("Clip Set.als"), set, "Ableton Live 12.4.3");
    }
    const auto C = read(projC.getChildFile("Clip Set.als"), {}, err);
    const auto cs = C["songs"];
    check(C["mode"].toString() == "ableset" && cs.size() == 2 && cs[0]["name"] == "Alpha" && cs[1]["name"] == "Beta",
          "C: a SECTION track makes it an AbleSet-style set: 2 songs from the named locators: " + juce::String(cs.size()) + " songs, mode " + C["mode"].toString());
    check(near((double) cs[0]["seconds"], 8.0) && near((double) cs[1]["seconds"], 8.0), "C: an unnamed locator ends a song (Alpha 16 beats = 8 s, not up to Beta)");
    auto secNames = [](const juce::var& song) { juce::StringArray n; if (auto* a = song["secs"].getArray()) for (auto& x : *a) n.add(x["name"].toString() + "@" + x["start"].toString() + (x["end"] == "loop" ? "L" : "")); return n.joinIntoString(","); };
    check(secNames(cs[0]) == "INTRO@1,CHORUS@3L" && secNames(cs[1]) == "VERSE 1@1,OUTRO@3", "C: sections from the SECTION track's clips, flags read (+LOOP): " + secNames(cs[0]) + " | " + secNames(cs[1]));
    check(! findTrack(cs[0], "SONG").isObject() && ! findTrack(cs[0], "SECTION").isObject() && (int) cs[0]["midiTracks"] == 0,
          "C: the SONG / SECTION marker tracks and the Simpler click track aren't imported as MIDI tracks");
    bool simpler = false; if (auto* w = C["converted"].getArray()) for (auto& x : *w) simpler |= x["track"] == "CLICK" && x["role"] == "click";
    check(simpler && cs[0]["clicks"].size() == 1, "C: the CLICK track playing a Simpler inside Live becomes a set.Line click track (8b)");
    const auto bt = findTrack(cs[0], "Backtrack");
    check(bt["bus"].toString() == "TRAX" && near((double) bt["gainDb"], 20 * std::log10(0.5), 1e-4) && ! (bool) bt["mute"],
          "C: a Sends Only track: its return track is its bus (TRAX; a send at -inf doesn't count) and the send level is in its gain (-6 dB): " + bt["bus"].toString() + " " + bt["gainDb"].toString());
    bool recNote = false; if (auto* w = cs[0]["warnings"].getArray()) for (auto& x : *w) recNote |= x.toString().contains("PRACTICE") && x.toString().contains("records");
    bool several = false; if (auto* w = cs[0]["warnings"].getArray()) for (auto& x : *w) several |= x.toString().contains("several return");
    check(! several, "C: no \"several return tracks\" note for a send at -inf");
    check((bool) findTrack(cs[0], "PRACTICE")["mute"] && recNote, "C: a track the returns record into (a practice mix) comes in muted, with a note");
    const auto bc = findTrack(cs[1], "Backtrack")["clips"][0];
    check(near((double) bc["fi"], 0.004) && near((double) bc["off"], 10.0), "C: Live's 4 ms clip-edge fade on an unwarped clip stays 4 ms; Beta's audio from 10 s into the file");

    // ---- D (8b): Live's click and cue MIDI tracks playing Drum Racks inside Live -> set.Line click clips and cues
    const auto projD = dir.getChildFile("Drum Rack Project");
    wav(projD.getChildFile("Samples/Recorded/cues.wav"), 1.0);   // one take, two pads play parts of it
    wav(projD.getChildFile("Samples/Imported/chorus.wav"), 0.5);
    {
        auto notesXml = [](std::vector<std::tuple<int, double, double, int>> ns) { // (key, time, dur, vel)
            std::map<int, juce::String> byKey;
            for (auto& [k, t, d, v] : ns) byKey[k] += "<MidiNoteEvent Time=\"" + juce::String(t) + "\" Duration=\"" + juce::String(d) + "\" Velocity=\"" + juce::String(v) + "\" OffVelocity=\"64\" IsEnabled=\"true\" />";
            juce::String x; int id = 0;
            for (auto& [k, n] : byKey) x += "<KeyTrack Id=\"" + juce::String(id++) + "\"><Notes>" + n + "</Notes>" + V("MidiKey", juce::String(k)) + "</KeyTrack>";
            return "<Notes><KeyTracks>" + x + "</KeyTracks></Notes>";
        };
        auto clip = [&](double a, double b, const juce::String& notes) {
            return "<MidiClip Id=\"0\" Time=\"" + juce::String(a) + "\">" + V("CurrentStart", a) + V("CurrentEnd", b) + "<Loop>" + V("LoopStart", 0.0) + V("LoopEnd", b - a) + V("StartRelative", 0.0) + V("LoopOn", "false") + "</Loop>"
                   + V("Name", "") + V("Disabled", "false") + notes + V("BankSelectCoarse", "-1") + V("BankSelectFine", "-1") + V("ProgramChange", "-1") + "</MidiClip>";
        };
        auto pad = [](const juce::String& name, int note, const juce::String& rel, int s0, int s1) {
            return "<DrumBranch Id=\"0\"><Name>" + V("EffectiveName", name) + V("UserName", name) + "</Name><DeviceChain><MidiToAudioDeviceChain><Devices><OriginalSimpler Id=\"0\"><Player><MultiSampleMap><SampleParts><MultiSamplePart Id=\"0\">"
                   + "<SampleRef><FileRef>" + V("RelativePathType", "3") + V("RelativePath", rel) + V("Path", "") + "</FileRef></SampleRef>" + V("SampleStart", juce::String(s0)) + V("SampleEnd", juce::String(s1))
                   + "</MultiSamplePart></SampleParts></MultiSampleMap></Player></OriginalSimpler></Devices></MidiToAudioDeviceChain></DeviceChain><BranchInfo>" + V("ReceivingNote", juce::String(128 - note)) + "</BranchInfo></DrumBranch>";
        };
        auto track = [](int id, const juce::String& name, const juce::String& clips, const juce::String& pads) {
            return "<MidiTrack Id=\"" + juce::String(id) + "\">" + V("TrackGroupId", "-1") + "<Name>" + V("EffectiveName", name) + V("UserName", name) + "</Name>" + V("Color", "2")
                   + "<DeviceChain><Mixer><Volume>" + V("Manual", 1.0) + "</Volume><Speaker>" + V("Manual", "true") + "</Speaker></Mixer>"
                   + "<MidiOutputRouting>" + V("Target", "MidiOut/None") + V("UpperDisplayString", "None") + V("LowerDisplayString", "") + "</MidiOutputRouting>"
                   + "<MainSequencer><ClipTimeable><ArrangerAutomation><Events>" + clips + "</Events></ArrangerAutomation></ClipTimeable></MainSequencer>"
                   + "<DeviceChain><Devices><DrumGroupDevice Id=\"0\"><Branches>" + pads + "</Branches></DrumGroupDevice></Devices></DeviceChain></DeviceChain></MidiTrack>";
        };
        // CLICK: quarter notes over bars 2-4 (beats 4-16); the accent is its own note (37) on beat 1
        std::vector<std::tuple<int, double, double, int>> ck; for (int i = 0; i < 12; ++i) ck.push_back({ i % 4 == 0 ? 37 : 36, (double) i, 0.25, 100 });
        // DRUM CLICK: 8ths over bars 1-2, one note; beat 1 louder
        std::vector<std::tuple<int, double, double, int>> dk; for (int i = 0; i < 16; ++i) dk.push_back({ 36, i * 0.5, 0.25, i % 8 == 0 ? 127 : 80 });
        // Qs: "VERSE" (part of cues.wav), "one" (another part), and a pad with no name that plays chorus.wav
        const auto qpads = pad("VERSE", 69, "Samples/Recorded/cues.wav", 4800, 9599) + pad("one", 92, "Samples/Recorded/cues.wav", 0, 4799) + pad("", 68, "Samples/Imported/chorus.wav", 0, 23999);
        std::vector<std::tuple<int, double, double, int>> q { { 69, 0.0, 1.0, 100 }, { 92, 4.0, 1.0, 100 }, { 68, 8.5, 1.0, 100 } };
        juce::String t;
        t += track(1, "CLICK", clip(4, 16, notesXml(ck)), pad("Metronome", 36, "", 0, 0) + pad("MetronomeUp", 37, "", 0, 0));
        t += track(2, "DRUM CLICK", clip(0, 8, notesXml(dk)), pad("Cubase", 36, "", 0, 0));
        t += track(3, "Qs", clip(0, 32, notesXml(q)), qpads);
        t += track(4, "-----------", "", pad("verse", 69, "", 0, 0) + pad("chorus", 68, "", 0, 0)); // an empty template: not converted
        // 8c: modeler tracks with empty clips (only the profile comes in), and an empty track with another name (left out)
        auto plain = [&](int id, const juce::String& name) {
            return "<MidiTrack Id=\"" + juce::String(id) + "\">" + V("TrackGroupId", "-1") + "<Name>" + V("EffectiveName", name) + V("UserName", name) + "</Name>" + V("Color", "2")
                   + "<DeviceChain><Mixer><Volume>" + V("Manual", 1.0) + "</Volume><Speaker>" + V("Manual", "true") + "</Speaker></Mixer>"
                   + "<MidiOutputRouting>" + V("Target", "MidiOut/None") + V("UpperDisplayString", "None") + V("LowerDisplayString", "") + "</MidiOutputRouting>"
                   + "<MainSequencer><ClipTimeable><ArrangerAutomation><Events>" + clip(0, 32, "<Notes><KeyTracks /></Notes>") + "</Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain></MidiTrack>";
        };
        t += plain(6, "STAGE QC MIDI") + plain(7, "AXE FX MIDI") + plain(8, "SONG");
        const auto set = "<Tracks>" + t + "</Tracks>" + master(120, {}, { { 0, 4, 4 } }) + locators({ { 0, "Song D" }, { 32, "" } });
        als(projD.getChildFile("Drum Rack.als"), set, "Ableton Live 12.4.3");
    }
    Options od; od.mode = "ableset";
    const auto D = read(projD.getChildFile("Drum Rack.als"), od, err);
    const auto ds = D["songs"][0];
    juce::StringArray conv; if (auto* c = D["converted"].getArray()) for (auto& x : *c) conv.add(x["track"].toString() + "=" + x["role"].toString());
    check(conv.joinIntoString(",") == "CLICK=click,DRUM CLICK=click,Qs=cues", "D: CLICK / DRUM CLICK are click tracks, Qs is the cue track; an empty rack track isn't converted: " + conv.joinIntoString(","));
    auto clickOf = [&](const juce::String& src) { if (auto* a = ds["clicks"].getArray()) for (auto& c : *a) if (c["source"].toString() == src) return c; return juce::var(); };
    const auto c1 = clickOf("CLICK"), c2 = clickOf("DRUM CLICK");
    check(c1.isObject() && c1["regions"].size() == 1 && (int) c1["regions"][0]["bar"] == 2 && (int) c1["regions"][0]["bars"] == 3,
          "D: the click plays only where Live's clips are (bars 2-4): " + juce::JSON::toString(c1["regions"], true));
    int acc1 = 0; bool accOnOne = true; if (auto* n = c1["notes"].getArray()) for (auto& x : *n) { acc1 += (bool) x["acc"]; if ((bool) x["acc"] != ((int) x["st"] == 0)) accOnOne = false; }
    check(c1["accent"] == "note" && c1["notes"].size() == 12 && acc1 == 3 && accOnOne, "D: the accent is the note that plays on beat 1 (MetronomeUp): " + c1["accent"].toString() + ", " + juce::String(acc1) + " accents");
    juce::StringArray st2; int acc2 = 0; if (auto* n = c2["notes"].getArray()) for (auto& x : *n) { if ((int) x["bar"] == 1) st2.add(x["st"].toString()); acc2 += (bool) x["acc"]; }
    check(c2["accent"] == "velocity" && st2.joinIntoString(" ") == "0 2 4 6 8 10 12 14" && acc2 == 2,
          "D: the drum click's 8ths become off-beats (16th steps 0 2 4 ... 14), its louder beat 1 the accent: " + c2["accent"].toString() + " / " + st2.joinIntoString(" "));
    juce::StringArray cw; if (auto* a = ds["cues"].getArray()) for (auto& c : *a) cw.add(c["word"].toString() + "@" + c["bar"].toString() + "." + juce::String((double) c["beat"]));
    check(cw.joinIntoString(", ") == "Verse@1.1, One@2.1, Chorus@3.1.5", "D: a cue for every Qs note, its words from the pad's name, or its sample's file name when the pad has none: " + cw.joinIntoString(", "));
    juce::var vp, op; if (auto* a = D["cuePads"].getArray()) for (auto& x : *a) { if ((int) x["note"] == 69) vp = x; if ((int) x["note"] == 92) op = x; }
    check(D["cuePads"].size() == 3 && vp.isObject() && (bool) vp["file"]["found"] && (int) (double) vp["file"]["start"] == 4800 && (int) (double) vp["file"]["end"] == 9599 && op["word"] == "One",
          "D: the pads (note, name, word, sample and the part of it the pad plays) for the preview's table");
    juce::Array<juce::var> items; { auto* io = new juce::DynamicObject(); io->setProperty("path", vp["file"]["path"]); io->setProperty("start", 4800); io->setProperty("end", 9599); io->setProperty("word", "Verse"); items.add(juce::var(io)); }
    const auto cut = cutPadSamples(juce::var(items), dir.getChildFile("cut"));
    juce::AudioFormatManager fm; fm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> rd(cut.size() == 1 ? fm.createReaderFor(juce::File(cut[0]["path"].toString())) : nullptr);
    check(rd && rd->lengthInSamples == 4800 && cut[0]["word"] == "Verse" && juce::File(cut[0]["path"].toString()).getFileName() == "Verse.wav",
          "D: a pad's part of its sample becomes its own recorded word (Verse.wav, 4800 samples)");
    bool rackNote = false; if (auto* w = D["warnings"].getArray()) for (auto& x : *w) rackNote |= x.toString().contains("inside Live");
    check(! rackNote, "D: converted tracks aren't listed as \"plays inside Live, not imported\"");
    juce::StringArray prof; if (auto* a = ds["tracks"].getArray()) for (auto& x : *a) if (x["kind"] == "midi") prof.add(x["name"].toString() + "=" + x["profile"].toString());
    check(prof.joinIntoString(",") == "STAGE QC MIDI=qc,AXE FX MIDI=axe", "D (8c): MIDI tracks named like a modeler come in with its profile even when empty; an empty SONG track doesn't: " + prof.joinIntoString(","));

    // ---- E (9a): 4/4 -> 7/8 -> 4/4, float-noise tempos, a tempo + meter step in a song's last bar (the next song's),
    // utility locators (TERM x3, an unnamed one), a GTR CHANGE between songs, a lighting marker inside a song
    const auto projE = dir.getChildFile("Sort Project");
    wav(projE.getChildFile("Samples/Imported/band.wav"), 2);
    {
        juce::String t;
        t += audioTrack(1, "Band", 3, 1.0, { { 0, 43.5, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/band.wav", "", "one" },
                                             { 47.5, 79.5, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/band.wav", "", "two" },
                                             { 83.5, 99.5, 0, 0, 0, false, false, {}, 1, 0, 0, "Samples/Imported/band.wav", "", "three" } });
        const auto set = "<Tracks>" + t + "</Tracks>"
                         + master(123.99999999999623, { { 42.5, 123.99999999999623 }, { 42.5, 179.9884490000081 }, { 82.5, 179.9884490000081 }, { 82.5, 100 } }, { { 0, 4, 4 }, { 32, 7, 8 }, { 35.5, 4, 4 }, { 42.5, 3, 4 } })
                         + locators({ { 0, "ONE" }, { 20, "LIGHTS: BLACKOUT" }, { 43.5, "TERM" }, { 44, "GTR CHANGE" }, { 47.5, "TWO" }, { 79.5, "TERM" },
                                      { 83.5, "THREE" }, { 99.5, "TERM" }, { 101.5, "" } });
        als(projE.getChildFile("Sort.als"), set, "Ableton Live 12.4.3");
    }
    Options oe; oe.mode = "ableset";
    const auto E = read(projE.getChildFile("Sort.als"), oe, err);
    const auto es = E["songs"];
    juce::StringArray sorted; juce::var gtr, lights, term;
    if (auto* a = E["locators"].getArray()) for (auto& x : *a) { sorted.add(x["name"].toString() + "=" + x["choice"].toString()); if (x["name"] == "GTR CHANGE") gtr = x; if (x["name"] == "LIGHTS: BLACKOUT") lights = x; if (x["name"] == "TERM" && ! term.isObject()) term = x; }
    check(sorted.joinIntoString(",") == "ONE=song,LIGHTS: BLACKOUT=marker,TERM=ignore,GTR CHANGE=break,TWO=song,TERM=ignore,THREE=song,TERM=ignore,=ignore",
          "E (9a): Sort markers guesses: songs, TERM x3 ignored, GTR CHANGE a break, a marker inside a song, the unnamed one ignored: " + sorted.joinIntoString(","));
    check(term["reason"].toString().contains("repeats 3") && (int) (double) term["bar"] == 12 && gtr["label"] == "Gear change" && gtr["reason"].toString().contains("no audio") && lights["reason"].toString().contains("inside ONE"),
          "E (9a): the reasons (\"repeats 3x\", \"no audio under it\", \"inside ONE\"), Live's bar number across the 7/8 bar (TERM at bar 12), the break's label");
    check(es.size() == 3 && es[0]["name"] == "ONE" && es[1]["name"] == "TWO" && es[2]["name"] == "THREE" && E["breaks"].size() == 1 && (int) E["breaks"][0]["after"] == 0 && E["breaks"][0]["label"] == "Gear change",
          "E (9a): 3 songs; the break sits after ONE: " + juce::String(es.size()) + " songs, " + juce::String(E["breaks"].size()) + " break");
    check(es[0]["marks"].size() == 1 && es[0]["marks"][0]["name"] == "LIGHTS: BLACKOUT" && (int) es[0]["marks"][0]["bar"] == 6 && near((double) es[0]["marks"][0]["beat"], 1),
          "E (9a): the lighting locator is a marker on ONE's ruler (bar 6), not a song");
    const auto t1 = es[0]["tmap"];
    check(sigAt(t1, 8) == "4/4" && sigAt(t1, 9) == "7/8" && sigAt(t1, 10) == "4/4" && sigAt(t1, 11) == "4/4" && (int) es[0]["total"] == 11 && near(barStart(t1, 10) - barStart(t1, 9), 3.5 * 60 / 124),
          "E (9a): Live's time signatures come in: 4/4, 7/8 at bar 9, 4/4 at bar 10; the 3/4 change in ONE's last bar is TWO's (no short bar): " + sigAt(t1, 11) + ", " + juce::String((int) es[0]["total"]) + " bars");
    bool one124 = true; if (auto* a = t1.getArray()) for (auto& x : *a) one124 &= ! x.hasProperty("bpm") || (double) x["bpm"] == 124.0;
    check(one124 && t1.size() == 3 && es[0]["endMoved"].isObject() && (double) es[0]["endMoved"]["to"] == 124.0,
          "E (9a): ONE stays at exactly 124 to its end (the step to 179.988 in its last bar moved to TWO): " + juce::JSON::toString(t1, true));
    check((double) es[1]["tmap"][0]["bpm"] == 179.988 && sigAt(es[1]["tmap"], 1) == "3/4" && ! es[1]["endMoved"].isObject(),
          "E (9a): TWO starts at 179.988 in 3/4: " + es[1]["tmap"][0]["bpm"].toString());
    juce::StringArray snaps; for (auto& s : { es[0], es[1], es[2] }) if (auto* a = s["snapped"].getArray()) for (auto& x : *a) snaps.add(juce::String((double) x["from"], 14) + "->" + x["to"].toString());
    auto hasSnap = [&](const char* from, const char* to) { for (auto& x : snaps) if (x.startsWith(from) && (x.endsWith(juce::String("->") + to) || x.endsWith(juce::String("->") + to + ".0"))) return true; return false; };
    bool to180 = false; for (auto& x : snaps) to180 |= x.endsWith("->180") || x.endsWith("->180.0");
    check(hasSnap("123.9999999999", "124") && hasSnap("179.98844", "179.988") && ! to180,
          "E (9a): float-noise tempos snapped and listed for the report (never to 180): " + snaps.joinIntoString(", "));
    // the user's choices win: the break ignored, the marker made a song
    auto* ch = new juce::DynamicObject(); ch->setProperty(juce::Identifier(gtr["key"].toString()), "ignore"); ch->setProperty(juce::Identifier(lights["key"].toString()), "song");
    oe.choices = juce::var(ch);
    const auto E2 = read(projE.getChildFile("Sort.als"), oe, err);
    check(E2["songs"].size() == 4 && E2["songs"][1]["name"] == "LIGHTS: BLACKOUT" && E2["breaks"].size() == 0 && (double) E2["songs"][0]["seconds"] < 10,
          "E (9a): the choices win (re-read): the marker made a song splits ONE, the break ignored: " + juce::String(E2["songs"].size()) + " songs, " + juce::String(E2["breaks"].size()) + " breaks");
    out.add(ok ? "ABLETON OK" : "ABLETON FAILED");
    return out;
}

} // namespace setline::gui::ableton
