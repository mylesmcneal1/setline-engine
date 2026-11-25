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
    juce::String te = "<FloatEvent Id=\"1\" Time=\"-63072000\" Value=\"" + juce::String(bpm0) + "\" />";
    int id = 2;
    for (auto& [b, v] : tempo) te += "<FloatEvent Id=\"" + juce::String(id++) + "\" Time=\"" + juce::String(b) + "\" Value=\"" + juce::String(v, 6) + "\" />";
    juce::String me;
    for (auto& [b, n, d] : meters) me += "<EnumEvent Id=\"" + juce::String(id++) + "\" Time=\"" + juce::String(b > 0 ? b : -63072000.0) + "\" Value=\"" + juce::String(ts(n, d)) + "\" />";
    return "<MasterTrack><DeviceChain><Mixer>"
           "<Tempo><Manual Value=\"" + juce::String(bpm0) + "\" /><AutomationTarget Id=\"8\" /></Tempo>"
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
        t += audioTrack(2, "Pad", 6, 1.0, { { 0, 8, 0, 0, 0, false, true, { { 0, 0 }, { 8, 4 } }, 1, 0, 0, "Samples/Imported/pad.wav", "", "pad" } });
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
              && near((double) dc["fi"], 0.5) && near((double) dc["fo"], 1.2) && near((double) dr["gainDb"], 20 * std::log10(0.5), 1e-4),
          "A: audio clip with an offset, gain and fades (2.0-10.4 s, from 0.5 s in, -6 dB, fades 0.5 / 1.2 s); the track volume as a trim: " + juce::JSON::toString(dc, true));
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
    out.add(ok ? "ABLETON OK" : "ABLETON FAILED");
    return out;
}

} // namespace setline::gui::ableton
