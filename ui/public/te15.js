// set.Line 15 §2: a single click on a track header opens its editor at the bottom (mockups docs/design/phase15/te1.png,
// te1-zoom.png). Click track → the click editor; MIDI / modeler track → the patch change editor; audio track → the
// audio track editor below. Another header switches to its editor; the open one again (or Esc) closes it. A
// double-click on the name still renames it; ⇧ / ⌘-click still select several tracks (no editor then).
// The audio track editor, in the same bottom-panel shell as the others (its own zoom and scroll, the link toggle,
// play / stop / restart): the track's clips drawn big, each with its clip gain line and fade-in / fade-out handles
// (drag them; double-click: 0 dB / no fade); the selected clip's gain and fades as numbers you can type; the
// track's volume, small M and S, its meter, output and colour. Every change is one undo step.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const VID = "audio";
  const store = { get: (k, d) => { try { const v = localStorage.getItem("setline." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("setline." + k, JSON.stringify(v)); } catch (e) {} } };
  let AE = null; // {s, t, h, cl (the selected clip's id), drag}
  const GLO = -48, GHI = 6, RULER = 24;
  const clipsHere = () => (AE ? clipsOf(AE.s, AE.t) : []);
  const curClip = () => { const L = clipsHere(); return L.find((c) => c.id === AE.cl) || (L.length === 1 ? L[0] : null); };
  const fmtDb = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + " dB";
  const fmtS = (v) => (+v || 0).toFixed(1) + " s";
  const ICON = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><rect x="1" y="6" width="1.6" height="4" rx=".8"/><rect x="4" y="3" width="1.6" height="10" rx=".8"/><rect x="7" y="5" width="1.6" height="6" rx=".8"/><rect x="10" y="2" width="1.6" height="12" rx=".8"/><rect x="13" y="6" width="1.6" height="4" rx=".8"/></svg>';

  // ---------------------------------------------------------------- open / close
  function open(s, t, restore) {
    if (window.SLClick) SLClick.close(); if (window.PE13) PE13.close(); // one bottom panel
    const same = AE && AE.s === s && AE.t === t;
    if (window.ED13) ED13.open(VID, s, restore);
    if (!same) { const sel = typeof selClip !== "undefined" && selClip && selClip.song === s.id && selClip.track === t ? selClip.id : null; AE = { s, t, h: store.get("ateH", 290), cl: sel }; }
    build();
  }
  function close() { if (AE && window.ED13) ED13.closed(VID, AE.s, AE.t); AE = null; const p = $("ate15"); if (p) p.remove(); }
  // the other editors close this one when they open
  const wrapOpen = (o) => { if (!o || o.open._te15) return; const O = o.open; o.open = function () { if (AE) close(); return O.apply(this, arguments); }; o.open._te15 = true; };
  addEventListener("DOMContentLoaded", () => { wrapOpen(window.SLClick); wrapOpen(window.PE13); });
  setTimeout(() => { wrapOpen(window.SLClick); wrapOpen(window.PE13); }, 0);

  function build() {
    let p = $("ate15"); const sc = $("scroller");
    if (!p) { p = document.createElement("div"); p.id = "ate15"; p.tabIndex = -1; p.dataset.keys = "own"; p.dataset.editor = VID; sc.parentElement.insertBefore(p, sc.nextSibling); }
    const s = AE.s, t = AE.t, n = clipsHere().length, c = trackCol(s, t), v = gainOf(s, t), m = !!(s.mute || {})[t], so = !!(s.solo || {})[t];
    p.style.height = AE.h + "px"; p.style.setProperty("--tc", c);
    p.innerHTML = `<i class="crz10" title="Drag to resize"></i><div class="ch10 ate15h"><span class="ate15ic" style="color:${c}">${ICON}</span><b>${esc(t)}</b><span class="ate15k">audio track · ${n} clip${n === 1 ? "" : "s"}</span>${window.ED13 ? ED13.trHTML(s.id) : ""}<span style="flex:1"></span>
        <button class="btn line ate15out" title="Output">${esc(routeOf(s, t) || "No output")} ▾</button><button class="btn line ate15col" title="Track colour"><i class="rm15sw" style="background:${c}"></i>Colour</button>${window.ED13 ? ED13.linkHTML(VID) : ""}<button class="ibtn cx10" title="Close  Esc" aria-label="Close">✕</button></div>
      <div class="ate15b"><div class="ate15l">
        <h6>Volume</h6><div class="ate15v"><input type="range" class="fad wide ate15vol" min="-60" max="6" step="0.5" value="${v}" style="--p:${((v + 60) / 66 * 100).toFixed(1)}%" title="Volume. Double-click for 0 dB" aria-label="Volume"><b class="ate15db">${dbTxt(v)}</b></div>
        <div class="ate15ms"><button class="ate15m ${m ? "on" : ""}" title="Mute" aria-pressed="${m}">M</button><button class="ate15s ${so ? "on" : ""}" title="Solo (⌘-click: only this one)" aria-pressed="${so}">S</button><canvas class="ate15mt" width="110" height="6" aria-hidden="true"></canvas></div>
        <h6>Selected clip</h6><div class="ate15sel"></div></div>
        <canvas class="ate15c"></canvas></div>`;
    const q = (sel) => p.querySelector(sel);
    q(".cx10").onclick = close;
    q(".ate15out").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); outMenu({ clientX: r.left, clientY: r.bottom + 4 }, s, t); setTimeout(() => { if (AE) build(); }, 0); };
    q(".ate15col").onclick = (e) => swatchPop({ left: e.clientX, right: e.clientX, top: e.clientY }, c, (col) => { snap(); (s.tcol || (s.tcol = {}))[t] = col; refresh(); toast(`Changed the colour of “${t}”`, undo); if (AE) build(); });
    const vol = q(".ate15vol"); let vs = false;
    vol.onpointerdown = (e) => { e.stopPropagation(); if (!vs) { snap(); vs = true; } };
    vol.oninput = () => { if (!vs) { snap(); vs = true; } (s.gain || (s.gain = {}))[t] = +vol.value; syncVol(s, t); q(".ate15db").textContent = dbTxt(+vol.value); vol.style.setProperty("--p", ((+vol.value + 60) / 66 * 100).toFixed(1) + "%"); };
    vol.onchange = () => { vs = false; toast(`“${t}” volume ${dbTxt(gainOf(s, t))} dB`, undo); };
    vol.ondblclick = () => { snap(); (s.gain || (s.gain = {}))[t] = 0; syncVol(s, t); build(); toast(`“${t}” volume 0 dB`, undo); };
    q(".ate15m").onclick = () => { snap(); (s.mute || (s.mute = {}))[t] = !s.mute[t]; syncVol(s, t); toast(`${s.mute[t] ? "Muted" : "Unmuted"} “${t}”`, undo); build(); };
    q(".ate15s").onclick = (e) => { snap(); if (TX.MAC ? e.metaKey : e.ctrlKey) s.solo = { [t]: !(s.solo || {})[t] }; else (s.solo || (s.solo = {}))[t] = !s.solo[t]; syncVol(s, t); toast(`${s.solo[t] ? "Soloed" : "Unsoloed"} “${t}”`, undo); build(); };
    if (window.ED13) ED13.bindLink(p, VID, () => { last = ""; draw(); });
    q(".crz10").onpointerdown = (e) => { e.preventDefault(); const y0 = e.clientY, h0 = AE.h; const mv = (m2) => { AE.h = Math.max(190, Math.min(innerHeight * 0.7, h0 - (m2.clientY - y0))); p.style.height = AE.h + "px"; draw(); }; const up = () => { store.set("ateH", AE.h); document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (window.TL9) TL9.bar(); }; document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up); };
    wire(q(".ate15c")); side(); last = ""; draw(); if (!looping) loop();
  }
  // the selected clip's values, typed
  function side() {
    const p = $("ate15"); if (!p || !AE) return; const el = p.querySelector(".ate15sel"), cl = curClip();
    if (!cl) { el.innerHTML = `<p class="faint">${clipsHere().length ? "Click a clip to see its gain and fades." : "No clips on this track."}</p>`; return; }
    el.innerHTML = `<label>Gain <input type="number" step="0.5" min="${GLO}" max="${GHI}" value="${(+cl.gain || 0).toFixed(1)}" data-k="gain" aria-label="Clip gain"> dB</label>
      <label>Fade in <input type="number" step="0.1" min="0" value="${(+cl.fi || 0).toFixed(1)}" data-k="fi" aria-label="Fade in"> s</label><label>out <input type="number" step="0.1" min="0" value="${(+cl.fo || 0).toFixed(1)}" data-k="fo" aria-label="Fade out"> s</label>
      ${cl.name ? `<p class="faint ate15nm">${esc(cl.name)}</p>` : ""}`;
    el.querySelectorAll("input").forEach((i) => { i.onchange = () => setVal(cl, i.dataset.k, +i.value); i.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); i.blur(); } }; });
  }
  const lenOf = (cl) => cl.end - cl.start;
  function setVal(cl, k, v, quiet) {
    if (!isFinite(v)) return; snap();
    if (k === "gain") cl.gain = Math.round(Math.max(GLO, Math.min(GHI, v)) * 10) / 10;
    if (k === "fi") cl.fi = Math.round(Math.max(0, Math.min(lenOf(cl) - (cl.fo || 0), v)) * 100) / 100;
    if (k === "fo") cl.fo = Math.round(Math.max(0, Math.min(lenOf(cl) - (cl.fi || 0), v)) * 100) / 100;
    changed(); if (!quiet) toast(k === "gain" ? `Clip gain ${fmtDb(cl.gain)} on “${AE.t}”` : `Fade ${k === "fi" ? "in" : "out"} ${fmtS(cl[k])} on “${AE.t}”`, undo);
  }
  const changed = () => { if (!AE) return; if (typeof redrawTrack === "function") redrawTrack(AE.s, AE.t); if (window.SLE && SLE.nextChanged) SLE.nextChanged(); side(); last = ""; draw(); };

  // ---------------------------------------------------------------- the canvas (its own view: TX "audio")
  function geo() {
    const p = $("ate15"), cv = p && p.querySelector(".ate15c"); if (!cv) return null;
    const pr = p.querySelector(".ate15b").getBoundingClientRect(), L = window.TL9 ? TL9.laneLeft() : pr.left + 260, W = window.TL9 ? TL9.viewW() : pr.width - 260;
    const left = Math.max(200, L - pr.left);
    return { cv, left, w: Math.max(50, Math.min(W, pr.right - pr.left - left)), h: pr.height, v: TX.view(VID) };
  }
  const yGain = (cl, y0, y1) => { const f = (Math.max(GLO, Math.min(GHI, +cl.gain || 0)) - GLO) / (GHI - GLO); return y1 - f * (y1 - y0); };
  const gainAtY = (y, y0, y1) => GLO + Math.max(0, Math.min(1, (y1 - y) / (y1 - y0))) * (GHI - GLO);
  let last = "", looping = false;
  function loop() { if (!AE || !$("ate15")) { looping = false; return; } looping = true; const G = geo(); const k = G ? [G.v.pxs, G.v.hx, G.w, G.h, AE.cl, typeof playing !== "undefined" && playing ? pos : "", JSON.stringify(clipsHere().map((c) => [c.start, c.end, c.gain, c.fi, c.fo]))].join() : ""; if (k !== last) { last = k; draw(); } meter(); requestAnimationFrame(loop); }
  function meter() { const c = $("ate15") && $("ate15").querySelector(".ate15mt"); if (!c || !AE) return; const g = c.getContext("2d"), lv = typeof levelOf === "function" ? levelOf(AE.s, AE.t) : 0, db = lv > 0 ? 20 * Math.log10(lv) : -99, f = Math.max(0, Math.min(1, (db + 54) / 54));
    g.clearRect(0, 0, c.width, c.height); g.fillStyle = "#2a2e36"; g.fillRect(0, 0, c.width, c.height); const gr = g.createLinearGradient(0, 0, c.width, 0); gr.addColorStop(0, "#30d158"); gr.addColorStop(0.72, "#30d158"); gr.addColorStop(0.86, "#ffd60a"); gr.addColorStop(1, "#ff453a"); g.fillStyle = gr; g.fillRect(0, 0, c.width * f, c.height); }
  // the clip's waveform at x (px from the clip start): the app's peaks, else a stand-in (the browser preview)
  function peaksFor(G, cl, x0, x1, y0, y1) {
    const s = AE.s, t = AE.t, sf = typeof clipSong === "function" ? clipSong(s, t, cl) : s, real = window.SLW && (sf.files || {})[t] ? SLW.get(sf, t, G.v.pxs) : null, out = [], half = (y1 - y0) / 2 - 2;
    const lin = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20)), amp = Math.min(1.6, lin(+cl.gain || 0));
    for (let X = Math.max(Math.ceil(x0), 0); X <= Math.min(Math.floor(x1), G.w); X++) {
      const tt = TX.t(X, G.v), src = tt - cl.start + (cl.off || 0); let v;
      if (real && real.data) { const ps = real.perSec, ro = real.off || 0; let i = Math.floor((src - ro) * ps), j = Math.max(i + 1, Math.ceil((src - ro + 1 / G.v.pxs) * ps)), mx = 0; if (i < 0) i = 0; if (j > real.data.length) j = real.data.length; for (; i < j; i++) if (real.data[i] > mx) mx = real.data[i]; v = (mx / 255); }
      else { const a = Math.sin(src * 1.7) * 0.5 + 0.5, b = Math.abs(Math.sin(src * 13.1 + Math.sin(src * 3.3) * 2)), c = Math.abs(Math.sin(src * 47.3)); v = 0.25 + 0.45 * a * b + 0.3 * c * b; }
      out.push([X, Math.min(half, Math.max(0.6, v * amp * clipEnv(cl, tt) * half))]);
    }
    return out;
  }
  function draw() {
    if (!AE) return; const G = geo(); if (!G) return; const s = AE.s, cv = G.cv, dpr = window.devicePixelRatio || 1;
    if (!songs.includes(s)) { const s2 = songOf(s.id); if (s2 && s2.tracks.includes(AE.t)) AE.s = s2; else { close(); return; } }
    cv.style.left = G.left + "px"; cv.style.width = G.w + "px"; cv.style.height = G.h + "px";
    if (cv.width !== Math.round(G.w * dpr) || cv.height !== Math.round(G.h * dpr)) { cv.width = Math.round(G.w * dpr); cv.height = Math.round(G.h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, G.w, G.h);
    // the ruler: bar numbers that never run into each other
    const bars = AE.s.bars || [], x = (tt) => TX.x(tt, G.v); g.font = "11px Inter, sans-serif";
    let minW = 1e9; for (let i = 0; i < bars.length - 1; i++) { const a = x(bars[i].t), b = x(bars[i + 1].t); if (b > 0 && a < G.w) minW = Math.min(minW, b - a); }
    const every = [1, 2, 4, 8, 16, 32, 64].find((k) => k * minW >= 34) || 64;
    for (let i = 0; i < bars.length; i++) { const X = x(bars[i].t); if (X < -40 || X > G.w + 2) continue; const lab = i % every === 0; g.fillStyle = lab ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.05)"; g.fillRect(Math.round(X), lab ? 0 : RULER, 1, G.h); if (lab) { g.fillStyle = "#9aa0ab"; g.fillText(String(i + 1), X + 4, 15); } }
    g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(0, RULER, G.w, 1);
    const y0 = RULER + 12, y1 = G.h - 12, c0 = trackCol(s, AE.t), cur = curClip();
    for (const cl of clipsHere()) {
      const x0 = x(cl.start), x1 = x(cl.end); if (x1 < 0 || x0 > G.w) continue; const sel = cur && cl.id === cur.id, col = cl.col || c0;
      g.save(); g.beginPath(); g.roundRect(x0, y0, Math.max(2, x1 - x0), y1 - y0, 9); g.fillStyle = "rgba(20,26,36,.92)"; g.fill(); g.clip();
      // the waveform (mirrored), dimmed when muted
      const mid = (y0 + y1) / 2 + 6, pk = peaksFor(G, cl, x0 + 1, x1 - 1, y0 + 18, y1);
      if (pk.length) { g.fillStyle = cl.mute ? "rgba(255,255,255,.2)" : col; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(pk[0][0], mid); pk.forEach(([X, h]) => g.lineTo(X, mid - h)); for (let i = pk.length - 1; i >= 0; i--) g.lineTo(pk[i][0], mid + pk[i][1]); g.closePath(); g.fill(); g.globalAlpha = 1; }
      // the name
      g.fillStyle = "#fff"; g.font = "600 12px Inter, sans-serif"; g.fillText(cl.name || (AE.s.files && AE.s.files[AE.t] && String(AE.s.files[AE.t].path || "").split(/[\\/]/).pop()) || AE.t, Math.max(x0, 0) + 10, y0 + 16);
      g.restore();
      // the gain line with its fades (an envelope), and the handles
      const gy = yGain(cl, y0 + 22, y1 - 4), fx = x0 + (cl.fi || 0) * G.v.pxs, ox = x1 - (cl.fo || 0) * G.v.pxs;
      g.strokeStyle = sel ? "#fff" : "rgba(255,255,255,.75)"; g.lineWidth = sel ? 2 : 1.4; g.beginPath(); g.moveTo(x0 + 1, y1 - 1); g.lineTo(fx, gy); g.lineTo(ox, gy); g.lineTo(x1 - 1, y1 - 1); g.stroke();
      if (sel) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.roundRect(x0 + 1, y0 + 1, Math.max(2, x1 - x0 - 2), y1 - y0 - 2, 9); g.stroke();
        for (const hx of [fx, ox]) { g.fillStyle = "#fff"; g.beginPath(); g.arc(hx, gy, 5, 0, 7); g.fill(); g.strokeStyle = "#0a84ff"; g.lineWidth = 1.5; g.stroke(); }
        const lab = fmtDb(+cl.gain || 0), lx = Math.max(x0 + 40, Math.min(x1 - 60, (Math.max(x0, 0) + Math.min(x1, G.w)) / 2)), lw = g.measureText(lab).width + 14;
        g.fillStyle = "#0a84ff"; g.beginPath(); g.roundRect(lx - lw / 2, gy - 26, lw, 19, 5); g.fill(); g.fillStyle = "#fff"; g.font = "600 12px Inter, sans-serif"; g.fillText(lab, lx - lw / 2 + 7, gy - 12); }
    }
    if (typeof playId !== "undefined" && playId === s.id && typeof pos === "number") { const X = x(pos); if (X >= 0 && X <= G.w) { g.fillStyle = "rgba(255,255,255,.75)"; g.fillRect(TX.col ? TX.col(X) : X, 0, 1, G.h); } }
    if (!clipsHere().length) { g.fillStyle = "#9aa0ab"; g.font = "13px Inter, sans-serif"; g.fillText("No clips on this track", 14, y0 + 30); }
  }
  // what's under the pointer: a fade handle, the gain line, a clip
  function hit(G, X, Y) {
    const y0 = RULER + 12, y1 = G.h - 12, x = (tt) => TX.x(tt, G.v), cur = curClip();
    for (const cl of clipsHere()) { const x0 = x(cl.start), x1 = x(cl.end); if (X < x0 - 6 || X > x1 + 6 || Y < y0 - 6 || Y > y1 + 6) continue;
      const gy = yGain(cl, y0 + 22, y1 - 4), fx = x0 + (cl.fi || 0) * G.v.pxs, ox = x1 - (cl.fo || 0) * G.v.pxs;
      if (Math.hypot(X - fx, Y - gy) < 9) return { cl, k: "fi", y0, y1 }; if (Math.hypot(X - ox, Y - gy) < 9) return { cl, k: "fo", y0, y1 };
      if (Math.abs(Y - gy) < 6 && X > fx && X < ox) return { cl, k: "gain", y0, y1 };
      if (X >= x0 && X <= x1) return { cl, k: "clip", y0, y1 }; }
    return null;
  }
  function wire(cv) {
    const pt = (e) => ({ x: TX.local(e, cv), y: TX.localY(e, cv) });
    cv.addEventListener("pointermove", (e) => { if (!AE || e.buttons) return; const G = geo(), p = pt(e), h = G && hit(G, p.x, p.y); cv.style.cursor = !h ? "" : h.k === "gain" ? "ns-resize" : h.k === "clip" ? "pointer" : "ew-resize"; cv.title = h && h.k === "gain" ? "Clip gain: drag (⌘ fine) · double-click 0 dB" : h && h.k !== "clip" ? "Fade: drag · double-click no fade" : ""; });
    cv.onpointerdown = (e) => {
      if (!AE || e.button !== 0) return; e.preventDefault(); $("ate15").focus({ preventScroll: true });
      const G = geo(), p0 = pt(e), h = hit(G, p0.x, p0.y);
      if (!h) { AE.cl = null; side(); draw(); return; }
      AE.cl = h.cl.id; if (typeof selectClip === "function") selectClip(AE.s, AE.t, h.cl); side(); draw();
      if (h.k === "clip" || e.detail >= 2) return;
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      const cl = h.cl, v0 = { gain: +cl.gain || 0, fi: +cl.fi || 0, fo: +cl.fo || 0 }; let moved = false;
      cv.onpointermove = (m) => { const p = pt(m); if (!moved && Math.abs(p.x - p0.x) < 2 && Math.abs(p.y - p0.y) < 2) return; if (!moved) { moved = true; snap(); }
        const fine = TX.MAC ? m.metaKey : m.ctrlKey;
        if (h.k === "gain") { const st = fine ? 0.1 : 0.5; let v = Math.round(gainAtY(p.y, h.y0 + 22, h.y1 - 4) / st) * st; if (Math.abs(v) < st / 2) v = 0; cl.gain = Math.max(GLO, Math.min(GHI, +v.toFixed(1))); showTip(`Clip gain ${fmtDb(cl.gain)}${fine ? " · fine" : ""}`, m); }
        else { const d = (p.x - p0.x) / G.v.pxs, v = h.k === "fi" ? v0.fi + d : v0.fo - d; cl[h.k] = Math.round(Math.max(0, Math.min(lenOf(cl) - (h.k === "fi" ? cl.fo || 0 : cl.fi || 0), v)) * 100) / 100; showTip(`Fade ${h.k === "fi" ? "in" : "out"} ${fmtS(cl[h.k])}`, m); }
        if (typeof redrawTrack === "function") redrawTrack(AE.s, AE.t); side(); last = ""; draw(); };
      cv.onpointerup = () => { cv.onpointermove = null; hideTip(); if (moved) { if (window.SLE && SLE.nextChanged) SLE.nextChanged(); toast(h.k === "gain" ? `Clip gain ${fmtDb(cl.gain)} on “${AE.t}”` : `Fade ${h.k === "fi" ? "in" : "out"} ${fmtS(cl[h.k])} on “${AE.t}”`, undo); } };
    };
    cv.ondblclick = (e) => { if (!AE) return; const G = geo(), p = pt(e), h = hit(G, p.x, p.y); if (!h || h.k === "clip") return; e.preventDefault(); setVal(h.cl, h.k, 0); };
    if (window.ED13) ED13.wire(cv, VID, () => (AE ? AE.s : null), () => { last = ""; draw(); });
  }
  // keys in the editor: ⌘A all clips, ⌫ deletes the selected clip, Esc closes
  document.addEventListener("keydown", (e) => {
    const p = $("ate15"); if (!AE || !p || !(p.contains(document.activeElement) || p.contains(e.target))) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) return;
    const cmd = TX.MAC ? e.metaKey : e.ctrlKey, take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === "Escape") { take(); if (AE.cl != null) { AE.cl = null; side(); draw(); } else close(); return; }
    if (cmd && e.key.toLowerCase() === "a" && !e.shiftKey) { take(); selectAll(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && curClip()) { take(); const cl = curClip(); if (typeof delClip === "function") delClip(AE.s, AE.t, cl); AE.cl = null; changed(); return; }
  }, true);
  function selectAll() { if (!AE) return 0; const L = clipsHere().map((o) => ({ kind: "audio", s: AE.s, t: AE.t, o })); if (!L.length) return 0; if (L.length === 1) { AE.cl = L[0].o.id; selectClip(AE.s, AE.t, L[0].o); } else setMulti(AE.s, L); side(); draw(); return L.length; }

  // ---------------------------------------------------------------- a single click on a track header
  const CTL = "button, input, select, label, textarea, [contenteditable], .hf, .ms, .hm, .hm12, .ctab, .ix10m, .grip10, .tdel9, .xs";
  const editorOf = () => (AE ? { kind: "audio", song: AE.s.id, track: AE.t } : window.SLClick && SLClick.editing() ? { kind: "click", ...SLClick.editing() } : window.PE13 && PE13.editing() ? { kind: "patch", ...PE13.editing() } : null);
  function toggle(s, t) {
    const k = trackKind(s, t), cur = editorOf();
    if (cur && cur.song === s.id && cur.track === t) { closeAny(); return "closed"; }
    if (k === "click") { if (AE) close(); SLClick.open(s, t); return "click"; }
    if (k === "midi") { if (AE) close(); PE13.open(s, t); return "patch"; }
    if (k === "audio") { open(s, t); return "audio"; }
    return null; // the Cues track: selected only (its cues are edited in the lane)
  }
  function closeAny() { if (AE) close(); if (window.SLClick && SLClick.editing()) SLClick.close(); if (window.PE13 && PE13.editing()) PE13.close(); }
  let pend = 0, lastHead = 0;
  document.addEventListener("click", (e) => {
    const lh = e.target.closest && e.target.closest(".row.trk > .lh"); if (!lh || e.button !== 0) return;
    if (e.target.closest(CTL) || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    lastHead = performance.now(); clearTimeout(pend);
    if (e.detail >= 2) return; // the second click of a double-click (rename)
    const s = songOf(lh.dataset.song), t = lh.dataset.track; if (!s || !s.tracks.includes(t)) return;
    const cur = editorOf();
    // closing the open one waits a moment: a double-click (rename) keeps it open
    if (cur && cur.song === s.id && cur.track === t) { pend = setTimeout(() => closeAny(), 280); return; }
    setTimeout(() => toggle(s, t), 0);
  }, true);
  document.addEventListener("dblclick", () => clearTimeout(pend), true);
  // Esc right after a header click (nothing else to let go of): closes the editor
  document.addEventListener("pointerdown", (e) => { if (!(e.target.closest && e.target.closest(".row.trk > .lh"))) lastHead = 0; }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !lastHead || !editorOf()) return; const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return; if (document.querySelector(".cfbg, .pop, .xm")) return;
    e.preventDefault(); e.stopImmediatePropagation(); closeAny(); lastHead = 0;
  }, true);

  if (window.ED13) ED13.register(VID, { current: () => (AE ? { song: AE.s.id, track: AE.t } : null), close: () => close(), reopen: (s, t) => { if (s.tracks.includes(t)) open(s, t, true); } });
  setInterval(() => { if (AE && (!songs.some((x) => x.id === AE.s.id) || !songOf(AE.s.id).tracks.includes(AE.t))) close(); }, 500);
  window.SL15T = { open, close, toggle, editing: () => (AE ? { song: AE.s.id, track: AE.t, clip: AE.cl } : null), editorOf, closeAny, draw, geo, hit: (x, y) => (AE ? hit(geo(), x, y) : null), selectClip: (id) => { if (AE) { AE.cl = id; side(); draw(); } }, selectAll, setVal: (k, v) => { const c = AE && curClip(); if (c) setVal(c, k, v); }, VID };
})();
