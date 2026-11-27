// 11b: renaming, in the page (Chrome and WebKit at 1280x800). For every place a name can be renamed, at Text size
// 100 % and 120 %, scrolled sideways and down, in one song and in Folders: the element being edited IS the name
// element (no overlay), it has focus and its whole text selected, nothing moves, no other control overlaps it,
// Esc puts the name back, ↩ saves (and Undo). Track headers: no name narrower than 60 px (or its own text),
// never only "…". In the WebKit run, window.__shot (tests/ui-webkit.mjs) saves a picture before and while editing.
// Returns { problems, log }.
async function check11b() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const S = (id) => songs.find((x) => x.id === id), sc = document.getElementById("scroller");
  const R = (el) => el.getBoundingClientRect();
  const vis = (el) => !!el && el.isConnected && R(el).width > 0 && R(el).height > 0;
  const INTERACTIVE = "button, input, select, textarea, [role=button], .hf, .ochip, .more10, .more11, .grip10, [contenteditable]";
  const shot = async (name, el) => { if (!window.__shot || !el) return; const r = R((el.closest && el.closest("#songs > .song, #songs > .brk9, .card9, .row9, .row.trk, .row.secs, .vstrip, #hero, .htitle, #setHead, #crumb, .ruler, .rh, .lane")) || el);
    const pad = 24, x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad); await window.__shot(name, { x, y, width: Math.min(innerWidth - x, r.width + pad * 2), height: Math.min(innerHeight - y, r.height + pad * 2) }); };
  const counts = {};
  // one rename spot: start(), then the checks; returns the element that was edited
  async function spot(tag, what, nameEl, start, opt = {}) {
    if (!vis(nameEl)) { P.push(`${tag} · ${what}: the name isn't on screen`); return; }
    const row = nameEl.closest(opt.row || "#songs > .song, #songs > .brk9, .card9, .row9, .row.trk > .lh, .sec, .vr, #hero .htitle, #setHead, #crumb, .mkr, .rh") || nameEl.parentElement;
    const r0 = R(nameEl), rr0 = R(row), text0 = nameEl.textContent;
    await shot(`${tag}-${what}-before`, nameEl);
    start(); await frames(3);
    const ed = SL10a.editing();
    if (!ed) { P.push(`${tag} · ${what}: renaming didn't start`); return; }
    counts[what] = (counts[what] || 0) + 1;
    const el = ed.el;
    ok(el === nameEl || (opt.lane && el.parentElement === opt.lane), `${tag} · ${what}: the field is the name element itself (got <${el.tagName.toLowerCase()} class="${el.className}">)`);
    ok(!document.querySelector("input.ren10, input.finput"), `${tag} · ${what}: no floating box`);
    ok(document.activeElement === el, `${tag} · ${what}: it has the keyboard`);
    const S0 = getSelection(), selAll = el.tagName === "INPUT" ? el.selectionStart === 0 && el.selectionEnd === el.value.length : S0 && S0.toString() === el.textContent;
    ok(selAll, `${tag} · ${what}: the whole name is selected`);
    const r1 = R(el), rr1 = R(row);
    if (!opt.lane) ok(Math.abs(r1.left - r0.left) <= 1 && Math.abs(r1.top - r0.top) <= 1 && Math.abs(r1.height - r0.height) <= 1, `${tag} · ${what}: the name stays where it was (${Math.round(r0.left)},${Math.round(r0.top)} h${Math.round(r0.height)} → ${Math.round(r1.left)},${Math.round(r1.top)} h${Math.round(r1.height)})`);
    ok(Math.abs(rr1.height - rr0.height) <= 1 && Math.abs(rr1.width - rr0.width) <= 1, `${tag} · ${what}: the row keeps its size (${Math.round(rr0.width)}×${Math.round(rr0.height)} → ${Math.round(rr1.width)}×${Math.round(rr1.height)})`);
    // nothing else on top of it
    const others = [...document.querySelectorAll(INTERACTIVE)].filter((o) => o !== el && !o.contains(el) && !el.contains(o) && vis(o) && getComputedStyle(o).visibility !== "hidden" && getComputedStyle(o).opacity !== "0");
    const hit = others.filter((o) => { const q = R(o), w = Math.min(q.right, r1.right) - Math.max(q.left, r1.left), h = Math.min(q.bottom, r1.bottom) - Math.max(q.top, r1.top); return w > 1.5 && h > 1.5; });
    ok(!hit.length, `${tag} · ${what}: no control overlaps the name being edited: ${hit.map((o) => (o.className || o.tagName) + " “" + (o.textContent || "").trim().slice(0, 12) + "”").join(", ")}`);
    await shot(`${tag}-${what}-editing`, el);
    // Esc: the old name, as it was
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await frames(2);
    ok(!SL10a.editing() && !el.isContentEditable && (opt.lane || nameEl.textContent === text0), `${tag} · ${what}: Esc puts the name back (“${nameEl.textContent}” vs “${text0}”)`);
    return el;
  }
  // typing a new name and ↩: saved; Undo
  async function typeAndSave(tag, what, nameEl, start, check) {
    start(); await frames(3); const ed = SL10a.editing(); if (!ed) { P.push(`${tag} · ${what}: renaming didn't start`); return; }
    ed.el.focus(); document.execCommand("selectAll"); document.execCommand("insertText", false, "Renamed 11b");
    ed.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await frames(3);
    ok(check("Renamed 11b"), `${tag} · ${what}: typing and ↩ saves the new name`);
    undo(); await frames(2);
  }

  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  const look0 = window.SLLook ? SLLook.get() : null;
  for (const size of [100, 120]) {
    if (window.SLLook) SLLook.set({ size }); await frames(3);
    const T = `${size}%`;
    // ---- the setlist and the song cards
    SL9.setMode("cards"); closeSong(); renderSetlist(); await frames(3);
    { const el = document.querySelector('#songs .song[data-id="sat"] .nm11'); await spot(T, "setlist row", el, () => SL10a.renameSong("sat", el)); }
    { const el = document.querySelector('.card9[data-id="low"] .c9h b'); el && el.scrollIntoView({ block: "center" }); await frames(1); await spot(T, "card", el, () => SL10a.renameSong("low", el)); }
    await spot(T, "setlist name", document.querySelector("#setSel span"), () => renameSet());
    if (window.SLBreaks) { SLBreaks.add(SLBreaks.LABELS[0]); renderSetlist(); await frames(2); const bk = document.querySelector("#songs .brk9[data-b] .bt"); await spot(T, "break", bk, () => SL11.renameBreak(bk.closest(".brk9").dataset.b)); undo(); await frames(1); }
    { const el = document.querySelector("#crumbAll .libnm11"); if (vis(el)) await spot(T, "library name", el, () => { SL11.libs().length ? SL11.items("library", SL11.libs()[0].name) : null; SL10a.editInline(el, el.textContent, () => {}, { label: "Library name" }); }); }
    // the version switcher in a setlist row
    { const el = document.querySelector('#songs .song[data-id="glass"] .vsn11'); if (el) await spot(T, "version (setlist row)", el, () => renameVerBox(S("glass"), entryVerId(S("glass")), el)); }
    // ---- Folders, scrolled down: a row's name, a track header inside an open row
    SL9.setMode("folders"); await frames(3);
    { const el = document.querySelector('.row9[data-row="copper"] .r9nm'); el && el.scrollIntoView({ block: "center" }); await frames(2); await spot(T + " folders scrolled", "Folders row", el, () => SL10a.renameSong("copper", el)); }
    SL9.toggleRow("neon", true); await wait(200); sc.scrollTop = Math.max(0, sc.scrollTop + 120); sc.scrollLeft = 400; await frames(3);
    { const lh0 = [...document.querySelectorAll('.row.trk > .lh[data-song="neon"]')].filter(vis)[3]; if (lh0) { lh0.scrollIntoView({ block: "center" }); await frames(2); } const pin0 = lh0 && lh0.closest(".folder").querySelector(".pin9"); const lh = lh0 && (!pin0 || R(lh0).top > R(pin0).bottom + 4) ? lh0 : null;
      if (lh) { const el = lh.querySelector(".tnm11"); await spot(T + " folders scrolled", "track header (Folders)", el, () => renameTrackBox(S("neon"), lh.dataset.track, lh.querySelector(".tn"))); } else P.push(T + ": no Folders track header on screen"); }
    // ---- one song, scrolled sideways and down
    openSong("glass"); await wait(300); SL9.zoomNow(80 / (S("glass").bars[1].t - S("glass").bars[0].t)); await frames(2); sc.scrollLeft = 900; await frames(3);
    const g = S("glass");
    await spot(T + " song", "song title", document.querySelector("#hero .htitle h2"), () => renameSong(g.id));
    { const r = document.querySelector(`.vstrip .vr[data-song="${g.id}"]`); if (r) await spot(T + " song", "version", r.querySelector(".vnm11"), () => renameVerBox(g, r.dataset.v, r.querySelector(".vnm"))); }
    sc.scrollLeft = g.bars[g.secPos[3].start - 1].t * PXS - 150; await frames(3); // a section starting on screen, scrolled sideways
    { const secs = [...document.querySelectorAll(`.secs .lane[data-song="${g.id}"] .sec`)].filter((e) => R(e).left > TL9.laneLeft() + 4 && R(e).left < innerWidth - 120 && R(e).width > 60);
      if (secs.length) await spot(T + " song scrolled", "section", secs[0].querySelector(".snm11"), () => renameSec(g, +secs[0].dataset.sid), { row: ".sec" }); else P.push(T + ": no section on screen"); }
    { snap(); g.marks = [{ name: "LIGHTS", bar: barAtTime(g, (sc.scrollLeft + 200) / PXS), beat: 1 }]; refresh(); await frames(3);
      const u = document.querySelector(`.folder[data-id="${g.id}"] .mkr[data-i="0"] u`); if (vis(u)) await spot(T + " song scrolled", "marker", u, () => SL11.items("marker", S("glass"), 0)[0].act(), { row: ".mkr" }); else P.push(T + ": the marker isn't on screen");
      undo(); await frames(2); }
    { const el = document.querySelector("#crumbAll .libnm11"); if (vis(el)) await spot(T + " song", "library name", el, () => SL10a.editInline(el, el.textContent, () => {}, { label: "Library name" }), { row: "#crumb" }); else { // not shown in this layout: Library › Rename library… asks in a small box (no overlay)
      SL10a.editInline(null, "My Library", () => {}, { title: "Rename library" }); await frames(1); const nb = document.getElementById("nbName"); ok(nb && nb.value === "My Library", T + ": a name that isn't on screen (the library) is renamed in a small box"); const no = document.querySelector(".cfbg [data-a=no]"); if (no) no.click(); await frames(1); } }
    sc.scrollTop = 200; await frames(2);
    { const pin = document.querySelector(`.folder[data-id="${g.id}"] .pin9`), pb = pin ? R(pin).bottom : R(sc).top; const lh = [...document.querySelectorAll(`.row.trk > .lh[data-song="${g.id}"]`)].find((x) => vis(x) && R(x).top > pb + 4 && R(x).bottom < R(sc).bottom - 10); // below the pinned top rows
      if (lh) await spot(T + " song scrolled", "track header", lh.querySelector(".tnm11"), () => renameTrackBox(S("glass"), lh.dataset.track, lh.querySelector(".tn"))); else P.push(T + ": no track header on screen"); }
    // the cue drawn on the Cues lane: a field in the lane, at the label
    { const s2 = S("glass"); snap(); s2.cues = [{ id: "cq1", bar: barAtTime(s2, (sc.scrollLeft + 250) / PXS), beat: 1, text: "Verse" }]; refresh(); await frames(3);
      const cv = [...document.querySelectorAll(`canvas[data-song="${s2.id}"][data-t]`)].find((c) => s2.tracks[+c.dataset.t] === "Cues"); drawLane(cv); sc.scrollTop = 0; await frames(2);
      const c = s2.cues[0], lane = cv.parentElement;
      if (vis(cv)) { cv.ondblclick({ offsetX: cueT(s2, c) * PXS - (+cv.dataset.vx || 0) + 4, clientX: 0, clientY: 0, altKey: false }); await frames(2);
        const ed = SL10a.editing(); ok(ed && ed.el.parentElement === lane && Math.abs(parseFloat(ed.el.style.left) - cueT(s2, c) * PXS) < 1, `${T}: a cue's word is edited in its lane at its label`);
        if (ed) { await shot(`${T}-cue-editing`, ed.el); ed.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await frames(1); } }
      undo(); await frames(2); }
    // the track panel's title
    { openTrack(S("glass"), "Drums"); await frames(3); const h = document.getElementById("tTitle"); if (vis(h)) await spot(T + " panel", "track panel title", h, () => renameTrackBox(S("glass"), "Drums", h), { row: ".rh" }); trackOpen = null; renderInsp(); }
    // ---- track headers: the name has room
    sc.scrollTop = 0; await frames(3);
    const names = [...document.querySelectorAll(`.row.trk > .lh[data-song="${g.id}"] .tn`)].filter(vis).map((tn) => ({ t: tn.closest(".lh").dataset.track, w: tn.clientWidth, need: Math.min(60, tn.scrollWidth) }));
    const thin = names.filter((x) => x.w < x.need - 1);
    ok(names.length > 3 && !thin.length, `${T}: every track name has at least 60 px (or its whole text): ${thin.map((x) => `${x.t} ${x.w}px`).join(", ")}`);
    log.push(`${T}: track name widths ${names.map((x) => x.w).join(",")} · header steps ${[...document.querySelectorAll(`.row.trk > .lh[data-song="${g.id}"]`)].map((l) => l.classList.contains("nm2") ? 2 : l.classList.contains("nm1") ? 1 : 0).join("")}`);
    closeSong(); await wait(100);
  }
  if (window.SLLook && look0) SLLook.set({ size: look0.size }); await frames(2);
  // ---- typing and ↩ saves (each kind once), and a refresh while typing doesn't throw the edit away
  SL9.setMode("cards"); renderSetlist(); await frames(2);
  await typeAndSave("100%", "setlist row", null, () => SL10a.renameSong("sat", document.querySelector('#songs .song[data-id="sat"] .nm11')), (v) => S("sat").name === v);
  { const el = document.querySelector('#songs .song[data-id="sat"] .nm11'); SL10a.renameSong("sat", el); await frames(2); refresh(); await frames(2);
    ok(SL10a.editing() && SL10a.editing().el === el && el.isConnected, "a redraw asked for while typing waits (the name stays the field)");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await frames(2); }
  openSong("glass"); await wait(250);
  await typeAndSave("100%", "track header", null, () => renameTrackBox(S("glass"), "Bass", document.querySelector('.row.trk > .lh[data-song="glass"][data-track="Bass"] .tn')), (v) => S("glass").tracks.includes(v));
  await typeAndSave("100%", "section", null, () => renameSec(S("glass"), S("glass").secs[1].id), (v) => S("glass").secs[1].name === v);
  // pasting is plain text on one line
  { renameSong("glass"); await frames(2); const ed = SL10a.editing(); if (ed) { const dt = new DataTransfer(); dt.setData("text/plain", "Line one\nline two"); dt.setData("text/html", "<b>Bold</b>");
      const pe = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }); document.execCommand("selectAll"); ed.el.dispatchEvent(pe); await frames(1);
      ok(!ed.el.querySelector("*") && !/\n/.test(ed.el.textContent), "pasting is plain text, one line: “" + ed.el.textContent + "”");
      ed.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await frames(1); } }
  // a long name (as Live names them): the slider and the output chip give way first; the name keeps ~90 px
  { const s = S("glass"); snap(); renameTrack(s, "Keys", "60 GAR STUDIO GUITAR BACKTRACK"); refresh(); await wait(200); await frames(3); SL11.fitHeader(document.querySelector('.row.trk > .lh[data-song="glass"][data-track="60 GAR STUDIO GUITAR BACKTRACK"]'));
    const lh = document.querySelector('.row.trk > .lh[data-song="glass"][data-track="60 GAR STUDIO GUITAR BACKTRACK"]'), tn = lh && lh.querySelector(".tn");
    const steps = lh ? (lh.className.match(/nm\d/g) || []).join("+") || "none" : "";
    ok(tn && tn.clientWidth >= 88, `a long track name keeps about 90 px (${tn ? tn.clientWidth : "?"} px; header steps ${steps})`);
    ok(lh && vis(lh.querySelector(".mb")) && vis(lh.querySelector(".ochip")), "…M / S and the output chip are still there");
    log.push(`long name: ${tn ? tn.clientWidth : "?"} px, chip “${lh ? lh.querySelector(".ochip").textContent : ""}”, steps ${steps}`);
    await shot("long-track-name", tn); undo(); await frames(2); }
  closeSong(); await wait(100);
  log.push("rename spots checked: " + Object.entries(counts).map(([k, n]) => `${k} ×${n}`).join(", "));
  return { problems: P, log };
}
