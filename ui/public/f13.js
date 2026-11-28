// set.Line 13 F: library basics.
// §20 Libraries that still hold the old example songs lose them once (only those, untouched by the user's audio),
//     with a note and undo. (The example songs are no longer in the app: tests/fixtures/demo13.js.)
// §21 The Key Commands window (Edit › Key Commands…, ⌥⌘K / Ctrl+Alt+K; Help › Keyboard shortcuts and ⌘/ open it too):
//     every command, grouped and searchable, Mac and Windows keys side by side; remap (select, press a key, see a
//     clash, save), reset one or all; presets (set.Line, Ableton-style, Logic-style); export / import (JSON); print a
//     cheat sheet. The menu bar, tooltips and ⌘K show the current keys. Stored on this computer.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = /Mac/.test(navigator.platform);

  // ================================================================ §20 the old example songs leave existing libraries
  const DEMO = { neon: "Neon Rivers", glass: "Glasshouse", low: "Low Tide", sat: "Satellites", copper: "Copper Sun", paper: "Paper Kings", under: "Undertow (alt intro)", sound: "Soundcheck loop" };
  const DEMO_SETS = ["Full show", "Festival 30", "Acoustic", "Fall Tour"];
  const isDemo = (s) => DEMO[s.id] === s.name && !Object.values(s.files || {}).some((f) => f && f.path); // only ours, with none of your audio
  function libName() { try { const m = window.SLE && SLE.mod && SLE.mod(); const l = m && m.lib && m.lib(); return l ? l.name : ""; } catch (e) { return ""; } }
  let DKEY = "";
  function cleanDemo() {
    if (window.SETLINE_DEMO || typeof songs === "undefined") return; // the tests' own example songs stay
    const name = libName(); if (!name) return; const key = "setline.demoGone:" + name;
    const ids = songs.map((s) => s.id).join(); if (ids === DKEY) return; DKEY = ids;
    let done = false; try { done = localStorage.getItem(key) === "1"; } catch (e) {}
    const gone = songs.filter(isDemo); if (done || !gone.length) { try { localStorage.setItem(key, "1"); } catch (e) {} return; }
    snap(); const gid = new Set(gone.map((s) => s.id));
    for (let i = songs.length - 1; i >= 0; i--) if (gid.has(songs[i].id)) songs.splice(i, 1);
    setlists.forEach((l) => { l.order = (l.order || []).filter((id) => !gid.has(id)); if (l.after) gid.forEach((id) => delete l.after[id]); if (l.vers) gid.forEach((id) => delete l.vers[id]); });
    for (let i = setlists.length - 1; i >= 0 && setlists.length > 1; i--) if (DEMO_SETS.includes(setlists[i].name) && !setlists[i].order.length && !(setlists[i].breaks || []).length) setlists.splice(i, 1);
    if (!setlists.some((l) => l.id === curSet)) { curSet = setlists[0].id; } setOrder = curSetObj().order;
    if (typeof selId !== "undefined" && gid.has(selId)) selId = songs[0] ? songs[0].id : null;
    try { localStorage.setItem(key, "1"); } catch (e) {}
    refresh(); toast(`Removed the example songs (${gone.length}) from “${name}”. Your own songs are untouched.`, undo);
  }
  setInterval(cleanDemo, 2500);

  // ================================================================ §21 key commands
  const STORE = "setline.keys"; // {id: "cmd+alt+x" | "" (none)} — this computer only
  let MAP = (() => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(MAP)); } catch (e) {} if (window.SLMenus) SLMenus.update(); };
  // menus9.js asks: the key a command has now (its own default unless remapped here)
  const key = (id, def) => (Object.prototype.hasOwnProperty.call(MAP, id) ? MAP[id] : def);
  // Ableton-style and Logic-style: where they differ from set.Line's
  const PRESETS = {
    setline: {},
    ableton: { split: "cmd+e", addAudio: "cmd+t", addMidi: "cmd+shift+t", duplicate: "cmd+d", follow: "cmd+f", zoomIn: "cmd+equals", zoomOut: "cmd+minus", songInfo: "cmd+alt+i" },
    logic: { split: "cmd+t", addAudio: "cmd+alt+n", addMidi: "cmd+alt+shift+n", follow: "cmd+l", duplicate: "cmd+d", zoomIn: "cmd+right", zoomOut: "cmd+left", songInfo: "cmd+alt+i" },
  };
  const fmt = (k, mac) => { if (!k) return ""; const P = k.split("+"), kk = P.pop(), m = mac ? { cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" } : { cmd: "Ctrl+", ctrl: "Ctrl+", alt: "Alt+", shift: "Shift+" };
    const K = { comma: ",", minus: "−", equals: "=", slash: "/", left: "←", right: "→", up: "↑", down: "↓", backspace: mac ? "⌫" : "Backspace", return: mac ? "↩" : "Enter", space: "Space" }[kk] || kk.toUpperCase();
    const order = mac ? ["ctrl", "alt", "shift", "cmd"] : ["cmd", "ctrl", "alt", "shift"]; return order.filter((x) => P.includes(x)).map((x) => m[x]).join("") + K; };
  // keys that aren't menu commands (they act on what's under the pointer or in focus): listed, not remapped
  const FIXED = [
    ["Playback", "Play / Stop", "space"], ["Playback", "Play from the insert line", "shift+space"], ["Playback", "Restart from bar 1", "alt+space"], ["Playback", "Back to the start", "return"],
    ["Editing", "Delete the selection", "backspace"], ["Editing", "Rename the selected item", "return"], ["Timeline", "Zoom in / out around the playhead", "equals"], ["Timeline", "Zoom to the selection", "z"], ["Timeline", "Zoom back", "shift+z"],
    ["MIDI", "Draw mode", "b"], ["MIDI", "Grid narrower / wider", "cmd+1"], ["MIDI", "Triplets", "cmd+3"], ["MIDI", "Snap on / off", "cmd+4"], ["MIDI", "Nudge by a grid step (⇧ a bar)", "left"],
    ["Setlist", "Move the selection up / down", "alt+up"], ["View", "Setlist sidebar", "["],
  ];
  // the groups the window shows a menu command in
  const GROUP = (path, id) => { const m = path[0]; if (/^(playStop|play|stop|restart)/.test(id)) return "Playback"; if (m === "Edit") return /zoom|follow/i.test(id) ? "Timeline" : "Editing"; if (m === "View") return /zoom|fit|follow|track(Size|s)/i.test(id) ? "Timeline" : "View";
    if (m === "Track") return /clip|fade|split/i.test(id) ? "Clips" : /patch|midi|dev|port|ch/i.test(id) ? "MIDI" : "Editing"; if (m === "Song") return "Editing"; if (m === "Setlist") return "Setlist"; if (m === "Cues") return "Cues"; if (m === "Window") return "Window"; if (m === "File" || m === "Library") return "File"; return m || "Other"; };
  function commands() { const flat = window.SLMenus ? SLMenus.flat() : []; const seen = new Set(), out = [];
    for (const x of flat) { if (seen.has(x.id) || /^(lib\d|set\d|ver\d|ev\d|mk\d|tp\d|ms\d|th\d|scol|tcol|skey|tout|tport|tch|tfade|cvv|cueOut|sfield|after_|ann_|ci_|sort_|th_|ths|acc_|pair_|size_|tp_|trackSize|tdev_|zoom_|oc\d|otc)/.test(x.id)) continue; seen.add(x.id);
      out.push({ id: x.id, name: x.label.replace(/…$/, "…"), path: x.path, group: GROUP(x.path, x.id), def: defaultKey(x.id), key: x.key || "" }); }
    return out; }
  let DEF = null; // the defaults (the menus without any remap)
  function defaultKey(id) { if (!DEF) { const keep = MAP; MAP = {}; DEF = {}; try { (window.SLMenus ? SLMenus.flat() : []).forEach((x) => { if (!(x.id in DEF)) DEF[x.id] = x.key || ""; }); } finally { MAP = keep; } } return DEF[id] || ""; }

  let KC = null;
  function open(focus) {
    close(); DEF = null; KC = document.createElement("div"); KC.className = "cfbg kc13bg";
    KC.innerHTML = `<div class="cfbox kc13" role="dialog" aria-label="Key Commands"><div class="si13h"><b>Key Commands</b><span>Mac and Windows · stored on this computer</span>
      <select class="kc13p" title="Presets"><option value="">Preset…</option><option value="setline">set.Line default</option><option value="ableton">Ableton-style</option><option value="logic">Logic-style</option></select>
      <button class="btn line" data-a="exp">Export…</button><button class="btn line" data-a="imp">Import…</button><button class="btn line" data-a="print">Print…</button><button class="btn line" data-a="reset">Reset all</button><button class="btn pri" data-a="done">Done</button></div>
      <div class="kc13s"><input class="kc13q" type="search" placeholder="Search by name or key (e.g. split, ⌘E, cmd+e)" spellcheck="false"></div><div class="kc13l"></div><div class="kc13f"></div></div>`;
    document.body.appendChild(KC); KC.onclick = (e) => { if (e.target === KC) close(); };
    const q = KC.querySelector(".kc13q"); q.oninput = draw; draw(); setTimeout(() => q.focus(), 0);
    KC.querySelector('[data-a="done"]').onclick = close;
    KC.querySelector('[data-a="reset"]').onclick = () => { MAP = {}; save(); draw(); toast("Key commands: set.Line's defaults"); };
    KC.querySelector(".kc13p").onchange = (e) => { const p = PRESETS[e.target.value]; if (!p) return; MAP = { ...p }; save(); draw(); toast(`Key commands: ${e.target.selectedOptions[0].textContent}`); e.target.value = ""; };
    KC.querySelector('[data-a="exp"]').onclick = () => { const blob = new Blob([JSON.stringify({ format: "setline-keys", version: 1, keys: MAP }, null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "set.Line key commands.json"; document.body.appendChild(a); a.click(); a.remove(); };
    KC.querySelector('[data-a="imp"]').onclick = () => { const i = document.createElement("input"); i.type = "file"; i.accept = ".json,application/json"; i.onchange = async () => { try { const o = JSON.parse(await i.files[0].text()); if (!o || typeof o.keys !== "object") throw 0; MAP = { ...o.keys }; save(); draw(); toast("Key commands imported"); } catch (e) { toast("That file isn't a set.Line key commands file"); } }; i.click(); };
    KC.querySelector('[data-a="print"]').onclick = printSheet;
    KC.addEventListener("keydown", onKey, true);
  }
  function close() { if (KC) KC.remove(); KC = null; REC = null; }
  let REC = null; // the command being remapped: {id}
  function draw() {
    if (!KC) return; const q = (KC.querySelector(".kc13q").value || "").trim().toLowerCase(), cmds = commands();
    const match = (name, k) => !q || name.toLowerCase().includes(q) || fmt(k, true).toLowerCase().includes(q) || fmt(k, false).toLowerCase().includes(q) || k.includes(q.replace(/\s+/g, ""));
    const groups = ["Playback", "Editing", "Timeline", "Clips", "MIDI", "Setlist", "View", "Cues", "File", "Window", "Help", "Customize", "Other"];
    const byG = {}; cmds.filter((c) => match(c.name, c.key)).forEach((c) => (byG[c.group] = byG[c.group] || []).push(c));
    FIXED.filter(([g, n, k]) => match(n, k)).forEach(([g, n, k]) => (byG[g] = byG[g] || []).push({ id: "", name: n, key: k, fixed: true }));
    KC.querySelector(".kc13l").innerHTML = `<div class="kc15h" role="row"><span>Command</span><span>Mac</span><span>Windows</span><span></span></div>` + groups.filter((g) => byG[g]).map((g) => `<div class="kc13g">${g}</div>` + byG[g].map((c) => `<div class="kc13r ${c.fixed ? "kc15fx" : ""} ${REC && REC.id === c.id ? "rec" : ""} ${c.id && c.key !== c.def ? "chg" : ""}" data-id="${c.id}"><span class="kc13n" title="${esc(c.name)}"><b>${esc(c.name)}</b><small>${c.path && c.path.length ? esc(c.path.join(" › ")) : c.fixed ? "Fixed key" : ""}</small></span><span class="kc13k">${REC && REC.id === c.id ? "Press a key…" : fmt(c.key, true) || "—"}</span><span class="kc13k w">${REC && REC.id === c.id ? "" : fmt(c.key, false) || "—"}</span>${c.fixed ? '<span class="kc15lock" title="A fixed key: it acts on what is selected, so it cannot be changed" aria-label="Fixed"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg></span>' : `<button class="ibtn" data-a="rs" title="Back to the default (${esc(fmt(c.def, MAC) || "none")})" ${c.key === c.def ? "disabled" : ""}>↺</button>`}</div>`).join("")).join("") || '<p class="faint" style="padding:16px">Nothing matches.</p>';
    KC.querySelectorAll(".kc13r[data-id]:not(.kc15fx)").forEach((r) => { r.onclick = (e) => { if (e.target.closest('[data-a="rs"]')) { delete MAP[r.dataset.id]; save(); draw(); return; } REC = { id: r.dataset.id }; foot(""); draw(); }; });
  }
  function foot(html) { const f = KC && KC.querySelector(".kc13f"); if (f) f.innerHTML = html; }
  const CODE = { Comma: "comma", Minus: "minus", Equal: "equals", Slash: "slash", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Backspace: "backspace", Enter: "return", Space: "space" };
  function comboOf(e) { let k = CODE[e.code] || (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : (e.key || "").toLowerCase()); const m = []; if (MAC ? e.metaKey : e.ctrlKey) m.push("cmd"); if (MAC && e.ctrlKey) m.push("ctrl"); if (e.altKey) m.push("alt"); if (e.shiftKey) m.push("shift"); return [...m, k].join("+"); }
  function onKey(e) {
    if (!REC) { if (e.key === "Escape") { e.stopPropagation(); close(); } return; }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { REC = null; foot(""); draw(); return; }
    if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey) { MAP[REC.id] = ""; save(); REC = null; foot("No key for it now."); draw(); return; }
    const k = comboOf(e); if (!/^(cmd|ctrl)\+/.test(k) && !k.startsWith("cmd")) { foot(`<span class="kc13w">Menu commands use ${MAC ? "⌘" : "Ctrl"} with a key (single keys belong to what's selected).</span>`); return; }
    const clash = commands().find((c) => c.id !== REC.id && c.key === k), id = REC.id;
    if (clash) { foot(`<span class="kc13w">${fmt(k, MAC)} is “${esc(clash.name)}” now.</span> <button class="btn line" data-a="swap">Use it here (and take it off “${esc(clash.name)}”)</button>`); KC.querySelector('[data-a="swap"]').onclick = () => { MAP[clash.id] = ""; MAP[id] = k; save(); REC = null; foot(""); draw(); }; return; }
    MAP[id] = k; save(); REC = null; foot(`Saved: ${fmt(k, MAC)}`); draw();
  }
  function printSheet() {
    const cmds = commands().filter((c) => c.key), w = document.createElement("div"); w.className = "kc13print";
    w.innerHTML = `<h1>set.Line · key commands</h1><table>${cmds.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(fmt(c.key, true))}</td><td>${esc(fmt(c.key, false))}</td></tr>`).join("")}${FIXED.map(([g, n, k]) => `<tr><td>${esc(n)}</td><td>${esc(fmt(k, true))}</td><td>${esc(fmt(k, false))}</td></tr>`).join("")}</table>`;
    document.body.appendChild(w); document.body.classList.add("printkc13"); const done = () => { document.body.classList.remove("printkc13"); w.remove(); removeEventListener("afterprint", done); };
    addEventListener("afterprint", done); try { window.print(); } catch (e) {} setTimeout(done, 60000);
  }
  // ⌘/ and Help › Keyboard shortcuts open it (the read-only sheet goes)
  addEventListener("DOMContentLoaded", () => { if (window.SLix) SLix.sheet = () => open(); });

  window.SLKeys = { key, open, close, map: () => ({ ...MAP }), set: (id, k) => { MAP[id] = k; save(); }, reset: () => { MAP = {}; save(); }, preset: (p) => { MAP = { ...(PRESETS[p] || {}) }; save(); }, fmt, commands, isDemo, cleanDemo };
})();
