// set.Line 14 §4: every "Add…" command adds what it says, where you are, and selects it.
// - Where: the insert marker in that song, else the playhead when it's in that song, else bar 1 (bar 2 for tempo and
//   time-signature changes: bar 1 always has one).
// - Add section: a free bar gets a new section; inside a section it splits there (as adding a locator splits an
//   arrangement section); at a section's first bar it splits that section in half.
// - Add marker… (new: Song menu, ⌘K): a marker at that bar, its name ready to type.
// - New tracks (click, MIDI, audio from files) are selected, like a click on their header.
(() => {
  "use strict";
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  // the bar an Add command works at in song s
  function atBar(s, min) {
    let t = null;
    if (window.SL12 && SL12.insert) { const v = SL12.insert(s); if (v !== null && v !== undefined) t = v; }
    if (t === null && (playId === s.id || (!playId && (selId === s.id || focusId === s.id)))) t = pos;
    const b = t === null ? 1 : barAtTime(s, t);
    return Math.max(min || 1, Math.min(s.total, b));
  }
  // what's selected, for the Edit menu's Rename / Delete and ⌫ (fix11's CUR and fix12's LAST)
  function mark(o) { if (window.SL11 && SL11.setCur) SL11.setCur(o.cur || null); if (window.SL12 && SL12.setLast) SL12.setLast(o.last || null); }

  function addSection(s) {
    if (!s) return null; const bar = atBar(s, 1), n0 = s.secs.length;
    if (freeRange(s, bar)) addSecAt(s, bar);
    else {
      const sec = s.secs.find((x) => bar >= x.start && bar < x.start + x.bars);
      const at = sec && bar > sec.start ? bar : sec && sec.bars >= 2 ? sec.start + Math.floor(sec.bars / 2) : null;
      if (!sec || at === null) { toast("There’s no room for another section here"); return null; }
      const ids = new Set(s.secs.map((x) => x.id)); splitAt(s, sec.id, at);
      const nw = s.secs.find((x) => !ids.has(x.id)); if (nw) { selSec = { song: s.id, id: nw.id }; selId = s.id; refresh(); if (typeof renameSec === "function") renameSec(s, nw.id); }
    }
    if (s.secs.length === n0) return null;
    const sel = typeof selSec !== "undefined" && selSec; if (sel) mark({ last: { kind: "section", s: s.id, id: sel.id } });
    return sel ? secObj(s, sel.id) : null;
  }
  function addTempo(s) {
    if (!s) return null; const bar = atBar(s, 2);
    addPoint(s, { bar, bpm: +bpmAt(s, bar).toFixed(3) });
    tsel = { song: s.id, i: s.tmap.findIndex((e) => e.bar === bar) }; refresh();
    mark({ cur: { kind: "tempo", a: s, b: bar }, last: { kind: "tempo" } });
    setTimeout(() => { if (typeof openTpop === "function") openTpop(true); }, 30);
    return s.tmap.find((e) => e.bar === bar);
  }
  // the time-signature popup at that bar; once it's added, the change is selected
  function addMeter(s) {
    if (!s || !window.SLMeter) return; const bar = atBar(s, 2), had = s.tmap.some((x) => x.bar === bar && x.sig);
    SLMeter.open(s, bar, null);
    // (the popup redraws its buttons as you change it: listen on the popup, after its own Add)
    const p = document.getElementById("mpop"); if (p) p.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#mpOk") && !had && s.tmap.some((x) => x.bar === bar && x.sig)) mark({ cur: { kind: "meter", a: s, b: bar }, last: { kind: "meter" } }); });
    return bar;
  }
  let SELM = null; // {song, i}: the marker just added (highlighted until something else is clicked)
  function addMarker(s) {
    if (!s) return null; const bar = atBar(s, 1); snap();
    const L = s.marks || (s.marks = []); let n = L.length + 1; while (L.some((m) => m.name === "Marker " + n)) n++;
    const m = { name: "Marker " + n, bar, beat: 1 }; L.push(m); L.sort((a, b) => a.bar - b.bar || (a.beat || 1) - (b.beat || 1));
    const i = L.indexOf(m); SELM = { song: s.id, i }; selId = s.id; refresh();
    mark({ cur: { kind: "marker", a: s, b: i }, last: { kind: "marker" } });
    toast(`Added “${m.name}” at bar ${bar}`, undo);
    const el = document.querySelector(`.folder[data-id="${s.id}"] .mkr[data-i="${i}"]`);
    if (el && typeof renameAt === "function") renameAt(el.querySelector("u") || el, m.name, (v) => { if (!v || !v.trim() || v.trim() === m.name) return; snap(); m.name = v.trim().slice(0, 40); refresh(); });
    return m;
  }
  const paintMarker = () => { document.querySelectorAll(".mkr.sel14").forEach((x) => x.classList.remove("sel14")); if (SELM) { const el = document.querySelector(`.folder[data-id="${SELM.song}"] .mkr[data-i="${SELM.i}"]`); if (el) el.classList.add("sel14"); } };
  document.addEventListener("pointerdown", (e) => { if (SELM && !(e.target.closest && e.target.closest(`.mkr`))) { SELM = null; paintMarker(); } }, true);
  const RF = window.refresh; window.refresh = function () { const r = RF.apply(this, arguments); paintMarker(); return r; };

  // new tracks are selected (a click track; audio tracks once their files are in; MIDI tracks already were)
  const select = (s, t) => { if (!s || !s.tracks.includes(t)) return; openTrack(s, t); mark({ last: { kind: "track", s: s.id, t } }); };
  const AT = window.addTrack;
  window.addTrack = function (s, k) {
    const before = s ? s.tracks.slice() : [];
    const r = AT.apply(this, arguments);
    const nw = s ? s.tracks.filter((t) => !before.includes(t)) : [];
    if (nw.length) select(s, nw[0]);
    return r;
  };
  if (window.SLPage && SLPage.addStems) { const AS = SLPage.addStems; SLPage.addStems = function (s) { const before = s ? s.tracks.slice() : []; const r = AS.apply(this, arguments); const nw = s ? s.tracks.filter((t) => !before.includes(t)) : []; if (nw.length) select(s, nw[0]); return r; }; }

  window.SL14A = { atBar, addSection, addTempo, addMeter, addMarker, selMarker: () => SELM };
})();
