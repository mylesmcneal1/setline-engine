// set.Line 15 §9: Select All (⌘A / Ctrl+A) and Deselect All (⇧⌘A / Ctrl+Shift+A, and Esc) everywhere, in the Edit
// menu, acting on the area that was clicked last (conventions §1: focus follows the last clicked area):
// - the song's lanes: every clip on every track (and the cues, MIDI clips) of that song
// - the click editor: every note · the patch change editor: every change · the audio track editor: its clips
// - the setlist sidebar: every song in the setlist · the library (cards / rows): every song shown
// - the import review: every locator row · the Remote page: every widget on the screen
// - a text field: its text (the native Select All; the menu sends it there)
// Delete, copy, duplicate and the arrow keys then work on the whole selection (the areas' own keys; the song's lanes
// get ← → for a group of clips here). The menu items are greyed out when nothing can be selected / is selected.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  let AREA = "song";
  const AREAS = [["#ableWiz", "import"], ["#bandV", "remote"], ["#clk10", "click"], ["#pe13", "patch"], ["#ate15", "audio"], ["#songs", "set"], [".card9, .row9 > .r9h, .wall9g, #pool", "lib"], ["#scroller, .fbody", "song"]];
  document.addEventListener("pointerdown", (e) => { const t = e.target; if (!t.closest) return; for (const [sel, a] of AREAS) if (t.closest(sel)) { AREA = a; return; } }, true);
  const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && !/^(range|checkbox|radio|button)$/.test(a.type || ""); };
  // where Select All goes now
  function area() {
    if (typing()) return "text";
    const wiz = $("ableWiz"); if (wiz && wiz.style.display !== "none" && wiz.querySelector("tr[data-row]")) return "import";
    if (typeof bandOn !== "undefined" && bandOn) return "remote";
    const a = document.activeElement;
    for (const [id, k] of [["clk10", "click"], ["pe13", "patch"], ["ate15", "audio"]]) if ($(id) && a && $(id).contains(a)) return k;
    if (AREA === "click" && !(window.SLClick && SLClick.editing())) AREA = "song";
    if (AREA === "patch" && !(window.PE13 && PE13.editing())) AREA = "song";
    if (AREA === "audio" && !(window.SL15T && SL15T.editing())) AREA = "song";
    if (AREA === "lib" && (typeof focusSong === "function" && focusSong())) AREA = "song";
    return AREA;
  }
  const song = () => (typeof focusSong === "function" && focusSong()) || songOf(selId) || null;
  const visibleSongIds = () => [...document.querySelectorAll(".card9[data-id], .row9[data-row]")].map((x) => x.dataset.id || x.dataset.row).filter((id) => songOf(id));
  const U = () => window.MODUI;
  // how many things Select All would select in an area (0: nothing to select)
  function countAll(a = area()) {
    if (a === "text") return 1;
    if (a === "import") return document.querySelectorAll("#ableWiz tr[data-row]").length;
    if (a === "remote") { const sc = typeof curScreen === "function" ? curScreen() : null; return sc ? (sc[BORI] || []).length : 0; }
    if (a === "click") { const e = SLClick.editing(); const s = e && songOf(e.song); return s ? SLClick.view(s, e.track).notes.length : 0; }
    if (a === "patch") { const e = PE13.editing(); const s = e && songOf(e.song); return s && U() ? U().evsOf(s, e.track).filter((q) => q.mod !== "mode").length : 0; }
    if (a === "audio") { const e = SL15T.editing(); const s = e && songOf(e.song); return s ? clipsOf(s, e.track).length : 0; }
    if (a === "set") return setOrder.length;
    if (a === "lib") return visibleSongIds().length;
    const s = song(); if (!s) return 0; let n = 0; s.tracks.forEach((t) => { if (isAudio(s, t)) n += clipsOf(s, t).length; else { const k = laneMenuFor(s, t); if (k === "cue") n += cuesOf(s).length; else if (k) n += regList(s, t, k).length; } }); return n;
  }
  // how many are selected now
  function countSel(a = area()) {
    if (a === "text") return 1;
    if (a === "import") return typeof ABWIZ !== "undefined" && ABWIZ && ABWIZ.rows ? ABWIZ.rows.sel().length : 0;
    if (a === "remote") return window.SL15R ? SL15R.selected().length : 0;
    if (a === "click") return (SLClick.editing() || { sel: [] }).sel.length;
    if (a === "patch") return (PE13.editing() || { sel: [] }).sel.length;
    if (a === "audio") return typeof multiOn === "function" && multiOn() ? selItems().length : SL15T.editing() && SL15T.editing().clip != null ? 1 : 0;
    if (a === "set" || a === "lib") return songSel.size || (selId ? 1 : 0);
    return (typeof multiOn === "function" && multiOn() ? selItems().length : 0) || (selClip ? 1 : 0) || (pick ? 1 : 0) || (selSec ? 1 : 0);
  }
  function all() {
    const a = area(); let n = 0;
    if (a === "text") { const el = document.activeElement; if (el.select) el.select(); else document.execCommand("selectAll"); return -1; }
    if (a === "import") { const keys = [...document.querySelectorAll("#ableWiz tr[data-row]")].map((x) => x.dataset.row); ABWIZ.rows.select(keys); n = keys.length; }
    else if (a === "remote") n = SL15R.selectAll();
    else if (a === "click") { const e = SLClick.editing(), s = songOf(e.song), L = SLClick.view(s, e.track).notes; SLClick.select(L); n = L.length; }
    else if (a === "patch") { const e = PE13.editing(), s = songOf(e.song), ids = U().evsOf(s, e.track).filter((q) => q.mod !== "mode").map((q) => q.id); PE13.select(ids); n = ids.length; }
    else if (a === "audio") n = SL15T.selectAll();
    else if (a === "set" || a === "lib") { const ids = a === "set" ? setOrder.slice() : visibleSongIds(); songSel = new Set(ids); songSelFrom = a === "set" ? "set" : "lib"; songAnchor = ids[0] || null; if (typeof markSongSel === "function") markSongSel(); if (window.SL9 && SL9.markSel) SL9.markSel(); n = ids.length; }
    else { const s = song(); if (s) { n = countAll("song"); if (n) selectAllIn(s); } }
    if (!n && typeof toast === "function") toast("Nothing to select here");
    return n;
  }
  function none() {
    const a = area();
    if (a === "text") { const el = document.activeElement; try { el.setSelectionRange(el.selectionEnd, el.selectionEnd); } catch (e) {} return; }
    if (a === "import") { ABWIZ.rows.select([]); return; }
    if (a === "remote") { SL15R.deselect(); return; }
    if (a === "click") { SLClick.select([]); return; }
    if (a === "patch") { PE13.select([]); return; }
    if (a === "audio") { if (typeof clearMulti === "function") clearMulti(); SL15T.selectClip(null); return; }
    if (a === "set" || a === "lib") { songSel.clear(); if (typeof markSongSel === "function") markSongSel(); if (window.SL9 && SL9.markSel) SL9.markSel(); return; }
    if (typeof clearMulti === "function") clearMulti(); if (selClip) { const s = songOf(selClip.song); if (s) selectClip(s, selClip.track, null); } if (pick) setPick(null); if (selSec) { selSec = null; refresh(); }
    if (typeof renderInsp === "function") renderInsp();
  }

  // keys: ⌘A / ⇧⌘A go through the menu (menus9: the Edit menu items, Key Commands remaps, greyed out = nothing); the
  // editors with their own keys (click, patch, audio), the import review and the Remote page answer ⌘A themselves
  // the song's lanes: ← → move a whole selection of clips (one undo step), a grid step (⌥: 10 ms)
  window.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.metaKey || e.ctrlKey || typing() || area() !== "song") return;
    if (!(typeof multiOn === "function" && multiOn())) return; const L = selItems().filter((x) => x.kind === "audio"); if (L.length < 2) return;
    e.preventDefault(); e.stopImmediatePropagation(); const dir = e.key === "ArrowLeft" ? -1 : 1, s = L[0].s;
    const d = e.altKey ? 0.01 : (() => { const b = s.bars[Math.max(0, barIdx(s, L[0].o.start))]; return b ? b.dur / b.sig[0] : 0.5; })();
    if (dir < 0 && Math.min(...L.map((x) => x.o.start)) - d < 0) return;
    snap(); L.forEach((x) => { x.o.start += dir * d; x.o.end += dir * d; }); s.tracks.forEach((t) => { if (isAudio(s, t)) clipsOf(s, t).sort((p, q) => p.start - q.start); }); redrawSong(s); if (window.SLE && SLE.nextChanged) SLE.nextChanged();
    toast(`Moved ${L.length} clips`, undo);
  }, true);

  window.SL15S = { all, none, area, countAll, countSel, setArea: (a) => { AREA = a; } };
})();
