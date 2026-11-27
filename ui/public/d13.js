// set.Line 13 D: no right-side panel (mockups docs/design/phase13/mb2.png, si.png).
// - The right panel and its toggle are gone; the timeline gets the width. What it showed for a track, a clip, a
//   section, a cue, a MIDI clip, several items or a break now opens on request in a floating details card (Track ›
//   Track settings…, Clip gain…, a section's ⋯ › Section settings…, a break's double-click / Setlist › Edit break…).
// - The song's own settings are in the Song info window (Song › Song info…, ⌥⌘I): General (name, colour, tempo at
//   bar 1 and its changes, key, count-in, the fields line), Versions, Fields, Notes. "After this song" is the
//   setlist's (§14), not here.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const songOf = (id) => songs.find((x) => x.id === id);
  const MAC = /Mac/.test(navigator.platform);

  // ================================================================ the right panel goes
  document.body.classList.add("r-closed", "noside13");
  const P0 = window.setPanel;
  window.setPanel = function (side, show, noSave) { if (side === "R") { document.body.classList.add("r-closed"); return; } return P0.apply(this, arguments); };
  window.isOpen = function (side) { return side === "R" ? !!(DC && DC.isConnected) : !document.body.classList.contains("l-closed"); };
  // what used to render into the panel renders into the details card when it's open (and nowhere when it isn't)
  const RI = window.renderInsp;
  let DC = null, DCanchor = null; // the details card
  window.renderInsp = function () { if (DC && DC.isConnected) fillDetails(); else RI(); }; // (hidden, it keeps its controls ready for the card, the keys and ⌘K)
  function ctxNow() { const s = songOf(selId); if (!s) return false; return !!((typeof multiPanel === "function" && multiPanel(s)) || (typeof trackPanel === "function" && trackPanel(s)) || (typeof clipPanel === "function" && clipPanel(s)) || (typeof secPanel === "function" && secPanel(s)) || (typeof pickPanel === "function" && pickPanel(s)) || (window.SLBreaks && SLBreaks.selected && SLBreaks.selected())); }
  function fillDetails() {
    const insp = $("insp"), title = $("inspTitle"); if (!insp || !DC) return;
    try { RI(); } catch (e) { console.error(e); } // the panel's own render and wiring (into the hidden panel)
    const t = (title.textContent || "").replace(/^‹\s*/, "").trim(), body = DC.querySelector(".dc13b");
    if (t === "Song" && !ctxNow()) { closeDetails(); return; }
    DC.querySelector(".dc13t").textContent = t === "" ? "Details" : (title.querySelector(".iback") ? "Details" : t);
    body.replaceChildren(...insp.childNodes); // the wired controls move into the card
    { const k = body.querySelector(".kicker"); if (k && k.textContent.trim()) { const tx = k.textContent.trim().toLowerCase(); DC.querySelector(".dc13t").textContent = tx.charAt(0).toUpperCase() + tx.slice(1); } } // "Section 1 of 7", "Audio clip 2 of 3"
    // 13 §17: a song has no cue voice of its own any more (Cues menu, every song)
    body.querySelectorAll("#cvSame").forEach((x) => { const row = x.closest(".kv, .rrow, .racts") || x; row.remove(); });
  }
  function openDetails(anchor) {
    if (!DC || !DC.isConnected) {
      DC = document.createElement("div"); DC.className = "dc13"; DC.setAttribute("role", "dialog");
      DC.innerHTML = '<div class="dc13h"><b class="dc13t">Details</b><button class="ibtn dc13x" title="Close  Esc" aria-label="Close">✕</button></div><div class="dc13b"></div>';
      document.body.appendChild(DC); DC.querySelector(".dc13x").onclick = closeDetails;
      DC.addEventListener("keydown", (e) => { if (e.key === "Escape" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.stopPropagation(); closeDetails(); } });
      // drag it by its header
      DC.querySelector(".dc13h").onpointerdown = (e) => { if (e.target.closest("button")) return; const r = DC.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; const mv = (m) => { DC.style.left = Math.max(0, Math.min(innerWidth - 80, m.clientX - dx)) + "px"; DC.style.top = Math.max(0, Math.min(innerHeight - 40, m.clientY - dy)) + "px"; }; const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); }; addEventListener("pointermove", mv); addEventListener("pointerup", up); };
    }
    DCanchor = anchor || null; fillDetails(); if (!DC || !DC.isConnected) return false;
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor || { right: innerWidth - 340, top: 120, bottom: 120 };
    DC.style.left = Math.max(8, Math.min(innerWidth - DC.offsetWidth - 8, (r.right || r.left || 0) + 8)) + "px"; DC.style.top = Math.max(60, Math.min(innerHeight - DC.offsetHeight - 8, (r.top || 120) - 10)) + "px";
    return true;
  }
  function closeDetails() { if (DC) DC.remove(); DC = null; }
  document.addEventListener("pointerdown", (e) => { if (DC && !DC.contains(e.target) && !e.target.closest(".xm, .pop, .pop13, .cfbg, .ipop, #tpop, #mpop")) closeDetails(); }, true);

  // ================================================================ the Song info window (⌥⌘I)
  let SI = null, SITAB = "general";
  const KEYS = ["—", ...["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].flatMap((k) => [k, k + " min"])];
  const fieldsLine = (s) => { const v = typeof curVer === "function" ? curVer(s) : null, out = []; (typeof FIELDS !== "undefined" ? FIELDS : []).forEach((f) => { const own = (v && v.fields && v.fields[f.id]) ?? (s.fields || {})[f.id]; const ih = own === undefined || own === "" ? (typeof fieldInh === "function" ? fieldInh(s, f) : null) : null; const val = own !== undefined && own !== "" ? own : ih ? ih.value : ""; if (val !== "" && val !== undefined) out.push(val); }); return out.join(" · "); };
  function songInfo(id, tab) {
    const s = songOf(id || selId); if (!s) { toast("Select a song first"); return; }
    if (tab) SITAB = tab; closeSongInfo();
    SI = document.createElement("div"); SI.className = "cfbg si13bg"; SI.innerHTML = '<div class="cfbox si13" role="dialog" aria-label="Song info"></div>'; document.body.appendChild(SI);
    SI.onclick = (e) => { if (e.target === SI) closeSongInfo(); };
    SI.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeSongInfo(); } }, true);
    SI.dataset.song = s.id; drawSongInfo();
  }
  function closeSongInfo() { if (SI) SI.remove(); SI = null; }
  function drawSongInfo() {
    if (!SI) return; const s = songOf(SI.dataset.song); if (!s) { closeSongInfo(); return; }
    const box = SI.querySelector(".si13"), V = curVer(s), vs = versOf(s), ch = s.tmap.filter((e) => e.bpm).length - 1;
    const tabs = [["general", "General"], ["versions", "Versions"], ["fields", "Fields"], ["notes", "Notes"]];
    let body = "";
    if (SITAB === "general") body = `<div class="si13g">
      <label>Name<input id="si13name" value="${esc(s.name)}" spellcheck="false"></label>
      <div class="si13c"><span>Colour</span><div class="si13sw" id="si13col"></div></div>
      <label>Tempo at bar 1<span class="si13t"><input id="si13bpm" type="number" min="20" max="300" step="0.1" value="${+(+s.tmap[0].bpm).toFixed(2)}"> BPM${ch > 0 ? ` <em>· ${ch} change${ch > 1 ? "s" : ""}</em>` : ""}</span></label>
      <label>Key<select id="si13key">${[...new Set([...KEYS, s.key || "—"])].map((k) => `<option ${k === (s.key || "—") ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
      <div class="si13ci"><span>Count-in</span><div class="segm" id="si13ci">${[[0, "Off"], [1, "1 bar"], [2, "2 bars"]].map(([v, l]) => `<button data-v="${v}" class="${(s.countIn || 0) === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      <label class="si13wide">Fields (shown on the remote screens)<input id="si13fl" value="${esc(fieldsLine(s))}" readonly title="Edit them in the Fields tab"></label></div>`;
    else if (SITAB === "versions") body = `<div class="si13v">${vs.map((v) => `<div class="si13vr ${v.id === V.id ? "cur" : ""}" data-v="${v.id}"><input class="si13vn" value="${esc(v.name)}" spellcheck="false"><label class="si13vd"><input type="radio" name="si13def" ${v.def ? "checked" : ""}> Default in new sets</label><span class="si13vl">${fmt(verLen(s, v))}</span><button class="btn line si13vs">${v.id === V.id ? "Shown" : "Show"}</button><button class="ibtn si13vx" title="Delete this version" ${vs.length < 2 ? "disabled" : ""}>⌫</button></div>`).join("")}</div>
      <div class="racts"><button class="btn line" id="si13nv">New version</button><span class="faint">Sections in a version: tick, untick and reorder them in the timeline's version strip.</span></div>`;
    else if (SITAB === "fields") body = `<div class="si13f">${typeof fieldsCard === "function" ? fieldsCard(s, V) : ""}</div>`;
    else body = `<label class="si13wide">Notes for the band <small>(on the remote screens' Section notes widget when a section has none)</small><textarea id="si13note" rows="7" spellcheck="true" placeholder="Capo 2 · watch the ending · Brett starts alone">${esc(s.bandNote || "")}</textarea></label>`;
    box.innerHTML = `<div class="si13h"><i style="background:${s.col}"></i><b>${esc(s.name)}</b><span>Song info${vs.length > 1 ? " · " + esc(V.name) : ""}</span><button class="btn pri" id="si13done">Done</button></div>
      <div class="si13tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${SITAB === k ? "on" : ""}">${l}</button>`).join("")}</div><div class="si13body">${body}</div>`;
    box.querySelector("#si13done").onclick = closeSongInfo;
    box.querySelectorAll(".si13tabs button").forEach((b) => b.onclick = () => { SITAB = b.dataset.t; drawSongInfo(); });
    const ch1 = (what, f) => { snap(); f(); refresh(); toast(`${what} · ${s.name}`, undo); drawSongInfo(); };
    if (SITAB === "general") {
      const n = box.querySelector("#si13name"); n.onchange = () => { const v = n.value.trim(); if (v && v !== s.name) ch1("Renamed", () => { s.name = v.slice(0, 80); }); }; n.onkeydown = (e) => { if (e.key === "Enter") n.blur(); };
      if (window.SL13 && SL13.colorPicker) SL13.colorPicker(box.querySelector("#si13col"), s.col, (c) => ch1("Colour", () => { s.col = c; }));
      const b = box.querySelector("#si13bpm"); b.onchange = () => { const v = parseFloat(b.value); if (v >= 20 && v <= 300 && v !== s.tmap[0].bpm) ch1("Tempo at bar 1", () => { s.tmap[0].bpm = v; buildBars(s); }); };
      box.querySelector("#si13key").onchange = (e) => ch1("Key", () => { s.key = e.target.value; });
      box.querySelectorAll("#si13ci button").forEach((x) => x.onclick = () => setCountIn(s, +x.dataset.v));
      box.querySelector("#si13fl").onclick = () => { SITAB = "fields"; drawSongInfo(); };
    } else if (SITAB === "versions") {
      box.querySelectorAll(".si13vr").forEach((r) => { const vid = r.dataset.v, v = vs.find((x) => x.id === vid);
        r.querySelector(".si13vn").onchange = (e) => { const nn = e.target.value.trim(); if (nn && nn !== v.name) ch1("Renamed a version", () => { v.name = nn; }); };
        r.querySelector(".si13vd input").onchange = () => ch1("Default version", () => vs.forEach((x) => { x.def = x === v; }));
        r.querySelector(".si13vs").onclick = () => { snap(); showVer(s, vid); refresh(); drawSongInfo(); };
        r.querySelector(".si13vx").onclick = () => { if (window.SL11 && SL11.delVersion) SL11.delVersion(s, vid); else { snap(); delVer(s, vid); refresh(); } setTimeout(drawSongInfo, 50); }; });
      box.querySelector("#si13nv").onclick = () => { snap(); const v = newVer(s); refresh(); toast(`Added the version “${v.name}”`, undo); drawSongInfo(); };
    } else if (SITAB === "fields") { if (typeof wireFieldsCard === "function") wireFieldsCard(s, V); }
    else { const t = box.querySelector("#si13note"); t.onchange = () => ch1("Notes for the band", () => { s.bandNote = t.value.trim().slice(0, 2000); if (!s.bandNote) delete s.bandNote; }); }
  }
  // count-in (Song info, and the Cues menu for every song): spoken counts in the bars before the first section, kept with
  // the song (s.countIn = bars); they're ordinary cues, marked so a later change replaces them
  function setCountIn(s, bars, quiet) {
    const first = (s.secs || []).map((x) => x.start).sort((a, b) => a - b)[0] || 1, room = first - 1;
    if (!quiet) snap();
    s.cues = (s.cues || []).filter((c) => !c.auto13);
    s.countIn = bars || 0; if (!s.countIn) delete s.countIn;
    let made = 0;
    if (bars > 0 && room > 0) { const sig = s.bars[Math.max(0, first - 2)].sig[0], n = Math.min(room, bars) * sig, cs = addCountIn(s, { into: first, n, spacing: "beat" }); cs.forEach((c) => { c.auto13 = true; }); made = cs.length; }
    refresh(); if (SI) drawSongInfo();
    if (!quiet) toast(bars && !made ? `Count-in ${bars} bar${bars > 1 ? "s" : ""} kept with “${s.name}”: no bars before its first section yet` : `Count-in ${bars ? bars + " bar" + (bars > 1 ? "s" : "") : "off"} · ${s.name}`, undo);
    return made;
  }
  // ⌥⌘I
  document.addEventListener("keydown", (e) => { const cmd = MAC ? e.metaKey : e.ctrlKey; if (cmd && e.altKey && !e.shiftKey && (e.code === "KeyI" || e.key.toLowerCase() === "i")) { const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName))) return; e.preventDefault(); e.stopImmediatePropagation(); songInfo(); } }, true);

  // ================================================================ breaks: a popover from their setlist row
  function editBreak(id, anchor) { if (window.SL14B) return SL14B.edit(id); /* 14 §1: the break popup */ if (!window.SLBreaks) return; SLBreaks.select(id); openDetails(anchor || document.querySelector(`#songs .brk9[data-b="${id}"]`)); }
  document.addEventListener("dblclick", (e) => { const b = e.target.closest && e.target.closest("#songs .brk9[data-b]"); if (!b || e.target.closest("input, [contenteditable]")) return; e.preventDefault(); e.stopPropagation(); editBreak(b.dataset.b, b); }, true);

  // ================================================================ the Track menu's parts (menus9.js asks for them)
  // the audio clips the Clip items act on: the selected clip, or every selected audio clip
  function clipsSel() { const out = []; if (typeof selItems === "function") selItems().filter((x) => x.kind === "audio").forEach((x) => out.push({ s: x.s, t: x.t, cl: x.o }));
    if (!out.length && typeof selClip !== "undefined" && selClip) { const s = songOf(selClip.song), cl = s && clipsOf(s, selClip.track).find((c) => c.id === selClip.id); if (cl) out.push({ s, t: selClip.track, cl }); } return out; }
  const SL13M = {
    track(T) {
      if (!T || !T.s) return null; const s = T.s, t = T.t, midi = isMidiTrack(s, t), c = midi ? (s.midiCfg || {})[t] || {} : null;
      const btn = (cls) => document.querySelector(`.${cls}[data-song="${s.id}"][data-track="${CSS.escape(t)}"]`);
      const o = { midi, muted: !!(s.mute || {})[t], soloed: !!(s.solo || {})[t], canSolo: !midi,
        mute: () => { const b = btn("mb"); if (b) b.click(); }, solo: () => { const b = btn("sb"); if (b) b.click(); }, outputs: [], ports: [], channels: [], device: midi && window.MODUI ? MODUI.dev(s, t) : "" };
      if (!midi && typeof outsOf === "function" && typeof outCount === "function") { const cur = JSON.stringify(outsOf(s, t)), n = outCount(), set = (x) => () => { snap(); (s.outs || (s.outs = {}))[t] = x; refresh(); toast(`“${t}” plays on ${x.length ? (x.length > 1 ? pairName(x[0]) : outName(x[0])) : "no output"}`, undo); };
        for (let a = 1; a < n; a += 2) o.outputs.push({ label: pairName(a), on: JSON.stringify([a, a + 1]) === cur, act: set([a, a + 1]) });
        for (let a = 1; a <= n; a++) o.outputs.push({ label: outName(a) + " (mono)", on: JSON.stringify([a]) === cur, act: set([a]) });
        o.outputs.push({ label: "Off", on: cur === "[]", act: set([]) }); }
      if (midi) { const set = (f) => () => { snap(); f(); refresh(); };
        o.ports = [...new Set([...(typeof PORTS !== "undefined" ? PORTS : []), c.port].filter(Boolean))].map((p) => ({ label: p, on: p === c.port, act: set(() => { c.port = p; }) }));
        o.channels = Array.from({ length: 16 }, (_, i) => ({ label: "Channel " + (i + 1), on: +c.ch === i + 1, act: set(() => { c.ch = i + 1; }) }));
        o.setDevice = (k) => { snap(); if (k) c.dev = k; else delete c.dev; if (window.MODUI) MODUI.norm(s, t); refresh(); toast(`“${t}” is ${k === "qc" ? "a Quad Cortex" : k === "axe" ? "an Axe-Fx III" : "a generic MIDI device"}`, undo); }; }
      return o;
    },
    clip: () => (clipsSel().length ? clipsSel() : null),
    // Clip gain…: one value for the selected clip(s), with a slider (one undo step)
    clipGain(anchor) {
      const L = clipsSel(); if (!L.length) { toast("Select a clip first (click it)"); return; } const g0 = +L[0].cl.gain || 0;
      const r = anchor || { left: innerWidth / 2 - 130, right: innerWidth / 2 - 130, top: 160 };
      popAt(r, `<div class="cg13"><b>Clip gain${L.length > 1 ? ` · ${L.length} clips` : ` · ${esc(L[0].t)}`}</b><input type="range" min="-48" max="6" step="0.5" value="${g0}" class="cg13r"><span><input type="number" min="-48" max="6" step="0.1" value="${g0}" class="cg13n"> dB</span><button class="btn pri cg13ok">Set</button></div>`, (p) => {
        const rr = p.querySelector(".cg13r"), nn = p.querySelector(".cg13n"); rr.oninput = () => { nn.value = rr.value; }; nn.oninput = () => { rr.value = nn.value; };
        const ok = () => { const v = Math.max(-48, Math.min(6, +nn.value || 0)); closePops(); snap(); L.forEach((x) => { x.cl.gain = Math.round(v * 10) / 10; }); refresh(); if (window.SLE && SLE.nextChanged) SLE.nextChanged(); toast(`Clip gain ${v > 0 ? "+" : ""}${v.toFixed(1)} dB${L.length > 1 ? ` on ${L.length} clips` : ""}`, undo); };
        p.querySelector(".cg13ok").onclick = ok; nn.onkeydown = (e) => { if (e.key === "Enter") ok(); }; nn.focus(); nn.select(); });
    },
    fadeItems() {
      const L = clipsSel(); if (!L.length) return []; const c = L[0].cl, ms = [0, 10, 50, 200, 1000], name = (m) => (m ? (m >= 1000 ? m / 1000 + " s" : m + " ms") : "none");
      const set = (k, m) => () => { snap(); L.forEach((x) => { x.cl[k] = Math.min(m / 1000, (x.cl.end - x.cl.start) / 2); }); refresh(); toast(`Fade ${k === "fi" ? "in" : "out"} ${name(m)}${L.length > 1 ? ` on ${L.length} clips` : ""}`, undo); };
      return [...ms.map((m) => ({ label: "Fade in: " + name(m), on: Math.abs((c.fi || 0) * 1000 - m) < 1, act: set("fi", m) })), ...ms.map((m) => ({ label: "Fade out: " + name(m), on: Math.abs((c.fo || 0) * 1000 - m) < 1, act: set("fo", m) }))];
    },
  };
  window.SL13M = SL13M;

  window.SL13D = { openDetails, closeDetails, details: () => DC, songInfo, closeSongInfo, songInfoOpen: () => !!SI, setCountIn, editBreak, fieldsLine };
})();
