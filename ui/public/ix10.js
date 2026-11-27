// set.Line 10b: making set.Line obvious. The eight visible behaviours (docs/design/phase10/ix1.png) and first run
// (ix2.png):
// 1. ⌘K: search or do anything (songs, setlists, every menu action with its key, settings pages, help topics)
// 2. hover (or keyboard focus) shows a grip ⋮⋮ and a ⋯ button on setlist rows, cards, Folders rows, track headers
//    and sections; ⋯ opens the same menu as right-click and the menu bar (SLMenus.obj)
// 3. double-click a name to rename it (10a)
// 4. a selection bar above the timeline / the cards: the main actions for what's selected
// 5. empty places say what goes there, with the one click to fill it (an empty library: the first-run checklist)
// 6. tooltips after ~500 ms with the name and the key (also on keyboard focus)
// 7. landing lines while dragging (10a)
// 8. an undo note after every change: "Moved “TRAX” to the top · Undo ⌘Z"; never during a show (logged instead)
// Plus the ⌘/ shortcut sheet, made from the same command list as the menus.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = /Mac/.test(navigator.platform);
  const CMD = MAC ? "⌘" : "Ctrl+";
  const native = () => typeof NATIVE !== "undefined" && NATIVE && typeof ncall === "function";
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const escH = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const editing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const showing = () => (typeof perfOn !== "undefined" && perfOn) || (typeof bandOn !== "undefined" && bandOn);
  const live = () => typeof perfOn !== "undefined" && perfOn && typeof playing !== "undefined" && playing;
  const logLine = (t) => { try { if (native()) ncall("logLine", { text: t }); } catch (e) {} };
  const store = { get: (k, d) => { try { const v = localStorage.getItem("setline." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("setline." + k, JSON.stringify(v)); } catch (e) {} } };

  // ================================================================ 8. the undo note
  // replaces the page's toast: one note at the bottom, the newest replaces the last; with Undo when it can be undone
  let noteT = 0, toasted = false;
  function note(msg, undoFn) {
    toasted = true;
    if (live()) { logLine("Note (not shown during the show): " + msg); return; }
    let n = $("note10");
    if (!n) { n = document.createElement("div"); n.id = "note10"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.innerHTML = `<span class="nm10"></span>${undoFn ? `<button class="nu10">Undo <kbd>${CMD}Z</kbd></button>` : ""}`;
    n.firstChild.textContent = msg;
    if (undoFn) n.querySelector("button").onclick = () => { n.classList.remove("show"); undoFn(); };
    n.classList.remove("show"); void n.offsetWidth; n.classList.add("show");
    clearTimeout(noteT); noteT = setTimeout(() => n.classList.remove("show"), undoFn ? 5000 : 2600);
  }
  window.toast = note;
  // a change with no note of its own (snap() then nothing said): describe it from what changed
  const SNAP = window.snap;
  let pend = 0;
  window.snap = function () {
    const r = SNAP.apply(this, arguments);
    if (!pend) { toasted = false; pend = setTimeout(() => { pend = 0; if (!toasted) describe(); }, 0); }
    return r;
  };
  const KEYS = [["name", "Renamed"], ["col", "Changed the colour of"], ["tracks", "Changed the tracks of"], ["secs", "Edited the sections of"], ["tmap", "Changed the tempo or time signature of"],
    ["cues", "Edited the cues of"], ["clips", "Edited the clips in"], ["midi", "Edited MIDI in"], ["ck", "Edited the click in"], ["cks", "Edited the click in"], ["versions", "Edited the versions of"],
    ["gain", "Changed the mix of"], ["mute", "Changed the mix of"], ["solo", "Changed the mix of"], ["outs", "Changed the outputs of"], ["tcol", "Changed a track colour in"], ["marks", "Edited the markers of"]];
  function describe() {
    try {
      if (typeof undoS === "undefined" || !undoS.length) return;
      const before = JSON.parse(undoS[undoS.length - 1]), now = JSON.parse(ser());
      const B = new Map(before.songs.map((s) => [s.id, s])), N = new Map(now.songs.map((s) => [s.id, s]));
      const added = now.songs.filter((s) => !B.has(s.id)), gone = before.songs.filter((s) => !N.has(s.id));
      let msg = "";
      if (added.length) msg = `Added ${added.length > 1 ? added.length + " songs" : "“" + added[0].name + "”"}`;
      else if (gone.length) msg = `Deleted ${gone.length > 1 ? gone.length + " songs" : "“" + gone[0].name + "”"}`;
      else {
        const ch = now.songs.filter((s) => JSON.stringify(s) !== JSON.stringify(B.get(s.id)));
        if (ch.length === 1) { const s = ch[0], o = B.get(s.id), k = KEYS.find(([k]) => JSON.stringify(s[k]) !== JSON.stringify(o[k])); msg = k ? (k[0] === "name" ? `Renamed “${o.name}” to “${s.name}”` : `${k[1]} “${s.name}”`) : `Changed “${s.name}”`; }
        else if (ch.length > 1) msg = `Changed ${ch.length} songs`;
        else {
          const ls = now.setlists.filter((l) => JSON.stringify(l) !== JSON.stringify((before.setlists || []).find((x) => x.id === l.id)));
          if (ls.length) msg = `Changed the setlist “${ls[0].name}”`;
          else if ((now.setlists || []).length !== (before.setlists || []).length) msg = "Changed the setlists";
        }
      }
      if (msg) note(msg, undo);
    } catch (e) { /* a note is a courtesy: never in the way of the edit */ }
  }

  // ================================================================ 6. tooltips with keys
  // every element with a title: its name and key in a styled tip after 500 ms (and on keyboard focus). A title's
  // key is what follows two spaces ("Play  Space"); a few buttons get theirs here.
  const KEYED = { prevSong: "Previous song  P", nextSong: "Next song  N", stopBtn: "Stop  Space", tglL: "Setlist sidebar  [", tglR: "Side panel  ]" };
  const fixTitles = () => { for (const [id, t] of Object.entries(KEYED)) { const el = $(id); if (el && el.title && el.title !== t) el.title = t; } };
  let tip = null, tipT = 0, tipEl = null;
  function tipShow(el) {
    const t = el.dataset.t10 || el.getAttribute("title"); if (!t) return;
    if (el.hasAttribute("title")) { el.dataset.t10 = t; el.removeAttribute("title"); } // no native tooltip on top
    const [name, ...rest] = t.split(/\s{2,}/); const key = rest.join(" ");
    if (!tip) { tip = document.createElement("div"); tip.id = "tip10"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
    tip.innerHTML = `<span></span>${key ? `<kbd></kbd>` : ""}`; tip.firstChild.textContent = name; if (key) tip.querySelector("kbd").textContent = key;
    tip.style.display = "block";
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)), y = r.bottom + 6; if (y + h > innerHeight - 4) y = r.top - h - 6;
    tip.style.left = x + "px"; tip.style.top = y + "px"; tipEl = el;
  }
  const tipHide = () => { clearTimeout(tipT); if (tip) tip.style.display = "none"; tipEl = null; };
  const tipTarget = (n) => n && n.closest && n.closest("button[title], button[data-t10], a[title], [role=button][title], .ibtn[title], .ibtn[data-t10], select[title], input[type=range][title], [data-t10]");
  document.addEventListener("mouseover", (e) => { const el = tipTarget(e.target); if (el === tipEl) return; tipHide(); if (!el || el.closest("[data-tip]")) return; tipT = setTimeout(() => tipShow(el), 500); });
  document.addEventListener("focusin", (e) => { const el = tipTarget(e.target); tipHide(); if (el && el.matches(":focus-visible")) tipT = setTimeout(() => tipShow(el), 300); });
  ["pointerdown", "keydown", "wheel", "scroll"].forEach((t) => document.addEventListener(t, tipHide, true));

  // ================================================================ 2. grips and ⋯ on hover / focus
  const GRIP = `<i class="grip10" aria-hidden="true">⋮⋮</i>`;
  const MORE = (label) => `<button class="more10" aria-label="${label}" title="More  right-click">⋯</button>`;
  function decorate() {
    document.querySelectorAll("#songs > .song:not(.ix10), #songs > .brk9:not(.ix10)").forEach((r) => { r.classList.add("ix10"); r.tabIndex = 0; r.insertAdjacentHTML("afterbegin", GRIP); r.insertAdjacentHTML("beforeend", MORE(r.dataset.b ? "Break options" : "Song options")); });
    document.querySelectorAll(".card9[data-id]:not(.ix10)").forEach((c) => { c.classList.add("ix10"); const h = c.querySelector(".c9h"); if (h) { h.insertAdjacentHTML("afterbegin", GRIP); h.insertAdjacentHTML("beforeend", MORE("Song options")); } });
    document.querySelectorAll(".r9h[data-id]:not(.ix10)").forEach((h) => { h.classList.add("ix10"); h.insertAdjacentHTML("afterbegin", GRIP); const x = h.querySelector(".r9x"); if (x) { x.classList.add("more10"); x.title = "More  right-click"; } });
    document.querySelectorAll(".row.trk > .lh:not(.ix10)").forEach((lh) => { lh.classList.add("ix10"); lh.insertAdjacentHTML("afterbegin", GRIP); lh.insertAdjacentHTML("beforeend", MORE("Track options")); });
    document.querySelectorAll(".secs .sec[data-sid]:not(.ix10)").forEach((s) => { s.classList.add("ix10"); if (s.getBoundingClientRect().width > 64) s.insertAdjacentHTML("beforeend", MORE("Section options")); });
  }
  const mo = new MutationObserver(() => { decorate(); syncBar(); fixTitles(); emptyStates(); });
  const watch = () => { ["songs", "scroller"].forEach((id) => { const el = $(id); if (el && !el._ix10) { el._ix10 = true; mo.observe(el, { childList: true, subtree: true }); } }); };
  // ⋯: the same menu as right-click
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".more10"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const r = b.getBoundingClientRect(), at = { clientX: Math.min(r.left, innerWidth - 240), clientY: r.bottom + 4 };
    const row = b.closest("#songs > .song, #songs > .brk9, .card9, .r9h, .row.trk > .lh, .sec");
    if (!row) return;
    if (row.matches("#songs > .brk9")) { if (window.SLBreaks) SLBreaks.select(row.dataset.b); SLMenus.obj("break", at, row.dataset.b); }
    else if (row.matches(".row.trk > .lh")) { const s = songOf(row.dataset.song); if (s) { if (window.SLDrag) SLDrag.setArea("track"); SLMenus.obj("track", at, s, row.dataset.track); } }
    else if (row.matches(".sec")) { const lane = row.closest(".lane"), s = songOf(lane && lane.dataset.song); if (s) SLMenus.obj("section", at, s, +row.dataset.sid); }
    else SLMenus.obj("song", at, row.dataset.id);
  }, true);
  // the grip starts a drag like the row itself (10a); a plain click on it does nothing else
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".grip10")) { e.stopImmediatePropagation(); } }, true);
  // right-click everywhere = the same menus
  window.songMenu = (e, id) => SLMenus.obj("song", e, id);
  window.secMenu = (e, s, id) => SLMenus.obj("section", e, s, id);

  // ================================================================ 4. the selection bar
  // a slim bar over the timeline (or the cards): the main actions for what's selected; hidden with nothing selected,
  // in Perform and Band, and while several songs are selected (the 9b bar has those)
  function barSpec() {
    if (showing() || (typeof songSel !== "undefined" && songSel.size > 1)) return null;
    const T = typeof trackOpen !== "undefined" && trackOpen && songOf(trackOpen.song) && window.SLDrag && SLDrag.area() === "track" ? trackOpen : null;
    if (T) { const s = songOf(T.song), t = T.track, fx = typeof ROLE !== "undefined" && ROLE[t] === "cues"; // 11: click tracks delete like any other
      return { kind: "Track", name: t, items: [["Rename", () => SLMenus.run("m:renameTrack"), fx], ["Colour", (b) => { const r = b.getBoundingClientRect(); swatchPop({ left: r.left, right: r.left, top: r.bottom, bottom: r.bottom }, trackCol(s, t), (c) => { snap(); (s.tcol || (s.tcol = {}))[t] = c; refresh(); }); }],
        ["Height ▾", (b) => { const r = b.getBoundingClientRect(); ctxMenu({ clientX: r.left, clientY: r.bottom + 4 }, SLMenus.toCtx(SLMenus.objItems("track", s, t).find((x) => x.label === "Height").sub, { clientX: r.left, clientY: r.bottom + 4 })); }],
        ["Delete", () => SL9.deleteTrack(s, t), fx || (typeof playing !== "undefined" && playing)]] }; }
    const FS = typeof focusSong === "function" ? focusSong() : null;
    const cur = FS || (document.querySelector(".card9.cur") && songOf(selId));
    if (!cur) return null;
    const hasCues = (cur.cues || []).length > 0;
    return { kind: "Song", name: cur.name, items: [["Rename", () => renameSong(cur.id)], ["Colour", (b) => { const r = b.getBoundingClientRect(); swatchPop({ left: r.left, right: r.left, top: r.bottom, bottom: r.bottom }, cur.col, (c) => { snap(); cur.col = c; refresh(); }); }],
      ["Versions ▾", (b) => { const r = b.getBoundingClientRect(), at = { clientX: r.left, clientY: r.bottom + 4 }; ctxMenu(at, SLMenus.toCtx(SLMenus.objItems("song", cur.id).find((x) => x.label === "Versions").sub, at)); }],
      ...(hasCues ? [["✨ Sections from cues", () => SLMenus.run("m:secsFromCues"), false, "hl"]] : []),
      ["Add track ▾", (b) => { const r = b.getBoundingClientRect(); ctxMenu({ clientX: r.left, clientY: r.bottom + 4 }, [{ label: "Audio track", icon: "∿", act: () => addTrack(cur, "audio") }, { label: "Click track", icon: "♩", act: () => addTrack(cur, "click") }, { label: "MIDI track", icon: "⎍", act: () => addTrack(cur, "midi") }, ...(cur.tracks.includes("Cues") ? [] : [{ label: "Cues track", icon: "❝", act: () => addTrack(cur, "cues") }])]); }]] };
  }
  let barKey = "";
  function syncBar() {
    const sp = barSpec(), sc = $("scroller"); if (!sc) return;
    let b = $("selbar10");
    if (!sp) { if (b) b.hidden = true; barKey = ""; return; }
    const key = sp.kind + "|" + sp.name + "|" + sp.items.map((x) => x[0] + !!x[2]).join();
    if (!b) { b = document.createElement("div"); b.id = "selbar10"; b.setAttribute("role", "toolbar"); b.setAttribute("aria-label", "Actions for what’s selected"); sc.parentElement.insertBefore(b, sc); }
    b.hidden = false; if (key === barKey) return; barKey = key;
    b.innerHTML = `<span class="sk10">${sp.kind}</span><b class="sn10"></b>${sp.items.map(([l, , dis, cls], i) => `<button data-i="${i}" class="${cls || ""}" ${dis ? "disabled" : ""}>${escH(l)}</button>`).join("")}<span class="sh10">changes with what’s selected</span>`;
    b.querySelector(".sn10").textContent = sp.name;
    b.querySelectorAll("button").forEach((x) => x.onclick = (e) => { e.stopPropagation(); sp.items[+x.dataset.i][1](x); });
  }
  document.addEventListener("click", () => setTimeout(syncBar, 0), true);
  document.addEventListener("keyup", () => setTimeout(syncBar, 0), true);

  // ================================================================ 1. ⌘K: search or do anything
  const HELP = [["How sections work", "click-versions-sections"], ["How the click works", "click-versions-sections"], ["Versions of a song", "click-versions-sections"], ["Setlists and breaks", "breaks"], ["Band screens", "phase6g-satellites"],
    ["Importing from Ableton Live", "ableton-import"], ["Menus and shortcuts", "menus"], ["Keyboard shortcuts", "__sheet"], ["Quick start", "__qs"], ["Drag, zoom and rename", "drag-zoom-rename"], ["The song timeline", "timeline"]];
  const SETTINGS = () => (typeof SET_TABS !== "undefined" ? SET_TABS : []).map(([k, l]) => [l, k]).concat([["Click & cues › Count-in sections", "general"], ["Audio › Interface and buffer", "audio"], ["Outputs › Rename outputs", "out"], ["Controls › Pedals and MIDI controllers", "controls"]]);
  // a fuzzy score: the typed text anywhere scores best; otherwise every letter in order, each one continuing a run
  // or starting a word ("msc" finds "Make sections from cues"); 0 = no match
  function score(q, text) {
    q = q.toLowerCase(); const t = text.toLowerCase(); if (!q) return 1;
    const at = t.indexOf(q); if (at >= 0) return 1000 - at + (at === 0 || /[\s›(/_-]/.test(t[at - 1]) ? 200 : 0);
    let i = 0, s = 0, prev = -2;
    for (let j = 0; j < t.length && i < q.length; j++) { const ws = j === 0 || /[\s›(/_-]/.test(t[j - 1]); if (t[j] === q[i] && (j === prev + 1 || ws)) { s += j === prev + 1 ? 8 : 12; prev = j; i++; } }
    return i === q.length ? s : 0;
  }
  const recent = () => store.get("recentSongs", []);
  const used = () => store.get("usedActions", {});
  const noteSong = (id) => { const r = recent().filter((x) => x !== id); r.unshift(id); store.set("recentSongs", r.slice(0, 8)); };
  const noteAct = (id) => { const u = used(); u[id] = (u[id] || 0) + 1; store.set("usedActions", u); };
  const OPEN0 = window.openSong; if (OPEN0) window.openSong = function (id) { noteSong(id); return OPEN0.apply(this, arguments); };
  function entries(q) {
    const s = songOf(typeof focusId !== "undefined" && focusId || selId), out = [];
    const acts = SLMenus.flat().filter((x) => !x.dis && !/^(lib|set|scol|tcol|th_|ths|acc_|pair_|size_|tp_|ver|trackSize|sort_|th\d|zoom_)/.test(x.id) || (q && !x.dis && /^(th_|acc_|pair_|size_|tp_|trackSize|zoom_|sort_)/.test(x.id)));
    const songCtx = /^(renameSong|dupSong|deleteSong|newVersion|addSection|addMeter|addTempo|secsFromCues|addToSet|sortMidi|exportSong|addAudio|addClick|addMidi|editClick)$/;
    for (const a of acts) { const label = (a.path.length > 1 ? a.path.slice(1).join(" › ") + " › " : "") + a.label; const sc = score(q, label + " · " + (a.help || "")) || (q.length > 2 && a.path[0].toLowerCase().startsWith(q.toLowerCase()) ? 40 : 0); if (sc) out.push({ g: "Actions", label, key: a.keyText, ctx: songCtx.test(a.id) && s ? "this song" : "", sc: sc + (used()[a.id] || 0) * (q ? 2 : 10), run: () => { noteAct(a.id); SLMenus.run("m:" + a.id); } }); }
    if (window.SL11 && q) for (const x of SL11.palette(q, score)) out.push(x); // 11: every object by name, with its actions
    for (const x of songs) { const sc = score(q, x.name); if (q && sc) out.push({ g: "Songs", label: x.name, key: "", ctx: setOrder.includes(x.id) ? "#" + (setOrder.indexOf(x.id) + 1) : "", sc, run: () => openSong(x.id) }); }
    for (const l of setlists) { const sc = score(q, l.name + " setlist"); if (q && sc) out.push({ g: "Setlists", label: l.name, key: "", ctx: (l.order || []).length + " songs", sc, run: () => { if (useSet(l.id) !== false) refresh(); } }); }
    for (const [l, k] of SETTINGS()) { const sc = score(q, l + " settings"); if (q && sc) out.push({ g: "Settings", label: l, key: "", ctx: "", sc, run: () => openSettings(k) }); }
    for (const [l, d] of HELP) { const sc = score(q, l + " help"); if (q && sc) out.push({ g: "Help", label: l, key: d === "__sheet" ? CMD + "/" : "", ctx: "", sc, run: () => help(d) }); }
    if (!q) {
      const R = recent().map(songOf).filter(Boolean).slice(0, 5).map((x) => ({ g: "Recent songs", label: x.name, key: "", ctx: "", sc: 1, run: () => openSong(x.id) }));
      const A = out.filter((x) => x.g === "Actions").sort((a, b) => b.sc - a.sc).slice(0, 7).map((x) => ({ ...x, g: "Actions" }));
      return [...R, ...A];
    }
    const order = { Actions: 0, Edit: 1, Songs: 2, Setlists: 3, Settings: 4, Help: 5 };
    out.sort((a, b) => b.sc - a.sc);
    const top = out.slice(0, 40);
    top.sort((a, b) => order[a.g] - order[b.g] || b.sc - a.sc);
    return top;
  }
  function help(d) {
    if (d === "__sheet") { sheet(); return; } if (d === "__qs") { quickStart(); return; }
    const url = "https://github.com/mylesmcneal1/setline-engine/blob/main/docs/" + d + ".md";
    if (native()) ncall("openUrl", { url }); else window.open(url, "_blank");
  }
  function palette(q0) {
    if ($("pal10")) { $("pal10").querySelector("input").focus(); return; }
    const bg = document.createElement("div"); bg.id = "pal10"; bg.className = "pal10";
    bg.innerHTML = `<div class="pbox10" role="dialog" aria-label="Search or do anything"><div class="pin10"><span aria-hidden="true">⌕</span><input placeholder="Search songs, actions, settings…" spellcheck="false" autocomplete="off"><kbd>esc</kbd></div><div class="pres10" role="listbox"></div><div class="pft10">↑↓ to choose · ↩ to run · every action shows its shortcut</div></div>`;
    document.body.appendChild(bg);
    const inp = bg.querySelector("input"), res = bg.querySelector(".pres10");
    let list = [], k = 0;
    const draw = () => {
      list = entries(inp.value.trim()); k = Math.min(k, Math.max(0, list.length - 1));
      let g = ""; res.innerHTML = list.map((x, i) => `${x.g !== g ? `<div class="pg10">${(g = x.g)}</div>` : ""}<div class="pi10 ${i === k ? "on" : ""}" data-i="${i}" role="option"><span>${escH(x.label)}</span>${x.ctx ? `<em>${escH(x.ctx)}</em>` : ""}${x.key ? `<kbd>${escH(x.key)}</kbd>` : ""}</div>`).join("") || `<div class="pe10">Nothing matches “${escH(inp.value)}”</div>`;
      const on = res.querySelector(".pi10.on"); if (on) on.scrollIntoView({ block: "nearest" });
    };
    const close = () => { bg.remove(); };
    const go = (i) => { const x = list[i]; close(); if (x) setTimeout(() => x.run(), 0); };
    inp.oninput = () => { k = 0; draw(); };
    inp.onkeydown = (e) => { e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); } else if (e.key === "ArrowDown") { e.preventDefault(); k = Math.min(list.length - 1, k + 1); draw(); } else if (e.key === "ArrowUp") { e.preventDefault(); k = Math.max(0, k - 1); draw(); }
      else if (e.key === "Enter") { e.preventDefault(); go(k); } else if ((MAC ? e.metaKey : e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); close(); } };
    res.onclick = (e) => { const r = e.target.closest(".pi10"); if (r) go(+r.dataset.i); };
    res.onmousemove = (e) => { const r = e.target.closest(".pi10"); if (r && +r.dataset.i !== k) { k = +r.dataset.i; res.querySelectorAll(".pi10").forEach((x) => x.classList.toggle("on", +x.dataset.i === k)); } };
    bg.onpointerdown = (e) => { if (e.target === bg) close(); };
    if (q0) inp.value = q0; draw(); inp.focus();
  }

  // ================================================================ the ⌘/ shortcut sheet (from the menus' own keys)
  const PAGE_KEYS = [["Playback", "Play / Stop", "Space"], ["Playback", "Next song", "N"], ["Playback", "Previous song", "P"], ["Playback", "Next version", "V"], ["Setlist", "The selected song’s previous / next version", "⌥[ ⌥]"], ["Playback", "Go to start", "↩"],
    ["Playback", "Loop the section", "C"], ["Playback", "Click on / off", "K"], ["Playback", "Leave the loop", "L"],
    ["Editing", "Rename", "↩"], ["Editing", "Delete", "⌫"], ["Editing", "Move up / down", "⌥↑ ⌥↓"], ["Editing", "Copy while dragging", "⌥ drag"], ["Editing", "Cancel", "Esc"],
    ["View", "Zoom at the pointer", "⌥ scroll"], ["View", "Zoom in / out (around the playhead)", "= −"], ["View", "Zoom to the selection", "Z"], ["View", "Zoom back", "⇧Z  X"], ["Editing", "Rename, then the next name", "⇥"], ["Editing", "Click editor: Draw mode", "B"], ["Editing", "Click editor: grid narrower / wider / triplets / snap", "⌘1 ⌘2 ⌘3 ⌘4"], ["Editing", "Solo only this track", "⌘-click S"], ["View", "Pinch to zoom", "trackpad"], ["View", "Setlist sidebar", "["], ["View", "Side panel", "]"], ["View", "Back to all songs", "Esc"]];
  const GROUP = { File: "Library", Edit: "Editing", Library: "Library", Song: "Editing", Track: "Editing", Setlist: "Setlist", View: "View", Customize: "View", Window: "View", Help: "Help", "set.Line": "Help" };
  function sheet() {
    if ($("sheet10")) { $("sheet10").remove(); return; }
    const rows = [...PAGE_KEYS.map(([g, l, k]) => ({ g, l, k }))];
    for (const x of SLMenus.flat()) if (x.keyText) rows.push({ g: /^(play|tab|next|prev)/i.test(x.id) ? "Playback" : GROUP[x.path[0]] || "Editing", l: (x.path.length > 1 ? x.path.slice(1).join(" › ") + " › " : "") + x.label, k: x.keyText });
    const seen = new Set(), R = rows.filter((r) => { const k = r.l + r.k; if (seen.has(k)) return false; seen.add(k); return true; });
    const bg = document.createElement("div"); bg.id = "sheet10"; bg.className = "pal10";
    bg.innerHTML = `<div class="pbox10 sheet10" role="dialog" aria-label="Keyboard shortcuts"><div class="pin10"><b>Keyboard shortcuts</b><input placeholder="Search shortcuts…" spellcheck="false"><kbd>esc</kbd></div><div class="sres10"></div></div>`;
    document.body.appendChild(bg);
    const inp = bg.querySelector("input"), res = bg.querySelector(".sres10");
    const draw = () => { const q = inp.value.trim(); const G = ["Playback", "Editing", "View", "Setlist", "Library", "Help"];
      res.innerHTML = G.map((g) => { const L = R.filter((r) => r.g === g && (!q || score(q, r.l + " " + r.k))); return L.length ? `<div class="sg10"><h4>${g}</h4>${L.map((r) => `<div class="sr10"><span>${escH(r.l)}</span><kbd>${escH(r.k)}</kbd></div>`).join("")}</div>` : ""; }).join("") || `<div class="pe10">No shortcut matches</div>`; };
    inp.oninput = draw; inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape" || ((MAC ? e.metaKey : e.ctrlKey) && e.key === "/")) { e.preventDefault(); bg.remove(); } };
    bg.onpointerdown = (e) => { if (e.target === bg) bg.remove(); };
    draw(); inp.focus();
  }
  // Esc / ⌘K / ⌘/ outside a text field (the menus' key dispatcher also runs ⌘K and ⌘/)
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("sheet10") && !editing(e.target)) { e.preventDefault(); $("sheet10").remove(); } }, true);

  // ================================================================ 5. first run and empty places
  const QS = () => [
    { id: "audio", t: "Pick your audio interface", d: typeof OUTS !== "undefined" && OUTS.device ? `${OUTS.device} · found automatically` : "Choose the interface the show plays through", done: typeof OUTS !== "undefined" && !!OUTS.device, b: "Audio settings", go: () => openSettings("audio") },
    { id: "songs", t: "Bring in your songs", d: "Import an Ableton project, or drop audio files here", done: songs.length > 0, b: "Import Ableton…", go: () => SLMenus.run("m:importAbleton"), pri: true },
    { id: "click", t: "Check the click and cues", d: "Play one song and listen; adjust the click in its lanes", done: !!store.get("qsPlayed", false), b: "Show me", go: () => { const s = songs[0]; if (s) { openSong(s.id); note("Press Space to play “" + s.name + "” and listen to the click and cues"); } else note("Bring in a song first"); } },
    { id: "set", t: "Build a setlist", d: "Drag songs into the setlist on the left, then add breaks", done: (typeof setlists !== "undefined" ? setlists : []).some((l) => (l.order || []).some((id) => songs.some((x) => x.id === id))), b: "Show me", go: () => { if (typeof setPanel === "function") setPanel("L", true); const el = $("songs"); if (el) { el.classList.add("flash10"); setTimeout(() => el.classList.remove("flash10"), 1600); } note("Drag a card onto the setlist on the left, or right-click a song › Add to setlist"); } },
    { id: "band", t: "Connect the band's screens", d: "Scan the QR code with the drummer's iPad", done: typeof BDEVS !== "undefined" && BDEVS.length > 0, b: "Show QR", go: () => { const a = document.querySelector('.tabs a[data-tab="band"]'); if (a) a.click(); } },
  ];
  // the first Play ticks "Check the click and cues"
  const TG = window.toggle; if (TG) window.toggle = function () { const r = TG.apply(this, arguments); if (typeof playing !== "undefined" && playing) store.set("qsPlayed", true); return r; };
  function qsHTML(inSheet) {
    const L = QS(), n = L.filter((x) => x.done).length;
    return `<div class="qs10 ${inSheet ? "insheet" : ""}"><div class="qsh10"><img src="brand/setline-wordmark-dark-bg.svg" alt="set.Line" draggable="false"><p>Let’s get your show ready. 5 steps, about 10 minutes.${n ? ` <b>${n} of 5 done.</b>` : ""}</p></div>
      ${L.map((x) => `<div class="qsr10 ${x.done ? "done" : ""}" data-q="${x.id}"><span class="qsc10" aria-hidden="true">${x.done ? "✓" : ""}</span><div><b>${escH(x.t)}</b><small>${escH(x.d)}</small></div><button class="btn ${x.pri && !x.done ? "pri" : "line"}">${escH(x.b)}</button></div>`).join("")}
      <div class="qsdrop10">⇣ Drop an Ableton project (.als) or audio files anywhere on this window</div>
      <div class="qsf10"><button class="btn line qshide10">Hide</button><span class="faint">Help › Quick start shows this again</span></div></div>`;
  }
  function wireQS(root, closeFn) {
    root.querySelectorAll(".qsr10").forEach((r) => { const x = QS().find((q) => q.id === r.dataset.q); r.querySelector("button").onclick = (e) => { e.stopPropagation(); if (closeFn) closeFn(); x.go(); }; });
    const h = root.querySelector(".qshide10"); if (h) h.onclick = () => { store.set("qsHidden", true); if (closeFn) closeFn(); emptyStates(true); };
  }
  function quickStart() {
    store.set("qsHidden", false);
    if (!songs.length) { emptyStates(true); return; }
    const bg = document.createElement("div"); bg.className = "cfbg"; bg.innerHTML = `<div class="cfbox qsbox10">${qsHTML(true)}</div>`;
    document.body.appendChild(bg); const close = () => bg.remove();
    bg.onclick = (e) => { if (e.target === bg) close(); }; wireQS(bg, close);
    const key = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", key, true); } }; document.addEventListener("keydown", key, true);
  }
  let qsKey = "";
  function emptyStates(force) {
    const sc = $("scroller"); if (!sc) return;
    // an empty library: the checklist in the middle (until hidden)
    const empty = !songs.length && !store.get("qsHidden", false) && !showing();
    let q = $("qs10");
    if (empty) {
      const key = QS().map((x) => x.done).join();
      if (!q || force || key !== qsKey) { if (q) q.remove(); q = document.createElement("div"); q.id = "qs10"; q.innerHTML = qsHTML(false); sc.parentElement.insertBefore(q, sc); wireQS(q, null); qsKey = key; }
      sc.classList.add("qs10on");
    } else { if (q) q.remove(); sc.classList.remove("qs10on"); }
    // an empty setlist: what goes there, and the one click to fill it
    const box = $("songs");
    if (box && typeof setOrder !== "undefined" && !setOrder.length && !box.querySelector(".brk9") && !box.querySelector(".es10")) {
      box.innerHTML = `<div class="es10"><p>${songs.length ? "Drag songs here from the cards" : "Songs you add show up in the middle; drag them here"}</p>${songs.length ? `<button class="btn line" id="es10Add">＋ Add song</button>` : ""}</div>`;
      const b = $("es10Add"); if (b) b.onclick = () => { const a = $("addSong9"); if (a) a.click(); else SLMenus.run("m:addSongToSet"); };
    }
  }
  setInterval(() => { if (!document.hidden && !songs.length) emptyStates(); }, 1500);

  // ================================================================ the search pill in the top bar
  function pill() {
    if ($("srch10")) return;
    const tabs = document.querySelector("header.top .tabs"); if (!tabs) return;
    tabs.insertAdjacentHTML("afterend", `<button id="srch10" class="srch10" title="Search or do anything  ${CMD}K"><span aria-hidden="true">⌕</span><span class="st10">Search…</span><kbd>${CMD}K</kbd></button>`);
    $("srch10").onclick = () => palette();
  }

  function init() { pill(); watch(); decorate(); fixTitles(); syncBar(); emptyStates(); }
  init(); setTimeout(init, 300);
  const RS = window.renderSetlist; window.renderSetlist = function () { const r = RS.apply(this, arguments); watch(); decorate(); emptyStates(); return r; };
  window.SLix = { palette, sheet, quickStart, note, entries, score, syncBar, barSpec, decorate, emptyStates, QS };
})();
