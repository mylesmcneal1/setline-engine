// 14: runs inside the page (Chrome and WebKit at 1280x800).
// §1 the break popup from every entry point (+ Break, ⌘B, double-click, Setlist › Edit break…, right-click › Edit…,
//    ⌘K): name chips, length (m:ss / seconds, ▲▼ 5 s, ⇧ 30 s, presets), note, run-out; ↩ saves, Esc cancels, undo;
//    the remote screens and printing see it.
// §2 Sync MIDI: the first song's bar-1 messages for a Quad Cortex, an Axe-Fx III and a generic device; reordering
//    changes them; ⌥ = the selected song; the hover preview; the old sync point becomes a one-time note.
// §4 every "Add…" command, from the menu bar, ⌘K and its other entry points: the item is added and selected.
// §5 (from 9b) one song open at a time: Folders rows, the switch, ⌥⌘←; Cards: double-click opens one song, Esc back.
async function check14() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const S = (id) => songs.find((x) => x.id === id), R = (el) => el.getBoundingClientRect();
  const MAC = /Mac/.test(navigator.platform), cmdO = MAC ? { metaKey: true } : { ctrlKey: true };
  const key = (k, o = {}, t = document.activeElement || document.body) => t.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: o.code, bubbles: true, cancelable: true, ...o }));
  const esc = () => { key("Escape"); document.querySelectorAll(".xm.ctx").forEach((x) => x.remove()); };
  // ⌘K, type, ↩ (runs the first match)
  const palette = async (q) => { key("k", { code: "KeyK", ...cmdO }, document.body); await wait(60); const inp = document.querySelector("#pal10 input"); if (!inp) return false; inp.value = q; inp.dispatchEvent(new Event("input")); await wait(30);
    const first = document.querySelector("#pal10 .pi10"); const label = first ? first.textContent : ""; inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await wait(120); return label; };
  const pd = (el, o = {}) => { const r = R(el), x = r.left + Math.min(30, r.width / 2), y = r.top + r.height / 2; el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 7, ...o })); el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 7 })); el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y })); };
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);
  const L0 = curSetObj(), LB = () => curSetObj().breaks || []; // (undo replaces the setlist objects: always read them fresh)

  // ================================================================ §1 the break popup
  { const brow = (id) => document.querySelector(`#songs .brk9[data-b="${id}"]`), pop = () => SL14B.el(), q = (s) => pop() && pop().querySelector(s);
    select(setOrder[1], false); await frames(2);
    const n0 = LB().length;
    // + Break, then Cancel: nothing added
    document.getElementById("addBreak9").click(); await frames(2);
    ok(SL14B.isOpen() && /New break/.test(q(".bk14t").textContent) && /after Glasshouse/.test(q(".bk14at").textContent), "+ Break opens the popup: “New break · after Glasshouse”");
    ok(document.activeElement === q("#bk14name"), "…with the name field focused");
    const r1 = R(pop()), side = R(document.getElementById("songs"));
    ok(r1.left >= side.right && r1.left - side.right < 40 && r1.bottom <= innerHeight && r1.top >= 0, "…next to the setlist, inside the window: " + [Math.round(r1.left), Math.round(r1.top), Math.round(r1.bottom)]);
    q(".bk14c").click(); await frames(1); ok(!SL14B.isOpen() && LB().length === n0, "Cancel on a new break adds nothing");
    // fields: chips, length typed (m:ss and seconds), arrows, presets, note, run-out; ↩ saves
    document.getElementById("addBreak9").click(); await frames(2);
    [...pop().querySelectorAll(".bk14chips button")].find((b) => b.textContent === "Tuning").click();
    ok(q("#bk14name").value === "Tuning" && q(".bk14chips button.on").textContent === "Tuning", "a quick label fills the name");
    q("#bk14name").value = "Swap to baritone"; q("#bk14name").dispatchEvent(new Event("input"));
    const len = q("#bk14len"); len.value = "75"; len.dispatchEvent(new Event("input")); len.dispatchEvent(new Event("blur"));
    ok(len.value === "1:15" && q(".bk14pre button.on") && q(".bk14pre button.on").textContent === "1:15", "“75” reads as 1:15 and lights the 1:15 preset");
    q('.bk14step [data-d="1"]').click(); ok(len.value === "1:20", "▲ adds 5 s: " + len.value);
    q('.bk14step [data-d="1"]').dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); ok(len.value === "1:30", "⇧▲ goes to the next 30 s: " + len.value);
    len.focus(); key("ArrowDown", {}, len); ok(len.value === "1:25", "↓ in the field takes 5 s off: " + len.value);
    len.value = "2:7x"; len.dispatchEvent(new Event("input")); ok(len.classList.contains("bad"), "a length that isn't a time is marked");
    [...pop().querySelectorAll(".bk14pre button")].find((b) => b.textContent === "2:00").click(); ok(len.value === "2:00" && !len.classList.contains("bad"), "a preset sets the length");
    len.value = "1:15"; len.dispatchEvent(new Event("input"));
    q("#bk14note").value = "Brett: baritone, capo off";
    q('.bk14seg [data-r="start"]').click(); ok(q('.bk14seg [data-r="start"]').classList.contains("on"), "When the time runs out: Start next song");
    key("Enter", {}, q("#bk14note")); await frames(2);
    const nb = LB().find((b) => b.label === "Swap to baritone");
    ok(!SL14B.isOpen() && nb && nb.len === 75 && nb.note === "Brett: baritone, capo off" && nb.runout === "start" && nb.after === setOrder[1], "↩ saves: " + JSON.stringify(nb));
    ok(nb && SLBreaks.selected() === nb.id && brow(nb.id) && brow(nb.id).classList.contains("on"), "the new break is selected in the setlist");
    // the remote screens, Perform and printing
    const doc = bandShow(), ent = doc.setlist.order.find((o) => o.id === setOrder[1]);
    ok(doc.setlist.breaks.some((b) => b.label === "Swap to baritone" && b.note === "Brett: baritone, capo off" && b.len === 75) && ent && ent.brk && ent.brk[0].wait === false, "the remote screens get the break (label, length, note, auto start)");
    ok(setlistRows(curSetObj()).some((r) => r && r.brk && r.label === "Swap to baritone" && r.len === "1:15"), "the printed setlist has it");
    ok(/Swap to baritone/.test(perfSetlist(S(setOrder[0]))), "Perform's setlist has it");
    undo(); await frames(2); ok(!LB().some((b) => b.label === "Swap to baritone"), "undo removes the new break in one step"); redo(); await frames(2);
    let b1 = LB().find((b) => b.label === "Swap to baritone"); const B1 = () => LB().find((b) => b.id === b1.id) || {};
    // double-click (two presses: the first re-renders the row)
    pd(brow(b1.id)); await frames(1); pd(brow(b1.id)); await wait(30);
    ok(SL14B.isOpen() && /Edit break/.test(q(".bk14t").textContent) && q("#bk14name").value === "Swap to baritone" && q("#bk14len").value === "1:15", "double-clicking a break opens it: Edit break");
    ok(q("#bk14name").selectionStart === 0 && q("#bk14name").selectionEnd === "Swap to baritone".length, "…its name selected");
    q("#bk14name").value = "Baritone"; key("Escape", {}, q("#bk14name")); await frames(1);
    ok(!SL14B.isOpen() && B1().label === "Swap to baritone", "Esc cancels (nothing changed)");
    // Setlist › Edit break… (the selected break)
    SLBreaks.select(b1.id); await frames(1); const eb = SLMenus.flat().find((x) => x.id === "editBreak");
    ok(eb && !eb.dis, "Setlist › Edit break… is on with a break selected"); SLMenus.run("editBreak"); await frames(2);
    ok(SL14B.isOpen() && /Edit break/.test(q(".bk14t").textContent), "Setlist › Edit break… opens the popup");
    q("#bk14note").value = "Nick: capo 2"; q(".bk14ok").click(); await frames(2);
    ok(B1().note === "Nick: capo 2" && bandShow().setlist.breaks.some((b) => b.note === "Nick: capo 2"), "Save changes the break (and the remote screens see it)");
    undo(); await frames(1); ok(B1().note !== "Nick: capo 2", "undo puts the note back"); redo(); await frames(1);
    // right-click › Edit…
    brow(b1.id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: R(brow(b1.id)).left + 20, clientY: R(brow(b1.id)).top + 6 })); await frames(2);
    const ed = [...document.querySelectorAll(".xm.ctx .it")].find((x) => /^Edit…/.test(x.textContent.trim()));
    ok(!!ed, "a break's right-click menu has Edit…"); if (ed) { ed.click(); await frames(2); }
    ok(SL14B.isOpen() && /Edit break/.test(q(".bk14t").textContent), "right-click › Edit… opens the popup"); SL14B.close(); esc();
    // ⌘K
    SLBreaks.select(b1.id); await frames(1);
    const pl = await palette("edit break"); ok(SL14B.isOpen() && /Edit break/.test(q(".bk14t").textContent), "⌘K › Edit break… opens the popup (" + pl + ")"); SL14B.close();
    // ⌘B
    select(setOrder[0], false); await frames(1); document.body.focus(); key("b", { code: "KeyB", ...cmdO }, document.body); await frames(2);
    ok(SL14B.isOpen() && /New break/.test(q(".bk14t").textContent) && /after Neon Rivers/.test(q(".bk14at").textContent), "⌘B opens a new break after the selected song"); SL14B.close();
    // clean up: remove the break
    SLBreaks.del(b1.id); await frames(1); }

  // ================================================================ §2 Sync MIDI
  { const s = S(setOrder[0]); const keep = JSON.stringify({ tracks: s.tracks, midiCfg: s.midiCfg, midi: s.midi });
    const add = (t, cfg, evs) => { if (!s.tracks.includes(t)) s.tracks.push(t); s.midiCfg[t] = { early: "0", ...cfg }; s.midi[t] = evs; (s.secMap || (s.secMap = {}))[t] = {}; };
    s.tracks.filter((t) => isMidiTrack(s, t)).forEach((t) => { s.midi[t] = []; });
    add("Brett", { port: "QC", ch: 1, dev: "qc" }, [SLMod.presetEvent("qc", 129, 0, { bar: 1, beat: 1 }), SLMod.sceneEvent("qc", {}, 3, { bar: 1, beat: 1 }), SLMod.sceneEvent("qc", {}, 5, { bar: 9, beat: 1 })]);
    add("Nick", { port: "AXE", ch: 2, dev: "axe" }, [SLMod.presetEvent("axe", 414, 0, { bar: 1, beat: 1 }), SLMod.sceneEvent("axe", {}, 0, { bar: 1, beat: 1 }), SLMod.presetEvent("axe", 20, 0, { bar: 17, beat: 1 })]);
    add("Lightkey", { port: "LK", ch: 16 }, [{ kind: "pc", pc: 4, bar: 1, beat: 1 }, { kind: "cc", cc: 7, val: 90, bar: 1, beat: 1 }, { kind: "cc", cc: 7, val: 100, bar: 1, beat: 3 }, { kind: "pc", pc: 9, bar: 5, beat: 1 }]);
    buildBars(s); refresh(); await frames(2);
    const p = SL14S.plan(), D = (t) => p.devs.find((d) => d.track === t) || {}, J = (x) => JSON.stringify(x);
    ok(p.song === s, "Sync MIDI plans for the setlist's first song");
    ok(J(D("Brett").msgs) === J([[0xb0, 0, 1], [0xb0, 32, 0], [0xc0, 0], [0xb0, 43, 3]]) && D("Brett").what === "Preset 17A" && /^D/.test(D("Brett").badge.text), "Quad Cortex: CC0 1, CC32 0, PC 0 (preset 17A), CC43 3 (scene D): " + J(D("Brett").msgs));
    ok(J(D("Nick").msgs) === J([[0xb1, 0, 3], [0xc1, 30], [0xb1, 34, 0]]) && D("Nick").what === "Preset 414" && /1/.test(D("Nick").badge.text), "Axe-Fx III on ch 2: CC0 3, PC 30 (preset 414), CC34 0 (scene 1): " + J(D("Nick").msgs));
    ok(J(D("Lightkey").msgs) === J([[0xcf, 4], [0xbf, 7, 100]]) && D("Lightkey").what === "Program 4", "generic on ch 16: PC 4, then CC 7 at its last bar-1 value (100); later changes aren't sent: " + J(D("Lightkey").msgs));
    ok(p.clock.bpm === s.tmap[0].bpm, "the clock: the song's tempo at bar 1 (" + p.clock.bpm + ")");
    ok(J(SLPage.syncMsgs()) === J(p.devs.filter((d) => d.msgs.length).map((d) => ({ port: d.port, msgs: d.msgs }))) && SLPage.syncBpm() === p.clock.bpm, "the app's pedal fast path is armed with the same messages and tempo");
    // one press sends at once
    const r = await SL14S.send(); await frames(2);
    ok(r.song === s.id && window.__sync14last && __sync14last.devs.length === p.devs.length, "one press sends (no confirm)");
    const btn = document.getElementById("syncBtn"); ok(btn && !btn.hidden && /Synced/.test(btn.textContent), "the button says Synced ✓");
    // reordering: another first song, the button is ready again, other messages
    snap(); const a = setOrder.shift(); setOrder.splice(1, 0, a); refresh(); await frames(2);
    const p2 = SL14S.plan(); ok(p2.song.id === setOrder[0] && p2.song !== s && J(p2.devs.map((d) => d.msgs)) !== J(p.devs.map((d) => d.msgs)), "reordering the setlist changes what's sent (now " + p2.song.name + ")");
    ok(!/Synced/.test(btn.textContent), "…and the button isn't “Synced” any more");
    undo(); await frames(2); ok(SL14S.plan().song.id === s.id, "undo: the first song again"); const s2 = S(s.id);
    // editing the first song's bar-1 MIDI changes it too
    s2.midi.Lightkey[0].pc = 6; refresh(); await frames(1); ok(J((SL14S.plan().devs.find((d) => d.track === "Lightkey") || {}).msgs) === J([[0xcf, 6], [0xbf, 7, 100]]), "a changed bar-1 program change is what's sent");
    // ⌥-click: the selected song
    select(setOrder[2], false); await frames(1); btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true })); await wait(60);
    ok(__sync14last.song === setOrder[2], "⌥-click syncs to the selected song");
    // the remote screens' Sync MIDI
    await SLPage.band.syncMidi(); await wait(30); ok(__sync14last.song === s.id, "the remote screen's Sync MIDI sends the first song");
    // hover: the preview
    btn.dispatchEvent(new MouseEvent("mouseenter")); await wait(450); const pv = SL14S.previewEl();
    ok(pv && /Sync MIDI to the first song/.test(pv.textContent) && /Brett · Quad Cortex/.test(pv.textContent) && /Preset 17A/.test(pv.textContent) && /MIDI clock/.test(pv.textContent) && /position bar 1/.test(pv.textContent), "hovering shows what each device gets");
    if (pv) { const pr = R(pv); ok(pr.right <= innerWidth && pr.bottom <= innerHeight && pr.left >= 0, "the preview fits in the window"); }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", altKey: true })); await frames(1);
    ok(SL14S.previewEl() && /selected song/.test(SL14S.previewEl().textContent), "holding ⌥ previews the selected song");
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" })); SL14S.hidePreview();
    // the old sync point: what the first song doesn't send becomes a one-time note
    curSetObj().sync = { devices: [{ port: "QC", ch: 1, text: "PC 0\nCC 99 1" }] }; const notes = SL14S.migrate(); await wait(700);
    const box = [...document.querySelectorAll(".cfbg .sy14note")].pop();
    ok(!curSetObj().sync && curSetObj().syncOld && notes.length === 1 && J(notes[0].left) === J(["QC · ch 1: CC 99 1"]), "an old sync point goes; only what bar 1 doesn't send is noted: " + J(notes));
    ok(box && /CC 99 1/.test(box.textContent) && !/PC 0/.test(box.textContent), "…in a one-time note"); if (box) box.querySelector("[data-a=ok]").click();
    ok(SL14S.migrate().length === 0, "the note isn't shown again");
    openSettings("midi"); await wait(250); const sb = document.getElementById("sbody"); ok(sb && !/Sync point for/.test(sb.textContent) && !document.getElementById("stSadd") && /first song needs at bar 1/.test(sb.textContent), "Settings › MIDI: no per-setlist sync point any more"); closeSettings && closeSettings();
    Object.assign(S(s.id), JSON.parse(keep)); refresh(); await frames(1); }

  // ================================================================ §4 every Add… command
  { const s = S("glass"); openSong(s.id); await wait(250);
    let bar = 26; const here = () => { do bar += 3; while (s.tmap.some((x) => x.bar === bar) || (s.marks || []).some((m) => m.bar === bar) || s.secs.some((x) => x.start === bar)); pos = s.bars[bar - 1].t; };
    const sel = { track: (t) => trackOpen && trackOpen.song === s.id && trackOpen.track === t, sec: (id) => selSec && selSec.id === id };
    const trackRun = async (k, how) => { const b = s.tracks.slice(); await how(); await frames(2); const nw = s.tracks.filter((t) => !b.includes(t)); return nw[0] || null; };
    const cases = [];
    // tracks: click, MIDI (menu, ⌘K, the "＋ … track" buttons under the lanes); audio (files: in the app)
    for (const [k, label, pal] of [["click", "Add click track", "add click track"], ["midi", "Add MIDI track", "add midi track"]]) {
      let t = await trackRun(k, () => SLMenus.run(k === "click" ? "addClick" : "addMidi")); ok(t && sel.track(t), `Track › ${label} adds a track and selects it (${t})`);
      t = await trackRun(k, () => palette(pal)); ok(t && sel.track(t), `⌘K ${label} adds and selects (${t})`);
      const btn = document.querySelector(`.addT[data-k="${k}"][data-song="${s.id}"]`); t = btn ? await trackRun(k, () => btn.click()) : null; ok(t && sel.track(t), `the “＋ ${k === "click" ? "Click" : "MIDI"} track” button adds and selects (${t})`);
    }
    { let asked = null; const A = window.addTrack; window.addTrack = function (so, k) { if (k === "audio") { asked = so && so.id; return; } return A.apply(this, arguments); };
      SLMenus.run("addAudio"); await frames(1); ok(asked === s.id, "Track › Add audio track asks for files for the open song (the app adds them as tracks, selected)"); asked = null;
      key("t", { code: "KeyT", ...cmdO }, document.body); await frames(1); ok(asked === s.id, "⌘T does too"); window.addTrack = A; }
    // a section: the menu, ⌥⌘S, ⌘K, the ＋ by the sections lane
    for (const [how, fn] of [["Song › Add section", () => SLMenus.run("addSection")], ["⌥⌘S", () => key("s", { code: "KeyS", altKey: true, ...cmdO }, document.body)], ["⌘K Add section", () => palette("add section")]]) {
      here(); const ids = new Set(s.secs.map((x) => x.id)); await fn(); await frames(2); const nw = s.secs.find((x) => !ids.has(x.id));
      ok(nw && sel.sec(nw.id) && nw.start === bar, `${how}: a section at the playhead (bar ${bar}), selected: ${nw && nw.start}`); esc(); await frames(1); }
    { here(); const ids = new Set(s.secs.map((x) => x.id)), b = document.querySelector(`.lhadd[data-song="${s.id}"]`); if (b) b.click(); await frames(2); const nw = s.secs.find((x) => !ids.has(x.id)); ok(!!b && nw && sel.sec(nw.id), "the ＋ by the Sections lane adds a section and selects it"); esc(); }
    // a tempo change: the menu, ⌥⌘T, ⌘K
    for (const [how, fn] of [["Song › Add tempo change…", () => SLMenus.run("addTempo")], ["⌥⌘T", () => key("t", { code: "KeyT", altKey: true, ...cmdO }, document.body)], ["⌘K Add tempo change", () => palette("add tempo change")]]) {
      here(); const n = s.tmap.length; await fn(); await frames(2); const e = s.tmap.find((x) => x.bar === bar && x.bpm);
      ok(s.tmap.length === n + 1 && e && tsel && tsel.song === s.id && s.tmap[tsel.i] === e && SL11.current() && SL11.current().kind === "tempo", `${how}: a tempo change at bar ${bar}, selected`); if (typeof closeTpop === "function") closeTpop(); }
    // a time signature: the menu, ⌥⌘M, ⌘K (the popup's Add)
    for (const [how, fn] of [["Song › Add time signature…", () => SLMenus.run("addMeter")], ["⌥⌘M", () => key("m", { code: "KeyM", altKey: true, ...cmdO }, document.body)], ["⌘K Add time signature", () => palette("add time signature")]]) {
      here(); await fn(); await frames(2); const okb = document.getElementById("mpOk"); if (okb) { document.querySelector('#mpop [data-k="n-"]').click(); document.getElementById("mpOk").click(); } await frames(2);
      const e = s.tmap.find((x) => x.bar === bar && x.sig); ok(!!okb && e && SL11.current() && SL11.current().kind === "meter" && SL11.current().b === bar, `${how}: a time signature at bar ${bar}, selected`); }
    // a marker: the menu, ⌘K
    for (const [how, fn] of [["Song › Add marker…", () => SLMenus.run("addMarker")], ["⌘K Add marker", () => palette("add marker")]]) {
      here(); const n = (s.marks || []).length; await fn(); await frames(2); const c = SL11.current();
      ok((s.marks || []).length === n + 1 && c && c.kind === "marker" && s.marks[c.b].bar === bar && document.querySelector(`.folder[data-id="${s.id}"] .mkr.sel14`), `${how}: a marker at bar ${bar}, selected`); esc(); }
    // a version: the menu, ⌘K, ＋ Version
    for (const [how, fn] of [["Song › New version", () => SLMenus.run("newVersion")], ["⌘K New version", () => palette("new version")], ["＋ Version", async () => { if (focusId !== s.id) { openSong(s.id); await wait(250); } const b = document.querySelector(`.vstrip .vadd[data-song="${s.id}"]`); if (b) b.click(); }]]) {
      const ids = new Set((s.versions || []).map((v) => v.id)); await fn(); await frames(2); const nw = (s.versions || []).find((v) => !ids.has(v.id));
      ok(nw && s.ver === nw.id, `${how}: a version, now the one shown`); esc(); }
    closeSong(); await wait(150);
    // a break: the menu, ⌘K (the popup, then ↩)
    for (const [how, fn] of [["Setlist › Add break", () => SLMenus.run("addBreak")], ["⌘K Add break", () => palette("add break")]]) {
      select(setOrder[0], false); await frames(1); const n = (curSetObj().breaks || []).length; await fn(); await frames(2); const nm = SL14B.el() && SL14B.el().querySelector("#bk14name");
      if (nm) { nm.value = "Talk"; key("Enter", {}, nm); } await frames(2); const L = curSetObj().breaks || [];
      ok(L.length === n + 1 && SLBreaks.selected() === L[L.length - 1].id || L.some((b) => b.id === SLBreaks.selected() && b.label === "Talk"), `${how}: a break, selected`); }
    // a song: File › New song…, ⌘K, ＋ Song › New song…
    for (const [how, fn] of [["File › New song…", () => SLMenus.run("newSong")], ["⌘K New song", () => palette("new song")], ["＋ Song › New song…", async () => { document.getElementById("addSong9").click(); await frames(1); document.getElementById("pickNew9").click(); }]]) {
      const n = songs.length; await fn(); await wait(80); const nm = document.getElementById("mName"); if (nm) { nm.value = "Added " + n; document.getElementById("mAdd").click(); } await wait(300);
      const nw = songs[songs.length - 1]; ok(songs.length === n + 1 && nw.name === "Added " + n && selId === nw.id, `${how}: a song, selected`); }
    // a setlist: File › New setlist, ⌘K, ⇧⌘N
    for (const [how, fn] of [["File › New setlist", () => SLMenus.run("newSetlist")], ["⌘K New setlist", () => palette("new setlist")], ["⇧⌘N", () => key("n", { code: "KeyN", shiftKey: true, ...cmdO }, document.body)]]) {
      const n = setlists.length; await fn(); await frames(2); key("Escape"); await frames(1);
      ok(setlists.length === n + 1 && curSet === setlists[setlists.length - 1].id, `${how}: a setlist, the current one`); }
    useSet(L0.id); refresh(); await frames(2); }

  // ================================================================ §5 one song open at a time (9b)
  { const A = setOrder[0], B = setOrder[1];
    SL9.setMode("cards"); await wait(150);
    const card = document.querySelector(`.card9[data-id="${B}"]`); card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await frames(2);
    ok(focusId === B && !!document.querySelector("#hBack"), "Cards: double-clicking a card shows that one song");
    key("Escape", {}, document.body); await frames(2); ok(!focusId && !!document.querySelector(".card9"), "Esc goes back to the cards");
    document.querySelector(`#songs .song[data-id="${A}"]`).click(); await frames(2); document.querySelector(`#songs .song[data-id="${B}"]`).click(); await frames(2);
    ok(!focusId || focusId === B, "clicking another setlist song switches to it (" + focusId + ")"); closeSong(); await frames(1);
    SL9.setMode("folders"); await wait(200);
    const one0 = document.getElementById("oneOpen"); if (one0 && !one0.checked) one0.click();
    SL9.toggleRow(A, true); await frames(2); ok(open.has(A) && !!document.querySelector(`.row9[data-row="${A}"] .r9b .trk`), "Folders: opening a row shows its tracks");
    SL9.toggleRow(B, true); await frames(2);
    ok(open.has(B) && !open.has(A) && !document.querySelector(`.row9[data-row="${A}"] .r9b .trk`), "one song open at a time (on by default): opening the second closed the first");
    const one = document.getElementById("oneOpen"); one.click(); SL9.toggleRow(A, true); await frames(2);
    ok(open.has(A) && open.has(B), "with the switch off both stay open");
    one.click(); await frames(1); ok(open.size === 1, "switching it back on keeps one open");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", altKey: true, ...cmdO, bubbles: true })); await frames(2);
    ok(open.size === 0 && !document.querySelector(".row9 .r9b .trk"), "⌥⌘← collapses every row");
    SL9.setMode("cards"); await wait(150); }

  log.push("breaks " + LB().length + " · setlists " + setlists.length + " · songs " + songs.length);
  return { problems: P, log };
}
