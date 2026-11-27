// set.Line 10a: drag and reorder everywhere (pointer events), renaming songs, ⌥↑ / ⌥↓, MIDI tracks at the bottom.
//
// Why pointer events: on the Mac the app's window takes dragged files itself (app-gui/MacDrop.mm unregisters the
// WKWebView from every drag type), so the page's own HTML5 drags start but never reach a drop target there. Every
// drag in the page now goes through SLDrag: pointerdown / move / up, a 4 px threshold, a ghost under the pointer,
// a landing line and auto-scroll near the edges of whatever list it's over. Files dragged in from the Finder or
// Explorer still come through the app (MacDrop.mm, WebView2), untouched.
//
// The drags:
// - a card, a Folders row or a library row onto the setlist sidebar (orange landing line), several when selected
// - setlist items, songs and breaks, within the setlist (orange line; a selection moves as a group)
// - track headers within their song, in Folders and in one song (blue line)
// - the older HTML5 drags (version sections, presets onto the MIDI timeline, Quad Cortex / Axe-Fx presets and scenes
//   onto a lane, band screen widgets): elements marked data-drag10 get the same pointer drag, and their existing
//   dragstart / dragover / drop handlers are called with a stand-in dataTransfer
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const editing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const busy = () => typeof playing !== "undefined" && playing;
  const songOf = (id) => songs.find((x) => x.id === id);

  // ================================================================ SLDrag: the one drag helper
  const DEFS = [];
  let P = null; // pressed, not moved 4 px yet
  let D = null; // the drag
  let ghost = null, line = null, raf = 0;
  const THRESH = 4;
  function addDrag(def) { DEFS.push(def); }
  function findDef(e) {
    for (const d of DEFS) {
      const el = e.target.closest && e.target.closest(d.sel); if (!el) continue;
      if (d.skip && e.target.closest(d.skip)) return null;
      if (d.ok && !d.ok(el, e)) continue;
      return { def: d, el };
    }
    return null;
  }
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || D) return;
    if (editing(e.target)) return;
    const f = findDef(e); if (!f) return;
    P = { ...f, x0: e.clientX, y0: e.clientY, id: e.pointerId, alt: e.altKey };
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (P && !D) {
      if (Math.hypot(e.clientX - P.x0, e.clientY - P.y0) < THRESH) return;
      if (!(e.buttons & 1)) { P = null; return; }
      begin(e);
    }
    if (!D) return;
    e.preventDefault();
    D.x = e.clientX; D.y = e.clientY; D.alt = e.altKey;
    place();
    tick();
  }, true);
  document.addEventListener("pointerup", (e) => { if (D) { e.preventDefault(); finish(true); } P = null; }, true);
  document.addEventListener("pointercancel", () => { if (D) finish(false); P = null; }, true);
  window.addEventListener("blur", () => { if (D) finish(false); P = null; });
  document.addEventListener("keydown", (e) => { if (D && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish(false); } }, true);
  // the click a drag ends with does nothing (it would open the card or the track)
  let eat = null; // {t, x, y}: the click the browser sends right after the pointerup, at the same place
  document.addEventListener("click", (e) => { if (eat && performance.now() < eat.t && Math.hypot(e.clientX - eat.x, e.clientY - eat.y) < 8) { eat = null; e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  function begin(e) {
    const { def, el } = P; P = null;
    D = { def, el, x: e.clientX, y: e.clientY, alt: e.altKey, data: {}, under: null, at: null };
    if (def.start && def.start(D) === false) { D = null; return; }
    try { const s = getSelection(); if (s) s.removeAllRanges(); } catch (x) {}
    document.body.classList.add("drag10");
    (D.srcEls || [el]).forEach((x) => x.classList.add("drag10src"));
    ghost = document.createElement("div"); ghost.className = "ghost10";
    ghost.textContent = D.label || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (D.color) ghost.style.setProperty("--c", D.color);
    document.body.appendChild(ghost);
    line = document.createElement("div"); line.className = "line10"; line.hidden = true; document.body.appendChild(line);
    place();
    tick();
  }
  // what's under the pointer, the landing line, the ghost
  function place() {
    if (!D) return;
    ghost.style.left = D.x + "px"; ghost.style.top = D.y + "px";
    D.under = document.elementFromPoint(D.x, D.y);
    D.at = null; line.hidden = true;
    if (D.def.move) D.def.move(D);
    if (D.line) { const L = D.line; line.hidden = false; line.className = "line10 " + (L.cls || ""); Object.assign(line.style, { left: L.left + "px", top: L.top - 1.5 + "px", width: L.width + "px" }); D.line = null; }
    ghost.classList.toggle("no", !D.at && !D.def.anywhere);
  }
  // auto-scroll: near the top or bottom edge of the list under the pointer (and the sides of the timeline)
  function scrollerOf(el) {
    for (let x = el; x && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (/(auto|scroll)/.test(cs.overflowY) && x.scrollHeight > x.clientHeight + 1) return x;
    }
    return null;
  }
  function tick() {
    if (raf || !D) return;
    raf = requestAnimationFrame(() => {
      raf = 0; if (!D) return;
      const sc = D.under && scrollerOf(D.under); let moved = false;
      if (sc) {
        const r = sc.getBoundingClientRect(), E = 36;
        const sp = D.y < r.top + E ? -Math.ceil((r.top + E - D.y) / 3) : D.y > r.bottom - E ? Math.ceil((D.y - (r.bottom - E)) / 3) : 0;
        if (sp) { const t0 = sc.scrollTop; sc.scrollTop += sp; moved = sc.scrollTop !== t0; }
      }
      if (moved) { place(); tick(); }
    });
  }
  function finish(drop) {
    const d = D; D = null;
    document.body.classList.remove("drag10");
    document.querySelectorAll(".drag10src").forEach((x) => x.classList.remove("drag10src"));
    if (ghost) ghost.remove(); if (line) line.remove(); ghost = line = null;
    eat = { t: performance.now() + 120, x: d.x, y: d.y };
    try { if (drop && d.def.drop) d.def.drop(d); else if (d.def.cancel) d.def.cancel(d); }
    catch (e) { console.error("set.Line drag", e); }
  }

  // ---------------------------------------------------------------- the older HTML5 drags, driven by the pointer
  // Their own handlers stay: a stand-in dataTransfer goes with synthetic dragstart / dragenter / dragover /
  // dragleave / drop / dragend events (a drop only where a dragover was accepted, as in HTML5).
  function fakeDT() {
    const data = {};
    return { data, types: [], files: [], items: [], effectAllowed: "all", dropEffect: "none",
      setData(k, v) { data[k] = String(v); if (!this.types.includes(k)) this.types.push(k); }, getData(k) { return data[k] !== undefined ? data[k] : ""; },
      clearData() { for (const k in data) delete data[k]; this.types.length = 0; }, setDragImage() {} };
  }
  function fire(target, type, d) {
    if (!target) return false;
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: d.x, clientY: d.y, altKey: !!d.alt, view: window });
    Object.defineProperty(ev, "dataTransfer", { value: d.dt });
    return !target.dispatchEvent(ev); // true: a handler called preventDefault (accepted)
  }
  addDrag({
    sel: "[data-drag10]", anywhere: true,
    start(d) { d.dt = fakeDT(); fire(d.el, "dragstart", d); if (!d.dt.types.length) d.dt.setData("text/plain", d.el.dataset.drag10 || ""); },
    move(d) {
      const t = d.under; if (t !== d.over) { if (d.over) fire(d.over, "dragleave", d); if (t) fire(t, "dragenter", d); d.over = t; }
      d.ok = t ? fire(t, "dragover", d) : false; if (d.ok) d.at = t;
    },
    drop(d) { if (d.ok && d.over) fire(d.over, "drop", d); else if (d.over) fire(d.over, "dragleave", d); fire(d.el, "dragend", d); },
    cancel(d) { if (d.over) fire(d.over, "dragleave", d); fire(d.el, "dragend", d); },
  });

  // ================================================================ the setlist: songs and breaks as one list
  const curList = () => curSetObj();
  const brks = () => { const l = curList(); return l.breaks || (l.breaks = []); };
  // [{kind:'song', id} | {kind:'break', b}] in the order shown
  const items = () => (window.SLBreaks ? SLBreaks.items() : setOrder.map((id) => ({ kind: "song", id })));
  const keyOf = (it) => (it.kind === "song" ? "s:" + it.id : "b:" + it.b.id);
  // write a new order back: the songs in setOrder, each break after the song before it (or at the start)
  function applyItems(list) {
    const ids = [], bs = []; let after = "";
    for (const it of list) { if (it.kind === "song") { ids.push(it.id); after = it.id; } else { it.b.after = after; bs.push(it.b); } }
    setOrder.splice(0, setOrder.length, ...ids);
    const arr = brks(); arr.splice(0, arr.length, ...bs);
  }
  // move the items with these keys so they land before the item at index `at` of the current list (or at the end)
  function moveItems(keys, at) {
    const all = items(), set = new Set(keys), mv = all.filter((x) => set.has(keyOf(x))), rest = all.filter((x) => !set.has(keyOf(x)));
    if (!mv.length) return false;
    const before = all.slice(0, at).filter((x) => set.has(keyOf(x))).length;
    const k = Math.max(0, Math.min(rest.length, at - before));
    const out = [...rest.slice(0, k), ...mv, ...rest.slice(k)];
    if (out.map(keyOf).join() === all.map(keyOf).join()) return false;
    snap(); applyItems(out); refresh(); if (window.SLE && SLE.nextChanged) SLE.nextChanged();
    return true;
  }
  const nameOfKey = (k) => { if (k.startsWith("s:")) { const s = songOf(k.slice(2)); return s ? s.name : "?"; } const b = brks().find((x) => x.id === k.slice(2)); return b ? b.label : "break"; };
  const posOf = (k) => { const i = items().findIndex((x) => keyOf(x) === k); return i; };
  function movedNote(keys) {
    const n = keys.length, i = posOf(keys[0]), L = items().length;
    const where = i === 0 ? "to the top" : i + n >= L ? "to the end" : `to #${i + 1}`;
    toast(`Moved ${n > 1 ? n + " items" : "“" + nameOfKey(keys[0]) + "”"} ${where} in ${curList().name}`, undo);
  }
  // insert library songs at items index `at`
  function insertSongs(ids, at) {
    const all = items(), fresh = ids.filter((id) => !setOrder.includes(id) && songOf(id)), have = ids.filter((id) => setOrder.includes(id));
    if (!fresh.length && have.length) { // already in the set: move it there (one song: ask first, as in 9b)
      const go = () => { if (moveItems(have.map((id) => "s:" + id), at)) movedNote(have.map((id) => "s:" + id)); };
      if (have.length > 1) { go(); return; }
      const s = songOf(have[0]);
      confirmBox(`“${esc(s.name)}” is already in this setlist`, `It’s #${setOrder.indexOf(s.id) + 1}. Move it here? (To play it twice, duplicate the song first: right-click › Duplicate.)`, "Move it here", go);
      return;
    }
    if (!fresh.length) return;
    snap();
    const out = [...all.slice(0, at), ...fresh.map((id) => ({ kind: "song", id })), ...all.slice(at)];
    applyItems(out); refresh(); if (window.SLE && SLE.nextChanged) SLE.nextChanged();
    toast(`Added ${fresh.length > 1 ? fresh.length + " songs" : "“" + songOf(fresh[0]).name + "”"} to ${curList().name}${have.length ? ` (${have.length} already in it)` : ""}`, undo);
  }
  // where in the sidebar the pointer is: the index in items() and the line's position
  function setSlot(d) {
    const box = $("songs"); if (!box) return null;
    const r0 = box.getBoundingClientRect();
    if (d.x < r0.left - 10 || d.x > r0.right + 10 || d.y < r0.top - 24 || d.y > Math.max(r0.bottom, r0.top + 60) + 24) return null;
    const rows = [...box.querySelectorAll(":scope > .song, :scope > .brk9")];
    let at = rows.length;
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (d.y < r.top + r.height / 2) { at = i; break; } }
    const ref = rows[at] || rows[rows.length - 1];
    const rr = ref ? ref.getBoundingClientRect() : { left: r0.left + 8, right: r0.right - 8, top: r0.top + 6, bottom: r0.top + 6 };
    d.line = { left: rr.left, width: rr.right - rr.left, top: rows[at] ? rr.top - 1 : rr.bottom + 1, cls: "" };
    return at;
  }
  // a song dragged from the cards, a Folders row or the library list (several when they're selected)
  const libIds = (id) => (typeof songSel !== "undefined" && songSel.size > 1 && songSel.has(id) ? [...songSel] : [id]);
  addDrag({
    sel: ".card9[data-id], .r9h[data-id], #pool .ps[data-id]", skip: ".r9x, .addx, .ck9, input, button, select",
    start(d) {
      const id = d.el.dataset.id, s = songOf(id); if (!s) return false;
      d.ids = libIds(id); d.label = d.ids.length > 1 ? `${d.ids.length} songs` : s.name; d.color = s.col;
      d.srcEls = d.ids.map((x) => document.querySelector(`.card9[data-id="${x}"], .row9[data-row="${x}"], #pool .ps[data-id="${x}"]`)).filter(Boolean);
    },
    move(d) { const at = setSlot(d); if (at != null) { d.at = $("songs"); d.slot = at; } },
    drop(d) { if (d.slot == null || !d.at) return; insertSongs(d.ids, d.slot); },
  });
  // a setlist item (song or break): reorder; a selection of songs moves as a group
  addDrag({
    sel: "#songs .song[data-id], #songs .brk9[data-b]", skip: ".rmx, .var, .vprev, .vnext, .ck9, input, button, select",
    start(d) {
      const el = d.el;
      if (el.dataset.b) { d.keys = ["b:" + el.dataset.b]; d.label = (el.querySelector(".bt") || el).textContent; }
      else { const id = el.dataset.id; const sel = typeof songSel !== "undefined" && songSel.size > 1 && songSel.has(id) ? setOrder.filter((x) => songSel.has(x)) : [id];
        d.keys = sel.map((x) => "s:" + x); const s = songOf(id); d.label = sel.length > 1 ? `${sel.length} songs` : s.name; d.color = s.col; }
      d.srcEls = d.keys.map((k) => document.querySelector(k[0] === "s" ? `#songs .song[data-id="${k.slice(2)}"]` : `#songs .brk9[data-b="${k.slice(2)}"]`)).filter(Boolean);
    },
    move(d) { const at = setSlot(d); if (at != null) { d.at = $("songs"); d.slot = at; } },
    drop(d) { if (d.slot == null || !d.at) return; if (moveItems(d.keys, d.slot)) movedNote(d.keys); },
  });

  // ================================================================ tracks: drag a header up or down (blue line)
  const TSKIP = ".rsz9, .ctab, .ochip, .hf, .ms, .hm, .mb, .sb, button, input, select, label, .modst";
  const trackRows = (lh) => { const body = lh.closest(".fbody") || lh.closest(".folder") || document; return [...body.querySelectorAll(`.row.trk > .lh[data-song="${lh.dataset.song}"]`)]; };
  addDrag({
    sel: ".row.trk > .lh[data-track]", skip: TSKIP,
    start(d) { const s = songOf(d.el.dataset.song); if (!s) return false; d.s = s; d.t = d.el.dataset.track; d.label = d.t; d.color = typeof trackCol === "function" ? trackCol(s, d.t) : ""; d.srcEls = [d.el.parentElement]; },
    move(d) {
      const rows = trackRows(d.el); if (!rows.length) return;
      const first = rows[0].parentElement.getBoundingClientRect(), last = rows[rows.length - 1].parentElement.getBoundingClientRect();
      if (d.y < first.top - 30 || d.y > last.bottom + 30) return;
      const sc = $("scroller").getBoundingClientRect();
      if (d.x < sc.left - 10 || d.x > sc.right + 10) return;
      let at = rows.length;
      for (let i = 0; i < rows.length; i++) { const r = rows[i].parentElement.getBoundingClientRect(); if (d.y < r.top + r.height / 2) { at = i; break; } }
      const ref = (rows[at] || rows[rows.length - 1]).parentElement.getBoundingClientRect();
      d.line = { left: Math.max(sc.left, ref.left), width: Math.min(sc.right, ref.right) - Math.max(sc.left, ref.left), top: rows[at] ? ref.top : ref.bottom, cls: "blue" };
      d.at = d.el; d.slot = at; d.rows = rows;
    },
    drop(d) {
      if (d.slot == null || !d.at) return;
      const names = d.rows.map((lh) => lh.dataset.track), before = names[d.slot]; // undefined: after the last one shown
      moveTrackTo(d.s, d.t, before === undefined ? { after: names[names.length - 1] } : { before });
    },
  });
  // move track t of song s before / after another track (s.tracks order: saved with the song)
  function moveTrackTo(s, t, where) {
    const L = s.tracks, i = L.indexOf(t); if (i < 0) return false;
    const out = L.filter((x) => x !== t);
    let k = where.before !== undefined ? out.indexOf(where.before) : out.indexOf(where.after) + 1;
    if (k < 0) k = out.length;
    out.splice(k, 0, t);
    if (out.join("\u0001") === L.join("\u0001")) return false;
    snap(); L.splice(0, L.length, ...out); refresh();
    const n = out.indexOf(t);
    toast(`Moved “${t}” ${n === 0 ? "to the top" : n === out.length - 1 ? "to the bottom" : "below “" + out[n - 1] + "”"} in ${s.name}`, undo);
    return true;
  }
  // one step up or down among the tracks shown (another version's own audio isn't shown)
  function stepTrack(s, t, dir) {
    const shown = s.tracks.filter((x) => typeof trackInVer !== "function" || trackInVer(s, x, curVer(s))), i = shown.indexOf(t), j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return false;
    return moveTrackTo(s, t, dir < 0 ? { before: shown[j] } : { after: shown[j] });
  }

  // ================================================================ ⌥↑ / ⌥↓: the selected setlist item or track
  let area = "set"; // where the last click was: 'set' (setlist, cards, rows) or 'track'
  document.addEventListener("pointerdown", (e) => {
    const t = e.target; if (!t.closest) return;
    if (t.closest(".row.trk > .lh") || t.closest("#rpanel .rh") || t.closest(".tpanel")) area = "track";
    else if (t.closest("#songs, .card9, .row9 .r9h, #pool")) area = "set";
  }, true);
  function selectedSetKeys() {
    const b = document.querySelector("#songs .brk9.on");
    if (b) return ["b:" + b.dataset.b];
    if (typeof songSel !== "undefined" && songSel.size > 1) { const ks = setOrder.filter((x) => songSel.has(x)); if (ks.length) return ks.map((x) => "s:" + x); }
    return selId && setOrder.includes(selId) ? ["s:" + selId] : [];
  }
  function stepSet(dir) {
    const keys = selectedSetKeys(); if (!keys.length) return false;
    const all = items(), idx = keys.map((k) => all.findIndex((x) => keyOf(x) === k)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (!idx.length) return false;
    const at = dir < 0 ? idx[0] - 1 : idx[idx.length - 1] + 2;
    if (at < 0 || at > all.length) return false;
    if (moveItems(keys, at)) { movedNote(keys); return true; }
    return false;
  }
  function moveSel(dir) {
    if (area === "track" && typeof trackOpen !== "undefined" && trackOpen) { const s = songOf(trackOpen.song); if (s) { stepTrack(s, trackOpen.track, dir); return; } }
    stepSet(dir);
  }
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    if (editing(e.target) || document.querySelector(".cfbg, .xm.ctx")) return;
    e.preventDefault(); e.stopImmediatePropagation(); moveSel(e.key === "ArrowUp" ? -1 : 1);
  }, true);

  // ================================================================ renaming a song
  // Before: "Rename…" re-drew the song list and looked for the old song folder's title (.folder .fh .nm), which
  // the 9b Cards / Folders views don't have, so nothing happened; a double-click landed on a row the first click
  // had just re-drawn. Now every place edits the name where it is: a card, a Folders row, a setlist row, the big
  // title of the opened song.
  // 11: the name in the place that was double-clicked (the setlist row, not the card behind it)
  const nameIn = (h) => { const el = h.sel.startsWith("#songs") ? document.querySelector(`#songs .song[data-id="${h.id}"] .nm11`) : h.sel.startsWith(".card9") ? document.querySelector(`.card9[data-id="${h.id}"] .c9h b`) : h.sel.startsWith(".row9") ? document.querySelector(`.row9[data-row="${h.id}"] .r9n`) : null; return el && el.getBoundingClientRect().width > 0 ? el : null; };
  function nameEl(id) {
    if (area === "set") { const r = document.querySelector(`#songs .song[data-id="${id}"] .nm11`); if (r && r.getBoundingClientRect().width > 0) return r; } // ↩ in the setlist: its row
    const FS = typeof focusSong === "function" ? focusSong() : null;
    const c = [FS && FS.id === id && document.querySelector("#hero .htitle h2"), document.querySelector(`.card9[data-id="${id}"] .c9h b`), document.querySelector(`.row9[data-row="${id}"] .r9n`),
      document.querySelector(`#songs .song[data-id="${id}"] .nm11`), document.querySelector(`.folder[data-id="${id}"] .fh .nm`)];
    return c.find((x) => x && x.getBoundingClientRect().width > 0) || null;
  }
  let editor = null;
  // an input over el (its own font and size); ↩ or clicking away saves, Esc cancels
  // 11: the name itself becomes editable where it is: the field takes the name's exact box (left, top, height,
  // width), font, size, weight, colour and padding, and the name under it hides; it grows to the right as you
  // type (up to its row's edge), so nothing moves or resizes. el can also be a plain rect ({left, top, width,
  // height}) for a name drawn on a canvas (a cue), with o.font.
  const opaqueBg = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c)) return c; } return "#111214"; };
  function editInline(el, value, done, o = {}) {
    if (editor) editor.end(false);
    document.body.classList.add("ren11on"); // no ✎ hint in the name's box while it's measured
    const isEl = !!(el && el.nodeType === 1);
    let r = isEl ? el.getBoundingClientRect() : el;
    if (!r || !r.width || !r.height) { r = { left: innerWidth / 2 - 140, top: innerHeight / 3, width: 280, height: 30 }; el = null; }
    const cs = isEl && el ? getComputedStyle(el) : null;
    const i = document.createElement("input"); i.className = "ren10"; i.value = value; i.spellcheck = false; i.maxLength = o.max || 80;
    i.setAttribute("aria-label", o.label || "Name");
    const row = isEl && el ? el.closest(o.row || "#songs > .song, #songs > .brk9, .card9, .r9h, .row.trk > .lh, .sec, .vr, .folder .fh, .setpick, .mkr, #hero, .lh, li, tr") : null;
    const maxR = Math.min(innerWidth - 4, o.maxRight || (row ? row.getBoundingClientRect().right - 2 : r.left + Math.max(r.width, 260)));
    const st = { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" };
    if (cs) Object.assign(st, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform,
      color: cs.color, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, paddingTop: "0px", paddingBottom: "0px", textAlign: cs.textAlign === "center" ? "center" : "left", borderRadius: cs.borderRadius, background: opaqueBg(el) });
    else if (o.font) Object.assign(st, { font: o.font, paddingLeft: (o.pad || 0) + "px", paddingRight: "0px", background: o.bg || "#2a2f37", color: o.color || "#fff", borderRadius: "5px" });
    Object.assign(i.style, st);
    document.body.appendChild(i);
    // the field grows with its text (never smaller than the name was)
    const meas = document.createElement("canvas").getContext("2d");
    const fit = () => { const c = getComputedStyle(i); meas.font = `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
      const w = meas.measureText(i.value).width + parseFloat(c.paddingLeft) + parseFloat(c.paddingRight) + 6;
      i.style.width = Math.max(r.width, Math.min(maxR - r.left, w)) + "px"; };
    i.addEventListener("input", fit);
    const hid = isEl && el ? el : null; if (hid) hid.style.visibility = "hidden";
    let over = false;
    const end = (save) => { if (over) return; over = true; editor = null; document.body.classList.remove("ren11on"); const v = i.value.trim(); i.remove(); if (hid) hid.style.visibility = ""; if (save && v && v !== value) done(v); else if (o.cancel) o.cancel(); };
    editor = { end, input: i };
    i.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); end(true); } else if (e.key === "Escape") { e.preventDefault(); end(false); } });
    i.addEventListener("blur", () => end(true));
    ["pointerdown", "click", "dblclick", "mousedown"].forEach((t) => i.addEventListener(t, (e) => e.stopPropagation()));
    requestAnimationFrame(() => { i.focus(); i.select(); });
    setTimeout(() => { if (document.activeElement !== i && !over) { i.focus(); i.select(); } }, 30);
    return i;
  }
  function renameSong(id, el) {
    const s = songOf(id); if (!s) return;
    el = el || nameEl(id);
    if (el && el.scrollIntoView && el.getBoundingClientRect().bottom > innerHeight) el.scrollIntoView({ block: "nearest" });
    editInline(el, s.name, (v) => {
      const old = s.name; snap(); s.name = v; refresh();
      toast(`Renamed “${old}” to “${v}”`, undo);
      if (window.SLE && SLE.nextChanged) SLE.nextChanged();
    });
  }
  window.renameSong = renameSong; // the page's songMenu, the menus and ⌘K call it by name
  // double-click a name: a card, a Folders row, a setlist row, the opened song's title. Two clicks are counted by
  // hand (the first click re-draws the setlist row, so the browser's own dblclick may never come).
  const NAMES = [
    [".card9[data-id] .c9h b", (el) => el.closest(".card9").dataset.id],
    [".row9[data-row] .r9n", (el) => el.closest(".row9").dataset.row],
    ["#songs .song[data-id] .t", (el) => el.closest(".song").dataset.id], // the name (11: not the version switcher under it)
    ["#hero .htitle h2", () => { const FS = focusSong(); return FS && FS.id; }],
  ];
  let lastClick = null, renamedAt = 0;
  const hitName = (e) => { if (e.target.closest && e.target.closest(".vrow11")) return null; for (const [sel, idOf] of NAMES) { const el = e.target.closest && e.target.closest(sel); if (el) { const id = idOf(el); if (id) return { sel, id }; } } return null; };
  document.addEventListener("click", (e) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || (window.SL9 && SL9.state.sel)) { lastClick = null; return; }
    const h = hitName(e); const now = performance.now();
    if (!h) { lastClick = null; return; }
    if (lastClick && lastClick.id === h.id && lastClick.sel === h.sel && now - lastClick.t < 500 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8) {
      lastClick = null; renamedAt = now; e.preventDefault(); e.stopImmediatePropagation();
      setTimeout(() => renameSong(h.id, nameIn(h)), 0); // after the page's own handlers have re-drawn; 11: on the name that was double-clicked
      return;
    }
    lastClick = { ...h, t: now, x: e.clientX, y: e.clientY };
  }, true);
  // the browser's own dblclick that follows: no "open the song" on top of the rename
  document.addEventListener("dblclick", (e) => { if (performance.now() - renamedAt < 600 && hitName(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  // ↩ on a selected song renames it (a card, a Folders row, a setlist row); ⌘↓ / double-click elsewhere opens it
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || editing(e.target) || editor) return;
    if (document.querySelector(".cfbg, .xm.ctx, #mpop, #tpop, .ipop, .pal10")) return;
    if (document.body.classList.contains("pf") || (typeof perfOn !== "undefined" && perfOn)) return;
    const t = e.target, card = t.closest && t.closest(".card9[data-id]");
    const id = card ? card.dataset.id : selId; if (!id || !songOf(id)) return;
    if (!card && area === "track") return;
    e.preventDefault(); e.stopImmediatePropagation(); renameSong(id);
  }, true);

  // ================================================================ MIDI tracks at the bottom
  const isMidi = (s, t) => !!(s.midiCfg && s.midiCfg[t]);
  // stable: audio, click and cue tracks keep their order, then the MIDI tracks in theirs
  function midiLast(s) { const a = s.tracks.filter((t) => !isMidi(s, t)), m = s.tracks.filter((t) => isMidi(s, t)); const out = [...a, ...m]; const ch = out.some((t, i) => t !== s.tracks[i]); if (ch) s.tracks.splice(0, s.tracks.length, ...out); return ch; }
  function sortMidi(ids) {
    const list = (ids && ids.length ? ids : [selId]).map(songOf).filter(Boolean);
    const need = list.filter((s) => { const a = s.tracks.filter((t) => !isMidi(s, t)), m = s.tracks.filter((t) => isMidi(s, t)); return [...a, ...m].some((t, i) => t !== s.tracks[i]); });
    if (!need.length) { toast(list.length > 1 ? "The MIDI tracks are already at the bottom in those songs" : "The MIDI tracks are already at the bottom"); return 0; }
    snap(); need.forEach(midiLast); refresh();
    toast(`Moved the MIDI tracks to the bottom in ${need.length > 1 ? need.length + " songs" : "“" + need[0].name + "”"}`, undo);
    return need.length;
  }
  // a new audio or click track goes above the MIDI tracks that sit at the bottom (a new MIDI track: at the bottom)
  function aboveMidi(s, name) {
    const L = s.tracks, i = L.indexOf(name); if (i < 0 || isMidi(s, name)) return;
    let k = L.length; while (k > 0 && isMidi(s, L[k - 1])) k--;
    if (i >= k && k < L.length) { L.splice(i, 1); L.splice(k, 0, name); }
  }

  window.SLDrag = { add: addDrag, active: () => !!D, items, moveItems, insertSongs, moveTrackTo, stepTrack, stepSet, moveSel, area: () => area, setArea: (a) => { area = a; } };
  window.SL10a = { renameSong, editInline, nameEl, midiLast, sortMidi, aboveMidi, isMidi };
})();
