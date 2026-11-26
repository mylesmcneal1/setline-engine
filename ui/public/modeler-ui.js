// 8c: modeler-native MIDI tracks in the page (Quad Cortex, Axe-Fx III). A plain script loaded after the page's own
// script, so it shares its globals (songs, PXS, evTime, snapT, refresh, renderInsp, ctxMenu, rcard, rrow, segm...).
// The messages and the lane's model are in modeler.js (window.SLMod, tested by tests/modeler.test.mjs).
// A MIDI track's device: s.midiCfg[t].dev = 'qc' | 'axe' (no dev = Generic). Presets with their names, scene names /
// colours and preset fields are in the library: MODP = {qc: {preset: {name, scenes: [{name, col}], fields}}, axe: {...}}.
(function () {
  "use strict";
  const M = window.SLMod;
  if (!M) return;
  if (!window.MODP) window.MODP = { qc: {}, axe: {} };
  const LIB = () => { const m = window.MODP; m.qc = m.qc || {}; m.axe = m.axe || {}; return m; };
  let SEL = null;          // {song, track, ids: [event ids], preset: id} the lane's selection
  let idSeq = 1;
  const newId = () => "m" + Date.now().toString(36) + (idSeq++);
  const dev = (s, t) => { const c = s && s.midiCfg && s.midiCfg[t]; return c && (c.dev === "qc" || c.dev === "axe") ? c.dev : ""; };
  const cfgOf = (s, t) => s.midiCfg[t];
  const evsOf = (s, t) => s.midi[t] || (s.midi[t] = []);
  const pos = (s) => (e) => evTime(s, e);
  const at = (s) => (x) => { const p = cueAt(s, Math.max(0, x)); return { bar: p.bar, beat: +(+p.beat).toFixed(5) }; };
  const songEnd = (s) => { const b = s.bars[s.total - 1]; return b.t + b.dur; };
  // events made in Generic (or imported) get their modeler meaning, once, when the track has a device
  function norm(s, t) {
    const d = dev(s, t), c = cfgOf(s, t);
    for (const e of evsOf(s, t)) {
      if (!e.id) e.id = newId();
      if (e.mod) continue;
      const k = M.classify(d, c, e);
      if (k === "preset") { e.mod = "preset"; e.preset = M.presetOf(d, e); if (d === "qc") e.setlist = +e.lsb || 0; }
      else if (k === "scene") { e.mod = "scene"; e.scene = +e.val; }
      else if (k === "fs") { e.mod = "fs"; e.fs = e.cc - 35; }
      else if (k === "mode") e.mod = "mode";
    }
  }
  const presetsOf = (s, t) => evsOf(s, t).filter((e) => e.mod === "preset").sort((a, b) => evTime(s, a) - evTime(s, b));
  const presetAt = (s, t, x) => { const ps = presetsOf(s, t); let cur = null; for (const p of ps) if (evTime(s, p) <= x + 1e-9) cur = p; return cur || ps[0] || null; };
  const info = (d, preset) => M.presetInfo(LIB(), d, preset);
  const curPreset = (s, t) => { const ev = SEL && SEL.song === s.id && SEL.track === t && SEL.preset ? evsOf(s, t).find((e) => e.id === SEL.preset) : null; return ev || presetsOf(s, t)[0] || null; };
  // the events list is changed in place: it is also the track's current alternate (curAlt(s, t).events)
  const setEvents = (s, t, list) => { const arr = evsOf(s, t), out = dev(s, t) === "qc" ? M.syncMode(list, cfgOf(s, t).qcMode) : list; arr.splice(0, arr.length, ...out); };
  const redraw = (s) => { if (typeof redrawSong === "function") redrawSong(s); else refresh(); };

  // ---------------- the header: badge, device and channel, status
  function badge(s, t) { const d = dev(s, t); return `<span class="modb ${d}" title="${M.DEVICES[d].name}">${M.DEVICES[d].badge.replace(" ", "<br>")}</span>`; }
  function status(s, t) {
    const d = dev(s, t), c = cfgOf(s, t), p = presetsOf(s, t)[0];
    if (d === "qc") return `Setlist ${p ? p.setlist ?? +p.lsb ?? 0 : 0}${c.qcMode !== undefined && c.qcMode !== "" ? " · " + ["Preset", "Scene", "Stomp"][+c.qcMode] + " mode" : ""}`;
    return `${p ? "Preset " + p.preset : "No preset"} · Scenes 1–8`;
  }
  const devLine = (s, t) => `${M.DEVICES[dev(s, t)].name} · Ch ${cfgOf(s, t).ch}`;

  // ---------------- the lane
  function draw(cv, g, s, t, W, H, off, col) {
    norm(s, t);
    const d = dev(s, t), evs = evsOf(s, t), end = songEnd(s), P = pos(s), ps = presetsOf(s, t), selIds = SEL && SEL.song === s.id && SEL.track === t ? SEL.ids : [];
    g.globalAlpha = off ? 0.4 : 1;
    // the preset bar on top
    const py = 3, ph = 15;
    g.font = "600 10.5px Inter, sans-serif";
    if (!ps.length) { g.fillStyle = "#4f555f"; g.fillText("No preset yet · drag one from the right panel onto this bar", (+cv.dataset.vx || 0) + 8, py + 11); } // 9e: hints at the visible left edge
    ps.forEach((e, i) => { const x0 = P(e) * PXS, x1 = (i + 1 < ps.length ? P(ps[i + 1]) : end) * PXS, pi = info(d, e.preset);
      g.fillStyle = "#24272d"; g.beginPath(); g.roundRect(x0 + 1, py, Math.max(4, x1 - x0 - 2), ph, 4); g.fill();
      g.strokeStyle = SEL && SEL.preset === e.id ? "#fff" : "#3a3f48"; g.lineWidth = 1; g.stroke();
      g.save(); g.beginPath(); g.rect(x0 + 1, py, Math.max(0, x1 - x0 - 4), ph); g.clip();
      g.fillStyle = "#e9ebef"; const lab = "Preset " + M.presetLabel(d, e.preset); g.fillText(lab, x0 + 8, py + 11);
      if (pi.name) { const w = g.measureText(lab).width; g.fillStyle = "#8a909b"; g.font = "500 10.5px Inter, sans-serif"; g.fillText(" · " + pi.name, x0 + 8 + w, py + 11); g.font = "600 10.5px Inter, sans-serif"; }
      g.restore(); });
    // scene blocks
    const by = py + ph + 4, bh = Math.max(14, H - by - 4);
    const bl = M.blocks(evs, P, end);
    if (!bl.length) { g.fillStyle = "#4f555f"; g.font = "11px Inter, sans-serif"; g.fillText("Double-click to drop a scene, or drag one in from the right panel", (+cv.dataset.vx || 0) + 8, by + bh / 2 + 4); }
    bl.forEach((b) => { const x0 = b.start * PXS, x1 = b.end * PXS, pr = presetAt(s, t, b.start), sc = info(d, pr ? pr.preset : -1).scenes[b.e.scene] || info(d, -1).scenes[0];
      g.fillStyle = sc.col; g.beginPath(); g.roundRect(x0 + 1, by, Math.max(3, x1 - x0 - 2), bh, 5); g.fill();
      if (selIds.includes(b.e.id)) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); }
      g.save(); g.beginPath(); g.rect(x0 + 1, by, Math.max(0, x1 - x0 - 4), bh); g.clip();
      const cy = by + bh / 2; g.fillStyle = "rgba(0,0,0,.28)"; g.beginPath(); g.roundRect(x0 + 7, cy - 8, 16, 16, 4); g.fill();
      g.fillStyle = "#fff"; g.font = "700 10.5px Inter, sans-serif"; g.fillText(sc.label, x0 + 15 - g.measureText(sc.label).width / 2, cy + 4);
      if (sc.name) { g.fillStyle = "rgba(10,10,12,.88)"; g.font = "700 11.5px Inter, sans-serif"; g.fillText(sc.name, x0 + 29, cy + 4); }
      g.restore(); });
    // footswitch presses (Quad Cortex): small ticks at the bottom
    evs.filter((e) => e.mod === "fs").forEach((e) => { const x = P(e) * PXS; g.fillStyle = selIds.includes(e.id) ? "#fff" : "#ffd60a"; g.beginPath(); g.roundRect(x - 2, by + bh - 12, 4, 10, 2); g.fill(); });
    g.globalAlpha = 1;
    cv._mod = { by, bh, py, ph };
  }

  // the picker: the 8 scenes of the preset in force, and (QC) the footswitches; "Sends CC 43 = 2 (Scene C) on Ch 1"
  function picker(s, t, p, cx, cy) {
    document.querySelectorAll(".modpick").forEach((x) => x.remove());
    const d = dev(s, t), c = cfgOf(s, t), pr = presetAt(s, t, evTime(s, p)), scs = info(d, pr ? pr.preset : -1).scenes;
    const el = document.createElement("div"); el.className = "modpick";
    el.innerHTML = `<div class="mpk">Change to scene at bar ${p.bar}${p.beat > 1.0001 ? "." + (+p.beat.toFixed(2)) : ""}</div><div class="mpg">${scs.map((x, k) => `<button data-k="${k}" style="--sc:${x.col}"><b>${x.label}</b><small>${esc(x.name || "Scene " + x.label)}</small></button>`).join("")}</div>`
      + (d === "qc" ? `<div class="mpk" style="margin-top:8px">Footswitch press</div><div class="mpf">${[..."ABCDEFGH"].map((l, k) => `<button data-fs="${k}" title="CC ${35 + k}">${l}</button>`).join("")}</div>` : "")
      + `<div class="mps" id="mpSays">${M.describe(d, M.sceneEvent(d, c, 0, p), c.ch)}</div>`;
    document.body.appendChild(el);
    el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, cx - el.offsetWidth / 2)) + "px";
    el.style.top = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, cy + 14)) + "px";
    el.querySelectorAll("[data-k]").forEach((b) => { b.onmouseenter = () => { el.querySelector("#mpSays").textContent = M.describe(d, M.sceneEvent(d, c, +b.dataset.k, p), c.ch); };
      b.onclick = () => { snap(); setEvents(s, t, M.setSceneAt(d, c, evsOf(s, t), +b.dataset.k, p, newId())); el.remove(); redraw(s); }; });
    el.querySelectorAll("[data-fs]").forEach((b) => { b.onmouseenter = () => { el.querySelector("#mpSays").textContent = M.describe(d, M.stompEvent(+b.dataset.fs, p), c.ch); };
      b.onclick = () => { snap(); evsOf(s, t).push({ ...M.stompEvent(+b.dataset.fs, p), id: newId() }); el.remove(); redraw(s); }; });
    setTimeout(() => document.addEventListener("pointerdown", function off(ev) { if (el.contains(ev.target)) return; el.remove(); document.removeEventListener("pointerdown", off); }), 0);
  }

  function wire(cv, s, t) {
    cv.onclick = null;
    const P = pos(s), A = at(s), end = () => songEnd(s);
    const X = (e) => lx(cv, e) / PXS;                                   // seconds at the pointer
    const SN = (x, e) => snapT(s, x, e && e.altKey && !e._copy);         // on the grid (Alt = free, unless copying)
    const L = () => cv._mod || { by: 22, bh: 30, py: 3, ph: 15 };
    const hit = (e) => { const x = X(e), y = e.offsetY, l = L(), evs = evsOf(s, t);
      if (y < l.py + l.ph + 2) { const p = presetAt(s, t, x); return p ? { kind: "preset", e: p } : { kind: "presetbar" }; }
      const fs = evs.find((q) => q.mod === "fs" && Math.abs(P(q) - x) * PXS < 5 && y > l.by + l.bh - 14); if (fs) return { kind: "fs", e: fs };
      const b = M.blocks(evs, P, end()).find((q) => x >= q.start && x < q.end); if (!b) return null;
      const ex = (x - b.start) * PXS, ee = (b.end - x) * PXS;
      return { kind: "scene", e: b.e, b, edge: ex < 6 && b.start > 0 ? "start" : ee < 6 ? "end" : "" }; };
    cv.onmousemove = (e) => { if (e.buttons) return; const h = hit(e); cv.style.cursor = !h ? "text" : h.edge ? "col-resize" : h.kind === "preset" || h.kind === "presetbar" ? "pointer" : "grab"; };
    cv.onpointerdown = (e) => {
      if (e.button !== 0) return;
      const h = hit(e);
      if (!h) { const tt = X(e), alt = e.altKey; boxOrClick(e, s, () => { SEL = null; setPick(null); locate(s, snapT(s, tt, alt)); }); return; }
      if (h.kind === "presetbar") { SEL = { song: s.id, track: t, ids: [] }; openTrack(s, t); return; }
      if (h.kind === "preset") { SEL = { song: s.id, track: t, ids: [], preset: h.e.id }; if (typeof trackOpen !== "undefined" && trackOpen && trackOpen.song === s.id && trackOpen.track === t) { renderInsp(); redraw(s); } else openTrack(s, t); return; }
      // a scene block or a footswitch tick: select (Shift adds), drag to move (Alt / Option copies), edges to resize
      const id = h.e.id;
      if (e.shiftKey) { const cur = SEL && SEL.song === s.id && SEL.track === t ? SEL.ids : []; SEL = { song: s.id, track: t, ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], preset: SEL && SEL.preset }; redraw(s); return; }
      if (!(SEL && SEL.song === s.id && SEL.track === t && SEL.ids.includes(id))) SEL = { song: s.id, track: t, ids: [id], preset: SEL && SEL.song === s.id && SEL.track === t ? SEL.preset : null };
      const base = evsOf(s, t).map((q) => ({ ...q })), x0 = X(e), sx = e.clientX, copy = e.altKey; let moved = false;
      cv.setPointerCapture(e.pointerId);
      cv.onpointermove = (m) => {
        if (!moved && Math.abs(m.clientX - sx) < 3) return;
        if (!moved) { snap(); moved = true; }
        const x = X(m);
        if (h.edge) { const nx = SN(x, m); setEvents(s, t, M.dragEdge(base, id, h.edge, nx, P, A, end(), (s.bars[0].dur || 2) / 4)); }
        else {
          let out = base, ids = SEL.ids, newIds = [];
          for (const k of ids) { const o = base.find((q) => q.id === k); if (!o) continue; const nx = SN(P(o) + (x - x0), { altKey: false }); const nid = copy ? newId() : k; out = M.moveBlock(out, k, nx, A, copy, nid); newIds.push(nid); }
          setEvents(s, t, out); if (copy) SEL.copyIds = newIds;
        }
        redraw(s);
      };
      cv.onpointerup = () => { cv.onpointermove = null; cv.onpointerup = null; if (copy && SEL.copyIds) { SEL.ids = SEL.copyIds; delete SEL.copyIds; } if (moved) refresh(); else redraw(s); };
    };
    cv.ondblclick = (e) => { const h = hit(e); const r = cv.getBoundingClientRect();
      if (h && (h.kind === "preset" || h.kind === "presetbar")) { openTrack(s, t); return; }
      picker(s, t, A(SN(X(e), e)), e.clientX, r.top + r.height / 2); };
    cv.oncontextmenu = (e) => { e.preventDefault(); const h = hit(e); const p = A(SN(X(e), e));
      if (!h || h.kind === "presetbar") { ctxMenu(e, [{ label: "Change to a scene here…", icon: "add", act: () => picker(s, t, p, e.clientX, e.clientY) }]); return; }
      const ids = SEL && SEL.song === s.id && SEL.track === t && SEL.ids.includes(h.e.id) ? SEL.ids : [h.e.id];
      ctxMenu(e, [...(h.kind === "scene" ? [{ label: "Change scene…", icon: "edit", act: () => picker(s, t, { bar: h.e.bar, beat: h.e.beat || 1 }, e.clientX, e.clientY) }] : []),
        { label: h.kind === "preset" ? "Remove this preset change" : ids.length > 1 ? `Delete ${ids.length} changes` : h.kind === "fs" ? "Delete footswitch press" : "Delete scene change", icon: "del", danger: true,
          act: () => { snap(); const del = h.kind === "preset" ? [h.e.id] : ids; setEvents(s, t, evsOf(s, t).filter((q) => !del.includes(q.id))); SEL = null; refresh(); } }]); };
    // drag and drop from the right panel: a scene onto the lane, a preset onto the preset bar
    cv.ondragover = (e) => { const ty = [...(e.dataTransfer.types || [])]; if (ty.includes("text/sl-scene") || ty.includes("text/sl-preset")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
    cv.ondrop = (e) => { const dt = e.dataTransfer, sc = dt.getData("text/sl-scene"), pr = dt.getData("text/sl-preset"); if (sc === "" && pr === "") return; e.preventDefault(); snap();
      const d = dev(s, t), c = cfgOf(s, t), x = SN(X(e), e);
      if (pr !== "") { const [n, sl] = pr.split("|"); setEvents(s, t, M.dropPreset(d, evsOf(s, t), +n, +sl || 0, x, P, A, newId())); }
      else setEvents(s, t, M.dropScene(d, c, evsOf(s, t), +sc, x, P, A, end(), newId()));
      refresh(); };
  }
  // Delete / Backspace removes the selected changes
  document.addEventListener("keydown", (e) => {
    if (!SEL || !SEL.ids || !SEL.ids.length || (e.key !== "Delete" && e.key !== "Backspace")) return;
    const a = document.activeElement; if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return;
    const s = songs.find((x) => x.id === SEL.song); if (!s || !s.midi[SEL.track]) return;
    e.preventDefault(); snap(); setEvents(s, SEL.track, evsOf(s, SEL.track).filter((q) => !SEL.ids.includes(q.id))); SEL.ids = []; refresh();
  });

  // ---------------- the right panel
  const SCENE_PAL = ["#64d2ff", "#ffd60a", "#ff453a", "#bf5af2", "#30d158", "#ff9f0a", "#ff375f", "#5e5ce6", "#ac8e68", "#c9cdd4"];
  function panel(s, t) {
    const d = dev(s, t), c = cfgOf(s, t);
    let h = rcard("Device", `<div class="segm modseg" id="mDev">${[["qc", "Quad Cortex"], ["axe", "Axe-Fx III"], ["", "Generic"]].map(([v, l]) => `<button data-v="${v}" class="${d === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <p class="rnote">${d ? "Presets and coloured scenes on the lane; the MIDI underneath is the usual Program Change and CC." : "Any MIDI device: Program Changes, CCs and notes. Helix and Kemper profiles are coming later."}</p>`
      + (d === "qc" ? `<div class="kv stack" style="margin-top:6px"><label title="CC 47 after each preset change: the mode the Quad Cortex switches to">Mode on load</label>${segm("mQcMode", [["", "Off"], ["0", "Preset"], ["1", "Scene"], ["2", "Stomp"]], c.qcMode ?? "")}</div>` : "")
      + (d === "axe" ? rrow("Scene Select CC", `<input id="mAxeCC" type="number" min="0" max="127" value="${c.sceneCC ?? 34}" style="width:70px">`) + `<p class="rnote">Must match Setup › MIDI/Remote › Scene Select on your Axe-Fx III.</p>` : ""));
    if (!d) return h;
    norm(s, t);
    const cur = curPreset(s, t), pn = cur ? cur.preset : d === "qc" ? 1 : 0, pi = info(d, pn), at1 = cur ? `bar ${cur.bar}` : "bar 1 (none yet)";
    if (d === "qc") {
      const bank = Math.floor((pn - 1) / 8) + 1, sl = cur ? (cur.setlist ?? +cur.lsb ?? 0) : 0;
      h += rcard("Preset", `<p class="rnote" style="margin-top:0">${cur ? "The preset from " + at1 + ". Drag one onto the lane's top bar to change preset mid-song." : "Pick a preset: it's sent at the start of the song."}</p>`
        + rrow("Setlist", `<select id="mQcSet">${Array.from({ length: 13 }, (_, k) => `<option value="${k}" ${k === sl ? "selected" : ""}>Setlist ${k}</option>`).join("")}</select>`)
        + rrow("Bank", `<select id="mQcBank">${Array.from({ length: 32 }, (_, k) => `<option value="${k + 1}" ${k + 1 === bank ? "selected" : ""}>Bank ${k + 1}</option>`).join("")}</select>`)
        + `<div class="mbank">${[..."ABCDEFGH"].map((l, k) => { const n = (bank - 1) * 8 + k + 1, nm = info("qc", n).name; return `<button draggable="true" data-p="${n}" class="${cur && n === pn ? "on" : ""}" title="${bank}${l}${nm ? " · " + esc(nm) : ""} (drag onto the preset bar)">${bank}${l}</button>`; }).join("")}</div>`
        + rrow("Name", `<input id="mPName" value="${esc(pi.name)}" placeholder="Name of ${M.qcName(pn)}" spellcheck="false">`));
    } else {
      const saved = Object.entries(LIB().axe).filter(([, v]) => v && v.name).map(([k, v]) => [+k, v.name]).sort((a, b) => a[0] - b[0]);
      h += rcard("Preset", `<div class="mbig"><input id="mAxeNum" type="number" min="0" max="1023" value="${pn}" title="Preset number (0-1023)"><div><b>${esc(pi.name || "Unnamed")}</b><small>Bank ${pn >> 7} · PC ${pn & 127} (sent automatically)</small></div></div>`
        + rrow("Name", `<input id="mPName" value="${esc(pi.name)}" placeholder="Name of preset ${pn}" spellcheck="false">`)
        + `<input id="mAxeQ" type="search" placeholder="Search presets by number or name…" style="width:100%;margin-top:6px" spellcheck="false"><div class="mres" id="mAxeRes">${saved.slice(0, 8).map(([n, nm]) => `<button draggable="true" data-p="${n}"><b>${n}</b> ${esc(nm)}</button>`).join("")}</div>`);
    }
    h += rcard(`Scenes · colours match your ${d === "qc" ? "QC" : "Axe-Fx"}`, `<div class="mscenes">${pi.scenes.map((x, k) => `<button draggable="true" data-sc="${k}" style="--sc:${x.col}" title="Drag onto the lane · click to rename or recolour"><b>${x.label}</b><small>${esc(x.name || "")}</small></button>`).join("")}</div>
      <p class="rnote">Click a scene to rename it or change its colour. Saved with preset ${M.presetLabel(d, pn)}, so every song using it shows the same names and colours.</p>`);
    if (typeof FIELDS !== "undefined" && FIELDS.length)
      h += rcard("Preset fields", FIELDS.map((f) => rrow(esc(f.name), fieldInput(f, pi.fields[f.id] ?? "", `data-pf="${f.id}" style="width:150px"`))).join("")
        + `<p class="rnote">Every song using ${M.presetLabel(d, pn)} gets these (a song or version can override one). Band screens and “Until next change” use them.</p>`);
    else h += rcard("Preset fields", `<p class="rnote">Add song fields (Tuning, Guitar…) and a preset can fill them in for every song that uses it.</p><div class="racts"><button class="btn line" id="mFields">Add fields…</button></div>`);
    return h;
  }
  function wirePanel(s, t) {
    const $ = (id) => document.getElementById(id), d = dev(s, t), c = cfgOf(s, t);
    if (!$("mDev")) return;
    $("mDev").querySelectorAll("button").forEach((b) => b.onclick = () => { snap(); const was = dev(s, t), to = b.dataset.v;
      if (to) c.dev = to; else delete c.dev;
      norm(s, t);
      // Quad Cortex <-> Axe-Fx III: the same presets and scenes, in the other device's messages
      if (was && to && was !== to) {
        const list = evsOf(s, t).filter((e) => e.mod !== "mode" && !(e.mod === "fs" && to !== "qc")).map((e) => {
          if (e.mod === "scene") return { ...e, cc: M.sceneCC(to, c) };
          if (e.mod === "preset") {
            const n = Math.max(to === "qc" ? 1 : 0, Math.min(to === "qc" ? 256 : 1023, e.preset)), ne = M.presetEvent(to, n, e.setlist || 0, e);
            const o = { ...e, ...ne, id: e.id }; delete o.presetId; if (to !== "qc") delete o.lsb; return o;
          }
          return e; });
        setEvents(s, t, list);
      }
      SEL = null; refresh(); });
    if ($("mQcMode")) $("mQcMode").querySelectorAll("button").forEach((b) => b.onclick = () => { snap(); c.qcMode = b.dataset.v; setEvents(s, t, evsOf(s, t)); refresh(); });
    if ($("mAxeCC")) $("mAxeCC").onchange = () => { snap(); const n = Math.max(0, Math.min(127, +$("mAxeCC").value || 34)); c.sceneCC = n; evsOf(s, t).forEach((e) => { if (e.mod === "scene") e.cc = n; }); refresh(); };
    if (!d) return;
    const cur = curPreset(s, t);
    const setPreset = (n, sl) => { snap(); const x = cur ? evTime(s, cur) : 0; setEvents(s, t, M.dropPreset(d, evsOf(s, t), n, sl, x, pos(s), at(s), newId())); if (!cur) SEL = { song: s.id, track: t, ids: [], preset: presetsOf(s, t)[0].id }; refresh(); };
    const pn = cur ? cur.preset : d === "qc" ? 1 : 0;
    if ($("mQcSet")) $("mQcSet").onchange = () => setPreset(pn, +$("mQcSet").value);
    if ($("mQcBank")) $("mQcBank").onchange = () => { const n = (+$("mQcBank").value - 1) * 8 + 1; setPreset(n, cur ? cur.setlist || 0 : 0); };
    document.querySelectorAll(".mbank [data-p], .mres [data-p]").forEach((b) => {
      b.onclick = () => setPreset(+b.dataset.p, cur ? cur.setlist || 0 : +($("mQcSet") ? $("mQcSet").value : 0));
      b.ondragstart = (e) => { e.dataTransfer.setData("text/sl-preset", b.dataset.p + "|" + ($("mQcSet") ? $("mQcSet").value : 0)); e.dataTransfer.effectAllowed = "copy"; }; });
    if ($("mAxeNum")) $("mAxeNum").onchange = () => setPreset(Math.max(0, Math.min(1023, +$("mAxeNum").value || 0)), 0);
    if ($("mAxeQ")) $("mAxeQ").oninput = () => { const q = $("mAxeQ").value.trim().toLowerCase(), all = Object.entries(LIB().axe).filter(([, v]) => v && v.name).map(([k, v]) => [+k, v.name]);
      const hits = all.filter(([n, nm]) => !q || String(n).startsWith(q) || nm.toLowerCase().includes(q)).sort((a, b) => a[0] - b[0]).slice(0, 12);
      $("mAxeRes").innerHTML = hits.map(([n, nm]) => `<button draggable="true" data-p="${n}"><b>${n}</b> ${esc(nm)}</button>`).join("") || (/^\d+$/.test(q) && +q <= 1023 ? `<button data-p="${+q}"><b>${+q}</b> (no name yet)</button>` : `<span class="faint" style="font-size:11px">No saved preset matches</span>`);
      wirePanelResults(); };
    const wirePanelResults = () => document.querySelectorAll(".mres [data-p]").forEach((b) => { b.onclick = () => setPreset(+b.dataset.p, 0); b.ondragstart = (e) => { e.dataTransfer.setData("text/sl-preset", b.dataset.p + "|0"); }; });
    const lib = LIB(), entry = () => (lib[d][pn] || (lib[d][pn] = {}));
    if ($("mPName")) $("mPName").onchange = () => { entry().name = $("mPName").value.trim(); refresh(); };
    document.querySelectorAll(".mscenes [data-sc]").forEach((b) => {
      const k = +b.dataset.sc;
      b.ondragstart = (e) => { e.dataTransfer.setData("text/sl-scene", String(k)); e.dataTransfer.effectAllowed = "copy"; };
      b.onclick = () => { const sc = info(d, pn).scenes[k];
        infoPop(b, `<b>Scene ${sc.label}</b><input id="mScN" value="${esc(sc.name)}" placeholder="Name (Clean, Lead…)" spellcheck="false" style="width:100%;margin:8px 0"><div class="mpal">${SCENE_PAL.map((p) => `<i data-c="${p}" style="background:${p}" class="${p === sc.col ? "on" : ""}"></i>`).join("")}</div>`);
        const pop = document.querySelector(".ipop"), save = (patch) => { const e = entry(); e.scenes = e.scenes || []; e.scenes[k] = { ...(e.scenes[k] || {}), ...patch }; refresh(); };
        const n = pop.querySelector("#mScN"); n.focus(); n.onchange = () => save({ name: n.value.trim() }); n.onkeydown = (ev) => { if (ev.key === "Enter") { save({ name: n.value.trim() }); pop.remove(); } };
        pop.querySelectorAll("[data-c]").forEach((i) => i.onclick = () => { save({ col: i.dataset.c, name: n.value.trim() }); pop.remove(); }); }; });
    document.querySelectorAll("[data-pf]").forEach((i) => i.onchange = () => { const e = entry(); e.fields = e.fields || {}; if (i.value === "") delete e.fields[i.dataset.pf]; else e.fields[i.dataset.pf] = i.value; refresh(); });
    if ($("mFields") && typeof openSettings === "function") $("mFields").onclick = () => openSettings("band");
  }

  // ---------------- labels (MIDI now, the MIDI editor): "17A · Glasshouse Rig", "C · Lead"
  function label(e, s, t) {
    const d = dev(s, t); if (!d || !e.mod) return null;
    if (e.mod === "preset") { const nm = info(d, e.preset).name; return "Preset " + M.presetLabel(d, e.preset) + (nm ? " · " + nm : ""); }
    if (e.mod === "scene") { const pr = presetAt(s, t, evTime(s, e)), sc = info(d, pr ? pr.preset : -1).scenes[e.scene]; return sc ? sc.label + (sc.name ? " · " + sc.name : "") : null; }
    if (e.mod === "fs") return "Footswitch " + "ABCDEFGH"[e.fs];
    if (e.mod === "mode") return ["Preset", "Scene", "Stomp"][e.val] + " mode";
    return null;
  }
  // the presets a song starts with (each modeler track's first preset), for preset fields
  function presetsUsed(s) { const out = []; (s.tracks || []).forEach((t) => { if (!isMidiTrack(s, t) || !dev(s, t)) return; norm(s, t); const p = presetsOf(s, t)[0]; if (p) out.push({ dev: dev(s, t), preset: p.preset }); }); return out; }
  function presetFields(s) { const o = {}; for (const u of presetsUsed(s)) Object.entries(info(u.dev, u.preset).fields).forEach(([k, v]) => { if (o[k] === undefined && v !== "") o[k] = v; }); return o; }
  // Ableton import (8c): a Live MIDI track named like QC / QUAD / AXE / FX3 -> the matching profile
  const suggest = (name) => { const n = String(name || "").toUpperCase(); return /\bQC\b|QUAD|CORTEX/.test(n) ? "qc" : /AXE|FX ?3|FX-?III|FRACTAL/.test(n) ? "axe" : ""; };

  window.MODUI = { dev, badge, status, devLine, draw, wire, panel, wirePanel, label, presetsUsed, presetFields, suggest, norm, sel: () => SEL };
  if (typeof refresh === "function") try { refresh(); } catch (e) {}
})();
