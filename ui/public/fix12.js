// set.Line 12: feel like a real DAW (docs/daw-conventions.md is the default for every interaction).
// 1. Zoom gestures (a native macOS pinch, Ctrl / ⌥ / ⌘ + wheel, WebKit gesture events): proportional (a full pinch is
//    about 4–8×, Settings › General › Pinch zoom speed). While the gesture runs, the lanes on screen are stretched as
//    they are (a CSS transform, nothing redrawn); ~120 ms after the last input the song is redrawn sharp once.
//    Waveform detail is fetched ahead of time for the song on screen.
// 2. The ruler: a click puts the playhead exactly under the pointer, on the nearest beat (⌘ / Ctrl: no snap); a
//    ghost line with bar.beat follows the pointer; drag up / down zooms, sideways scrolls; double-click: Fit.
//    Positions come from the pointer's offset in the lane itself (no getBoundingClientRect), so Text size's zoom,
//    the sideways position and transforms can't shift them.
// 3. Selection belongs to the last thing clicked: ⌫ / Delete act on it only (a track, a section, a clip, a cue, a
//    marker, a tempo or time-signature point, a song, a break); nothing selected: nothing happens.
// 4. A meter on every track header (one canvas, ~30 fps, peak hold, a clip light until clicked; MIDI: an activity
//    light), and one on the outputs pill.
// 6. Show's top bar (concept 4A): the current section's panel, its progress, what's next, position / BPM / meter,
//    PLAYING / STOPPED; no transport buttons there (Space plays; Perform keeps its own).
// Also: ⇥ renames the next name, type-ahead in lists, ⌘-click S solos exclusively, Z / ⇧Z, Follow (⌘F).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = /Mac/.test(navigator.platform);
  const cmdKey = (e) => (MAC ? e.metaKey : e.ctrlKey);
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const busy = () => typeof playing !== "undefined" && playing;
  const sc = $("scroller");
  const store = { get: (k, d) => { try { const v = localStorage.getItem("setline." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("setline." + k, JSON.stringify(v)); } catch (e) {} } };
  const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  const timing = (what, ms) => { if (window.SL9 && SL9.state) { const T = SL9.state.timings; T.push({ what, ms: Math.round(ms * 10) / 10, at: Date.now() }); if (T.length > 400) T.shift(); } };

  // ================================================================ 1. zoom gestures: a stretched snapshot, then sharp
  const SPEED = { slower: 1.3, normal: 1.9, faster: 2.6 };
  const speed = () => SPEED[store.get("pinchSpeed", "normal")] || SPEED.normal;
  const ZLIM = () => [typeof ZMIN !== "undefined" ? ZMIN : 2, typeof ZMAX !== "undefined" ? ZMAX : 480];
  let GS = null; // {z0, k, ax, hx, t0, frames: [ms], last, timer}
  const laneLeft = () => (window.TL9 ? TL9.laneLeft() : sc.getBoundingClientRect().left + headW());
  const lanesNow = () => [...sc.querySelectorAll(".row>.lane,.fhead>.lane")];
  function gStart(ax) {
    if (GS) return GS;
    if (window.SL9 && SL9.zoomTarget && Math.abs(SL9.zoomTarget() - PXS) > 1e-6) SL9.zoomNow(SL9.zoomTarget()); // a glide in progress lands first
    GS = { z0: PXS, k: 1, ax: Math.max(0, ax), hx: sc.scrollLeft, frames: [], last: performance.now(), timer: 0, lanes: lanesNow(), ph: sc.querySelectorAll(".ph, .gh12") };
    GS.lanes.forEach((l) => { l.style.transformOrigin = "0 0"; l.style.willChange = "transform"; });
    return GS;
  }
  // the zoom factor k relative to the start, applied as a stretch of what's drawn
  function gSet(k, ended) {
    const g = GS; if (!g) return; const t0 = performance.now();
    const [mn, mx] = ZLIM(); k = Math.max(mn / g.z0, Math.min(mx / g.z0, k)); g.k = k;
    const tx = g.ax - k * (g.hx + g.ax);
    const tf = `translateX(${tx.toFixed(2)}px) scaleX(${k.toFixed(5)})`;
    for (const l of g.lanes) l.style.transform = tf;
    g.ph.forEach((p) => { p.style.visibility = "hidden"; });
    g.frames.push(performance.now() - t0); g.last = performance.now();
    clearTimeout(g.timer); if (!ended) g.timer = setTimeout(gEnd, 120); // a pinch says when it ends; a wheel burst ends after 120 ms of quiet
    else g.timer = setTimeout(gEnd, 1500); // (a pinch whose end never came)
  }
  // the gesture ended: the real zoom at the new scale, drawn sharp once
  function gEnd() {
    const g = GS; if (!g) return; GS = null; clearTimeout(g.timer);
    const dir = g.k >= 1 ? "in" : "out", t0 = performance.now();
    g.lanes.forEach((l) => { l.style.willChange = ""; l.style.transformOrigin = ""; });
    g.ph.forEach((p) => { p.style.visibility = ""; });
    const fade = Math.abs(g.k - 1) > 1e-4 ? stretchedShot(g) : null; // 13 §9: the stretched picture, over the lanes
    if (Math.abs(g.k - 1) > 1e-4) SL9.zoomNow(g.z0 * g.k, g.ax);
    else if (window.TL9) { const t = `translateX(${-sc.scrollLeft}px)`; g.lanes.forEach((l) => { l.style.transform = t; }); }
    const redraw = performance.now() - t0;
    if (fade) fadeOut(fade);
    if (g.frames.length) { const f = g.frames.slice().sort((a, b) => a - b); timing(`pinch ${dir} frame`, f[Math.floor(f.length / 2)]); }
    timing(`pinch ${dir} redraw`, redraw);
    LASTG = { dir, frames: g.frames.slice(), redraw, k: g.k };
    prefetch();
    const w = GWAIT; GWAIT = []; w.forEach((f) => f());
  }
  // 13 §9: a picture of the lanes as stretched now (their canvases, drawn where they are on screen), laid over them
  // while the sharp redraw happens underneath; then it fades out (about 80 ms) instead of a swap
  function stretchedShot(g) {
    if (document.body.classList.contains("calm")) return null;
    try {
      const R = sc.getBoundingClientRect(), Z = TX.zoomOf(sc), dpr = window.devicePixelRatio || 1;
      const screenUnits = !sc.offsetWidth || Math.abs(R.width - sc.offsetWidth * Z) <= Math.abs(R.width - sc.offsetWidth); // (macOS 12 WebKit: element units under zoom)
      const S = (v) => (screenUnits ? v : v * Z), box = { l: S(R.left), t: S(R.top), w: S(R.width), h: S(R.height) };
      const c = document.createElement("canvas"); c.className = "fade13"; c.width = Math.round(box.w * dpr); c.height = Math.round(box.h * dpr);
      Object.assign(c.style, { left: box.l + "px", top: box.t + "px", width: box.w + "px", height: box.h + "px" });
      const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); let n = 0;
      for (const l of g.lanes) for (const cv of l.querySelectorAll("canvas")) {
        if (!cv.width || !cv.height) continue; const r = cv.getBoundingClientRect(); if (r.right < R.left || r.left > R.right || r.bottom < R.top || r.top > R.bottom) continue;
        x.drawImage(cv, S(r.left) - box.l, S(r.top) - box.t, S(r.width), S(r.height)); n++;
      }
      if (!n) return null; document.body.appendChild(c); return c;
    } catch (e) { return null; }
  }
  function fadeOut(c) { requestAnimationFrame(() => { c.style.opacity = "0"; setTimeout(() => c.remove(), 110); }); }
  let LASTG = null, GWAIT = [];
  // the end of the current gesture, then of any glide (tests; Fit all's back)
  if (window.SL9) { const ST = SL9.settled; SL9.settled = () => (GS ? new Promise((r) => GWAIT.push(r)) : Promise.resolve()).then(() => ST()); }
  const inLanes = (x, y) => { const r = sc.getBoundingClientRect(); return x >= laneLeft() - 4 && x <= r.right && y >= r.top && y <= r.bottom; };
  const openSongs = () => { const FS = typeof focusSong === "function" ? focusSong() : null; return FS ? [FS] : (window.SL9 && SL9.mode() === "folders" ? songs.filter((s) => document.querySelector(`.folder.open[data-id="${s.id}"]`)) : []); };
  // the native pinch (macOS: the app sends the trackpad's magnification; x, y in the window's points)
  let NP = null;
  function pinch(m) {
    if (!m || !openSongs().length) return;
    const ph = String(m.phase || "");
    if (ph === "begin" || !NP) { NP = { acc: 0, base: 0 }; gStart(m.x != null ? TX.laneX(m.x) : 200); }
    else if (!GS) { NP.base = NP.acc; gStart(m.x != null ? TX.laneX(m.x) : 200); } // it went on after a redraw: from here
    if (ph === "end" || ph === "cancel") { NP = null; if (GS) { clearTimeout(GS.timer); gEnd(); } return; }
    NP.acc += +m.m || 0;
    gSet(Math.exp((NP.acc - NP.base) * speed()), true);
  }
  // Ctrl / ⌘ + wheel (a Windows / Chrome pinch arrives this way) and ⌥ + wheel: the same snapshot, one gesture per burst
  let WG = null;
  window.addEventListener("wheel", (e) => {
    if (!(e.altKey || e.ctrlKey || e.metaKey) || !sc.contains(e.target) || !openSongs().length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (WK || NP) return; // the pinch is already coming in as gesture events
    if (!GS) { WG = { acc: 0 }; gStart(TX.laneX(e.clientX)); }
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    WG.acc += -d * (e.ctrlKey && !e.altKey ? 0.02 * (speed() / SPEED.normal) : 0.0025);
    gSet(Math.exp(WG.acc));
  }, { capture: true, passive: false });
  // WebKit's own pinch events (Safari, the page in a browser): the same, from their scale
  let WK = null;
  document.addEventListener("gesturestart", (e) => { if (!openSongs().length || !inLanes(e.clientX == null ? laneLeft() + 10 : e.clientX, e.clientY == null ? sc.getBoundingClientRect().top + 10 : e.clientY)) return; e.preventDefault(); e.stopImmediatePropagation(); WK = 1; gStart(e.clientX == null ? 200 : TX.laneX(e.clientX)); }, { capture: true, passive: false });
  document.addEventListener("gesturechange", (e) => { if (!WK) return; e.preventDefault(); e.stopImmediatePropagation(); if (e.scale > 0) gSet(Math.pow(e.scale, speed() / SPEED.normal), true); }, { capture: true, passive: false });
  document.addEventListener("gestureend", (e) => { if (!WK) return; e.preventDefault(); e.stopImmediatePropagation(); WK = null; if (GS) { clearTimeout(GS.timer); gEnd(); } }, { capture: true, passive: false });
  // waveform detail for the song(s) on screen, every level, ahead of the zoom (fetched in the background)
  function prefetch() {
    if (!window.SLW || !SLW.prefetch) return;
    for (const s of openSongs()) for (const t of s.tracks) if ((s.files || {})[t]) SLW.prefetch(s, t);
  }
  let pfT = 0; const pfSoon = () => { clearTimeout(pfT); pfT = setTimeout(prefetch, 400); };

  // ================================================================ 2. the ruler
  // the lane x (song pixels) under a pointer event on the ruler: from the pointer's offset in the element hit
  // 13: through the one calculation (tx13.js), read against the canvas that draws the ruler's lines
  function rulerX(e, lane) {
    const cv = lane.querySelector("canvas.rcv"); // (labels don't take the pointer: fix12.css)
    return cv ? TX.canvasSongX(e, cv) : TX.local(e, lane);
  }
  // 13: the NEAREST grid line (the Snap grid: the bar by default, Adaptive when zoomed in), or t itself (⌘)
  function nearestBeatT(s, t, free) {
    t = Math.max(0, Math.min(s.len || s.audio, t));
    return Math.min(TX.snap(s, t, free), Math.max(0, (s.audio || s.len) - 0.01));
  }
  const bbLabel = (s, t) => { if (typeof barBeatAt !== "function") return ""; const x = barBeatAt(s, t); const beat = Math.floor(x.beat + 1e-6), frac = x.beat - beat; return `${x.bar}.${beat}${frac > 0.02 ? "." + (1 + Math.floor(frac * 4)) : ""}`; };
  // the ghost line (hover) and its label
  function ghost(s, t) {
    const f = document.querySelector(`.folder[data-id="${s.id}"]`); if (!f) return;
    let g = f.querySelector(".gh12"); if (!g) { g = document.createElement("i"); g.className = "gh12"; g.innerHTML = "<b></b>"; f.appendChild(g); }
    const X = TX.x(t); g.style.left = `calc(var(--head) + ${TX.lineLeft(X, 1)}px)`; g.style.display = X < 0 ? "none" : "block"; g.firstChild.textContent = bbLabel(s, t);
  }
  const unghost = () => document.querySelectorAll(".gh12").forEach((g) => { g.style.display = "none"; });
  window.addEventListener("pointermove", (e) => {
    // 13: also over a track lane's empty space (where a click puts the insert line)
    const tl = !e.buttons && e.target.tagName === "CANVAS" && e.target.closest && e.target.closest(".row.trk .lane") ? e.target : null;
    if (tl && tl.dataset.song) { const s = songOf(tl.dataset.song), tt = s && TX.canvasSongX(e, tl) / PXS; if (s && !(typeof clipAt === "function" && s.tracks[+tl.dataset.t] && isAudio(s, s.tracks[+tl.dataset.t]) && clipAt(s, s.tracks[+tl.dataset.t], tt))) { ghost(s, nearestBeatT(s, tt, cmdKey(e))); return; } }
    const lane = e.target.closest && e.target.closest(".ruler .lane"); if (!lane || e.buttons || e.target.closest(".mkr")) { if (!e.buttons) unghost(); return; }
    const s = songOf(lane.dataset.song); if (!s) return; ghost(s, nearestBeatT(s, rulerX(e, lane) / PXS, cmdKey(e)));
  }, true);
  document.addEventListener("pointerleave", unghost);
  window.addEventListener("pointerdown", (e) => {
    const lane = e.target.closest && e.target.closest(".ruler .lane"); if (!lane || e.button !== 0 || e.target.closest(".mkr, .msig")) return;
    const s = songOf(lane.dataset.song); if (!s) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const x0 = rulerX(e, lane), cx = e.clientX, cy = e.clientY, hx0 = sc.scrollLeft, free = cmdKey(e);
    let mode = null; // null: a click; "zoom" (up / down) or "scroll" (sideways)
    try { lane.setPointerCapture(e.pointerId); } catch (x) {}
    const mv = (m) => {
      const dx = m.clientX - cx, dy = m.clientY - cy;
      if (!mode) { if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; mode = Math.abs(dy) > Math.abs(dx) ? "zoom" : "scroll"; if (mode === "zoom") gStart(x0 - hx0); }
      if (mode === "zoom") gSet(Math.exp(dy * 0.012)); // Ableton: drag down zooms in
      else sc.scrollLeft = hx0 - dx;
    };
    const up = (u) => {
      lane.removeEventListener("pointermove", mv); lane.removeEventListener("pointerup", up); lane.removeEventListener("pointercancel", up);
      if (mode === "zoom") { if (GS) { clearTimeout(GS.timer); gEnd(); } return; }
      if (mode) return;
      locate(s, nearestBeatT(s, x0 / PXS, free));
    };
    lane.addEventListener("pointermove", mv); lane.addEventListener("pointerup", up); lane.addEventListener("pointercancel", up);
  }, true);
  window.addEventListener("dblclick", (e) => { const lane = e.target.closest && e.target.closest(".ruler .lane"); if (!lane || e.target.closest(".mkr")) return; const s = songOf(lane.dataset.song); if (!s) return; e.preventDefault(); e.stopImmediatePropagation(); SL9.zoomPreset(s, "song"); }, true);

  // ================================================================ 3. the selection belongs to the last thing clicked
  let LAST = null; // {kind, s, t, id} or {kind: "none"}
  const isCtl = (t) => !!(t.closest && t.closest("button, input, select, .hf, .ms, .ochip, .ctab, .rsz9, .hm, .grip10, .more10"));
  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const t = e.target; if (!t || !t.closest || t.closest(".xm.ctx, .cfbg, #pal10, .pal10, .pop, #tpop, #mpop")) return;
    let el;
    if ((el = t.closest(".row.trk > .lh"))) { if (!isCtl(t)) LAST = { kind: "track", s: el.dataset.song, t: el.dataset.track }; return; }
    if ((el = t.closest(".secs .sec[data-sid]"))) { const lane = el.closest(".lane"); LAST = { kind: "section", s: lane && lane.dataset.song, id: +el.dataset.sid }; return; }
    if (t.closest(".secs .lane")) { LAST = { kind: "none" }; return; }
    if ((el = t.closest(".mkr[data-i]"))) { LAST = { kind: "marker" }; return; }
    if ((el = t.closest(".tempo .tp[data-i]"))) { LAST = { kind: "tempo" }; return; }
    if ((el = t.closest(".msig9[data-bar]"))) { LAST = { kind: "meter" }; return; }
    if ((el = t.closest("#songs .brk9[data-b]"))) { LAST = { kind: "break", id: el.dataset.b }; return; }
    if ((el = t.closest("#songs .song[data-id], .card9[data-id], .row9 .r9h, .r9h[data-id], #pool .ps[data-id], .folder .fh"))) { LAST = { kind: "song" }; return; }
    if ((el = t.closest(".vstrip .vr[data-v]"))) { LAST = { kind: "version" }; return; }
    if (t.closest("#clk10, #pe13")) { LAST = { kind: "editor" }; return; } // (13: the patch change editor too)
    if ((el = t.closest("canvas[data-t]"))) { // a lane: what the page selected (a clip, a cue, a MIDI clip), else nothing
      setTimeout(() => { LAST = typeof multiOn === "function" && multiOn() ? { kind: "multi" } : typeof pick !== "undefined" && pick ? { kind: "pick" } : typeof selClip !== "undefined" && selClip ? { kind: "clip" } : { kind: "none" }; }, 0); return; }
    if (t === sc || t.closest(".fbody") && !t.closest(".lh, .lane, button")) LAST = { kind: "none" };
  }, true);
  // ⌫ / Delete: only the selection (before the page's own key handlers)
  function del() {
    const L = LAST; if (!L) return false;
    if (L.kind === "track") { const s = songOf(L.s); if (s && s.tracks.includes(L.t)) { SL9.deleteTrack(s, L.t, false); LAST = { kind: "none" }; } return true; }
    if (L.kind === "section") { const s = songOf(L.s); if (s && (s.secs || []).some((x) => x.id === L.id)) { deleteSec(s, L.id); toast(`Deleted a section in ${s.name}`, undo); LAST = { kind: "none" }; } return true; }
    if (["marker", "meter", "version"].includes(L.kind)) { if (window.SL11) SL11.run("delete"); return true; }
    if (L.kind === "tempo") { if (window.SL11 && SL11.current()) SL11.run("delete"); return true; }
    if (L.kind === "break") { if (window.SLBreaks) SLBreaks.del(L.id); LAST = { kind: "none" }; return true; }
    if (L.kind === "tracks") { const list = TSEL.slice(), n0 = undoS.length; list.forEach((x) => { const so = songOf(x.s); if (so && so.tracks.includes(x.t)) SL9.deleteTrack(so, x.t, false); }); if (undoS.length > n0 + 1) undoS.splice(n0 + 1); TSEL = []; LAST = { kind: "none" }; toast(`Deleted ${list.length} tracks`, undo); return true; }
    if (L.kind === "none") { // nothing selected: nothing happens (unless something was selected another way since)
      const other = (typeof songSel !== "undefined" && songSel.size > 1) || (typeof multiOn === "function" && multiOn()) || (typeof pick !== "undefined" && pick) || (typeof selClip !== "undefined" && selClip) || (typeof selSec !== "undefined" && selSec) || (typeof tsel !== "undefined" && tsel) || (typeof document !== "undefined" && document.querySelector("#songs .brk9.on")) || (window.MODUI && MODUI.sel() && MODUI.sel().ids && MODUI.sel().ids.length); // (13: scene / footswitch changes on a modeler lane)
      return !other; }
    if (L.kind === "editor") return true; // the clip editor has its own ⌫
    return false; // a song, a clip, a cue, a group: the page's own (they act on their own selection)
  }
  window.addEventListener("keydown", (e) => {
    if ((e.key !== "Backspace" && e.key !== "Delete") || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector(".cfbg")) return;
    if (LAST && LAST.kind === "editor") return; // the click editor's own handler
    if (del()) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // Esc: clears the selection (nothing selected afterwards)
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !typing(e.target) && !document.querySelector(".cfbg, .xm.ctx, .pal10")) { if (LAST && LAST.kind === "track") { if (typeof closeTrack === "function" && typeof trackOpen !== "undefined" && trackOpen) { /* the page closes the track */ } } LAST = { kind: "none" }; } }, true);

  // ================================================================ 4. meters: one canvas over the track headers
  let MC = null, MPOS = [], mDirty = true;
  const MST = new Map(); // key -> {v, hold, holdT, clip, act}
  function meterCanvas() {
    if (MC && MC.isConnected) return MC;
    MC = document.createElement("canvas"); MC.id = "mt12"; MC.setAttribute("aria-hidden", "true"); sc.appendChild(MC); mDirty = true; return MC;
  }
  // where each header's meter goes, in the scroller's content coordinates (layout read once per change, not per frame)
  function measureMeters() {
    mDirty = false; MPOS = [];
    const base = sc.getBoundingClientRect(), st = sc.scrollTop;
    sc.querySelectorAll(".row.trk > .lh").forEach((lh) => {
      let m = lh.querySelector(".hm12"); if (!m) return;
      const r = m.getBoundingClientRect(); if (!r.width || !r.height) return;
      const s = lh.dataset.song, t = lh.dataset.track, so = songOf(s);
      MPOS.push({ x: r.left - base.left, y: r.top - base.top + st, w: r.width, h: r.height, key: s + "|" + t, s, t, midi: !!(so && isMidiTrack(so, t)) });
    });
    const c = meterCanvas(), w = Math.ceil(Math.max(1, ...MPOS.map((p) => p.x + p.w + 2))), h = Math.ceil(Math.max(1, sc.scrollHeight));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; c.style.width = w + "px"; c.style.height = h + "px"; }
  }
  const midiAct = (s, t) => { if (!busy() || playId !== s.id) return 0; for (const e of s.midi[t] || []) { const d = pos - evTime(s, e); if (d >= 0 && d < 0.18) return 1; } return 0; };
  const dbH = (v) => { if (v <= 0) return 0; const db = 20 * Math.log10(v); return Math.max(0, Math.min(1, (db + 54) / 54)); };
  function drawMeters(now) {
    if (mDirty) measureMeters();
    const c = meterCanvas(), g = c.getContext("2d");
    let live = false;
    for (const p of MPOS) {
      const s = songOf(p.s); if (!s) continue;
      const S = MST.get(p.key) || { v: 0, hold: 0, holdT: 0, clip: false, act: 0 }; MST.set(p.key, S);
      g.clearRect(p.x - 1, p.y - 1, p.w + 2, p.h + 2);
      if (p.midi) { const a = midiAct(s, p.t); S.act = a ? 1 : S.act * 0.82; g.fillStyle = "#1d2129"; g.beginPath(); g.arc(p.x + p.w / 2, p.y + p.h / 2, Math.min(p.w, 6) / 2 + 0.5, 0, 7); g.fill();
        if (S.act > 0.05) { g.globalAlpha = S.act; g.fillStyle = "#64d2ff"; g.beginPath(); g.arc(p.x + p.w / 2, p.y + p.h / 2, Math.min(p.w, 6) / 2, 0, 7); g.fill(); g.globalAlpha = 1; live = true; } continue; }
      const lv = typeof levelOf === "function" ? levelOf(s, p.t) : 0;
      S.v = Math.max(lv, S.v * 0.86); if (S.v < 0.002) S.v = 0;
      if (lv >= S.hold) { S.hold = lv; S.holdT = now; } else if (now - S.holdT > 1200) S.hold = Math.max(0, S.hold * 0.9);
      if (lv >= 0.999) S.clip = true;
      const top = p.y + 3, H = p.h - 3; // the clip light above the bar
      g.fillStyle = "#1a1d23"; g.fillRect(p.x, top, p.w, H);
      const hh = dbH(S.v) * H;
      if (hh > 0) { const gr = g.createLinearGradient(0, top + H, 0, top); gr.addColorStop(0, "#30d158"); gr.addColorStop(0.72, "#30d158"); gr.addColorStop(0.86, "#ffd60a"); gr.addColorStop(1, "#ff453a"); g.fillStyle = gr; g.fillRect(p.x, top + H - hh, p.w, hh); live = true; }
      if (S.hold > 0.002) { g.fillStyle = "rgba(255,255,255,.75)"; g.fillRect(p.x, top + H - dbH(S.hold) * H, p.w, 1); live = true; }
      g.fillStyle = S.clip ? "#ff453a" : "#2a2e36"; g.fillRect(p.x, p.y, p.w, 2);
    }
    // the outputs pill
    const oc = $("om12");
    if (oc) { const og = oc.getContext("2d"); og.clearRect(0, 0, oc.width, oc.height); const P = window.SLE && SLE.outPeaks ? SLE.outPeaks() : null;
      const lv = P && P.length ? [Math.max(P[0] || 0, 0), Math.max(P[1] != null ? P[1] : P[0] || 0, 0)] : (() => { let m = 0; for (const p of MPOS) m = Math.max(m, (MST.get(p.key) || {}).v || 0); return [m, m * 0.96]; })();
      lv.forEach((v, i) => { og.fillStyle = "#2a2e36"; og.fillRect(i * 4, 0, 3, oc.height); const h = dbH(v) * oc.height; og.fillStyle = v >= 0.999 ? "#ff453a" : v > 0.5 ? "#ffd60a" : "#30d158"; og.fillRect(i * 4, oc.height - h, 3, h); if (v > 0) live = true; }); }
    return live;
  }
  let mLast = 0, mRun = false;
  function mLoop(now) {
    if (now - mLast >= 32) { mLast = now; const live = drawMeters(now); if (!live && !busy()) { mRun = false; return; } }
    requestAnimationFrame(mLoop);
  }
  const mKick = () => { if (!mRun) { mRun = true; requestAnimationFrame(mLoop); } };
  setInterval(() => { if (busy()) mKick(); }, 250);
  // the page's per-element meters: replaced by the canvas
  window.meters = function () { mKick(); };
  // a clip light stays until it's clicked
  document.addEventListener("click", (e) => { const m = e.target.closest && e.target.closest(".row.trk > .lh .hm12"); if (!m) return; const lh = m.closest(".lh"), S = MST.get(lh.dataset.song + "|" + lh.dataset.track); if (S) { S.clip = false; S.hold = 0; } mKick(); });
  // every header gets a meter slot (MIDI too: the activity light); the outputs pill gets its meter
  function decorate() {
    sc.querySelectorAll(".row.trk > .lh:not(.m12)").forEach((lh) => {
      lh.classList.add("m12"); const old = lh.querySelector(".hm"); const slot = document.createElement("span"); slot.className = "hm12"; slot.title = "Level (a red top: it clipped; click to clear)";
      const s = songOf(lh.dataset.song); if (s && isMidiTrack(s, lh.dataset.track)) { slot.classList.add("midi"); slot.title = "MIDI activity"; }
      if (old) old.replaceWith(slot); else lh.appendChild(slot);
    });
    const chip = $("statusChip"); if (chip && !$("om12")) { const c = document.createElement("canvas"); c.id = "om12"; c.width = 7; c.height = 14; c.title = "Main outputs"; chip.insertBefore(c, chip.firstChild); }
    mDirty = true; mKick();
  }
  let dp = false; const later = () => { if (dp) return; dp = true; requestAnimationFrame(() => { dp = false; try { decorate(); clickToggles(); } catch (e) { console.error(e); } }); };
  new MutationObserver(later).observe(sc, { childList: true, subtree: true });
  addEventListener("resize", () => { mDirty = true; mKick(); });
  sc.addEventListener("scroll", () => { mDirty = true; }, { passive: true });
  later();

  // the click on / off: on the click tracks' headers (their metronome icon), as well as K and the Track menu
  function clickToggles() {
    const on = !!($("clickBtn") && $("clickBtn").classList.contains("on"));
    sc.querySelectorAll(".row.trk > .lh").forEach((lh) => { const s = songOf(lh.dataset.song); const ico = lh.querySelector(".tico"); if (!s || !ico) return;
      const isClick = typeof ROLE !== "undefined" && ROLE[lh.dataset.track] === "click";
      ico.classList.toggle("ck12", isClick); if (isClick) { ico.classList.toggle("off", !on); ico.title = `Click ${on ? "on" : "off"} (every song)  K`; ico.setAttribute("role", "button"); ico.setAttribute("aria-pressed", String(on)); } });
  }
  document.addEventListener("click", (e) => { const i = e.target.closest && e.target.closest(".tico.ck12"); if (!i) return; e.stopPropagation(); const b = $("clickBtn"); if (b) b.click(); setTimeout(clickToggles, 0); }, true);
  if ($("clickBtn")) new MutationObserver(clickToggles).observe($("clickBtn"), { attributes: true, attributeFilter: ["class"] });

  // ================================================================ 6. Show's top bar (concept 4A)
  function topBar() {
    if ($("tb12")) return;
    const tabs = document.querySelector(".top .tabs") || document.querySelector(".tabs"); if (!tabs) return;
    const el = document.createElement("div"); el.id = "tb12"; el.className = "tb12"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "off");
    el.innerHTML = `<div class="tbp12"><span class="tbk12"></span><b class="tbs12"></b></div>
      <div class="tbg12"><div class="tbgh12"><span class="tbc12"></span><span class="tbn12"></span></div><div class="tbb12"><i></i></div><div class="tbt12"></div></div>
      <div class="tbpos12"><b class="tbbb12"></b><span class="tbcap12"></span></div>
      <div class="tbst12"><i></i><span></span></div>`;
    tabs.insertAdjacentElement("afterend", el);
    el.addEventListener("click", (e) => { const n = e.target.closest(".tbn12[data-t]"); if (n) { const s = songOf(n.dataset.s); if (s) locate(s, +n.dataset.t); } });
  }
  const mmss = (t) => { t = Math.max(0, Math.round(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const setT = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  let TBK = "";
  function updateTop() {
    const el = $("tb12"); if (!el) return;
    const s = songOf((typeof playId !== "undefined" && playId) || selId), pl = busy();
    const B = window.SLBreaks && SLBreaks.current ? SLBreaks.current() : null;
    el.classList.toggle("playing", pl); el.classList.toggle("brk", !!B);
    const st = el.querySelector(".tbst12 span"); setT(st, pl ? "PLAYING" : "STOPPED");
    if (B) {
      setT(el.querySelector(".tbk12"), "BREAK"); setT(el.querySelector(".tbs12"), B.b ? B.b.label : "Break"); el.style.setProperty("--sc", "#8a8f98");
      setT(el.querySelector(".tbc12"), B.b && B.b.note ? B.b.note : "Break"); const n = el.querySelector(".tbn12"); n.removeAttribute("data-t"); setT(n, mmss(B.left || 0) + " left");
      el.querySelector(".tbb12 i").style.width = B.b && B.b.len ? Math.min(100, 100 * (1 - (B.left || 0) / B.b.len)) + "%" : "0%"; el.querySelector(".tbt12").innerHTML = "";
      setT(el.querySelector(".tbbb12"), mmss(B.left || 0)); setT(el.querySelector(".tbcap12"), "BREAK"); return;
    }
    if (!s || !s.bars) { setT(el.querySelector(".tbk12"), "NO SONG"); setT(el.querySelector(".tbs12"), "Add a song to start"); setT(el.querySelector(".tbc12"), ""); setT(el.querySelector(".tbn12"), ""); setT(el.querySelector(".tbbb12"), "–"); setT(el.querySelector(".tbcap12"), ""); return; }
    const p = s.id === playId ? pos : 0;
    const bi = s.bars.findIndex((b, i) => p >= b.t && (i === s.bars.length - 1 || p < s.bars[i + 1].t)), b = s.bars[Math.max(0, Math.min(bi, s.total - 1))];
    let k = 0; b.beatT.forEach((x, i) => { if (p >= x - 1e-9) k = i; });
    const sec = secOfBar(s, b.bar), idx = sec ? s.secPos.indexOf(sec) : -1, nx = idx >= 0 ? s.secPos[idx + 1] : s.secPos.find((q) => q.start > b.bar);
    const col = sec ? SEC_C[sec.type] || "#8a8f98" : "#8a8f98";
    el.style.setProperty("--sc", col); el.style.setProperty("--nc", nx ? SEC_C[nx.type] || "#8a8f98" : "#8a8f98");
    setT(el.querySelector(".tbk12"), "NOW · " + (sec ? sec.name : "—").toUpperCase());
    setT(el.querySelector(".tbs12"), s.name);
    setT(el.querySelector(".tbc12"), sec ? sec.name : "");
    const n = el.querySelector(".tbn12");
    if (!pl) { n.removeAttribute("data-t"); n.classList.add("hint"); n.innerHTML = "Space to play"; }
    else { n.classList.remove("hint"); if (nx) { n.dataset.t = s.bars[nx.start - 1].t; n.dataset.s = s.id; n.innerHTML = `next: <b>${esc(nx.name)}</b>`; } else { n.removeAttribute("data-t"); n.textContent = "last section"; } }
    // progress through the section, one tick per bar
    if (sec) {
      const a = s.bars[sec.start - 1].t, endB = s.bars[Math.min(s.bars.length - 1, sec.start - 1 + sec.bars)], e2 = endB && sec.start - 1 + sec.bars < s.bars.length ? endB.t : s.len;
      el.querySelector(".tbb12 i").style.width = Math.max(0, Math.min(100, (100 * (p - a)) / Math.max(1e-6, e2 - a))).toFixed(2) + "%";
      const key = s.id + "|" + sec.id + "|" + sec.bars + "|" + (b.bar - sec.start);
      if (key !== TBK) { TBK = key; const nb = Math.min(sec.bars, 48), done = Math.floor(((b.bar - sec.start) / sec.bars) * nb);
        el.querySelector(".tbt12").innerHTML = Array.from({ length: nb }, (_, i) => `<i class="${i <= done ? "on" : ""}"></i>`).join(""); }
    } else { el.querySelector(".tbb12 i").style.width = "0%"; el.querySelector(".tbt12").innerHTML = ""; TBK = ""; }
    setT(el.querySelector(".tbbb12"), `${b.bar}.${k + 1}`);
    const len = typeof verLen === "function" && typeof curVer === "function" ? verLen(s, curVer(s)) : s.audio;
    setT(el.querySelector(".tbcap12"), `${fmtBpm(bpmAt(s, b.bar + k / b.sig[0]))} BPM · ${b.sig.join("/")} · ${mmss(len - p)} LEFT`);
  }
  topBar();
  const LCD = window.lcd;
  window.lcd = function () { const r = LCD.apply(this, arguments); try { updateTop(); } catch (e) {} return r; };
  setInterval(() => { if (!busy()) try { updateTop(); } catch (e) {} }, 400);
  // narrow: the small caption goes first, then "next: …" (song names truncate cleanly)
  function fitTop() { const el = $("tb12"); if (!el) return; el.classList.remove("n1", "n2"); const over = () => document.querySelector(".top").scrollWidth > document.querySelector(".top").clientWidth + 1; if (over()) el.classList.add("n1"); if (over()) el.classList.add("n2"); }
  addEventListener("resize", fitTop); setTimeout(fitTop, 300); setInterval(fitTop, 3000);

  // ================================================================ conventions: ⇥ to the next name, type-ahead, S, Z
  // ⇥ while renaming a track, a section or a setlist song: saves and starts renaming the next one (Ableton)
  // (fix10a's keys call this first: true when it took the ⇥)
  function tabNext(e) {
    if (e.key !== "Tab" || !window.SL10a || !SL10a.editing()) return false;
    const ed = SL10a.editing(), el = ed.el; let next = null;
    const lh = el.closest && el.closest(".row.trk > .lh"), sec = el.closest && el.closest(".secs .sec[data-sid]"), row = el.closest && el.closest("#songs > .song[data-id]");
    if (lh) { const s = songOf(lh.dataset.song), i = s ? s.tracks.indexOf(lh.dataset.track) : -1; if (s && i >= 0) next = () => { const t2 = s.tracks[(i + (e.shiftKey ? -1 : 1) + s.tracks.length) % s.tracks.length]; const s2 = songOf(s.id); const h = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="${CSS.escape(t2)}"] .tn`); if (s2 && h) renameTrackBox(s2, t2, h); }; }
    else if (sec) { const lane = sec.closest(".lane"), s = songOf(lane.dataset.song), L = s ? s.secPos : [], i = L.findIndex((p) => p.id === +sec.dataset.sid); if (s && i >= 0) next = () => { const q = L[(i + (e.shiftKey ? -1 : 1) + L.length) % L.length]; const s2 = songOf(s.id); if (s2 && q) renameSec(s2, q.id); }; }
    else if (row) { const i = setOrder.indexOf(row.dataset.id); if (i >= 0) next = () => { const id = setOrder[(i + (e.shiftKey ? -1 : 1) + setOrder.length) % setOrder.length]; const el2 = document.querySelector(`#songs .song[data-id="${id}"] .nm11`); if (el2) SL10a.renameSong(id, el2); }; }
    if (!next) return false;
    e.preventDefault(); e.stopImmediatePropagation(); ed.end(true); setTimeout(next, 30); return true;
  }
  // type-ahead: typing letters in a list (the setlist, the library, cards, Folders rows) jumps to the first match
  let TA = { q: "", t: 0 };
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || !/\S/.test(e.key) || typing(e.target) || document.querySelector(".cfbg, .pal10, .xm.ctx")) return;
    const a = document.activeElement, inList = a && a.closest && a.closest("#songs, #pool, .wall9, .wall9g, .rows9, #libSec, .card9, .row9");
    if (!inList) return;
    const now = performance.now(); if (now - TA.t > 900) TA.q = ""; TA.t = now; TA.q += e.key.toLowerCase();
    const inSet = !!a.closest("#songs"), ids = inSet ? setOrder.slice() : [...document.querySelectorAll(".card9[data-id], .row9[data-row], #pool .ps[data-id]")].map((x) => x.dataset.id || x.dataset.row);
    const hit = ids.find((id) => { const s = songOf(id); return s && s.name.toLowerCase().startsWith(TA.q); }) || ids.find((id) => { const s = songOf(id); return s && s.name.toLowerCase().includes(TA.q); });
    if (!hit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    select(hit, true);
    const el = document.querySelector(inSet ? `#songs .song[data-id="${hit}"]` : `.card9[data-id="${hit}"], .row9[data-row="${hit}"], #pool .ps[data-id="${hit}"]`);
    if (el) { el.scrollIntoView({ block: "nearest" }); if (el.tabIndex >= 0 || el.matches("#songs .song")) el.focus({ preventScroll: true }); }
  }, true);
  // ⌘-click S: exclusive solo (Ableton); Alt-click stays as before
  window.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".row.trk .sb[data-song]"); if (!b || !cmdKey(e)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const s = songOf(b.dataset.song), t = b.dataset.track; if (!s) return;
    const only = !!(s.solo || {})[t] && Object.keys(s.solo || {}).filter((k) => s.solo[k]).length === 1;
    snap(); s.solo = only ? {} : { [t]: true }; refresh(); if (window.SLE && SLE.levelsChanged) SLE.levelsChanged(s);
    toast(only ? `Solo off in ${s.name}` : `Solo “${t}” only`, undo);
  }, true);
  // Z: zoom to the selection (a section, a clip, the selected items); ⇧Z or X: back
  let ZBACK = [];
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector(".cfbg, .pal10")) return;
    const k = e.key.toLowerCase(); if (k !== "z" && k !== "x") return;
    const FS = typeof focusSong === "function" ? focusSong() : null; if (!FS) return;
    if (k === "x" || e.shiftKey) { const b = ZBACK.pop(); if (!b) return; e.preventDefault(); SL9.glideTo(b.z, b.a); return; }
    let span = null;
    if (typeof selSec !== "undefined" && selSec && selSec.song === FS.id) { const p = FS.secPos.find((q) => q.id === selSec.id); if (p) span = [FS.bars[p.start - 1].t, (FS.bars[p.start - 1 + p.bars] || { t: FS.len }).t]; }
    else if (typeof selClip !== "undefined" && selClip && selClip.song === FS.id) { const cl = clipsOf(FS, selClip.track).find((c) => c.id === selClip.id); if (cl) span = [cl.start, cl.end]; }
    else if (typeof selItems === "function" && selItems().length) { const it = selItems(); let a = 1e9, b = 0; it.forEach((x) => { const o = x.o; const s0 = o.start != null ? o.start : o.bar ? FS.bars[o.bar - 1].t : null; const s1 = o.end != null ? o.end : o.bar && o.bars ? (FS.bars[o.bar - 1 + o.bars] || { t: FS.len }).t : s0; if (s0 != null) { a = Math.min(a, s0); b = Math.max(b, s1); } }); if (b > a) span = [a, b]; }
    if (!span) return;
    e.preventDefault(); ZBACK.push({ z: PXS, a: sc.scrollLeft / PXS }); if (ZBACK.length > 20) ZBACK.shift(); SL9.fitSpan(FS, span[0], span[1]);
  }, true);
  // = / −: zoom around the playhead (Ableton)
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector(".cfbg, .pal10")) return;
    if (e.key !== "=" && e.key !== "+" && e.key !== "-") return;
    const FS = typeof focusSong === "function" ? focusSong() : null; if (!FS) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const ax = playId === FS.id ? Math.max(0, Math.min(TL9.viewW(), pos * PXS - sc.scrollLeft)) : TL9.viewW() / 2;
    SL9.zoomTo(SL9.zoomTarget() * (e.key === "-" ? 1 / 1.5 : 1.5), ax);
  }, true);

  // ================================================================ Settings › General › Pinch zoom speed
  function settingsRow() {
    const b = $("sbody"); if (!b || !b.querySelector("#stLaunch") || b.querySelector("#pz12")) return;
    const v = store.get("pinchSpeed", "normal");
    const row = document.createElement("div"); row.className = "sgrp"; row.innerHTML = `<div class="sf"><label>Pinch zoom speed</label><div class="segm" id="pz12">${[["slower", "Slower"], ["normal", "Normal"], ["faster", "Faster"]].map(([k, l]) => `<button data-v="${k}" class="${k === v ? "on" : ""}">${l}</button>`).join("")}</div><p class="faint" style="font-size:11px;margin:4px 0 0">A full pinch on the trackpad zooms about ${{ slower: "3", normal: "6", faster: "13" }[v]}× (Ctrl + scroll on Windows the same way).</p></div>`;
    const lm = store.get("laneMovesPlayhead", false);
    row.insertAdjacentHTML("beforeend", `<div class="sf"><label>Click in a lane moves the playhead</label><div class="segm" id="lm12"><button data-v="0" class="${lm ? "" : "on"}">While stopped</button><button data-v="1" class="${lm ? "on" : ""}">Always</button></div><p class="faint" style="font-size:11px;margin:4px 0 0">A click in a lane sets the insert marker (where ⌘V pastes and ⌘E splits). While a song plays it jumps there only with “Always”; the ruler always jumps.</p></div>`);
    b.appendChild(row);
    row.querySelectorAll("#pz12 button").forEach((x) => x.onclick = () => { store.set("pinchSpeed", x.dataset.v); row.remove(); settingsRow(); });
    row.querySelectorAll("#lm12 button").forEach((x) => x.onclick = () => { store.set("laneMovesPlayhead", x.dataset.v === "1"); row.remove(); settingsRow(); });
  }
  new MutationObserver(settingsRow).observe(document.body, { childList: true, subtree: false });
  setInterval(settingsRow, 700);

  // ================================================================ 5. the Ableton import's Tracks step
  // The names a song's tracks come in with: Live's name (or the audio file's, "Name tracks after their audio file"),
  // without the song's name in front (on by default), then find / replace, then any name typed here (it wins).
  // Remembered per project file, so a re-import offers the same names.
  const tkKey = (src, i) => src.name + "|" + ((src.tracks || [])[i] || {}).name;
  const reAll = (x, find, rep) => { if (!find) return x; const out = []; let i = 0, lo = x.toLowerCase(), f = find.toLowerCase(); for (;;) { const j = lo.indexOf(f, i); if (j < 0) { out.push(x.slice(i)); break; } out.push(x.slice(i, j), rep); i = j + find.length; } return out.join(""); };
  function finalName(src, i, base, T) {
    T = T || {}; const own = (T.names || {})[tkKey(src, i)]; if (own) return own;
    let n = base;
    if (T.removeSong !== false && window.SL11) n = SL11.shortName(src.name, n) || n;
    if (T.find) n = reAll(n, T.find, T.replace || "");
    n = n.replace(/\s+/g, " ").trim();
    return n || base;
  }
  let RAW = false; // the Tracks step reads the names as they'd come in before its own changes
  function applyTrackNames(src, so, rows) {
    if (RAW) return 0;
    const T = (typeof ABLE_OPT !== "undefined" && ABLE_OPT && ABLE_OPT.trk) || { removeSong: true };
    let n = 0;
    rows.forEach((row, i) => {
      const cur = row.name; let want = finalName(src, i, cur, T); if (want === cur || !so.tracks.includes(cur)) return;
      const r0 = typeof ROLE !== "undefined" ? ROLE[want] : ""; if (r0 === "click" || r0 === "cues") want += " (audio)";
      let k = 2, w2 = want; while (so.tracks.includes(w2)) w2 = `${want} ${k++}`;
      window.renameTrack(so, cur, w2); (so.tfull || (so.tfull = {}))[w2] = (src.tracks[i] || {}).name || cur; n++;
    });
    return n;
  }
  function tracksStep(data, r, body, foot) {
    return new Promise((res) => {
      const key = "ableTracks." + (data.path || data.project || "");
      const T = Object.assign({ removeSong: true, fileNames: !!(r.opt && r.opt.fileNames), find: "", replace: "", names: {} }, store.get(key, {}));
      T.names = T.names || {};
      const picks = (r.picks || []).map((p) => data.songs[p.i]).filter(Boolean);
      let open = null; // {keys: [...], from, to}: "the same name in other songs"
      const rowsOf = (src) => { const keep = ABLE_OPT.fileNames; ABLE_OPT.fileNames = T.fileNames; RAW = true; let out = []; try { out = (SLAble.song(src).rows || []); } catch (e) {} RAW = false; ABLE_OPT.fileNames = keep; return out; };
      const draw = () => {
        const sc0 = body.querySelector(".tlist12") ? body.querySelector(".tlist12").scrollTop : 0;
        body.innerHTML = `<div class="ttools12">
            <label><input type="checkbox" id="tk12song" ${T.removeSong ? "checked" : ""}> Remove the song’s name from track names</label>
            <label><input type="checkbox" id="tk12file" ${T.fileNames ? "checked" : ""}> Name tracks after their audio file</label>
            <span class="tfr12"><input id="tk12find" placeholder="Find" value="${esc(T.find)}" spellcheck="false"><span>→</span><input id="tk12rep" placeholder="Replace with" value="${esc(T.replace)}" spellcheck="false"></span>
          </div>
          ${open ? `<div class="tsame12">“${esc(open.from)}” is also in ${open.keys.length} other song${open.keys.length === 1 ? "" : "s"}. <button class="btn line" id="tk12all">Rename ${open.keys.length === 1 ? "it" : "them"} “${esc(open.to)}” too</button><button class="btn line" id="tk12no">No</button></div>` : ""}
          <div class="tlist12">${picks.map((src) => { const rows = rowsOf(src); return `<div class="tsong12"><b>${esc(src.name)}</b>${rows.map((row, i) => { const fin = finalName(src, i, row.name, T), orig = (src.tracks[i] || {}).name || row.name;
              return `<div class="trow12"><span class="tkind12">${row.kind === "midi" ? "MIDI" : "Audio"}</span><span class="tnm12" data-k="${esc(tkKey(src, i))}" data-s="${esc(src.name)}" data-i="${i}" title="Double-click to rename · ⇥ next">${esc(fin)}</span>${fin !== orig ? `<span class="twas12">${esc(orig)}</span>` : ""}${T.names[tkKey(src, i)] ? `<button class="treset12" data-k="${esc(tkKey(src, i))}" title="Back to the automatic name">↺</button>` : ""}</div>`; }).join("")}</div>`; }).join("")}</div>`;
        const L = body.querySelector(".tlist12"); if (L) L.scrollTop = sc0;
        foot.innerHTML = `<span class="faint">${picks.reduce((a, src) => a + (src.tracks || []).length, 0)} tracks in ${picks.length} song${picks.length === 1 ? "" : "s"}</span><button class="btn line" id="tk12back">Back</button><button class="btn line" id="tk12x">Cancel</button><button class="btn pri" id="tk12go">Import</button>`;
        body.querySelector("#tk12song").onchange = (e) => { T.removeSong = e.target.checked; draw(); };
        body.querySelector("#tk12file").onchange = (e) => { T.fileNames = e.target.checked; draw(); };
        const fr = () => { T.find = body.querySelector("#tk12find").value; T.replace = body.querySelector("#tk12rep").value; const a = document.activeElement && document.activeElement.id; draw(); if (a) { const el = body.querySelector("#" + a); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } };
        body.querySelector("#tk12find").oninput = fr; body.querySelector("#tk12rep").oninput = fr;
        body.querySelectorAll(".treset12").forEach((b) => b.onclick = () => { delete T.names[b.dataset.k]; draw(); });
        if (open) { body.querySelector("#tk12all").onclick = () => { open.keys.forEach((k) => { T.names[k] = open.to; }); open = null; draw(); }; body.querySelector("#tk12no").onclick = () => { open = null; draw(); }; }
        foot.querySelector("#tk12back").onclick = () => res("back");
        foot.querySelector("#tk12x").onclick = () => res(null);
        foot.querySelector("#tk12go").onclick = () => { store.set(key, T); r.opt = r.opt || {}; r.opt.trk = { removeSong: T.removeSong, find: T.find, replace: T.replace, names: { ...T.names } }; r.opt.fileNames = T.fileNames; res("ok"); };
      };
      // double-click a name (or ↩ on it): rename it in place; ⇥ goes to the next
      const renameRow = (el) => {
        const k = el.dataset.k, src = picks.find((x) => x.name === el.dataset.s), i = +el.dataset.i, orig = (src.tracks[i] || {}).name;
        SL10a.editInline(el, el.textContent, (v) => {
          T.names[k] = v;
          const same = picks.flatMap((x) => (x.tracks || []).map((t, j) => ({ x, t, j }))).filter((o) => o.x !== src && o.t.name === orig && T.names[tkKey(o.x, o.j)] !== v).map((o) => tkKey(o.x, o.j));
          open = same.length ? { keys: same, from: orig, to: v } : null; draw();
        }, { label: "Track name", row: ".trow12" });
      };
      body.addEventListener("dblclick", (e) => { const el = e.target.closest && e.target.closest(".tnm12"); if (el) { e.preventDefault(); renameRow(el); } });
      body.addEventListener("keydown", (e) => {
        if (e.key !== "Tab" || !SL10a.editing()) return; const el = SL10a.editing().el; if (!el.classList || !el.classList.contains("tnm12")) return;
        e.preventDefault(); e.stopImmediatePropagation(); const all = [...body.querySelectorAll(".tnm12")], i = all.indexOf(el), k = el.dataset.k;
        SL10a.editing().end(true); setTimeout(() => { const L2 = [...body.querySelectorAll(".tnm12")]; const j = L2.findIndex((x) => x.dataset.k === k); const nx = L2[(j + (e.shiftKey ? -1 : 1) + L2.length) % L2.length]; if (nx) renameRow(nx); }, 30);
      }, true);
      draw();
    });
  }

  // ================================================================ 8. the conventions audit: the fixes
  // §8 the insert marker: a click in a lane puts it there (⌘V pastes there, ⌘E splits there). Stopped: the playhead
  // goes there too (Space plays from it, as in Ableton); playing: it doesn't jump, unless Settings › General ›
  // "Click in a lane moves the playhead" is on.
  let INS = null; // {song, t}
  function laneClick(s, t) {
    INS = { song: s.id, t };
    if (!busy() || store.get("laneMovesPlayhead", false)) locate(s, t);
    drawIns();
  }
  function drawIns() {
    document.querySelectorAll(".ins12").forEach((x) => { if (!INS || x.closest(".folder").dataset.id !== INS.song) x.remove(); });
    if (!INS) return; const f = document.querySelector(`.folder[data-id="${INS.song}"]`); if (!f) return;
    let el = f.querySelector(".ins12"); if (!el) { el = document.createElement("i"); el.className = "ins12"; f.appendChild(el); }
    const X = TX.x(INS.t); el.style.left = `calc(var(--head) + ${TX.lineLeft(X, 1)}px)`; el.style.display = X < 0 ? "none" : "block";
  }
  setInterval(() => { if (INS) drawIns(); }, 250);
  const insert = (s) => (INS && s && INS.song === s.id ? INS.t : null);
  // ⌘E: split the selected clip at the insert marker (or the playhead)
  function split() {
    if (typeof selClip === "undefined" || !selClip) { toast("Select a clip to split (click it), then ⌘E"); return false; }
    const s = songOf(selClip.song), t = selClip.track, cl = s && clipsOf(s, t).find((c) => c.id === selClip.id); if (!cl) return false;
    const at = insert(s) != null && insert(s) > cl.start + 0.05 && insert(s) < cl.end - 0.05 ? insert(s) : playId === s.id ? pos : null;
    if (at == null || !splitClip(s, t, cl, at)) { toast("Put the insert marker (click) or the playhead inside the clip to split it"); return false; }
    return true;
  }
  // ⌘F: Follow (the view pages with the playhead); scrolling by hand turns it off
  let FOLLOW = store.get("follow", true);
  const F0 = window.follow;
  window.follow = function () { if (FOLLOW) return F0.apply(this, arguments); };
  function follow(on) { if (on === undefined) return FOLLOW; FOLLOW = !!on; store.set("follow", FOLLOW); toast(FOLLOW ? "Follow playhead: on" : "Follow playhead: off"); if (window.SLMenus) SLMenus.update(); return FOLLOW; }
  sc.addEventListener("wheel", (e) => { if (!busy() || !FOLLOW || e.altKey || e.ctrlKey || e.metaKey) return; if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { FOLLOW = false; store.set("follow", false); toast("Follow playhead: off (you scrolled) · ⌘F turns it back on"); } }, { passive: true });
  // §10 markers: a click selects (and goes there), a drag moves it (snapped to the beat; ⌘ free)
  window.addEventListener("pointerdown", (e) => {
    const m = e.target.closest && e.target.closest(".mkr[data-i]"); if (!m || e.button !== 0) return;
    const f = m.closest(".folder"), s = f && songOf(f.dataset.id); if (!s) return;
    document.querySelectorAll(".mkr.sel12").forEach((x) => x.classList.remove("sel12")); m.classList.add("sel12");
    const lane = m.closest(".lane"), cv = lane && lane.querySelector("canvas.rcv"), cx = e.clientX, i = +m.dataset.i; let moved = false;
    const mv = (ev) => { if (!s.marks || !s.marks[i] || !m.isConnected || !(ev.buttons & 1)) { up(); return; } // gone, or the button is up
      if (!moved && Math.abs(ev.clientX - cx) < 4) return; if (!moved) { moved = true; snap(); }
      const x = cv ? TX.canvasSongX(ev, cv) : 0, t = nearestBeatT(s, x / PXS, cmdKey(ev)), bb = barBeatAt(s, t);
      const mk = s.marks[i]; mk.bar = bb.bar; mk.beat = +bb.beat.toFixed(3); m.style.left = evTime(s, mk) * PXS + "px"; ghost(s, t); };
    let done = false;
    const up = () => { if (done) return; done = true; removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); unghost(); if (moved && s.marks && s.marks[i]) { s.marks.sort((a, b) => a.bar - b.bar || a.beat - b.beat); refresh(); toast(`Moved the marker to ${bbLabel(s, evTime(s, s.marks.find((x) => x === s.marks[i]) || s.marks[0]))}`, undo); } };
    addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true);
    if (moved) e.stopImmediatePropagation();
  }, true);
  // §10 time signatures: a click selects, a double-click edits
  window.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".msig9[data-bar]"); if (!b) return;
    e.stopImmediatePropagation(); e.preventDefault();
    document.querySelectorAll(".msig9.sel12").forEach((x) => x.classList.remove("sel12")); b.classList.add("sel12");
  }, true);
  window.addEventListener("dblclick", (e) => {
    const b = e.target.closest && e.target.closest(".msig9[data-bar]"); if (!b) return; e.stopImmediatePropagation(); e.preventDefault();
    const l = b.closest(".lane"), s = l && songOf(l.dataset.song); if (s && window.SLMeter) SLMeter.open(s, +b.dataset.bar, e);
  }, true);
  // §1 ↑ / ↓ move the selection in a list (the setlist, the library, cards, Folders rows)
  window.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.metaKey || e.ctrlKey || typing(e.target) || document.querySelector(".cfbg, .pal10, .xm.ctx")) return;
    const a = document.activeElement; if (!a || !a.closest || !a.closest("#songs, #pool, .card9, .row9, .wall9g")) return;
    const inSet = !!a.closest("#songs"), ids = inSet ? setOrder.slice() : [...document.querySelectorAll(".card9[data-id], .row9[data-row], #pool .ps[data-id]")].map((x) => x.dataset.id || x.dataset.row).filter((x, i, A) => A.indexOf(x) === i);
    const i = ids.indexOf(selId), j = Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i) + (e.key === "ArrowUp" ? -1 : 1))); if (!ids[j]) return;
    e.preventDefault(); e.stopImmediatePropagation(); select(ids[j], true);
    const el = document.querySelector(inSet ? `#songs .song[data-id="${ids[j]}"]` : `.card9[data-id="${ids[j]}"], .row9[data-row="${ids[j]}"], #pool .ps[data-id="${ids[j]}"]`); if (el) { el.scrollIntoView({ block: "nearest" }); try { el.focus({ preventScroll: true }); } catch (x) {} }
  }, true);
  // §4 ↩ renames the selected track, section or marker
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || typing(e.target) || document.querySelector(".cfbg, .pal10, .xm.ctx") || (window.SL10a && SL10a.editing())) return;
    const L = LAST; if (!L) return;
    if (L.kind === "track") { const s = songOf(L.s), h = document.querySelector(`.row.trk > .lh[data-song="${L.s}"][data-track="${CSS.escape(L.t)}"] .tn`); if (s && h) { e.preventDefault(); e.stopImmediatePropagation(); renameTrackBox(s, L.t, h); } return; }
    if (L.kind === "section") { const s = songOf(L.s); if (s) { e.preventDefault(); e.stopImmediatePropagation(); renameSec(s, L.id); } return; }
    if (L.kind === "marker" && window.SL11) { e.preventDefault(); e.stopImmediatePropagation(); SL11.run("rename"); }
  }, true);
  // §7 ⇧ / ⌘-click track headers: several tracks; ⌫ deletes them (one undo step)
  let TSEL = [], ANCH = null;
  const markT = () => document.querySelectorAll(".row.trk > .lh").forEach((lh) => lh.classList.toggle("tsel12", TSEL.some((x) => x.s === lh.dataset.song && x.t === lh.dataset.track)));
  window.addEventListener("pointerdown", (e) => {
    const lh = e.target.closest && e.target.closest(".row.trk > .lh"); if (!lh || e.button !== 0 || isCtl(e.target)) { if (!(e.target.closest && e.target.closest(".row.trk > .lh"))) { if (TSEL.length) { TSEL = []; markT(); } } return; }
    const k = { s: lh.dataset.song, t: lh.dataset.track };
    if (e.shiftKey || cmdKey(e)) {
      if (!TSEL.length && ANCH && ANCH.s === k.s) TSEL = [{ s: ANCH.s, t: ANCH.t }];
      const i = TSEL.findIndex((x) => x.s === k.s && x.t === k.t);
      if (e.shiftKey && TSEL.length) { const so = songOf(k.s), a = so.tracks.indexOf(TSEL[TSEL.length - 1].t), b = so.tracks.indexOf(k.t); TSEL = so.tracks.slice(Math.min(a, b), Math.max(a, b) + 1).map((t) => ({ s: k.s, t })); }
      else if (i >= 0) TSEL.splice(i, 1); else TSEL = TSEL.filter((x) => x.s === k.s).concat([k]);
      setTimeout(() => { LAST = TSEL.length > 1 ? { kind: "tracks" } : TSEL.length ? { kind: "track", s: TSEL[0].s, t: TSEL[0].t } : { kind: "none" }; markT(); }, 0);
    } else { if (TSEL.length) { TSEL = []; markT(); } }
    if (!e.shiftKey) ANCH = k;
  }, true);
  new MutationObserver(() => { if (TSEL.length) markT(); }).observe(sc, { childList: true });
  // no question for deletes undo can restore (conventions §2): a track with audio recorded in set.Line too
  if (window.SL9) { const D0 = SL9.deleteTrack; SL9.deleteTrack = function (s, t) { return D0.call(this, s, t, false); }; }
  // §3 undo puts the selection and the view back as they were before the change
  const UIS = new Map();
  const uiNow = () => ({ selId, focusId: typeof focusId !== "undefined" ? focusId : null, top: sc.scrollTop, left: sc.scrollLeft, selSec: typeof selSec !== "undefined" && selSec ? { ...selSec } : null, track: typeof trackOpen !== "undefined" && trackOpen ? { ...trackOpen } : null });
  const SNAP0 = window.snap;
  window.snap = function () { const r = SNAP0.apply(this, arguments); try { if (undoS.length) UIS.set(undoS[undoS.length - 1], uiNow()); if (UIS.size > 200) UIS.delete(UIS.keys().next().value); } catch (e) {} return r; };
  const putUI = (u) => { if (!u) return; try {
    if (u.focusId && typeof focusId !== "undefined" && focusId !== u.focusId && songOf(u.focusId)) openSong(u.focusId); else if (u.selId && songOf(u.selId) && selId !== u.selId) select(u.selId, false);
    if (u.selSec && songOf(u.selSec.song)) selSec = u.selSec;
    if (u.track && songOf(u.track.song) && songOf(u.track.song).tracks.includes(u.track.track)) { trackOpen = u.track; LAST = { kind: "track", s: u.track.song, t: u.track.track }; }
    refresh(); requestAnimationFrame(() => { sc.scrollTop = u.top; sc.scrollLeft = u.left; }); } catch (e) {} };
  for (const [name, from, to] of [["undo", () => undoS, () => redoS], ["redo", () => redoS, () => undoS]]) {
    const F = window[name]; if (typeof F !== "function") continue;
    window[name] = function () { const L = from(); const key = L[L.length - 1], cur = uiNow(), u = key != null ? UIS.get(key) : null; const r = F.apply(this, arguments); const T = to(); if (T.length) UIS.set(T[T.length - 1], cur); putUI(u); return r; };
  }

  window.SL12 = { tabNext, laneClick, insert, split, follow, tsel: () => TSEL.slice(), applyTrackNames, tracksStep, finalName, pinch, gStart, gSet, gEnd, lastGesture: () => LASTG, speed, del, last: () => LAST, setLast: (x) => { LAST = x; }, nearestBeatT, rulerX, ghost, updateTop, drawMeters: () => drawMeters(performance.now()), meterPos: () => (mDirty && measureMeters(), MPOS.slice()), meterState: (k) => MST.get(k), clickToggles, prefetch, fitTop };
})();
