// set.Line 9b: the Show screen. The setlist sidebar on the left; in the centre a Cards / Folders toggle:
//  - Cards: the library as a wall of song cards (Songs / Setlists / Presets tabs, All / Not in this set, search);
//    double-click a card (or click a song in the setlist) to open that one song's timeline (← Library / Esc).
//  - Folders: one slim row per song (setlist order, then the rest), each opening inline; "Only one song open at a
//    time" (on by default), Collapse all (⌥⌘←).
// Select mode (checkboxes + a floating action bar), the track menu (Delete track), smooth zoom (centred on the
// pointer, presets, Fit, drag across the ruler, the overview strip). Loaded after the page script; it wraps its
// renderers (renderFolders / renderSetlist) and uses its globals.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const libKey = () => { const n = ($("crumbAll") && $("crumbAll").textContent) || "Library"; return "setline.view." + n; };
  const S9 = {
    view: "cards", tab: "songs", filt: "all", q: "", oneOpen: localStorage.getItem("setline.oneOpen") !== "0", sel: false,
    timings: [], // {what, ms} (Diagnostics timing log)
  };
  // (older test scripts drive the folders: window.SL9_TEST_DEFAULT / SL9_ONEOPEN, in memory only)
  const loadView = () => { const v = localStorage.getItem(libKey()); S9.view = v === "folders" || v === "cards" ? v : window.SL9_TEST_DEFAULT || "cards"; if (window.SL9_ONEOPEN === false) S9.oneOpen = false; };
  loadView();
  const timing = (what, t0) => { const ms = performance.now() - t0; S9.timings.push({ what, ms: Math.round(ms * 10) / 10, at: Date.now() }); if (S9.timings.length > 200) S9.timings.shift(); report(); return ms; };
  // the Diagnostics timing log: medians / worst of opening and closing folders and of zoom frames (sent to the app)
  const stat = (re) => { const a = S9.timings.filter((x) => re.test(x.what)).map((x) => x.ms).sort((p, q) => p - q); return a.length ? `${a[Math.floor(a.length / 2)]} ms median, ${a[a.length - 1]} worst (${a.length})` : "–"; };
  const summary = () => `open a song ${stat(/^open /)}; close ${stat(/^close /)}; zoom frame ${stat(/^zoom frame/)}`;
  const report = () => { clearTimeout(report.t); report.t = setTimeout(() => { if (typeof NATIVE !== "undefined" && NATIVE && typeof ncall === "function") ncall("uiTiming", { text: summary() }); }, 1500); };
  const nextFrame = (f) => requestAnimationFrame(() => requestAnimationFrame(f));

  // ---------------------------------------------------------------- song facts for cards and rows
  const tuningField = () => (typeof FIELDS !== "undefined" ? FIELDS : []).find((f) => /tuning/i.test(f.name));
  function tuningOf(s) {
    const f = tuningField(); if (!f) return "";
    const v = (s.fields || {})[f.id]; if (v !== undefined && v !== "") return String(v);
    const pf = window.MODUI ? MODUI.presetFields(s) : {}; return pf[f.id] !== undefined ? String(pf[f.id]) : "";
  }
  function firstPreset(s) {
    if (!window.MODUI || !window.SLMod) return "";
    const u = MODUI.presetsUsed(s)[0]; if (!u) return "";
    return (u.dev === "qc" ? "QC " : "Axe ") + SLMod.presetLabel(u.dev, u.preset);
  }
  const lenOf = (s) => (typeof verLen === "function" && typeof entryVer === "function" ? verLen(s, entryVer(s)) : s.audio) || s.audio || 0;
  // a bar of the song's sections, proportional (no time scale): flex segments
  function secBar(s) {
    const tot = Math.max(1, s.total || 1);
    const ps = (s.secPos || []).filter((p) => p.bars > 0);
    if (!ps.length) return `<span class="sbar9 none"></span>`;
    return `<span class="sbar9">${ps.map((p) => `<i style="flex:${p.bars / tot};background:${SEC_C[p.type] || "#5a5f6a"}" title="${esc(p.name)}"></i>`).join("")}</span>`;
  }
  const inSet = (id) => setOrder.includes(id);
  function matches(s, q) {
    if (!q) return true;
    const n = q.trim().toLowerCase(); if (!n) return true;
    const bpm = fmtBpm(s.tmap[0].bpm);
    return s.name.toLowerCase().includes(n) || bpm === n || bpm.startsWith(n) || String(s.key || "").toLowerCase() === n
      || tuningOf(s).toLowerCase().includes(n) || firstPreset(s).toLowerCase().includes(n);
  }

  // ---------------------------------------------------------------- the toolbar (built once)
  function buildToolbar() {
    const et = document.querySelector(".etool"); if (!et || $("viewTog")) return;
    const crumb = $("crumb"); if (crumb) crumb.classList.add("hid9");
    et.insertAdjacentHTML("afterbegin", `<div class="seg9" id="viewTog" role="tablist" aria-label="Show the library as">
        <button data-v="cards" role="tab" title="Cards: the library as a wall of songs"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg><span>Cards</span></button>
        <button data-v="folders" role="tab" title="Folders: one row per song, opening inline"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg><span>Folders</span></button></div>
      <div class="tabs9" id="cardTabs"><button data-t="songs">Songs</button><button data-t="sets">Setlists</button><button data-t="presets">Presets</button></div>`);
    const sp = et.querySelector(".sp");
    if (sp) sp.insertAdjacentHTML("afterbegin", `<div class="chips9" id="cardFilt"><button data-f="all"></button><button data-f="out"></button></div>
      <label class="sw9" id="oneOpenL" title="Opening a song closes the others"><input type="checkbox" id="oneOpen"><i></i><span>One song open at a time</span></label>
      <button class="btn line c9" id="collapse9" title="Collapse all  ⌥⌘←"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2.5 8 6l4-3.5M4 13.5 8 10l4 3.5"/></svg><span>Collapse all</span></button>
      <span class="q9"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input id="q9" type="search" placeholder="Search songs, BPM…" spellcheck="false" aria-label="Search songs"></span>
      <button class="ib2 sel9b" id="selMode" title="Select songs (tick several)"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2" y="2.5" width="4" height="4" rx="1"/><path d="M8.5 4.5H14M8.5 11.5H14"/><rect x="2" y="9.5" width="4" height="4" rx="1"/><path d="m2.8 11.5 1 1 1.6-2"/></svg></button>`);
    $("viewTog").querySelectorAll("button").forEach((b) => b.onclick = () => setView(b.dataset.v));
    $("cardTabs").querySelectorAll("button").forEach((b) => b.onclick = () => { S9.tab = b.dataset.t; draw(); });
    $("cardFilt").querySelectorAll("button").forEach((b) => b.onclick = () => { S9.filt = b.dataset.f; draw(); });
    $("oneOpen").checked = S9.oneOpen;
    $("oneOpen").onchange = (e) => { S9.oneOpen = e.target.checked; localStorage.setItem("setline.oneOpen", S9.oneOpen ? "1" : "0"); if (S9.oneOpen && open.size > 1) { const keep = [...open].pop(); open.clear(); open.add(keep); draw(); } };
    $("collapse9").onclick = collapseAll;
    $("q9").oninput = (e) => { S9.q = e.target.value; draw(); };
    $("selMode").onclick = () => setSelect(!S9.sel);
  }
  function syncToolbar() {
    const FS = focusSong(), edit = document.querySelector(".edit");
    edit.classList.toggle("v-cards", S9.view === "cards" && !FS); edit.classList.toggle("v-folders", S9.view === "folders" && !FS); edit.classList.toggle("v-song", !!FS);
    document.querySelectorAll("#viewTog button").forEach((b) => { b.classList.toggle("on", b.dataset.v === S9.view); b.setAttribute("aria-selected", String(b.dataset.v === S9.view)); });
    document.querySelectorAll("#cardTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === S9.tab));
    const notIn = songs.filter((s) => !inSet(s.id)).length;
    const f = $("cardFilt"); if (f) { f.children[0].textContent = `All ${songs.length}`; f.children[1].textContent = `Not in this set ${notIn}`; [...f.children].forEach((b) => b.classList.toggle("on", b.dataset.f === S9.filt)); }
    if ($("selMode")) $("selMode").classList.toggle("on", S9.sel);
  }
  function setView(v) {
    const t0 = performance.now();
    S9.view = v; localStorage.setItem(libKey(), v);
    if (focusId) focusId = null;
    draw(); timing("switch to " + v, t0);
  }

  // ---------------------------------------------------------------- the centre: one entry point
  const R0 = window.renderFolders; // the page's folder renderer: renderFolders(list, into)
  function draw() {
    buildToolbar(); syncToolbar();
    const FS = focusSong();
    if (FS || !songs.length) { R0(); decorateSong(FS); return; }
    renderHero(); // hides the hero
    if (S9.view === "cards") drawCards(); else drawRows();
    markSel();
  }
  window.renderFolders = function (listIn, into) { if (into) return R0(listIn, into); draw(); };

  // ---------------------------------------------------------------- Cards
  function cardHTML(s) {
    const tun = tuningOf(s), pre = firstPreset(s), nt = s.tracks.length;
    const sel = typeof songSel !== "undefined" && songSel.has(s.id);
    return `<div class="card9 ${s.id === selId ? "cur" : ""} ${sel ? "msel" : ""}" draggable="true" data-id="${s.id}" style="--c:${s.col || "#5a5f6a"}" tabindex="0" aria-label="${esc(s.name)}">
      <div class="c9h">${S9.sel ? `<span class="ck9 ${sel ? "on" : ""}" aria-hidden="true"></span>` : ""}<b title="${esc(s.name)}">${esc(s.name)}</b>${inSet(s.id) ? `<span class="inset9">IN SET</span>` : ""}</div>
      ${secBar(s)}
      <div class="c9m">${[tun, `${nt} track${nt === 1 ? "" : "s"}`, pre].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>
      <div class="c9n"><span>${fmtBpm(s.tmap[0].bpm)} BPM</span><span>${esc(meterChip(s).split(" ")[0])}</span><em>${fmt(lenOf(s))}</em></div></div>`;
  }
  function drawCards() {
    const sc = $("scroller"); sc.classList.remove("focus"); sc.classList.add("wall9"); sc.classList.remove("rows9");
    const t0 = performance.now();
    if (S9.tab === "sets") { drawSetCards(sc); return; }
    if (S9.tab === "presets") { drawPresetCards(sc); return; }
    const list = [...songs].sort(byName).filter((s) => (S9.filt === "out" ? !inSet(s.id) : true) && matches(s, S9.q));
    sc.innerHTML = `<div class="wall9g">${list.map(cardHTML).join("") || `<p class="faint empty9">${songs.length ? "No song matches." : "No songs yet."}</p>`}</div>`;
    sc.querySelectorAll(".card9").forEach((c) => {
      const id = c.dataset.id;
      c.onclick = (e) => { if (S9.sel || e.shiftKey || e.ctrlKey || e.metaKey) { pickSel(e, id, cardOrder()); return; } if (songSel.size) { songSel.clear(); markSel(); } songAnchor = id; select(id, false); markCur(); };
      c.ondblclick = () => { if (!S9.sel) openSong(id); };
      c.onkeydown = (e) => { if (e.key === "Enter") openSong(id); };
      c.oncontextmenu = (e) => { e.preventDefault(); songMenu(e, id, "list"); };
      c.ondragstart = (e) => { dragId = id; dragFrom = "pool"; c.classList.add("dragging"); try { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "copy"; } catch (x) {} };
      c.ondragend = () => { c.classList.remove("dragging"); clearDropLine(); };
    });
    timing("cards", t0);
  }
  const cardOrder = () => [...document.querySelectorAll(".card9")].map((c) => c.dataset.id);
  const markCur = () => document.querySelectorAll(".card9").forEach((c) => c.classList.toggle("cur", c.dataset.id === selId));
  function drawSetCards(sc) {
    sc.innerHTML = `<div class="wall9g">${setlists.map((L) => { const ids = (L.order || []).filter((id) => songs.some((s) => s.id === id)), len = ids.reduce((a, id) => a + lenOf(songs.find((s) => s.id === id)), 0);
      return `<div class="card9 set9 ${L.id === curSet ? "cur" : ""}" data-l="${L.id}" style="--c:${L.col || "#5a5f6a"}" tabindex="0"><div class="c9h"><b>${esc(L.name)}</b>${L.id === curSet ? `<span class="inset9">CURRENT</span>` : ""}</div>
        <div class="c9m"><span>${ids.length} song${ids.length === 1 ? "" : "s"}</span><span>${fmt(len)}</span></div><div class="c9list">${ids.slice(0, 5).map((id, i) => `<span>${i + 1}. ${esc(songs.find((s) => s.id === id).name)}</span>`).join("")}${ids.length > 5 ? `<span class="faint">+${ids.length - 5} more</span>` : ""}</div></div>`; }).join("")}</div>`;
    sc.querySelectorAll(".set9").forEach((c) => { c.onclick = () => { if (useSet(c.dataset.l) !== false) { refresh(); } }; });
  }
  // 8c's preset library: it has no page of its own (presets are edited on a modeler track's panel); listed here, a
  // click opens the first song that uses it on that track
  function drawPresetCards(sc) {
    const P = window.MODP || {}, rows = [];
    for (const dev of ["qc", "axe"]) for (const [k, v] of Object.entries(P[dev] || {})) {
      const used = songs.filter((s) => window.MODUI && MODUI.presetsUsed(s).some((u) => u.dev === dev && String(u.preset) === String(k)));
      rows.push({ dev, k, v, used });
    }
    sc.innerHTML = rows.length ? `<div class="wall9g">${rows.map((r, i) => `<div class="card9 pre9" data-i="${i}" style="--c:${r.dev === "qc" ? "#64d2ff" : "#ff9f43"}" tabindex="0"><div class="c9h"><b>${esc((r.dev === "qc" ? "QC " : "Axe ") + SLMod.presetLabel(r.dev, +r.k))}${r.v.name ? " · " + esc(r.v.name) : ""}</b></div>
        <div class="c9m"><span>${(r.v.scenes || []).filter((x) => x && x.name).length} named scene${(r.v.scenes || []).filter((x) => x && x.name).length === 1 ? "" : "s"}</span><span>${Object.keys(r.v.fields || {}).length} field${Object.keys(r.v.fields || {}).length === 1 ? "" : "s"}</span></div>
        <div class="c9list">${r.used.slice(0, 4).map((s) => `<span>${esc(s.name)}</span>`).join("") || `<span class="faint">Not used by a song</span>`}</div></div>`).join("")}</div>`
      : `<p class="faint empty9">No presets yet. Choose Quad Cortex or Axe-Fx III on a MIDI track (Device), then name a preset there: it shows up here.</p>`;
    sc.querySelectorAll(".pre9").forEach((c) => c.onclick = () => { const r = rows[+c.dataset.i], s = r.used[0]; if (!s) return; const t = s.tracks.find((t) => window.MODUI && MODUI.dev(s, t) === r.dev); openSong(s.id); if (t && typeof openTrack === "function") setTimeout(() => openTrack(s, t), 50); });
  }

  // ---------------------------------------------------------------- Folders: slim rows, each opening inline
  function rowHTML(s, divider) {
    const o = open.has(s.id), si = setOrder.indexOf(s.id), sel = typeof songSel !== "undefined" && songSel.has(s.id);
    const tun = tuningOf(s), pre = firstPreset(s);
    return `${divider ? `<div class="div9">Not in this set</div>` : ""}<div class="row9 ${o ? "open" : ""} ${s.id === selId ? "cur" : ""} ${s.id === playId ? "playing" : ""} ${sel ? "msel" : ""}" data-row="${s.id}" style="--c:${s.col || "#5a5f6a"}">
      <div class="r9h fh" draggable="true" data-id="${s.id}"><span class="ck9 ${sel ? "on" : ""}"></span><span class="chev9" aria-hidden="true">›</span>
        <b class="r9n" title="${esc(s.name)}">${si >= 0 ? `<em>${si + 1}</em>` : ""}${esc(s.name)}</b>
        <span class="r9m mono">${fmtBpm(s.tmap[0].bpm)} BPM · ${esc(meterChip(s).split(" ")[0])} · ${fmt(lenOf(s))}</span>
        <span class="r9t">${esc([tun, pre].filter(Boolean).join(" · ") || "–")}</span>
        ${secBar(s)}<button class="r9x" data-id="${s.id}" title="Song options" aria-label="Song options">⋯</button></div>
      <div class="r9b">${o ? "" : ""}</div></div>`;
  }
  function rowOrder() { const inS = setOrder.map((id) => songs.find((s) => s.id === id)).filter(Boolean), rest = songs.filter((s) => !inSet(s.id)).sort(byName); return { inS, rest }; }
  function drawRows() {
    const sc = $("scroller"); sc.classList.remove("wall9", "focus"); sc.classList.add("rows9");
    sc.style.setProperty("--vw", sc.clientWidth + "px");
    if (S9.oneOpen && open.size > 1) { const keep = open.has(selId) ? selId : [...open].pop(); open.clear(); open.add(keep); }
    const t0 = performance.now(), keepT = sc.scrollTop;
    const { inS, rest } = rowOrder();
    const f = (s) => matches(s, S9.q);
    const a = inS.filter(f), b = rest.filter(f);
    sc.innerHTML = a.map((s) => rowHTML(s, false)).join("") + b.map((s, i) => rowHTML(s, i === 0 && a.length > 0)).join("") || `<p class="faint empty9">No song matches.</p>`;
    sc.querySelectorAll(".row9").forEach(wireRow);
    [...open].forEach((id) => fillRow(id));
    sc.scrollTop = keepT;
    timing("folders", t0);
  }
  function wireRow(r) {
    const id = r.dataset.row, hd = r.querySelector(".r9h");
    hd.onclick = (e) => { if (e.target.closest(".r9x")) return; if (S9.sel || e.shiftKey || e.ctrlKey || e.metaKey) { pickSel(e, id, rowIds()); return; } if (songSel.size) { songSel.clear(); markSel(); } songAnchor = id; toggleRow(id); };
    hd.oncontextmenu = (e) => { e.preventDefault(); songMenu(e, id, "list"); };
    hd.ondragstart = (e) => { dragId = id; dragFrom = inSet(id) ? "set" : "pool"; try { e.dataTransfer.setData("text/plain", id); } catch (x) {} };
    hd.ondragend = clearDropLine;
    r.querySelector(".r9x").onclick = (e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); songMenu({ clientX: b.left - 120, clientY: b.bottom + 4 }, id, "list"); };
  }
  const rowIds = () => [...document.querySelectorAll(".row9")].map((r) => r.dataset.row);
  // the open song's tracks, drawn by the page's renderer into this row only
  function fillRow(id) {
    const r = document.querySelector(`.row9[data-row="${id}"]`); if (!r) return;
    const s = songs.find((x) => x.id === id), body = r.querySelector(".r9b");
    r.classList.toggle("open", open.has(id));
    if (!open.has(id) || !s) { body.innerHTML = ""; return; }
    R0([s], body);
  }
  // opening / closing one row touches only that row (and, with one song open at a time, the one it closes)
  function toggleRow(id, force) {
    const t0 = performance.now(), was = open.has(id), on = force === undefined ? !was : force;
    if (on === was && !(on && S9.oneOpen && open.size > 1)) return;
    const closed = [];
    if (on) { if (S9.oneOpen) for (const o of [...open]) if (o !== id) { open.delete(o); closed.push(o); } open.add(id); } else open.delete(id);
    if (on && id !== selId) { selId = id; if (typeof renderInsp === "function") renderInsp(); if (typeof renderSetlist === "function") renderSetlist(); }
    closed.forEach(fillRow); fillRow(id);
    document.querySelectorAll(".row9").forEach((x) => x.classList.toggle("cur", x.dataset.row === selId));
    if (on) { const r = document.querySelector(`.row9[data-row="${id}"]`); if (r) { r.classList.add("anim9"); setTimeout(() => r.classList.remove("anim9"), 200); const sc = $("scroller"), top = r.getBoundingClientRect().top - sc.getBoundingClientRect().top; if (top < 0 || top > sc.clientHeight - 60) sc.scrollTop += top - 8; } }
    nextFrame(() => timing((on ? "open " : "close ") + (songs.find((x) => x.id === id) || {}).name + ` (${(songs.find((x) => x.id === id) || { tracks: [] }).tracks.length} tracks)`, t0));
  }
  function collapseAll() {
    if (focusSong()) { closeSong(); return; }
    const ids = [...open]; open.clear();
    if (S9.view === "folders") ids.forEach(fillRow); else draw();
  }

  // ---------------------------------------------------------------- one song open (from Cards or the setlist)
  function decorateSong(s) {
    const sc = $("scroller"); sc.classList.remove("wall9", "rows9");
    const back = $("hBack"); if (back) { back.innerHTML = `← ${S9.view === "cards" ? "Library" : "Folders"} <kbd>esc</kbd>`; back.title = "Back  Esc"; }
    if (s) zoomBar(s);
  }

  // ---------------------------------------------------------------- the setlist sidebar
  const RS0 = window.renderSetlist;
  window.renderSetlist = function () {
    RS0();
    const el = $("songs"); if (!el) return;
    if (!setOrder.length) el.innerHTML = `<div class="blank sm" style="padding:28px 12px"><div class="bs">${songs.length ? "Drag songs here from the cards, or ＋ Song below." : "Songs you add will show up in the middle."}</div></div>`;
    // select mode: checkboxes on the setlist rows
    el.querySelectorAll(".song").forEach((row) => {
      if (S9.sel && !row.querySelector(".ck9")) row.insertAdjacentHTML("afterbegin", `<span class="ck9 ${songSel.has(row.dataset.id) ? "on" : ""}"></span>`);
      const prev = row.onclick;
      row.onclick = (e) => { if (S9.sel && !e.target.closest(".rmx,.xs,.var,.vprev,.vnext")) { pickSel(e, row.dataset.id, [...setOrder]); return; } if (prev) prev.call(row, e); if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.target.closest(".rmx,.xs,.var,.vprev,.vnext") && !S9.sel) openFromSet(row.dataset.id); };
    });
    const n = setOrder.length, len = setOrder.reduce((a, id) => { const s = songs.find((x) => x.id === id); return a + (s ? lenOf(s) : 0); }, 0);
    const brk = window.SLBreaks ? SLBreaks.count() : 0, blen = window.SLBreaks ? SLBreaks.length() : 0;
    if ($("setCount")) $("setCount").textContent = `${n} song${n === 1 ? "" : "s"}${brk ? ` · ${brk} break${brk === 1 ? "" : "s"}` : ""}`;
    if ($("setLen")) $("setLen").textContent = fmt(len + blen);
    wireSetDrop();
  };
  // a click on a setlist song opens it (Cards: its timeline; Folders: its row)
  function openFromSet(id) {
    if (S9.view === "folders" && !focusSong()) { toggleRow(id, true); const r = document.querySelector(`.row9[data-row="${id}"]`); if (r) r.scrollIntoView({ block: "nearest" }); return; }
    if (focusId !== id) openSong(id);
  }
  // drag a card (or row) onto the sidebar: an orange line shows where it lands
  let dropAt = -1;
  function clearDropLine() { document.querySelectorAll(".drop9").forEach((x) => x.remove()); dropAt = -1; }
  function wireSetDrop() {
    const el = $("songs"); if (!el || el._w9) return; el._w9 = true;
    el.addEventListener("dragover", (e) => {
      if (!dragId) return; e.preventDefault();
      const rows = [...el.querySelectorAll(".song")]; let at = rows.length;
      for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { at = i; break; } }
      if (at === dropAt) return; clearDropLine(); dropAt = at;
      const line = document.createElement("div"); line.className = "drop9";
      if (rows[at]) rows[at].before(line); else (rows.length ? rows[rows.length - 1].nextSibling ? rows[rows.length - 1].after(line) : el.appendChild(line) : el.appendChild(line));
    }, true);
    el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) clearDropLine(); });
    el.addEventListener("drop", (e) => {
      if (!dragId || dragFrom === "set" && setOrder.includes(dragId) && e.target.closest(".song")) { clearDropLine(); return; } // reordering: the page handles it
      e.preventDefault(); e.stopPropagation();
      const id = dragId, at = dropAt < 0 ? setOrder.length : dropAt; clearDropLine(); dragId = null;
      const ex = setOrder.indexOf(id);
      if (ex >= 0) {
        if (dragFrom === "set") { snap(); setOrder.splice(ex, 1); setOrder.splice(at > ex ? at - 1 : at, 0, id); refresh(); return; }
        const s = songs.find((x) => x.id === id);
        confirmBox(`“${esc(s.name)}” is already in this setlist`, `It’s #${ex + 1}. Move it here? (To play it twice, duplicate the song first: right-click › Duplicate song.)`, "Move it here", () => { snap(); setOrder.splice(ex, 1); setOrder.splice(at > ex ? at - 1 : at, 0, id); refresh(); });
        return;
      }
      snap(); setOrder.splice(at, 0, id); refresh();
    }, true);
  }

  // ---------------------------------------------------------------- select mode + the floating action bar
  function setSelect(on) {
    S9.sel = on; if (!on) songSel.clear();
    document.body.classList.toggle("sel9", on);
    if (typeof renderSetlist === "function") renderSetlist(); draw(); bar();
  }
  function pickSel(e, id, order) {
    if (!S9.sel && !(e.shiftKey || e.ctrlKey || e.metaKey)) return;
    // starting a selection with Ctrl / ⌘ from the current song: that one counts too (as in the Finder)
    if (!S9.sel && !songSel.size && (e.ctrlKey || e.metaKey) && selId && selId !== id && order.includes(selId)) songSel.add(selId);
    if (e.shiftKey && songAnchor && order.includes(songAnchor)) { const a = order.indexOf(songAnchor), b = order.indexOf(id); order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => songSel.add(x)); }
    else { songSel.has(id) ? songSel.delete(id) : songSel.add(id); songAnchor = id; }
    if (!S9.sel && songSel.size) { S9.sel = true; document.body.classList.add("sel9"); renderSetlist(); draw(); }
    markSel(); bar();
  }
  function markSel() {
    document.querySelectorAll(".card9[data-id],.row9,#songs .song").forEach((x) => { const id = x.dataset.id || x.dataset.row, on = songSel.has(id); x.classList.toggle("msel", on); const c = x.querySelector(".ck9"); if (c) c.classList.toggle("on", on); });
  }
  function bar() {
    let b = $("selBar9");
    if (!S9.sel) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "selBar9"; b.className = "selbar9"; b.setAttribute("role", "toolbar"); document.querySelector(".edit").appendChild(b); }
    const ids = [...songSel], n = ids.length, fromSet = ids.length && ids.every((id) => setOrder.includes(id)) && document.activeElement && document.activeElement.closest && document.activeElement.closest("#songs");
    b.innerHTML = `<b>${n} song${n === 1 ? "" : "s"} selected</b>
      <button class="btn line" data-a="add" ${n ? "" : "disabled"}>＋ Add to setlist</button><button class="btn line" data-a="col" ${n ? "" : "disabled"}>Colour</button>
      <button class="btn line" data-a="dup" ${n ? "" : "disabled"}>Duplicate</button><button class="btn line" data-a="exp" ${n ? "" : "disabled"}>Export…</button>
      <button class="btn line danger9" data-a="del" ${n ? "" : "disabled"}>${iconOf("del")} Delete</button><button class="btn line" data-a="done">Done</button>`;
    b.querySelectorAll("button").forEach((x) => x.onclick = (e) => act(x.dataset.a, e));
  }
  function act(a, e) {
    const ids = [...songSel].filter((id) => songs.some((s) => s.id === id));
    if (a === "done") { setSelect(false); return; }
    if (!ids.length) return;
    if (a === "add") { snap(); let k = 0; ids.forEach((id) => { if (!setOrder.includes(id)) { setOrder.push(id); k++; } }); refresh(); toast(k ? `Added ${k} song${k === 1 ? "" : "s"} to ${curSetObj().name}` : "Already in this setlist", undo); return; }
    if (a === "col") { const r = e.currentTarget.getBoundingClientRect(); swatchPop({ left: r.left, right: r.right, top: r.top - 150 }, songs.find((s) => s.id === ids[0]).col, (c) => { snap(); ids.forEach((id) => { songs.find((s) => s.id === id).col = c; }); refresh(); }); return; }
    if (a === "dup") { snap(); const made = []; ids.forEach((id) => { const n0 = songs.length; dupSong(id); if (songs.length > n0) made.push(songs[songs.length - 1].id); }); songSel.clear(); made.forEach((x) => songSel.add(x)); refresh(); bar(); toast(`Duplicated ${ids.length} song${ids.length === 1 ? "" : "s"}`, undo); return; }
    if (a === "exp") { const SLE = window.SLE; if (SLE && SLE.exportSongs) SLE.exportSongs(ids); else if (typeof exportSongsBox === "function") exportSongsBox(ids); else { const L = { id: "Lx", name: ids.length === 1 ? songs.find((s) => s.id === ids[0]).name : `${ids.length} songs`, order: ids }; toast("Export: choose File › Export song or setlist…"); } return; }
    if (a === "del") {
      // from the setlist (the selection is all in it and the setlist has focus): only out of the setlist; else the library, asking first
      const allIn = ids.every((id) => setOrder.includes(id));
      if (allIn && S9.lastFrom === "set") { removeFromSet(ids); setSelect(false); return; }
      deleteSongs(ids, "menu"); return;
    }
  }
  // which list the selection came from (setlist rows: remove only; cards / rows: delete from the library)
  document.addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest("#songs")) S9.lastFrom = "set"; else if (e.target.closest && e.target.closest(".card9,.row9")) S9.lastFrom = "lib"; }, true);

  // ---------------------------------------------------------------- keys: Esc back, ⌥⌘← collapse all
  document.addEventListener("keydown", (e) => {
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.key === "Escape" && !document.querySelector(".cfbg,.xm.ctx,#mpop,#tpop,.ipop")) {
      if (S9.sel) { e.preventDefault(); setSelect(false); return; }
      if (focusSong() && document.body.contains($("scroller")) && !document.querySelector(".perf.on")) { e.preventDefault(); closeSong(); }
    }
    if (e.key === "ArrowLeft" && e.altKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); collapseAll(); }
  });

  // ---------------------------------------------------------------- smooth zoom
  // PXS (pixels per second) changes continuously, centred on the pointer; only the open song(s) are drawn again,
  // once per animation frame.
  let zq = null;
  function openIds() { const FS = focusSong(); return FS ? [FS.id] : S9.view === "folders" ? [...open] : []; }
  function redrawOpen() {
    const FS = focusSong();
    if (FS) { const t0 = performance.now(); R0(); decorateSong(FS); return performance.now() - t0; }
    const t0 = performance.now(); openIds().forEach(fillRow); return performance.now() - t0;
  }
  // z: new pixels per second; ax: the x (in the scroller, past the track headers) that stays put
  function zoomTo(z, ax) {
    const sc = $("scroller"); z = Math.max(ZMIN, Math.min(ZMAX, z));
    if (Math.abs(z - PXS) < 1e-4) return;
    if (ax == null) ax = (sc.clientWidth - headW()) / 2;
    const tAt = (sc.scrollLeft + ax) / PXS;
    zq = { z, ax, tAt };
    if (zoomTo.raf) return;
    zoomTo.raf = requestAnimationFrame(() => {
      zoomTo.raf = 0; const q = zq; zq = null; if (!q) return;
      const t0 = performance.now();
      PXS = q.z; if ($("zoom")) $("zoom").value = zToSlider(q.z);
      redrawOpen();
      sc.scrollLeft = Math.max(0, q.tAt * PXS - q.ax);
      syncZoomBar();
      timing("zoom frame", t0);
    });
  }
  // the page's buttons and hooks: at once (wheel, pinch and the slider go through zoomTo: one draw per frame)
  window.setZoom = function (z, ax) { const sc = $("scroller"); z = Math.max(ZMIN, Math.min(ZMAX, z)); if (Math.abs(z - PXS) < 1e-4) return; if (ax == null) ax = (sc.clientWidth - headW()) / 2; const tAt = (sc.scrollLeft + ax) / PXS; PXS = z; if ($("zoom")) $("zoom").value = zToSlider(z); redrawOpen(); sc.scrollLeft = Math.max(0, tAt * PXS - ax); syncZoomBar(); };
  const zoomBy = (f, axFrac) => { const sc = $("scroller"); zoomTo((zq ? zq.z : PXS) * f, axFrac == null ? null : (sc.clientWidth - headW()) * axFrac); };
  // ⌥ + wheel, Ctrl/⌘ + wheel and trackpad pinch (a wheel with ctrlKey): exponential, so it feels continuous
  $("scroller").addEventListener("wheel", (e) => {
    if (!(e.altKey || e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const sc = $("scroller"), ax = e.clientX - sc.getBoundingClientRect().left - headW();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomTo((zq ? zq.z : PXS) * Math.exp(-d * (e.ctrlKey && !e.altKey ? 0.01 : 0.0025)), Math.max(0, ax));
  }, { capture: true, passive: false });
  // the visible span of the open song: [t0, t1] seconds
  function visSpan() { const sc = $("scroller"), w = sc.clientWidth - headW(); return [sc.scrollLeft / PXS, (sc.scrollLeft + w) / PXS]; }
  function fitSpan(s, a, b) { const sc = $("scroller"), w = sc.clientWidth - headW() - 24; if (b - a < 0.05) return; const z = Math.max(ZMIN, Math.min(ZMAX, w / (b - a))); PXS = z; if ($("zoom")) $("zoom").value = zToSlider(z); redrawOpen(); sc.scrollLeft = Math.max(0, a * PXS - 12); syncZoomBar(); }
  function zoomPreset(s, k) {
    if (k === "song") { fitSpan(s, 0, s.len); return; }
    const at = typeof pos === "number" && playId === s.id ? pos : visSpan()[0];
    const b = s.bars.find((x, i) => at >= x.t && at < (s.bars[i + 1] ? s.bars[i + 1].t : 1e9)) || s.bars[0];
    if (k === "sec") { const sec = (selSec && selSec.song === s.id ? s.secPos.find((p) => p.id === selSec.id) : null) || s.secPos.find((p) => b.bar >= p.start && b.bar < p.start + p.bars) || s.secPos[0]; if (sec) fitSpan(s, s.bars[sec.start - 1].t, s.bars[Math.min(s.bars.length - 1, sec.start + sec.bars - 1)].t); return; }
    const n = k === "32" ? 32 : 8, from = Math.max(1, Math.min(b.bar, s.total - n + 1)), to = Math.min(s.bars.length - 1, from + n - 1);
    fitSpan(s, s.bars[from - 1].t, s.bars[to].t);
  }
  // the zoom bar in the song header (Song · 32 bars · 8 bars · Section, − slider +, Fit) + the overview frame
  function zoomBar(s) {
    const h = $("hero"); if (!h || !h.querySelector(".hb")) return;
    if (!h.querySelector(".zb9")) h.querySelector(".hb").insertAdjacentHTML("beforeend", `<div class="zb9"><span class="faint">Zoom</span><div class="seg9 zp9">${[["song", "Song"], ["32", "32 bars"], ["8", "8 bars"], ["sec", "Section"]].map(([k, l]) => `<button data-z="${k}">${l}</button>`).join("")}</div>
      <button class="ib2" id="zo9" title="Zoom out">−</button><input type="range" id="zs9" min="0" max="1000" step="1" aria-label="Zoom"><button class="ib2" id="zi9" title="Zoom in">+</button><button class="btn line" id="zf9" title="Fit the whole song">Fit</button></div>`);
    h.querySelectorAll(".zp9 button").forEach((b) => b.onclick = () => zoomPreset(s, b.dataset.z));
    $("zo9").onclick = () => zoomBy(1 / 1.5); $("zi9").onclick = () => zoomBy(1.5); $("zf9").onclick = () => zoomPreset(s, "song");
    $("zs9").oninput = (e) => zoomTo(sliderToZ(+e.target.value));
    // the overview: the hero's section strip gets a white frame (drag it to scroll, its edges to zoom)
    const strip = h.querySelector(".hsec");
    if (strip && !strip.querySelector(".vf9")) {
      strip.insertAdjacentHTML("beforeend", `<div class="vf9" id="vf9" title="Drag to scroll; drag an edge to zoom"><u class="l"></u><u class="r"></u></div>`);
      const f = $("vf9");
      f.onpointerdown = (e) => {
        e.preventDefault(); e.stopPropagation(); f.setPointerCapture(e.pointerId);
        const W = strip.getBoundingClientRect().width, x0 = e.clientX, [a0, b0] = visSpan(), edge = e.target.classList.contains("l") ? "l" : e.target.classList.contains("r") ? "r" : "";
        f.onpointermove = (m) => { const dt = (m.clientX - x0) / W * s.len, sc = $("scroller");
          if (!edge) sc.scrollLeft = Math.max(0, (a0 + dt) * PXS);
          else { let a = a0, b = b0; if (edge === "l") a = Math.min(b0 - 0.5, Math.max(0, a0 + dt)); else b = Math.max(a0 + 0.5, Math.min(s.len, b0 + dt)); const w = sc.clientWidth - headW(); zoomTo(w / (b - a), 0); zq && (zq.tAt = a); }
          syncZoomBar(); };
        f.onpointerup = () => { f.onpointermove = null; };
      };
    }
    syncZoomBar();
  }
  function syncZoomBar() {
    const s = focusSong(), f = $("vf9"); if ($("zs9")) $("zs9").value = zToSlider(PXS);
    if (!s || !f) return; const [a, b] = visSpan(); f.style.left = Math.max(0, a / s.len * 100) + "%"; f.style.width = Math.max(1, Math.min(100, (Math.min(b, s.len) - a) / s.len * 100)) + "%";
  }
  $("scroller").addEventListener("scroll", () => { if (focusSong()) syncZoomBar(); }, { passive: true });
  // drag across the ruler: zoom to exactly those bars (a click still moves the playhead)
  document.addEventListener("pointerdown", (e) => {
    const lane = e.target.closest && e.target.closest(".ruler .lane"); if (!lane || e.button !== 0 || e.target.closest(".msig,.mkr")) return;
    const s = songs.find((x) => x.id === lane.dataset.song); if (!s) return;
    const r = lane.getBoundingClientRect(), x0 = e.clientX; let band = null;
    const mv = (m) => { if (!band && Math.abs(m.clientX - x0) < 6) return; if (!band) { band = document.createElement("i"); band.className = "rz9"; lane.appendChild(band); }
      const a = Math.min(x0, m.clientX) - r.left, b = Math.max(x0, m.clientX) - r.left; band.style.left = a + "px"; band.style.width = b - a + "px"; m.stopImmediatePropagation(); };
    const up = (u) => { document.removeEventListener("pointermove", mv, true); document.removeEventListener("pointerup", up, true); if (!band) return; band.remove();
      const ta = (Math.min(x0, u.clientX) - r.left) / PXS, tb = (Math.max(x0, u.clientX) - r.left) / PXS;
      const ba = s.bars.filter((x) => x.t <= ta + 1e-6).pop() || s.bars[0], bb = s.bars.find((x) => x.t >= tb - 1e-6) || s.bars[s.bars.length - 1];
      fitSpan(s, ba.t, Math.max(bb.t, ba.t + 0.5)); };
    document.addEventListener("pointermove", mv, true); document.addEventListener("pointerup", up, true);
  }, true);

  // ---------------------------------------------------------------- the track menu (Delete track ⌫, Duplicate ⌘D…)
  function trackMenu(e, s, t) {
    const i = s.tracks.indexOf(t), fixed = ["Click", "Cues"].includes(t);
    const rec = !!(s.files && s.files[t] && s.files[t].rec); // audio recorded in set.Line: ask before deleting
    ctxMenu(e, [
      { label: "Rename", icon: "✎", dis: fixed, act: () => { const lh = document.querySelector(`.trk .lh[data-song="${s.id}"][data-track="${CSS.escape(t)}"] .tn`); const r = lh ? lh.getBoundingClientRect() : { left: e.clientX, top: e.clientY }; floatInput(r.left, r.top - 2, 160, 24, t, (v) => { if (!v || v === t || s.tracks.includes(v)) return; snap(); renameTrack(s, t, v); refresh(); }); } },
      { label: "Colour ›", icon: "●", act: () => swatchPop({ left: e.clientX + 150, right: e.clientX + 150, top: e.clientY }, trackCol(s, t), (c) => { snap(); (s.tcol || (s.tcol = {}))[t] = c; refresh(); }) },
      { label: "Duplicate track", icon: "⧉", key: "⌘D", dis: fixed, act: () => dupTrack(s, t) },
      { label: "Move to another song…", icon: "↘", dis: fixed || songs.length < 2, act: () => moveTrackMenu(e, s, t) },
      { label: "Move up", icon: "↑", dis: i === 0, act: () => { snap(); s.tracks.splice(i, 1); s.tracks.splice(i - 1, 0, t); refresh(); } },
      { label: "Move down", icon: "↓", dis: i === s.tracks.length - 1, act: () => { snap(); s.tracks.splice(i, 1); s.tracks.splice(i + 1, 0, t); refresh(); } },
      "-",
      { label: "Delete track", icon: "⌫", key: "⌫", danger: true, act: () => deleteTrack(s, t, rec) },
    ]);
  }
  function deleteTrack(s, t, rec) {
    const go = () => { snap(); s.tracks.splice(s.tracks.indexOf(t), 1); refresh(); toast(`Deleted “${t}”`, undo); };
    if (rec) confirmBox(`Delete the “${esc(t)}” track?`, "It has audio you recorded in set.Line. Undo brings it back while this session is open.", "Delete track", go); else go();
  }
  function uniqueName(s, base) { let n = base, k = 2; while (s.tracks.includes(n)) n = `${base} (${k++})`; return n; }
  function copyTrackData(from, t, to, nt) {
    for (const k of ["files", "clips", "gain", "mute", "solo", "tcol", "outs", "midiCfg", "midi", "troles"]) if (from[k] && from[k][t] !== undefined) (to[k] || (to[k] = {}))[nt] = JSON.parse(JSON.stringify(from[k][t]));
    if (ROLE[t] === "click" && t !== "Click") { const r = (from.cks || {})[t]; if (r) (to.cks || (to.cks = {}))[nt] = JSON.parse(JSON.stringify(r)); }
  }
  function dupTrack(s, t) { snap(); const nt = uniqueName(s, t + " copy"); copyTrackData(s, t, s, nt); s.tracks.splice(s.tracks.indexOf(t) + 1, 0, nt); if (s.troles && s.troles[t]) s.troles[nt] = s.troles[t]; regRoles(s); refresh(); toast(`Duplicated “${t}”`, undo); }
  function moveTrackMenu(e, s, t) {
    ctxMenu({ clientX: e.clientX + 160, clientY: e.clientY }, [{ cap: `Move “${t}” to` }, ...songs.filter((x) => x.id !== s.id).sort(byName).slice(0, 24).map((d) => ({ label: d.name, icon: "↘", act: () => {
      snap(); const nt = uniqueName(d, t); copyTrackData(s, t, d, nt); d.tracks.push(nt); s.tracks.splice(s.tracks.indexOf(t), 1); regRoles(d); buildBars(d); refresh(); toast(`Moved “${t}” to ${d.name}`, undo); } }))]);
  }
  // the page's header menu is replaced by this one; a trash button on hover
  document.addEventListener("contextmenu", (e) => {
    const lh = e.target.closest && e.target.closest(".trk .lh"); if (!lh) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const s = songs.find((x) => x.id === lh.dataset.song); if (s) trackMenu(e, s, lh.dataset.track);
  }, true);
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".tdel9"); if (!b) return; e.stopPropagation();
    const lh = b.closest(".lh"), s = songs.find((x) => x.id === lh.dataset.song); if (s) deleteTrack(s, lh.dataset.track, !!(s.files && s.files[lh.dataset.track] && s.files[lh.dataset.track].rec));
  }, true);
  // ⌘D on a track (when one is open in the panel)
  document.addEventListener("keydown", (e) => {
    if (!(e.key === "d" || e.key === "D") || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (typeof trackOpen !== "undefined" && trackOpen && trackOpen.song) { const s = songs.find((x) => x.id === trackOpen.song); if (s && !["Click", "Cues"].includes(trackOpen.track)) { e.preventDefault(); e.stopImmediatePropagation(); dupTrack(s, trackOpen.track); } }
  }, true);
  // the trash button appears in every track header the page draws
  new MutationObserver(() => { document.querySelectorAll(".trk .lh:not(.t9)").forEach((lh) => { lh.classList.add("t9"); if (["Click", "Cues"].includes(lh.dataset.track)) return; lh.insertAdjacentHTML("beforeend", `<button class="tdel9" title="Delete track" aria-label="Delete track">${iconOf("del")}</button>`); }); })
    .observe($("scroller"), { childList: true, subtree: true });

  // ---------------------------------------------------------------- the sidebar footer (+ Song) and the select icon
  function buildSide() {
    const side = document.querySelector(".side"); if (!side || $("sideAdd9")) return;
    const lib = $("libSec"); if (lib) lib.hidden = true; // the old Library list: its job is the centre now (kept hidden: the page still fills it)
    const foot = side.querySelector(".setfoot");
    foot.insertAdjacentHTML("beforebegin", `<div class="sideadd9" id="sideAdd9"><button class="btn line" id="addSong9">＋ Song</button><button class="btn line" id="addBreak9" hidden>＋ Break</button></div>`);
    foot.innerHTML = `<span id="setCount">–</span><b id="setLen">—</b>`;
    const sp = side.querySelector(".phead .sp"); if (sp) sp.insertAdjacentHTML("afterbegin", `<button class="ibtn" id="selSet9" title="Select songs in the setlist"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2" y="2.5" width="4" height="4" rx="1"/><path d="M8.5 4.5H14M8.5 11.5H14"/><rect x="2" y="9.5" width="4" height="4" rx="1"/></svg></button>`);
    $("selSet9").onclick = () => setSelect(!S9.sel);
    $("addSong9").onclick = (e) => addSongPop(e.currentTarget);
  }
  // ＋ Song in the sidebar: pick a library song to add (after the selected one, or at the end)
  function addSongPop(btn) {
    document.querySelectorAll(".pick9").forEach((x) => x.remove());
    const p = document.createElement("div"); p.className = "pick9"; document.body.appendChild(p);
    const r = btn.getBoundingClientRect(); p.style.left = r.left + "px"; p.style.bottom = (innerHeight - r.top + 6) + "px";
    p.innerHTML = `<input placeholder="Add a song…" spellcheck="false" aria-label="Find a song"><div class="pl9"></div><button class="btn line" id="pickNew9">＋ New song…</button>`;
    const inp = p.querySelector("input"), list = p.querySelector(".pl9");
    const fill = () => { const q = inp.value; list.innerHTML = [...songs].sort(byName).filter((s) => matches(s, q)).slice(0, 40).map((s) => `<button data-id="${s.id}" class="${inSet(s.id) ? "in" : ""}"><i style="background:${s.col}"></i><span>${esc(s.name)}</span><em>${inSet(s.id) ? "in set" : fmt(lenOf(s))}</em></button>`).join("") || `<p class="faint">No song matches.</p>`;
      list.querySelectorAll("button").forEach((b) => b.onclick = () => { const id = b.dataset.id; if (inSet(id)) { toast("Already in this setlist"); return; } snap(); const i = setOrder.indexOf(selId); setOrder.splice(i >= 0 ? i + 1 : setOrder.length, 0, id); p.remove(); refresh(); }); };
    fill(); inp.oninput = fill; inp.focus();
    p.querySelector("#pickNew9").onclick = () => { p.remove(); openNewSong(); };
    setTimeout(() => document.addEventListener("pointerdown", function off(e) { if (!p.contains(e.target)) { p.remove(); document.removeEventListener("pointerdown", off, true); } }, true), 0);
  }

  // ---------------------------------------------------------------- exports (tests, the menus, Diagnostics)
  window.SL9 = { mode: () => S9.view, setMode: setView, draw, toggleRow, collapseAll, zoomTo, zoomBy, zoomPreset, fitSpan, select: setSelect, act, timings: () => S9.timings.slice(), summary, state: S9, trackMenu, deleteTrack, dupTrack, tuningOf, firstPreset };
  buildSide();
  // the library changed (switch / open): its own view
  const ssn = window.SLPage && Object.getOwnPropertyDescriptor(window.SLPage, "setSessionName");
  if (window.SLPage && SLPage.setSessionName) { const f = SLPage.setSessionName.bind(SLPage); SLPage.setSessionName = (n) => { f(n); loadView(); draw(); }; }
  void ssn;
  try { refresh(); } catch (e) { /* the page isn't ready yet */ }
})();
