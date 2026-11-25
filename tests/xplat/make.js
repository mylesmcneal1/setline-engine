// Setlists move between Windows and Mac (docs/phase6c.md, 6f), step 1, on one system: in a fresh Library, build a
// setlist with stems (odd file names), audio clips, a click, cues, MIDI and two versions; export it as a .setline
// package (audio and rendered cues inside); render every song and version offline. tests/xplat/run.sh puts CFG in
// and stores the result next to the package.
const CFG = /*CFG*/null; // {src: [wav paths], show: ".../X Show/X Show.setline" (the package to write)}
const P = hooks.page();
const res = { checks: [], expect: [] };
const check = (name, ok, detail) => res.checks.push((ok ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// every bridge call gives up after 60 s and says which one (a hang names itself)
res.steps = [];
const call0 = SL.call.bind(SL);
const within = (name, p) => { res.steps.push(name); return Promise.race([p, wait(60000).then(() => { const box = document.querySelector(".cfbox"); throw new Error(name + " didn't finish in 60 s" + (box ? "; a box is open: " + box.textContent : "") + "; calls: " + res.steps.slice(-8).join(", ")); })]); };
const SLx = { call: (name, a) => { res.steps.push(name); return Promise.race([call0(name, a), wait(60000).then(() => { throw new Error("no answer from " + name + " in 60 s"); })]); } };
const $ = (id) => document.getElementById(id);
res.platform = (await SLx.call("getAppInfo")).platform;
check("a fresh library opens", (await within("openLibrary", hooks.openLibrary(""))) === "");

async function addSong(name, paths) {
  await within("onFileDrag", hooks.onFileDrag({ state: "drop", x: 5, y: 5, paths }));
  $("mName").value = name;
  const before = P.songs.length;
  $("mAdd").click();
  for (let i = 0; i < 100 && P.songs.length === before; i++) await wait(100);
  return P.songs[P.songs.length - 1];
}
const probe = (await SLx.call("probeAudio", { paths: CFG.src, rate: 0 })).files;
check("source stems readable", probe.every((f) => f.ok), probe.map((f) => f.name + ": " + (f.error || f.channels + " ch")));

// Song 1: every stem, a split clip with gain and fades, click, cues, MIDI, routing, two versions
const s = await addSong("Crossing", CFG.src);
const stems = Object.keys(s.files);
check("song 1 has every stem", stems.length === CFG.src.length, stems);
if (!s.tracks.includes("Click")) s.tracks.unshift("Click");
if (!s.tracks.includes("Cues")) s.tracks.push("Cues");
if (!s.tracks.includes("Gear")) s.tracks.push("Gear");
s.ck = [{ id: "r1", bar: 1, bars: 6, notes: [0, 1, 2, 3].map((b) => ({ b, st: 0, acc: b === 0 })) }];
s.cues = [{ id: "q1", bar: 2, text: "Verse" }, { id: "q2", bar: 4, beat: 3, text: "Chorus" }];
s.clips = { [stems[0]]: [{ id: 1, start: 0, end: 3, off: 0, gain: 0, fi: 0, fo: 0.5, mute: false }, { id: 2, start: 3, end: 9, off: 3, gain: -6, fi: 0.25, fo: 0, mute: false }] };
s.midiCfg = s.midiCfg || {}; s.midi = s.midi || {};
s.midiCfg["Gear"] = { port: P.PORTS[0] || "Any port", ch: 1, profile: "gen", early: "0" };
s.midi["Gear"] = Array.from({ length: 5 }, (_, i) => ({ id: 900 + i, bar: i + 2, beat: 1, kind: "pc", pc: i + 2 }));
s.mute = {}; s.solo = {}; s.gain = { [stems[1]]: -4.5 };
stems.forEach((t, i) => hooks.SLR.setOverride(s, t, [i + 1]));
hooks.SLR.setOverride(s, "Click", [stems.length + 1]);
hooks.SLR.setOverride(s, "Cues", [stems.length + 2]);
// sections (6e: a version plays some of them, laid end to end): bars 1-2, 3-4, 5-7
const sec = (id, name, type, start, bars) => ({ id, name, type, start, bars, end: "continue", say: "", notes: {}, tile: true });
s.secs = [sec(9001, "One", "verse", 1, 2), sec(9002, "Two", "chorus", 3, 2), sec(9003, "Three", "outro", 5, 3)];
P.buildBars(s);
const vers = [];
if (typeof newVer === "function") {
  vers.push(curVer(s).id);
  const v = newVer(s, "Live"); // the second version: One and Three (Two left out: a join with an equal-power crossfade)
  v.order.forEach((o) => { if (o.id === 9002) o.on = false; });
  vers.push(v.id);
}
P.buildBars(s);
// Song 2: one stem, nothing else
const s2 = await addSong("Second", [CFG.src[0]]);
hooks.SLR.setOverride(s2, Object.keys(s2.files)[0], [1]);
P.rerender();
hooks.remember();

// both songs in the setlist; the library saves itself
[s, s2].forEach((x) => { if (!setOrder.includes(x.id)) setOrder.push(x.id); });
P.rerender(); hooks.remember();
await within("libSave", hooks.libSave());
const lib = (await SLx.call("getSessionFile")).path;
const refs = () => [...new Set(hooks.audioFiles().map((x) => x.f.path))];
const missing = (await SLx.call("checkAudio", { session: lib, refs: refs() })).missing;
res.refs = refs();
check("every stem copied into the library by content (relative paths)", !missing.length && res.refs.every((x) => /^Audio\/[0-9a-f]{16}\./.test(x)), { refs: res.refs, missing });
const stored = await SLx.call("storeCues", { cues: hooks.cueList() });
res.cuesStored = stored;
check("cues stored in the library", stored.stored + 0 >= 0 && stored.error === undefined, stored);

// Render every song and version (6 bars at 120 bpm is 12 s; 14 s covers it)
async function render(song) {
  const r = await SLx.call("testRender", { payload: hooks.payload(song), seconds: 14, outputs: 8 });
  return { outs: r.outs.slice(0, 8).map((o) => ({ onsets: o.onsets, peak: o.peak })), bars: r.bars, midi: r.midi, samples: r.samples, warnings: r.warnings };
}
for (const v of vers.length ? vers : [null]) {
  if (v) switchVer(s, v);
  res.expect.push({ song: s.id, name: s.name, ver: v, render: await render(s) });
}
if (vers.length) switchVer(s, vers[0]);
res.expect.push({ song: s2.id, name: s2.name, ver: null, render: await render(s2) });
check("renders: something on every stem output, the click and the cues",
  res.expect[0].render.outs.slice(0, stems.length + 2).every((o) => o.peak > 0.001), res.expect[0].render.outs.map((o) => o.peak));
check("MIDI in the render", Array.isArray(res.expect[0].render.midi) && res.expect[0].render.midi.length >= 5, res.expect[0].render.midi && res.expect[0].render.midi.length);
check("two versions rendered differently", vers.length < 2 || JSON.stringify(res.expect[0].render.samples) !== JSON.stringify(res.expect[1].render.samples));
// exported with version 1 current, exactly what was rendered
hooks.remember(); await within("libSave", hooks.libSave());
const ex = await within("exportSetlist", hooks.exportSetlist(P.curSetId(), CFG.show));
check("exported as a .setline package", !!ex.path && !ex.error, ex);
return res;
