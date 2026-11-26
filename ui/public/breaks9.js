// set.Line 9d: Breaks in the setlist: time between songs for a gear change, tuning, talking or an intermission.
// A setlist keeps its breaks beside its songs (L.breaks: each after a song, or at the start), so the song order
// stays a list of songs everywhere else. A break: {id, after, label, len (s), note, runout: wait|start,
// during: silence|loop, loop: {song, sec, db}, send}. Playing: when a song ends (or Next), its break becomes
// current: a countdown in the transport, Perform and the band screens; Play starts the next song.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const LABELS = ["Gear change", "Tuning", "Talk", "Intermission"];
  const DEFLEN = { "Gear change": 45, Tuning: 45, Talk: 90, Intermission: 600 };
  const native = () => typeof NATIVE !== "undefined" && NATIVE && typeof ncall === "function";
  const mmss = (t) => { const neg = t < 0; t = Math.abs(Math.round(t)); return `${neg ? "+" : ""}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const L = () => curSetObj();
  const list = (l) => { l = l || L(); return l.breaks || (l.breaks = []); };
  let seq = Date.now() % 100000;
  const newId = () => "b" + Date.now().toString(36) + (seq++).toString(36);
  let SELB = null; // the break selected in the setlist (its inspector shows)
  let BRK = null;  // the break playing: {b, before, t0, paused, acc, loop}

  // ---------------------------------------------------------------- the model
  // the breaks after song id (in order); '' = before the first song
  const afterOf = (id, l) => list(l).filter((b) => (b.after || "") === (id || ""));
  // the setlist as items: [{kind:'song', id} | {kind:'break', b}] (breaks whose song left the setlist go to the end)
  function items(l) {
    l = l || L(); const ord = l.id === curSet ? setOrder : l.order || [], out = [];
    afterOf("", l).forEach((b) => out.push({ kind: "break", b }));
    ord.forEach((id) => { out.push({ kind: "song", id }); afterOf(id, l).forEach((b) => out.push({ kind: "break", b })); });
    list(l).filter((b) => b.after && !ord.includes(b.after)).forEach((b) => out.push({ kind: "break", b }));
    return out;
  }
  const totalLen = (l) => list(l).reduce((a, b) => a + (+b.len || 0), 0);
  function make(label, at) {
    const lab = label || "Gear change";
    return { id: newId(), after: at === undefined ? "" : at, label: lab, len: DEFLEN[lab] || 60, note: "", runout: "wait", during: "silence", send: false };
  }
  // a new break goes after the selected setlist item, or at the end
  function add(label, custom) {
    if (typeof playing !== "undefined" && playing && !BRK) { /* adding while playing is fine: it only changes the setlist */ }
    snap(); syncSet();
    let after = setOrder.length ? setOrder[setOrder.length - 1] : "";
    if (SELB) { const s = list().find((b) => b.id === SELB); if (s) after = s.after; }
    else if (selId && setOrder.includes(selId)) after = selId;
    const b = make(label, after); if (custom) { b.label = String(custom).slice(0, 24); b.len = 60; }
    // after the selected break: right after it in the list
    const arr = list(), i = SELB ? arr.findIndex((x) => x.id === SELB) : -1;
    if (i >= 0) arr.splice(i + 1, 0, b); else arr.push(b);
    SELB = b.id; refresh(); return b;
  }
  function addMenu(at) {
    ctxMenu(at, [{ cap: "Add a break" }, ...LABELS.map((l) => ({ label: `${l}  ${mmss(DEFLEN[l])}`, icon: "timer", act: () => add(l) })), "-",
      { label: "Custom…", icon: "edit", act: () => { floatInput(at.clientX, at.clientY, 200, 26, "", (v) => { if (v && v.trim()) add(null, v.trim()); }); } }]);
  }
  function del(id) { const arr = list(), i = arr.findIndex((b) => b.id === id); if (i < 0) return; snap(); const b = arr.splice(i, 1)[0]; if (SELB === id) SELB = null; refresh(); toast(`Deleted the break “${b.label}”`, undo); }
  function dup(id) { const arr = list(), i = arr.findIndex((b) => b.id === id); if (i < 0) return; snap(); const c = { ...JSON.parse(JSON.stringify(arr[i])), id: newId() }; arr.splice(i + 1, 0, c); SELB = c.id; refresh(); }
  // move a break to just before items index k of items()
  function moveTo(id, songAfter, beforeBreakId) {
    const arr = list(), i = arr.findIndex((b) => b.id === id); if (i < 0) return;
    snap(); const b = arr.splice(i, 1)[0]; b.after = songAfter || "";
    const j = beforeBreakId ? arr.findIndex((x) => x.id === beforeBreakId) : -1;
    if (j >= 0) arr.splice(j, 0, b); else arr.push(b);
    refresh();
  }

  // Ableton (9a): the setlist's pending breaks become Break items
  function adoptPending() {
    let n = 0;
    (typeof setlists !== "undefined" ? setlists : []).forEach((l) => {
      if (!l.pendingBreaks || !l.pendingBreaks.length) return;
      l.pendingBreaks.forEach((p) => { const lab = LABELS.includes(p.label) ? p.label : "Gear change"; const b = make(lab, p.after || ""); if (p.name && p.name.toUpperCase() !== lab.toUpperCase()) b.note = p.name; list(l).push(b); n++; });
      delete l.pendingBreaks;
    });
    if (n) { try { refresh(); } catch (e) {} }
    return n;
  }

  // ---------------------------------------------------------------- the setlist sidebar: hatched break rows
  const RS = window.renderSetlist;
  window.renderSetlist = function () {
    RS.apply(this, arguments);
    adoptPending();
    const el = $("songs"); if (!el) return;
    const rows = [...el.querySelectorAll(".song")];
    const row = (b) => `<div class="brk9 ${SELB === b.id ? "on" : ""} ${BRK && BRK.b.id === b.id ? "now" : ""}" draggable="true" data-b="${b.id}" title="${esc(b.note || b.label)}"><span class="bico" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M6.5 5.5v5M9.5 5.5v5"/></svg></span><span class="bt">${esc(b.label)}</span><span class="bl">${BRK && BRK.b.id === b.id ? mmss(left()) : mmss(+b.len || 0)}</span></div>`;
    // before the first song, after each song (and its "after" line), orphans at the end
    afterOf("").slice().reverse().forEach((b) => el.insertAdjacentHTML("afterbegin", row(b)));
    rows.forEach((r) => { const bs = afterOf(r.dataset.id); if (!bs.length) return; let at = r; const tr = r.nextElementSibling; if (tr && tr.classList.contains("tr")) at = tr; bs.slice().reverse().forEach((b) => at.insertAdjacentHTML("afterend", row(b))); });
    list().filter((b) => b.after && !setOrder.includes(b.after)).forEach((b) => el.insertAdjacentHTML("beforeend", row(b)));
    el.querySelectorAll(".brk9").forEach((r) => {
      const id = r.dataset.b;
      r.onclick = (e) => { e.stopPropagation(); SELB = id; renderSetlist(); renderInsp(); if (typeof NARROW === "function" && NARROW() && !isOpen("R")) setPanel("R", true, true); };
      r.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); SELB = id; renderSetlist(); renderInsp(); ctxMenu(e, [{ label: "Duplicate break", icon: "dup", act: () => dup(id) }, { label: "Skip it now", icon: "open", dis: !(BRK && BRK.b.id === id), act: () => skip() }, "-", { label: "Delete break", icon: "del", danger: true, act: () => del(id) }]); };
      r.ondragstart = (e) => { dragB = id; try { e.dataTransfer.setData("text/plain", id); } catch (x) {} r.classList.add("dragging"); };
      r.ondragend = () => { dragB = null; r.classList.remove("dragging"); };
    });
    // drop a break: after the song row it's dropped on (or before the break it's dropped on)
    el.querySelectorAll(".song,.brk9").forEach((t) => {
      t.addEventListener("dragover", (e) => { if (dragB) { e.preventDefault(); t.classList.add("over"); } });
      t.addEventListener("dragleave", () => t.classList.remove("over"));
      t.addEventListener("drop", (e) => { if (!dragB) return; e.preventDefault(); e.stopPropagation(); t.classList.remove("over"); const id = dragB; dragB = null;
        if (t.classList.contains("brk9")) { const tb = list().find((x) => x.id === t.dataset.b); if (tb && tb.id !== id) moveTo(id, tb.after, tb.id); }
        else moveTo(id, t.dataset.id, null); }, true);
    });
    // the footer: "11 songs · 2 breaks · 52:40"
    const n = setOrder.length, nb = list().length, len = setOrder.reduce((a, id) => { const s = songs.find((x) => x.id === id); return a + (s ? verLen(s, entryVer(s)) : 0); }, 0) + totalLen();
    if ($("setCount")) $("setCount").textContent = `${n} song${n === 1 ? "" : "s"}${nb ? ` · ${nb} break${nb === 1 ? "" : "s"}` : ""}`;
    if ($("setLen")) $("setLen").textContent = fmt(len);
  };
  let dragB = null;
  // selecting a song (anywhere) unselects the break
  const SEL0 = window.select; window.select = function (id) { if (SELB && id) { SELB = null; } return SEL0.apply(this, arguments); };
  // a song selected in the setlist: the break selection goes
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#songs .song")) { if (SELB) { SELB = null; renderSetlist(); } } }, true);

  // ---------------------------------------------------------------- the inspector (right panel) for a break
  const RI = window.renderInsp0;
  window.renderInsp0 = function () {
    const b = SELB && list().find((x) => x.id === SELB);
    if (!b) return RI.apply(this, arguments);
    $("inspTitle").textContent = "Break";
    const lab = LABELS.includes(b.label) ? b.label : "custom", songsIn = songs.filter((s) => s.secs && s.secs.length);
    const loop = b.loop || {}, ls = songs.find((s) => s.id === loop.song);
    $("insp").innerHTML = `<div class="bi9">
      <label class="bl9">Label</label><div class="bseg9" id="bLab">${LABELS.map((l) => `<button data-v="${l}" class="${b.label === l ? "on" : ""}">${l}</button>`).join("")}<button data-v="custom" class="${lab === "custom" ? "on" : ""}">Custom…</button></div>
      ${lab === "custom" ? `<input id="bCustom" maxlength="24" value="${esc(b.label)}" placeholder="Your label" spellcheck="false">` : ""}
      <label class="bl9">Length</label><input id="bLen" class="mono blen9" value="${mmss(+b.len || 0)}" placeholder="0:45" spellcheck="false">
      <label class="bl9">Note for the band</label><textarea id="bNote" rows="2" maxlength="200" placeholder="Brett: swap to the baritone · Nick: capo off">${esc(b.note || "")}</textarea>
      <label class="bl9">When the time runs out</label><div class="bseg9 two" id="bRun"><button data-v="wait" class="${b.runout !== "start" ? "on" : ""}">Wait for Play</button><button data-v="start" class="${b.runout === "start" ? "on" : ""}">Start next song</button></div>
      <label class="bl9">During the break</label><div class="bseg9 two" id="bDur"><button data-v="silence" class="${b.during !== "loop" ? "on" : ""}">Silence</button><button data-v="loop" class="${b.during === "loop" ? "on" : ""}">Play a loop / pad…</button></div>
      ${b.during === "loop" ? `<div class="bloop9"><select id="bLoopSong"><option value="">Choose a song…</option>${songsIn.map((s) => `<option value="${s.id}" ${s.id === loop.song ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        ${ls ? `<select id="bLoopSec">${ls.secs.map((x) => `<option value="${x.id}" ${x.id === loop.sec ? "selected" : ""}>${esc(x.name)} (bars ${x.start}–${x.start + x.bars - 1})</option>`).join("")}</select>` : ""}
        <label class="bl9 sm">Level <span id="bLvlV">${(+loop.db || 0).toFixed(0)} dB</span></label><input type="range" id="bLvl" min="-30" max="0" step="1" value="${+loop.db || 0}">
        <p class="rnote">That section loops on the show outputs during the break and fades out over 2 s before the next song.</p></div>` : ""}
      <label class="bl9">Send at the start</label><label class="bchk9"><input type="checkbox" id="bSend" ${b.send ? "checked" : ""}> Send the next song’s presets at the start of the break</label>
      <div class="racts"><button class="btn line" id="bDup">Duplicate</button><button class="btn line danger" id="bDel">Delete</button></div></div>`;
    const save = (patch) => { snap(); Object.assign(b, patch); renderSetlist(); renderInsp(); };
    $("bLab").querySelectorAll("button").forEach((x) => x.onclick = () => { if (x.dataset.v === "custom") save({ label: LABELS.includes(b.label) ? "Custom" : b.label }); else save({ label: x.dataset.v, len: b.label === x.dataset.v ? b.len : DEFLEN[x.dataset.v] }); });
    if ($("bCustom")) $("bCustom").onchange = (e) => { const v = e.target.value.trim().slice(0, 24); if (v) save({ label: v }); };
    $("bLen").onchange = (e) => { const m = String(e.target.value).trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/); if (!m) { e.target.classList.add("bad"); return; } const v = m[2] !== undefined ? +m[1] * 60 + +m[2] : +m[1]; save({ len: Math.max(5, Math.min(7200, v)) }); };
    $("bNote").onchange = (e) => save({ note: e.target.value.slice(0, 200) });
    $("bRun").querySelectorAll("button").forEach((x) => x.onclick = () => save({ runout: x.dataset.v }));
    $("bDur").querySelectorAll("button").forEach((x) => x.onclick = () => save({ during: x.dataset.v }));
    if ($("bLoopSong")) $("bLoopSong").onchange = (e) => { const s = songs.find((x) => x.id === e.target.value); save({ loop: { song: e.target.value, sec: s && s.secs[0] ? s.secs[0].id : null, db: +loop.db || 0 } }); };
    if ($("bLoopSec")) $("bLoopSec").onchange = (e) => save({ loop: { ...loop, sec: +e.target.value } });
    if ($("bLvl")) { $("bLvl").oninput = (e) => { $("bLvlV").textContent = e.target.value + " dB"; }; $("bLvl").onchange = (e) => save({ loop: { ...loop, db: +e.target.value } }); }
    $("bSend").onchange = (e) => save({ send: e.target.checked });
    $("bDup").onclick = () => dup(b.id); $("bDel").onclick = () => del(b.id);
  };

  // ---------------------------------------------------------------- playing through a break
  const elapsed = () => BRK ? (BRK.paused ? BRK.acc : BRK.acc + (performance.now() - BRK.t0) / 1000) : 0;
  const left = () => BRK ? (+BRK.b.len || 0) - elapsed() : 0;
  // the song after a break (or after the song a break follows)
  function nextSongAfter(b) { const it = items(), i = it.findIndex((x) => x.kind === "break" && x.b.id === b.id); for (let k = i + 1; k < it.length; k++) if (it[k].kind === "song") return songs.find((s) => s.id === it[k].id) || null; return null; }
  function songBefore(b) { const it = items(), i = it.findIndex((x) => x.kind === "break" && x.b.id === b.id); for (let k = i - 1; k >= 0; k--) if (it[k].kind === "song") return songs.find((s) => s.id === it[k].id) || null; return null; }
  function nextBreakAfter(b) { const it = items(), i = it.findIndex((x) => x.kind === "break" && x.b.id === b.id); return it[i + 1] && it[i + 1].kind === "break" ? it[i + 1].b : null; }
  function start(b) {
    if (BRK) stopLoop(false);
    BRK = { b, before: (songBefore(b) || {}).id || "", t0: performance.now(), paused: false, acc: 0, over: false };
    if (b.during === "loop") startLoop(b); else if (native()) ncall("clockHold", { on: true });
    if (b.send) sendPresets(nextSongAfter(b));
    tick(); return true;
  }
  // a song ended (the module calls this): its break becomes current
  function songEnded(songId) { if (BRK) return false; const b = afterOf(songId)[0]; if (!b || !setOrder.includes(songId)) return false; start(b); return true; }
  // leave the break: play (or just ready) the song after it
  function finish(play) {
    if (!BRK) return; const b = BRK.b, n = nextSongAfter(b), wasLoop = BRK.loop;
    const go = () => {
      BRK = null; if (native()) ncall("clockHold", { on: false });
      if (n) { if (typeof SLPage !== "undefined" && SLPage.readySong) SLPage.readySong(n.id); select(n.id, false); if (play && !playing) toggle0(); }
      refresh(); if (typeof lcd === "function") lcd(); if (typeof perfOn !== "undefined" && perfOn) renderPerform(true);
    };
    if (wasLoop) stopLoop(true).then(go); else go();
  }
  function skip() { if (!BRK) return; const nb = nextBreakAfter(BRK.b); if (nb) { start(nb); refresh(); return; } finish(false); }
  function back() { if (!BRK) return; const s = songs.find((x) => x.id === BRK.before); if (BRK.loop) stopLoop(false); BRK = null; if (native()) ncall("clockHold", { on: false }); if (s) { SLPage.readySong(s.id); select(s.id, false); } refresh(); lcd(); }
  function pause() { if (!BRK) return; if (BRK.paused) { BRK.t0 = performance.now(); BRK.paused = false; } else { BRK.acc = elapsed(); BRK.paused = true; } tick(); }
  // the next song's presets (8c), sent at the start of the break: each MIDI track's first program change
  function sendPresets(s) {
    if (!s || !native()) return;
    s.tracks.filter((t) => isMidiTrack(s, t)).forEach((t) => { const cfg = s.midiCfg[t] || {}; if (!cfg.port) return; const e = (s.midi[t] || []).filter((x) => x.kind === "pc").sort((a, c) => evTime(s, a) - evTime(s, c))[0]; if (!e) return;
      const c = Math.max(0, (+cfg.ch || 1) - 1), msgs = []; if (e.msb !== undefined) msgs.push([0xb0 | c, 0, e.msb]); if (e.lsb !== undefined) msgs.push([0xb0 | c, 32, e.lsb]); msgs.push([0xc0 | c, e.pc & 127]); ncall("sendMidiNow", { port: cfg.port, msgs }); });
  }
  // a loop / pad: that section of that song, looping, at its own level; 2 s fade out before the next song
  function startLoop(b) {
    const lp = b.loop || {}, s = songs.find((x) => x.id === lp.song); if (!s) { if (native()) ncall("clockHold", { on: true }); return; }
    const sec = (s.secs || []).find((x) => x.id === lp.sec) || s.secs[0]; if (!sec) return;
    BRK.loop = { song: s.id, db: +lp.db || 0 };
    selSec = { song: s.id, id: sec.id }; loopOn = true; if ($("loopBtn")) $("loopBtn").classList.add("on");
    playId = s.id; pos = s.bars[sec.start - 1].t; select(s.id, false);
    if (!playing) toggle0();
    if (native() && window.SLE) setTimeout(() => level(s, +lp.db || 0), 200);
  }
  function level(s, db) { if (!native()) return; ncall("setTrackLevel", { tracks: s.tracks.map((t) => ({ track: t, db: gainOf(s, t) + db, mute: !!(s.mute || {})[t], solo: !!(s.solo || {})[t] })) }); }
  function stopLoop(fade) {
    const lp = BRK && BRK.loop; if (!lp) return Promise.resolve(); const s = songs.find((x) => x.id === lp.song);
    const end = () => { loopOn = false; if ($("loopBtn")) $("loopBtn").classList.remove("on"); selSec = null; if (playing) toggle0(); if (s) level(s, 0); };
    if (!fade || !s || !native()) { end(); return Promise.resolve(); }
    return new Promise((res) => { let k = 0; const iv = setInterval(() => { k++; level(s, lp.db - k * 3); if (k >= 20) { clearInterval(iv); end(); setTimeout(res, 60); } }, 100); });
  }
  // every 250 ms while a break is current: the countdown, its end, the views
  function tick() {
    if (!BRK) return;
    const l = left();
    if (l <= 0 && !BRK.paused && BRK.b.runout === "start") { finish(true); return; }
    BRK.over = l < 0;
    paint();
  }
  setInterval(tick, 250);
  // the transport during a break: its label and the time left (the ring counts down); Perform: the big countdown
  function paint() {
    if (!BRK) return; const b = BRK.b, l = left(), n = nextSongAfter(b);
    const bar = $("lcdBar"); if (bar) { const h = `<b>${mmss(l)}</b>`; if (bar.innerHTML !== h) bar.innerHTML = h; }
    if ($("lcdSong")) $("lcdSong").textContent = b.label; if ($("lcdSec")) { $("lcdSec").textContent = BRK.paused ? "paused" : l < 0 ? "over" : "break"; $("lcdSec").style.color = l < 0 ? "#ff453a" : ""; }
    if ($("lcdLeft")) $("lcdLeft").textContent = n ? `next: ${n.name}` : "end of the set";
    if ($("lcdTime")) $("lcdTime").textContent = BRK.paused ? "paused" : "";
    document.querySelector(".lcd") && document.querySelector(".lcd").classList.toggle("brk", true);
    const pb = $("playBtn"); if (pb && !BRK.loop) pb.style.setProperty("--pr", String(Math.max(0, Math.min(100, l / Math.max(1, +b.len) * 100))));
    document.querySelectorAll(`.brk9[data-b="${b.id}"] .bl`).forEach((x) => { x.textContent = mmss(l); x.classList.toggle("over", l < 0); });
    if (typeof perfOn !== "undefined" && perfOn) perfBreak();
  }
  // the page's lcd() runs often: during a break the break wins
  const LC = window.lcd; window.lcd = function () { LC.apply(this, arguments); if (BRK) paint(); else { const l = document.querySelector(".lcd"); if (l && l.classList.contains("brk")) { l.classList.remove("brk"); if ($("lcdSec")) $("lcdSec").style.color = ""; } } };
  function perfBreak() {
    const el = $("perf"); if (!el || !BRK) return; const b = BRK.b, l = left(), n = nextSongAfter(b), pct = Math.max(0, Math.min(100, (1 - l / Math.max(1, +b.len)) * 100));
    const nf = n ? [fmtBpm(n.tmap[0].bpm) + " BPM", window.SL9 ? SL9.tuningOf(n) : ""].filter(Boolean).join(" · ") : "";
    const h = `<div class="pbrk9 ${l < 0 ? "over" : ""}"><div class="pbl">⏸ ${esc(b.label)}</div><div class="pbt">${mmss(l)}${l < 0 ? " <small>over</small>" : ""}</div>
      <div class="pbbar"><i style="width:${pct}%"></i></div>${b.note ? `<p class="pbn">${esc(b.note)}</p>` : ""}
      <p class="pbnext">${n ? `Next: <b>${esc(n.name)}</b>${nf ? " · " + esc(nf) : ""} · ${b.runout === "start" && l > 0 ? `starts automatically in ${mmss(l)}` : "press Play when ready"}` : "The end of the set"}</p>
      <div class="pbbtns"><button class="btn pri" id="pbPlay">▶ Start ${n ? esc(n.name) : ""}</button><button class="btn line" id="pbPause">${BRK.paused ? "Resume" : "Pause"}</button><button class="btn line" id="pbSkip">Skip break</button></div></div>`;
    if (el._brk !== h) { el._brk = h; el.innerHTML = h; el.dataset.key = "";
      $("pbPlay").onclick = () => finish(true); $("pbPause").onclick = pause; $("pbSkip").onclick = skip; }
  }
  // Perform's setlist: a row per break (no number)
  const PS = window.perfSetlist;
  window.perfSetlist = function () {
    const h = PS.apply(this, arguments); if (!list().length) return h;
    const d = document.createElement("div"); d.innerHTML = h;
    d.querySelectorAll(".list .it[data-id]").forEach((it) => { const bs = afterOf(it.dataset.id); if (!bs.length) return; let at = it; if (at.nextElementSibling && at.nextElementSibling.classList.contains("tr")) at = at.nextElementSibling;
      bs.slice().reverse().forEach((b) => at.insertAdjacentHTML("afterend", `<div class="it pbk9 ${BRK && BRK.b.id === b.id ? "now" : ""}"><span class="n"></span><span class="bar"></span><span class="t"><b>⏸ ${esc(b.label)}</b><small>${esc(b.note || "")}</small></span><span class="tm">${mmss(+b.len || 0)}</span></div>`)); });
    return d.innerHTML;
  };
  const RP = window.renderPerform; window.renderPerform = function () { if (BRK && typeof perfOn !== "undefined" && perfOn) { perfBreak(); return; } const el = $("perf"); if (el) el._brk = ""; return RP.apply(this, arguments); };

  // ---------------------------------------------------------------- the transport and the actions around a break
  const toggle0 = window.toggle;
  window.toggle = function () {
    if (BRK) { if (BRK.loop && playing) { finish(true); return; } finish(true); return; } // Play during a break: the next song, now
    return toggle0.apply(this, arguments);
  };
  $("playBtn").onclick = () => window.toggle();
  const stopB = $("stopBtn").onclick;
  $("stopBtn").onclick = (e) => { if (BRK) { pause(); return; } return stopB && stopB(e); };
  const step0 = window.stepSong;
  window.stepSong = function (d) {
    if (BRK) { if (d > 0) skip(); else back(); return; }
    // Next from a song that a break follows: the break becomes current
    const cur = playId || selId;
    if (d > 0 && cur && setOrder.includes(cur) && afterOf(cur).length) { if (playing) toggle0(); start(afterOf(cur)[0]); refresh(); return; }
    return step0.apply(this, arguments);
  };
  $("prevSong").onclick = () => window.stepSong(-1); $("nextSong").onclick = () => window.stepSong(1);
  // "Skip break": a learnable control (7c), and the setlist's + Break
  if (typeof ACTIONS !== "undefined") ACTIONS.push({ id: "skipBreak", name: "Skip break", key: "", ico: "⏭", run: () => { if (BRK) skip(); else toast("No break now"); } });

  // ---------------------------------------------------------------- band screens, the show document, print
  const BL = window.bandLive;
  window.bandLive = function () {
    const o = BL.apply(this, arguments); if (!BRK) return o;
    const b = BRK.b, n = nextSongAfter(b);
    o.brk = { label: b.label, left: Math.round(left() * 10) / 10, len: +b.len, note: b.note || "", paused: BRK.paused, auto: b.runout === "start",
      next: n ? { id: n.id, name: n.name, bpm: fmtBpm(n.tmap[0].bpm), tun: window.SL9 ? SL9.tuningOf(n) : "" } : null };
    return o;
  };
  const BS = window.bandShow;
  window.bandShow = function () {
    const doc = BS.apply(this, arguments);
    // each setlist entry: the breaks after it (Until next change counts their time; Wait for Play makes it unknowable)
    (doc.setlist.order || []).forEach((o) => { const bs = afterOf(o.id); if (bs.length) o.brk = bs.map((b) => ({ label: b.label, len: +b.len, wait: b.runout !== "start" })); });
    doc.setlist.breaks = list().map((b) => ({ after: b.after, label: b.label, len: +b.len, note: b.note || "" }));
    return doc;
  };
  // the printable setlist: a thin row per break ("— Gear change 0:45 · note")
  const SR = window.setlistRows;
  window.setlistRows = function (l) {
    const rows = SR.apply(this, arguments); l = l || curSetObj(); if (!(l.breaks || []).length) return rows;
    const ord = l.id === curSet ? setOrder : l.order || [], out = [];
    items(l).forEach((it) => { if (it.kind === "song") { const k = ord.indexOf(it.id), r = rows.find((x) => x && x.n === k + 1); if (r) out.push(r); } else out.push({ brk: true, label: it.b.label, len: mmss(+it.b.len || 0), note: it.b.note || "" }); });
    return out;
  };
  if (window.SLPrint) SLPrint.rows = window.setlistRows;

  // ---------------------------------------------------------------- the sidebar's ＋ Break
  function wireButtons() {
    const b = $("addBreak9"); if (b && !b._w) { b._w = true; b.hidden = false; b.onclick = (e) => { const r = b.getBoundingClientRect(); addMenu({ clientX: r.left, clientY: r.top - 190 }); }; }
  }
  wireButtons();
  window.SLBreaks = { add: (label) => { if (label) return add(label); const b = $("addBreak9"), r = b ? b.getBoundingClientRect() : { left: 200, top: 400 }; addMenu({ clientX: r.left, clientY: r.top - 190 }); },
    count: () => list().length, length: () => totalLen(), after: (id) => afterOf(id).length > 0, songEnded, start, finish, skip, back, pause, items, list,
    current: () => (BRK ? { ...BRK, left: left() } : null), select: (id) => { SELB = id; renderSetlist(); renderInsp(); }, adoptPending,
    holdsPedals: () => !!BRK || !!((playId || selId) && afterOf(playId || selId).length), LABELS, DEFLEN, del, dup, moveTo };
  try { refresh(); } catch (e) {}
})();
