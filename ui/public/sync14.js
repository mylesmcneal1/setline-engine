// set.Line 14 §2: Sync MIDI sends what the FIRST SONG of the current setlist needs at bar 1 (mockup
// docs/design/phase14/sy.png): every MIDI / modeler track's preset (bank + PC), its scene and any other CCs in effect
// in bar 1, and the MIDI clock (that song's tempo, Song Position = bar 1). One press sends at once; hovering (or a
// long press on touch) shows what each device will get; ⌥-click syncs to the selected song instead. The remote
// screens' Sync MIDI and a pedal mapped to Sync MIDI do the same (the app's fast path gets these messages, armed).
// The old per-setlist "sync point" (Settings › MIDI) is gone: on load, what the first song doesn't cover becomes a
// one-time note.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = /Mac/.test(navigator.platform);
  const M = () => window.SLMod, U = () => window.MODUI;
  const native = () => typeof NATIVE !== "undefined" && NATIVE && typeof ncall === "function";
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const firstSong = () => { const L = curSetObj(), ord = L.id === curSet ? setOrder : L.order || []; return songOf(ord[0]); };
  const selSong = () => songOf((typeof focusId !== "undefined" && focusId) || selId);

  // the state a track is in during bar 1: its last Program Change (with its bank) and the last value of each CC.
  // -> {msgs: [[status, d1, d2]...], tags: ["CC0", "CC32", "PC", "CC43"], pc, ccs: [{cc, val, e}]}
  function bar1(s, t) {
    const cfg = s.midiCfg[t] || {}, c = Math.max(0, Math.min(15, (+cfg.ch || 1) - 1));
    const evs = (s.midi[t] || []).filter((e) => (+e.bar || 1) <= 1 && (e.kind === "pc" || e.kind === "cc")).slice().sort((a, b) => (+a.beat || 1) - (+b.beat || 1));
    let pc = null; const cc = new Map();
    for (const e of evs) { if (e.kind === "pc") pc = e; else { cc.delete(+e.cc); cc.set(+e.cc, e); } } // the order they were last set in
    const msgs = [], tags = [];
    if (pc) { if (pc.msb !== undefined && pc.msb !== "") { msgs.push([0xb0 | c, 0, +pc.msb & 127]); tags.push("CC0"); } if (pc.lsb !== undefined && pc.lsb !== "") { msgs.push([0xb0 | c, 32, +pc.lsb & 127]); tags.push("CC32"); } msgs.push([0xc0 | c, +pc.pc & 127]); tags.push("PC"); }
    for (const [n, e] of cc) { if (n === 0 || n === 32) continue; msgs.push([0xb0 | c, n & 127, +e.val & 127]); tags.push("CC" + n); }
    return { msgs, tags, pc, ccs: [...cc.entries()].filter(([n]) => n !== 0 && n !== 32).map(([n, e]) => ({ cc: n, val: +e.val, e })) };
  }
  // what a device gets, in words: "Preset 17A" + the scene badge; "Program 4"; "CC 7 = 100"
  function words(s, t, b) {
    const d = U() ? U().dev(s, t) : "", out = { what: "", badge: null };
    if (d && U()) U().norm(s, t);
    if (b.pc) {
      if (d) { const p = b.pc.preset !== undefined ? b.pc.preset : M().presetOf(d, b.pc), nm = U().info(d, p).name; out.what = "Preset " + M().presetLabel(d, p) + (nm ? " · " + nm : ""); }
      else out.what = "Program " + (+b.pc.pc || 0) + (b.pc.msb !== undefined ? ` (bank ${+b.pc.msb || 0}${b.pc.lsb !== undefined ? ":" + (+b.pc.lsb || 0) : ""})` : "");
    }
    const rest = [];
    for (const x of b.ccs) {
      const k = d ? M().classify(d, s.midiCfg[t], x.e) : null;
      if (k === "scene" && !out.badge) { const p = b.pc ? (b.pc.preset !== undefined ? b.pc.preset : M().presetOf(d, b.pc)) : -1, sc = U().info(d, p).scenes[x.val] || {}; out.badge = { text: (sc.label || M().sceneLabel(d, x.val)) + (sc.name ? " " + sc.name : ""), col: sc.col || (U().SCENE_PAL || [])[x.val] || "#64d2ff" }; if (!/^Scene/.test(out.badge.text) && d === "axe") out.badge.text = "Scene " + out.badge.text; }
      else if (k === "mode") rest.push(["Preset", "Scene", "Stomp"][x.val] + " mode");
      else if (k === "fs") rest.push("Footswitch " + "ABCDEFGH"[x.cc - 35]);
      else rest.push(`CC ${x.cc} = ${x.val}`);
    }
    if (!out.what && rest.length) out.what = rest.shift();
    out.more = rest;
    return out;
  }
  // everything Sync MIDI does for song s: [{track, label, port, ch, msgs, tags, what, badge, more}] and the clock
  function plan(s) {
    if (!s) return null;
    if (!s.bars && typeof buildBars === "function") buildBars(s);
    const devs = [];
    (s.tracks || []).forEach((t) => {
      if (!isMidiTrack(s, t)) return; const cfg = s.midiCfg[t] || {}, b = bar1(s, t), d = U() ? U().dev(s, t) : "";
      const name = d ? M().DEVICES[d].name : "";
      devs.push({ track: t, label: t + (name && !t.toLowerCase().includes(name.toLowerCase()) ? " · " + name : ""), dev: d, port: cfg.port || "", ch: +cfg.ch || 1, msgs: b.msgs, tags: b.tags, ...words(s, t, b) });
    });
    const bpm = s.tmap && s.tmap[0] ? +s.tmap[0].bpm || 120 : 120;
    return { song: s, n: setOrder.indexOf(s.id) + 1, devs, clock: { bpm } };
  }
  const sig = (p) => p ? JSON.stringify([p.song.id, p.devs.map((d) => [d.port, d.msgs]), p.clock.bpm]) : "";
  let SYNC = null; // the last sync: {set, sig, at, song}
  const target = (alt) => (alt ? selSong() || firstSong() : firstSong());

  // ---------------------------------------------------------------- sending
  let NATIVE_AT = 0; // a pedal (the app's fast path) sent it just now: the page only catches up
  async function send(o) {
    o = o || {}; const p = plan(o.songId ? songOf(o.songId) : target(!!o.alt));
    if (!p) { toast(`“${curSetObj().name}” has no songs to sync to`); return { sent: 0, failed: [] }; }
    const already = Date.now() - NATIVE_AT < 1500; NATIVE_AT = 0;
    let sent = 0; const failed = [], out = [];
    for (const d of p.devs) {
      if (!d.msgs.length) continue;
      if (!d.port) { failed.push(d.label + ": no MIDI port"); continue; }
      const r = already || !native() ? { sent: d.msgs.length } : await ncall("sendMidiNow", { port: d.port, msgs: d.msgs });
      if (r && !r.error) { sent++; out.push(d); } else failed.push(d.label + (r && r.error ? ": " + r.error : ""));
    }
    let clock = null; if (native() && !already) try { clock = await ncall("syncClock", { bpm: p.clock.bpm }); } catch (e) {}
    SYNC = { set: curSet, sig: sig(p), at: Date.now(), song: p.song.id };
    if (typeof SYNCED !== "undefined") SYNCED = { set: curSet, list: out.map((d) => ({ label: d.label, ok: true })) };
    window.__sync14last = { song: p.song.id, devs: p.devs.map((d) => ({ track: d.track, port: d.port, msgs: d.msgs })), bpm: p.clock.bpm, failed };
    const nm = `${p.n > 0 ? p.n + " · " : ""}${p.song.name}`;
    if (failed.length) toast(`Sync MIDI to “${nm}”: ${sent} sent, ${failed.length} failed (${failed.join("; ")})`);
    else toast(`Synced MIDI to “${nm}”: ${sent} device${sent === 1 ? "" : "s"} + clock at ${fmtBpm(p.clock.bpm)} BPM ✓`);
    paintBtn(); hidePreview();
    return { sent, failed, song: p.song.id, clock };
  }
  // the app's fast path: these messages, kept current (arrange.ts pedalArmNow)
  const armMsgs = () => { const p = plan(firstSong()); return p ? p.devs.filter((d) => d.msgs.length && d.port).map((d) => ({ port: d.port, msgs: d.msgs })) : []; };
  const armBpm = () => { const s = firstSong(); return s && s.tmap && s.tmap[0] ? +s.tmap[0].bpm || 0 : 0; };

  // ---------------------------------------------------------------- the button: shown when the first song has MIDI
  function has() { const s = firstSong(); return !!s && (s.tracks || []).some((t) => isMidiTrack(s, t)); }
  function paintBtn() {
    const b = $("syncBtn"); if (!b) return;
    const p = plan(firstSong()), done = !!SYNC && SYNC.set === curSet && SYNC.sig === sig(p); // reordered or edited since: not "Synced" any more
    b.hidden = !has(); b.classList.toggle("synced", done);
    b.innerHTML = (window.IC && IC.sync ? IC.sync : "⇄ ") + `<span class="tlab">${done ? "Synced ✓" : "Sync MIDI"}</span>`;
    b.title = p ? `Send what “${p.song.name}” needs at bar 1 to every device (⌥-click: the selected song)` : "Sync MIDI: the setlist is empty";
    b.setAttribute("aria-label", "Sync MIDI");
    if (PV) fillPreview(PV.alt);
  }
  const RSH = window.renderSetHead;
  window.renderSetHead = function () { const r = RSH.apply(this, arguments); paintBtn(); return r; };

  // ---------------------------------------------------------------- the preview (hover, long press)
  let PV = null, hoverT = 0, leaveT = 0;
  function fillPreview(alt) {
    if (!PV) return; PV.alt = alt; const p = plan(target(alt)), el = PV.el;
    if (!p) { el.innerHTML = `<div class="sy14h"><b>Sync MIDI</b></div><p class="sy14d">The setlist is empty.</p>`; return; }
    const L = curSetObj(), first = !alt || p.song === firstSong();
    const rows = p.devs.map((d) => `<div class="sy14r ${d.msgs.length ? "" : "none"}"><b>${esc(d.label)}</b><span class="sy14w">${d.msgs.length ? esc(d.what) : "nothing in bar 1"}${d.badge ? ` <i class="sy14b" style="background:${d.badge.col};color:${typeof inkOn === "function" ? inkOn(d.badge.col) : "#111"}">${esc(d.badge.text)}</i>` : ""}${d.more && d.more.length ? `<small>${esc(d.more.join(" · "))}</small>` : ""}${!d.port && d.msgs.length ? `<small class="warn">no MIDI port</small>` : ""}</span><span class="sy14m mono">${d.tags.join(" · ")}</span></div>`).join("");
    el.innerHTML = `<div class="sy14h"><b>Sync MIDI to ${first ? "the first song" : "the selected song"}</b><span>${esc(L.name)}</span></div>
      <p class="sy14d">Sends every device what <b>${p.n > 0 ? p.n + " · " : ""}${esc(p.song.name)}</b> needs at bar 1, so the whole rig starts on the right patches.</p>
      ${rows || `<p class="sy14d faint">This song has no MIDI tracks; only the clock is sent.</p>`}
      <div class="sy14r"><b>MIDI clock</b><span class="sy14w">${fmtBpm(p.clock.bpm)} BPM · position bar 1</span><span class="sy14m mono">SPP</span></div>
      <div class="sy14f"><span>${alt ? "Release ⌥ for the first song" : `Hold ${MAC ? "⌥" : "Alt"} to sync to the selected song instead`}</span><button class="btn pri sy14go" type="button">Send <span aria-hidden="true">↩</span></button></div>`;
    el.querySelector(".sy14go").onclick = (e) => send({ alt: PV ? PV.alt : e.altKey });
  }
  function showPreview(alt) {
    const b = $("syncBtn"); if (!b || b.hidden || !b.getClientRects().length) return;
    if (!PV) { const el = document.createElement("div"); el.className = "sy14"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Sync MIDI preview"); document.body.appendChild(el);
      el.onmouseenter = () => clearTimeout(leaveT); el.onmouseleave = () => { leaveT = setTimeout(hidePreview, 250); }; PV = { el, alt }; }
    fillPreview(!!alt);
    const r = b.getBoundingClientRect(), w = PV.el.offsetWidth;
    PV.el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px"; PV.el.style.top = (r.bottom + 8) + "px";
  }
  function hidePreview() { clearTimeout(hoverT); if (PV) { PV.el.remove(); PV = null; } }
  function wire() {
    const b = $("syncBtn"); if (!b || b._s14) return; b._s14 = true;
    b.onclick = (e) => { if (b._lp) { b._lp = false; return; } send({ alt: e.altKey }); };
    b.addEventListener("mouseenter", (e) => { clearTimeout(leaveT); clearTimeout(hoverT); hoverT = setTimeout(() => showPreview(e.altKey), 350); });
    b.addEventListener("mouseleave", () => { clearTimeout(hoverT); leaveT = setTimeout(hidePreview, 250); });
    // touch: a long press shows the preview (the tap that follows sends)
    b.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") return; const t = setTimeout(() => { b._lp = true; showPreview(false); }, 500); const up = () => { clearTimeout(t); b.removeEventListener("pointerup", up); b.removeEventListener("pointercancel", up); }; b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); });
  }
  document.addEventListener("keydown", (e) => { if (PV && e.key === "Alt" && !PV.alt) fillPreview(true); else if (PV && e.key === "Escape") hidePreview(); });
  document.addEventListener("keyup", (e) => { if (PV && e.key === "Alt" && PV.alt) fillPreview(false); });

  // ---------------------------------------------------------------- the old sync points: a one-time note
  // Each setlist's L.sync.devices [{port, ch, text}]: lines the first song's bar 1 sends anyway are dropped; the rest
  // is shown once and kept in L.syncOld (nothing is lost).
  function migrate() {
    const notes = [];
    (typeof setlists !== "undefined" ? setlists : []).forEach((L) => {
      const devs = L.sync && L.sync.devices; if (!L.sync) return;
      if (devs && devs.length) {
        const s = songOf((L.id === curSet ? setOrder : L.order || [])[0]), p = plan(s);
        const sent = new Set(); if (p) p.devs.forEach((d) => d.msgs.forEach((m) => sent.add(d.port + "|" + m.join(","))));
        const left = [];
        devs.forEach((d) => String(d.text || "").split(/\n|;/).map((x) => x.trim()).filter(Boolean).forEach((line) => {
          const r = typeof syncLines === "function" ? syncLines(line, d.ch) : { msgs: [], bad: [line] };
          if (r.bad.length || !r.msgs.length || !r.msgs.every((m) => sent.has(d.port + "|" + m.join(",")))) left.push(`${d.port || "?"} · ch ${d.ch}: ${line}`);
        }));
        if (left.length) { L.syncOld = { devices: devs, at: Date.now() }; notes.push({ set: L.name, left }); }
      }
      delete L.sync;
    });
    if (notes.length) setTimeout(() => noteBox(notes), 600);
    return notes;
  }
  function noteBox(notes) {
    const bg = document.createElement("div"); bg.className = "cfbg";
    bg.innerHTML = `<div class="cfbox sy14note"><b>Sync MIDI now uses the first song</b><p>Sync MIDI sends what each setlist’s first song needs at bar 1, so the separate sync point is gone. These messages weren’t in a first song’s bar 1 and are no longer sent. Put them on a MIDI track at bar 1 of that song to keep them:</p>
      ${notes.map((n) => `<p><b>${esc(n.set)}</b></p><pre class="mono">${esc(n.left.join("\n"))}</pre>`).join("")}<div class="cfa"><span style="flex:1"></span><button class="btn pri" data-a="ok">OK</button></div></div>`;
    document.body.appendChild(bg); const close = () => bg.remove(); bg.querySelector("[data-a=ok]").onclick = close; bg.onclick = (e) => { if (e.target === bg) close(); };
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); close(); } });
    bg.querySelector("[data-a=ok]").focus();
  }
  // after every library load (the setlists come from the file)
  if (window.SLPage && SLPage.loadSession) { const LS = SLPage.loadSession; SLPage.loadSession = function () { const r = LS.apply(this, arguments); try { migrate(); } catch (e) { console.error(e); } paintBtn(); return r; }; }

  window.syncMidi = (o) => send(o);
  window.SL14S = { plan: (id) => plan(id ? songOf(id) : firstSong()), send, armMsgs, armBpm, has, migrate, preview: showPreview, hidePreview, previewEl: () => PV && PV.el, bar1, nativeDid: () => { NATIVE_AT = Date.now(); }, last: () => SYNC };
  wire(); try { migrate(); paintBtn(); } catch (e) {}
})();
