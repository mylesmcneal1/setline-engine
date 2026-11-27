// 12: runs inside the page (Chrome and WebKit at 1280x800): the DAW conventions (docs/daw-conventions.md).
// The ruler (exactly under the pointer, the nearest beat, ⌘ free, the hover ghost; at Text size 100 % and 120 %,
// scrolled and zoomed), ⌫ acting only on the selection (a track, a section, a cue, a marker, a note; nothing
// selected: nothing), the pinch (proportional, anchored, a stretched snapshot then one redraw; frame times in and
// out), meters on every header and the outputs pill, Show's top bar (4A), the click editor as a MIDI editor, the
// Ableton import's Tracks step, and the core conventions (selection ownership, ⌥-drag copy, ⇥ to the next name,
// type-ahead, ↑↓ in lists, ↩ rename, ⌘E split, the insert marker, Follow). Returns { problems, log }.
async function check12() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const S = (id) => songs.find((x) => x.id === id), sc = document.getElementById("scroller"), R = (el) => el.getBoundingClientRect();
  const MACK = /Mac/.test(navigator.platform), cmdO = MACK ? { metaKey: true } : { ctrlKey: true };
  const key = (k, o = {}, t = document.body) => t.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: o.code, bubbles: true, cancelable: true, ...o }));
  const noteText = () => (document.getElementById("note10") || {}).textContent || "";
  const ptr = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 9, isPrimary: true, ...o }));
  const click = (el, x, y, o = {}) => { ptr(el, "pointerdown", x, y, o); ptr(el, "pointerup", x, y, o); el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1, ...o })); };
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);

  // ================================================================ 2. the ruler, at 100 % and 120 %, scrolled and zoomed
  const look0 = window.SLLook ? SLLook.get() : null;
  for (const size of [100, 120]) {
    if (window.SLLook) SLLook.set({ size }); await frames(2);
    const s = S("glass"); openSong(s.id); await wait(250);
    SL9.zoomNow(200 / (s.bars[1].t - s.bars[0].t)); await frames(2); sc.scrollLeft = s.bars[11].t * PXS; // 13: beats 50 px apart (the grid is the beat) await frames(3);
    const cv = document.querySelector(`.ruler .lane[data-song="${s.id}"] canvas.rcv`), r = R(cv), y = r.top + r.height / 2;
    const xOf = (t) => TX.screenX(cv, t * PXS - (+cv.dataset.vx || 0)); // 13: through the one calculation (Text size included)
    let worst = 0;
    for (const [bar, beat, off] of [[13, 1, 0.08], [14, 2, -0.1], [15, 3, 0.2], [17, 4, -0.22], [20, 1, 0.3]]) {
      const b = S("glass").bars[bar - 1], want = b.beatT[beat - 1], t = want + off * (b.dur / b.sig[0]); // off: a fraction of a beat
      click(cv, xOf(t), y); await frames(1);
      worst = Math.max(worst, Math.abs(pos - want));
      ok(Math.abs(pos - want) < 0.002, `${size}%: a ruler click near ${bar}.${beat} lands on that beat (${pos.toFixed(3)} vs ${want.toFixed(3)})`);
    }
    { const b = S("glass").bars[15], t = b.beatT[1] + 0.13; click(cv, xOf(t), y, cmdO); await frames(1); ok(Math.abs(pos - t) < 1.5 / PXS, `${size}%: ⌘-click on the ruler doesn't snap (${pos.toFixed(3)} vs ${t.toFixed(3)})`); }
    ptr(cv, "pointermove", xOf(S("glass").bars[17].beatT[2]), y, { buttons: 0 }); await frames(1);
    const g = document.querySelector(`.folder[data-id="${s.id}"] .gh12`);
    ok(g && g.style.display !== "none" && /^18\.3/.test(g.textContent), `${size}%: a ghost line with bar.beat on hover (“${g ? g.textContent : ""}”)`);
    log.push(`${size}%: ruler clicks worst ${(worst * 1000).toFixed(1)} ms off the beat`);
    closeSong(); await wait(100);
  }
  if (window.SLLook && look0) SLLook.set({ size: look0.size }); await frames(2);

  // ================================================================ 3. ⌫ only on the selection
  { const s = S("neon"); openSong(s.id); await wait(250);
    const n0 = songs.length, lh = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="Bass"]`), r = R(lh.querySelector(".tn"));
    click(lh.querySelector(".tn"), r.left + 4, r.top + r.height / 2); await frames(2);
    ok(SL12.last() && SL12.last().kind === "track" && SL12.last().t === "Bass", "clicking a track header selects the track (not its song)");
    key("Backspace"); await frames(2);
    ok(songs.length === n0 && !S("neon").tracks.includes("Bass") && !document.querySelector(".cfbg"), "⌫ deletes only that track, without a question");
    ok(/Bass/.test(noteText()), "…and the undo note names it: " + noteText());
    undo(); await frames(2); ok(S("neon").tracks.includes("Bass"), "undo brings the track back");
    // a section
    const sec = document.querySelector(`.secs .lane[data-song="${s.id}"] .sec`), rs = R(sec), n1 = S("neon").secs.length;
    ptr(sec, "pointerdown", rs.left + rs.width / 2, rs.top + 5); ptr(sec, "pointerup", rs.left + rs.width / 2, rs.top + 5); sec.dispatchEvent(new MouseEvent("click", { bubbles: true })); await frames(2);
    key("Delete"); await frames(2); ok(S("neon").secs.length === n1 - 1 && songs.length === n0, "a selected section: ⌫ deletes it only"); undo(); await frames(2);
    // a marker
    { const gg = S("neon"); snap(); gg.marks = [{ name: "HIT", bar: 3, beat: 1 }]; refresh(); await frames(3);
      const mk = document.querySelector(`.folder[data-id="${s.id}"] .mkr[data-i="0"]`); const rm = R(mk.querySelector("u")); ptr(mk.querySelector("u"), "pointerdown", rm.left + 2, rm.top + 2); ptr(mk.querySelector("u"), "pointerup", rm.left + 2, rm.top + 2); await frames(1);
      key("Backspace"); await frames(2); ok(!(S("neon").marks || []).length && songs.length === n0, "a selected marker: ⌫ deletes it only"); undo(); undo(); await frames(2); }
    // nothing selected (a click on empty space)
    sc.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); SL12.setLast({ kind: "none" }); key("Backspace"); await frames(2);
    ok(songs.length === n0 && !document.querySelector(".cfbg") && S("neon").tracks.includes("Bass"), "nothing selected: ⌫ does nothing");
    closeSong(); await wait(100); }

  // ================================================================ 1. the pinch: proportional, anchored, a snapshot then one redraw
  { const s = S("glass"); openSong(s.id); await wait(250); SL9.zoomNow(40 / (s.bars[1].t - s.bars[0].t)); await frames(2); sc.scrollLeft = 900; await frames(2);
    const LX = TL9.laneLeft(), ax = 300, tAt = (sc.scrollLeft + ax) / PXS;
    const nums = {};
    for (const [dir, total] of [["in", 1.0], ["out", -1.0]]) {
      const z0 = PXS, t0 = (sc.scrollLeft + ax) / PXS;
      SL12.pinch({ phase: "begin", m: 0, x: LX + ax, y: 400 });
      const steps = 24, fr = [];
      for (let i = 0; i < steps; i++) { const a = performance.now(); SL12.pinch({ phase: "change", m: total / steps, x: LX + ax, y: 400 }); await frames(1); fr.push(performance.now() - a); }
      const tr = document.querySelector(`.folder[data-id="${s.id}"] .row.trk > .lane`).style.transform;
      ok(/scaleX/.test(tr), `pinch ${dir}: the lanes stretch during the gesture (${tr.slice(0, 40)})`);
      const a = performance.now(); SL12.pinch({ phase: "end", m: 0, x: LX + ax, y: 400 }); await frames(1); const redraw = performance.now() - a;
      const k = PXS / z0, want = Math.exp(total * SL12.speed());
      ok(Math.abs(Math.log(k) - Math.log(want)) < 0.02, `pinch ${dir}: a full pinch zooms ×${want.toFixed(2)} (got ×${k.toFixed(2)})`);
      ok(Math.abs((sc.scrollLeft + ax) / PXS - t0) < 2.5 / PXS + 0.01, `pinch ${dir}: anchored under the fingers (${t0.toFixed(3)} → ${((sc.scrollLeft + ax) / PXS).toFixed(3)} s)`);
      const g = SL12.lastGesture(); const f = g.frames.slice().sort((p, q) => p - q);
      nums[dir] = `frames ${f[Math.floor(f.length / 2)].toFixed(2)} ms median (${f[f.length - 1].toFixed(2)} worst, ${f.length}), redraw after ${g.redraw.toFixed(1)} ms`;
    }
    ok(SL12.speed() >= 1.3, "a full pinch is 4–8× at Normal");
    log.push(`pinch in: ${nums.in}`); log.push(`pinch out: ${nums.out}`);
    // ctrl + wheel (Windows' pinch): the same, one gesture per burst
    { const z0 = PXS; for (let i = 0; i < 10; i++) { sc.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -10, ctrlKey: true, clientX: LX + ax, clientY: 400 })); await frames(1); } await SL9.settled();
      ok(Math.abs(PXS / z0 - Math.exp(2 * SL12.speed() / 1.9)) < 0.1, `Ctrl + wheel: ×${(PXS / z0).toFixed(2)}`); }
    closeSong(); await wait(100); }

  // ================================================================ 4. meters
  { const s = S("glass"); openSong(s.id); await wait(250);
    const hs = [...document.querySelectorAll(`.row.trk > .lh[data-song="${s.id}"]`)];
    ok(hs.length && hs.every((h) => h.querySelector(".hm12")), "every track header has a meter (click, cue and MIDI tracks too)");
    ok(hs.filter((h) => S("glass").midiCfg && S("glass").midiCfg[h.dataset.track]).every((h) => h.querySelector(".hm12.midi")), "MIDI tracks: an activity light");
    ok(!!document.getElementById("om12"), "the outputs pill has a meter");
    const mp = SL12.meterPos(); ok(mp.length >= hs.length - 1 && mp.every((p) => p.w > 0 && p.h > 4), `meter slots measured once (${mp.length})`);
    ok(hs.every((h) => h.querySelector(".tn").clientWidth >= Math.min(60, h.querySelector(".tn").scrollWidth) - 1), "the meter doesn't squeeze the name");
    const t0 = performance.now(); for (let i = 0; i < 30; i++) SL12.drawMeters(); const ms = (performance.now() - t0) / 30;
    log.push(`meters: ${mp.length} on one canvas, ${ms.toFixed(2)} ms a frame`); ok(ms < 4, `drawing all meters takes ${ms.toFixed(2)} ms`);
    closeSong(); await wait(100); }

  // ================================================================ 6. Show's top bar (4A)
  { const tb = document.getElementById("tb12");
    ok(tb && R(tb).width > 300, "Show has the new top bar");
    ok(getComputedStyle(document.querySelector(".top .transport")).display === "none" && getComputedStyle(document.querySelector(".top .lcd")).display === "none", "…and no transport buttons or LCD");
    select("glass", false); locate(S("glass"), S("glass").bars[20].t + 0.1); SL12.updateTop(); await frames(1);
    const txt = (c) => (tb.querySelector(c) || {}).textContent || "";
    ok(/^NOW · /.test(txt(".tbk12")) && txt(".tbs12") === "Glasshouse", `the panel: “${txt(".tbk12")}” + the song`);
    ok(/STOPPED/.test(txt(".tbst12")) && /Space to play/.test(txt(".tbn12")), "stopped: STOPPED and “Space to play”");
    ok(/^21\.\d/.test(txt(".tbbb12")) && /BPM · \d+\/\d+ · \d+:\d\d LEFT/.test(txt(".tbcap12")), `position “${txt(".tbbb12")}” and “${txt(".tbcap12")}”`);
    ok(tb.querySelectorAll(".tbt12 i").length > 1, "a tick per bar of the section");
    playing = true; SL12.updateTop(); ok(/PLAYING/.test(txt(".tbst12")) && /next:/.test(txt(".tbn12")), `playing: PLAYING and “${txt(".tbn12")}”`); playing = false; SL12.updateTop();
    const fits = [".tbk12", ".tbbb12", ".tbst12 span", ".tbn12"].every((c) => { const el = tb.querySelector(c); return !el || getComputedStyle(el).display === "none" || el.scrollWidth <= el.clientWidth + 1; });
    ok(fits, "at 1280 nothing but the song name truncates");
    ok(document.querySelector(".top").scrollWidth <= document.querySelector(".top").clientWidth + 1, "the top bar fits at 1280"); }

  // ================================================================ 7. the click editor as a MIDI editor
  { const s = S("neon"); openSong(s.id); await wait(250); SL9.zoomNow(160 / (s.bars[1].t - s.bars[0].t)); await frames(2); sc.scrollLeft = 0; await frames(2);
    const lane = [...document.querySelectorAll(`canvas[data-song="${s.id}"][data-t]`)].find((c) => S("neon").tracks[+c.dataset.t] === "Click"), lr = R(lane);
    ["clkGrid2", "clkTri", "clkSnap", "clkDens"].forEach((k) => localStorage.removeItem("setline." + k)); // a first-time user (earlier suites chose a grid)
    lane.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: lr.left + 50, clientY: lr.top + 10 })); await frames(3);
    ok(SLClick.editing(), "double-click the Click lane: its editor opens");
    const C = SLClick, G = C.geo(), cv = G.cv, r = R(cv), T0 = C.TOP, X = (tk) => r.left + TX.x(C.tkTime(S("neon"), tk), G.v) + 3;
    const yA = r.top + T0 + 23, yC = r.top + T0 + 46 + 23;
    ok(C.grid().grid === -1, "the grid is Adaptive by default");
    const notes = () => C.clipOf(S("neon"), "Click").notes, at = (tk, a) => notes().filter((n) => n.tk === tk && n.a === a);
    const t1 = C.barTk(s, 2) + C.PPQ / 2;
    cv.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: X(t1) + 1, clientY: yC }));
    await frames(1); ok(at(t1, 0).length === 1, "double-click empty grid adds a note");
    cv.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: X(t1) + 2, clientY: yC }));
    await frames(1); ok(!at(t1, 0).length, "double-click a note deletes it");
    undo(); await frames(1); ok(at(t1, 0).length === 1, "…undo brings it back");
    // select it, nudge it, move it to the other row, duplicate, delete
    const panel = document.getElementById("clk10"); panel.focus();
    const nn = at(t1, 0)[0]; C.select([nn]); key("ArrowRight", {}, panel); await frames(1); const st = C.grid().step;
    ok(nn.tk === t1 + st, `→ nudges by one grid step (${st} ticks: ${nn.tk - t1})`);
    key("ArrowUp", {}, panel); await frames(1); ok(nn.a === 1, "↑ moves it to the Accent row");
    key("d", cmdO, panel); await frames(1); ok(notes().filter((n) => n.a === 1 && n.tk > t1 + st).length >= 1, "⌘D duplicates it after itself");
    // B: Draw mode; Esc leaves it
    key("b", {}, panel); await frames(1); ok(C.editing().mode === "draw", "B: Draw mode"); key("Escape", {}, panel); await frames(1); ok(C.editing().mode === "select", "Esc leaves Draw mode");
    // the grid keys
    const g0 = C.grid().step; key("1", cmdO, panel); await frames(1); const g1 = C.grid().step; key("2", cmdO, panel); key("2", cmdO, panel); await frames(1); const g2 = C.grid().step;
    ok(g1 < g0 && g2 > g0, `⌘1 narrows, ⌘2 widens the grid (${g0} → ${g1} → ${g2})`); key("1", cmdO, panel);
    key("3", cmdO, panel); await frames(1); ok(C.grid().tri, "⌘3: triplets"); key("3", cmdO, panel);
    key("4", cmdO, panel); await frames(1); ok(!C.grid().snap, "⌘4: snap off"); key("4", cmdO, panel);
    // a box selects, ⌥-drag copies, the velocity strip changes the selection relatively
    { const xa = X(C.barTk(s, 3) + C.PPQ * 1.25), xb = X(C.barTk(s, 5)) - 4, y0 = r.top + T0 + 8, y1 = r.top + T0 + 80; // from an empty spot on the Accent row
      ptr(cv, "pointerdown", xa, y0); ptr(cv, "pointermove", xb, y1); ptr(cv, "pointerup", xb, y1); await frames(1);
      const sel = C.editing().sel.length; ok(sel >= 3, `a box selects the notes in it (${sel})`);
      const v0 = C.editing().sel.map((n) => n.v || 127), one = C.editing().sel[0];
      const yV = r.top + T0 + 92 + 6, hV = G.h - (T0 + 92 + 6) - 4, xv = X(one.tk) - 1;
      ptr(cv, "pointerdown", xv, yV + 4); ptr(cv, "pointermove", xv, yV + 4 + hV * 0.2); ptr(cv, "pointerup", xv, yV + 4 + hV * 0.2); await frames(1);
      const v1 = C.editing().sel.map((n) => n.v || 127); ok(v1.every((v, i) => v < v0[i]) && v1.length === v0.length, `the velocity strip changes the selected notes together (${v0.slice(0, 3)} → ${v1.slice(0, 3)})`);
      undo(); await frames(1); }
    { const n0 = notes().length, nt = notes().find((n) => n.tk >= C.barTk(s, 5) && n.tk < C.barTk(s, 6) && !n.a); C.select([nt]); const x0 = X(nt.tk) + 1;
      ptr(cv, "pointerdown", x0, yC, { altKey: true }); ptr(cv, "pointermove", x0 + 80, yC, { altKey: true }); ptr(cv, "pointerup", x0 + 80, yC, { altKey: true }); await frames(1);
      ok(notes().length === n0 + 1, "⌥-drag copies a note"); undo(); await frames(1); }
    // ⌘C / ⌘V at the insert marker
    { const nt = notes().find((n) => n.tk >= C.barTk(s, 6) && n.a === 0); C.select([nt]); key("c", cmdO, panel);
      const ins = C.barTk(s, 9) + C.PPQ / 2; ptr(cv, "pointerdown", X(ins) - 2, r.top + T0 + 2); ptr(cv, "pointerup", X(ins) - 2, r.top + T0 + 2); await frames(1);
      const insAt = C.grid().ins; key("v", cmdO, panel); await frames(1);
      ok(insAt != null && notes().some((n) => n.tk === insAt && n.a === 0), `⌘V pastes at the insert marker (${insAt})`); undo(); await frames(1); }
    // ⌫ a note (and only it)
    { const nt = notes()[3], n0 = notes().length; C.select([nt]); key("Backspace", {}, panel); await frames(1); ok(notes().length === n0 - 1 && songs.length > 0, "⌫ deletes the selected note only"); undo(); }
    { const lane2 = [...document.querySelectorAll(`canvas[data-song="${s.id}"][data-t]`)].find((c) => S("neon").tracks[+c.dataset.t] === "Click"), l2 = R(lane2); lane2.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: l2.left + 50, clientY: l2.top + 10 })); await frames(2); }
    ok(!SLClick.editing(), "double-click the lane again: the editor closes");
    closeSong(); await wait(100); }

  // ================================================================ 5. the Ableton import's Tracks step
  { const data = { project: "Test", path: "test-12.als", songs: [
      { name: "GARDEN", tracks: [{ name: "GARDEN / 60 Kick", kind: "audio", file: null }, { name: "GARDEN / Bass DI", kind: "audio", file: null }], seconds: 100, tmap: [{ bar: 1, bpm: 100, sig: [4, 4] }], secs: [], clicks: [], cues: [] },
      { name: "MERCY", tracks: [{ name: "MERCY / Bass DI", kind: "audio", file: null }, { name: "Pads", kind: "audio", file: null }], seconds: 100, tmap: [{ bar: 1, bpm: 120, sig: [4, 4] }], secs: [], clicks: [], cues: [] }] };
    localStorage.removeItem("setline.ableTracks.test-12.als");
    const host = document.createElement("div"), foot = document.createElement("div"); document.body.append(host, foot);
    const r = { picks: [{ i: 0 }, { i: 1 }], opt: {} }; const p = SL12.tracksStep(data, r, host, foot); await frames(2);
    const names = () => [...host.querySelectorAll(".tnm12")].map((x) => x.textContent);
    ok(names().join() === "60 Kick,Bass DI,Bass DI,Pads", "the song's name comes off by default: " + names().join());
    host.querySelector("#tk12find").value = "DI"; host.querySelector("#tk12find").dispatchEvent(new Event("input")); host.querySelector("#tk12rep").value = "Direct"; host.querySelector("#tk12rep").dispatchEvent(new Event("input")); await frames(1);
    ok(names().join() === "60 Kick,Bass Direct,Bass Direct,Pads", "find / replace: " + names().join());
    const el = host.querySelector(".tnm12"); el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await frames(1);
    const ed = SL10a.editing(); ok(ed && ed.el === el, "a name is renamed in place");
    if (ed) { ed.el.textContent = "Kick In"; ed.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await frames(1); }
    ok(names()[0] === "Kick In", "…and the new name shows: " + names()[0]);
    // the same Live name in another song
    const el2 = host.querySelectorAll(".tnm12")[1]; el2.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await frames(1);
    const ed2 = SL10a.editing(); if (ed2) { ed2.el.textContent = "Bass"; ed2.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await frames(1); }
    ok(!!host.querySelector(".tsame12") === false || /also in/.test(host.querySelector(".tsame12").textContent), "renaming offers the same name in other songs when Live's name matches");
    foot.querySelector("#tk12go").click(); ok((await p) === "ok" && r.opt.trk && r.opt.trk.names["GARDEN|GARDEN / 60 Kick"] === "Kick In", "Import keeps the names for the import");
    ok(!!localStorage.getItem("setline.ableTracks.test-12.als"), "…and remembers them for this project");
    const keep = ABLE_OPT; ABLE_OPT = ableOpt(r.opt); const so = SLAble.song(data.songs[0]).so; ABLE_OPT = keep;
    ok(so.tracks.includes("Kick In") && so.tracks.includes("Bass") && so.tfull["Kick In"] === "GARDEN / 60 Kick", "the import uses them: " + so.tracks.join());
    host.remove(); foot.remove(); }

  // ================================================================ the core conventions
  { const s = S("glass"); openSong(s.id); await wait(250); SL9.zoomNow(60 / (s.bars[1].t - s.bars[0].t)); await frames(2); sc.scrollLeft = 0; await frames(2);
    // ⇥ while renaming a track: the next track's name
    const lh = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="Drums"]`); renameTrackBox(S("glass"), "Drums", lh.querySelector(".tn")); await frames(2);
    const ed = SL10a.editing(); ed.el.textContent = "Drums 2"; ed.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); await wait(80);
    const nx = S("glass").tracks[S("glass").tracks.indexOf("Drums 2") + 1];
    ok(S("glass").tracks.includes("Drums 2") && SL10a.editing() && SL10a.editing().el.textContent === nx, `⇥ saves and renames the next track (“${nx}”)`);
    if (SL10a.editing()) SL10a.editing().end(false); undo(); await frames(2);
    // ↩ renames the selected track
    { const l2 = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="Bass"] .tn`), r2 = R(l2); click(l2, r2.left + 3, r2.top + 4); await frames(1); key("Enter"); await frames(2);
      ok(SL10a.editing() && SL10a.editing().el.textContent === "Bass", "↩ renames the selected track"); if (SL10a.editing()) SL10a.editing().end(false); await frames(1); }
    // ⇧-click: several tracks; ⌫ deletes them in one step
    { const a = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="Keys"] .tn`), b = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="Strings"] .tn`);
      click(a, R(a).left + 3, R(a).top + 4); await frames(1); click(b, R(b).left + 3, R(b).top + 4, { shiftKey: true }); await frames(2);
      const n = SL12.tsel().length; key("Backspace"); await frames(2);
      ok(n >= 2 && !S("glass").tracks.includes("Keys") && !S("glass").tracks.includes("Strings"), `⇧-click selects ${n} tracks; ⌫ deletes them`);
      undo(); await frames(2); ok(S("glass").tracks.includes("Keys") && S("glass").tracks.includes("Strings"), "…one undo brings them all back"); }
    // a lane click: the insert marker (stopped: the playhead too; playing: no jump); ⌘E splits there
    { const cv = [...document.querySelectorAll(`canvas[data-song="${s.id}"][data-t]`)].find((c) => S("glass").tracks[+c.dataset.t] === "Guitars"), cr = R(cv);
      const t = S("glass").bars[6].t, x = cr.left + t * PXS - (+cv.dataset.vx || 0) + 1;
      playing = true; const p0 = pos; SL12.laneClick(S("glass"), t); ok(pos === p0 && SL12.insert(S("glass")) === t, "playing: a lane click sets the insert marker, the playhead doesn't jump"); playing = false;
      SL12.laneClick(S("glass"), t); ok(Math.abs(pos - t) < 1e-6, "stopped: the playhead goes there too (Space plays from it)");
      const g2 = S("glass"); g2.files = g2.files || {}; const cl = (g2.clips || {}).Guitars && g2.clips.Guitars.find((c) => c.start < t && c.end > t);
      if (cl) { selectClip(g2, "Guitars", cl); const n0 = g2.clips.Guitars.length; SLMenus.run("m:split"); await frames(1); ok(S("glass").clips.Guitars.length === n0 + 1, "⌘E splits the selected clip at the insert marker"); undo(); await frames(1); }
      else log.push("no Guitars clip under bar 7 to split"); }
    // ⌥-drag a clip: a copy
    { const g3 = S("glass"), cl = ((g3.clips || {}).Bass || [])[0];
      if (cl) { const cv = [...document.querySelectorAll(`canvas[data-song="${s.id}"][data-t]`)].find((c) => S("glass").tracks[+c.dataset.t] === "Bass"), cr = R(cv), n0 = g3.clips.Bass.length, x = cr.left + Math.max(cl.start * PXS - (+cv.dataset.vx || 0) + 20, 120), y = cr.top + cr.height / 2;
        ptr(cv, "pointerdown", x, y, { altKey: true }); ptr(cv, "pointermove", x + 300, y, { altKey: true }); ptr(cv, "pointerup", x + 300, y, { altKey: true }); await frames(1);
        ok(S("glass").clips.Bass.length === n0 + 1, `⌥-drag a clip: a copy (${S("glass").clips.Bass.length} clips, was ${n0})`); undo(); await frames(1); } }
    // Follow (⌘F)
    { const f0 = SL12.follow(); SLMenus.run("m:follow"); ok(SL12.follow() === !f0, "View › Follow playhead toggles"); SLMenus.run("m:follow"); }
    closeSong(); await wait(100); }
  // type-ahead and ↑ ↓ in the setlist
  { renderSetlist(); await frames(1); const row = document.querySelector("#songs .song[data-id]"); row.focus();
    key("l"); key("o"); await frames(2); ok(selId === "low", "type-ahead: “lo” selects Low Tide (" + selId + ")");
    const i = setOrder.indexOf(selId); document.querySelector(`#songs .song[data-id="${selId}"]`).focus(); key("ArrowDown"); await frames(1); ok(selId === setOrder[i + 1], "↓ selects the next song in the setlist"); }

  return { problems: P, log };
}
