// set.Line 15 §3-§5, §7: the Remote page's screen editor (mockups docs/design/phase15/rg.png, rg2.png, rg3.png, ph.png).
// - §3 WYSIWYG: the canvas is the device at its real size (scaled to fit), and every widget is drawn by the same code
//   as on the device (SLBand.render, src/band/widgets.js), with the live song when one is loaded and sample data
//   otherwise: never an empty box. One outline for the selection. The widget list is always on the right (it scrolls
//   by itself), the selected widget's settings under it.
// - §4 Each screen has its own grid: columns x rows, the gap, Snap (⌘ / Ctrl while dragging ignores it) and Guides
//   (red lines when edges or centres line up). Align and distribute a selection; x / y / w / h fields.
// - §5 A widget's style: Solid / Transparent / any colour (the colour wheel), opacity, border, text shadow, where
//   its content sits (3 x 3). It applies to every selected widget (right-click a widget, its ⋯ or Style…).
// - §7 A device per screen (iPhone, iPhone large, iPhone SE, iPad, iPad mini, laptop, custom), portrait / landscape,
//   safe areas drawn on the canvas; Copy layout from… another screen (a big screen's widgets come in stacked for a
//   phone).
// Everything is one undo step per change (snap()), and the devices showing the screen redraw at once.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const B = () => window.SLBand;
  let SEL = new Set(); // the selected widgets' ids (BWID: the first, for older code)
  let CB = null; // copied widgets
  let K = 1; // the canvas's scale (device px -> screen px)
  const scr = () => (typeof curScreen === "function" ? curScreen() : null);
  const listOf = (sc) => sc[BORI] || (sc[BORI] = []);
  const selList = (sc) => listOf(sc).filter((w) => SEL.has(w.id));
  const sync = () => { BWID = SEL.size ? [...SEL][0] : null; };
  const changed = () => { if (typeof bandChanged === "function") bandChanged(); };
  const G = (sc) => B().gridOf(sc);
  const setGrid = (sc, o) => { sc.grid = { ...G(sc), ...o }; };
  const DEVK = () => Object.keys(B().DEVICES);
  const devName = (sc) => { const d = B().deviceOf(sc); return d.name.replace("…", ""); };

  // ---------------------------------------------------------------- the data shown on the canvas
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

  // ---------------------------------------------------------------- render the page
  const ICON = { al: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2v12" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="4" width="9" height="3" rx="1" fill="currentColor"/><rect x="4" y="9" width="6" height="3" rx="1" fill="currentColor"/></svg>',
    ac: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1v14" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="4" width="10" height="3" rx="1" fill="currentColor"/><rect x="5" y="9" width="6" height="3" rx="1" fill="currentColor"/></svg>',
    ar: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M14 2v12" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="4" width="9" height="3" rx="1" fill="currentColor"/><rect x="6" y="9" width="6" height="3" rx="1" fill="currentColor"/></svg>',
    at: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 2h12" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="4" width="3" height="9" rx="1" fill="currentColor"/><rect x="9" y="4" width="3" height="6" rx="1" fill="currentColor"/></svg>',
    am: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M1 8h14" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="5" width="3" height="6" rx="1" fill="currentColor"/></svg>',
    ab: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 14h12" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="9" y="6" width="3" height="6" rx="1" fill="currentColor"/></svg>',
    dh: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1" y="4" width="3" height="8" rx="1" fill="currentColor"/><rect x="6.5" y="4" width="3" height="8" rx="1" fill="currentColor"/><rect x="12" y="4" width="3" height="8" rx="1" fill="currentColor"/></svg>',
    dv: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="4" y="1" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="6.5" width="8" height="3" rx="1" fill="currentColor"/><rect x="4" y="12" width="8" height="3" rx="1" fill="currentColor"/></svg>' };
  const ALIGN = [["al", "Align left edges"], ["ac", "Align centres (across)"], ["ar", "Align right edges"], ["at", "Align top edges"], ["am", "Align middles"], ["ab", "Align bottom edges"], ["dh", "Distribute across (3 or more)"], ["dv", "Distribute down (3 or more)"]];
  const step = (id, v, lab, unit = "") => `<span class="rm15st" data-k="${id}"><b>${lab}</b><button data-d="-1" aria-label="${lab} smaller">−</button><input type="number" value="${v}" aria-label="${lab}"><button data-d="1" aria-label="${lab} bigger">+</button>${unit ? `<em>${unit}</em>` : ""}</span>`;
  const tog = (id, on, lab) => `<button class="rm15tg ${on ? "on" : ""}" data-t="${id}" aria-pressed="${on}"><b>${lab}</b><i></i></button>`;

  let CSSIN = false;
  function render() {
    const el = $("bandV"); if (!el || !bandOn || !B()) return;
    if (!CSSIN) { CSSIN = true; const st = document.createElement("style"); st.id = "slw15"; st.textContent = B().CSS; document.head.appendChild(st); }
    const sc = scr(), info = BINFO, ip = info && info.addresses && info.addresses[0], url = ip ? `http://${ip}:${info.port}/` : "", qr = url && B() ? B().qrSVG(url) : "";
    if (sc && !sc[BORI]) sc[BORI] = [];
    for (const id of [...SEL]) if (!sc || !listOf(sc).some((w) => w.id === id)) SEL.delete(id); sync();
    const left = `<div class="bl"><div class="blh"><b>Screens</b><button class="ibtn" id="bAdd" title="Add a screen">＋</button></div>
      ${BAND.screens.map((x) => `<div class="bscr ${x.id === BSEL ? "on" : ""}" data-id="${x.id}"><span class="bav" style="background:${x.col}">${esc(x.name.slice(0, 2).toUpperCase())}</span><span class="bt"><b>${esc(x.name)}</b><small>${esc(devName(x))}</small></span><i class="bdot ${BONLINE[x.id] ? "on" : ""}" title="${BONLINE[x.id] ? "Connected" : "Not connected"}"></i></div>`).join("") || '<p class="faint" style="font-size:12px;padding:6px 8px">No screens yet. ＋ adds one; a device that joins can also make one.</p>'}
      <div class="bjoin">${qr ? `<div class="bqr">${qr}</div>` : ""}<div class="bip">${esc(url || "No network")}</div><div class="faint" style="font-size:11px">${info && info.mdns === "setline.local" ? `or <b>http://setline.local:${info.port}/</b>` : "Scan the code or type the address"}${info && !info.running ? ' · <span style="color:var(--amber)">the server is off (Settings › Remote)</span>' : ""}</div>
        <p class="faint" style="font-size:11px;margin:6px 0 0">On the phone: Share › Add to Home Screen opens it full screen.</p>
        <label class="faint" style="font-size:11px;display:block;margin-top:8px">Remote network <input id="bNet" value="${esc(BAND.network || "")}" placeholder="name (just a label)" style="width:100%;margin-top:3px"></label></div>
      ${BDEVS.length ? `<div class="bfields"><span class="faint">Connected devices</span>${BDEVS.map((d) => `<div class="clkrow" style="margin-top:4px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(d.device || "")}">${esc(d.address)}</span><select data-dev="${d.id}" title="Which screen this device shows"><option value="">(asks)</option>${BAND.screens.map((x) => `<option value="${x.id}" ${x.id === d.screen ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>`).join("")}</div>` : ""}
      <div class="bfields"><span class="faint">Song fields:</span> ${FIELDS.length ? FIELDS.map((f) => esc(f.name)).join(", ") : "none"}<div style="display:flex;gap:6px;margin-top:6px"><button class="btn line" id="bFields">Edit song fields…</button><button class="btn line" id="bTable">Table…</button></div></div></div>`;
    const lib = `<div class="rm15lib"><h4>Widgets · drag in</h4>${["Info", "Communication", "Controls"].map((g) => `<div class="rm15g">${g}</div>${Object.entries(B().WIDGETS).filter(([, d]) => d.group === g).map(([k, d]) => `<div class="bwl" ${sc ? "data-drag10" : ""} data-add="${k}" title="${sc ? "Drag onto the screen, or double-click to add" : "Add a screen first"}">${esc(d.name)}</div>`).join("")}`).join("")}</div>`;
    if (!sc) {
      el.innerHTML = left + `<div class="bm"><div class="bempty"><div class="bei">${IC.add}</div><b>Add a screen to start</b><p>A screen is what one phone or tablet shows: the song, its sections, a countdown, notes for one player, buttons. Design one for each player.</p><button class="btn pri" id="bAdd2">＋ Add a screen</button></div></div>` + `<div class="br dim">${lib}</div>`;
      wire(null); return;
    }
    const g = G(sc), d = B().deviceOf(sc), cs = B().canvasSize(sc, BORI), ns = SEL.size, sel = selList(sc);
    const others = BAND.screens.filter((x) => x !== sc && ((x.land || []).length || (x.port || []).length));
    const mid = `<div class="bm rm15m"><div class="rm15bar">
        <input id="bName" value="${esc(sc.name)}" aria-label="Screen name" class="rm15name">
        <button class="btn line" id="rmDev" title="The device this screen is made for: ${cs.w} × ${cs.h}">${esc(devName(sc))} ▾</button>
        ${segm("bOri", [["land", "Landscape"], ["port", "Portrait"]], BORI)}
        <button class="btn line" id="rmCopy" ${others.length ? "" : "disabled"} title="Start from another screen's layout">Copy layout from… ▾</button>
        <button class="btn line" id="bPreset">Preset ▾</button>
        <button class="btn line" id="bCol" title="This screen's colour (in the list and on the device's picker)"><i class="rm15sw" style="background:${esc(sc.col)}"></i>Colour</button>
        <span style="flex:1"></span><button class="btn line danger" id="bDel" title="Delete this screen">Delete</button></div>
      <div class="rm15bar rm15bar2">${step("cols", g.cols, "Grid")}<span class="rm15x">×</span>${step("rows", g.rows, "", "")}${step("gap", g.gap, "Gap", "px")}${tog("snap", g.snap, "Snap")}${tog("guides", g.guides, "Guides")}
        <span class="rm15al">${ALIGN.map(([k, n]) => `<button class="ibtn" data-al="${k}" title="${n}" aria-label="${n}" ${(k[0] === "d" ? ns >= 3 : ns >= 2) ? "" : "disabled"}>${ICON[k]}</button>`).join("")}</span></div>
      <div class="rm15wrap" id="rmWrap"><div class="rm15frame ${d.phone ? "phone" : ""}" id="rmFrame"><div class="rm15dev slw" id="bCanv" data-ori="${BORI}" style="width:${cs.w}px;height:${cs.h}px">
        <div class="rm15grid" style="background-size:${cs.w / g.cols}px ${(cs.h - safeT(sc) - safeB(sc)) / g.rows}px;top:${safeT(sc)}px;bottom:${safeB(sc)}px"></div>
        ${safeT(sc) ? `<div class="rm15safe t" style="height:${safeT(sc)}px"><span>${d.phone ? "status bar" : ""}</span></div>` : ""}${safeB(sc) ? `<div class="rm15safe b" style="height:${safeB(sc)}px"></div>` : ""}
        <div class="rm15area" id="rmArea" style="top:${safeT(sc)}px;bottom:${safeB(sc)}px">${listOf(sc).map((w) => `<div class="s5w ${SEL.has(w.id) ? "sel" : ""}" data-w="${w.id}" style="${B().place(w, g)}"><div class="s5wi" style="${B().boxStyle(w)}"></div>${SEL.has(w.id) && ns === 1 ? '<i class="rm15rs" title="Drag to resize"></i>' : ""}<button class="rm15more" title="Style and more" aria-label="Widget options">⋯</button></div>`).join("")}</div>
      </div></div></div>
      <p class="faint rm15hint">${data().sample ? "Sample song shown (no song loaded). " : ""}Drag to move, the corner to resize; ⌘-drag ignores the grid. ⇧-click adds to the selection; ⌘A selects every widget. Changes show on the device at once. ${listOf(sc).some((w) => (B().WIDGETS[w.type] || {}).cmd) ? "This screen can do what its buttons do, nothing else." : "No buttons: this screen can only watch."}</p></div>`;
    const insp = ns ? inspector(sc, sel) : `<div class="rm15insp"><h4>Selected</h4><p class="faint">Click a widget to select it; ⇧-click or drag a box for several.</p></div>`;
    el.innerHTML = left + mid + `<div class="br rm15r">${lib}${insp}</div>`;
    wire(sc); fitCanvas(); paint(true);
  }
  const safeT = (sc) => { const d = B().deviceOf(sc); return BORI === "port" ? d.safe.top : d.phone ? 0 : d.safe.top; };
  const safeB = (sc) => { const d = B().deviceOf(sc); return BORI === "port" ? d.safe.bottom : d.phone ? 21 : d.safe.bottom; };
  function inspector(sc, sel) {
    const g = G(sc), w = sel[0], d = B().WIDGETS[w.type] || { name: w.type }, st = B().styleOf(w);
    const span = (a, n) => (n <= 1 ? `${Math.round(a) + 1}` : `${Math.round(a) + 1}–${Math.round(a + n)}`);
    const head = sel.length > 1 ? `<h4>Selected · ${sel.length} widgets</h4>` : `<h4>Selected · ${esc(d.name)}</h4><div class="rm15pos">Columns ${span(w.x, w.w)} · rows ${span(w.y, w.h)}</div>`;
    const num = (k, v, max) => `<label>${k}<input type="number" step="${g.snap ? 1 : 0.25}" min="0" max="${max}" value="${+(+v).toFixed(2)}" data-xy="${k}"></label>`;
    const xy = sel.length === 1 ? `<div class="rm15xy">${num("x", w.x, g.cols - 1)}${num("y", w.y, g.rows - 1)}${num("w", w.w, g.cols)}${num("h", w.h, g.rows)}</div>` : "";
    const bg = st.bg === "none" ? "transparent" : st.bg === "solid" ? "solid" : st.bg;
    const settings = sel.length === 1 && typeof bandWidgetSettings === "function" ? bandWidgetSettings(sc, w).replace(/<div class="brh">[\s\S]*?<\/div>/, "").replace(/<h3>[\s\S]*?<\/h3>/, "").replace(/<button class="rdanger" id="bwDel">[\s\S]*?<\/button>/, "").replace(/<div class="rf ">\s*<span>Size<\/span>[\s\S]*?<\/span><\/div>/, "").replace(/^<div class="br">/, '<div class="rm15set">') : "";
    return `<div class="rm15insp">${head}${xy}<div class="rm15stl">Background: <b>${esc(bg)}</b>${st.border ? " · border" : ""}${st.shadow ? " · text shadow" : ""}${st.al && st.al !== "mc" ? " · " + alName(st.al) : ""} <button class="btn line" id="rmStyle2">Style…</button></div>${settings}<button class="rdanger" id="rmDelW">Remove ${sel.length > 1 ? sel.length + " widgets" : "widget"}</button></div>`;
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
  const CACHE = new Map(); let lastPaint = 0;
  function paint(force) {
    const sc = scr(), area = $("rmArea"); if (!sc || !area || !bandOn) return;
    const D = data(), song = D.show && D.st.cur ? D.show.songs[D.st.cur] : null, L = B();
    const bb = song ? L.barBeatAt(song, D.pos) : null, sec = song ? L.sectionAt(song, D.pos) : null, nsec = song ? L.nextSection(song, D.pos) : null;
    for (const w of listOf(sc)) {
      const el = area.querySelector(`.s5w[data-w="${w.id}"] > .s5wi`); if (!el) continue;
      const r = { width: el.clientWidth, height: el.clientHeight };
      const out = L.render(w, { show: D.show, st: D.st, pos: D.pos, song, bb, sec, nsec, r, now: Date.now(), connected: true, rtt: 12, statuses: [], myStatus: {}, checklist: {}, acks: {}, editor: true });
      const key = out.html + "|" + r.width + "x" + r.height;
      if (force || CACHE.get(w.id) !== key) { CACHE.set(w.id, key); el.innerHTML = out.html; el.classList.toggle("flush", !!out.flush); el.classList.toggle("top", !!out.top); }
      if (w.type === "timeline" && sec) { const i = el.querySelector(".s5tlp"); if (i) i.style.setProperty("--p", Math.max(0, Math.min(1, (D.pos - sec.t0) / Math.max(0.001, sec.t1 - sec.t0))).toFixed(3)); }
    }
  }
  (function loop() { requestAnimationFrame(loop); const t = performance.now(); if (!bandOn || t - lastPaint < 66 || DRAG) return; lastPaint = t; paint(false); })();

  // ---------------------------------------------------------------- changes
  const edit = (what, f, noRender) => { const sc = scr(); if (!sc) return; snap(); f(sc); changed(); if (what && typeof toast === "function") toast(what, undo); if (!noRender) render(); };
  function addWidget(sc, type, x, y) {
    const d = B().WIDGETS[type]; if (!d) return null; const g = G(sc), list = listOf(sc);
    const fx = g.cols / 12, fy = g.rows / 9, w = { id: "w" + Date.now().toString(36) + Math.floor(Math.random() * 999), type, x: 0, y: 0, w: Math.max(1, Math.round(d.w * fx)), h: Math.max(1, Math.round(d.h * fy)), cfg: {} };
    if (B().isPhoneScreen(sc)) { const st = B().stackLayout([w], g.cols).list[0]; w.w = st.w; w.h = Math.min(g.rows, st.h); }
    const free = (px, py) => !list.some((o) => px < o.x + o.w && px + w.w > o.x && py < o.y + o.h && py + w.h > o.y);
    if (x !== undefined) { w.x = x - Math.floor(w.w / 2); w.y = y; } else { let found = false; for (let yy = 0; yy <= g.rows - w.h && !found; yy++) for (let xx = 0; xx <= g.cols - w.w && !found; xx++) if (free(xx, yy)) { w.x = xx; w.y = yy; found = true; } }
    B().clamp(w, g); snap(); list.push(w); SEL = new Set([w.id]); sync(); changed(); render(); return w;
  }
  window.addWidget = addWidget;
  function delSel() { const sc = scr(); if (!sc || !SEL.size) return; const n = SEL.size; edit(`Removed ${n > 1 ? n + " widgets" : "a widget"} from “${sc.name}”`, (s) => { s[BORI] = listOf(s).filter((w) => !SEL.has(w.id)); SEL.clear(); sync(); }); }
  function dupSel(paste) {
    const sc = scr(); if (!sc) return; const src = paste ? CB : selList(sc); if (!src || !src.length) return; const g = G(sc);
    edit(`${paste ? "Pasted" : "Duplicated"} ${src.length > 1 ? src.length + " widgets" : "a widget"}`, (s) => { const add = src.map((w) => B().clamp({ ...JSON.parse(JSON.stringify(w)), id: "w" + Date.now().toString(36) + Math.floor(Math.random() * 99999), x: w.x + 1, y: w.y + 1 }, g)); listOf(s).push(...add); SEL = new Set(add.map((w) => w.id)); sync(); });
  }
  function nudge(dx, dy) { const sc = scr(); if (!sc || !SEL.size) return; const g = G(sc); edit("", (s) => { selList(s).forEach((w) => { w.x += dx; w.y += dy; B().clamp(w, g, !g.snap || dx % 1 || dy % 1); }); }); }
  function align(k) {
    const sc = scr(), L = sc ? selList(sc) : []; if (L.length < 2) return; const g = G(sc);
    const x0 = Math.min(...L.map((w) => w.x)), x1 = Math.max(...L.map((w) => w.x + w.w)), y0 = Math.min(...L.map((w) => w.y)), y1 = Math.max(...L.map((w) => w.y + w.h));
    const name = ALIGN.find((a) => a[0] === k)[1];
    edit(name, () => {
      if (k === "al") L.forEach((w) => (w.x = x0)); if (k === "ar") L.forEach((w) => (w.x = x1 - w.w)); if (k === "ac") L.forEach((w) => (w.x = (x0 + x1) / 2 - w.w / 2));
      if (k === "at") L.forEach((w) => (w.y = y0)); if (k === "ab") L.forEach((w) => (w.y = y1 - w.h)); if (k === "am") L.forEach((w) => (w.y = (y0 + y1) / 2 - w.h / 2));
      if (k === "dh" && L.length >= 3) { const s = [...L].sort((a, b) => a.x - b.x), tot = s.reduce((a, w) => a + w.w, 0), gap = (x1 - x0 - tot) / (s.length - 1); let x = x0; s.forEach((w) => { w.x = x; x += w.w + gap; }); }
      if (k === "dv" && L.length >= 3) { const s = [...L].sort((a, b) => a.y - b.y), tot = s.reduce((a, w) => a + w.h, 0), gap = (y1 - y0 - tot) / (s.length - 1); let y = y0; s.forEach((w) => { w.y = y; y += w.h + gap; }); }
      L.forEach((w) => B().clamp(w, g, !g.snap || [w.x, w.y].some((v) => v % 1)));
    });
  }
  // §4: a new grid size keeps every widget where it was on the screen
  function regrid(sc, o) { const g0 = G(sc), g1 = { ...g0, ...o }; edit(`Grid ${g1.cols} × ${g1.rows}`, (s) => { for (const k of ["land", "port"]) if (s[k]) B().regrid(s[k], g0, g1); setGrid(s, o); }); }
  // §7: Copy layout from another screen (both orientations; a big screen's widgets stacked for a phone)
  function copyFrom(sc, src) {
    const phone = B().isPhoneScreen(sc), g = G(sc), go = () => edit(`Copied the layout of “${src.name}”${phone && !B().isPhoneScreen(src) ? " (stacked for the phone)" : ""}`, (s) => {
      const fresh = (w) => ({ ...JSON.parse(JSON.stringify(w)), id: "w" + Date.now().toString(36) + Math.floor(Math.random() * 99999) });
      for (const k of ["land", "port"]) { const from = src[k] && src[k].length ? src[k] : src[k === "land" ? "port" : "land"] || [];
        if (phone && !B().isPhoneScreen(src)) { const st = B().stackLayout(from, g.cols); s[k] = st.list.map(fresh); if (st.rows > g.rows) s.grid = { ...g, rows: st.rows }; }
        else { const g0 = B().gridOf(src); s[k] = B().regrid(from.map(fresh), g0, g); } }
      SEL.clear(); sync(); });
    if (listOf(sc).length || (sc.land || []).length || (sc.port || []).length) confirmBox(`Replace “${esc(sc.name)}”’s layout?`, `Both orientations become a copy of “${esc(src.name)}”.`, "Replace", go); else go();
  }

  // ---------------------------------------------------------------- §5 style popover
  function stylePop(at) {
    const sc = scr(), L = sc ? selList(sc) : []; if (!L.length) return;
    const st = B().styleOf(L[0]), title = L.length > 1 ? `${L.length} widgets` : (B().WIDGETS[L[0].type] || { name: L[0].type }).name;
    const bgk = st.bg === "solid" || st.bg === "none" ? st.bg : "col";
    const html = `<div class="rm15sp"><b>${esc(title)} · style</b>
      <h5>Background</h5><div class="segm rm15bg"><button data-bg="solid" class="${bgk === "solid" ? "on" : ""}">Solid</button><button data-bg="none" class="${bgk === "none" ? "on" : ""}">Transparent</button><button data-bg="col" class="${bgk === "col" ? "on" : ""}">${bgk === "col" ? `<i class="rm15sw" style="background:${esc(st.bg)}"></i>` : ""}Colour…</button></div>
      <h5>Align content</h5><div class="rm15alg"><div class="rm15g3">${["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"].map((a) => `<button data-a="${a}" class="${(st.al || "mc") === a ? "on" : ""}" title="${alName(a)}" aria-label="${alName(a)}"><i></i></button>`).join("")}</div><span><b>${alName(st.al || "mc").replace(/^./, (c) => c.toUpperCase())}</b><br>left/centre/right ×<br>top/middle/bottom</span></div>
      <h5>Opacity · <span class="rm15opv">${st.bg === "none" ? 0 : st.op}%</span></h5><input type="range" min="0" max="100" step="5" value="${st.bg === "none" ? 0 : st.op}" class="rm15op">
      <label class="rm15row">Border<button class="tog ${st.border ? "" : "off"}" data-k="border"></button></label>
      <label class="rm15row">Text shadow (for readability)<button class="tog ${st.shadow ? "" : "off"}" data-k="shadow"></button></label>
      <p class="faint">Applies to the selected widgets. Right-click a widget or click its ⋯ for this.</p></div>`;
    popAt(at, html, (p) => {
      p.classList.add("rm15pop");
      const set = (what, f) => { edit(what, (s) => { selList(s).forEach((w) => { w.st = { ...B().styleOf(w) }; f(w.st); }); }, true); refreshWidgets(); stylePopAgain(at); };
      p.querySelectorAll("[data-bg]").forEach((b) => (b.onclick = (e) => { const v = b.dataset.bg;
        if (v === "col") { swatchPop({ left: e.clientX, right: e.clientX, top: e.clientY }, /^#/.test(st.bg) ? st.bg : "#0a84ff", (c) => set("Widget colour", (s) => { s.bg = c; if (!s.op) s.op = 100; })); return; }
        set(v === "none" ? "Transparent widgets" : "Solid widgets", (s) => { s.bg = v; s.op = v === "none" ? 0 : s.op || 100; }); }));
      p.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => set(`Content: ${alName(b.dataset.a)}`, (s) => { s.al = b.dataset.a === "mc" ? "" : b.dataset.a; })));
      const op = p.querySelector(".rm15op"); op.oninput = () => { p.querySelector(".rm15opv").textContent = op.value + "%"; selList(scr()).forEach((w) => { w.st = { ...B().styleOf(w), op: +op.value, bg: B().styleOf(w).bg === "none" && +op.value > 0 ? "solid" : B().styleOf(w).bg }; }); refreshWidgets(); };
      op.onpointerdown = () => { snap(); }; op.onchange = () => { changed(); toast(`Opacity ${op.value}%`, undo); };
      p.querySelectorAll(".tog[data-k]").forEach((b) => (b.onclick = () => { const k = b.dataset.k; set(`${k === "border" ? "Border" : "Text shadow"} ${b.classList.contains("off") ? "on" : "off"}`, (s) => { s[k] = !s[k]; }); }));
    });
  }
  let SPAT = null; const stylePopAgain = (at) => { SPAT = at; setTimeout(() => stylePop(SPAT), 0); };
  function refreshWidgets() { const sc = scr(), area = $("rmArea"); if (!sc || !area) return; for (const w of listOf(sc)) { const el = area.querySelector(`.s5w[data-w="${w.id}"]`); if (el) { el.firstElementChild.setAttribute("style", B().boxStyle(w)); el.setAttribute("style", B().place(w, G(sc))); } } paint(true); }

  // ---------------------------------------------------------------- pointer: select, move, resize, box, guides
  let DRAG = null;
  const local = (e) => { const r = $("bCanv").getBoundingClientRect(), t = safeT(scr()); return { x: (e.clientX - r.left) / K, y: (e.clientY - r.top) / K - t }; };
  function cellsize(sc) { const cs = B().canvasSize(sc, BORI), g = G(sc); return { cw: cs.w / g.cols, ch: (cs.h - safeT(sc) - safeB(sc)) / g.rows, g }; }
  // the guide lines for a moving box (in cells): edges and centres of the other widgets that line up
  function guides(sc, box, others) {
    const out = { v: [], h: [] }, ex = [box.x, box.x + box.w / 2, box.x + box.w], ey = [box.y, box.y + box.h / 2, box.y + box.h];
    for (const o of others) { for (const a of [o.x, o.x + o.w / 2, o.x + o.w]) for (const b of ex) if (Math.abs(a - b) < 0.02) out.v.push(a); for (const a of [o.y, o.y + o.h / 2, o.y + o.h]) for (const b of ey) if (Math.abs(a - b) < 0.02) out.h.push(a); }
    return out;
  }
  // free dragging (⌘): the edges pull to a line-up within 6 px
  function magnet(box, others, cw, ch) {
    let bx = null, by = null;
    for (const o of others) { for (const a of [o.x, o.x + o.w / 2, o.x + o.w]) for (const [b, off] of [[box.x, 0], [box.x + box.w / 2, box.w / 2], [box.x + box.w, box.w]]) { const d = (a - b) * cw; if (Math.abs(d) < 6 && (bx === null || Math.abs(d) < Math.abs(bx.d))) bx = { d, v: a - off }; }
      for (const a of [o.y, o.y + o.h / 2, o.y + o.h]) for (const [b, off] of [[box.y, 0], [box.y + box.h / 2, box.h / 2], [box.y + box.h, box.h]]) { const d = (a - b) * ch; if (Math.abs(d) < 6 && (by === null || Math.abs(d) < Math.abs(by.d))) by = { d, v: a - off }; } }
    if (bx) box.x = bx.v; if (by) box.y = by.v; return box;
  }
  function drawGuides(sc, gl) {
    const area = $("rmArea"); area.querySelectorAll(".rm15gl").forEach((x) => x.remove()); if (!gl || !G(sc).guides) return; const { cw, ch } = cellsize(sc);
    [...new Set(gl.v)].forEach((x) => area.insertAdjacentHTML("beforeend", `<i class="rm15gl v" style="left:${x * cw}px"></i>`));
    [...new Set(gl.h)].forEach((y) => area.insertAdjacentHTML("beforeend", `<i class="rm15gl h" style="top:${y * ch}px"></i>`));
  }
  function onDown(e) {
    const sc = scr(); if (!sc || e.button !== 0) return; const area = $("rmArea"); const wEl = e.target.closest(".s5w");
    if (e.target.closest(".rm15more")) return;
    e.preventDefault(); area.focus({ preventScroll: true });
    const { cw, ch, g } = cellsize(sc), p0 = local(e), add = e.shiftKey || (TX && TX.MAC ? e.metaKey : e.ctrlKey);
    if (!wEl) { // empty canvas: a box selection
      if (!e.shiftKey) SEL.clear(); const base = new Set(SEL); DRAG = { box: true, p0 }; const bx = document.createElement("div"); bx.className = "rm15box"; area.appendChild(bx);
      const mv = (m) => { const p = local(m), x0 = Math.min(p0.x, p.x), y0 = Math.min(p0.y, p.y), x1 = Math.max(p0.x, p.x), y1 = Math.max(p0.y, p.y); Object.assign(bx.style, { left: x0 + "px", top: y0 + "px", width: x1 - x0 + "px", height: y1 - y0 + "px" });
        SEL = new Set(base); listOf(sc).forEach((w) => { if (w.x * cw < x1 && (w.x + w.w) * cw > x0 && w.y * ch < y1 && (w.y + w.h) * ch > y0) SEL.add(w.id); }); area.querySelectorAll(".s5w").forEach((el) => el.classList.toggle("sel", SEL.has(el.dataset.w))); };
      const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); DRAG = null; sync(); render(); };
      addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true); return;
    }
    const id = wEl.dataset.w, rs = e.target.classList.contains("rm15rs");
    if (e.shiftKey) { SEL.has(id) ? SEL.delete(id) : SEL.add(id); sync(); render(); return; }
    // ⌘-click toggles the widget when the pointer lets go without moving; ⌘-drag moves (off the grid)
    const toggleOnUp = add, wasSel = SEL.has(id); if (!SEL.has(id) && !add) { SEL = new Set([id]); sync(); } else if (!SEL.has(id)) SEL.add(id);
    area.querySelectorAll(".s5w").forEach((el) => el.classList.toggle("sel", SEL.has(el.dataset.w)));
    const L = selList(sc), orig = L.map((w) => ({ w, x: w.x, y: w.y, ww: w.w, hh: w.h })), others = listOf(sc).filter((w) => !SEL.has(w.id));
    let moved = false; DRAG = { id };
    const mv = (m) => { const p = local(m), dx = (p.x - p0.x) / cw, dy = (p.y - p0.y) / ch; if (!moved && Math.hypot((p.x - p0.x) * K, (p.y - p0.y) * K) < 4) return;
      if (!moved) { moved = true; snap(); }
      const free = !g.snap || (TX && TX.MAC ? m.metaKey : m.ctrlKey);
      if (rs) { const o = orig[0]; o.w.s5w = o.ww + dx; o.w.h = o.hh + dy; if (!free) { o.w.s5w = Math.round(o.w.s5w); o.w.h = Math.round(o.w.h); } B().clamp(o.w, g, free); }
      else { // the group moves together; the first widget decides the snap
        const o0 = orig[0]; let nx = o0.x + dx, ny = o0.y + dy;
        if (!free) { nx = Math.round(nx); ny = Math.round(ny); } else { const b = magnet({ x: nx, y: ny, w: o0.ww, h: o0.hh }, others, cw, ch); nx = b.x; ny = b.y; }
        const ddx = nx - o0.x, ddy = ny - o0.y; orig.forEach((o) => { o.w.x = o.x + ddx; o.w.y = o.y + ddy; B().clamp(o.w, g, free); }); }
      orig.forEach((o) => { const el = area.querySelector(`.s5w[data-w="${o.w.id}"]`); if (el) el.setAttribute("style", B().place(o.w, g)); });
      const w0 = orig[0].w; drawGuides(sc, guides(sc, w0, others)); };
    const up = () => { removeEventListener("pointermove", mv, true); removeEventListener("pointerup", up, true); DRAG = null; drawGuides(sc, null);
      if (!moved && toggleOnUp && wasSel) { SEL.delete(id); sync(); }
      if (moved) { changed(); toast(rs ? `Resized “${(B().WIDGETS[L[0].type] || {}).name}”` : `Moved ${L.length > 1 ? L.length + " widgets" : "a widget"}`, undo); } render(); };
    addEventListener("pointermove", mv, true); addEventListener("pointerup", up, true);
  }

  // ---------------------------------------------------------------- wiring
  function wire(sc) {
    const q = $;
    q("bAdd").onclick = () => { addScreen(); SEL.clear(); render(); }; if (q("bAdd2")) q("bAdd2").onclick = () => { addScreen(); SEL.clear(); render(); };
    document.querySelectorAll(".bscr").forEach((r) => (r.onclick = () => { BSEL = r.dataset.id; SEL.clear(); sync(); render(); }));
    if (q("bNet")) q("bNet").onchange = (e) => { snap(); BAND.network = e.target.value.trim(); changed(); };
    if (q("bFields")) q("bFields").onclick = () => openSettings("band"); if (q("bTable")) q("bTable").onclick = () => fieldsTable();
    document.querySelectorAll("[data-dev]").forEach((s) => (s.onchange = () => { if (window.SLBandHost) SLBandHost.assign(+s.dataset.dev, s.value || null); }));
    document.querySelectorAll(".bwl").forEach((x) => { x.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "w:" + x.dataset.add); }; x.ondblclick = () => { if (scr()) addWidget(scr(), x.dataset.add); }; });
    if (!sc) return;
    q("bName").onchange = (e) => edit("", (s) => { s.name = e.target.value.trim() || s.name; });
    q("bOri").querySelectorAll("button").forEach((b) => (b.onclick = () => { BORI = b.dataset.v; SEL.clear(); sync(); render(); }));
    q("rmDev").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), cur = B().deviceKey(sc.device);
      ctxMenu({ clientX: r.left, clientY: r.bottom + 4 }, [{ cap: "Made for" }, ...DEVK().map((k) => { const d = B().DEVICES[k]; return { label: d.name, key: k === "custom" ? "w × h" : `${d.w} × ${d.h}`, icon: k === cur ? "✓" : "", act: () => setDevice(sc, k) }; })]); };
    q("rmCopy").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); ctxMenu({ clientX: r.left, clientY: r.bottom + 4 }, [{ cap: "Copy the layout of" }, ...BAND.screens.filter((x) => x !== sc && ((x.land || []).length || (x.port || []).length)).map((x) => ({ label: `${x.name} · ${devName(x)}`, icon: "", act: () => copyFrom(sc, x) }))]); };
    q("bPreset").onclick = (e) => ctxMenu(e, B().PRESETS.map(([k, n]) => ({ label: n, icon: "▦", act: () => { const go = () => edit(`Started “${sc.name}” from the ${n} preset`, (s) => { const p = B().preset(k), g = G(s); for (const o of ["land", "port"]) p[o] = B().regrid(p[o], { cols: 12, rows: 9 }, g); if (B().isPhoneScreen(s)) { p.port = B().stackLayout(p.land, g.cols).list; } Object.assign(s, p); SEL.clear(); sync(); }); if (sc.land.length || sc.port.length) confirmBox(`Replace “${esc(sc.name)}”’s layout?`, `Both orientations start again from the ${n} preset.`, "Replace", go); else go(); } })));
    q("bCol").onclick = (e) => swatchPop({ left: e.clientX, right: e.clientX, top: e.clientY }, sc.col, (c) => edit("Screen colour", (s) => { s.col = c; }));
    q("bDel").onclick = () => confirmBox(`Delete the screen “${esc(sc.name)}”?`, "A device showing it goes back to “Which screen is this?”.", "Delete screen", () => { snap(); BAND.screens = BAND.screens.filter((x) => x !== sc); BSEL = BAND.screens[0] && BAND.screens[0].id; SEL.clear(); sync(); changed(); render(); });
    // the grid steppers and toggles
    document.querySelectorAll(".rm15st").forEach((s) => { const k = s.dataset.k, inp = s.querySelector("input"), lim = k === "gap" ? [0, 24] : [2, 48];
      const go = (v) => { v = Math.max(lim[0], Math.min(lim[1], Math.round(+v || 0))); if (v === G(sc)[k]) { inp.value = v; return; } if (k === "gap") edit(`Gap ${v} px`, (x) => setGrid(x, { gap: v })); else regrid(sc, { [k]: v }); };
      s.querySelectorAll("button").forEach((b) => (b.onclick = () => go(G(sc)[k] + +b.dataset.d))); inp.onchange = () => go(inp.value); inp.onkeydown = (e) => { if (e.key === "Enter") go(inp.value); }; });
    document.querySelectorAll(".rm15tg").forEach((b) => (b.onclick = () => { const k = b.dataset.t, v = !G(sc)[k]; edit(`${k === "snap" ? "Snap" : "Guides"} ${v ? "on" : "off"}`, (x) => setGrid(x, { [k]: v })); }));
    document.querySelectorAll("[data-al]").forEach((b) => (b.onclick = () => align(b.dataset.al)));
    for (const id of ["rmStyle", "rmStyle2"]) if (q(id)) q(id).onclick = (e) => stylePop(e.currentTarget);
    if (q("rmDelW")) q("rmDelW").onclick = delSel;
    // x / y / w / h
    document.querySelectorAll("[data-xy]").forEach((i) => (i.onchange = () => { const k = i.dataset.xy, g = G(sc); edit("", (s) => { const w = selList(s)[0]; if (!w) return; w[k] = k === "x" || k === "y" ? +i.value - 0 : +i.value; B().clamp(w, g, !g.snap); }); }));
    // the selected widget's own settings (what it shows / does)
    wireSettings(sc);
    // the canvas: pointer, drop from the list, right-click
    const area = q("rmArea"); area.tabIndex = -1; area.onpointerdown = onDown;
    const dev = q("bCanv"); dev.ondragover = (e) => e.preventDefault();
    dev.ondrop = (e) => { e.preventDefault(); const t = e.dataTransfer.getData("text/plain"); if (!t.startsWith("w:")) return; const p = local(e), { cw, ch } = cellsize(sc); addWidget(sc, t.slice(2), Math.floor(p.x / cw), Math.max(0, Math.floor(p.y / ch))); };
    area.oncontextmenu = (e) => { const wEl = e.target.closest(".s5w"); if (!wEl) return; e.preventDefault(); if (!SEL.has(wEl.dataset.w)) { SEL = new Set([wEl.dataset.w]); sync(); render(); } menu(e); };
    area.querySelectorAll(".rm15more").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const id = b.closest(".s5w").dataset.w; if (!SEL.has(id)) { SEL = new Set([id]); sync(); render(); } const r = (document.querySelector(`#rmArea .s5w[data-w="${id}"] .rm15more`) || b).getBoundingClientRect(); menu({ clientX: r.left, clientY: r.bottom + 4 }); }));
  }
  function menu(e) { const n = SEL.size; ctxMenu(e, [{ label: "Style…", icon: "", act: () => stylePop({ left: e.clientX, right: e.clientX, top: e.clientY }) }, { label: "Duplicate", icon: "⊕", key: "⌘D", act: () => dupSel(false) }, { label: "Copy", icon: "⧉", key: "⌘C", act: copySel }, "-", { label: n > 1 ? `Remove ${n} widgets` : "Remove widget", icon: "⌫", danger: true, act: delSel }]); }
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
    if (!bandOn || !scr()) return; const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (document.querySelector(".cfbg")) return;
    const cmd = TX && TX.MAC ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase(), take = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (cmd && k === "a" && !e.shiftKey) { take(); selectAll(); return; }
    if ((cmd && e.shiftKey && k === "a") || (e.key === "Escape" && SEL.size)) { take(); deselect(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && SEL.size) { take(); delSel(); return; }
    if (cmd && k === "d" && SEL.size) { take(); dupSel(false); return; }
    if (cmd && k === "c" && SEL.size) { take(); copySel(); return; }
    if (cmd && k === "v" && CB) { take(); dupSel(true); return; }
    if (!cmd && SEL.size && /^Arrow/.test(e.key)) { take(); const st = e.altKey ? 0.25 : e.shiftKey ? 2 : 1; nudge(e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0); }
  }, true);
  function selectAll() { const sc = scr(); if (!sc) return 0; SEL = new Set(listOf(sc).map((w) => w.id)); sync(); render(); return SEL.size; }
  function deselect() { SEL.clear(); sync(); render(); }

  // the page's renderBand is this editor now; the old Delete key handler would delete only BWID
  window.renderBand = render;
  window.SL15R = { render, selectAll, deselect, selected: () => [...SEL], select: (ids) => { SEL = new Set(ids); sync(); render(); }, align, regrid: (o) => scr() && regrid(scr(), o), copyFrom: (id) => { const s = BAND.screens.find((x) => x.id === id); if (s && scr()) copyFrom(scr(), s); }, setDevice: (k) => scr() && setDevice(scr(), k), stylePop, nudge, addWidget: (t, x, y) => addWidget(scr(), t, x, y), paint, scale: () => K, data, setStyle: (f) => edit("", (s) => selList(s).forEach((w) => { w.st = { ...B().styleOf(w) }; f(w.st); })) };
})();
