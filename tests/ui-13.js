// 13: runs inside the page (Chrome and WebKit at 1280x800). Section A first:
// §1 the sweep: for many beats across a song with tempo and meter changes, at several zoom levels, scrolled, in one
//    song and in Folders, plus the click editor: the drawn beat line's centre, a synthetic click on that x (the
//    playhead / the insert line) and the hover line agree within 1 px. 30 % into a bar lands on its start, 70 % on
//    the next bar's.
// §2 double-clicking a click note deletes it (several zooms), empty grid adds one, the first click adds nothing.
// Returns { problems, log }.
async function check13() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const sc = document.getElementById("scroller"), R = (el) => el.getBoundingClientRect();
  const ptr = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" || type === "pointermove" ? 0 : 1, pointerId: 9, isPrimary: true, ...o }));
  const click = (el, x, y, o = {}) => { ptr(el, "pointerdown", x, y, o); ptr(el, "pointerup", x, y, o); el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1, ...o })); };
  const dbl = (el, x, y) => { for (const d of [1, 2]) { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 9, detail: d })); el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 9, detail: d })); el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: d })); } el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2 })); };
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  const look0 = window.SLLook ? SLLook.get() : null;

  // a test song with tempo and meter changes (4/4 120 → 7/8 140 at bar 9 → 3/4 96 at bar 15 → 4/4 128.5 at bar 20)
  const mk = (id, name) => { const so = { id, name, key: "—", col: "#5ac8fa", trans: "stop", tmap: [{ bar: 1, bpm: 120, sig: [4, 4] }, { bar: 9, bpm: 140, sig: [7, 8] }, { bar: 15, bpm: 96, sig: [3, 4] }, { bar: 20, bpm: 128.5, sig: [4, 4] }], secs: [], tracks: ["Click", "Cues"], audio: 120, added: Date.now() };
    normSecs(so); buildBars(so); so.cues = []; return so; };
  snap(); const A = mk("sw13a", "Sweep A"), B = mk("sw13b", "Sweep B"); songs.push(A, B); refresh(); await frames(2);
  const S = (id) => songs.find((x) => x.id === id);

  // the drawn line nearest screen x in a canvas row: the brightest column within ±6 px; its centre on screen
  const lineAt = (cv, y, sx) => {
    const r = R(cv), k = r.width / (cv.offsetWidth || r.width), g = cv.getContext("2d"), dpr = cv.width / (cv.offsetWidth || cv.width);
    const c0 = Math.max(0, Math.floor((sx - r.left) / k * dpr) - 6 * dpr), c1 = Math.min(cv.width - 1, Math.ceil((sx - r.left) / k * dpr) + 6 * dpr);
    if (c1 <= c0) return null; const d = g.getImageData(c0, Math.round(y * dpr), c1 - c0 + 1, 1).data; let best = -1, bv = 0;
    for (let i = 0; i <= c1 - c0; i++) { const v = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] + d[i * 4 + 3]; if (v > bv) { bv = v; best = i; } }
    return best < 0 ? null : r.left + ((c0 + best) / dpr + 0.5 / dpr) * k;
  };
  const centre = (el) => { const r = R(el); return r.left + r.width / 2 + (r.width === 0 ? 0.5 : 0); }; // the ghost is a 1 px border on a 0-wide box

  // ================================================================ §1 the sweep on the timeline
  let worst = 0, n = 0;
  const sweep = async (label, s, folderSel) => {
    const f = document.querySelector(`.folder[data-id="${s.id}"]`); if (!f) { P.push(label + ": the song isn't on screen"); return; }
    const rcv = f.querySelector("canvas.rcv"), cue = [...f.querySelectorAll("canvas[data-t]")].find((c) => s.tracks[+c.dataset.t] === "Cues");
    if (!rcv) { P.push(label + ": no ruler"); return; }
    const vis = (t) => { const x = TX.x(t); return x > 8 && x < TL9.viewW() - 8; };
    const beats = []; s.bars.slice(0, s.total).forEach((b) => b.beatT.forEach((t, i) => { if (vis(t)) beats.push({ t, bar: b.bar, beat: i + 1, b }); }));
    const grid = (b) => TX.gridPoints(s, b), gname = gridName(s);
    const pick = beats.filter((x, i) => i % Math.max(1, Math.floor(beats.length / 14)) === 0).slice(0, 14);
    const H = rcv.height, yR = R(rcv).top + (H - 2) * (R(rcv).height / (rcv.offsetHeight || H));
    for (const p of pick) {
      const onGrid = grid(p.b).some((g) => Math.abs(g - p.t) < 1e-6) || Math.abs(p.b.t + p.b.dur - p.t) < 1e-6; if (!onGrid) continue;
      const want = R(rcv).left + TX.x(p.t) * (R(rcv).width / (rcv.offsetWidth || 1)) + (+rcv.dataset.vx || 0) * 0 - 0; // where the module says it is (screen)
      const drawn = lineAt(rcv, H - 2, R(rcv).left + (TX.songX(p.t) - (+rcv.dataset.vx || 0)) * (R(rcv).width / (rcv.offsetWidth || 1)));
      if (drawn == null) { P.push(`${label}: no line drawn at ${p.bar}.${p.beat}`); continue; }
      // click there on the ruler: the playhead lands on that beat, centred on the drawn line
      if (playing) toggle(); click(rcv, drawn, yR); await frames(1); placePH(); await frames(1);
      const ph = f.querySelector(".ph"), dPos = Math.abs(TX.x(pos) - TX.x(p.t)), dPh = ph && ph.offsetParent ? Math.abs(centre(ph) - drawn) : 0;
      // hover: the ghost line
      ptr(rcv, "pointermove", drawn, yR); await frames(1); const gh = f.querySelector(".gh12"), dGh = gh && gh.style.display !== "none" ? Math.abs(centre(gh) - drawn) : 99;
      // the Cues lane's empty space: the insert line
      let dIns = 0; if (cue && R(cue).height > 4 && R(cue).top > R(sc).top && R(cue).bottom < R(sc).bottom) { const y = R(cue).top + R(cue).height / 2; ptr(cue, "pointerdown", drawn, y); ptr(cue, "pointerup", drawn, y); await frames(1); const ins = SL12.insert(s); dIns = ins == null ? 99 : Math.abs(TX.x(ins) - TX.x(p.t)); }
      const w = Math.max(dPos, dPh, dGh, dIns); worst = Math.max(worst, w); n++;
      if (w > 1) P.push(`${label} ${p.bar}.${p.beat} (${gname}): drawn ${drawn.toFixed(2)} · click ${dPos.toFixed(2)} px off · playhead ${dPh.toFixed(2)} · hover ${dGh.toFixed(2)} · insert ${dIns.toFixed(2)}`);
    }
    // 30 % into a bar lands on its start, 70 % on the next (where the grid is the bar)
    if (gridName(s) === "bar") { const b = s.bars.find((x) => vis(x.t) && vis(x.t + x.dur) && x.bar > 1); if (b) {
      const at = (fr) => R(rcv).left + (TX.songX(b.t + b.dur * fr) - (+rcv.dataset.vx || 0)) * (R(rcv).width / (rcv.offsetWidth || 1));
      click(rcv, at(0.3), yR); await frames(1); ok(Math.abs(pos - b.t) < 1e-3, `${label}: 30 % into bar ${b.bar} lands on its start (${pos.toFixed(3)} vs ${b.t.toFixed(3)})`);
      click(rcv, at(0.7), yR); await frames(1); ok(Math.abs(pos - (b.t + b.dur)) < 1e-3, `${label}: 70 % into bar ${b.bar} lands on the next bar (${pos.toFixed(3)} vs ${(b.t + b.dur).toFixed(3)})`);
      click(rcv, at(0.3), yR, TX.MAC ? { metaKey: true } : { ctrlKey: true }); await frames(1); ok(Math.abs(TX.x(pos) - TX.x(b.t + b.dur * 0.3)) <= 1, `${label}: ⌘-click lands exactly under the pointer`); } }
  };
  const zooms = [["bars", 30], ["beats", 200], ["8ths", 420]]; // px per 4/4 bar at 120: the grid is the bar, the beat, the 8th
  for (const size of [100, 120]) {
    if (window.SLLook) SLLook.set({ size }); await frames(2);
    SL9.setMode("cards"); await wait(150); openSong(A.id); await wait(250);
    for (const [zn, ppb] of zooms) { SL9.zoomNow(ppb / 2); await frames(2); for (const sl of [0, 0.37]) { sc.scrollLeft = sl * Math.max(0, A.len * PXS - TL9.viewW()); await frames(3); await sweep(`${size}% song ${zn} scrolled ${Math.round(sl * 100)}%`, S(A.id)); } }
    closeSong(); await wait(150);
  }
  if (window.SLLook && look0) SLLook.set({ size: look0.size }); await frames(2);
  // Folders: two songs open as rows, the second one scrolled into view
  SL9.setMode("folders"); await wait(200); SL9.state.oneOpen = false; SL9.toggleRow(A.id, true); SL9.toggleRow(B.id, true); await wait(300);
  for (const [zn, ppb] of zooms.slice(0, 2)) { SL9.zoomNow(ppb / 2); await frames(2); sc.scrollLeft = 0.2 * A.len * PXS; await frames(3);
    const fb = document.querySelector(`.folder[data-id="${B.id}"]`); if (fb) { fb.scrollIntoView({ block: "start" }); await frames(3); }
    await sweep(`Folders ${zn} (A)`, S(A.id)); if (fb) { const rb = fb.querySelector("canvas.rcv"); if (rb && R(rb).top > R(sc).top && R(rb).bottom < R(sc).bottom) await sweep(`Folders ${zn} (B)`, S(B.id)); } }
  SL9.toggleRow(A.id, false); SL9.toggleRow(B.id, false); SL9.setMode("cards"); await wait(150);
  log.push(`§1 sweep: ${n} beat lines, worst ${worst.toFixed(2)} px (drawn line · click · playhead · hover · insert line)`);
  ok(n >= 40, `the sweep checked enough lines (${n})`);

  // ================================================================ §1 + §2 the click editor (its own view)
  { const s = S(A.id); openSong(s.id); await wait(250); SL9.zoomNow(200 / 2); await frames(2); sc.scrollLeft = 0; await frames(2);
    const C = SLClick; C.open(s, "Click"); await wait(450); C.setMode("select"); // (the panel opens with a short slide)
    let ew = 0, en = 0;
    for (const [k, hx] of [[1, 0], [1.8, 260], [0.6, 120]]) {
      TX.setView("click", { pxs: PXS * k, hx }); C.draw(); await frames(2);
      const G = C.geo(), cv = G.cv, r = R(cv), sx = r.width / (cv.offsetWidth || 1);
      // bar lines drawn in the editor (the ruler band at the top: y 2) agree with the module
      for (const b of s.bars.slice(0, s.total)) { const x = TX.x(b.t, G.v); if (x < 10 || x > G.w - 10) continue; const d = lineAt(cv, 2, r.left + x * sx); if (d == null) continue; const dd = Math.abs(d - (r.left + x * sx)); ew = Math.max(ew, dd); en++; if (dd > 1) P.push(`editor ×${k}: bar ${b.bar} drawn ${dd.toFixed(2)} px off`); }
      // §2 a double-click on empty grid adds a note on the nearest line; on that note it deletes it; the first click adds nothing
      const T0 = C.TOP, yC = r.top + (T0 + 46 + 23) * (r.height / (cv.offsetHeight || 1)), Nn = () => C.clipOf(S(A.id), "Click").notes;
      const bar = s.bars.find((b) => { const x = TX.x(b.t, G.v); return x > 40 && x < G.w - 60 && b.sig[1] === 4; }); if (!bar) continue;
      const tk = C.timeTk(s, bar.beatT[1]); // beat 2: a click note (not an accent)
      const had = Nn().some((q) => q.tk === tk && !q.a);
      const xN = r.left + TX.x(bar.beatT[1], G.v) * sx, off = C.drawMode() === "blocks" ? 2 : -3; // a thin tick: 3 px off it still hits (8 px hit area)
      if (had) { // delete it (the hit area is at least 8 px: 3 px left of a thin tick still hits it)
        const before = Nn().length; ptr(cv, "pointerdown", xN + off, yC, { buttons: 1 }); ptr(cv, "pointerup", xN + off, yC); await frames(1);
        ok(Nn().length === before, `editor ×${k}: the first click of a double-click adds nothing`);
        dbl(cv, xN + off, yC); await frames(1); ok(!Nn().some((q) => q.tk === tk && !q.a), `editor ×${k}: double-clicking a click note deletes it (${off} px off its line, ${C.drawMode()})`);
      }
      dbl(cv, xN + 2, yC); await frames(1); ok(Nn().some((q) => q.tk === tk && !q.a), `editor ×${k}: double-clicking empty grid adds a note on the nearest line (had ${had}, x ${xN.toFixed(1)}, bar ${bar.bar}, tk ${tk}, ed ${JSON.stringify(C.grid())}, near ${Nn().filter((q) => Math.abs(q.tk - tk) < 2000).map((q) => q.tk + (q.a ? "A" : "")).join(",")})`);
      ptr(cv, "pointermove", xN + 1, yC); await frames(1); ok(C.geo() && document.querySelector("#clk10 .cc10").style.cursor === "pointer", `editor ×${k}: hovering a note highlights it`);
    }
    log.push(`§1 editor: ${en} bar lines, worst ${ew.toFixed(2)} px`);
    // its own zoom and scroll: the timeline doesn't move it; the chain links them
    const v0 = { ...TX.view("click") }; sc.scrollLeft = 333; SL9.zoomNow(PXS * 1.3); await frames(2);
    ok(TX.view("click").hx === v0.hx && TX.view("click").pxs === v0.pxs, "§5 the click editor keeps its own zoom and scroll");
    ED13.setLinked("click", true); await frames(1); ok(TX.view("click").pxs === PXS && TX.view("click").hx === sc.scrollLeft, "§5 linked: the editor uses the timeline's view"); ED13.setLinked("click", false);
    C.close(); closeSong(); await wait(150); }

  // tidy: the test songs go
  for (const id of [A.id, B.id]) { const i = songs.findIndex((x) => x.id === id); if (i >= 0) songs.splice(i, 1); } refresh(); await frames(1);
  return { problems: P, log };
}
