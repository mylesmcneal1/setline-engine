// set.Line 10c: the click as an Ableton-style MIDI clip (docs/design/phase10/c1-click.png).
// A click track holds one MIDI clip with two lanes: Accent (C3, the accent sound) and Click (C#3, the normal click).
// A note: {tk: position in ticks from the song's start (960 per quarter note), a: 1 = Accent lane, v: velocity
// 1-127 (= level), len: ticks (cosmetic)}. s.clk[track] = {notes, sig: the time signatures it was filled for}.
// - Playback: the notes become the engine's click hits (bar, beat, accent, level), sample-exact, through the same
//   click sounds, outputs and levels (verFields hands SongMapper the clip as the click track's clips). Velocity
//   scales the level: 40·log10(v/127) dB on top of the track's accent / beat / subdivision levels.
// - The click stays exactly as drawn: a tempo or time signature change never rewrites it (a hint offers Refill).
// - Migration: a song's old click clips become notes with no audible change (velocity 127, same levels); the old
//   clips stay in the song for an older set.Line.
// - A new song (or a new click track) starts filled from its time signature.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const PPQ = 960;
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const isClick = (s, t) => !isMidiTrack(s, t) && ROLE[t] === "click";
  const clickTracksOf = (s) => s.tracks.filter((t) => isClick(s, t));
  const MAC = /Mac/.test(navigator.platform);

  // ================================================================ positions
  // the quarter-note position of each bar's start (bar i+1 at q[i]); kept per bar list
  const QC = new WeakMap();
  function qMap(s) {
    const B = s.bars || []; let m = QC.get(B); if (m) return m;
    m = [0]; for (let i = 0; i < B.length; i++) m.push(m[i] + B[i].sig[0] * 4 / B[i].sig[1]);
    QC.set(B, m); return m;
  }
  const barTk = (s, bar) => Math.round(qMap(s)[Math.max(0, Math.min(bar - 1, qMap(s).length - 1))] * PPQ);
  const endTk = (s) => barTk(s, (s.total || s.bars.length) + 1);
  // a tick -> {bar (1-based), q: quarters into the bar}
  function barOf(s, tk) {
    const m = qMap(s), q = tk / PPQ; let lo = 0, hi = m.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (m[mid] <= q + 1e-9) lo = mid; else hi = mid - 1; }
    return { bar: lo + 1, q: q - m[lo] };
  }
  // seconds of a tick, and the tick at a time
  function tkTime(s, tk) {
    const { bar, q } = barOf(s, tk), b = s.bars[bar - 1]; if (!b) return s.len || 0;
    const per = 4 / b.sig[1], k = q / per, i = Math.floor(k), f = k - i;
    const t0 = b.beatT[i] !== undefined ? b.beatT[i] : b.t + b.dur, t1 = b.beatT[i + 1] !== undefined ? b.beatT[i + 1] : b.t + b.dur;
    return t0 + f * (t1 - t0);
  }
  function timeTk(s, t) {
    const B = s.bars; if (!B.length) return 0;
    let i = B.findIndex((b, j) => t < (B[j + 1] ? B[j + 1].t : b.t + b.dur)); if (i < 0) i = B.length - 1;
    const b = B[i], per = 4 / b.sig[1]; let k = 0;
    while (k < b.beatT.length - 1 && t >= b.beatT[k + 1]) k++;
    const t0 = b.beatT[k], t1 = b.beatT[k + 1] !== undefined ? b.beatT[k + 1] : b.t + b.dur;
    return Math.round((qMap(s)[i] + (k + Math.max(0, Math.min(1, (t - t0) / Math.max(1e-9, t1 - t0)))) * per) * PPQ);
  }
  // the time signatures (and accent groups) a clip was filled for: a change offers Refill
  const sigKey = (s) => JSON.stringify(meterChanges(s).map((c) => [c.bar, c.sig, c.e && c.e.grp || null]));

  // ================================================================ the clip
  // the old click clips of a track, as saved (read only: ckOf would add an empty list to the song)
  const rawCk = (s, t) => (t === "Click" ? s.ck : (s.cks || {})[t]) || [];
  // reading: the song's clip, or its old click clips as notes (made again when they change; the song isn't touched,
  // so opening and drawing a song never changes it)
  const VC = new WeakMap();
  function view(s, t) {
    if (s.clk && s.clk[t]) return s.clk[t];
    let m = VC.get(s); if (!m) VC.set(s, (m = {}));
    const key = JSON.stringify(rawCk(s, t)) + "|" + (s.bars ? s.bars.length : 0) + "|" + (s.tmap ? JSON.stringify(s.tmap.map((e) => e.sig || 0)) : "");
    if (!m[t] || m[t].key !== key) m[t] = { key, clip: migrate(s, t) };
    return m[t].clip;
  }
  // editing: the clip becomes the song's own (after snap(), so Undo goes back to the old clips)
  const keep = (s, t) => { const c = view(s, t); (s.clk || (s.clk = {}))[t] = c; return c; };
  const clipOf = keep;
  const peek = (s, t) => (s.clk && s.clk[t]) || null;
  // the old click clips (regions of 16th steps) -> notes: same positions, accents, levels
  function migrate(s, t) {
    const notes = [];
    for (const r of rawCk(s, t)) for (const n of r.notes || []) {
      const bar = r.bar + (n.b || 0); if (bar < 1 || bar > s.bars.length) continue;
      notes.push({ tk: barTk(s, bar) + Math.round((+n.st || 0) * PPQ / 4), a: n.acc ? 1 : 0, v: 127, len: 120, ...(n.w ? { w: 1 } : {}) });
    }
    notes.sort((p, q) => p.tk - q.tk || q.a - p.a);
    return { notes, sig: sigKey(s) };
  }
  // fill [from, to) ticks from the time signature: an accent on beat 1 (in grouped meters, on each group's start),
  // a click on the other beats; the notes already there in that range go
  function fill(s, t, from = 0, to = endTk(s)) {
    const C = clipOf(s, t); C.notes = C.notes.filter((n) => n.tk < from || n.tk >= to);
    for (let bar = barOf(s, from).bar; bar <= s.total; bar++) {
      const b0 = barTk(s, bar); if (b0 >= to) break;
      const sig = s.bars[bar - 1].sig, g = grpAt(s, bar), grouped = g.length > 1, step = PPQ * 4 / sig[1];
      for (let k = 0; k < sig[0]; k++) { const tk = Math.round(b0 + k * step); if (tk < from || tk >= to) continue; const acc = k === 0 || (grouped && grpStart(g, k)); C.notes.push({ tk, a: acc ? 1 : 0, v: 127, len: 120 }); }
    }
    C.notes.sort((p, q) => p.tk - q.tk || q.a - p.a); C.sig = sigKey(s);
    return C;
  }
  // Pattern ▾: quarters, 8ths, 16ths, triplets or half-time over [from, to), an accent on each bar's beat 1
  const PATTERNS = [["quarter", "Quarters", PPQ], ["eighth", "8ths", PPQ / 2], ["sixteenth", "16ths", PPQ / 4], ["triplet", "Triplets (8th)", PPQ / 3], ["half", "Half-time", PPQ * 2]];
  function pattern(s, t, kind, from, to) {
    const C = clipOf(s, t), P = PATTERNS.find((p) => p[0] === kind); if (!P) return;
    C.notes = C.notes.filter((n) => n.tk < from || n.tk >= to);
    for (let bar = barOf(s, from).bar; bar <= s.total; bar++) {
      const b0 = barTk(s, bar), b1 = barTk(s, bar + 1); if (b0 >= to) break;
      for (let tk = b0; tk < b1 - 1; tk += P[2]) { const x = Math.round(tk); if (x < from || x >= to) continue; C.notes.push({ tk: x, a: x === b0 ? 1 : 0, v: x === b0 ? 127 : 110, len: 120 }); }
    }
    C.notes.sort((p, q) => p.tk - q.tk || q.a - p.a);
  }
  // the notes as the engine's click clips (one region over the song, 16th steps, fractional for triplets)
  function regionsOf(s, C) {
    const notes = (C.notes || []).map((n) => { const { bar, q } = barOf(s, n.tk); return { b: bar - 1, st: +(q * 4).toFixed(6), acc: !!n.a, ...(n.v !== undefined && n.v !== 127 ? { v: n.v } : {}), ...(n.w ? { w: 1 } : {}) }; });
    return notes.length ? [{ id: "clk", bar: 1, bars: Math.max(1, s.total), notes }] : [];
  }
  // the hits the engine plays for a track (for tests and the band's beat lights): [{bar, beat, acc, v}]
  function hitsOf(s, t) { return (view(s, t).notes || []).map((n) => { const { bar, q } = barOf(s, n.tk), sig = s.bars[bar - 1].sig; return { bar, beat: 1 + q * sig[1] / 4, acc: !!n.a, v: n.v || 127 }; }); }

  // ---- playback: the page's version fields carry the clip as the click track's clips (SongMapper plays those)
  const VF = window.verFields;
  window.verFields = function (s, v) {
    const o = VF.apply(this, arguments);
    const tracks = (o.tracks || []).filter((t) => isClick(o, t));
    if (tracks.length) { buildBars(o); for (const t of tracks) { const C = (o.clk && o.clk[t]) || migrateFor(o, t); const R = regionsOf(o, C); if (t === "Click") o.ck = R; else (o.cks || (o.cks = {}))[t] = R; } delete o.bars; delete o.secPos; }
    delete o.clk;
    return o;
  };
  const migrateFor = (o, t) => { const m = o.clk || (o.clk = {}); return m[t] || (m[t] = migrate(o, t)); };

  // ---- new songs and new click tracks start filled from their time signature
  let known = new Set(songs.map((x) => x.id)), quiet = 0;
  const RF = window.refresh;
  window.refresh = function () {
    if (!quiet) for (const s of songs) if (!known.has(s.id)) {
      for (const t of clickTracksOf(s)) if (!peek(s, t) && !rawCk(s, t).some((r) => (r.notes || []).length)) { if (!s.bars) buildBars(s); fill(s, t); }
    }
    known = new Set(songs.map((x) => x.id));
    return RF.apply(this, arguments);
  };
  const RS = window.restore; if (RS) window.restore = function () { quiet++; try { return RS.apply(this, arguments); } finally { quiet--; known = new Set(songs.map((x) => x.id)); } };
  if (window.SLPage && SLPage.loadSession) { const LS = SLPage.loadSession; SLPage.loadSession = function () { quiet++; try { return LS.apply(this, arguments); } finally { quiet--; known = new Set(songs.map((x) => x.id)); } }; }
  const AT = window.addTrack;
  window.addTrack = function (s, k) {
    const before = s ? clickTracksOf(s) : [];
    const r = AT.apply(this, arguments);
    if (s && k === "click") for (const t of clickTracksOf(s)) if (!before.includes(t) && !(peek(s, t) && peek(s, t).notes.length)) { fill(s, t); refresh(); }
    return r;
  };

  // ---- Ableton (8b): Live's CLICK / DRUM CLICK notes go straight into the lanes: the accent notes (MetronomeUp, or
  // the loudest per bar, as 8b decided) on Accent, the rest on Click, velocities kept. A note more than a tick off the
  // 16th grid is moved onto it (8b); one within a tick stays exactly where it is.
  const SONG = window.ableSong;
  if (SONG) {
    window.ableSong = function (src) {
      const r = SONG.apply(this, arguments), so = r && r.so; if (!so) return r;
      const clicks = (src.clicks || []).slice().sort((a, b) => /drum/i.test(a.source) - /drum/i.test(b.source));
      const names = so.tracks.filter((t) => isClick(so, t));
      clicks.forEach((c, i) => {
        const t = names[i]; if (!t) return;
        const m = so.clk || (so.clk = {});
        if (!(c.notes || []).some((n) => n.q !== undefined)) { m[t] = migrate(so, t); return; } // an older reader: from the 16th steps
        const notes = c.notes.map((n) => { let tk = Math.round(n.q * PPQ); const g = Math.round(tk / (PPQ / 4)) * (PPQ / 4); if (Math.abs(tk - g) > 1) tk = g; return { tk: Math.max(0, tk), a: n.acc ? 1 : 0, v: Math.max(1, Math.min(127, Math.round(n.vel || 127))), len: 120 }; });
        notes.sort((p, q) => p.tk - q.tk || q.a - p.a);
        m[t] = { notes, sig: sigKey(so) };
      });
      return r;
    };
    if (window.SLAble) SLAble.song = window.ableSong;
  }

  // ================================================================ the Click lane on the timeline
  const DL = window.drawLane;
  window.drawLane = function (cv) {
    const s = songOf(cv.dataset.song), t = s && s.tracks[+cv.dataset.t];
    if (!s || !t || !isClick(s, t)) return DL.apply(this, arguments);
    const { g, vx, vw } = laneView(cv), H = cv.height, W = +cv.dataset.w;
    g.clearRect(vx, 0, vw, H);
    const off = isOff(s, t), AW = s.audio * PXS, C = view(s, t);
    const y0 = clip(g, 0, Math.max(AW, s.len * PXS), H, trackCol(s, t), "", off), y1 = H - 3, mid = (y0 + y1) / 2;
    const edit = ED && ED.s === s && ED.t === t;
    if (!C.notes.length) { g.fillStyle = "#8a909b"; g.font = "11px Inter, sans-serif"; g.fillText("No click in this song · click here, then Fill from time signature", vx + 10, H / 2 + 4); return; }
    const t0 = vx / PXS, t1 = (vx + vw) / PXS, a0 = timeTk(s, Math.max(0, t0)) - PPQ, a1 = timeTk(s, Math.min(s.len, t1)) + PPQ;
    const hA = Math.max(2, (mid - y0) - 2), hC = Math.max(2, (y1 - mid) - 2);
    for (const n of C.notes) {
      if (n.tk < a0 || n.tk > a1) continue;
      const X = tkTime(s, n.tk) * PXS, w = Math.max(1.5, Math.min(6, n.len / PPQ * (PXS * 60 / 120) * 0.25));
      g.fillStyle = off ? "#3a3f48" : n.a ? "#f2f3f6" : "#f5c518";
      const h = (n.a ? hA : hC) * (0.45 + 0.55 * (n.v || 127) / 127);
      g.fillRect(X, n.a ? mid - 1 - h : mid + 1, w, h);
    }
    if (edit || (SELCK && SELCK.s === s && SELCK.t === t)) { g.strokeStyle = edit ? "#f5c518" : "#fff"; g.lineWidth = 1.5; g.strokeRect(vx + 1, 1.5, Math.min(vw, AW - vx) - 2, H - 3); }
    if (C.notes.length && C.sig !== sigKey(s)) { g.fillStyle = "rgba(255,180,40,.9)"; g.font = "600 10.5px Inter, sans-serif"; g.fillText("Time signature changed: Refill click?", vx + 8, y0 + 11); }
  };
  // 12: a click on the Click lane selects its clip; a double-click opens its editor under the timeline (again: closes it)
  const laneHit = (e) => { const cv = e.target.closest && e.target.closest("canvas[data-t]"); if (!cv) return null; const s = songOf(cv.dataset.song), t = s && s.tracks[+cv.dataset.t]; return s && t && isClick(s, t) ? { s, t, cv } : null; };
  let SELCK = null; // the click clip selected on the timeline {s, t}
  document.addEventListener("pointerdown", (e) => { const h = laneHit(e); if (!h || e.button !== 0) { if (SELCK && !(e.target.closest && e.target.closest("#clk10"))) { SELCK = null; redrawLanes(); } return; } e.stopImmediatePropagation(); e.preventDefault(); SELCK = { s: h.s, t: h.t }; redrawLanes(); }, true);
  document.addEventListener("dblclick", (e) => { const h = laneHit(e); if (!h) return; e.stopImmediatePropagation(); e.preventDefault(); if (ED && ED.s.id === h.s.id && ED.t === h.t) close(); else open(h.s, h.t); }, true);
  ["mousedown", "click"].forEach((ty) => document.addEventListener(ty, (e) => { if (laneHit(e)) { e.stopImmediatePropagation(); if (ty !== "click") e.preventDefault(); } }, true));
  document.addEventListener("contextmenu", (e) => { const h = laneHit(e); if (!h) return; e.preventDefault(); e.stopImmediatePropagation(); open(h.s, h.t); if (window.SLMenus) SLMenus.obj("track", e, h.s, h.t); }, true);

  // ================================================================ the clip editor (a panel under the timeline)
  let ED = null; // {s, t, mode, grid, sel:Set of notes, h}
  const GRIDS = [["1/4", PPQ], ["1/8", PPQ / 2], ["1/16", PPQ / 4], ["Triplet", PPQ / 3]];
  const ROWH = 46, BARS = 15, METER = 13, RULER = BARS + METER, VELH = 54; // 11: bar numbers, then a time-signature row
  const store = { get: (k, d) => { try { const v = localStorage.getItem("setline." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("setline." + k, JSON.stringify(v)); } catch (e) {} } };
  function open(s, t) {
    t = t || clickTracksOf(s)[0];
    if (!t) { if (typeof toast === "function") toast(`“${s.name}” has no click track: Track › Add click track`); return; }
    const same = ED && ED.s === s && ED.t === t;
    if (!same) ED = { s, t, mode: "select", grid: store.get("clkGrid2", -1), tri: !!store.get("clkTri", false), snapOn: store.get("clkSnap", true) !== false, dens: store.get("clkDens", 0), sel: new Set(), h: store.get("clkH", 250), ins: null };
    build(); redrawLanes();
  }
  // 12: Undo / Redo rebuild the songs: the editor follows at once (not on the next tick), the selection by position
  function live() { if (!ED || songs.includes(ED.s)) return; const s2 = songOf(ED.s.id); if (!s2) return; const keys = [...ED.sel].map((n) => n.tk + "|" + n.a); ED.s = s2; const N = view(s2, ED.t).notes; ED.sel = new Set(N.filter((n) => keys.includes(n.tk + "|" + n.a))); }
  function close() { ED = null; const p = $("clk10"); if (p) p.remove(); redrawLanes(); }
  const redrawLanes = () => document.querySelectorAll("canvas[data-t]").forEach((cv) => { const s = songOf(cv.dataset.song), t = s && s.tracks[+cv.dataset.t]; if (s && t && isClick(s, t)) window.drawLane(cv); });
  function build() {
    let p = $("clk10"); const sc = $("scroller");
    if (!p) { p = document.createElement("div"); p.id = "clk10"; p.tabIndex = -1; p.dataset.keys = "own"; sc.parentElement.insertBefore(p, sc.nextSibling); }
    p.style.height = ED.h + "px";
    p.innerHTML = `<i class="crz10" title="Drag to resize"></i><div class="ch10"><b>${esc(ED.t)} · MIDI clip</b><span class="cbars10"></span>
      <div class="seg10" data-k="mode"><button data-v="draw" title="Draw mode: click to add, drag to paint, ⌥-drag to erase  B">✎ Draw</button></div>
      <span class="clab10">Grid</span><div class="seg10" data-k="grid"><button data-v="-1" title="Adaptive: follows the zoom  ⌘1 narrower · ⌘2 wider">Adaptive</button>${GRIDS.slice(0, 3).map(([n], i) => `<button data-v="${i}">${n}</button>`).join("")}</div><div class="seg10" data-k="tri"><button data-v="true" title="Triplets  ⌘3">3</button></div><div class="seg10" data-k="snapOn"><button data-v="true" title="Snap to the grid  ⌘4 (⌘-drag: free)">Snap</button></div>
      <button class="btn line cfill10" title="Fill from time signature: an accent on beat 1 (each group in odd meters), a click on the other beats">Fill ▾</button>
      <button class="btn line cpat10">Pattern ▾</button><button class="ibtn cmore10" title="More" aria-label="More">⋯</button><button class="ibtn cx10" title="Close  Esc" aria-label="Close">✕</button></div>
      <div class="chint10" hidden>Time signature changed: <b>Refill click?</b><button class="btn line" data-a="refill">Refill</button><button class="btn line" data-a="keep">Keep as drawn</button></div>
      <div class="cb10"><div class="cl10"><div class="crl10" style="height:${RULER}px"><span>Bar</span><span>Time sig.</span></div><div class="crow10" style="height:${ROWH}px"><i style="background:#f2f3f6"></i><b>Accent</b><em>C3</em></div><div class="crow10" style="height:${ROWH}px"><i style="background:#f5c518"></i><b>Click</b><em>C#3</em></div><div class="cvl10">Velocity</div></div><canvas class="cc10"></canvas></div>`;
    const seg = (k, v) => p.querySelectorAll(`.seg10[data-k="${k}"] button`).forEach((b) => b.classList.toggle("on", b.dataset.v === String(v)));
    segs();
    p.querySelectorAll(".seg10 button").forEach((b) => b.onclick = () => { const k = b.parentElement.dataset.k;
      if (k === "mode") setMode(ED.mode === "draw" ? "select" : "draw");
      else if (k === "grid") { ED.grid = +b.dataset.v; store.set("clkGrid2", ED.grid); }
      else if (k === "tri") { ED.tri = !ED.tri; store.set("clkTri", ED.tri); }
      else if (k === "snapOn") { ED.snapOn = !ED.snapOn; store.set("clkSnap", ED.snapOn); }
      segs(); draw(); });
    p.querySelector(".cx10").onclick = close;
    p.querySelector(".cfill10").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), at = { clientX: r.left, clientY: r.bottom + 4 }, sel = selSpan();
      ctxMenu(at, [{ cap: "Fill from time signature" }, { label: "Whole song", icon: "", act: () => doFill(0, endTk(ED.s)) }, { label: "Selection", icon: "", dis: !sel, act: () => doFill(sel[0], sel[1]) }]); };
    p.querySelector(".cpat10").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), at = { clientX: r.left, clientY: r.bottom + 4 }, span = selSpan() || visSpanTk();
      ctxMenu(at, [{ cap: selSpan() ? "Fill the selection with" : "Fill the bars on screen with" }, ...PATTERNS.map(([k, n]) => ({ label: n, icon: "", act: () => change(`Filled with ${n.toLowerCase()}`, () => pattern(ED.s, ED.t, k, span[0], span[1])) }))]); };
    p.querySelector(".cmore10").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), at = { clientX: r.left - 120, clientY: r.bottom + 4 };
      ctxMenu(at, [{ label: "Clear", icon: "", act: () => change("Cleared the click", () => { clipOf(ED.s, ED.t).notes = []; ED.sel.clear(); }) }, { label: "Refill from time signature", icon: "", act: () => doFill(0, endTk(ED.s)) }]); };
    p.querySelector(".chint10").onclick = (e) => { const a = e.target.dataset.a; if (a === "refill") doFill(0, endTk(ED.s)); else if (a === "keep") { snap(); clipOf(ED.s, ED.t).sig = sigKey(ED.s); draw(); redrawLanes(); } };
    // resize from the top edge
    p.querySelector(".crz10").onpointerdown = (e) => { e.preventDefault(); const y0 = e.clientY, h0 = ED.h; const mv = (m) => { ED.h = Math.max(170, Math.min(innerHeight * 0.7, h0 - (m.clientY - y0))); p.style.height = ED.h + "px"; draw(); }; const up = () => { store.set("clkH", ED.h); document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (window.TL9) TL9.bar(); }; document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up); };
    wireCanvas(p.querySelector(".cc10"));
    last = ""; draw(); if (!looping) loop();
  }
  // Draw / Select and the grid: the buttons and the drawing (the panel stays as it is)
  function segs() { const p = $("clk10"); if (!p || !ED) return; p.querySelectorAll(".seg10 button").forEach((b) => { const k = b.parentElement.dataset.k; b.classList.toggle("on", k === "mode" ? ED.mode === "draw" : b.dataset.v === String(ED[k])); }); const c = p.querySelector(".cc10"); if (c) c.style.cursor = ED.mode === "draw" ? "crosshair" : "default"; }
  function setMode(m) { if (!ED) return; ED.mode = m; segs(); draw(); }
  const change = (what, f) => { snap(); keep(ED.s, ED.t); f(); toast(what + ` in “${ED.s.name}”`, undo); draw(); redrawLanes(); };
  const doFill = (a, b) => change(a === 0 && b >= endTk(ED.s) ? "Filled the click from the time signature" : "Filled the selection from the time signature", () => { fill(ED.s, ED.t, a, b); ED.sel.clear(); });
  // the grid step in ticks: Adaptive picks the finest of 1/1 … 1/32 at least ~14 px apart (⌘1 / ⌘2 move it), × 2/3 for triplets
  const ADAPT = [PPQ * 4, PPQ * 2, PPQ, PPQ / 2, PPQ / 4, PPQ / 8];
  function adaptive() { const G = geo(); if (!G || !ED) return PPQ; const pxTk = (xOfTk(G, barTk(ED.s, 2)) - xOfTk(G, barTk(ED.s, 1))) / Math.max(1, barTk(ED.s, 2) - barTk(ED.s, 1));
    let i = ADAPT.findIndex((t, k) => k === ADAPT.length - 1 || ADAPT[k + 1] * pxTk < 14); i = Math.max(0, Math.min(ADAPT.length - 1, i + (ED.dens || 0))); return ADAPT[i]; }
  const step = () => { const base = ED.grid < 0 ? adaptive() : GRIDS[ED.grid][1]; return ED.tri && ED.grid !== 3 ? base * 2 / 3 : base; };
  const snapTk = (tk, how = "round", free) => { if (free || !ED.snapOn) return Math.max(0, Math.round(tk)); const { bar } = barOf(ED.s, tk), b0 = barTk(ED.s, bar), st = step(); return Math.max(0, Math.round(b0 + Math[how]((tk - b0) / st + 1e-9) * st)); };
  const selSpan = () => { if (!ED || !ED.sel.size) return null; const L = [...ED.sel].map((n) => n.tk); const a = Math.min(...L), b = Math.max(...L); return [barTk(ED.s, barOf(ED.s, a).bar), barTk(ED.s, barOf(ED.s, b).bar + 1)]; };
  const visSpanTk = () => { const sc = $("scroller"), w = window.TL9 ? TL9.viewW() : 800; const a = timeTk(ED.s, sc.scrollLeft / PXS), b = timeTk(ED.s, Math.min(ED.s.len, (sc.scrollLeft + w) / PXS)); return [barTk(ED.s, barOf(ED.s, a).bar), barTk(ED.s, barOf(ED.s, b).bar + 1)]; };
  // geometry: the canvas sits under the timeline's lanes (same left edge, the same sideways position and zoom)
  function geo() {
    const p = $("clk10"), cv = p && p.querySelector(".cc10"); if (!cv) return null;
    const pr = p.querySelector(".cb10").getBoundingClientRect(), L = window.TL9 ? TL9.laneLeft() : pr.left + 200, W = window.TL9 ? TL9.viewW() : pr.width - 200;
    return { cv, left: L - pr.left, top: 0, w: Math.max(50, Math.min(W, pr.right - L)), h: pr.height, hx: $("scroller").scrollLeft };
  }
  const xOfTk = (G, tk) => tkTime(ED.s, tk) * PXS - G.hx;
  const tkOfX = (G, x) => timeTk(ED.s, Math.max(0, (x + G.hx) / PXS));
  const rowOfY = (y) => (y < RULER ? -1 : y < RULER + ROWH ? 1 : y < RULER + 2 * ROWH ? 0 : y < RULER + 2 * ROWH + 6 ? -1 : 2); // 1 accent, 0 click, 2 velocity
  let last = "";
  let looping = false;
  function loop() { if (!ED || !$("clk10")) { looping = false; return; } looping = true; const G = geo(); const k = G ? [PXS, G.hx, G.w, G.h, ED.s.bars.length, ED.v || 0].join() : ""; if (k !== last || (ED.ins != null && !ED.sel.size)) { last = k; draw(); } requestAnimationFrame(loop); }
  function draw() {
    if (!ED) return; live(); const G = geo(); if (!G) return; const s = ED.s, C = view(s, ED.t), cv = G.cv, dpr = window.devicePixelRatio || 1;
    cv.style.left = G.left + "px"; cv.style.width = G.w + "px"; cv.style.height = G.h + "px";
    if (cv.width !== Math.round(G.w * dpr) || cv.height !== Math.round(G.h * dpr)) { cv.width = Math.round(G.w * dpr); cv.height = Math.round(G.h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, G.w, G.h);
    const tA = G.hx / PXS, tB = (G.hx + G.w) / PXS, b0 = barOf(s, timeTk(s, Math.max(0, tA))).bar, b1 = Math.min(s.total, barOf(s, timeTk(s, Math.min(s.len, tB))).bar);
    const p = $("clk10"); p.querySelector(".cbars10").textContent = `Bars ${b0}–${b1} on screen (of ${s.total})`;
    const hint = p.querySelector(".chint10"); hint.hidden = !(C.notes.length && C.sig !== sigKey(s));
    const yA = RULER, yC = RULER + ROWH, yV = RULER + 2 * ROWH + 6, hV = Math.max(20, G.h - yV - 4);
    // rows
    g.fillStyle = "rgba(255,255,255,.025)"; g.fillRect(0, yA, G.w, ROWH); g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(0, yC, G.w, ROWH);
    // grid: bar lines, grid lines (only when they're far enough apart to read)
    const st = step(); g.font = "10.5px Inter, sans-serif";
    const barW = (bar) => xOfTk(G, barTk(s, bar + 1)) - xOfTk(G, barTk(s, bar));
    let minBar = 1e9; for (let bar = Math.max(1, b0); bar <= Math.min(s.total, b1); bar++) minBar = Math.min(minBar, barW(bar));
    // 11: bar numbers thin out with the zoom (every bar, 2, 4, 8 or 16), never running into each other
    const numW = g.measureText(String(s.total)).width + 8, every = [1, 2, 4, 8, 16, 32, 64].find((k) => k * minBar >= numW) || 64;
    const gridOn = st * (minBar / (barTk(s, 2) - barTk(s, 1) || 1)) >= 4; // grid lines at least 4 px apart
    for (let bar = Math.max(1, b0 - 1); bar <= Math.min(s.total + 1, b1 + 1); bar++) {
      const bt = barTk(s, bar), x = xOfTk(G, bt); const nb = barTk(s, bar + 1);
      if (bar <= s.total && gridOn) for (let tk = bt + st; tk < nb - 1; tk += st) { const xx = xOfTk(G, Math.round(tk)); if (xx < -2 || xx > G.w + 2) continue; const onBeat = (Math.round(tk - bt)) % (PPQ * 4 / s.bars[bar - 1].sig[1]) === 0; g.fillStyle = onBeat ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.04)"; g.fillRect(Math.round(xx), yA, 1, yV - 6 - yA); }
      if (x < -40 || x > G.w + 2) continue;
      const lab = bar <= s.total && (bar - 1) % every === 0;
      g.fillStyle = lab || every <= 2 ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.08)"; g.fillRect(Math.round(x), lab ? 0 : BARS, 1, yV - 6 - (lab ? 0 : BARS));
      if (lab) { g.fillStyle = "#9aa0ab"; g.fillText(String(bar), x + 3, 11); }
    }
    // 11: the time signatures in their own row (the first one at the left edge, then each change)
    g.fillStyle = "rgba(255,255,255,.03)"; g.fillRect(0, BARS, G.w, METER);
    g.font = "600 9.5px Inter, sans-serif";
    const chs = [{ bar: 1, sig: s.bars[0].sig }, ...meterChanges(s).filter((c) => c.bar > 1)];
    let mEnd = -1e9;
    chs.forEach((c, i) => { const x = Math.max(0, xOfTk(G, barTk(s, c.bar))), nx = chs[i + 1] ? xOfTk(G, barTk(s, chs[i + 1].bar)) : G.w + 1e6; if (nx < 0 || x > G.w) return;
      const txt = c.sig.join("/"), tw = g.measureText(txt).width + 6; if (x < mEnd) return; const at = Math.max(x, Math.min(0, nx - tw));
      g.fillStyle = "#64d2ff"; g.fillText(txt, at + 3, BARS + 10); mEnd = at + tw + 2; });
    // playhead
    if (typeof playId !== "undefined" && playId === s.id && typeof pos === "number") { const x = pos * PXS - G.hx; if (x >= 0 && x <= G.w) { g.fillStyle = "rgba(255,255,255,.7)"; g.fillRect(Math.round(x), 0, 1, G.h); } }
    // notes and velocities: blocks when there's room, thin ticks under ~4 px, a density strip when zoomed far out
    const a0 = timeTk(s, Math.max(0, tA)) - PPQ, a1 = timeTk(s, Math.min(s.len, tB)) + PPQ;
    const vis = C.notes.filter((n) => n.tk >= a0 && n.tk <= a1);
    const span = Math.max(1, G.w), perPx = vis.length / span; // notes per pixel
    const noteW = (n) => xOfTk(G, n.tk + (n.len || 120)) - xOfTk(G, n.tk);
    const mode = perPx > 0.45 ? "density" : vis.some((n) => noteW(n) < 4) ? "ticks" : "blocks";
    ED.drawMode = mode;
    const colA = "#f2f3f6", colC = "#f5c518";
    if (mode === "density") {
      const cols = Math.ceil(G.w), dA = new Float32Array(cols), dC = new Float32Array(cols);
      for (const n of vis) { const x = Math.floor(xOfTk(G, n.tk)); if (x < 0 || x >= cols) continue; (n.a ? dA : dC)[x] += (n.v || 127) / 127; }
      const strip = (d, y, col) => { let mx = 0; for (let i = 0; i < cols; i++) mx = Math.max(mx, d[i]); if (!mx) return; g.fillStyle = col;
        for (let i = 0; i < cols; i++) if (d[i]) { g.globalAlpha = 0.25 + 0.75 * Math.min(1, d[i] / mx); g.fillRect(i, y + 10, 1, ROWH - 20); } g.globalAlpha = 1; };
      strip(dA, yA, colA); strip(dC, yC, colC);
    } else {
      for (const n of vis) {
        const x = xOfTk(G, n.tk), sel = ED.sel.has(n), y = n.a ? yA : yC;
        g.fillStyle = n.a ? colA : colC; g.globalAlpha = 0.55 + 0.45 * (n.v || 127) / 127;
        if (mode === "ticks") { g.fillRect(Math.round(x), y + 8, 1.5, ROWH - 16); g.globalAlpha = 1; if (sel) { g.fillStyle = "#5a8cff"; g.fillRect(Math.round(x) - 1, y + 4, 3.5, 3); } continue; }
        const w = Math.max(4, Math.min(18, noteW(n)));
        g.beginPath(); g.roundRect(x, y + 6, w, ROWH - 12, 3); g.fill(); g.globalAlpha = 1;
        if (sel) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.roundRect(x - 1, y + 5, w + 2, ROWH - 10, 4); g.stroke(); g.strokeStyle = "#2f6df6"; g.lineWidth = 1; g.stroke(); }
      }
    }
    // velocity: a bar per note when they're apart, else the average per pixel column as a line (accents, clicks)
    if (mode === "blocks") for (const n of vis) { const x = xOfTk(G, n.tk), w = Math.max(4, Math.min(18, noteW(n))), vh = hV * (n.v || 127) / 127; g.fillStyle = n.a ? colA : colC; g.fillRect(x, yV + hV - vh, Math.max(2, Math.min(5, w)), vh); }
    else {
      const cols = Math.ceil(G.w), sum = [new Float32Array(cols), new Float32Array(cols)], cnt = [new Uint16Array(cols), new Uint16Array(cols)];
      for (const n of vis) { const x = Math.floor(xOfTk(G, n.tk)); if (x < 0 || x >= cols) continue; const k = n.a ? 1 : 0; sum[k][x] += n.v || 127; cnt[k][x]++; }
      [[0, colC], [1, colA]].forEach(([k, col]) => { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); let on = false, lastX = -9;
        for (let i = 0; i < cols; i++) { if (!cnt[k][i]) continue; const y = yV + hV - hV * (sum[k][i] / cnt[k][i]) / 127; if (!on || i - lastX > 24) { g.moveTo(i, y); on = true; } else g.lineTo(i, y); lastX = i; }
        g.stroke(); });
    }
    g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(0, yV - 3, G.w, 1);
    if (ED.ins != null && !ED.sel.size) { const x = xOfTk(G, ED.ins); if (x >= 0 && x <= G.w && (Math.floor(performance.now() / 530) % 2 === 0)) { g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(Math.round(x), RULER, 1, 2 * ROWH); } }
    if (BOX) { g.strokeStyle = "#5a8cff"; g.fillStyle = "rgba(90,140,255,.15)"; g.lineWidth = 1; const x = Math.min(BOX.x0, BOX.x1), y = Math.min(BOX.y0, BOX.y1); g.fillRect(x, y, Math.abs(BOX.x1 - BOX.x0), Math.abs(BOX.y1 - BOX.y0)); g.strokeRect(x + .5, y + .5, Math.abs(BOX.x1 - BOX.x0), Math.abs(BOX.y1 - BOX.y0)); }
    if (!C.notes.length) { g.fillStyle = "#9aa0ab"; g.font = "13px Inter, sans-serif"; g.fillText("No click in this song yet: Fill from time signature, or draw notes", 12, yC + 8); }
  }
  let BOX = null;
  const noteAt = (G, x, y) => { const row = rowOfY(y); if (row !== 0 && row !== 1) return null; const C = view(ED.s, ED.t); let best = null, bd = 7;
    for (const n of C.notes) { if (!!n.a !== (row === 1)) continue; const nx = xOfTk(G, n.tk), w = Math.max(4, Math.min(18, xOfTk(G, n.tk + (n.len || 120)) - nx)); if (x < nx - 2 || x > nx + w + 2) continue; const d = Math.abs(x - (nx + w / 2)); if (d < bd + w) { bd = d - w; best = n; } } return best; };
  const velAt = (G, x) => { const C = view(ED.s, ED.t); let best = null, bd = 4; for (const n of C.notes) { const d = Math.abs(xOfTk(G, n.tk) + 2 - x); if (d < bd) { bd = d; best = n; } } return best; };
  // 12 (conventions §9): double-click empty grid adds a note, a note: deletes it. Select mode (the default): a note
  // selects (⇧ adds), drags (snapped; ⌘ free; up / down changes its row; ⌥: a copy, or straight up / down: its velocity);
  // its right edge resizes; empty grid: a box, and the insert marker. Draw mode (B): click adds, drag paints, ⌥-drag
  // erases. The velocity strip: drag a bar (the selected notes change together, relatively). Positions come from the
  // pointer's offset in the canvas (Text size's zoom can't shift them).
  const isCmd = (e) => (MAC ? e.metaKey : e.ctrlKey);
  function wireCanvas(cv) {
    const pt = (ev) => (ev.target === cv ? { x: ev.offsetX, y: ev.offsetY } : (() => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; })());
    const yVel = () => { const G = geo(); const yV = RULER + 2 * ROWH + 6; return { yV, hV: Math.max(20, G.h - yV - 4) }; };
    const sortN = (C) => C.notes.sort((p, q) => p.tk - q.tk || q.a - p.a);
    cv.ondblclick = (e) => {
      if (!ED) return; live(); e.preventDefault(); const G = geo(), { x, y } = pt(e), row = rowOfY(y); if (row !== 0 && row !== 1) return;
      const C = view(ED.s, ED.t), hit = noteAt(G, x, y);
      if (hit) { change("Deleted a click note", () => { const C2 = view(ED.s, ED.t); C2.notes = C2.notes.filter((n) => !(n.tk === hit.tk && n.a === hit.a)); ED.sel.clear(); }); return; }
      const tk = snapTk(tkOfX(G, x), "floor", isCmd(e)); if (tk >= endTk(ED.s)) return;
      change("Added a click note", () => { const C2 = view(ED.s, ED.t); const n = { tk, a: row, v: 127, len: 120 }; C2.notes.push(n); sortN(C2); ED.sel = new Set([n]); });
    };
    cv.onpointerdown = (e) => {
      if (e.button !== 0) return; e.preventDefault(); $("clk10").focus({ preventScroll: true }); live();
      if (e.detail >= 2) return; // the double-click does it
      const G = geo(), { x, y } = pt(e), row = rowOfY(y), C = view(ED.s, ED.t);
      try { cv.setPointerCapture(e.pointerId); } catch (x2) { /* a pointer the browser doesn't track (synthetic) */ }
      if (row === 2) { // velocity: drag a bar; the selection changes together, relatively
        const n = velAt(G, x); if (!n) return; snap(); keep(ED.s, ED.t); const L = ED.sel.has(n) ? [...ED.sel] : [n], v0 = L.map((q) => q.v || 127), { yV, hV } = yVel(), y0 = y;
        const set = (yy) => { const dv = Math.round((y0 - yy) / hV * 127), base = Math.max(1, Math.min(127, Math.round((yV + hV - y0) / hV * 127))); L.forEach((q, i) => { q.v = Math.max(1, Math.min(127, (L.length > 1 ? v0[i] : base) + dv)); }); draw(); redrawLanes(); };
        set(y); cv.onpointermove = (m) => set(pt(m).y); cv.onpointerup = () => { cv.onpointermove = null; toast(`Velocity ${L[0].v}${L.length > 1 ? ` on ${L.length} notes` : ""}`, undo); }; return;
      }
      if (row !== 0 && row !== 1) return;
      if (ED.mode === "draw") {
        const cell = (xx) => snapTk(tkOfX(G, xx), "floor", isCmd(e)), hit0 = noteAt(G, x, y);
        snap(); keep(ED.s, ED.t); const erase = e.altKey || !!hit0; const done = new Set();
        const apply = (xx, yy) => { const rw = rowOfY(yy); if (rw !== row) return; const tk = cell(xx), key = tk; if (done.has(key)) return; done.add(key);
          const C2 = view(ED.s, ED.t), ex = C2.notes.filter((n) => !!n.a === (row === 1) && Math.abs(n.tk - tk) < step() / 2);
          if (erase) { if (ex.length) C2.notes = C2.notes.filter((n) => !ex.includes(n)); }
          else if (!ex.length && tk < endTk(ED.s)) { C2.notes.push({ tk, a: row, v: 127, len: 120 }); sortN(C2); }
          draw(); redrawLanes(); };
        if (hit0 && !e.altKey) { const C2 = view(ED.s, ED.t); C2.notes = C2.notes.filter((n) => n !== hit0); done.add(cell(x)); draw(); redrawLanes(); } else apply(x, y);
        cv.onpointermove = (m) => { const q = pt(m); apply(q.x, q.y); };
        cv.onpointerup = () => { cv.onpointermove = null; toast(erase ? `Removed click notes in “${ED.s.name}”` : `Drew click notes in “${ED.s.name}”`, undo); };
        return;
      }
      const hit = noteAt(G, x, y);
      if (hit) {
        if (e.shiftKey || isCmd(e) && !e.altKey) { ED.sel.has(hit) ? ED.sel.delete(hit) : ED.sel.add(hit); draw(); return; }
        if (!ED.sel.has(hit)) { ED.sel.clear(); ED.sel.add(hit); }
        const nx = xOfTk(G, hit.tk), nw = Math.max(4, Math.min(18, xOfTk(G, hit.tk + (hit.len || 120)) - nx)), edge = nw >= 6 && x >= nx + nw - 3;
        const L = [...ED.sel], orig = L.map((n) => ({ n, tk: n.tk, a: n.a, v: n.v || 127, len: n.len || 120 })), tk0 = tkOfX(G, x); let mode = null, copies = null;
        cv.onpointermove = (m) => { const q = pt(m), dx = q.x - x, dy = q.y - y; if (!mode && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
          if (!mode) { snap(); keep(ED.s, ED.t); mode = edge ? "len" : e.altKey && Math.abs(dy) > Math.abs(dx) ? "vel" : "move"; if (mode === "move" && e.altKey) { copies = orig.map((o) => ({ ...o.n })); view(ED.s, ED.t).notes.push(...copies); } }
          if (mode === "len") { const end = snapTk(tkOfX(G, q.x), "round", isCmd(m)); orig.forEach((o) => { o.n.len = Math.max(30, end - hit.tk); }); draw(); redrawLanes(); return; }
          if (mode === "vel") { const { hV } = yVel(), dv = Math.round(-dy / hV * 127); orig.forEach((o) => { o.n.v = Math.max(1, Math.min(127, o.v + dv)); }); draw(); redrawLanes(); return; }
          const d = snapTk(orig[0].tk + (tkOfX(G, q.x) - tk0), "round", isCmd(m)) - orig[0].tk, rw = rowOfY(q.y), flip = (rw === 0 || rw === 1) && rw !== row;
          const target = copies || L;
          target.forEach((n, i) => { n.tk = Math.max(0, orig[i].tk + d); if (flip) n.a = orig[i].a ? 0 : 1; else n.a = orig[i].a; });
          if (copies) { ED.sel = new Set(copies); } draw(); redrawLanes(); };
        cv.onpointerup = () => { cv.onpointermove = null; if (mode) { sortN(view(ED.s, ED.t)); toast(mode === "len" ? "Resized click notes" : mode === "vel" ? `Velocity ${L[0].v}${L.length > 1 ? ` on ${L.length} notes` : ""}` : copies ? `Copied ${copies.length} click note${copies.length > 1 ? "s" : ""}` : `Moved ${L.length} click note${L.length > 1 ? "s" : ""}`, undo); } };
        return;
      }
      // empty grid: the insert marker here, and a box
      ED.ins = snapTk(tkOfX(G, x), "round", isCmd(e));
      if (!e.shiftKey) ED.sel.clear();
      BOX = { x0: x, y0: y, x1: x, y1: y };
      cv.onpointermove = (m) => { const q = pt(m); BOX.x1 = q.x; BOX.y1 = q.y; const xa = Math.min(BOX.x0, BOX.x1), xb = Math.max(BOX.x0, BOX.x1), ya = Math.min(BOX.y0, BOX.y1), yb = Math.max(BOX.y0, BOX.y1);
        for (const n of view(ED.s, ED.t).notes) { const nx = xOfTk(G, n.tk), ny = n.a ? RULER + ROWH / 2 : RULER + ROWH * 1.5; if (nx >= xa - 2 && nx <= xb && ny >= ya && ny <= yb) ED.sel.add(n); else if (!e.shiftKey) ED.sel.delete(n); } draw(); };
      cv.onpointerup = () => { cv.onpointermove = null; BOX = null; draw(); };
    };
    // scrolling and zooming here move the timeline too (one position, one zoom)
    cv.addEventListener("wheel", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return; // the zoom gesture (fix12.js)
      e.preventDefault(); const sc = $("scroller");
      sc.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    }, { passive: false });
  }
  // keys while the editor has focus (conventions §9): ⌫, ⌘A, ⌘C / ⌘V (at the insert marker), ⌘D, ← → nudge (⇧: a
  // bar), ↑ ↓ the other row, B Draw mode, Esc (Draw mode off, then the selection, then the editor), ⌘1 / ⌘2 the grid
  // narrower / wider, ⌘3 triplets, ⌘4 snap
  let CB = null;
  document.addEventListener("keydown", (e) => {
    const p = $("clk10"); if (!ED || !p || !(p.contains(document.activeElement) || p.contains(e.target))) return; live();
    const C = view(ED.s, ED.t), cmd = MAC ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase();
    const take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const sortN = (C2) => C2.notes.sort((p2, q) => p2.tk - q.tk || q.a - p2.a);
    if (e.key === "Escape") { take(); if (ED.mode === "draw") setMode("select"); else if (ED.sel.size) { ED.sel.clear(); draw(); } else close(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && ED.sel.size) { take(); change(`Deleted ${ED.sel.size} click note${ED.sel.size > 1 ? "s" : ""}`, () => { const C2 = view(ED.s, ED.t); C2.notes = C2.notes.filter((n) => !ED.sel.has(n)); ED.sel.clear(); }); return; }
    if (e.key === "Backspace" || e.key === "Delete") { take(); return; } // nothing selected: nothing
    if (cmd && k === "a") { take(); ED.sel = new Set(C.notes); draw(); return; }
    if (cmd && k === "c" && ED.sel.size) { take(); const L = [...ED.sel], a2 = Math.min(...L.map((n) => n.tk)); CB = L.map((n) => ({ ...n, tk: n.tk - a2 })); toast(`Copied ${L.length} click note${L.length > 1 ? "s" : ""}`); return; }
    if (cmd && k === "x" && ED.sel.size) { take(); const L = [...ED.sel], a2 = Math.min(...L.map((n) => n.tk)); CB = L.map((n) => ({ ...n, tk: n.tk - a2 })); change(`Cut ${L.length} click note${L.length > 1 ? "s" : ""}`, () => { const C2 = view(ED.s, ED.t); C2.notes = C2.notes.filter((n) => !ED.sel.has(n)); ED.sel.clear(); }); return; }
    if (cmd && k === "v" && CB) { take(); const at = ED.ins != null ? ED.ins : typeof playId !== "undefined" && playId === ED.s.id ? snapTk(timeTk(ED.s, pos)) : (selSpan() || [0, 0])[1]; change(`Pasted ${CB.length} click note${CB.length > 1 ? "s" : ""}`, () => { const C2 = view(ED.s, ED.t); const add = CB.map((n) => ({ ...n, tk: n.tk + at })); C2.notes.push(...add); sortN(C2); ED.sel = new Set(add); ED.ins = at + Math.max(...CB.map((n) => n.tk)) + step(); }); return; }
    if (cmd && k === "d" && ED.sel.size) { take(); const sp = selSpan(), len = sp[1] - sp[0]; change(`Duplicated ${ED.sel.size} click note${ED.sel.size > 1 ? "s" : ""}`, () => { const C2 = view(ED.s, ED.t); const add = [...ED.sel].map((n) => ({ ...n, tk: n.tk + len })); C2.notes.push(...add); sortN(C2); ED.sel = new Set(add); }); return; }
    if (cmd && (e.key === "1" || e.key === "2")) { take(); const dir = e.key === "1" ? 1 : -1; if (ED.grid < 0) { ED.dens = Math.max(-2, Math.min(2, (ED.dens || 0) + dir)); store.set("clkDens", ED.dens); } else { ED.grid = Math.max(0, Math.min(2, ED.grid + dir)); store.set("clkGrid2", ED.grid); } segs(); draw(); toast(`Grid ${ED.grid < 0 ? "adaptive" : GRIDS[ED.grid][0]}${ED.tri ? " triplets" : ""}: ${dir > 0 ? "narrower" : "wider"}`); return; }
    if (cmd && e.key === "3") { take(); ED.tri = !ED.tri; store.set("clkTri", ED.tri); segs(); draw(); toast(ED.tri ? "Triplet grid" : "Straight grid"); return; }
    if (cmd && e.key === "4") { take(); ED.snapOn = !ED.snapOn; store.set("clkSnap", ED.snapOn); segs(); draw(); toast(ED.snapOn ? "Snap on" : "Snap off"); return; }
    if (!cmd && !e.altKey && k === "b") { take(); setMode(ED.mode === "draw" ? "select" : "draw"); return; }
    if (!cmd && (e.key === "ArrowLeft" || e.key === "ArrowRight") && ED.sel.size) { take(); const dir = e.key === "ArrowLeft" ? -1 : 1, L = [...ED.sel];
      const d = e.shiftKey ? barTk(ED.s, 2) - barTk(ED.s, 1) : step(); if (dir < 0 && Math.min(...L.map((n) => n.tk)) - d < 0) return;
      change(`Moved ${L.length} click note${L.length > 1 ? "s" : ""}`, () => { L.forEach((n) => { n.tk = Math.max(0, Math.round(n.tk + dir * d)); }); sortN(view(ED.s, ED.t)); }); return; }
    if (!cmd && (e.key === "ArrowUp" || e.key === "ArrowDown") && ED.sel.size) { take(); const L = [...ED.sel], a2 = e.key === "ArrowUp" ? 1 : 0;
      change(`Moved ${L.length} click note${L.length > 1 ? "s" : ""} to ${a2 ? "Accent" : "Click"}`, () => { L.forEach((n) => { n.a = a2; }); sortN(view(ED.s, ED.t)); }); return; }
  }, true);
  // follow the song shown: the editor closes when its song goes
  setInterval(() => { if (ED && (!songs.includes(ED.s) || !ED.s.tracks.includes(ED.t))) { const s = songOf(ED.s.id); if (s && s.tracks.includes(ED.t)) { ED.s = s; ED.sel.clear(); draw(); } else close(); } }, 500);

  // the Track menu's "Edit click (MIDI clip)", the selection bar's "No click" suggestion
  window.SLClick = { TOP: RULER, ROWH, BARS, METER, drawMode: () => (ED ? ED.drawMode : ""), PPQ, qMap, barTk, endTk, barOf, tkTime, timeTk, clipOf, migrate, fill, pattern, PATTERNS, regionsOf, hitsOf, sigKey, view, keep, open, close, editing: () => (ED ? { song: ED.s.id, track: ED.t, mode: ED.mode, grid: ED.grid, sel: [...ED.sel] } : null),
    setMode, setGrid: (i) => { if (ED) { ED.grid = i; store.set("clkGrid2", i); segs(); draw(); } }, grid: () => (ED ? { grid: ED.grid, tri: ED.tri, snap: ED.snapOn, dens: ED.dens, step: step(), ins: ED.ins } : null), selected: () => SELCK, select: (L) => { if (ED) { live(); ED.sel = new Set(L); draw(); } }, draw, geo: () => geo() };
})();
