// 10c: runs inside the page (Chrome and WebKit). The click as a MIDI clip (migration with no audible change, fill in
// mixed meters, refill only on request, patterns, the editor's gestures, new songs filled, the Ableton mapping),
// songs merged as versions (own timelines, setlists, unmerge, undo, the variant names), sections from cues (ghosts,
// count words, the batch, undo). Returns { problems: [...], log: [...] }.
async function check10c() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const S = (id) => songs.find((x) => x.id === id);
  const C = SLClick, PPQ = C.PPQ;
  // a song in 4/4 for its first bars, with a Click track (the editor and pattern checks count 4/4 beats)
  const Q = (songs.find((x) => x.id !== "glass" && x.tracks.includes("Click") && x.bars.slice(0, 6).every((b) => b.sig[0] === 4 && b.sig[1] === 4)) || {}).id;
  log.push("4/4 song for the editor: " + (S(Q) || {}).name);
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);

  // ================================================================ the click: migration with no audible change
  // the engine's hits (SongMapper.cpp clickHitsOf): bar, beat, accent, level class (accent / beat / sub) and velocity
  const hitsFrom = (s, regs) => { const out = []; for (const r of regs || []) for (const n of r.notes || []) { const bar = r.bar + (n.b || 0), sig = s.bars[bar - 1].sig, per = 16 / sig[1], st = +n.st;
    out.push(`${bar}|${(1 + st / per).toFixed(4)}|${n.acc ? "A" : Math.abs(st % per) < 1e-6 && !n.w ? "B" : "S"}|${n.v || 127}`); } return out.sort(); };
  for (const id of ["glass", "neon", "low"]) {
    const s = S(id), before = hitsFrom(s, s.ck);
    const v = curVer(s), f = verFields(s, v); buildBars(f); const after = hitsFrom(f, f.ck);
    ok(before.length > 0 && before.join() === after.join(), `${s.name}: the click migrates with no audible change (${before.length} hits before, ${after.length} after${before.join() !== after.join() ? "; first difference " + before.find((x, i) => x !== after[i]) : ""})`);
  }
  // fill from the time signature, mixed meters (Glasshouse: 7/8 at bars 25–26, as 2+2+3)
  { const s = S("glass"); snap(); C.fill(s, "Click"); const N = C.clipOf(s, "Click").notes, b1 = C.barTk(s, 1), b25 = C.barTk(s, 25);
    const bar = (b) => N.filter((n) => n.tk >= C.barTk(s, b) && n.tk < C.barTk(s, b + 1)).map((n) => (n.tk - C.barTk(s, b)) / (PPQ / 2) + (n.a ? "A" : "c"));
    ok(bar(1).join() === "0A,2c,4c,6c", "fill, 4/4: an accent on beat 1, a click on 2 3 4: " + bar(1).join());
    ok(bar(25).join() === "0A,1c,2A,3c,4A,5c,6c", "fill, 7/8 (2+2+3): accents on each group's start: " + bar(25).join());
    log.push(`Glasshouse filled: ${N.length} notes`);
    // the click stays as drawn: a new time signature doesn't rewrite it; the hint offers Refill
    const n0 = JSON.stringify(N); s.tmap.push({ bar: 9, bpm: bpmAt(s, 9), sig: [3, 4] }); s.tmap.sort((a, b) => a.bar - b.bar); buildBars(s);
    ok(JSON.stringify(C.clipOf(s, "Click").notes) === n0, "a time signature change leaves the click exactly as drawn");
    ok(C.clipOf(s, "Click").sig !== C.sigKey(s), "…and the clip knows its time signatures changed (the Refill hint)");
    C.open(s, "Click"); await frames(3); const hint = document.querySelector("#clk10 .chint10"); ok(hint && !hint.hidden && /Refill click/.test(hint.textContent), "the editor shows “Time signature changed: Refill click?”");
    hint.querySelector('[data-a="refill"]').click(); await frames(2);
    ok(C.clipOf(s, "Click").sig === C.sigKey(s) && bar(9).join() === "0A,2c,4c", "Refill: bar 9 in 3/4 now clicks 3 beats: " + bar(9).join());
    undo(); undo(); await frames(2); }
  // patterns over a selection
  { const s = S(Q); C.open(s, "Click"); await frames(2); const A = C.clipOf(s, "Click");
    snap(); C.pattern(s, "Click", "eighth", C.barTk(s, 2), C.barTk(s, 4)); const n8 = A.notes.filter((n) => n.tk >= C.barTk(s, 2) && n.tk < C.barTk(s, 4));
    ok(n8.length === 16 && n8.filter((n) => n.a).length === 2, `Pattern › 8ths over 2 bars: ${n8.length} notes, ${n8.filter((n) => n.a).length} accents`);
    C.pattern(s, "Click", "triplet", C.barTk(s, 2), C.barTk(s, 3)); ok(A.notes.filter((n) => n.tk >= C.barTk(s, 2) && n.tk < C.barTk(s, 3)).length === 12, "Pattern › Triplets: 12 in a 4/4 bar");
    C.pattern(s, "Click", "half", C.barTk(s, 3), C.barTk(s, 4)); ok(A.notes.filter((n) => n.tk >= C.barTk(s, 3) && n.tk < C.barTk(s, 4)).length === 2, "Pattern › Half-time: 2 in a 4/4 bar");
    undo(); await frames(1); }

  // ================================================================ the editor: draw, select, move, copy, velocity, duplicate, delete
  { const s = S(Q); openSong(s.id); await wait(250); SL9.zoomNow(160 / (s.bars[1].t - s.bars[0].t)); await frames(2); document.getElementById("scroller").scrollLeft = 0; // 160 px a bar: an 8th is 20 px
    C.open(s, "Click"); await frames(3); C.setMode("draw"); C.setGrid(1); await frames(2);
    const G = C.geo(), cv = G.cv, r = cv.getBoundingClientRect(), X = (tk) => r.left + C.tkTime(S(Q), tk) * PXS - G.hx + 3;
    const T0 = C.TOP || 20, yA = r.top + T0 + 23, yC = r.top + T0 + 46 + 23, yV = r.top + T0 + 92 + 6; // 11: the top rows (bar numbers, time signatures)
    const pe = (t, x, y, o = {}) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: t === "pointerup" ? 0 : 1, pointerId: 5, ...o }));
    const notes = () => C.clipOf(S(Q), "Click").notes, at = (tk, a) => notes().filter((n) => n.tk === tk && n.a === a);
    const t1 = C.barTk(s, 2) + PPQ / 2; // the "and" of beat 1 in bar 2 (an 8th, not drawn by the fill)
    ok(!at(t1, 0).length, "test setup: no click on bar 2's first 8th");
    pe("pointerdown", X(t1) + 2, yC); pe("pointerup", X(t1) + 2, yC); await frames(1);
    ok(at(t1, 0).length === 1, "Draw: a click on an empty cell adds a note");
    pe("pointerdown", X(t1) + 2, yC); pe("pointerup", X(t1) + 2, yC); await frames(1);
    ok(!at(t1, 0).length, "Draw: a click on a note removes it");
    // paint across 4 cells on the Accent lane
    const p0 = C.barTk(s, 3) + PPQ / 2; pe("pointerdown", X(p0) + 2, yA); for (let k = 1; k <= 2; k++) pe("pointermove", X(p0 + k * PPQ) + 2, yA); pe("pointerup", X(p0 + 2 * PPQ) + 2, yA); await frames(1);
    ok([0, 1, 2].every((k) => at(p0 + k * PPQ, 1).length === 1), "Draw: dragging paints notes");
    // select mode: a box around them, move them an 8th later, ⌥-drag copies
    C.setMode("select"); await frames(1);
    pe("pointerdown", X(p0) - 6, yA - 15); pe("pointermove", X(p0 + 2 * PPQ) + 10, yA + 15); pe("pointerup", X(p0 + 2 * PPQ) + 10, yA + 15); await frames(1);
    ok(C.editing().sel.length === 3, `Select: a box selects (${C.editing().sel.length})`);
    pe("pointerdown", X(p0) + 1, yA); pe("pointermove", X(p0 + PPQ / 2) + 1, yA); pe("pointerup", X(p0 + PPQ / 2) + 1, yA); await frames(1);
    ok([0, 1, 2].every((k) => at(p0 + PPQ / 2 + k * PPQ, 1).length === 1) && !at(p0, 1).length, "Select: dragging moves the selection (snapped to the grid)");
    const q0 = p0 + PPQ / 2; pe("pointerdown", X(q0) + 1, yA, { altKey: true }); pe("pointermove", X(q0 + PPQ * 4) + 1, yA, { altKey: true }); pe("pointerup", X(q0 + PPQ * 4) + 1, yA); await frames(1);
    ok(at(q0, 1).length === 1 && at(q0 + PPQ * 4, 1).length === 1, "⌥-drag copies (the originals stay)");
    // velocity: drag the selected bars down to about half
    const panel = document.getElementById("clk10"); panel.focus();
    const vh = Math.max(20, G.h - (20 + 92 + 6) - 4); pe("pointerdown", X(q0 + PPQ * 4) + 1, yV + vh * 0.1); pe("pointermove", X(q0 + PPQ * 4) + 1, yV + vh * 0.5); pe("pointerup", X(q0 + PPQ * 4) + 1, yV + vh * 0.5); await frames(1);
    const vs = C.editing().sel.map((n) => n.v); ok(vs.length === 3 && vs.every((v) => v > 50 && v < 80), "the velocity strip sets the selected notes' level: " + vs.join(","));
    // ⌘D duplicates the selection after itself; ⌫ deletes it
    const key = (k, o = {}) => panel.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));
    const n0 = notes().length; key("d", /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }); await frames(1);
    ok(notes().length === n0 + 3, `${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}D duplicates the selection (${n0} → ${notes().length})`);
    key("Backspace"); await frames(1); ok(notes().length === n0, "⌫ deletes the selection");
    // the lane on the timeline shows the notes; the editor follows the timeline's position and zoom
    const G2 = C.geo(); ok(Math.abs((r.left + G2.left - r.left) - (TL9.laneLeft() - panel.querySelector(".cb10").getBoundingClientRect().left)) < 1.5, "the editor's grid starts where the timeline's lanes do");
    document.getElementById("scroller").scrollLeft = 300; await frames(3); ok(C.geo().hx === 300, "…and scrolls with them");
    C.close(); closeSong(); await wait(150); }

  // ================================================================ new songs start filled; the Ableton mapping
  { const id = "t10c" + Date.now(); const so = { id, name: "Brand New", key: "—", col: "#888", trans: "stop", tmap: [{ bar: 1, bpm: 120, sig: [4, 4] }], secs: [], tracks: ["Click", "Bass"], audio: 16, added: Date.now() };
    snap(); normSecs(so); buildBars(so); songs.push(so); refresh(); await frames(1);
    const N = (so.clk && so.clk.Click || { notes: [] }).notes; ok(N.length === so.total * 4 && N.filter((n) => n.a).length === so.total, `a new song's click starts filled from its time signature (${N.length} notes, ${so.total} bars)`);
    undo(); await frames(1); }
  { const src = { name: "Live Song", seconds: 8, tmap: [{ bar: 1, bpm: 120, sig: [4, 4] }], secs: [], tracks: [], cues: [],
      clicks: [{ name: "Click", source: "CLICK", regions: [{ bar: 1, bars: 2 }], notes: [{ bar: 1, st: 0, acc: true, q: 0, vel: 127 }, { bar: 1, st: 4, acc: false, q: 1.0, vel: 90 }, { bar: 1, st: 6, acc: false, q: 1.5 + 0.5 / PPQ, vel: 70 }, { bar: 1, st: 9, acc: false, q: 2.27, vel: 60 }, { bar: 2, st: 0, acc: true, q: 4, vel: 120 }] }] };
    const { so } = SLAble.song(src); const N = so.clk && so.clk.Click && so.clk.Click.notes;
    ok(N && N.length === 5, "Ableton: Live's click notes go straight into the lanes (" + (N && N.length) + ")");
    if (N) { ok(N[0].a === 1 && N[4].a === 1 && N[1].a === 0, "…the accents (Live's beat-1 / MetronomeUp notes) on the Accent lane");
      ok(N[1].v === 90 && N[3].v === 60, "…with their velocities");
      ok(N[2].tk === Math.round((1.5 + 0.5 / PPQ) * PPQ), "…a note less than a tick off the 16th grid stays where it is: " + N[2].tk);
      ok(N[3].tk === Math.round(2.25 * PPQ), "…one more than a tick off is snapped to the 16th (8b): " + N[3].tk); } }

  // ================================================================ versions: merge, play, unmerge
  { const ver = SL10c.variantOf("GARDEN (EXTENDED INTRO)", ["GARDEN", "GARDENS"]); ok(ver && ver.main === "GARDEN" && ver.name === "Extended intro", "GARDEN (EXTENDED INTRO) is a version of GARDEN, named “Extended intro”: " + JSON.stringify(ver));
    const v2 = SL10c.variantOf("PROXIMA II (EXTENDED INTRO)", ["PROXIMA", "PROXIMA II"]); ok(v2 && v2.main === "PROXIMA II", "the longest name wins (PROXIMA II, not PROXIMA)");
    ok(!SL10c.variantOf("GARDEN PARTY", ["GARDEN"]), "GARDEN PARTY isn't a version of GARDEN");
    ok(["ALT", "ACOUSTIC", "RADIO EDIT", "LIVE", "V2", "(2)", "SHORT"].every((w) => SL10c.variantOf("SONG " + w, ["SONG"])), "the variant words: ALT, ACOUSTIC, RADIO EDIT, LIVE, V2, (2), SHORT"); }
  { // two songs: "Satellites" and "Satellites (Extended intro)" (a copy with another tempo and one track less)
    const a = S("sat"); dupSong(a.id); const b = songs[songs.length - 1]; b.name = "Satellites (Extended intro)"; b.tmap[0].bpm = 133; b.tracks = b.tracks.filter((t) => t !== "Guitars"); buildBars(b); refresh();
    const inSet = setOrder.includes(a.id); if (inSet) { setOrder.splice(setOrder.indexOf(a.id), 1, b.id); refresh(); } // the set plays the variant
    const sug = SL10c.suggest(songs.map((s) => s.name)); ok(sug.some((x) => x.other === b.name && x.main === a.name && x.name === "Extended intro"), "suggested: merge Satellites (Extended intro) into Satellites");
    const n0 = songs.length, r = SL10c.merge(a.id, [{ id: b.id, name: "Extended intro" }]); await frames(1);
    const A = S(a.id), v = versOf(A).find((x) => x.name === "Extended intro");
    ok(!r.error && songs.length === n0 - 1 && v && v.own, "merged: one song less, a version with its own timeline");
    ok(!inSet || (setOrder.includes(A.id) && entryVerId(A) === v.id), "the setlist now plays Satellites with that version (nothing changes in what plays)");
    const f = verFields(A, v); ok(f.tmap[0].bpm === 133 && !f.tracks.includes("Guitars"), "what plays for the version: its own tempo and tracks");
    showVer(A, v.id); buildBars(A); ok(A.tmap[0].bpm === 133 && !A.tracks.includes("Guitars") && curVer(A).id === v.id, "showing the version swaps in its timeline");
    showVer(A, defVer(A).id); ok(A.tmap[0].bpm !== 133 && A.tracks.includes("Guitars"), "…and back to the main one");
    const L = SLMenus.objItems("song", A.id).find((x) => x.label === "Versions").sub.map((x) => x.label).filter(Boolean); ok(L.includes("Extended intro"), "Versions ▾ lists it: " + L.join(", "));
    // unmerge
    showVer(A, v.id); const n = SL10c.unmerge(A); await frames(1);
    ok(n && n.name === "Satellites (Extended intro)" && n.tmap[0].bpm === 133 && !versOf(S(a.id)).some((x) => x.own), "Unmerge version: its own song again");
    ok(!inSet || setOrder.includes(n.id), "…and the setlist plays it again");
    undo(); await frames(1); ok(versOf(S(a.id)).some((x) => x.own) && !songs.some((s) => s.name === "Satellites (Extended intro)"), "undo: merged again");
    undo(); await frames(1); ok(songs.some((s) => s.name === "Satellites (Extended intro)") && !versOf(S(a.id)).some((x) => x.own), "undo: two songs again"); }
  { // a setlist with both (as Live's own arrangement has): merged; the setlist keeps the main song once, at the first place
    const a = S("copper"); dupSong(a.id); const b = songs[songs.length - 1]; b.name = "Copper Sun (Live)"; if (!setOrder.includes(a.id)) setOrder.push(a.id); setOrder.splice(0, 0, b.id); refresh();
    const n0 = setOrder.length, ib = setOrder.indexOf(b.id);
    const r = SL10c.merge(a.id, [{ id: b.id, name: "Live" }]);
    ok(!r.error && setOrder.length === n0 - 1 && setOrder.indexOf(a.id) === ib && r.merged[0].both.length === 1, `both in one setlist: merged, the main song kept once at the first place (${setOrder.indexOf(a.id)} vs ${ib})`);
    undo(); await frames(1); }

  // ================================================================ sections from cues
  { const s = S("paper"); const keep = JSON.stringify(s.secs); snap(); s.secs = []; s.cues = [{ id: "c1", bar: 1, beat: 1, text: "One" }, { id: "c2", bar: 1, beat: 2, text: "Two" }, { id: "c3", bar: 3, beat: 1, text: "Verse" }, { id: "c4", bar: 11, beat: 1, text: "Chorus" }, { id: "c5", bar: 19, beat: 1, text: "Go" }, { id: "c6", bar: 19, beat: 1, text: "Bridge" }];
    normSecs(s); buildBars(s); refresh(); openSong(s.id); await wait(250);
    const ghosts = [...document.querySelectorAll(`.row.secs > .lane[data-song="${s.id}"] .gsec11 span`)].map((g) => g.textContent); // 11: the suggested sections
    ok(ghosts.join() === "Intro,Verse,Chorus,Bridge", "ghost sections in the empty Sections lane (count words skipped): " + ghosts.join());
    const go = document.querySelector(`.sug11 [data-gs="${s.id}"]`), bar = document.querySelector(`.sug11[data-song="${s.id}"]`); ok(go && /Use them/.test(go.textContent) && bar && /4 sections suggested/.test(bar.textContent), "11: “4 sections suggested from your cues · Use them” in a bar above the row");
    ok(!!document.querySelector(`.lhcues10[data-song="${s.id}"]`), "“From cues” in the Sections header");
    go.click(); await frames(2); ok(S("paper").secs.map((x) => `${x.name}@${x.start}+${x.bars}`).join() === `Intro@1+2,Verse@3+8,Chorus@11+8,Bridge@19+${S("paper").total - 18}`, "made: " + S("paper").secs.map((x) => `${x.name}@${x.start}+${x.bars}`).join());
    undo(); await frames(2); ok(!S("paper").secs.length, "undo takes them away");
    // Edit…: untick Chorus as a section word, keep my sections and fill the gaps
    SLSecs.editor(S("paper")); await frames(1); const ed = document.getElementById("secEd10"); ok(!!ed && /Cue words found/.test(ed.textContent), "Edit… shows the cue words found");
    const w = ed.querySelector('[data-w="chorus"]'); w.checked = false; w.dispatchEvent(new Event("change")); await frames(1);
    ok(/Make these 3 sections/.test(document.querySelector('#secEd10 [data-a="ok"]').textContent), "…unticking a word takes its section out");
    document.querySelector('#secEd10 [data-a="ok"]').click(); await frames(1); ok(S("paper").secs.map((x) => x.name).join() === "Intro,Verse,Bridge", "…and makes the others");
    closeSong(); await wait(100);
    // several songs at once
    const two = [S("neon"), S(Q)]; two.forEach((x) => { x.secs = []; x.cues = [{ id: "a", bar: 1, text: "Intro" }, { id: "b", bar: 5, text: "Verse 1" }]; normSecs(x); buildBars(x); }); refresh();
    const n = SLSecs.batch(two); ok(n === 2 && two.every((x) => S(x.id).secs.length === 2), "Make sections from cues for several songs at once");
    undo(); await frames(1); ok(!S("neon").secs.length, "…undo"); s.secs = JSON.parse(keep); }
  return { problems: P, log };
}
