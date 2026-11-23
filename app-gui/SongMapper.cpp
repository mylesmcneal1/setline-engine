#include "SongMapper.h"
#include "../core/Engine.h"
#include "../core/LiveGain.h"
#include "../core/TempoMap.h"
#include <cmath>
#include <set>

namespace setline::gui {

namespace {

int toInt(const juce::var& v, int def = 0) { return v.isVoid() || v.isUndefined() ? def : (int) v; }
double toDouble(const juce::var& v, double def = 0) { return v.isVoid() || v.isUndefined() ? def : (double) v; }
uint8_t b7(int v) { return (uint8_t) juce::jlimit(0, 127, v); }
juce::String quoted(const juce::String& s) { return juce::String::fromUTF8("\xe2\x80\x9c") + s + juce::String::fromUTF8("\xe2\x80\x9d"); }

// Meter in force at a bar (Edit page: sigAt).
std::pair<int, int> sigAt(const juce::var& tmap, int bar)
{
    std::vector<std::pair<int, std::pair<int, int>>> changes; // bar -> meter
    if (auto* a = tmap.getArray())
        for (auto& e : *a)
            if (auto* sg = e["sig"].getArray(); sg && sg->size() == 2)
                changes.push_back({ toInt(e["bar"], 1), { (int) (*sg)[0], (int) (*sg)[1] } });
    std::stable_sort(changes.begin(), changes.end(), [](auto& x, auto& y) { return x.first < y.first; });
    std::pair<int, int> sig = changes.empty() ? std::pair<int, int> { 4, 4 } : changes.front().second;
    for (auto& [b, sg] : changes) if (b <= bar) sig = sg;
    return sig;
}

void addMsg(SongDef& def, int port, int bar, double beat, double early, std::initializer_list<int> bytes, const juce::String& label)
{
    MidiEventDef m;
    m.port = port; m.bar = bar; m.beat = beat; m.earlySeconds = early; m.label = label.toStdString();
    m.len = 0;
    for (int x : bytes) if (m.len < 3) m.bytes[m.len++] = (uint8_t) x;
    def.midi.push_back(m);
}

} // namespace

MappedSong mapSong(const juce::var& payload, double sr, int numOutputs,
                   const std::function<int(const juce::String&, std::vector<std::string>&)>& resolvePort)
{
    MappedSong out;
    auto& def = out.def;
    auto warn = [&](const juce::String& w) { out.warnings.push_back(w.toStdString()); };
    const juce::var s = payload["song"], routing = payload["routing"], roles = payload["roles"];
    juce::var click = payload["click"];
    if (s.hasProperty("click") && s["click"].isObject()) click = s["click"]; // per-song click settings

    def.name = s["name"].toString().toStdString();
    def.lengthBars = std::max(0, toInt(s["total"], 0));

    // ---- tempo map (ramps play as jumps for now) ----
    if (auto* tm = s["tmap"].getArray())
        for (auto& e : *tm) {
            TempoChange c;
            c.bar = std::max(1, toInt(e["bar"], 1));
            c.bpm = toDouble(e["bpm"], 0);
            if (auto* sg = e["sig"].getArray(); sg && sg->size() == 2) { c.num = (int) (*sg)[0]; c.den = (int) (*sg)[1]; }
            c.ramp = (bool) e["ramp"];
            def.tempo.push_back(c);
        }
    if (def.tempo.empty()) def.tempo.push_back({ 1, 120, 4, 4 });
    TempoMap tmap; // for "send early" in beats
    tmap.build(def.tempo, sr, 0, std::max(def.lengthBars, 1) + 2);

    auto outsFor = [&](const juce::String& role, const juce::String& track) {
        std::vector<int> o;
        if (auto* a = routing[juce::Identifier(role.isEmpty() ? "_" : role)].getArray())
            for (auto& v : *a) {
                const int n = (int) v;
                if (n >= 1 && n <= numOutputs) o.push_back(n - 1);
                else warn(track + " is routed to output " + juce::String(n) + ", but the device has " + juce::String(numOutputs) + " outputs.");
            }
        return o;
    };
    auto roleOf = [&](const juce::String& t) { return roles[juce::Identifier(t.isEmpty() ? "_" : t)].toString(); };

    const juce::var tracks = s["tracks"], midiCfg = s["midiCfg"];
    int audioTracks = 0;
    bool haveClick = false;
    if (auto* ts = tracks.getArray())
        for (auto& tv : *ts) {
            const auto t = tv.toString();
            const juce::Identifier tid(t.isEmpty() ? "_" : t);
            TrackLevel lv;
            lv.db = (float) toDouble(s["gain"][tid], 0);
            lv.mute = (bool) s["mute"][tid];
            lv.solo = (bool) s["solo"][tid];
            out.levels[t] = lv;
            if (midiCfg.isObject() && midiCfg.hasProperty(tid)) continue; // MIDI track, below
            const auto role = roleOf(t);
            if (role == "click") {
                if (haveClick) continue;
                haveClick = true;
                def.clickOuts = outsFor("click", t);
                if (def.clickOuts.empty()) warn("The click isn't routed to an output (Outputs & MIDI page), so it won't be heard.");
                out.engineTrack[t] = Engine::ClickTrack;
            } else if (role == "cues") {
                out.engineTrack[t] = Engine::CueTrack;
            } else {
                ++audioTracks;
            }
        }
    if (audioTracks > 0) warn(juce::String(audioTracks) + " audio track" + (audioTracks > 1 ? "s aren't" : " isn't") + " played yet (audio arrives in step 2); click and MIDI play.");
    if (std::any_of(out.engineTrack.begin(), out.engineTrack.end(), [](auto& p) { return p.second == Engine::CueTrack; }) && s["cues"].size() > 0)
        warn("Spoken cues aren't played yet (they arrive with audio in step 2).");

    // ---- click: exactly the notes in the click clips ----
    const float accentGain = (float) toDouble(click["accentGain"], 0), beatGain = (float) toDouble(click["beatGain"], -4),
                subGain = (float) toDouble(click["subGain"], -14);
    const bool useAccent = click.hasProperty("accent") ? (bool) click["accent"] : true;
    def.clickGainDb = -6.0f + accentGain;                       // accent level (same reference as the spike's click)
    const float engineBeatDb = 20.0f * std::log10(0.6f);        // the engine plays non-accented hits at 0.6
    std::vector<ClickHitDef> hits;
    if (haveClick)
        if (auto* clips = s["ck"].getArray())
            for (auto& r : *clips) {
                const int rb = toInt(r["bar"], 1);
                if (auto* notes = r["notes"].getArray())
                    for (auto& n : *notes) {
                        const int bar = rb + toInt(n["b"], 0);
                        const auto sig = sigAt(s["tmap"], bar);
                        const double per = 16.0 / std::max(1, sig.second);           // 16th steps per beat
                        const double st = toDouble(n["st"], 0);
                        const bool acc = (bool) n["acc"];
                        const bool onBeat = std::fmod(st, per) == 0.0;
                        ClickHitDef h;
                        h.bar = bar;
                        h.beat = 1.0 + st / per;
                        h.accent = acc && useAccent;
                        h.gainDb = h.accent ? 0.0f
                                 : (! acc && ! onBeat ? subGain : beatGain) - accentGain - engineBeatDb;
                        hits.push_back(h);
                    }
            }
    def.clickHits = hits;
    if (haveClick) {
        static const std::map<juce::String, const char*> soundNames { { "wood", "Woodblock" }, { "clave", "Clave" }, { "rim", "Rimshot" }, { "cow", "Cowbell" },
                                                                    { "hat", "Hi-hat tick" }, { "sine", "Soft sine" }, { "voice", "Spoken count" }, { "custom", "Your sample" } };
        const auto snd = click["sound"].toString();
        if (auto it = soundNames.find(snd); it != soundNames.end())
            warn("Click sound " + quoted(it->second) + " comes later; the engine plays its standard click for now.");
    }

    // ---- MIDI: events of the alternate in use, inside its regions ----
    if (auto* ts = tracks.getArray())
        for (auto& tv : *ts) {
            const auto t = tv.toString();
            const juce::Identifier tid(t.isEmpty() ? "_" : t);
            if (! midiCfg.isObject() || ! midiCfg.hasProperty(tid)) continue;
            const auto cfg = midiCfg[tid];
            const int ch = juce::jlimit(1, 16, toInt(cfg["ch"], 1)) - 1;
            const auto portName = cfg["port"].toString();
            std::vector<std::string> portWarn;
            const int port = resolvePort(portName, portWarn);
            if (port < 0) { warn("MIDI track " + quoted(t) + ": port " + quoted(portName) + " isn't connected; its events are skipped."); continue; }

            juce::var alt, events = s["midi"][tid];
            if (auto* alts = s["malts"][tid].getArray()) {
                const auto use = s["muse"][tid].toString();
                for (auto& a : *alts) if (a["id"].toString() == use) alt = a;
                if (alt.isVoid() && ! alts->isEmpty()) alt = (*alts)[0];
                if (alt.isObject()) events = alt["events"];
            }
            std::vector<std::pair<int, int>> regions;
            if (alt.isObject())
                if (auto* rs = alt["regions"].getArray())
                    for (auto& r : *rs) regions.push_back({ toInt(r["bar"], 1), std::max(1, toInt(r["bars"], 1)) });

            const auto early = cfg["early"].toString();
            auto* evs = events.getArray();
            if (! evs) continue;
            for (auto& e : *evs) {
                const int bar = std::max(1, toInt(e["bar"], 1));
                const double beat = std::max(1.0, toDouble(e["beat"], 1));
                if (! regions.empty() && std::none_of(regions.begin(), regions.end(), [&](auto& r) { return bar >= r.first && bar < r.first + r.second; }))
                    continue;
                double earlySec = 0;
                if (early.endsWith("ms")) earlySec = early.dropLastCharacters(2).getDoubleValue() / 1000.0;
                else if (early == "16" || early == "8" || early == "4") {
                    const int den = sigAt(s["tmap"], bar).second;
                    const double beats = early == "4" ? 1.0 : den / early.getDoubleValue(); // a 16th / 8th note in this meter's beats
                    earlySec = (double) (tmap.sampleAt(bar, beat) - tmap.sampleAt(bar, beat - beats)) / sr;
                }
                const auto kind = e["kind"].toString();
                const juce::String label = t + " bar " + juce::String(bar);
                static const juce::String QCL = "ABCDEFGH";
                if (kind == "qcPreset") {
                    const int n = (toInt(e["bank"], 1) - 1) * 8 + QCL.indexOf(e["slot"].toString()) + 1;
                    addMsg(def, port, bar, beat, earlySec, { 0xB0 | ch, 0, n > 128 ? 1 : 0 }, label);
                    addMsg(def, port, bar, beat, earlySec, { 0xB0 | ch, 32, b7(toInt(e["setlist"], 0)) }, label);
                    addMsg(def, port, bar, beat, earlySec, { 0xC0 | ch, b7((n - 1) % 128) }, label);
                } else if (kind == "qcScene") {
                    addMsg(def, port, bar, beat, earlySec, { 0xB0 | ch, 43, b7(QCL.indexOf(e["scene"].toString())) }, label);
                } else if (kind == "axPreset") {
                    const int p = toInt(e["preset"], 0);
                    addMsg(def, port, bar, beat, earlySec, { 0xB0 | ch, 0, b7(p / 128) }, label);
                    addMsg(def, port, bar, beat, earlySec, { 0xC0 | ch, b7(p % 128) }, label);
                } else if (kind == "axScene") {
                    addMsg(def, port, bar, beat, earlySec, { 0xB0 | ch, 34, b7(toInt(e["scene"], 1) - 1) }, label);
                } else if (kind == "pc") {
                    addMsg(def, port, bar, beat, earlySec, { 0xC0 | ch, b7(toInt(e["pc"], 0)) }, label);
                } else if (kind == "cc") {
                    addMsg(def, port, bar, beat, earlySec, { 0xB0 | ch, b7(toInt(e["cc"], 0)), b7(toInt(e["val"], 0)) }, label);
                } else if (kind == "note") {
                    const int note = b7(toInt(e["note"], 60));
                    addMsg(def, port, bar, beat, earlySec, { 0x90 | ch, note, std::max(1, (int) b7(toInt(e["vel"], 100))) }, label);
                    addMsg(def, port, bar, beat + std::max(0.0625, toDouble(e["len"], 1)), earlySec, { 0x80 | ch, note, 0 }, label);
                } else {
                    warn("MIDI track " + quoted(t) + ": unknown event type " + quoted(kind) + " skipped.");
                }
            }
        }
    return out;
}

} // namespace setline::gui
