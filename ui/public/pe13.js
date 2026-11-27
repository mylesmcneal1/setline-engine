// set.Line 13 §6: the patch change editor, in the bottom panel (mockup docs/design/phase13/pe1.png).
// Double-click a modeler or MIDI track (or Track › Edit patch changes…) and it opens under the timeline, in the
// same panel as the click editor (opening one replaces the other). Rows: Preset (PC + bank bars), Scene (coloured
// blocks), Footswitch (ticks), Other MIDI (any CC, note or program change; double-click to add). A generic MIDI
// track has Program change and Other MIDI. A scene palette (A-H with the device's names and colours) to drag onto
// the lane; an orange line shows where it lands. Editing as in the MIDI editor: select, drag (snapped; ⌘ free),
// resize a scene's edges, ⌥-drag copies, ⌫, Draw mode (B), the grid (Adaptive, 1 bar, 1/4). The selected change's
// details (name, bars, the exact MIDI sent, mode on load) go in the header line. Presets are managed here (the
// Preset ▾ button, or click a preset bar): pick, rename, edit its scenes. Its own zoom and scroll (ed13.js) and
// play / stop / restart in its header. The model is the modeler lanes' (modeler.js / modeler-ui.js).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const M = window.SLMod, U = () => window.MODUI;
  if (!M) return;
  const VID = "patch", MAC = /Mac/.test(navigator.platform), isCmd = (e) => (MAC ? e.metaKey : e.ctrlKey);
  const songOf = (id) => songs.find((x) => x.id === id);
  const store = { get: (k, d) => { try { const v = localStorage.getItem("setline." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("setline." + k, JSON.stringify(v)); } catch (e) {} } };
  const RUL = 20, PAL = 268; // the bar-number strip; the scene palette's width
  let PE = null; // {s, t, sel: Set(ids), mode, grid, fsK, scK, h, drag}
  const dev = (s, t) => U().dev(s, t);
  const evs = (s, t) => U().evsOf(s, t);
  const end = (s) => { const b = s.bars[s.total - 1]; return b.t + b.dur; };
  const P = (s) => (e) => evTime(s, e);
  const AT = (s) => (x) => { const p = cueAt(s, Math.max(0, x)); return { bar: p.bar, beat: +(+p.beat).toFixed(5) }; };
  const rowsOf = (s, t) => dev(s, t) ? [["preset", "Preset", "PC + bank", 40], ["scene", "Scene", dev(s, t) === "axe" ? "CC " + M.sceneCC("axe", U().cfgOf(s, t)) : "CC 43", 52], ...(dev(s, t) === "qc" ? [["fs", "Footswitch", "CC 35–42", 36]] : []), ["other", "Other MIDI", "+ add", 40]]
    : [["pc", "Program change", "PC", 40], ["other", "Other MIDI", "+ add", 52]];
  function rowGeo(s, t) { let y = RUL; return rowsOf(s, t).map(([k, name, sub, h]) => { const r = { k, name, sub, y, h }; y += h; return r; }); }
  const kindOf = (e) => e.mod === "preset" ? "preset" : e.mod === "scene" ? "scene" : e.mod === "fs" ? "fs" : e.mod === "mode" ? "mode" : e.kind === "pc" ? "pc" : "other";
  const rowFor = (s, t, e) => { if (!dev(s, t)) return e.kind === "pc" ? "pc" : "other"; const k = kindOf(e); return k === "pc" ? "other" : k; };

  // ---------------------------------------------------------------- open / close
  function open(s, t, restore) {
    if (!s || !t) return;
    if (window.SLClick && SLClick.editing()) SLClick.close(); // one panel: this replaces the click editor
    const same = PE && PE.s.id === s.id && PE.t === t;
    if (!same) PE = { s, t, sel: new Set(), mode: "select", grid: store.get("peGrid", -1), fsK: 0, scK: 0, h: store.get("peH", 290), hover: null };
    if (U().norm) U().norm(s, t);
    build();
    if (window.ED13) { ED13.open(VID, s, restore); if (!restore) frame(); }
    draw();
  }
  // opening frames the timeline's visible range in this (narrower) canvas
  function frame() { const G = geo(); if (!G || !window.TL9) return; const m = TX.main(), k = G.w / Math.max(50, TL9.viewW()); TX.setView(VID, { pxs: m.pxs * k, hx: m.hx * k }); }
  function close() { if (!PE) return; if (window.ED13) ED13.closed(VID, PE.s, PE.t); PE = null; const p = $("pe13"); if (p) p.remove(); document.querySelectorAll(".pop13").forEach((x) => x.remove()); }
  const live = () => { if (PE && !songs.includes(PE.s)) { const s2 = songOf(PE.s.id); if (s2) PE.s = s2; else close(); } return PE; };

  // ---------------------------------------------------------------- the panel
  function build() {
    let p = $("pe13"); const sc = $("scroller"), s = PE.s, t = PE.t, d = dev(s, t), c = (s.midiCfg || {})[t] || {};
    if (!p) { p = document.createElement("div"); p.id = "pe13"; p.tabIndex = -1; p.dataset.keys = "own"; p.dataset.editor = VID; sc.parentElement.insertBefore(p, sc.nextSibling); }
    p.style.height = PE.h + "px";
    const badge = d ? `<span class="pe13b">${d === "qc" ? "QC" : "FX3"}</span>` : `<span class="pe13b gen">MIDI</span>`;
    const where = `${esc(c.port || "No port")} · ch ${c.ch || 1}`;
    p.innerHTML = `<i class="pe13rz" title="Drag to resize"></i>
      <div class="pe13h">${badge}<b class="pe13t">${esc(t)}${d ? ` · ${d === "qc" ? "Quad Cortex" : "Axe-Fx III"}` : ""}</b><span class="pe13w">patch changes · ${where}</span>${window.ED13 ? ED13.trHTML(s.id) : ""}
        <span class="pe13d" id="pe13d"></span>
        <div class="seg10 pe13m"><button data-m="select" class="${PE.mode === "select" ? "on" : ""}">Select</button><button data-m="draw" class="${PE.mode === "draw" ? "on" : ""}" title="Draw mode: click to add, drag to paint, ⌥-drag to erase  B">✎ Draw</button></div>
        <span class="clab10">Grid</span><div class="seg10 pe13g">${[[-1, "Adaptive"], [0, "1 bar"], [1, "1/4"]].map(([v, l]) => `<button data-g="${v}" class="${PE.grid === v ? "on" : ""}">${l}</button>`).join("")}</div>
        ${window.ED13 ? ED13.linkHTML(VID) : ""}${d ? `<button class="btn line pe13pre" title="Pick or rename the preset, edit its scenes">Preset ▾</button>` : ""}<button class="ibtn pe13more" title="More" aria-label="More">⋯</button><button class="ibtn pe13x" title="Close  Esc" aria-label="Close">✕</button></div>
      <div class="pe13b2"><div class="pe13l">${rowGeo(s, t).map((r) => `<div class="pe13r" style="top:${r.y}px;height:${r.h}px" data-k="${r.k}"><b>${r.name}</b><em${r.k === "other" ? ' class="pe13add"' : ""}>${r.sub}</em></div>`).join("")}</div>
        <canvas class="pe13c"></canvas>
        <div class="pe13p">${d ? `<div class="pe13k">SCENES · DRAG ONTO THE LANE</div><div class="pe13tiles"></div>` : `<div class="pe13k">PROGRAM CHANGES</div><p class="pe13n">Double-click a row to add a program change, a CC or a note. Drag to move; ⌥-drag copies; ⌫ deletes.</p>`}</div></div>`;
    tiles();
    p.querySelector(".pe13x").onclick = close;
    p.querySelectorAll(".pe13m button").forEach((b) => b.onclick = () => setMode(b.dataset.m));
    p.querySelectorAll(".pe13g button").forEach((b) => b.onclick = () => { PE.grid = +b.dataset.g; store.set("peGrid", PE.grid); p.querySelectorAll(".pe13g button").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
    if (window.ED13) ED13.bindLink(p, VID, () => draw());
    const pre = p.querySelector(".pe13pre"); if (pre) pre.onclick = (e) => presetPop(e.currentTarget);
    p.querySelector(".pe13more").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), dd = dev(PE.s, PE.t);
      ctxMenu({ clientX: r.left - 160, clientY: r.bottom + 4 }, [{ cap: "Device" }, ...[["qc", "Quad Cortex"], ["axe", "Axe-Fx III"], ["", "Generic MIDI"]].map(([v, l]) => ({ label: l, icon: dd === v ? "✓" : "", act: () => setDevice(v) })), "-",
        { label: "Select all", icon: "", key: "⌘A", act: () => { PE.sel = new Set(evs(PE.s, PE.t).filter((e) => e.mod !== "mode").map((e) => e.id)); draw(); } }, { label: "Close", icon: "", key: "Esc", act: close }]); };
    p.querySelectorAll(".pe13add").forEach((x) => x.onclick = () => addOther(null));
    // resize from the top edge
    p.querySelector(".pe13rz").onpointerdown = (e) => { e.preventDefault(); const y0 = e.clientY, h0 = PE.h; const mv = (m) => { PE.h = Math.max(200, Math.min(innerHeight * 0.7, h0 - (m.clientY - y0))); p.style.height = PE.h + "px"; draw(); }; const up = () => { store.set("peH", PE.h); document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); }; document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up); };
    wire(p.querySelector(".pe13c"));
    if (window.ED13) ED13.wire(p.querySelector(".pe13c"), VID, () => (PE ? PE.s : null), () => draw());
  }
  function setMode(m) { if (!PE) return; PE.mode = m; const p = $("pe13"); if (p) p.querySelectorAll(".pe13m button").forEach((b) => b.classList.toggle("on", b.dataset.m === m)); const c = p && p.querySelector(".pe13c"); if (c) c.style.cursor = m === "draw" ? "crosshair" : ""; draw(); }
  function setDevice(v) { const s = PE.s, t = PE.t, c = (s.midiCfg || (s.midiCfg = {}))[t] || (s.midiCfg[t] = { ch: 1 }); snap(); if (v) c.dev = v; else delete c.dev; U().norm(s, t); PE.sel.clear(); refresh(); build(); draw(); toast(`“${t}” is ${v === "qc" ? "a Quad Cortex" : v === "axe" ? "an Axe-Fx III" : "a generic MIDI device"}`, undo); }
  // the scene tiles (the preset in force at the insert line / playhead, else the first)
  function curPreset() { const s = PE.s, t = PE.t, ps = U().presetsOf(s, t); const sel = [...PE.sel].map((id) => evs(s, t).find((e) => e.id === id)).find((e) => e && e.mod === "preset"); if (sel) return sel; const at = PE.ins != null ? PE.ins : playId === s.id ? pos : 0; return U().presetAt(s, t, at) || ps[0] || null; }
  function tiles() {
    const box = document.querySelector("#pe13 .pe13tiles"); if (!box || !PE) return; const d = dev(PE.s, PE.t), pr = curPreset(), sc = U().info(d, pr ? pr.preset : -1).scenes;
    box.innerHTML = sc.map((x, k) => `<button class="pe13tile${PE.scK === k ? " on" : ""}" data-k="${k}" style="--sc:${x.col};color:${window.inkOn ? inkOn(x.col) : "#000"}" title="Drag onto the lane · click to choose it for Draw · double-click to rename or recolour"><b>${x.label}</b><small>${esc(x.name || "Scene " + x.label)}</small></button>`).join("");
    box.querySelectorAll(".pe13tile").forEach((b) => {
      const k = +b.dataset.k;
      b.onpointerdown = (e) => { if (e.button !== 0) return; e.preventDefault(); PE.scK = k; box.querySelectorAll(".pe13tile").forEach((x) => x.classList.toggle("on", x === b)); tileDrag(e, k, b); };
      b.ondblclick = () => scenePop(b, k);
    });
  }
  // drag a scene tile onto the lane: a chip follows the pointer, the orange line shows where it lands
  function tileDrag(e, k, b) {
    const cv = document.querySelector("#pe13 .pe13c"); if (!cv) return; const sx = e.clientX, sy = e.clientY; let on = false, chip = null;
    const mv = (m) => { if (!on && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
      if (!on) { on = true; chip = window.SL13 && SL13.chip ? SL13.chip(b, m) : null; }
      if (chip) SL13.chipMove(chip, m);
      const r = cv.getBoundingClientRect(), over = m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom;
      PE.land = over ? snapT2(TX.t(TX.local(m, cv), view()), isCmd(m)) : null; draw(); };
    const up = (u) => { document.removeEventListener("pointermove", mv, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("keydown", esc2, true);
      const x = PE && PE.land; if (PE) PE.land = null;
      if (on && x != null) { change(`Scene ${M.sceneLabel(dev(PE.s, PE.t), k)} at ${posTxt(PE.s, x)}`, () => U().setEvents(PE.s, PE.t, M.dropScene(dev(PE.s, PE.t), U().cfgOf(PE.s, PE.t), evs(PE.s, PE.t), k, x, P(PE.s), AT(PE.s), end(PE.s), U().newId()))); if (chip) SL13.chipDrop(chip); }
      else if (chip) SL13.chipCancel(chip);
      draw(); };
    const esc2 = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); if (PE) PE.land = null; on = false; up({}); } };
    document.addEventListener("pointermove", mv, true); document.addEventListener("pointerup", up, true); document.addEventListener("keydown", esc2, true);
  }

  // ---------------------------------------------------------------- geometry, grid
  function geo() {
    const p = $("pe13"), cv = p && p.querySelector(".pe13c"), body = p && p.querySelector(".pe13b2"); if (!cv || !body) return null;
    const hd = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--head")) || 296, w = Math.max(80, body.clientWidth - hd - PAL), h = body.clientHeight;
    return { cv, w, h, left: hd, v: view() };
  }
  const view = () => TX.view(VID);
  // the grid: Adaptive (the beat when a beat is 30 px or more, else the bar), 1 bar, 1/4
  const gridQ = () => { if (PE.grid === 0) return "bar"; if (PE.grid === 1) return 1; const b = PE.s.bars[0], beat = b.dur / b.sig[0] * view().pxs; return beat >= 30 ? 1 : "bar"; };
  const snapT2 = (x, free) => (free ? Math.max(0, x) : TX.snap(PE.s, x, false, gridQ()));

  // ---------------------------------------------------------------- drawing
  let last = "", looping = false;
  function loop() { if (!PE || !$("pe13")) { looping = false; return; } looping = true; const G = geo(); const k = G ? [G.v.pxs, G.v.hx, G.w, G.h, typeof playing !== "undefined" && playing ? pos : "", PE.hover || "", PE.ins, PE.land].join() : ""; if (k !== last) { last = k; draw(); } requestAnimationFrame(loop); }
  function draw() {
    if (!live()) return; const G = geo(); if (!G) return; const s = PE.s, t = PE.t, d = dev(s, t), cv = G.cv, dpr = window.devicePixelRatio || 1;
    cv.style.left = G.left + "px"; cv.style.width = G.w + "px"; cv.style.height = G.h + "px";
    if (cv.width !== Math.round(G.w * dpr) || cv.height !== Math.round(G.h * dpr)) { cv.width = Math.round(G.w * dpr); cv.height = Math.round(G.h * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, G.w, G.h);
    const v = G.v, X = (tt) => TX.x(tt, v), rows = rowGeo(s, t), R = Object.fromEntries(rows.map((r) => [r.k, r])), E = end(s);
    rows.forEach((r, i) => { g.fillStyle = i % 2 ? "rgba(255,255,255,.02)" : "rgba(255,255,255,.035)"; g.fillRect(0, r.y, G.w, r.h); });
    // bar numbers and lines (thinning out with the zoom), beat lines where there's room
    g.font = "10.5px Inter, sans-serif"; let minBar = 1e9; s.bars.slice(0, s.total).forEach((b) => { minBar = Math.min(minBar, b.dur * v.pxs); });
    const every = [1, 2, 4, 8, 16, 32, 64].find((k) => k * minBar >= g.measureText(String(s.total)).width + 10) || 64, gq = gridQ();
    for (const b of s.bars.slice(0, s.total + 1)) { const x = X(b.t); if (x < -60 || x > G.w + 2) continue; const lab = (b.bar - 1) % every === 0 && b.bar <= s.total;
      if (b.dur * v.pxs / b.sig[0] >= 8 && b.bar <= s.total) b.beatT.slice(1).forEach((bt) => { g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(TX.col(X(bt)), RUL, 1, G.h - RUL); });
      g.fillStyle = lab ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.08)"; g.fillRect(TX.col(x), lab ? 0 : RUL, 1, G.h); if (lab) { g.fillStyle = "#9aa0ab"; g.fillText(String(b.bar), x + 4, 13); } }
    if (gq === 1) for (const b of s.bars.slice(0, s.total)) b.beatT.slice(1).forEach((bt) => { const x = X(bt); if (x > 0 && x < G.w) { g.fillStyle = "rgba(255,255,255,.06)"; g.fillRect(TX.col(x), RUL, 1, G.h - RUL); } });
    g.fillStyle = "rgba(0,0,0,.3)"; const xe = X(E); if (xe < G.w) g.fillRect(Math.max(0, xe), RUL, G.w, G.h);
    const L = evs(s, t), sel = PE.sel, pr = (x) => U().presetAt(s, t, x), info = (n) => U().info(d, n);
    const block = (x0, x1, y, h, col, txt, sub, on, hov) => { const w = Math.max(3, x1 - x0 - 2); g.fillStyle = col; g.beginPath(); g.roundRect(x0 + 1, y, w, h, 5); g.fill();
      if (on || hov) { g.strokeStyle = on ? "#fff" : "rgba(255,255,255,.6)"; g.lineWidth = on ? 2 : 1; g.stroke(); }
      g.save(); g.beginPath(); g.rect(x0 + 1, y, Math.max(0, w - 3), h); g.clip(); const ink = window.inkOn ? inkOn(col) : "#fff"; g.fillStyle = ink; g.font = "700 12px Inter, sans-serif"; g.fillText(txt, x0 + 9, y + h / 2 + 4);
      if (sub) { const tw = g.measureText(txt).width; g.font = "600 12px Inter, sans-serif"; g.globalAlpha = 0.85; g.fillText(sub, x0 + 15 + tw, y + h / 2 + 4); g.globalAlpha = 1; } g.restore(); };
    if (d) {
      // presets: a bar from each change to the next
      const ps = U().presetsOf(s, t), rp = R.preset;
      ps.forEach((e, i) => { const a = P(s)(e), b = i + 1 < ps.length ? P(s)(ps[i + 1]) : E, x0 = X(a), x1 = X(b); if (x1 < 0 || x0 > G.w) return; const nm = info(e.preset).name;
        block(x0, x1, rp.y + 7, rp.h - 14, "#2a2e35", "Preset " + M.presetLabel(d, e.preset), nm ? "· " + nm : "", sel.has(e.id), PE.hover === e.id); });
      if (!ps.length) { g.fillStyle = "#6b7280"; g.font = "11.5px Inter, sans-serif"; g.fillText("No preset yet · Preset ▾ above, or double-click here", 10, rp.y + rp.h / 2 + 4); }
      // scenes
      const rs = R.scene; M.blocks(L, P(s), E).forEach((b) => { const x0 = X(b.start), x1 = X(b.end); if (x1 < 0 || x0 > G.w) return; const p0 = pr(b.start), scn = info(p0 ? p0.preset : -1).scenes[b.e.scene] || info(-1).scenes[0];
        block(x0, x1, rs.y + 5, rs.h - 10, scn.col, scn.label, scn.name || "", sel.has(b.e.id), PE.hover === b.e.id); });
      // footswitch presses
      if (R.fs) L.filter((e) => e.mod === "fs").forEach((e) => { const x = X(P(s)(e)); if (x < -4 || x > G.w + 4) return; g.fillStyle = sel.has(e.id) ? "#fff" : PE.hover === e.id ? "#ffe680" : "#ffd60a"; g.beginPath(); g.roundRect(TX.col(x) - 2, R.fs.y + 8, 4, R.fs.h - 16, 2); g.fill(); g.font = "600 9px Inter, sans-serif"; g.fillText("ABCDEFGH"[e.fs] || "", x + 4, R.fs.y + 14); });
    } else {
      const rp = R.pc; L.filter((e) => e.kind === "pc").forEach((e) => { const x = X(P(s)(e)); if (x < -80 || x > G.w + 4) return; chipAt(g, x, rp.y + 8, rp.h - 16, `PC ${e.pc}${e.msb ? " · bank " + e.msb : ""}`, sel.has(e.id), PE.hover === e.id); });
    }
    // other MIDI: chips
    const ro = R.other; L.filter((e) => rowFor(s, t, e) === "other" && e.mod !== "mode").forEach((e) => { const x = X(P(s)(e)); if (x < -80 || x > G.w + 4) return; chipAt(g, x, ro.y + 8, Math.min(24, ro.h - 16), otherTxt(e), sel.has(e.id), PE.hover === e.id); });
    if (!L.some((e) => rowFor(s, t, e) === "other" && e.mod !== "mode")) { g.fillStyle = "#5c626d"; g.font = "11.5px Inter, sans-serif"; g.fillText("Double-click to add any CC / note / program change", 10, ro.y + ro.h / 2 + 4); }
    // the insert line, the landing line (orange), the playhead
    if (PE.ins != null) { const x = X(PE.ins); if (x >= 0 && x <= G.w) { g.fillStyle = "rgba(255,255,255,.75)"; g.fillRect(TX.col(x), RUL, 1, G.h - RUL); } }
    if (PE.land != null) { const x = X(PE.land); g.fillStyle = "#ff9f0a"; g.fillRect(TX.col(x) - 1, RUL, 3, G.h - RUL); }
    if (typeof playId !== "undefined" && playId === s.id) { const x = X(pos); if (x >= 0 && x <= G.w) { g.fillStyle = "#fff"; g.fillRect(TX.col(x), 0, 1, G.h); } }
    // the box
    if (PE.box) { const b = PE.box; g.strokeStyle = "rgba(100,160,255,.9)"; g.fillStyle = "rgba(100,160,255,.12)"; g.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); g.strokeRect(Math.min(b.x0, b.x1) + .5, Math.min(b.y0, b.y1) + .5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0)); }
    details(); if (!looping) loop();
  }
  function chipAt(g, x, y, h, txt, on, hov) { g.font = "600 11px Inter, sans-serif"; const w = g.measureText(txt).width + 14; g.fillStyle = on ? "#3a6df0" : hov ? "#3a3f48" : "#2c3038"; g.beginPath(); g.roundRect(x, y, w, h, 4); g.fill(); g.fillStyle = "#ff9f0a"; g.fillRect(TX.col(x), y, 2, h); g.fillStyle = "#e9ebef"; g.fillText(txt, x + 7, y + h / 2 + 4); }
  const otherTxt = (e) => e.kind === "pc" ? `PC ${e.pc}` : e.kind === "note" ? `Note ${e.note} · ${e.vel ?? 100}` : `CC ${e.cc} = ${e.val}`;
  // the selected change, in the header line: "Scene C · Lead · bars 17–24 · CC 43 = 2 · ch 1 · mode on load Scene"
  function details() {
    const el = $("pe13d"); if (!el || !PE) return; const s = PE.s, t = PE.t, d = dev(s, t), c = U().cfgOf(s, t) || {}, L = evs(s, t), ids = [...PE.sel];
    if (!ids.length) { el.textContent = ""; return; } if (ids.length > 1) { el.textContent = `${ids.length} changes selected`; return; }
    const e = L.find((q) => q.id === ids[0]); if (!e) { el.textContent = ""; return; }
    const bb = barBeatAt(s, P(s)(e)), here = `bar ${bb.bar}${bb.beat > 1.001 ? "." + Math.floor(bb.beat) : ""}`, sends = d ? M.describe(d, e, c.ch).replace(/^Sends /, "").replace(/ \(.*\)/, "").replace(" on Ch ", " · ch ") : `${otherTxt(e)} · ch ${c.ch || 1}`;
    let what = otherTxt(e), span = here;
    if (e.mod === "scene") { const b = M.blocks(L, P(s), end(s)).find((q) => q.e === e), p0 = U().presetAt(s, t, P(s)(e)), sc = U().info(d, p0 ? p0.preset : -1).scenes[e.scene]; what = `Scene ${sc ? sc.label : ""}${sc && sc.name ? " · " + sc.name : ""}`; if (b) { const b1 = barBeatAt(s, Math.max(b.start, b.end - 1e-6)); span = `bars ${bb.bar}–${b1.bar}`; } }
    else if (e.mod === "preset") { const nm = U().info(d, e.preset).name; what = `Preset ${M.presetLabel(d, e.preset)}${nm ? " · " + nm : ""}`; }
    else if (e.mod === "fs") what = `Footswitch ${"ABCDEFGH"[e.fs]}`;
    const mode = d === "qc" && c.qcMode !== undefined && c.qcMode !== "" ? ` · mode on load ${["Preset", "Scene", "Stomp"][+c.qcMode]}` : "";
    el.textContent = `${what} · ${span} · ${sends}${mode}`;
  }

  // ---------------------------------------------------------------- hit-testing and editing
  function hit(x, y) {
    const s = PE.s, t = PE.t, d = dev(s, t), rows = rowGeo(s, t), r = rows.find((q) => y >= q.y && y < q.y + q.h); if (!r) return { row: null };
    const v = view(), X = (tt) => TX.x(tt, v), L = evs(s, t), tm = TX.t(x, v);
    if (r.k === "scene") { const b = M.blocks(L, P(s), end(s)).find((q) => tm >= q.start && tm < q.end); if (!b) return { row: r }; const ex = x - X(b.start), ee = X(b.end) - x; return { row: r, e: b.e, b, edge: ex < 6 && b.start > 0 ? "start" : ee < 6 ? "end" : "" }; }
    if (r.k === "preset") { const ps = U().presetsOf(s, t), e = [...ps].reverse().find((q) => P(s)(q) <= tm + 1e-9); return { row: r, e: e || null }; }
    // ticks and chips: at least 8 px of pointer each, nearest wins
    const g = document.createElement("canvas").getContext("2d"); g.font = "600 11px Inter, sans-serif";
    let best = null, bd = 1e9; for (const e of L) { if (e.mod === "mode" || rowFor(s, t, e) !== r.k) continue; const ex = X(P(s)(e)), w = r.k === "fs" ? 0 : g.measureText(r.k === "pc" ? `PC ${e.pc}${e.msb ? " · bank " + e.msb : ""}` : otherTxt(e)).width + 14, a = ex - 4, b = ex + Math.max(4, w);
      if (x < a || x > b) continue; const dd = Math.abs(x - ex); if (dd < bd) { bd = dd; best = e; } }
    return { row: r, e: best };
  }
  const change = (what, f) => { snap(); f(); toast(`${what} in “${PE.s.name}”`, undo); refreshLane(); draw(); };
  const refreshLane = () => { if (typeof redrawSong === "function") redrawSong(PE.s); };
  function wire(cv) {
    const pt = (e) => ({ x: TX.local(e, cv), y: TX.localY(e, cv) });
    cv.addEventListener("pointermove", (e) => { if (!PE || e.buttons) return; const { x, y } = pt(e), h = hit(x, y), id = h.e ? h.e.id : null; cv.style.cursor = PE.mode === "draw" ? "crosshair" : h.edge ? "col-resize" : h.e ? "grab" : ""; if (id !== PE.hover) { PE.hover = id; draw(); } });
    cv.addEventListener("pointerleave", () => { if (PE && PE.hover) { PE.hover = null; draw(); } });
    cv.onpointerdown = (e) => {
      if (e.button !== 0 || !live()) return; e.preventDefault(); $("pe13").focus({ preventScroll: true }); if (e.detail >= 2) return;
      const { x, y } = pt(e), h = hit(x, y), s = PE.s, t = PE.t, d = dev(s, t), tm = TX.t(x, view());
      if (!h.row) return;
      if (PE.mode === "draw") { drawAt(e, h, tm); return; }
      if (!h.e) { // empty: the insert line, and a box
        PE.ins = snapT2(tm, isCmd(e)); if (!e.shiftKey) PE.sel.clear(); PE.box = { x0: x, y0: y, x1: x, y1: y }; draw();
        cv.onpointermove = (m) => { const q = pt(m); PE.box.x1 = q.x; PE.box.y1 = q.y; const a = TX.t(Math.min(PE.box.x0, q.x), view()), b = TX.t(Math.max(PE.box.x0, q.x), view()), ya = Math.min(PE.box.y0, q.y), yb = Math.max(PE.box.y0, q.y);
          const rows = rowGeo(s, t).filter((r) => r.y + r.h > ya && r.y < yb).map((r) => r.k); for (const ev of evs(s, t)) { if (ev.mod === "mode") continue; const tt = P(s)(ev), inside = rows.includes(rowFor(s, t, ev)) && tt >= a && tt <= b; if (inside) PE.sel.add(ev.id); else if (!e.shiftKey) PE.sel.delete(ev.id); } draw(); };
        cv.onpointerup = () => { cv.onpointermove = null; PE.box = null; draw(); }; return; }
      const id = h.e.id;
      if (e.shiftKey || (isCmd(e) && !e.altKey)) { PE.sel.has(id) ? PE.sel.delete(id) : PE.sel.add(id); draw(); return; }
      if (!PE.sel.has(id)) PE.sel = new Set([id]);
      if (h.row.k === "preset") { tiles(); }
      const base = evs(s, t).map((q) => ({ ...q })), t0 = tm, copy = e.altKey, sx = e.clientX; let moved = false;
      try { cv.setPointerCapture(e.pointerId); } catch (x2) {}
      cv.onpointermove = (m) => {
        if (!moved && Math.abs(m.clientX - sx) < 4) return; if (!moved) { snap(); moved = true; }
        const tt = TX.t(pt(m).x, view()), free = isCmd(m);
        if (h.edge) U().setEvents(s, t, M.dragEdge(base, id, h.edge, snapT2(tt, free), P(s), AT(s), end(s), (s.bars[0].dur || 2) / 4));
        else { let out = base; const ids = [...PE.sel], nids = []; const a0 = base.find((q) => q.id === id), dt = snapT2(P(s)(a0) + (tt - t0), free) - P(s)(a0);
          for (const k of ids) { const o = base.find((q) => q.id === k); if (!o) continue; const nid = copy ? U().newId() : k; out = M.moveBlock(out, k, Math.max(0, P(s)(o) + dt), AT(s), copy, nid); nids.push(nid); }
          U().setEvents(s, t, out); if (copy) PE.copyIds = nids; PE.land = P(s)(a0) + dt; }
        refreshLane(); draw(); };
      cv.onpointerup = () => { cv.onpointermove = null; PE.land = null; if (copy && PE.copyIds) { PE.sel = new Set(PE.copyIds); delete PE.copyIds; } if (moved) toast(`${copy ? "Copied" : h.edge ? "Resized" : "Moved"} ${PE.sel.size > 1 ? PE.sel.size + " changes" : "a change"} in “${s.name}”`, undo); draw(); };
    };
    cv.ondblclick = (e) => {
      if (!live() || PE.mode === "draw") return; e.preventDefault(); const { x, y } = pt(e), h = hit(x, y), s = PE.s, t = PE.t, d = dev(s, t), tm = snapT2(TX.t(x, view()), isCmd(e)); if (!h.row) return;
      if (h.e && h.row.k !== "preset") { if (h.row.k === "scene") { scenePick(h.e, e); return; } if (h.row.k === "other" || h.row.k === "pc") { addOther(h.e, e); return; } return; }
      if (h.row.k === "preset") { presetPop(null, e); return; }
      if (h.row.k === "scene") { change(`Scene ${M.sceneLabel(d, PE.scK)} at ${posTxt(s, tm)}`, () => U().setEvents(s, t, M.dropScene(d, U().cfgOf(s, t), evs(s, t), PE.scK, tm, P(s), AT(s), end(s), U().newId()))); return; }
      if (h.row.k === "fs") { change(`Footswitch ${"ABCDEFGH"[PE.fsK]} at ${posTxt(s, tm)}`, () => evs(s, t).push({ ...M.stompEvent(PE.fsK, AT(s)(tm)), id: U().newId() })); return; }
      PE.ins = tm; addOther(null, e);
    };
  }
  // Draw mode: click adds (the chosen scene / footswitch), drag paints, ⌥ erases
  function drawAt(e, h, tm) {
    const s = PE.s, t = PE.t, d = dev(s, t), cv = e.currentTarget, done = new Set(); snap();
    const one = (h2, tt, erase) => { const k = h2.row && h2.row.k; if (!k) return; const at = snapT2(tt, isCmd(e)), key = k + "|" + at.toFixed(4); if (done.has(key)) return; done.add(key);
      if (erase) { if (h2.e && k !== "preset") U().setEvents(s, t, evs(s, t).filter((q) => q.id !== h2.e.id)); }
      else if (k === "scene") U().setEvents(s, t, M.setSceneAt(d, U().cfgOf(s, t), evs(s, t), PE.scK, AT(s)(at), U().newId()));
      else if (k === "fs" && !evs(s, t).some((q) => q.mod === "fs" && Math.abs(P(s)(q) - at) < 1e-3)) evs(s, t).push({ ...M.stompEvent(PE.fsK, AT(s)(at)), id: U().newId() });
      refreshLane(); draw(); };
    one(h, tm, e.altKey);
    const pt = (m) => ({ x: TX.local(m, cv), y: TX.localY(m, cv) });
    cv.onpointermove = (m) => { const q = pt(m); one(hit(q.x, q.y), TX.t(q.x, view()), e.altKey); };
    cv.onpointerup = () => { cv.onpointermove = null; toast(e.altKey ? `Erased changes in “${s.name}”` : `Drew changes in “${s.name}”`, undo); };
  }
  // ---------------------------------------------------------------- popovers (in the panel, not a side column)
  function pop(anchor, ev, html, w) {
    document.querySelectorAll(".pop13").forEach((x) => x.remove()); const d = document.createElement("div"); d.className = "pop13"; d.style.width = (w || 300) + "px"; d.innerHTML = html; document.body.appendChild(d);
    const r = anchor ? anchor.getBoundingClientRect() : { left: ev.clientX, right: ev.clientX, bottom: ev.clientY + 6, top: ev.clientY };
    d.style.left = Math.max(8, Math.min(innerWidth - d.offsetWidth - 8, r.left)) + "px"; const below = r.bottom + 6; d.style.top = (below + d.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - d.offsetHeight - 6) : below) + "px";
    setTimeout(() => document.addEventListener("pointerdown", function off(x) { if (d.contains(x.target) || x.target.closest(".xm.ctx, .ipop")) return; d.remove(); document.removeEventListener("pointerdown", off, true); }, true), 0);
    d.addEventListener("keydown", (k) => { if (k.key === "Escape") { k.stopPropagation(); d.remove(); $("pe13") && $("pe13").focus(); } });
    return d;
  }
  // a scene block: change its scene (the tiles)
  function scenePick(e, ev) { const s = PE.s, t = PE.t, d = dev(s, t), p0 = U().presetAt(s, t, P(s)(e)), sc = U().info(d, p0 ? p0.preset : -1).scenes;
    const d2 = pop(null, ev, `<div class="pe13k">Change to scene</div><div class="pe13tiles sm">${sc.map((x, k) => `<button class="pe13tile${e.scene === k ? " on" : ""}" data-k="${k}" style="--sc:${x.col};color:${inkOn(x.col)}"><b>${x.label}</b><small>${esc(x.name || "")}</small></button>`).join("")}</div>`, 280);
    d2.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => { const k = +b.dataset.k; d2.remove(); change(`Scene ${M.sceneLabel(d, k)}`, () => { const q = evs(s, t).find((x) => x.id === e.id); if (q) Object.assign(q, { scene: k, val: k }); }); }); }
  // a scene tile: rename or recolour (saved with the preset, so every song using it shows the same)
  function scenePop(b, k) { const s = PE.s, t = PE.t, d = dev(s, t), pr = curPreset(), pn = pr ? pr.preset : d === "qc" ? 1 : 0, sc = U().info(d, pn).scenes[k];
    const d2 = pop(b, null, `<div class="pe13k">Scene ${sc.label} · preset ${M.presetLabel(d, pn)}</div><input class="pe13in" value="${esc(sc.name || "")}" placeholder="Name (Clean, Lead…)" spellcheck="false"><div class="pe13col"></div><p class="pe13n">Saved with the preset: every song using it shows the same names and colours.</p>`, 280);
    const lib = U().LIB(), entry = () => { const x = lib[d][pn] || (lib[d][pn] = {}); x.scenes = x.scenes || []; return x; };
    const save = (patch) => { snap(); const en = entry(); en.scenes[k] = { ...(en.scenes[k] || {}), ...patch }; refreshLane(); tiles(); draw(); };
    const inp = d2.querySelector(".pe13in"); inp.focus(); inp.select(); inp.onchange = () => save({ name: inp.value.trim() }); inp.onkeydown = (x) => { if (x.key === "Enter") { save({ name: inp.value.trim() }); d2.remove(); } };
    const cw = d2.querySelector(".pe13col"); if (window.SL13 && SL13.colorPicker) SL13.colorPicker(cw, sc.col, (c) => save({ col: c })); }
  // presets: the modeler's own preset controls (pick by setlist / bank / number, rename) in a popover
  function presetPop(anchor, ev) { const s = PE.s, t = PE.t; if (!dev(s, t)) return; const cur = curPreset(); if (cur) U().setSel({ song: s.id, track: t, ids: [], preset: cur.id });
    const html = U().panel(s, t).replace(/<div class="rcard">\s*<div class="rch">Device<\/div>[\s\S]*?<\/div>\s*<\/div>/, ""); const d2 = pop(anchor, ev || { clientX: 400, clientY: 300 }, `<div class="pe13pp">${html}</div>`, 340);
    U().wirePanel(s, t); const keep = () => { if (PE) { tiles(); draw(); } }; d2.addEventListener("change", () => setTimeout(keep, 0)); d2.addEventListener("click", () => setTimeout(keep, 0)); }
  // other MIDI: add or edit any CC, note or program change
  function addOther(e0, ev) {
    const s = PE.s, t = PE.t, at = e0 ? P(s)(e0) : PE.ins != null ? PE.ins : playId === s.id ? pos : 0, e = e0 || { kind: "cc", cc: 1, val: 127 };
    const d2 = pop(null, ev || { clientX: innerWidth / 2 - 150, clientY: innerHeight / 2 }, `<div class="pe13k">${e0 ? "MIDI change" : "Add a MIDI change"} at ${posTxt(s, at)}</div>
      <div class="segm pe13kind">${[["cc", "CC"], ["pc", "Program"], ["note", "Note"]].map(([k, l]) => `<button data-k="${k}" class="${e.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="pe13f"><label>Number</label><input type="number" min="0" max="127" class="pe13a" value="${e.kind === "pc" ? e.pc ?? 0 : e.kind === "note" ? e.note ?? 60 : e.cc ?? 1}"><label class="pe13vl">${e.kind === "note" ? "Velocity" : "Value"}</label><input type="number" min="0" max="127" class="pe13v" value="${e.kind === "note" ? e.vel ?? 100 : e.val ?? 127}"></div>
      <div class="racts">${e0 ? `<button class="btn line pe13del">Delete</button>` : ""}<span style="flex:1"></span><button class="btn pri pe13ok">${e0 ? "Done" : "Add"}</button></div>`, 300);
    let kind = e.kind; const vrow = () => { const pc = kind === "pc"; d2.querySelector(".pe13v").style.display = pc ? "none" : ""; d2.querySelector(".pe13vl").style.display = pc ? "none" : ""; d2.querySelector(".pe13vl").textContent = kind === "note" ? "Velocity" : "Value"; }; vrow();
    d2.querySelectorAll(".pe13kind button").forEach((b) => b.onclick = () => { kind = b.dataset.k; d2.querySelectorAll(".pe13kind button").forEach((x) => x.classList.toggle("on", x === b)); vrow(); });
    const ok = () => { const a = Math.max(0, Math.min(127, +d2.querySelector(".pe13a").value || 0)), v = Math.max(0, Math.min(127, +d2.querySelector(".pe13v").value || 0)); d2.remove();
      const ne = kind === "pc" ? { kind: "pc", pc: a } : kind === "note" ? { kind: "note", note: a, vel: v } : { kind: "cc", cc: a, val: v };
      if (e0) change("Changed a MIDI change", () => { const q = evs(s, t).find((x) => x.id === e0.id); if (q) { ["pc", "cc", "val", "note", "vel"].forEach((k) => delete q[k]); Object.assign(q, ne); delete q.mod; } });
      else change(`Added ${otherTxt(ne)}`, () => { const n = { ...ne, ...AT(s)(at), id: U().newId(), anchor: "free" }; evs(s, t).push(n); PE.sel = new Set([n.id]); }); };
    d2.querySelector(".pe13ok").onclick = ok; d2.querySelectorAll("input").forEach((i) => i.onkeydown = (k) => { if (k.key === "Enter") ok(); }); d2.querySelector(".pe13a").focus();
    const del = d2.querySelector(".pe13del"); if (del) del.onclick = () => { d2.remove(); change("Deleted a MIDI change", () => U().setEvents(s, t, evs(s, t).filter((x) => x.id !== e0.id))); PE.sel.clear(); };
  }

  // ---------------------------------------------------------------- keys (when the panel has focus)
  let CB = null;
  document.addEventListener("keydown", (e) => {
    const p = $("pe13"); if (!PE || !p || !(p.contains(document.activeElement) || p.contains(e.target)) || document.querySelector(".pop13")) return; live();
    const s = PE.s, t = PE.t, cmd = isCmd(e), k = e.key.toLowerCase(), take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const sel = () => evs(s, t).filter((q) => PE.sel.has(q.id));
    if (e.key === "Escape") { take(); if (PE.mode === "draw") setMode("select"); else if (PE.sel.size) { PE.sel.clear(); draw(); } else close(); return; }
    if (e.key === "Backspace" || e.key === "Delete") { take(); const L = sel(); if (!L.length) return; change(`Deleted ${L.length > 1 ? L.length + " changes" : "a change"}`, () => U().setEvents(s, t, evs(s, t).filter((q) => !PE.sel.has(q.id)))); PE.sel.clear(); draw(); return; }
    if (cmd && k === "a") { take(); PE.sel = new Set(evs(s, t).filter((q) => q.mod !== "mode").map((q) => q.id)); draw(); return; }
    if (cmd && (k === "c" || k === "x")) { const L = sel(); if (!L.length) return; take(); const a = Math.min(...L.map(P(s))); CB = L.map((q) => ({ ...q, _rel: P(s)(q) - a })); if (k === "x") { change(`Cut ${L.length > 1 ? L.length + " changes" : "a change"}`, () => U().setEvents(s, t, evs(s, t).filter((q) => !PE.sel.has(q.id)))); PE.sel.clear(); } else toast(`Copied ${L.length > 1 ? L.length + " changes" : "a change"}`); return; }
    if (cmd && k === "v" && CB) { take(); const at = PE.ins != null ? PE.ins : playId === s.id ? pos : 0; change(`Pasted ${CB.length > 1 ? CB.length + " changes" : "a change"}`, () => { const add = CB.map((q) => { const n = { ...q, ...AT(s)(at + q._rel), id: U().newId() }; delete n._rel; return n; }); U().setEvents(s, t, [...evs(s, t), ...add]); PE.sel = new Set(add.map((q) => q.id)); }); return; }
    if (cmd && k === "d") { const L = sel(); if (!L.length) return; take(); const a = Math.min(...L.map(P(s))), b = Math.max(...L.map(P(s))), bar = s.bars[barIdx(s, b)], len = Math.max(bar.t + bar.dur - a, 1e-3);
      change(`Duplicated ${L.length > 1 ? L.length + " changes" : "a change"}`, () => { const add = L.map((q) => ({ ...q, ...AT(s)(P(s)(q) + len), id: U().newId() })); U().setEvents(s, t, [...evs(s, t), ...add]); PE.sel = new Set(add.map((q) => q.id)); }); return; }
    if (!cmd && !e.altKey && k === "b") { take(); setMode(PE.mode === "draw" ? "select" : "draw"); return; }
    if (!cmd && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { const L = sel(); if (!L.length) return; take(); const dir = e.key === "ArrowLeft" ? -1 : 1;
      change(`Moved ${L.length > 1 ? L.length + " changes" : "a change"}`, () => { let out = evs(s, t).map((q) => ({ ...q })); for (const q of L) { const tt = P(s)(q), b = s.bars[barIdx(s, tt)], st = e.shiftKey || gridQ() === "bar" ? b.dur : b.dur / b.sig[0]; out = M.moveBlock(out, q.id, Math.max(0, tt + dir * st), AT(s), false); } U().setEvents(s, t, out); }); return; }
    if (cmd && (e.key === "1" || e.key === "2")) { take(); PE.grid = e.key === "1" ? 1 : 0; store.set("peGrid", PE.grid); build(); draw(); return; }
  }, true);

  // ---------------------------------------------------------------- ways in
  // a double-click on a modeler or MIDI lane opens it (it replaces the old popup picker and side-panel editing)
  document.addEventListener("dblclick", (e) => {
    const cv = e.target.closest && e.target.closest("canvas[data-t]"); if (!cv) return; const s = songOf(cv.dataset.song), t = s && s.tracks[+cv.dataset.t];
    if (!s || !t || typeof isMidiTrack !== "function" || !isMidiTrack(s, t)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // a MIDI clip's name (its label strip): rename it in place; anywhere else: the editor
    if (!dev(s, t) && typeof regsOf === "function" && TX.localY(e, cv) <= 20) { const tt = TX.canvasSongX(e, cv) / PXS, r = regsOf(s, t).find((q) => tt >= s.bars[q.bar - 1].t && tt < s.bars[Math.min(q.bar + q.bars, s.total + 1) - 1].t); if (r && typeof renameRegion === "function") { renameRegion(s, t, r, cv); return; } }
    if (PE && PE.s.id === s.id && PE.t === t) close(); else open(s, t);
  }, true);
  // the old MIDI editor (drawer) and "Edit MIDI…" open this instead
  window.addEventListener("DOMContentLoaded", () => { if (typeof window.openMidi === "function" && !window.openMidi._pe13) { window.openMidi = function (songId, track) { const s = songOf(songId); if (s) open(s, track); }; window.openMidi._pe13 = true; } });
  if (window.ED13) ED13.register("patch", { current: () => (PE ? { song: PE.s.id, track: PE.t } : null), close: () => close(), reopen: (s, t) => { if (s.tracks.includes(t)) open(s, t, true); } });
  setInterval(() => { if (PE && (!songs.some((x) => x.id === PE.s.id) || !songOf(PE.s.id).tracks.includes(PE.t))) close(); }, 500);

  window.PE13 = { open, close, editing: () => (PE ? { song: PE.s.id, track: PE.t, mode: PE.mode, sel: [...PE.sel], grid: PE.grid, ins: PE.ins } : null), draw, geo, hit: (x, y) => (PE ? hit(x, y) : null), rows: () => (PE ? rowGeo(PE.s, PE.t) : []), setMode, select: (ids) => { if (PE) { PE.sel = new Set(ids); draw(); } }, setScene: (k) => { if (PE) PE.scK = k; }, VID };
})();
