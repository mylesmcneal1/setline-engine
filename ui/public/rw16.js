// set.Line 16: the Remote page's screen editor (docs/phase16.md; mockups docs/design/phase16/rw.png, rw2.png). It replaces
// 15's rm15.js and keeps what 15 added (WYSIWYG canvas, a grid per screen, devices, safe areas, styles, phone stacking).
// §1 The widget library (left): search, category tabs, a 2-column grid of LIVE miniatures (drawn by the device's own
//    renderer, SLBand.render: the song when one is loaded, sample data otherwise). Hover a tile (or focus it with the
//    keyboard) for a big preview with the widget's styles, over the library, never over the canvas: pick a style, then
//    drag. Dragging in shows a ghost outline at the drop place, snapping already applied. Double-click or ↩ adds it at
//    the first free spot.
// §2 Placement: Align to Screen | Selection (Screen with one widget, Selection with several, until you choose);
//    left / Centre / right, top / Middle / bottom, distribute across / down, same size. Centre with several widgets
//    and Screen moves them as one block. Smart guides while dragging or resizing: pink lines that snap to the screen's
//    centre, its edges (the safe area), other widgets' edges and centres and equal spacing, with a "Centred" badge.
//    ⌘ / Ctrl-drag ignores all snapping. The grid off = free placement, the guides still snap. x / y / w / h (grid
//    units with Snap on, points without), lock position, arrow keys nudge (⇧: a bigger step). Edit › Arrange has the
//    commands with their keys (Key Commands).
// §3 The inspector (right): layout (x / y / w / h, padding, corner radius, content position, lock), the widget's styles
//    as chips, text (Auto-fit / Fixed size, weight, label, font), colours (background, text, accent, section colour,
//    border, shadow, opacity). Every control works on a multi-selection ("—" for mixed values). One undo step per change.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const B = () => window.SLBand;
  const MAC = /Mac/.test(navigator.platform);
  let SEL = new Set(); // the selected widgets' ids (BWID: the first, for older code)
  let CB = null; // copied widgets
  let K = 1; // the canvas's scale (device px -> screen px)
  let ALTO = null; // Align to: null = automatic (Screen for one widget, Selection for several) | {mode, many}
  let TAB = "widgets", TABF = false, CAT = "all", FIND = ""; // (TABF: Screens shown only because there was no screen)
  const LIBV = {}; // the style picked in the library's preview, per widget type
  const scr = () => (typeof curScreen === "function" ? curScreen() : null);
  const listOf = (sc) => sc[BORI] || (sc[BORI] = []);
  const selList = (sc) => listOf(sc).filter((w) => SEL.has(w.id));
  const sync = () => { BWID = SEL.size ? [...SEL][0] : null; };
  const changed = () => { if (typeof bandChanged === "function") bandChanged(); };
  const G = (sc) => B().gridOf(sc);
  const setGrid = (sc, o) => { sc.grid = { ...G(sc), ...o }; };
  const DEVK = () => Object.keys(B().DEVICES);
  const devName = (sc) => B().deviceOf(sc).name.replace("…", "");
  const nameOf = (t) => (B().WIDGETS[t] || { name: t }).name;
  const isCmd = (e) => (MAC ? e.metaKey : e.ctrlKey);

  // ---------------------------------------------------------------- the data shown (live song or the sample)
  function data() {
    const L = typeof curSetObj === "function" ? curSetObj() : null, live = typeof bandLive === "function" ? bandLive() : null;
    if (live && live.cur && L && (L.order || []).length) {
      const show = bandShow(); const st = { ...live, playing: !!playing };
      const p = playId === live.cur ? pos : (window.SL12 && SL12.insert ? SL12.insert(songs.find((x) => x.id === live.cur)) || 0 : 0);
      return { show, st, pos: p, sample: false };
    }
    const show = B().sampleShow(), st = B().sampleState(); const s = show.songs.s3, t = (performance.now() / 1000) % 60 + s.secs[1].t0;
    return { show, st, pos: t, sample: true };
  }
  function envOf(D, r, extra) {
    const song = D.show && D.st.cur ? D.show.songs[D.st.cur] : null, L = B();
    return { show: D.show, st: D.st, pos: D.pos, song, bb: song ? L.barBeatAt(song, D.pos) : null, sec: song ? L.sectionAt(song, D.pos) : null, nsec: song ? L.nextSection(song, D.pos) : null, r, now: Date.now(), connected: true, rtt: 12, statuses: [], myStatus: {}, checklist: {}, acks: {}, editor: true, ...(extra || {}) };
  }

  // ---------------------------------------------------------------- §1 the library: categories, descriptions
  const CATS = [["all", "All"], ["song", "Song"], ["time", "Time"], ["controls", "Controls"], ["setlist", "Setlist"]];
  const CATOF = { song: "song", nextSec: "song", timeline: "song", notes: "song", cueFeed: "song", changes: "song", countIn: "song", patch: "song", label: "song", field: "song setlist",
    bpm: "time", beats: "time", clock: "time", songLeft: "time", setLeft: "time setlist", barsLeft: "time", curfew: "time setlist", until: "time setlist",
    playStop: "controls", syncMidi: "controls", nextSong: "controls setlist", prevSong: "controls setlist", soundcheck: "controls", exitLoop: "controls", vamp: "controls", sections: "controls song", verFlip: "controls setlist", midiBtn: "controls", status: "controls", checklist: "controls", statusShow: "controls", conn: "controls",
    setlist: "setlist", next: "setlist song" };
  const DESC = { song: "The song playing: its name, where you are in the set, the section and bar.", bpm: "Tempo and time signature, big.", next: "The next song in the set, and how it follows.", timeline: "The song's sections in a row, the current one lit, with progress.",
    barsLeft: "Bars to the end of this section.", beats: "One light per beat, the downbeat in orange.", nextSec: "The next section and how many bars until it.", countIn: "1 2 3 4 over the whole screen while a count-in plays.", changes: "Tempo and meter changes coming up.",
    songLeft: "Time left in the song, with a progress bar.", setLeft: "Time left in the set (talking between songs not counted).", clock: "The time of day.", curfew: "Over or under the setlist's finish time.", field: "One song field (tuning, capo, notes…) for this or the next song.",
    until: "Time until a field changes (e.g. the next tuning change).", setlist: "The whole setlist, the current song lit.", notes: "Notes for one player, per section.", cueFeed: "Shows the spoken cue as it plays. Uses section colours.", patch: "The current patch of a MIDI track.",
    label: "Your own text.", status: "Buttons to tell the room: Ready, Need 30 s, Problem.", statusShow: "Everyone's status.", checklist: "A per-song checklist (resets each song).", conn: "Is this device connected (and how fast).",
    playStop: "Play and stop the set. Hold to stop makes a tap do nothing.", nextSong: "Skip to the next song.", prevSong: "Back to the previous song.", soundcheck: "Play one song for a soundcheck.", exitLoop: "Leave a looping section.", vamp: "Loop this section until released.",
    sections: "Tap a section to jump there (at the end of the bar).", verFlip: "Switch the next song's version.", midiBtn: "Send your own MIDI messages.", syncMidi: "Send every song's MIDI set-up again." };
  const inCat = (t) => CAT === "all" || (CATOF[t] || "").split(" ").includes(CAT);
  const libTypes = () => Object.keys(B().WIDGETS).filter((t) => inCat(t) && (!FIND || (nameOf(t) + " " + (DESC[t] || "")).toLowerCase().includes(FIND.toLowerCase())));
  // a widget's natural size (px) on an iPad in landscape: what the miniatures are drawn at, then scaled
  const NAT = { cw: 1024 / 12, ch: (768 - 44) / 9 };
  const natOf = (t) => { const d = B().WIDGETS[t] || { w: 3, h: 2 }; return { w: d.w * NAT.cw, h: d.h * NAT.ch }; };
  // a box that draws a widget at its natural size, scaled into w x h
  function miniHTML(t, v, w, h, cls = "") { const n = natOf(t), k = Math.min(w / n.w, h / n.h); return `<div class="rwmini slw ${cls}" style="width:${w}px;height:${h}px"><div class="rwnat" data-t="${t}" data-v="${v || ""}" style="width:${n.w}px;height:${n.h}px;transform:translate(${((w - n.w * k) / 2).toFixed(1)}px,${((h - n.h * k) / 2).toFixed(1)}px) scale(${k.toFixed(4)})"><div class="s5wi"></div></div></div>`; }
  function drawMinis(root, D) {
    (root || document).querySelectorAll(".rwnat").forEach((el) => { const t = el.dataset.t, box = el.firstElementChild, n = natOf(t);
      const w = { id: "lib_" + t, type: t, v: el.dataset.v || undefined, cfg: {}, st: {} }, r = { width: n.w - 6, height: n.h - 6 };
      box.setAttribute("style", B().boxStyle(w) + ";position:absolute;left:3px;top:3px;width:" + r.width + "px;height:" + r.height + "px");
      const out = B().render(w, envOf(D, r)); if (box.dataset.k !== out.html) { box.dataset.k = out.html; box.innerHTML = out.html; box.classList.toggle("top", !!out.top); } });
  }

  // ---------------------------------------------------------------- the page
  const ICON = { al: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="4" width="9" height="3" rx="1" fill="currentColor"/><rect x="4" y="9" width="6" height="3" rx="1" fill="currentColor"/></svg>',
    ac: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1v14" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="4" width="10" height="3" rx="1" fill="currentColor"/><rect x="5" y="9" width="6" height="3" rx="1" fill="currentColor"/></svg>',
    ar: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M14 2v12" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="4" width="9" height="3" rx="1" fill="currentColor"/><rect x="6" y="9" width="6" height="3" rx="1" fill="currentColor"/></svg>',
    at: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="4" width="3" height="9" rx="1" fill="currentColor"/><rect x="9" y="4" width="3" height="6" rx="1" fill="currentColor"/></svg>',
    am: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1 8h14" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="5" width="3" height="6" rx="1" fill="currentColor"/></svg>',
    ab: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 14h12" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="9" y="6" width="3" height="6" rx="1" fill="currentColor"/></svg>',
    dh: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="4" width="3" height="8" rx="1" fill="currentColor"/><rect x="6.5" y="4" width="3" height="8" rx="1" fill="currentColor"/><rect x="12" y="4" width="3" height="8" rx="1" fill="currentColor"/></svg>',
    dv: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="4" y="1" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="6.5" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="12" width="8" height="3" rx="1" fill="currentColor"/></svg>',
    ss: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="4" width="6" height="8" rx="1" fill="currentColor"/><rect x="9" y="4" width="6" height="8" rx="1" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
    unlock: '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5-.5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>' };
  // [key, name, menu id (Edit › Arrange: the key shown)]
  const ALIGN = [["al", "Align left", "arrLeft"], ["ac", "Centre", "arrCentre"], ["ar", "Align right", "arrRight"], ["at", "Align top", "arrTop"], ["am", "Middle", "arrMiddle"], ["ab", "Align bottom", "arrBottom"], ["dh", "Distribute across", "arrDistH"], ["dv", "Distribute down", "arrDistV"], ["ss", "Make same size", "arrSame"]];
  const step = (id, v, lab, unit = "") => `<span class="rm15st" data-k="${id}"><b>${lab}</b><button data-d="-1" aria-label="${lab || id} smaller">−</button><input type="number" value="${v}" aria-label="${lab || id}"><button data-d="1" aria-label="${lab || id} bigger">+</button>${unit ? `<em>${unit}</em>` : ""}</span>`;
  const tog = (id, on, lab) => `<button class="rm15tg ${on ? "on" : ""}" data-t="${id}" aria-pressed="${on}"><b>${lab}</b><i></i></button>`;
  const alignMode = () => { const many = SEL.size > 1; if (ALTO && ALTO.many === many) return ALTO.mode; ALTO = null; return many ? "sel" : "screen"; };
  const can = (k) => { const n = selList(scr() || { land: [], port: [] }).filter((w) => !w.lock).length, scrn = alignMode() === "screen";
    if (k === "ss") return n >= 2; if (k[0] === "d") return scrn ? n >= 2 : n >= 3; return scrn ? n >= 1 : n >= 2; };
  // the keys the menu shows (Key Commands can change them): read once a second at most (building the menus isn't free)
  let KEYS = null, KEYAT = 0;
  const keyOf = (id) => { const t = performance.now(); if (!KEYS || t - KEYAT > 1000) { KEYAT = t; KEYS = {}; try { if (window.SLMenus) for (const x of SLMenus.flat()) if (/^arr/.test(x.id) && x.keyText) KEYS[x.id] = x.keyText; } catch (e) {} } return KEYS[id] || ""; };

  let CSSIN = false;
  function render() {
    const el = $("bandV"); if (!el || !bandOn || !B()) return;
    if (!CSSIN) { CSSIN = true; const st = document.createElement("style"); st.id = "slw15"; st.textContent = B().CSS; document.head.appendChild(st); }
    const sc = scr(); if (sc && !sc[BORI]) sc[BORI] = [];
    for (const id of [...SEL]) if (!sc || !listOf(sc).some((w) => w.id === id)) SEL.delete(id); sync();
    if (!sc) { if (TAB !== "screens") TABF = true; TAB = "screens"; } else if (TABF) { TABF = false; TAB = "widgets"; }
    const keepLib = el.querySelector("#rwLeft") && el.dataset.tab === TAB && TAB === "widgets" && el.dataset.has === String(!!sc);
    if (!keepLib) { el.innerHTML = `<div class="bl rwl" id="rwLeft"></div><div class="bm rm15m" id="rwMid"></div><div class="br rm15r" id="rwRight"></div>`; el.dataset.tab = TAB; el.dataset.has = String(!!sc); renderLeft(sc); }
    renderMid(sc); renderRight(sc);
    wire(sc); fitCanvas(); paint(true);
  }
  // ---- left: Widgets (the library) | Screens
  function renderLeft(sc) {
    const box = $("rwLeft"); if (!box) return;
    const tabs = `<div class="segm rwtabs">${[["widgets", "Widgets"], ["screens", "Screens"]].map(([k, n]) => `<button data-tab="${k}" class="${TAB === k ? "on" : ""}" ${k === "widgets" && !sc ? "disabled" : ""}>${n}</button>`).join("")}</div>`;
    if (TAB === "widgets" && sc) {
      box.innerHTML = tabs + `<div class="rm15lib rwlib"><input id="rwFind" class="rwfind" placeholder="⌕ Search widgets" value="${esc(FIND)}" aria-label="Search widgets">
        <div class="rwcats" role="tablist">${CATS.map(([k, n]) => `<button role="tab" data-cat="${k}" class="${CAT === k ? "on" : ""}" aria-selected="${CAT === k}">${n}</button>`).join("")}</div>
        <div class="rwhint">Drag onto the screen · hover to preview</div><div class="rwtiles" id="rwTiles">${tilesHTML()}</div></div>`;
      drawMinis(box, data()); return;
    }
    const info = BINFO, ip = info && info.addresses && info.addresses[0], url = ip ? `http://${ip}:${info.port}/` : "", qr = url ? B().qrSVG(url) : "";
    box.innerHTML = tabs + `<div class="blh"><b>Screens</b><button class="ibtn" id="bAdd" title="Add a screen">＋</button></div>
      ${BAND.screens.map((x) => `<div class="bscr ${x.id === BSEL ? "on" : ""}" data-id="${x.id}"><span class="bav" style="background:${x.col}">${esc(x.name.slice(0, 2).toUpperCase())}</span><span class="bt"><b>${esc(x.name)}</b><small>${esc(devName(x))}</small></span><i class="bdot ${BONLINE[x.id] ? "on" : ""}" title="${BONLINE[x.id] ? "Connected" : "Not connected"}"></i></div>`).join("") || '<p class="faint" style="font-size:12px;padding:6px 8px">No screens yet. ＋ adds one; a device that joins can also make one.</p>'}
      <div class="bjoin">${qr ? `<div class="bqr">${qr}</div>` : ""}<div class="bip">${esc(url || "No network")}</div><div class="faint" style="font-size:11px">${info && info.mdns === "setline.local" ? `or <b>http://setline.local:${info.port}/</b>` : "Scan the code or type the address"}${info && !info.running ? ' · <span style="color:var(--amber)">the server is off (Settings › Remote)</span>' : ""}</div>
        <p class="faint" style="font-size:11px;margin:6px 0 0">On the phone: Share › Add to Home Screen opens it full screen.</p>
        <label class="faint" style="font-size:11px;display:block;margin-top:8px">Remote network <input id="bNet" value="${esc(BAND.network || "")}" placeholder="name (just a label)" style="width:100%;margin-top:3px"></label></div>
      ${BDEVS.length ? `<div class="bfields"><span class="faint">Connected devices</span>${BDEVS.map((d) => `<div class="clkrow" style="margin-top:4px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(d.device || "")}">${esc(d.address)}</span><select data-dev="${d.id}" title="Which screen this device shows"><option value="">(asks)</option>${BAND.screens.map((x) => `<option value="${x.id}" ${x.id === d.screen ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>`).join("")}</div>` : ""}
      <div class="bfields"><span class="faint">Song fields:</span> ${FIELDS.length ? FIELDS.map((f) => esc(f.name)).join(", ") : "none"}<div style="display:flex;gap:6px;margin-top:6px"><button class="btn line" id="bFields">Edit song fields…</button><button class="btn line" id="bTable">Table…</button></div></div>`;
  }
  const TW = 100, TH = 60; // a tile's miniature
  function tilesHTML() { const ts = libTypes(); return ts.map((t) => `<div class="rwt bwl" tabindex="0" data-add="${t}" role="button" aria-label="${esc(nameOf(t))}: drag onto the screen, or press Return to add" title="${esc(nameOf(t))}">${miniHTML(t, LIBV[t], TW, TH)}<span>${esc(nameOf(t))}</span></div>`).join("") || `<p class="faint rwnone">No widget matches “${esc(FIND)}”.</p>`; }
  // ---- middle: the toolbars and the canvas
  function renderMid(sc) {
    const box = $("rwMid"); if (!box) return;
    if (!sc) { box.className = "bm"; box.innerHTML = `<div class="bempty"><div class="bei">${IC.add}</div><b>Add a screen to start</b><p>A screen is what one phone or tablet shows: the song, its sections, a countdown, notes for one player, buttons. Design one for each player.</p><button class="btn pri" id="bAdd2">＋ Add a screen</button></div>`; return; }
    box.className = "bm rm15m";
    const g = G(sc), d = B().deviceOf(sc), cs = B().canvasSize(sc, BORI), ns = SEL.size, others = BAND.screens.filter((x) => x !== sc && ((x.land || []).length || (x.port || []).length)), mode = alignMode();
    const ab = (k) => { const a = ALIGN.find((x) => x[0] === k), ky = keyOf(a[2]), lab = k === "ac" ? "Centre" : k === "am" ? "Middle" : ""; return `<button class="ibtn rwab ${lab ? "lab" : ""}" data-al="${k}" title="${a[1]}${mode === "screen" ? " (to the screen)" : " (to the selection)"}${ky ? " · " + ky : ""}" aria-label="${a[1]}" ${can(k) ? "" : "disabled"}>${ICON[k]}${lab ? `<span>${lab}</span>` : ""}</button>`; };
    box.innerHTML = `<div class="rm15bar">
        <input id="bName" value="${esc(sc.name)}" aria-label="Screen name" class="rm15name">
        <button class="btn line" id="rmDev" title="The device this screen is made for: ${cs.w} × ${cs.h}">${esc(devName(sc))} ▾</button>
        ${segm("bOri", [["land", "Landscape"], ["port", "Portrait"]], BORI)}
        <button class="btn line" id="rmCopy" ${others.length ? "" : "disabled"} title="Start from another screen's layout">Copy layout ▾</button>
        <button class="btn line" id="bPreset">Preset ▾</button>
        <button class="btn line" id="bCol" title="This screen's colour (in the list and on the device's picker)"><i class="rm15sw" style="background:${esc(sc.col)}"></i>Colour</button>
        <span style="flex:1"></span><button class="btn line danger" id="bDel" title="Delete this screen">Delete</button></div>
      <div class="rm15bar rwbar2"><div class="segm rwto" id="rwTo" title="What Align, Centre and Middle line up with">${[["screen", "Screen"], ["sel", "Selection"]].map(([k, n]) => `<button data-v="${k}" class="${mode === k ? "on" : ""}">${n}</button>`).join("")}</div>
        <span class="rm15al">${ab("al")}${ab("ac")}${ab("ar")}</span><span class="rm15al">${ab("at")}${ab("am")}${ab("ab")}</span><span class="rm15al">${ab("dh")}${ab("dv")}${ab("ss")}</span>
        <span style="flex:1"></span><button class="btn line rwgridb" id="rwGrid" title="The grid: columns, rows, gap, Snap and Guides">${g.cols}×${g.rows}${g.snap ? "" : " · free"} ▾</button></div>
      <div class="rm15wrap" id="rmWrap"><div class="rm15frame ${d.phone ? "phone" : ""}" id="rmFrame"><div class="rm15dev slw" id="bCanv" data-ori="${BORI}" style="width:${cs.w}px;height:${cs.h}px">
        <div class="rm15grid ${g.snap ? "" : "off"}" style="background-size:${cs.w / g.cols}px ${(cs.h - safeT(sc) - safeB(sc)) / g.rows}px;top:${safeT(sc)}px;bottom:${safeB(sc)}px"></div>
        ${safeT(sc) ? `<div class="rm15safe t" style="height:${safeT(sc)}px"><span>${d.phone ? "status bar" : ""}</span></div>` : ""}${safeB(sc) ? `<div class="rm15safe b" style="height:${safeB(sc)}px"></div>` : ""}
        <div class="rm15area" id="rmArea" style="top:${safeT(sc)}px;bottom:${safeB(sc)}px">${listOf(sc).map((w) => `<div class="s5w ${SEL.has(w.id) ? "sel" : ""} ${w.lock ? "locked" : ""}" data-w="${w.id}" style="${B().place(w, g)}"><div class="s5wi" style="${B().boxStyle(w)}"></div>${SEL.has(w.id) && ns === 1 && !w.lock ? HANDLES : ""}${w.lock ? `<i class="rwlk" title="Position locked">${ICON.lock}</i>` : ""}<button class="rm15more" title="Style and more" aria-label="Widget options">⋯</button></div>`).join("")}</div>
      </div></div></div>
      <p class="faint rm15hint">${data().sample ? "Sample song shown (no song loaded). " : ""}<b class="rwpink">Pink lines</b> = screen centre · snaps to centre, edges, other widgets and equal spacing · ${MAC ? "⌘" : "Ctrl"}-drag ignores snapping. ${listOf(sc).some((w) => (B().WIDGETS[w.type] || {}).cmd) ? "This screen can do what its buttons do, nothing else." : "No buttons: this screen can only watch."}</p>`;
  }
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((h) => `<i class="rwh rwh-${h}" data-h="${h}"></i>`).join("");
  const safeT = (sc) => { const d = B().deviceOf(sc); return BORI === "port" ? d.safe.top : d.phone ? 0 : d.safe.top; };
  const safeB = (sc) => { const d = B().deviceOf(sc); return BORI === "port" ? d.safe.bottom : d.phone ? 21 : d.safe.bottom; };

  // ---- right: §3 the inspector
  const same = (list, f) => { const v = list.map(f), a = JSON.stringify(v[0]); return v.every((x) => JSON.stringify(x) === a) ? v[0] : undefined; };
  const seg = (k, opts, cur) => `<div class="segm rwseg" data-s="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${cur !== undefined && String(cur) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const slider = (k, v, min, max, lab) => `<div class="rwsl" data-r="${k}"><span>${lab}</span><input type="range" min="${min}" max="${max}" step="1" value="${v === undefined ? Math.round((min + max) / 2) : v}" class="${v === undefined ? "mixed" : ""}" aria-label="${lab}"><input type="number" min="${min}" max="${max}" value="${v === undefined ? "" : v}" placeholder="—" aria-label="${lab} value"></div>`;
  const dot = (k, c, title) => `<button class="rwdot ${c ? "" : "mixed"}" data-c="${k}" title="${title}" aria-label="${title}" style="background:${c || "transparent"}">${c ? "" : "—"}</button>`;
  function renderRight(sc) {
    const box = $("rwRight"); if (!box) return;
    if (!sc) { box.className = "br rm15r dim"; box.innerHTML = `<div class="rm15insp"><h4>Inspector</h4><p class="faint">Add a screen first.</p></div>`; return; }
    box.className = "br rm15r";
    const sel = selList(sc);
    if (!sel.length) { box.innerHTML = `<div class="rm15insp"><h4>Nothing selected</h4><p class="faint">Click a widget to select it; ⇧-click or drag a box for several. ${MAC ? "⌘A" : "Ctrl+A"} selects them all.</p><p class="faint">Drag widgets in from the library on the left; hover one to see its styles first.</p></div>`; return; }
    const g = G(sc), { cw, ch } = cellsize(sc), S = (f) => same(sel, (w) => f(B().styleOf(w))), types = same(sel, (w) => w.type), one = sel.length === 1, w0 = sel[0];
    const unit = g.snap ? "cells" : "pt", conv = (v, axis) => (g.snap ? +(+v).toFixed(2) : Math.round(v * (axis === "x" ? cw : ch)));
    const num = (k, axis) => { const v = same(sel, (w) => w[k]); return `<label><em>${k.toUpperCase()}</em><input type="number" step="${g.snap ? 1 : 1}" data-xy="${k}" value="${v === undefined ? "" : conv(v, axis)}" placeholder="—" aria-label="${k} (${unit})"></label>`; };
    const lockAll = same(sel, (w) => !!w.lock);
    const variants = types ? B().variantsOf(types) : null, vcur = types ? same(sel, (w) => B().variantOf(w)) : undefined;
    const chipW = 76, chipH = 46;
    const fonts = [["", "Default (Outfit)"], ...B().FONTS.filter((f) => f !== "Outfit").map((f) => [f, f])];
    const fcur = S((s) => s.font || ""), size = S((s) => (s.size === "auto" ? "auto" : "fixed")), fixed = S((s) => (s.size === "auto" ? 48 : +s.size));
    const bgk = S((s) => (s.bg === "solid" || s.bg === "none" ? s.bg : "col")), bgc = S((s) => s.bg);
    const secOn = same(sel, (w) => { const s = B().styleOf(w); return s.sec === undefined || s.sec === null ? ["song", "nextSec", "notes", "timeline", "sections", "cueFeed", "label", "field", "patch", "changes", "until"].includes(w.type) : !!s.sec; });
    const settings = one && typeof bandWidgetSettings === "function" ? bandWidgetSettings(sc, w0).replace(/<div class="brh">[\s\S]*?<\/div>/, "").replace(/<h3>[\s\S]*?<\/h3>/, "").replace(/<button class="rdanger" id="bwDel">[\s\S]*?<\/button>/, "").replace(/<div class="rf ">\s*<span>Size<\/span>[\s\S]*?<\/span><\/div>/, "").replace(/^<div class="br">/, '<div class="rm15set">') : "";
    const al = S((s) => s.al || "mc");
    box.innerHTML = `<div class="rm15insp rwinsp">
      <div class="rwhead"><b>${one ? esc(nameOf(w0.type)) : types ? esc(nameOf(types)) + "s" : "Widgets"}</b><span class="faint">${sel.length} selected</span><button class="ibtn rwlock ${lockAll ? "on" : ""}" id="rwLock" title="${lockAll ? "Unlock position" : "Lock position"} · ${keyOf("arrLock")}" aria-pressed="${!!lockAll}">${lockAll ? ICON.lock : ICON.unlock}</button></div>
      <h5>Layout</h5><div class="rm15xy" title="Position and size in ${unit === "cells" ? "grid cells (Snap is on)" : "points (Snap is off)"}">${num("x", "x")}${num("y", "y")}${num("w", "x")}${num("h", "y")}</div>
      ${slider("pad", S((s) => +s.pad), 0, 40, "Padding")}${slider("rad", S((s) => +s.rad), 0, 40, "Corner radius")}
      <div class="rwrow"><span>Content</span><div class="rm15g3 rwal">${["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"].map((a) => `<button data-a="${a}" class="${al === a ? "on" : ""}" title="${alName(a)}" aria-label="Content ${alName(a)}"><i></i></button>`).join("")}</div></div>
      <h5>Style</h5>${variants ? `<div class="rwchips">${variants.map(([k, n]) => `<button class="rwchip ${vcur === k ? "on" : ""}" data-var="${k}" title="${esc(n)}">${miniHTML(types, k, chipW, chipH)}<span>${esc(n)}</span></button>`).join("")}</div>` : `<p class="faint">Different widgets: pick one kind to choose its style.</p>`}
      <h5>Text</h5>
      <div class="rwrow"><span>Size</span>${seg("size", [["auto", "Auto-fit"], ["fixed", "Fixed"]], size)}</div>
      ${size === "fixed" ? slider("size", fixed, 8, 160, "Fixed size") : ""}
      <div class="rwrow"><span>Weight</span>${seg("wt", [["regular", "Regular"], ["bold", "Bold"], ["heavy", "Heavy"]], S((s) => s.wt || "heavy"))}</div>
      <div class="rwrow"><span>Label</span>${seg("lab", [["hidden", "Hidden"], ["top", "Top"], ["bottom", "Bottom"]], S((s) => s.lab || "top"))}</div>
      <div class="rwrow"><span>Font</span><select id="rwFont" aria-label="Font">${fcur === undefined ? '<option value="" selected>—</option>' : ""}${fonts.map(([k, n]) => `<option value="${esc(k)}" ${fcur === k ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
      <h5>Colours</h5>
      <div class="rwrow"><span>Background</span>${seg("bg", [["solid", "Solid"], ["none", "None"], ["col", `<i class="rm15sw" style="background:${bgk === "col" && bgc ? esc(bgc) : "#0a84ff"}"></i>Colour`]], bgk)}</div>
      ${slider("op", S((s) => (s.bg === "none" ? 0 : +s.op)), 0, 100, "Opacity")}
      <div class="rwrow"><span>Text · Accent</span><span class="rwdots">${dot("fg", S((s) => s.fg || "#f2f2f4"), "Text colour")}${dot("acc", S((s) => s.acc || "#22c3a6"), "Accent colour")}</span></div>
      <div class="rwrow"><span>Use section colour</span>${tog("sec", !!secOn, "")}</div>
      <div class="rwrow"><span>Border · Shadow</span><span>${tog("border", !!S((s) => s.border), "")}${tog("shadow", !!S((s) => s.shadow), "")}</span></div>
      ${settings ? `<h5>What it shows</h5>${settings}` : ""}
      <button class="rdanger" id="rmDelW">Remove ${sel.length > 1 ? sel.length + " widgets" : "widget"}</button></div>`;
  }
  const alName = (a) => `${{ l: "left", c: "centre", r: "right" }[a[1]]} · ${{ t: "top", m: "middle", b: "bottom" }[a[0]]}`;

  // the canvas fits the space under the toolbars (never bigger than the device)
  function fitCanvas() {
    const wrap = $("rmWrap"), dev = $("bCanv"), fr = $("rmFrame"); if (!wrap || !dev || !fr) return;
    const sc = scr(); if (!sc) return; const cs = B().canvasSize(sc, BORI), r = wrap.getBoundingClientRect();
    const availW = Math.max(200, wrap.clientWidth - 24), availH = Math.max(200, innerHeight - r.top - 54);
    K = Math.min(1, availW / cs.w, availH / cs.h);
    dev.style.transform = `scale(${K})`; fr.style.width = cs.w * K + "px"; fr.style.height = cs.h * K + "px";
  }
  addEventListener("resize", () => { if (bandOn) { fitCanvas(); paint(true); } });

  // ---------------------------------------------------------------- draw the widgets (live, 15 times a second)
  const CACHE = new Map(); let lastPaint = 0, lastLib = 0;
  function paint(force) {
    const sc = scr(), area = $("rmArea"); if (!sc || !area || !bandOn) return;
    const D = data();
    for (const w of listOf(sc)) {
      const el = area.querySelector(`.s5w[data-w="${w.id}"] > .s5wi`); if (!el) continue;
      const r = { width: el.clientWidth, height: el.clientHeight };
      const out = B().render(w, envOf(D, r));
      const key = out.html + "|" + r.width + "x" + r.height;
      if (force || CACHE.get(w.id) !== key) { CACHE.set(w.id, key); el.innerHTML = out.html; el.classList.toggle("flush", !!out.flush); el.classList.toggle("top", !!out.top); }
      if (w.type === "timeline") { const song = D.show.songs[D.st.cur], sec = song ? B().sectionAt(song, D.pos) : null; const i = el.querySelector(".s5tlp"); if (i && sec) i.style.setProperty("--p", Math.max(0, Math.min(1, (D.pos - sec.t0) / Math.max(0.001, sec.t1 - sec.t0))).toFixed(3)); }
    }
    const pop = $("rwPop"); if (pop) drawMinis(pop, D);
    const t = performance.now(); if (force || t - lastLib > 1000) { lastLib = t; const tl = $("rwTiles"); if (tl) drawMinis(tl, D); const rr = $("rwRight"); if (rr) drawMinis(rr, D); }
  }
  (function loop() { requestAnimationFrame(loop); const t = performance.now(); if (!bandOn || t - lastPaint < 66 || DRAG) return; lastPaint = t; paint(false); })();

  // ---------------------------------------------------------------- changes (one undo step each)
  const edit = (what, f, noRender) => { const sc = scr(); if (!sc) return; snap(); f(sc); changed(); if (what && typeof toast === "function") toast(what, undo); if (!noRender) render(); };
  const newId = () => "w" + Date.now().toString(36) + Math.floor(Math.random() * 99999).toString(36);
  // the size a new widget comes in at (cells of this screen's grid)
  function sizeFor(sc, type) { const d = B().WIDGETS[type], g = G(sc); if (B().isPhoneScreen(sc)) { const p = B().phoneSize(type); return { w: Math.max(1, Math.round(p[0] * g.cols / 6)), h: Math.min(g.rows, Math.max(1, Math.round(p[1] * g.rows / 14))) }; } return { w: Math.max(1, Math.round(d.w * g.cols / 12)), h: Math.max(1, Math.round(d.h * g.rows / 9)) }; }
  function firstFree(sc, w) { const g = G(sc), list = listOf(sc); const free = (px, py) => !list.some((o) => px < o.x + o.w && px + w.w > o.x && py < o.y + o.h && py + w.h > o.y);
    for (let yy = 0; yy <= g.rows - w.h; yy++) for (let xx = 0; xx <= g.cols - w.w; xx++) if (free(xx, yy)) return { x: xx, y: yy }; return { x: 0, y: 0 }; }
  // addWidget(sc, type): at the first free spot; (x, y): the column under the pointer (centred there); at: {x, y} exact
  function addWidget(sc, type, x, y, v, at) {
    const d = B().WIDGETS[type]; if (!d || !sc) return null; const g = G(sc), list = listOf(sc), sz = sizeFor(sc, type);
    const w = { id: newId(), type, x: 0, y: 0, w: sz.w, h: sz.h, cfg: {} }; if (v && v !== "big") w.v = v;
    if (at) { w.x = at.x; w.y = at.y; if (at.w) w.w = at.w; if (at.h) w.h = at.h; } else if (x !== undefined) { w.x = x - Math.floor(w.w / 2); w.y = y; } else Object.assign(w, firstFree(sc, w));
    B().clamp(w, g, !!at && [w.x, w.y, w.w, w.h].some((n) => n % 1)); snap(); list.push(w); SEL = new Set([w.id]); sync(); changed(); if (typeof toast === "function") toast(`Added “${nameOf(type)}”`, undo); render(); return w;
  }
  window.addWidget = addWidget;
  function delSel() { const sc = scr(); if (!sc || !SEL.size) return; const n = SEL.size; edit(`Removed ${n > 1 ? n + " widgets" : "a widget"} from “${sc.name}”`, (s) => { s[BORI] = listOf(s).filter((w) => !SEL.has(w.id)); SEL.clear(); sync(); }); }
  function dupSel(paste) {
    const sc = scr(); if (!sc) return; const src = paste ? CB : selList(sc); if (!src || !src.length) return; const g = G(sc);
    edit(`${paste ? "Pasted" : "Duplicated"} ${src.length > 1 ? src.length + " widgets" : "a widget"}`, (s) => { const add = src.map((w) => B().clamp({ ...JSON.parse(JSON.stringify(w)), id: newId(), lock: undefined, x: w.x + 1, y: w.y + 1 }, g, [w.x, w.y].some((n) => n % 1))); listOf(s).push(...add); SEL = new Set(add.map((w) => w.id)); sync(); });
  }
  // §2 arrow keys: a cell (⇧: two) with Snap on; a point (⇧: ten) with Snap off; ⌥: a quarter cell
  function nudge(dx, dy, big, fine) { const sc = scr(); if (!sc || !SEL.size) return; const g = G(sc), { cw, ch } = cellsize(sc), L = selList(sc).filter((w) => !w.lock); if (!L.length) { toast("Locked: unlock its position first"); return; }
    const sx = fine ? 0.25 : g.snap ? (big ? 2 : 1) : (big ? 10 : 1) / cw, sy = fine ? 0.25 : g.snap ? (big ? 2 : 1) : (big ? 10 : 1) / ch;
    edit("", () => { L.forEach((w) => { w.x += dx * sx; w.y += dy * sy; B().clamp(w, g, !g.snap || fine || w.x % 1 || w.y % 1); }); }); }
  // §2 align, distribute, same size: to the screen (the group as one block) or to the selection
  function align(k) {
    const sc = scr(); if (!sc || !can(k)) return; const L = selList(sc).filter((w) => !w.lock), g = G(sc), toScreen = alignMode() === "screen";
    const x0 = Math.min(...L.map((w) => w.x)), x1 = Math.max(...L.map((w) => w.x + w.w)), y0 = Math.min(...L.map((w) => w.y)), y1 = Math.max(...L.map((w) => w.y + w.h));
    const name = ALIGN.find((a) => a[0] === k)[1] + (k === "ss" ? "" : toScreen ? " on the screen" : "");
    edit(name, () => {
      if (toScreen && "al ac ar at am ab".includes(k)) { // the group moves as one block
        const dx = k === "al" ? -x0 : k === "ac" ? (g.cols - (x1 - x0)) / 2 - x0 : k === "ar" ? g.cols - x1 : 0, dy = k === "at" ? -y0 : k === "am" ? (g.rows - (y1 - y0)) / 2 - y0 : k === "ab" ? g.rows - y1 : 0;
        L.forEach((w) => { w.x += dx; w.y += dy; });
      } else {
        if (k === "al") L.forEach((w) => (w.x = x0)); if (k === "ar") L.forEach((w) => (w.x = x1 - w.w)); if (k === "ac") L.forEach((w) => (w.x = (x0 + x1) / 2 - w.w / 2));
        if (k === "at") L.forEach((w) => (w.y = y0)); if (k === "ab") L.forEach((w) => (w.y = y1 - w.h)); if (k === "am") L.forEach((w) => (w.y = (y0 + y1) / 2 - w.h / 2));
      }
      const dist = (axis) => { const P = axis === "x" ? ["x", "w", x0, x1, g.cols] : ["y", "h", y0, y1, g.rows], [p, s, a0, a1, n] = P, list = [...L].sort((a, b) => a[p] - b[p]), tot = list.reduce((a, w) => a + w[s], 0);
        if (toScreen) { const gap = (n - tot) / (list.length + 1); let c = gap; list.forEach((w) => { w[p] = c; c += w[s] + gap; }); }
        else { const gap = (a1 - a0 - tot) / (list.length - 1); let c = a0; list.forEach((w) => { w[p] = c; c += w[s] + gap; }); } };
      if (k === "dh") dist("x"); if (k === "dv") dist("y");
      if (k === "ss") { const first = L.find((w) => w.id === [...SEL][0]) || L[0]; L.forEach((w) => { w.w = first.w; w.h = first.h; }); }
      L.forEach((w) => { w.x = Math.round(w.x * 10000) / 10000; w.y = Math.round(w.y * 10000) / 10000; B().clamp(w, g, [w.x, w.y, w.w, w.h].some((v) => v % 1)); });
    });
  }
  function setAlignTo(mode) { ALTO = { mode, many: SEL.size > 1 }; render(); }
  function lockSel(on) { const sc = scr(); if (!sc || !SEL.size) return; const all = selList(sc), v = on === undefined ? !all.every((w) => w.lock) : on; edit(v ? `Locked ${all.length > 1 ? all.length + " widgets" : "the position"}` : "Unlocked", () => all.forEach((w) => { if (v) w.lock = true; else delete w.lock; })); }
  function regrid(sc, o) { const g0 = G(sc), g1 = { ...g0, ...o }; edit(`Grid ${g1.cols} × ${g1.rows}`, (s) => { for (const k of ["land", "port"]) if (s[k]) B().regrid(s[k], g0, g1); setGrid(s, o); }); }
  function copyFrom(sc, src) {
    const phone = B().isPhoneScreen(sc), g = G(sc), go = () => edit(`Copied the layout of “${src.name}”${phone && !B().isPhoneScreen(src) ? " (stacked for the phone)" : ""}`, (s) => {
      const fresh = (w) => ({ ...JSON.parse(JSON.stringify(w)), id: newId() });
      for (const k of ["land", "port"]) { const from = src[k] && src[k].length ? src[k] : src[k === "land" ? "port" : "land"] || [];
        if (phone && !B().isPhoneScreen(src)) { const st = B().stackLayout(from, g.cols); s[k] = st.list.map(fresh); if (st.rows > g.rows) s.grid = { ...g, rows: st.rows }; }
        else { const g0 = B().gridOf(src); s[k] = B().regrid(from.map(fresh), g0, g); } }
      SEL.clear(); sync(); });
    if (listOf(sc).length || (sc.land || []).length || (sc.port || []).length) confirmBox(`Replace “${esc(sc.name)}”’s layout?`, `Both orientations become a copy of “${esc(src.name)}”.`, "Replace", go); else go();
  }
  // a style change on every selected widget
  const setStyle = (what, f, noRender) => edit(what, (s) => { selList(s).forEach((w) => { w.st = { ...(w.st || {}) }; f(w.st, w); }); }, noRender);
  const setVariant = (v) => { const sc = scr(); if (!sc) return; const list = selList(sc); edit(`Style: ${(B().variantsOf(list[0].type).find((x) => x[0] === v) || ["", v])[1]}`, () => list.forEach((w) => { if (B().variantsOf(w.type).some((x) => x[0] === v)) { if (v === "big") delete w.v; else w.v = v; } })); };

  // ---------------------------------------------------------------- 15 §5 the style popover (right-click › Style…)
  function stylePop(at) {
    const sc = scr(), L = sc ? selList(sc) : []; if (!L.length) return;
    const st = B().styleOf(L[0]), title = L.length > 1 ? `${L.length} widgets` : nameOf(L[0].type);
    const bgk = st.bg === "solid" || st.bg === "none" ? st.bg : "col";
    const html = `<div class="rm15sp"><b>${esc(title)} · style</b>
      <h5>Background</h5><div class="segm rm15bg"><button data-bg="solid" class="${bgk === "solid" ? "on" : ""}">Solid</button><button data-bg="none" class="${bgk === "none" ? "on" : ""}">Transparent</button><button data-bg="col" class="${bgk === "col" ? "on" : ""}">${bgk === "col" ? `<i class="rm15sw" style="background:${esc(st.bg)}"></i>` : ""}Colour…</button></div>
      <h5>Align content</h5><div class="rm15alg"><div class="rm15g3">${["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"].map((a) => `<button data-a="${a}" class="${(st.al || "mc") === a ? "on" : ""}" title="${alName(a)}" aria-label="${alName(a)}"><i></i></button>`).join("")}</div><span><b>${alName(st.al || "mc").replace(/^./, (c) => c.toUpperCase())}</b><br>left/centre/right ×<br>top/middle/bottom</span></div>
      <h5>Opacity · <span class="rm15opv">${st.bg === "none" ? 0 : st.op}%</span></h5><input type="range" min="0" max="100" step="5" value="${st.bg === "none" ? 0 : st.op}" class="rm15op">
      <label class="rm15row">Border<button class="tog ${st.border ? "" : "off"}" data-k="border"></button></label>
      <label class="rm15row">Text shadow (for readability)<button class="tog ${st.shadow ? "" : "off"}" data-k="shadow"></button></label>
      <p class="faint">Applies to the selected widgets. More in the inspector on the right.</p></div>`;
    popAt(at, html, (p) => {
      p.classList.add("rm15pop");
      const set = (what, f) => { setStyle(what, f, true); refreshWidgets(); renderRight(scr()); wireRight(scr()); stylePopAgain(at); };
      p.querySelectorAll("[data-bg]").forEach((b) => (b.onclick = (e) => { const v = b.dataset.bg;
        if (v === "col") { swatchPop({ left: e.clientX, right: e.clientX, top: e.clientY }, /^#/.test(st.bg) ? st.bg : "#0a84ff", (c) => set("Widget colour", (s) => { s.bg = c; if (!s.op) s.op = 100; })); return; }
        set(v === "none" ? "Transparent widgets" : "Solid widgets", (s) => { s.bg = v; s.op = v === "none" ? 0 : s.op || 100; }); }));
      p.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => set(`Content: ${alName(b.dataset.a)}`, (s) => { s.al = b.dataset.a === "mc" ? "" : b.dataset.a; })));
      const op = p.querySelector(".rm15op"); op.oninput = () => { p.querySelector(".rm15opv").textContent = op.value + "%"; selList(scr()).forEach((w) => { const s0 = B().styleOf(w); w.st = { ...(w.st || {}), op: +op.value, bg: s0.bg === "none" && +op.value > 0 ? "solid" : s0.bg }; }); refreshWidgets(); };
      op.onpointerdown = () => { snap(); }; op.onchange = () => { changed(); toast(`Opacity ${op.value}%`, undo); };
      p.querySelectorAll(".tog[data-k]").forEach((b) => (b.onclick = () => { const k = b.dataset.k; set(`${k === "border" ? "Border" : "Text shadow"} ${b.classList.contains("off") ? "on" : "off"}`, (s) => { s[k] = !B().styleOf({ st: s })[k]; }); }));
    });
  }
  let SPAT = null; const stylePopAgain = (at) => { SPAT = at; setTimeout(() => stylePop(SPAT), 0); };
  function refreshWidgets() { const sc = scr(), area = $("rmArea"); if (!sc || !area) return; for (const w of listOf(sc)) { const el = area.querySelector(`.s5w[data-w="${w.id}"]`); if (el) { el.firstElementChild.setAttribute("style", B().boxStyle(w)); el.setAttribute("style", B().place(w, G(sc))); } } paint(true); }

  // ---------------------------------------------------------------- §2 smart guides and snapping
  let DRAG = null;
  const local = (e) => { const r = $("bCanv").getBoundingClientRect(), t = safeT(scr()); return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K - t }; };
  function cellsize(sc) { const cs = B().canvasSize(sc, BORI), g = G(sc), ah = cs.h - safeT(sc) - safeB(sc); return { cw: cs.w / g.cols, ch: ah / g.rows, g, aw: cs.w, ah }; }
  // b: the moving box in px {x, y, w, h}; others: px boxes; edges: which edges move ("move": all; or a resize's "e", "s"…)
  // -> {x, y, w, h, lines: [{v|h, at, kind, from, to}], centred: {x, y}}. Within thr px a guide wins over the grid.
  function snapBox(sc, b, others, edges, opt) {
    const { cw, ch, g, aw, ah } = cellsize(sc), thr = 7 / K, guides = g.guides && !opt.free, out = { ...b, lines: [], centred: { x: false, y: false } };
    const axis = (P, S, size, cell, moveA, moveB) => { // P "x"/"y", the box's start and size along that axis
      const lines = [], scr = [[0, "edge"], [size / 2, "centre"], [size, "edge"]];
      const cand = [...scr, ...others.flatMap((o) => [[o[P], "w"], [o[P] + o[S] / 2, "wc"], [o[P] + o[S], "w"]])];
      // equal spacing: the gaps between the other widgets in the same band
      const Q = P === "x" ? "y" : "x", T = S === "w" ? "h" : "w", band = others.filter((o) => o[Q] < b[Q] + b[T] && o[Q] + o[T] > b[Q]).sort((a, c) => a[P] - c[P]);
      const gaps = []; for (let i = 1; i < band.length; i++) { const gp = band[i][P] - (band[i - 1][P] + band[i - 1][S]); if (gp > 0.5) gaps.push(gp); }
      const before = band.filter((o) => o[P] + o[S] <= b[P] + 1).pop(), after = band.find((o) => o[P] >= b[P] + b[S] - 1);
      const best = { d: Infinity }; const tryC = (target, have, what, kind, extra) => { const d = Math.abs(target - have); if (d <= thr && d < best.d) Object.assign(best, { d, target, what, kind, extra }); };
      const start = b[P], end = b[P] + b[S], mid = b[P] + b[S] / 2;
      if (guides) for (const [c, kind] of cand) { if (moveA) tryC(c, start, "start", kind); if (moveB) tryC(c, end, "end", kind); if (moveA && moveB) tryC(c, mid, "mid", kind); }
      if (guides && moveA && moveB) { // equal spacing to the neighbour (a gap that's already used, or centred between two)
        if (before) for (const gp of gaps) tryC(before[P] + before[S] + gp, start, "start", "space", [before[P] + before[S], gp]);
        if (after) for (const gp of gaps) tryC(after[P] - gp, end, "end", "space", [after[P] - gp + 0, gp]);
        if (before && after) { const room = after[P] - (before[P] + before[S]) - b[S]; if (room > 0) tryC(before[P] + before[S] + room / 2, start, "start", "space", [before[P] + before[S], room / 2, true]); } }
      let s0 = start, e0 = end;
      if (best.d <= thr) { // a guide
        if (moveA && moveB) { const shift = best.target - (best.what === "start" ? start : best.what === "end" ? end : mid); s0 += shift; e0 += shift; }
        else if (moveA) s0 = best.target; else e0 = best.target;
        lines.push({ at: best.target, kind: best.kind, extra: best.extra });
      } else if (g.snap && !opt.free) { // the grid
        if (moveA && moveB) { const sh = Math.round(start / cell) * cell - start; s0 += sh; e0 += sh; }
        else if (moveA) s0 = Math.round(start / cell) * cell; else e0 = Math.round(end / cell) * cell;
      }
      if (e0 - s0 < cell * (g.snap && !opt.free ? 1 : 0.25)) { if (moveA) s0 = e0 - cell * (g.snap && !opt.free ? 1 : 0.25); else e0 = s0 + cell * (g.snap && !opt.free ? 1 : 0.25); }
      // everything else that lines up now (drawn, not snapped to)
      if (guides) for (const [c, kind] of cand) for (const v of [s0, (s0 + e0) / 2, e0]) if (Math.abs(c - v) < 0.6 && !lines.some((l) => Math.abs(l.at - c) < 0.6)) lines.push({ at: c, kind });
      return { s: s0, e: e0, lines, centred: Math.abs((s0 + e0) / 2 - size / 2) < 0.6 };
    };
    const mvx = edges === "move", hx = axis("x", "w", aw, cw, mvx || /w/.test(edges), mvx || /e/.test(edges)), hy = axis("y", "h", ah, ch, mvx || /n/.test(edges), mvx || /s/.test(edges));
    if (mvx || /[we]/.test(edges)) { out.x = hx.s; out.w = hx.e - hx.s; out.lines.push(...hx.lines.map((l) => ({ ...l, d: "v" }))); out.centred.x = hx.centred; }
    if (mvx || /[ns]/.test(edges)) { out.y = hy.s; out.h = hy.e - hy.s; out.lines.push(...hy.lines.map((l) => ({ ...l, d: "h" }))); out.centred.y = hy.centred; }
    // stay on the screen
    out.w = Math.min(out.w, aw); out.h = Math.min(out.h, ah); out.x = Math.max(0, Math.min(aw - out.w, out.x)); out.y = Math.max(0, Math.min(ah - out.h, out.y));
    return out;
  }
  function drawGuides(sc, res, box) {
    const area = $("rmArea"); if (!area) return; area.querySelectorAll(".rm15gl, .rwbadge").forEach((x) => x.remove()); if (!res || !G(sc).guides) return;
    const html = [];
    for (const l of res.lines) { const cls = `rm15gl ${l.d} ${l.kind === "centre" ? "c" : l.kind === "space" ? "sp" : ""}`;
      if (l.kind === "space" && l.extra) { const [a, gp] = l.extra, o = l.d === "v" ? `left:${a}px;width:${gp}px;top:${box.y + box.h / 2}px` : `top:${a}px;height:${gp}px;left:${box.x + box.w / 2}px`; html.push(`<i class="rwspace ${l.d}" style="${o}"></i>`); continue; }
      html.push(`<i class="${cls}" data-kind="${l.kind}" style="${l.d === "v" ? "left" : "top"}:${l.at}px"></i>`); }
    if (res.centred.x || res.centred.y) html.push(`<b class="rwbadge" style="left:${box.x + box.w / 2}px;top:${Math.min(box.y + box.h + 6, cellsize(sc).ah - 22)}px">${res.centred.x && res.centred.y ? "Centred · middle" : res.centred.x ? "Centred" : "Middle"}</b>`);
    area.insertAdjacentHTML("beforeend", html.join(""));
  }
  const pxBox = (w, cw, ch) => ({ x: w.x * cw, y: w.y * ch, w: w.w * cw, h: w.h * ch });
  function onDown(e) {
    const sc = scr(); if (!sc || e.button !== 0) return; const area = $("rmArea"); const wEl = e.target.closest(".s5w");
    if (e.target.closest(".rm15more")) return;
    e.preventDefault(); area.focus({ preventScroll: true });
    const { cw, ch, g } = cellsize(sc), p0 = local(e), add = e.shiftKey || isCmd(e);
    if (!wEl) { // empty canvas: a box selection
      if (!e.shiftKey) SEL.clear(); const base = new Set(SEL); DRAG = { box: true, p0 }; const bx = document.createElement("div"); bx.className = "rm15box"; area.appendChild(bx);
      const mv = (m) => { const p = local(m), x0 = Math.min(p0.x, p.x), y0 = Math.min(p0.y, p.y), x1 = Math.max(p0.x, p.x), y1 = Math.max(p0.y, p.y); Object.assign(bx.style, { left: x0 + "px", top: y0 + "px", width: x1 - x0 + "px", height: y1 - y0 + "px" });
        SEL = new Set(base); listOf(sc).forEach((w) => { if (w.x * cw < x1 && (w.x + w.w) * cw > x0 && w.y * ch < y1 && (w.y + w.h) * ch > y0) SEL.add(w.id); }); area.querySelectorAll(".s5w").forEach((el) => el.classList.toggle("sel", SEL.has(el.dataset.w))); };
      const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); DRAG = null; sync(); render(); };
      addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true); return;
    }
    const id = wEl.dataset.w, hd = e.target.dataset && e.target.dataset.h;
    if (e.shiftKey) { SEL.has(id) ? SEL.delete(id) : SEL.add(id); sync(); render(); return; }
    // ⌘-click toggles the widget when the pointer lets go without moving; ⌘-drag moves it with no snapping at all
    const toggleOnUp = add, wasSel = SEL.has(id); if (!SEL.has(id) && !add) { SEL = new Set([id]); sync(); } else if (!SEL.has(id)) SEL.add(id);
    area.querySelectorAll(".s5w").forEach((el) => el.classList.toggle("sel", SEL.has(el.dataset.w)));
    const L = selList(sc), movable = L.filter((w) => !w.lock), orig = movable.map((w) => ({ w, x: w.x, y: w.y, ww: w.w, hh: w.h })), others = listOf(sc).filter((w) => !SEL.has(w.id)).map((o) => pxBox(o, cw, ch));
    let moved = false; DRAG = { id };
    const mv = (m) => { const p = local(m); if (!moved && Math.hypot((p.x - p0.x) * K, (p.y - p0.y) * K) < 4) return;
      if (!orig.length) { if (!moved) { moved = true; toast("Locked: unlock its position to move it"); } return; }
      if (!moved) { moved = true; snap(); }
      const free = isCmd(m), dx = p.x - p0.x, dy = p.y - p0.y;
      let res, box;
      if (hd) { const o = orig[0], b = pxBox({ x: o.x, y: o.y, w: o.ww, h: o.hh }, cw, ch);
        if (/e/.test(hd)) b.w += dx; if (/s/.test(hd)) b.h += dy; if (/w/.test(hd)) { b.x += dx; b.w -= dx; } if (/n/.test(hd)) { b.y += dy; b.h -= dy; }
        res = snapBox(sc, b, others, hd, { free }); o.w.x = res.x / cw; o.w.y = res.y / ch; o.w.w = res.w / cw; o.w.h = res.h / ch; box = res;
      } else { // the group moves together; its bounding box is what snaps
        const gx0 = Math.min(...orig.map((o) => o.x)), gy0 = Math.min(...orig.map((o) => o.y)), gx1 = Math.max(...orig.map((o) => o.x + o.ww)), gy1 = Math.max(...orig.map((o) => o.y + o.hh));
        const b = { x: gx0 * cw + dx, y: gy0 * ch + dy, w: (gx1 - gx0) * cw, h: (gy1 - gy0) * ch };
        res = free ? { ...b, x: Math.max(0, Math.min(cellsize(sc).aw - b.w, b.x)), y: Math.max(0, Math.min(cellsize(sc).ah - b.h, b.y)), lines: [], centred: { x: false, y: false } } : snapBox(sc, b, others, "move", { free });
        const ddx = res.x / cw - gx0, ddy = res.y / ch - gy0; orig.forEach((o) => { o.w.x = o.x + ddx; o.w.y = o.y + ddy; }); box = res; }
      orig.forEach((o) => { const fr = (v) => Math.round(v * 10000) / 10000; o.w.x = fr(o.w.x); o.w.y = fr(o.w.y); o.w.w = fr(o.w.w); o.w.h = fr(o.w.h); B().clamp(o.w, g, [o.w.x, o.w.y, o.w.w, o.w.h].some((v) => v % 1)); });
      orig.forEach((o) => { const el = area.querySelector(`.s5w[data-w="${o.w.id}"]`); if (el) el.setAttribute("style", B().place(o.w, g)); });
      drawGuides(sc, free ? null : res, box); };
    const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); DRAG = null; drawGuides(sc, null);
      if (!moved && toggleOnUp && wasSel) { SEL.delete(id); sync(); }
      if (moved && orig.length) { changed(); toast(hd ? `Resized “${nameOf(L[0].type)}”` : `Moved ${orig.length > 1 ? orig.length + " widgets" : "a widget"}`, undo); } render(); };
    addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true);
  }

  // ---------------------------------------------------------------- §1 dragging in from the library (ghost + snap)
  let LIBDRAG = null;
  function libDown(e, type) {
    if (e.button !== 0) return; const sc = scr(); if (!sc) return; e.preventDefault(); const t0 = { x: e.clientX, y: e.clientY }; let started = false, fly = null, ghost = null, at = null;
    const v = LIBV[type];
    const mv = (m) => {
      if (!started) { if (Math.hypot(m.clientX - t0.x, m.clientY - t0.y) < 5) return; started = true; hidePop(true); LIBDRAG = { type };
        fly = document.createElement("div"); fly.className = "rwfly"; fly.innerHTML = miniHTML(type, v, TW, TH); document.body.appendChild(fly); drawMinis(fly, data()); }
      fly.style.transform = `translate(${m.clientX - TW / 2}px,${m.clientY - TH / 2}px)`;
      const cv = $("bCanv"), area = $("rmArea"); if (!cv || !area) return; const r = cv.getBoundingClientRect(), inside = m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom;
      fly.classList.toggle("over", inside);
      if (!inside) { if (ghost) { ghost.remove(); ghost = null; } drawGuides(sc, null); at = null; return; }
      const { cw, ch, g } = cellsize(sc), sz = sizeFor(sc, type), p = local(m), b = { x: p.x - sz.w * cw / 2, y: p.y - sz.h * ch / 2, w: sz.w * cw, h: sz.h * ch };
      const others = listOf(sc).map((o) => pxBox(o, cw, ch)), res = snapBox(sc, b, others, "move", { free: isCmd(m) });
      at = { x: Math.round(res.x / cw * 1000) / 1000, y: Math.round(res.y / ch * 1000) / 1000 }; if (g.snap && !isCmd(m) && !res.lines.length) { at.x = Math.round(at.x); at.y = Math.round(at.y); }
      if (!ghost) { ghost = document.createElement("div"); ghost.className = "rwghost"; ghost.innerHTML = `<span>${esc(nameOf(type))}</span>`; area.appendChild(ghost); }
      ghost.setAttribute("style", B().place({ x: at.x, y: at.y, w: sz.w, h: sz.h }, g)); ghost.dataset.x = at.x; ghost.dataset.y = at.y;
      drawGuides(sc, isCmd(m) ? null : res, { x: at.x * cw, y: at.y * ch, w: sz.w * cw, h: sz.h * ch });
    };
    const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); removeEventListener("keydown", esc_, true); LIBDRAG = null;
      if (fly) fly.remove(); if (ghost) ghost.remove(); drawGuides(sc, null);
      if (started && at) addWidget(sc, type, undefined, undefined, v, at); };
    const esc_ = (k) => { if (k.key === "Escape") { at = null; up(); k.preventDefault(); k.stopPropagation(); } };
    addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true); addEventListener("keydown", esc_, true);
  }
  // the big preview with the styles (over the library, never over the canvas)
  let POPT = 0, POPFOR = "";
  function showPop(tile, now) {
    clearTimeout(POPT); const type = tile.dataset.add;
    const go = () => { const left = $("rwLeft"); if (!left || !document.body.contains(tile)) return; let pop = $("rwPop"); const lr = left.getBoundingClientRect(), tr = tile.getBoundingClientRect(), pw = lr.width - 16;
      if (!pop) { pop = document.createElement("div"); pop.id = "rwPop"; pop.className = "rwpop"; document.body.appendChild(pop); pop.onmouseenter = () => clearTimeout(POPT); pop.onmouseleave = () => hidePop(); }
      POPFOR = type; const vs = B().variantsOf(type), cur = LIBV[type] || vs[0][0], cwid = Math.floor((pw - 24 - 8 * (vs.length - 1)) / vs.length);
      pop.innerHTML = `<div class="rwph"><b>${esc(nameOf(type))}</b><span class="faint">drag to add</span></div><div class="rwpbig" title="Drag onto the screen">${miniHTML(type, cur, pw - 24, 104)}</div>
        <h5>Styles</h5><div class="rwpv">${vs.map(([k, n]) => `<button class="rwpchip ${k === cur ? "on" : ""}" data-v="${k}" title="${esc(n)}">${miniHTML(type, k, cwid, 40)}<span>${esc(n)}</span></button>`).join("")}</div>
        <p class="rwpd">${esc(DESC[type] || "")}</p>`;
      pop.style.width = pw + "px"; pop.style.left = lr.left + 8 + "px";
      const ph = pop.offsetHeight, top = Math.max(lr.top + 8, Math.min(innerHeight - ph - 8, tr.bottom + 6 + ph > innerHeight ? tr.top - ph - 6 : tr.bottom + 6)); pop.style.top = top + "px";
      drawMinis(pop, data());
      pop.querySelectorAll(".rwpchip").forEach((b) => (b.onclick = () => { LIBV[type] = b.dataset.v; const t = document.querySelector(`.rwt[data-add="${type}"]`); if (t) { t.querySelector(".rwmini").outerHTML = miniHTML(type, LIBV[type], TW, TH); drawMinis(t, data()); } showPop(t || tile, true); }));
      pop.querySelector(".rwpbig").onpointerdown = (e) => libDown(e, type);
    };
    if (now) go(); else POPT = setTimeout(go, 220);
  }
  function hidePop(now) { clearTimeout(POPT); const f = () => { const p = $("rwPop"); if (p) p.remove(); POPFOR = ""; }; if (now) f(); else POPT = setTimeout(f, 180); }

  // ---------------------------------------------------------------- wiring
  function wire(sc) {
    const q = $;
    document.querySelectorAll(".rwtabs [data-tab]").forEach((b) => (b.onclick = () => { TAB = b.dataset.tab; hidePop(true); render(); }));
    if (q("bAdd")) q("bAdd").onclick = () => { addScreen(); SEL.clear(); TAB = "widgets"; render(); }; if (q("bAdd2")) q("bAdd2").onclick = () => { addScreen(); SEL.clear(); TAB = "widgets"; render(); };
    document.querySelectorAll(".bscr").forEach((r) => (r.onclick = () => { BSEL = r.dataset.id; SEL.clear(); sync(); render(); }));
    if (q("bNet")) q("bNet").onchange = (e) => { snap(); BAND.network = e.target.value.trim(); changed(); };
    if (q("bFields")) q("bFields").onclick = () => openSettings("band"); if (q("bTable")) q("bTable").onclick = () => fieldsTable();
    document.querySelectorAll("[data-dev]").forEach((s) => (s.onchange = () => { if (window.SLBandHost) SLBandHost.assign(+s.dataset.dev, s.value || null); }));
    wireLib(sc);
    if (!sc) return;
    q("bName").onchange = (e) => edit("", (s) => { s.name = e.target.value.trim() || s.name; });
    q("bOri").querySelectorAll("button").forEach((b) => (b.onclick = () => { BORI = b.dataset.v; SEL.clear(); sync(); render(); }));
    q("rmDev").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), cur = B().deviceKey(sc.device);
      ctxMenu({ clientX: r.left, clientY: r.bottom + 4 }, [{ cap: "Made for" }, ...DEVK().map((k) => { const d = B().DEVICES[k]; return { label: d.name, key: k === "custom" ? "w × h" : `${d.w} × ${d.h}`, icon: k === cur ? "✓" : "", act: () => setDevice(sc, k) }; })]); };
    q("rmCopy").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); ctxMenu({ clientX: r.left, clientY: r.bottom + 4 }, [{ cap: "Copy the layout of" }, ...BAND.screens.filter((x) => x !== sc && ((x.land || []).length || (x.port || []).length)).map((x) => ({ label: `${x.name} · ${devName(x)}`, icon: "", act: () => copyFrom(sc, x) }))]); };
    q("bPreset").onclick = (e) => ctxMenu(e, B().PRESETS.map(([k, n]) => ({ label: n, icon: "▦", act: () => { const go = () => edit(`Started “${sc.name}” from the ${n} preset`, (s) => { const p = B().preset(k), g = G(s); for (const o of ["land", "port"]) p[o] = B().regrid(p[o], { cols: 12, rows: 9 }, g); if (B().isPhoneScreen(s)) { p.port = B().stackLayout(p.land, g.cols).list; } Object.assign(s, p); SEL.clear(); sync(); }); if (sc.land.length || sc.port.length) confirmBox(`Replace “${esc(sc.name)}”’s layout?`, `Both orientations start again from the ${n} preset.`, "Replace", go); else go(); } })));
    q("bCol").onclick = (e) => swatchPop({ left: e.clientX, right: e.clientX, top: e.clientY }, sc.col, (c) => edit("Screen colour", (s) => { s.col = c; }));
    q("bDel").onclick = () => confirmBox(`Delete the screen “${esc(sc.name)}”?`, "A device showing it goes back to “Which screen is this?”.", "Delete screen", () => { snap(); BAND.screens = BAND.screens.filter((x) => x !== sc); BSEL = BAND.screens[0] && BAND.screens[0].id; SEL.clear(); sync(); changed(); render(); });
    q("rwTo").querySelectorAll("button").forEach((b) => (b.onclick = () => setAlignTo(b.dataset.v)));
    document.querySelectorAll("[data-al]").forEach((b) => (b.onclick = () => align(b.dataset.al)));
    q("rwGrid").onclick = (e) => gridPop(e.currentTarget);
    wireRight(sc);
    // the canvas: pointer, right-click, ⋯
    const area = q("rmArea"); area.tabIndex = -1; area.onpointerdown = onDown;
    area.oncontextmenu = (e) => { const wEl = e.target.closest(".s5w"); if (!wEl) return; e.preventDefault(); if (!SEL.has(wEl.dataset.w)) { SEL = new Set([wEl.dataset.w]); sync(); render(); } menu(e); };
    area.querySelectorAll(".rm15more").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const id = b.closest(".s5w").dataset.w; if (!SEL.has(id)) { SEL = new Set([id]); sync(); render(); } const r = (document.querySelector(`#rmArea .s5w[data-w="${id}"] .rm15more`) || b).getBoundingClientRect(); menu({ clientX: r.left, clientY: r.bottom + 4 }); }));
  }
  function wireLib(sc) {
    const find = $("rwFind"); if (!find || !sc) return;
    find.oninput = () => { FIND = find.value; const t = $("rwTiles"); t.innerHTML = tilesHTML(); drawMinis(t, data()); wireTiles(); };
    find.onkeydown = (e) => { if (e.key === "ArrowDown") { e.preventDefault(); const t = document.querySelector(".rwt"); if (t) t.focus(); } if (e.key === "Escape") { find.value = ""; find.oninput(); } };
    document.querySelectorAll(".rwcats [data-cat]").forEach((b) => (b.onclick = () => { CAT = b.dataset.cat; document.querySelectorAll(".rwcats [data-cat]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }); const t = $("rwTiles"); t.innerHTML = tilesHTML(); drawMinis(t, data()); wireTiles(); hidePop(true); }));
    wireTiles();
  }
  function wireTiles() {
    const tiles = [...document.querySelectorAll(".rwt")];
    tiles.forEach((t, i) => { const type = t.dataset.add;
      t.onpointerdown = (e) => libDown(e, type);
      t.ondblclick = () => { const sc = scr(); if (sc) addWidget(sc, type, undefined, undefined, LIBV[type]); };
      t.onmouseenter = () => { if (!LIBDRAG) showPop(t); }; t.onmouseleave = () => hidePop();
      t.onfocus = () => showPop(t, true); t.onblur = () => { setTimeout(() => { if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest(".rwt, #rwPop")) hidePop(true); }, 0); };
      t.onkeydown = (e) => { const go = (j) => { const x = tiles[j]; if (x) { e.preventDefault(); x.focus(); x.scrollIntoView({ block: "nearest" }); } };
        if (e.key === "ArrowRight") go(i + 1); else if (e.key === "ArrowLeft") go(i - 1); else if (e.key === "ArrowDown") go(i + 2); else if (e.key === "ArrowUp") { if (i < 2) { e.preventDefault(); $("rwFind").focus(); } else go(i - 2); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const sc = scr(); if (sc) addWidget(sc, type, undefined, undefined, LIBV[type]); }
        else if (e.key === "Escape") { hidePop(true); t.blur(); }
        else if (/^[1-3]$/.test(e.key)) { const vs = B().variantsOf(type), k = vs[+e.key - 1]; if (k) { e.preventDefault(); LIBV[type] = k[0]; t.querySelector(".rwmini").outerHTML = miniHTML(type, k[0], TW, TH); drawMinis(t, data()); showPop(t, true); } } };
    });
  }
  // the inspector's controls
  function wireRight(sc) {
    const box = $("rwRight"); if (!box || !sc) return; const q = $;
    if (q("rmDelW")) q("rmDelW").onclick = delSel;
    if (q("rwLock")) q("rwLock").onclick = () => lockSel();
    box.querySelectorAll("[data-xy]").forEach((i) => (i.onchange = () => { if (i.value === "") return; const k = i.dataset.xy, g = G(sc), { cw, ch } = cellsize(sc), v = g.snap ? +i.value : +i.value / (k === "x" || k === "w" ? cw : ch);
      const L = selList(sc).filter((w) => k === "w" || k === "h" || !w.lock); if (!L.length) { toast("Locked: unlock its position first"); render(); return; }
      edit("", () => L.forEach((w) => { w[k] = v; B().clamp(w, g, !g.snap || [w.x, w.y, w.w, w.h].some((n) => n % 1)); })); }));
    // sliders: one undo step per drag (snap at the start), the canvas follows while dragging
    box.querySelectorAll(".rwsl").forEach((row) => { const k = row.dataset.r, rg = row.querySelector("input[type=range]"), nb = row.querySelector("input[type=number]");
      const apply = (v) => { selList(scr()).forEach((w) => { w.st = { ...(w.st || {}) }; if (k === "op") { w.st.op = v; const s0 = B().styleOf(w); if (s0.bg === "none" && v > 0) w.st.bg = "solid"; } else if (k === "size") w.st.size = v; else w.st[k] = v; }); refreshWidgets(); };
      let snapped = false; const begin = () => { if (!snapped) { snap(); snapped = true; } };
      rg.onpointerdown = begin; rg.onkeydown = begin; rg.oninput = () => { begin(); nb.value = rg.value; rg.classList.remove("mixed"); apply(+rg.value); };
      rg.onchange = () => { snapped = false; changed(); toast(`${row.querySelector("span").textContent} ${rg.value}`, undo); renderRight(scr()); wireRight(scr()); };
      nb.onchange = () => { if (nb.value === "") return; const v = Math.max(+nb.min, Math.min(+nb.max, Math.round(+nb.value))); setStyle(`${row.querySelector("span").textContent} ${v}`, (s) => { if (k === "op") { s.op = v; if (s.bg === "none" && v > 0) s.bg = "solid"; } else s[k] = v; }); };
    });
    box.querySelectorAll(".rwseg").forEach((sg) => sg.querySelectorAll("button").forEach((b) => (b.onclick = (e) => { const k = sg.dataset.s, v = b.dataset.v;
      if (k === "size") setStyle(v === "auto" ? "Text: auto-fit" : "Text: fixed size", (s, w) => { s.size = v === "auto" ? "auto" : B().styleOf(w).size === "auto" ? 48 : B().styleOf(w).size; });
      else if (k === "wt") setStyle(`Weight: ${b.textContent}`, (s) => { s.wt = v; });
      else if (k === "lab") setStyle(`Label: ${b.textContent}`, (s) => { s.lab = v; });
      else if (k === "bg") { if (v === "col") { const cur = B().styleOf(selList(sc)[0]).bg; swatchPop({ left: e.clientX, right: e.clientX, top: e.clientY }, /^#/.test(cur) ? cur : "#0a84ff", (c) => setStyle("Background colour", (s) => { s.bg = c; if (!s.op) s.op = 100; })); return; }
        setStyle(v === "none" ? "No background" : "Solid background", (s) => { s.bg = v; s.op = v === "none" ? 0 : s.op || 100; }); } })));
    box.querySelectorAll(".rwal [data-a]").forEach((b) => (b.onclick = () => setStyle(`Content: ${alName(b.dataset.a)}`, (s) => { s.al = b.dataset.a === "mc" ? "" : b.dataset.a; })));
    box.querySelectorAll(".rwchip").forEach((b) => (b.onclick = () => setVariant(b.dataset.var)));
    if (q("rwFont")) q("rwFont").onchange = (e) => setStyle(`Font: ${e.target.value || "Default"}`, (s) => { s.font = e.target.value; });
    box.querySelectorAll(".rwdot").forEach((b) => (b.onclick = (e) => { const k = b.dataset.c, cur = B().styleOf(selList(sc)[0])[k]; swatchPop({ left: e.clientX, right: e.clientX, top: e.clientY }, cur || (k === "fg" ? "#f2f2f4" : "#22c3a6"), (c) => setStyle(k === "fg" ? "Text colour" : "Accent colour", (s, w) => { s[k] = c; if (k === "acc") { s.sec = false; if ((B().WIDGETS[w.type] || {}).cmd) w.cfg = { ...(w.cfg || {}), col: c }; } })); }));
    box.querySelectorAll(".rm15tg[data-t]").forEach((b) => (b.onclick = () => { const k = b.dataset.t, on = !b.classList.contains("on");
      setStyle(`${{ sec: "Section colour", border: "Border", shadow: "Text shadow" }[k]} ${on ? "on" : "off"}`, (s) => { s[k] = on; }); }));
    wireSettings(sc);
  }
  function gridPop(at) {
    const sc = scr(); if (!sc) return; const g = G(sc);
    popAt(at, `<div class="rm15sp rwgp"><b>Grid</b><div class="rwgrow">${step("cols", g.cols, "Columns")}${step("rows", g.rows, "Rows")}</div><div class="rwgrow">${step("gap", g.gap, "Gap", "px")}</div><div class="rwgrow">${tog("snap", g.snap, "Snap")}${tog("guides", g.guides, "Guides")}</div>
      <p class="faint">Snap off: free placement (the smart guides still snap). Guides off: no pink lines and no snapping to them. ${MAC ? "⌘" : "Ctrl"}-drag ignores both.</p></div>`, (p) => {
      p.classList.add("rm15pop");
      p.querySelectorAll(".rm15st").forEach((s) => { const k = s.dataset.k, inp = s.querySelector("input"), lim = k === "gap" ? [0, 24] : [2, 48];
        const go = (v) => { v = Math.max(lim[0], Math.min(lim[1], Math.round(+v || 0))); if (v === G(sc)[k]) { inp.value = v; return; } if (k === "gap") edit(`Gap ${v} px`, (x) => setGrid(x, { gap: v })); else regrid(sc, { [k]: v }); gridPop($("rwGrid") || at); };
        s.querySelectorAll("button").forEach((b) => (b.onclick = () => go(G(sc)[k] + +b.dataset.d))); inp.onchange = () => go(inp.value); inp.onkeydown = (e) => { if (e.key === "Enter") go(inp.value); }; });
      p.querySelectorAll(".rm15tg").forEach((b) => (b.onclick = () => { const k = b.dataset.t, v = !G(sc)[k]; edit(`${k === "snap" ? "Snap" : "Guides"} ${v ? "on" : "off"}`, (x) => setGrid(x, { [k]: v })); gridPop($("rwGrid") || at); }));
    });
  }
  function menu(e) { const n = SEL.size, lk = selList(scr()).every((w) => w.lock); ctxMenu(e, [{ label: "Style…", icon: "", act: () => stylePop({ left: e.clientX, right: e.clientX, top: e.clientY }) },
    { label: "Centre on the screen", icon: "", key: keyOf("arrCentre"), act: () => { const m = ALTO; ALTO = { mode: "screen", many: SEL.size > 1 }; align("ac"); ALTO = m; } }, { label: "Middle of the screen", icon: "", key: keyOf("arrMiddle"), act: () => { const m = ALTO; ALTO = { mode: "screen", many: SEL.size > 1 }; align("am"); ALTO = m; } },
    { label: lk ? "Unlock position" : "Lock position", icon: "", key: keyOf("arrLock"), act: () => lockSel() }, "-",
    { label: "Duplicate", icon: "⊕", key: "⌘D", act: () => dupSel(false) }, { label: "Copy", icon: "⧉", key: "⌘C", act: copySel }, "-", { label: n > 1 ? `Remove ${n} widgets` : "Remove widget", icon: "⌫", danger: true, act: delSel }]); }
  const copySel = () => { const sc = scr(); if (!sc || !SEL.size) return; CB = JSON.parse(JSON.stringify(selList(sc))); toast(`Copied ${CB.length > 1 ? CB.length + " widgets" : "a widget"}`); };
  function setDevice(sc, k) {
    if (k === "custom") { const cur = B().deviceOf(sc); floatInput(innerWidth / 2 - 90, 140, 180, 26, `${cur.w} x ${cur.h}`, (v) => { const m = /(\d{3,4})\D+(\d{3,4})/.exec(v || ""); if (!m) return; edit(`Custom size ${m[1]} × ${m[2]}`, (s) => { s.device = "custom"; s.size = { w: +m[1], h: +m[2] }; }); }); return; }
    const was = B().isPhoneScreen(sc), d = B().DEVICES[k];
    edit(`“${sc.name}” is for ${d.name}`, (s) => { s.device = k; if (!was && d.phone && !(s.port || []).length) { const g0 = G(s), g1 = { ...g0, cols: d.grid[0], rows: d.grid[1] }; s.port = B().stackLayout(s.land || [], g1.cols).list; s.land = B().regrid(s.land || [], g0, g1); s.grid = g1; BORI = "port"; } });
  }
  function wireSettings(sc) {
    const w = selList(sc)[0]; if (!w || SEL.size !== 1) return; const c = w.cfg || (w.cfg = {}), q = $, on = (id, ev, fn) => { const x = q(id); if (x) x[ev] = fn; };
    const set = (k, v) => edit("", () => { if (v === "" || v === undefined) delete c[k]; else c[k] = v; });
    on("bwLabel", "onchange", (e) => set("label", e.target.value.trim())); on("bwCol", "onchange", (e) => set("col", e.target.value)); on("bwConfirm", "onclick", () => set("confirm", !c.confirm || ""));
    on("bwField", "onchange", (e) => set("field", e.target.value)); on("bwAlso", "onchange", (e) => set("also", e.target.value)); on("bwText", "onchange", (e) => set("text", e.target.value));
    on("bwLabels", "onchange", (e) => set("labels", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))); on("bwItems", "onchange", (e) => set("items", e.target.value.split(",").map((x) => x.trim()).filter(Boolean)));
    on("bwBars", "onchange", (e) => set("bars", Math.max(1, Math.min(16, +e.target.value || 4)))); on("bwTrack", "onchange", (e) => set("track", e.target.value));
    on("bwSong", "onchange", (e) => { delete c.ver; set("song", e.target.value); }); on("bwVer", "onchange", (e) => set("ver", e.target.value));
    on("bwPort", "onchange", (e) => set("port", e.target.value)); on("bwCh", "onchange", (e) => set("ch", +e.target.value)); on("bwMsgs", "onchange", (e) => set("text", e.target.value));
    on("rmSecs", "onclick", () => set("secs", !c.secs || ""));
    if (q("bwWhich")) q("bwWhich").querySelectorAll("button").forEach((b) => (b.onclick = () => set("which", b.dataset.v)));
    if (q("bwRole")) q("bwRole").querySelectorAll("button").forEach((b) => (b.onclick = () => set("role", b.dataset.v)));
  }
  // the clock: hours and minutes by default (seconds on request)
  const BWS = window.bandWidgetSettings; if (BWS) window.bandWidgetSettings = function (sc, w) { let h = BWS.apply(this, arguments); if (w.type === "clock") h = h.replace('<button class="rdanger"', `${rrow("Seconds", tog13("rmSecs", !!(w.cfg && w.cfg.secs)))}<button class="rdanger"`); return h; };
  const tog13 = (id, on) => `<button class="tog ${on ? "" : "off"}" id="${id}"></button>`;

  // ---------------------------------------------------------------- keys (the Remote page, nothing typed)
  window.addEventListener("keydown", (e) => { // (window, capture: before the page's older Remote keys)
    if (!bandOn || !scr() || LIBDRAG) return; const a = document.activeElement; // (a drag from the library: Esc is its own) if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (a && a.closest && a.closest(".rwt")) return; // the library's tiles have their own keys
    if (document.querySelector(".cfbg")) return;
    const cmd = isCmd(e), k = e.key.toLowerCase(), take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (cmd && k === "a" && !e.shiftKey && !e.altKey) { take(); selectAll(); return; }
    if ((cmd && e.shiftKey && !e.altKey && k === "a") || (e.key === "Escape" && SEL.size)) { take(); deselect(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && SEL.size) { take(); delSel(); return; }
    if (cmd && !e.altKey && k === "d" && SEL.size) { take(); dupSel(false); return; }
    if (cmd && !e.altKey && k === "c" && SEL.size) { take(); copySel(); return; }
    if (cmd && !e.altKey && k === "v" && CB) { take(); dupSel(true); return; }
    if (!cmd && SEL.size && /^Arrow/.test(e.key)) { take(); nudge(e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0, e.shiftKey, e.altKey); }
  }, true);
  function selectAll() { const sc = scr(); if (!sc) return 0; SEL = new Set(listOf(sc).map((w) => w.id)); sync(); render(); return SEL.size; }
  function deselect() { SEL.clear(); sync(); render(); }

  // the page's renderBand is this editor now
  window.renderBand = render;
  const api = { render, selectAll, deselect, selected: () => [...SEL], select: (ids) => { SEL = new Set(ids); sync(); render(); }, align, alignMode, setAlignTo, can, lock: lockSel,
    regrid: (o) => scr() && regrid(scr(), o), copyFrom: (id) => { const s = BAND.screens.find((x) => x.id === id); if (s && scr()) copyFrom(scr(), s); }, setDevice: (k) => scr() && setDevice(scr(), k),
    stylePop, gridPop: () => gridPop($("rwGrid")), nudge, addWidget: (t, x, y, v, at) => addWidget(scr(), t, x, y, v, at), paint, scale: () => K, data, cellsize: () => cellsize(scr()), snapBox: (b, others, edges, opt) => snapBox(scr(), b, others || [], edges || "move", opt || {}),
    setStyle: (f) => setStyle("", f), setVariant, tab: (t) => { TAB = t; render(); }, lib: { cat: (c) => { CAT = c; render(); }, find: (s) => { FIND = s; const i = $("rwFind"); if (i) { i.value = s; i.oninput(); } }, pick: (t, v) => { LIBV[t] = v; }, show: (t) => { const x = document.querySelector(`.rwt[data-add="${t}"]`); if (x) showPop(x, true); }, hide: () => hidePop(true) } };
  window.SL16R = api; window.SL15R = api; // (15's tests and menus)
})();
