// 14 in the app (--test-script): §3 how long Play takes right after editing cues, clips, the click and MIDI (pressed
// 300 ms after the edit, as a quick hand would), against a plain Play; §5 the pedal / footswitch playback (from the
// old 7c / 8d scripts): a mapping per port, Next song, Play / Stop on the fast path with the page busy, momentary
// Vamp, Jump to section 2, Sync MIDI; the page catches up without doing anything twice.
// CI writes CFG: {src: [wav paths]} (stems from --make-test). Without an audio device the Play checks are skipped
// (reported, not failed); the mapping checks still run.
const CFG = /*CFG*/null;
const P = hooks.page();
const res = { checks: [], times: {}, calls: {}, errs: [], device: true };
window.addEventListener("error", (e) => res.errs.push(e.message + " @" + e.lineno));
const check = (n, ok, d) => res.checks.push((ok ? "ok   " : "FAIL ") + n + (d !== undefined ? "  " + JSON.stringify(d).slice(0, 400) : ""));
const skip = (n, why) => res.checks.push("skip " + n + "  (" + why + ")");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms) {} };
const $ = (id) => document.getElementById(id);
const tr = () => SL.call("getTransport");
const RUN = String(Date.now() % 100000); // words new to this computer (its cue cache keeps every word ever rendered)
const orig = await SL.call("midiMappings");
try {
  check("a fresh library opens", (await hooks.openLibrary("")) === "");
  // two songs from the stems, both in the setlist
  const make = async (name) => { await hooks.onFileDrag({ state: "drop", x: 5, y: 5, paths: CFG.src }); $("mName").value = name; const n = P.songs.length; $("mAdd").click(); for (let i = 0; i < 100 && P.songs.length === n; i++) await wait(100); return P.songs[P.songs.length - 1]; };
  const s = await make("Latency"), s2 = await make("Second");
  check("two songs from " + CFG.src.length + " stems", !!s && !!s2 && s.tracks.length >= CFG.src.length);
  syncSet(); setOrder.splice(0, setOrder.length, s.id, s2.id); refresh();
  // sections, a Cues track with cues, a MIDI track with a preset at bar 1
  for (const x of [s, s2]) { x.secs = [["Intro " + RUN, "intro", 1, 4], ["Verse " + RUN, "verse", 5, 8], ["Chorus " + RUN, "chorus", 13, 8]].map(([name, type, start, bars]) => ({ id: sid++, name, type, start, bars, end: "continue", say: "", notes: {}, tile: true })); buildBars(x); }
  addTrack(s, "cues"); [[3, "Verse"], [11, "Chorus"], [19, "Out"]].forEach(([bar, text]) => placeCue(s, "Cues", { bar, beat: 1 }, text));
  newMidiTrack(s.id); const mt = s.tracks.find((t) => isMidiTrack(s, t)); s.midi[mt].push({ id: "m1", kind: "pc", pc: 3, bar: 1, beat: 1 });
  const natural = typeof VMODEL !== "undefined" && VMODEL.state === "ready";
  res.voice = natural ? "natural voice (Kokoro)" : "no natural voice here (cues without a recording stay silent)";
  refresh(); await hooks.libSave(); await wait(1500); // the cues prepare in the background
  select(s.id, false); openSong(s.id); await wait(400);

  // ---------------------------------------------------------------- §3 Play right after an edit
  // Play pressed -> the engine reports playing (the first audio block). The calls the page makes on the way are timed.
  const timeCalls = () => { const C = SL.call, log = []; SL.call = function (name, args) { const t0 = performance.now(), p = C.apply(this, arguments); Promise.resolve(p).then(() => log.push([name, Math.round(performance.now() - t0)]), () => {}); return p; }; return { log, done: () => { SL.call = C; } }; };
  async function playAfter(label, edit) {
    if (P.playing) { $("stopBtn").click(); await wait(300); }
    P.selectSong(s.id); pos = 0; await wait(500);
    if (edit) { snap(); edit(); refresh(); }
    await wait(300);
    const tc = timeCalls(), t0 = performance.now(); $("playBtn").click();
    let ms = -1; for (let i = 0; i < 3000; i++) { const st = await SL.call("getTransport"); if (st.playing && st.songId === s.id) { ms = performance.now() - t0; break; } if (st.error) break; await wait(2); }
    await wait(50); tc.done();
    (res.times[label] = res.times[label] || []).push(Math.round(ms));
    res.calls[label] = tc.log.filter(([n, d]) => d >= 5 && n !== "getTransport").map(([n, d]) => n + " " + d);
    await wait(250); if (P.playing) { $("stopBtn").click(); await wait(300); }
    return ms;
  }
  let first = await playAfter("first Play (loads the song)", null);
  if (first < 0) { res.device = false; skip("Play after edits", "no audio device"); }
  else {
    for (let i = 0; i < 3; i++) await playAfter("Play, nothing edited", null);
    let k = +RUN;
    await playAfter("cue moved", () => { const c = s.cues.find((x) => x.text === "Verse"); c.bar += 1; });
    await playAfter("cue copied (same word)", () => placeCue(s, "Cues", { bar: 15, beat: 1 }, "Chorus"));
    await playAfter("cue with a new word", () => placeCue(s, "Cues", { bar: 7, beat: 1 }, "Swap guitars " + ++k));
    await playAfter("cue renamed (a new word)", () => { const c = s.cues.find((x) => x.text === "Out"); c.text = "Last chorus " + ++k; });
    await playAfter("announcements on (section names)", () => { const v = P.cueVoiceAll(); v.announce = { ...(v.announce || {}), sections: true }; });
    await playAfter("audio clip trimmed", () => { const t = s.tracks.find((x) => P.ROLE[x] !== "click" && P.ROLE[x] !== "cues" && !isMidiTrack(s, x)); const c = clipsOf(s, t)[0]; c.end = Math.max(c.start + 2, c.end - 1.5); });
    await playAfter("click edited", () => { const c = SLClick.keep(s, "Click"); if (c.notes[5]) c.notes[5].v = 70; });
    await playAfter("MIDI edited", () => { s.midi[mt].push({ id: "m" + Date.now(), kind: "cc", cc: 7, val: 90, bar: 2, beat: 1 }); });
    const base = res.times["Play, nothing edited"].slice().sort((a, b) => a - b)[1];
    res.baselineMs = base;
    // the words that weren't ready at Play: rendered in the background, then they join the song (Diagnostics says so)
    let dg = ""; for (let i = 0; i < 60; i++) { dg = ((await SL.call("diagnostics")).text.match(/^Cue words at Play:.*$/m) || [""])[0]; if (/joined|re-sends/.test(dg)) break; await wait(250); }
    res.lateCue = dg;
    check("cue words that weren't ready at Play joined the song once rendered", !natural || /joined|re-sends/.test(dg), dg);
    for (const [lab, v] of Object.entries(res.times)) if (!/nothing edited|first Play/.test(lab)) check(`Play after “${lab}” starts as fast as a plain Play (${v[0]} ms vs ${base} ms; under ${base + 150} ms)`, v[0] >= 0 && v[0] <= base + 150, res.calls[lab]);
  }

  // ---------------------------------------------------------------- §5 pedals and footswitches (7c, 8d)
  P.selectSong(s.id); await wait(300);
  await SL.call("setMidiMappings", { list: [
    { id: "t1", action: "nextSong", port: "Test Pedal", type: "note", ch: 0, num: 60, mode: "cross", debounce: 150 },
    { id: "t2", action: "playStop", port: "", type: "cc", ch: 1, num: 64, mode: "cross", debounce: 0 },
    { id: "t3", action: "vamp", port: "", type: "cc", ch: 1, num: 80, mode: "momentary", debounce: 0 },
    { id: "t4", action: "jump2", port: "", type: "cc", ch: 1, num: 65, mode: "cross", debounce: 0 },
    { id: "t5", action: "syncMidi", port: "", type: "cc", ch: 1, num: 66, mode: "cross", debounce: 0 },
  ] });
  const m = await SL.call("midiMappings"); P.setMidiMap(m.list, m.inputs);
  check("the mappings are saved on this computer", m.list.length === 5);
  const acts = []; SL.on("midiAction", (a) => acts.push(a));
  const sel0 = P.selId;
  await SL.call("midiInject", { port: "Other Pedal", bytes: [0x90, 60, 100] }); await wait(250);
  check("a mapping on one port ignores the same note from another", P.selId === sel0, [sel0, P.selId]);
  await SL.call("midiInject", { port: "Test Pedal", bytes: [0x90, 60, 100] }); await wait(300);
  check("Note 60 on Test Pedal: Next song", P.selId === s2.id, P.selId);
  check("the MIDI-in light flashed (mapped)", !!$("midiDot") && $("midiDot").classList.contains("mapped"));
  await SL.call("midiInject", { port: "Test Pedal", bytes: [0xF8] }); await SL.call("midiInject", { port: "Test Pedal", bytes: [0xFE] }); await wait(150);
  check("clock / active sensing do nothing", P.selId === s2.id);
  P.selectSong(s.id); await wait(300);
  // Sync MIDI on a pedal: what the first song needs at bar 1 (the fast path sends it; the page doesn't send it again)
  const plan = SL14S.plan(); const sb = acts.length;
  await SL.call("midiInject", { port: "FCB", bytes: [0xB0, 66, 127] }); await wait(400); await SL.call("midiInject", { port: "FCB", bytes: [0xB0, 66, 0] }); await wait(200);
  const sa = acts.slice(sb).find((x) => x.action === "syncMidi");
  check("Sync MIDI pedal: the first song's bar-1 MIDI, on the fast path", plan.song.id === s.id && plan.devs.some((d) => d.msgs.length) && sa && sa.fast, sa);
  check("…the page caught up (the sync is recorded once)", window.__sync14last && __sync14last.song === s.id);
  if (!res.device) skip("Play / Stop, Vamp and Jump on pedals", "no audio device");
  else {
    // load the song the page's way once, then 20 Play / Stop presses with the page's thread blocked after each
    $("playBtn").click(); await wait(1200); $("stopBtn").click(); await wait(600); await wait(400);
    const press = async (num) => { await SL.call("midiInject", { port: "Test Pedal", bytes: [0xB0, num, 127] }); busy(250); await wait(30); await SL.call("midiInject", { port: "Test Pedal", bytes: [0xB0, num, 0] }); await wait(250); };
    const fast = [];
    for (let i = 0; i < 20; i++) { const b = acts.length; await press(64); const a = acts.slice(b).find((x) => x.action === "playStop"); if (a && a.fast) fast.push(+(a.fastMs || -1).toFixed(3)); await wait(300 + (i % 3) * 120); }
    const sorted = fast.slice().sort((a, b) => a - b); res.pedal = { n: fast.length, median: sorted[Math.floor(sorted.length / 2)], worst: sorted[sorted.length - 1] };
    check("Play / Stop pedals go the fast path (20 of 20)", fast.length === 20, fast);
    check("MIDI in to the engine with the page busy: median under 1 ms, 19 of 20 under 5 ms", res.pedal.median < 1 && fast.filter((x) => x < 5).length >= 19, res.pedal);
    let t0 = await tr(); check("the page's Play / Stop state matches the engine", t0.playing === P.playing, { engine: t0.playing, page: P.playing });
    if (!t0.playing) { await press(64); await wait(200); }
    const p1 = (await tr()).seconds; await wait(600); const p2 = (await tr()).seconds;
    check("after a pedal Play the song keeps playing (no second start from the page)", (await tr()).playing && p2 - p1 > 0.45, [p1, p2]);
    const nb = acts.length; await press(65); await wait(200); const ja = acts.slice(nb).find((x) => x.action === "jump2");
    check("Jump to section 2: fast path, queued in the engine", ja && ja.fast && ja.fastResult && ja.fastResult.queued, ja);
    P.perform(true); await wait(200);
    await SL.call("midiInject", { port: "FCB", bytes: [0xB0, 80, 127] }); await wait(250); const vOn = !!document.querySelector("#pfVamp.on");
    await SL.call("midiInject", { port: "FCB", bytes: [0xB0, 80, 0] }); await wait(250);
    check("momentary Vamp: on while held, off on release", vOn && !document.querySelector("#pfVamp.on"), vOn);
    check("Perform shows what the pedal did", /pedal/i.test(($("pfToast") || {}).textContent || ""), ($("pfToast") || {}).textContent);
    P.perform(false); if ((await tr()).playing) { $("stopBtn").click(); await wait(300); }
    const st = await SL.call("pedalStats"); res.pedalStats = st;
  }
} catch (e) { res.errs.push(String((e && e.stack) || e)); }
finally { await SL.call("setMidiMappings", { list: orig.list || [] }); }
res.ok = !res.errs.length && !res.checks.some((c) => c.startsWith("FAIL"));
return res;
