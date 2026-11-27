// set.Line menus (9c, reorganised in 10b): the menu bar (macOS main menu, the Windows window menu), the right-click
// and ⋯ menus, ⌘K and the ⌘/ sheet all come from here, so an action has one name, one shortcut and one place.
// - The menu bar: described from the page's state and sent to the app; an item comes back as "m:<id>".
// - Object menus (a song, a break, a track, a section): SLMenus.obj(kind, at, …) for right-click and ⋯.
// - Shortcuts: every key a menu shows works while the page has focus (the dispatcher at the bottom); on the Mac the
//   page takes the key first (it calls preventDefault), so the menu's own key equivalent never fires twice.
// - Cut / Copy / Paste / Select all / Undo / Redo in a text field: the app's text editing (the native side does
//   it when a text field has focus, SLMenus.textFocus), the page's own otherwise.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = /Mac/.test(navigator.platform);
  const native = () => typeof NATIVE !== "undefined" && NATIVE && typeof ncall === "function";
  const mod = () => (window.SLE && SLE.mod) || {};
  const W = () => window.SLWords || {};
  const busy = () => typeof playing !== "undefined" && playing;
  const locked = () => typeof LOCKED !== "undefined" && LOCKED;
  const stage = () => busy() || locked(); // safe on stage: destructive actions wait
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const song = () => songOf(focusId || selId);
  const area = () => (window.SLDrag && SLDrag.area ? SLDrag.area() : "set");
  const trk = () => (typeof trackOpen !== "undefined" && trackOpen && songOf(trackOpen.song) ? { s: songOf(trackOpen.song), t: trackOpen.track } : null);
  const fixedT = (t) => typeof ROLE !== "undefined" && ROLE[t] === "cues"; // 11: one cue track per song (no copy)
  const noMove = (t) => typeof ROLE !== "undefined" && (ROLE[t] === "cues" || ROLE[t] === "click");
  const O11 = (what) => !!(window.SL11 && SL11.run(what)); // 11: what was clicked last (a marker, a version, a tempo change…)
  const sel = () => (typeof songSel !== "undefined" && songSel.size > 1 ? [...songSel] : []);
  const breaks = () => window.SLBreaks || null;
  const tab = (t) => { const a = document.querySelector(`.tabs a[data-tab="${t}"]`); if (a) a.click(); };
  const at0 = () => { const r = (document.activeElement && document.activeElement.getBoundingClientRect && document.activeElement !== document.body) ? document.activeElement.getBoundingClientRect() : { left: innerWidth / 2 - 100, bottom: 160 }; return { clientX: r.left, clientY: r.bottom + 4 }; };
  let ACT = {}, libs = [], DRY = null;
  // an item: id, label, key (cmd+shift+a), act, and dis / check / danger
  // 13 §21: the key a command has now (Key Commands can remap it on this computer)
  const it = (id, label, act, o = {}) => { ACT[id] = act; return { id: "m:" + id, label, key: window.SLKeys ? SLKeys.key(id, o.key || "") : o.key || "", dis: !!o.dis, check: !!o.check, danger: !!o.danger, group: o.group || "", help: o.help || "" }; };
  const sep = () => ({ sep: true });
  const head = (label) => ({ header: label });
  const sub = (label, items, dis) => ({ label, sub: items, dis: !!dis });

  // ================================================================ the actions behind more than one menu
  const renameAny = () => { if (O11("rename")) return; const T = trk(); if (area() === "track" && T) { renameTrack(T.s, T.t); return; }
    if (typeof selSec !== "undefined" && selSec && songOf(selSec.song)) { renameSec(songOf(selSec.song), selSec.id); return; }
    const s = song(); if (s) renameSong(s.id); };
  const renameTrack = (s, t) => { const el = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="${CSS.escape(t)}"] .tn`); renameTrackBox(s, t, el || document.body); };
  const dupAny = () => { const T = trk(); if (area() === "track" && T && !fixedT(T.t)) { SL9.dupTrack(T.s, T.t); return; }
    if ((typeof multiOn === "function" && multiOn()) || (typeof curItem === "function" && curItem())) { doDup(); return; }
    const s = song(); if (s && !stage()) dupSong(s.id); };
  const delAny = () => { if (O11("delete")) return; const T = trk(); if (area() === "track" && T) { SL9.deleteTrack(T.s, T.t); return; }
    const bk = document.querySelector("#songs .brk9.on"); if (bk && breaks() && area() !== "track") { breaks().del(bk.dataset.b); return; }
    if ((typeof multiOn === "function" && multiOn()) || (typeof curItem === "function" && curItem())) { doDelete(); return; }
    const ids = sel(); if (ids.length) { deleteSongs(ids, typeof songSelFrom !== "undefined" ? songSelFrom : "menu"); return; }
    const s = song(); if (s) deleteSong(s.id); };
  const editAny = () => { if (O11("edit")) return; const T = trk(); if (T) { openTrack(T.s, T.t); return; } if (typeof selSec !== "undefined" && selSec && songOf(selSec.song)) { renderInsp(); if (!isOpen("R")) setPanel("R", true, true); return; } const s = song(); if (s) openSong(s.id); };
  const colourSong = (s, at) => swatchPop({ left: at.clientX, right: at.clientX, top: at.clientY, bottom: at.clientY }, s.col, (c) => { snap(); s.col = c; refresh(); toast(`Changed the colour of “${s.name}”`, undo); });
  const colourTrack = (s, t, at) => swatchPop({ left: at.clientX, right: at.clientX, top: at.clientY, bottom: at.clientY }, trackCol(s, t), (c) => { snap(); (s.tcol || (s.tcol = {}))[t] = c; refresh(); toast(`Changed the colour of “${t}”`, undo); });
  const PAL_NAMES = () => (typeof PAL !== "undefined" ? PAL : []);
  const colourItems = (cur, set, pre) => [...PAL_NAMES().map((c, i) => it(pre + i, "● " + c, () => set(c), { check: String(cur || "").toLowerCase() === String(c).toLowerCase() })), sep(), it(pre + "w", "Colour wheel…", () => swatchPop({ left: innerWidth / 2 - 140, right: innerWidth / 2 - 140, top: 140 }, cur, set))]; // 13 §10
  const addToSet = (ids) => { ids = ids.filter((id) => !setOrder.includes(id)); if (!ids.length) { toast("Already in " + curSetObj().name); return; } snap(); ids.forEach((id) => setOrder.push(id)); refresh(); toast(`Added ${ids.length > 1 ? ids.length + " songs" : "“" + songOf(ids[0]).name + "”"} to ${curSetObj().name}`, undo); };
  const remFromSet = (ids) => { ids = ids.filter((id) => setOrder.includes(id)); if (!ids.length) return; if (typeof removeFromSet === "function") removeFromSet(ids); };
  // Make sections from cues (10c makes it a preview with ghost sections; until then: replace or fill, with Undo)
  const secsFromCuesAct = (ids) => { const list = (ids && ids.length ? ids : [song() && song().id]).map(songOf).filter(Boolean);
    if (window.SL10c && SL10c.fromCues) { SL10c.fromCues(list); return; }
    snap(); let n = 0; list.forEach((s) => { if (secsFromCues(s)) n++; }); refresh(); toast(n ? `Made sections from the cues in ${n > 1 ? n + " songs" : "“" + list[0].name + "”"}` : "No section cues (Verse, Chorus…) found", n ? undo : null); };
  const verItems = (s, pre) => { if (!s) return []; const vs = versOf(s), cur = curVer(s); return [...vs.map((v, i) => it(pre + i, v.name, () => { snap(); showVer(s, v.id); refresh(); if (window.SLE && SLE.nextChanged) SLE.nextChanged(); }, { check: v === cur })), sep(), it(pre + "new", "New version", () => { snap(); const v = newVer(s); refresh(); toast(`Added the version “${v.name}”`, undo); })]; };
  const heights = (s, pre) => (window.TL9 && s ? TL9.SIZES.map(([n], i) => it(pre + i, n, () => TL9.setSize(s, i), { check: TL9.sizeOf(s) === i })) : []);
  const moveSet = (dir) => { if (window.SLDrag) SLDrag.stepSet(dir); };
  const moveTrack = (dir) => { const T = trk(); if (T && window.SLDrag) SLDrag.stepTrack(T.s, T.t, dir); };

  // ================================================================ the menu bar
  function spec() {
    ACT = {};
    const s = song(), T = trk(), p = busy(), st = stage(), many = sel();
    const look = window.SLLook ? SLLook.get() : {};
    const reveal = MAC ? "Show in Finder" : "Show in Explorer";
    const dirtyLib = !!(mod().libDirty && mod().libDirty());
    const file = [
      head(dirtyLib ? "● Unsaved changes" : "Saved"),
      it("saveLibrary", "Save Library", () => mod().saveLibrary ? mod().saveLibrary() : toast("Save Library is in the app"), { key: "cmd+s" }),
      it("saveLibraryAs", "Save Library As…", () => mod().saveLibraryAs ? mod().saveLibraryAs() : toast("Save Library As is in the app"), { dis: st }),
      sep(),
      it("newSong", "New song…", () => openNewSong(), { key: "cmd+n", dis: st, group: "Library" }),
      it("newSetlist", "New setlist", () => setlistCmd("new"), { key: "cmd+shift+n", dis: st, group: "Setlist" }),
      sep(), head("Import"),
      it("importAbleton", "Ableton project…", () => mod().importAbleton(), { key: "cmd+i", dis: st, group: "Library", help: "Import an Ableton project" }),
      it("importAudio", "Audio as a new song…", () => mod().importAudioSong ? mod().importAudioSong() : openNewSong(), { dis: st, group: "Library", help: "Import audio as a new song" }),
      it("importPackage", "set.Line package (.setline)…", () => mod().importPackage(), { dis: st, group: "Library", help: "Import a set.Line package" }),
      sep(), head("Export"),
      it("exportSong", "This song…", () => mod().exportSong ? mod().exportSong(s && s.id) : mod().exportSetlist(), { key: "cmd+alt+e", dis: !s, help: "Export this song" }),
      it("exportSet", "This setlist…", () => mod().exportSetlist(), { key: "cmd+shift+e", help: "Export this setlist" }),
      sep(),
      it("print", "Print setlist…", () => window.SLPrint && SLPrint.box(), { key: "cmd+p", group: "Setlist" }),
      sep(),
      it("backups", "Backups…", () => mod().openBackup()),
      it("cleanUp", "Clean up unused audio…", () => mod().cleanUpAudio(), { dis: st }),
      ...(MAC ? [] : [sep(), it("settings", "Settings…", () => openSettings(), { key: "cmd+comma" }), it("prefsAudio", "Audio & outputs…", () => openSettings("audio")), it("prefsMidi", "MIDI & controllers…", () => openSettings("midi")), sep(), it("quit", "Exit", () => mod().quit())]),
    ];
    const edit = [
      it("undo", "Undo", () => undo(), { key: "cmd+z" }), it("redo", "Redo", () => redo(), { key: "cmd+shift+z" }), sep(),
      it("cut", "Cut", () => doCut(), { key: "cmd+x" }), it("copy", "Copy", () => doCopy(), { key: "cmd+c" }), it("paste", "Paste", () => doPaste(), { key: "cmd+v" }),
      it("duplicate", "Duplicate", dupAny, { key: "cmd+d" }), it("split", "Split", () => window.SL12 && SL12.split(), { key: "cmd+e", help: "Split the selected clip at the insert marker (or the playhead)" }), it("delete", "Delete", delAny, { key: "backspace", dis: st }), sep(),
      it("rename", "Rename…", renameAny, { key: "return", dis: !s && !T && !(window.SL11 && SL11.current()) }),
      it("editObj", "Edit…", editAny, { dis: !s && !T && !(window.SL11 && SL11.current()), help: "Edit what’s selected" }),
      it("selectAll", "Select all", () => { const x = song(); if (x && typeof selectAllIn === "function") selectAllIn(x); }, { key: "cmd+a", dis: !s }),
      it("selectMode", "Select songs", () => window.SL9 && SL9.select(!SL9.state.sel), { key: "cmd+shift+s", check: !!(window.SL9 && SL9.state.sel) }),
      sep(), it("palette", "Search or do anything…", () => window.SLix && SLix.palette(), { key: "cmd+k" }),
      it("keyCommands", "Key Commands…", () => window.SLKeys && SLKeys.open(), { key: "cmd+alt+k" }),
    ];
    const curLib = libs.find((l) => l.current);
    const sortBy = typeof LIBSORT !== "undefined" ? LIBSORT : "az";
    const library = [
      sub("Switch library", libs.map((l, i) => it("lib" + i, l.name + (l.songs !== undefined ? `  (${l.songs})` : ""), () => mod().switchLibrary(l.name), { check: l.current, dis: p || l.current })), !libs.length),
      sep(),
      it("newLibrary", "New library…", () => mod().newLibrary(), { dis: p }),
      it("renameLibrary", "Rename library…", () => (window.SL11 && curLib ? SL11.items("library", curLib.name).find((x) => x.id === "y11ren").act() : mod().renameLibrary()), { dis: !curLib && native() }),
      sub("Delete library", libs.filter((l) => !l.current).map((l, i) => it("libDel" + i, l.name + "…", () => mod().deleteLibrary && mod().deleteLibrary(l.name), { danger: true, dis: p })), !libs.some((l) => !l.current) || !mod().deleteLibrary),
      it("revealLibrary", reveal, () => mod().reveal()),
      sep(),
      it("mergeVersions", "Merge as versions…", () => window.SL10c && SL10c.mergeBox(many.length ? many : s ? [s.id] : []), { dis: !window.SL10c || st }),
      it("unmergeVersion", "Unmerge version", () => window.SL10c && SL10c.unmerge(s), { dis: !window.SL10c || !s || !(window.SL10c && SL10c.canUnmerge(s)) || st }),
      sep(),
      sub("Sort by", [["az", "Name"], ["recent", "Recently added"], ["len", "Length"]].map(([k, n]) => it("sort_" + k, n, () => { LIBSORT = k; if ($("libSort")) $("libSort").value = k; refresh(); }, { check: sortBy === k }))),
    ];
    const D13 = window.SL13D, KEYS13 = ["—", ...["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"].flatMap((k) => [k, k + " min"])];
    const songM = [
      ...(s ? [head("This song · " + s.name)] : []),
      it("songInfo", "Song info…", () => D13 && D13.songInfo(s && s.id), { key: "cmd+alt+i", dis: !s }),
      it("renameSong", "Rename…", () => { const x = song(); if (x) renameSong(x.id); }, { dis: !s }),
      sub("Colour", s ? colourItems(s.col, (c) => { snap(); s.col = c; refresh(); toast(`Changed the colour of “${s.name}”`, undo); }, "scol") : [], !s),
      sub("Key", s ? KEYS13.map((k, i) => it("skey" + i, k, () => { snap(); s.key = k; refresh(); }, { check: (s.key || "—") === k })) : [], !s),
      sep(),
      sub("Versions", verItems(s, "ver"), !s),
      ...(window.SL11 && s ? [sub("Edit version", versOf(s).map((v, i) => sub(v.name, objOf("version", s, v.id, "ev" + i))), false),
        sub("Markers", (s.marks || []).map((m, i) => sub(m.name || "Marker", objOf("marker", s, i, "mk" + i))), !(s.marks || []).length),
        sub("Tempo changes", s.tmap.filter((e) => e.bpm).map((e, i) => sub(`Bar ${e.bar} · ${fmtBpm(e.bpm)} BPM`, objOf("tempo", s, e.bar, "tp" + i)))),
        sub("Time signatures", s.tmap.filter((e) => e.sig).map((e, i) => sub(`Bar ${e.bar} · ${e.sig.join("/")}`, objOf("meter", s, e.bar, "ms" + i))))] : []),
      it("newVersion", "New version", () => { snap(); const v = newVer(s); refresh(); toast(`Added the version “${v.name}”`, undo); }, { dis: !s }),
      sep(),
      it("addSection", "Add section", () => { const x = song(); if (x) SL14A.addSection(x); }, { key: "cmd+alt+s", dis: !s }),
      it("addMeter", "Add time signature…", () => { const x = song(); if (x) SL14A.addMeter(x); }, { key: "cmd+alt+m", dis: !s }),
      it("addTempo", "Add tempo change…", () => { const x = song(); if (x) SL14A.addTempo(x); }, { key: "cmd+alt+t", dis: !s }),
      it("addMarker", "Add marker…", () => { const x = song(); if (x) SL14A.addMarker(x); }, { dis: !s }),
      it("secsFromCues", "Make sections from cues…", () => secsFromCuesAct(many), { dis: !s && !many.length }),
      sep(),
      sub("Song fields", s ? [...(typeof FIELDS !== "undefined" ? FIELDS : []).map((f, i) => it("sfield" + i, f.name + "…", () => D13 && D13.songInfo(s.id, "fields"))), ...((typeof FIELDS !== "undefined" && FIELDS.length) ? [sep()] : []),
        it("fieldsTable", "Song fields table…", () => typeof fieldsTable === "function" && fieldsTable()), it("fieldsEdit", "Add or edit fields…", () => openSettings("band"))] : [], !s),
      it("songNotes", "Notes for the band…", () => D13 && D13.songInfo(s && s.id, "notes"), { dis: !s }),
      sep(),
      it("addToSet", "Add to setlist", () => addToSet(many.length ? many : [s.id]), { key: "cmd+shift+a", dis: !s && !many.length }),
      it("deleteSong", "Delete song…", () => deleteSong(s.id), { dis: !s || st, danger: true }),
      sep(),
      it("dupSong", "Duplicate song", () => dupSong(s.id), { dis: !s || st }),
      it("sortMidi", "Sort tracks: MIDI to the bottom", () => window.SL10a && SL10a.sortMidi(many.length ? many : s ? [s.id] : []), { dis: !s && !many.length }),
    ];
    const ts = T && (!s || T.s === s) ? T.s : s; // 14 §4: the open song (a track still selected in another song isn't it)
    const TT = window.SL13M ? SL13M.track(T) : null, CL = window.SL13M ? SL13M.clip() : null;
    const trackM = [
      ...(T ? [head("Selected track · " + T.t)] : []),
      it("renameTrack", "Rename…", () => renameTrack(T.s, T.t), { dis: !T }),
      sub("Colour", T ? colourItems(trackCol(T.s, T.t), (c) => { snap(); const L = window.SL12 && SL12.tsel().length > 1 ? SL12.tsel() : [{ s: T.s.id, t: T.t }]; L.forEach((x) => { const so = songOf(x.s); if (so) (so.tcol || (so.tcol = {}))[x.t] = c; }); refresh(); toast(L.length > 1 ? `Changed the colour of ${L.length} tracks` : `Changed the colour of “${T.t}”`, undo); }, "tcol") : [], !T),
      sub("Output", TT ? TT.outputs.map((o, i) => it("tout" + i, o.label, o.act, { check: o.on })) : [], !TT || !TT.outputs.length),
      sub("Height", heights(ts, "th"), !ts),
      it("trackMute", "Mute", () => TT && TT.mute(), { check: !!(TT && TT.muted), dis: !TT }),
      it("trackSolo", "Solo", () => TT && TT.solo(), { check: !!(TT && TT.soloed), dis: !TT || !TT.canSolo }),
      sep(), head("MIDI tracks"),
      sub("Device", TT && TT.midi ? [["qc", "Quad Cortex"], ["axe", "Axe-Fx III"], ["", "Generic MIDI"]].map(([k, n]) => it("tdev_" + (k || "gen"), n, () => TT.setDevice(k), { check: TT.device === k })) : [], !(TT && TT.midi)),
      sub("Port & channel", TT && TT.midi ? [...TT.ports.map((p, i) => it("tport" + i, p.label, p.act, { check: p.on })), sep(), ...TT.channels.map((c, i) => it("tch" + i, c.label, c.act, { check: c.on }))] : [], !(TT && TT.midi)),
      it("editPatches", "Edit patch changes…", () => window.PE13 && PE13.open(T.s, T.t), { dis: !(TT && TT.midi) }),
      sep(), head("Clip"),
      it("clipGain", "Clip gain…", () => SL13M.clipGain(), { dis: !CL }),
      sub("Fades", CL ? SL13M.fadeItems().map((f, i) => it("tfade" + i, f.label, f.act, { check: f.on })) : [], !CL),
      it("splitClip", "Split", () => window.SL12 && SL12.split(), { dis: !CL && !(typeof pick !== "undefined" && pick && (pick.kind === "mreg" || pick.kind === "ck")) }),
      sep(),
      it("addAudio", "Add audio track", () => addTrack(ts, "audio"), { key: "cmd+t", dis: !ts || st }),
      it("addClick", "Add click track", () => addTrack(ts, "click"), { dis: !ts || st }),
      it("addMidi", "Add MIDI track", () => addTrack(ts, "midi"), { dis: !ts || st }),
      sep(),
      it("dupTrack", "Duplicate track", () => SL9.dupTrack(T.s, T.t), { dis: !T || fixedT(T.t) || st }),
      it("deleteTrack", "Delete track", () => SL9.deleteTrack(T.s, T.t), { dis: !T || st, danger: true }),
      sep(),
      it("trackUp", "Move up", () => moveTrack(-1), { key: "alt+up", dis: !T }),
      it("trackDown", "Move down", () => moveTrack(1), { key: "alt+down", dis: !T }),
      it("trackSettings", "Track settings…", () => { if (T) { openTrack(T.s, T.t); if (window.SL13D) SL13D.openDetails(document.querySelector(`.row.trk > .lh[data-song="${T.s.id}"][data-track="${CSS.escape(T.t)}"]`)); } }, { dis: !T }),
      it("editClick", "Edit click (MIDI clip)", () => window.SL10c && SL10c.openClip(ts), { dis: !ts || !window.SL10c }),
    ];
    const L = curSetObj();
    const setM = [
      sub("Switch setlist", setlists.map((l, i) => it("set" + i, l.name, () => { if (useSet(l.id) !== false) refresh(); }, { check: l.id === curSet, dis: p && l.id !== curSet }))),
      sep(),
      it("addSongToSet", "Add song…", () => { const b = $("addSong9"); if (b) b.click(); }),
      it("addBreak", "Add break", () => breaks() && breaks().add(), { key: "cmd+b", dis: !breaks() }),
      sep(),
      it("setUp", "Move up", () => moveSet(-1), { key: "alt+up", dis: !setOrder.length }),
      it("setDown", "Move down", () => moveSet(1), { key: "alt+down", dis: !setOrder.length }),
      sub("After this song", s && setOrder.includes(s.id) ? [["stop", "Stop"], ["segue", "Segue"], ["auto", "Auto-next"]].map(([k, n]) => it("after_" + k, n, () => setAfter(s, k, afterOf(s).sec), { check: afterOf(s).mode === k })) : [], !(s && setOrder.includes(s.id))),
      it("editBreak", "Edit break…", () => { const id = breaks() && breaks().selected(); if (id && window.SL14B) SL14B.edit(id); }, { dis: !(breaks() && breaks().selected && breaks().selected()) }),
      it("setRemove", "Remove from setlist", () => { const b = document.querySelector("#songs .brk9.on"); if (b && breaks()) { breaks().del(b.dataset.b); return; } remFromSet(many.length ? many : s ? [s.id] : []); }, { dis: !(s && setOrder.includes(s.id)) && !many.length && !document.querySelector("#songs .brk9.on") }),
      sep(),
      it("renameSet", "Rename setlist…", () => setlistCmd("ren")),
      it("dupSet", "Duplicate setlist", () => setlistCmd("dup"), { dis: p }),
      it("deleteSet", "Delete setlist", () => (window.SL11 ? SL11.delSetlist(curSet) : setlistCmd("del")), { dis: st, danger: true }),
    ];
    const v = window.SL9 ? SL9.mode() : "cards";
    const view = [
      it("tabShow", "Show", () => tab("show"), { key: "cmd+1", check: !(typeof perfOn !== "undefined" && perfOn) && !(typeof bandOn !== "undefined" && bandOn) }),
      it("tabPerform", "Perform", () => tab("perform"), { key: "cmd+2", check: typeof perfOn !== "undefined" && perfOn }),
      it("tabBand", "Remote", () => tab("band"), { key: "cmd+3", check: typeof bandOn !== "undefined" && bandOn }), sep(),
      it("cards", "Cards", () => SL9.setMode("cards"), { key: "cmd+alt+1", check: v === "cards" }),
      it("folders", "Folders", () => SL9.setMode("folders"), { key: "cmd+alt+2", check: v === "folders" }),
      it("collapseAll", "Collapse all", () => SL9.collapseAll(), { key: "cmd+alt+left" }), sep(),
      sub("Zoom", [
        it("zoomIn", "Zoom in", () => SL9.zoomBy(1.5), { key: "cmd+equals", dis: !s }), it("zoomOut", "Zoom out", () => SL9.zoomBy(1 / 1.5), { key: "cmd+minus", dis: !s }), sep(),
        ...[["song", "Whole song"], ["32", "32 bars"], ["8", "8 bars"], ["sec", "Section"]].map(([k, n]) => it("zoom_" + k, n, () => { const x = song(); if (x) SL9.zoomPreset(x, k); }, { dis: !s })),
      ], !s),
      ...(window.TL9 ? (() => { const X = TL9, xs = X.song(), cur = xs ? X.sizeOf(xs) : -1; return [
        sub("Track height", [...X.SIZES.map(([n], i) => it("trackSize" + i, n, () => X.setSize(X.song(), i), { check: cur === i })), sep(),
          it("tracksSmaller", "Shrink tracks", () => X.step(X.song(), -1), { key: "cmd+alt+minus", dis: !xs }),
          it("tracksBigger", "Grow tracks", () => X.step(X.song(), 1), { key: "cmd+alt+equals", dis: !xs }),
          it("fitTracks", "Fit tracks to window", () => X.fitTracks(X.song()), { key: "cmd+alt+shift+f", dis: !xs }),
          it("compactTop", "Compact top rows", () => X.setCompact(!X.compact()), { check: X.compact() })], !xs),
        it("fitAll", "Fit all", () => X.fitAll(X.song()), { key: "cmd+alt+f", dis: !xs, check: X.fitAllOn() })]; })() : []),
      sep(),
      it("follow", "Follow playhead", () => window.SL12 && SL12.follow(!SL12.follow()), { key: "cmd+f", check: !!(window.SL12 && SL12.follow()) }),
      it("toggleSetlist", "Setlist sidebar", () => setPanel("L", !isOpen("L")), { key: "cmd+alt+l", check: isOpen("L") }),
    ];
    const Lk = window.SLLook;
    const cust = Lk ? [
      sub("Theme", [...Lk.THEMES.map(([k, n]) => it("th_" + k, n, () => Lk.set({ theme: k }), { check: look.theme === k })), ...((look.themes || []).length ? [sep(), ...look.themes.map((t, i) => it("ths" + i, t.name, () => Lk.set({ ...t.look, themes: look.themes })))] : [])]),
      sub("Accent colour", Lk.ACCENTS.map(([n, c]) => it("acc_" + n, n, () => Lk.set({ accent: c }), { check: String(look.accent).toLowerCase() === c }))),
      sub("Fonts", Lk.PAIRS.map((pr) => it("pair_" + pr.id, pr.name + (pr.id === "round" ? " (default)" : ""), () => Lk.set({ pair: pr.id, ui: "", title: "", nums: "" }), { check: look.pair === pr.id && !look.ui && !look.title && !look.nums }))),
      sub("Text size", [90, 100, 110, 120, 130].map((z) => it("size_" + z, z + "%", () => Lk.set({ size: z }), { check: look.size === z }))),
      sub("Transport style", [["console", "Console"], ["hardware", "Hardware"], ["minimal", "Minimal"]].map(([k, n]) => it("tp_" + k, n, () => Lk.set({ transport: k }), { check: look.transport === k }))),
      sep(),
      it("customize", "Customize the look…", () => Lk.open(), { key: "cmd+alt+comma" }),
      it("lookReset", "Reset to default", () => Lk.reset()),
    ] : [];
    const win = [it("minimise", "Minimise", () => native() && ncall("windowCmd", { what: "minimise" }), { key: MAC ? "cmd+m" : "" }), it("fullscreen", "Full screen", () => native() && ncall("windowCmd", { what: "fullscreen" }), { key: MAC ? "cmd+ctrl+f" : "" })];
    const help = [
      it("quickStart", "Quick start", () => window.SLix && SLix.quickStart()),
      it("shortcuts", "Keyboard shortcuts", () => window.SLKeys ? SLKeys.open() : window.SLix && SLix.sheet(), { key: "cmd+slash" }),
      sep(),
      it("diag", "Diagnostics", () => openSettings("diag")),
      it("copyDiag", "Copy diagnostics", () => SLE && SLE.diagnostics && SLE.diagnostics("copy")),
      it("report", "Report a problem…", () => { if (SLE && SLE.diagnostics) SLE.diagnostics("save"); if (native()) ncall("openUrl", { url: "https://github.com/mylesmcneal1/setline-engine/issues/new" }); }),
      ...(MAC ? [] : [sep(), it("checkUpdates", "Check for updates…", () => window.SLUpd && SLUpd.check(true)), it("aboutWin", "About set.Line", () => mod().about && mod().about())]),
    ];
    // the macOS app menu (About / Check for updates / Settings are answered by the module: about, checkUpdates, prefs)
    const app = [{ id: "about", label: "About set.Line" }, { id: "checkUpdates", label: "Check for updates…" }, sep(), { id: "prefs", label: "Settings…", key: "cmd+comma" },
      it("prefsAudio", "Audio & outputs…", () => openSettings("audio")), it("prefsMidi", "MIDI & controllers…", () => openSettings("midi"))];
    ACT.about = () => mod().about && mod().about(); ACT.prefs = () => openSettings(); ACT.checkUpdates = () => window.SLUpd && SLUpd.check(true);
    const cues = window.SL13E ? SL13E.menu(it, sub, sep, head) : [];
    return { menus: [{ name: "File", items: file }, { name: "Edit", items: edit }, { name: "View", items: view }, { name: "Library", items: library }, { name: "Song", items: songM }, { name: "Track", items: trackM },
      { name: "Setlist", items: setM }, ...(cues.length ? [{ name: "Cues", items: cues }] : []), { name: "Customize", items: cust }, { name: "Window", items: win }, { name: "Help", items: help }], app: MAC ? app : [] };
  }

  // ================================================================ object menus: right-click = ⋯ = the menu bar
  // items as the page's ctxMenu wants them; a submenu opens as a second menu at the same place
  const keyText = (k) => { if (!k) return ""; const P = k.split("+"), key = P.pop(), map = { cmd: MAC ? "⌘" : "Ctrl+", ctrl: MAC ? "⌃" : "Ctrl+", alt: MAC ? "⌥" : "Alt+", shift: MAC ? "⇧" : "Shift+" };
    const K = { comma: ",", minus: "−", equals: "=", slash: "/", left: "←", right: "→", up: "↑", down: "↓", backspace: "⌫", return: "↩", space: "Space" }[key] || key.toUpperCase();
    const order = MAC ? ["ctrl", "alt", "shift", "cmd"] : ["cmd", "ctrl", "alt", "shift"]; return order.filter((m) => P.includes(m)).map((m) => map[m]).join("") + K; };
  function toCtx(items, at) {
    const out = [];
    for (const x of items) {
      if (!x) continue;
      if (x.sep) { if (out.length && out[out.length - 1] !== "-") out.push("-"); continue; }
      if (x.header) { out.push({ cap: x.header }); continue; }
      if (x.sub) { out.push({ label: x.label + " ▸", icon: "", dis: x.dis, act: () => ctxMenu(at, toCtx(x.sub, at)) }); continue; }
      const id = x.id.replace(/^m:/, ""), f = ACT[id];
      out.push({ label: x.label, icon: x.check ? "✓" : x.icon || "", key: keyText(x.key), dis: x.dis, danger: x.danger, act: () => { if (DRY) { DRY.push(id); return; } if (f) f(); } });
    }
    while (out.length && out[out.length - 1] === "-") out.pop();
    return out;
  }
  // 11: fix11.js's items as menu items (ids prefixed so two objects in one menu bar don't clash)
  function objOf(kind, a, b, pre, keys) { const L = (window.SL11 && SL11.items(kind, a, b)) || []; return L.map((x, i) => (x.sep ? sep() : it(pre + "_" + x.id, x.label, x.act, keys ? x : { ...x, key: "" }))); } // keys only in the object's own menu (the menu bar keeps one ↩)
  // the items for one object (they share ACT with the menu bar)
  function objItems(kind, a, b) {
    spec(); // fills ACT for the shared ids
    const st = stage();
    if (kind === "song") {
      const s = songOf(a); if (!s) return [];
      const inSet = setOrder.includes(s.id), many = sel().length > 1 && songSel.has(s.id) ? sel() : null;
      const nIn = many ? many.filter((x) => setOrder.includes(x)).length : 0, sN = (n) => (n === 1 ? "1 song" : n + " songs");
      if (many) return [...(nIn < many.length ? [it("oAdd", `Add ${sN(many.length - nIn)} to ${curSetObj().name}`, () => addToSet(many))] : []), ...(nIn ? [it("oRem", `Remove ${sN(nIn)} from ${curSetObj().name}`, () => remFromSet(many))] : []),
        it("oSecs", "Make sections from cues", () => secsFromCuesAct(many)), it("oMerge", "Merge as versions…", () => window.SL10c && SL10c.mergeBox(many), { dis: !window.SL10c || st }), sep(),
        it("oDelMany", `Delete ${many.length} songs…`, () => deleteSongs(many, "menu"), { dis: st, danger: true })];
      const i = setOrder.indexOf(s.id);
      return [
        it("oOpen", "Open", () => { if (window.SL9 && SL9.mode() === "folders" && !focusSong()) SL9.toggleRow(s.id, true); else openSong(s.id); }),
        it("oRename", "Rename…", () => renameSong(s.id), { key: "return" }),
        sub("Colour", colourItems(s.col, (c) => { snap(); s.col = c; refresh(); toast(`Changed the colour of “${s.name}”`, undo); }, "oc")),
        it("oDup", "Duplicate", () => dupSong(s.id), { dis: st }),
        sub("Versions", verItems(s, "ov")),
        sep(),
        inSet ? it("oRem1", `Remove from ${curSetObj().name}`, () => remFromSet([s.id])) : it("oAdd1", `Add to ${curSetObj().name}`, () => addToSet([s.id]), { key: "cmd+shift+a" }),
        ...(inSet ? [it("oUp", "Move up", () => { select(s.id, false); SLDrag.stepSet(-1); }, { key: "alt+up", dis: i === 0 }), it("oDown", "Move down", () => { select(s.id, false); SLDrag.stepSet(1); }, { key: "alt+down", dis: i === setOrder.length - 1 }),
          it("oAfter", "After this song…", () => afterMenu(b || at0(), s))] : []),
        it("oSecs1", "Make sections from cues", () => secsFromCuesAct([s.id]), { dis: !(s.cues || []).length }),
        sep(),
        it("oDel", "Delete song…", () => deleteSong(s.id), { dis: st, danger: true }),
      ];
    }
    if (kind === "break") {
      const B = breaks(); const bk = B && B.list().find((x) => x.id === a); if (!bk) return [];
      return [
        it("bRename", "Rename…", () => window.SL11 && SL11.renameBreak(a), { key: "return" }),
        it("bEdit", "Edit…", () => { B.select(a); if (window.SL14B) SL14B.edit(a); }),
        sub("Label", B.LABELS.map((l, i) => it("bLab" + i, l, () => { snap(); bk.label = l; bk.len = B.DEFLEN[l] || bk.len; refresh(); }, { check: bk.label === l }))),
        sep(),
        it("bUp", "Move up", () => { B.select(a); SLDrag.stepSet(-1); }, { key: "alt+up" }), it("bDown", "Move down", () => { B.select(a); SLDrag.stepSet(1); }, { key: "alt+down" }),
        it("bDup", "Duplicate", () => B.dup(a)),
        sep(),
        it("bDel", "Remove", () => B.del(a), { danger: true }),
      ];
    }
    if (kind === "track") {
      const s = a, t = b, fx = fixedT(t), i = s.tracks.indexOf(t);
      return [
        it("tRename", "Rename…", () => renameTrack(s, t), { key: "return" }),
        sub("Colour", colourItems(trackCol(s, t), (c) => { snap(); (s.tcol || (s.tcol = {}))[t] = c; refresh(); toast(`Changed the colour of “${t}”`, undo); }, "otc")),
        it("tDup", "Duplicate", () => SL9.dupTrack(s, t), { dis: fx || st }),
        sep(),
        it("tUp", "Move up", () => SLDrag.stepTrack(s, t, -1), { key: "alt+up", dis: i === 0 }),
        it("tDown", "Move down", () => SLDrag.stepTrack(s, t, 1), { key: "alt+down", dis: i === s.tracks.length - 1 }),
        it("tMove", "Move to another song…", () => SL9.trackMenu && SL9.moveTrackMenu ? SL9.moveTrackMenu(at0(), s, t) : null, { dis: noMove(t) || songs.length < 2 || !SL9.moveTrackMenu }),
        sub("Height", heights(s, "oth")),
        ...(typeof ROLE !== "undefined" && ROLE[t] === "click" && window.SL10c ? [it("tClip", "Edit click (MIDI clip)", () => SL10c.openClip(s, t))] : []),
        sep(),
        it("tDel", "Delete track", () => SL9.deleteTrack(s, t), { dis: st, danger: true }),
      ];
    }
    if (kind === "section") {
      const s = a, so = secObj(s, b); if (!so) return [];
      const nx = s.secs.find((x) => x.start > so.start), room = (nx ? nx.start : s.total + 1) - (so.start + so.bars);
      const set = (f) => () => { snap(); f(); buildBars(s); refresh(); };
      return [
        it("sRename", "Rename…", () => renameSec(s, b), { key: "return" }),
        sub("Colour", SEC_TYPES.map((k, j) => it("sType" + j, (k === "pre" ? "Pre-chorus" : k[0].toUpperCase() + k.slice(1)), set(() => { so.type = k; }), { check: so.type === k }))),
        it("sLoop", "Loop until released (vamp)", set(() => { so.end = so.end === "loop" ? "continue" : "loop"; }), { check: so.end === "loop" }),
        sub("At its end", [["continue", "Play on"], ["hold", "Hold on last bar"], ["stop", "Stop"]].map(([k, l]) => it("sEnd_" + k, l, set(() => { so.end = k; }), { check: so.end === k }))),
        it("sDup", "Duplicate", set(() => { const c = { ...JSON.parse(JSON.stringify(so)), id: sid++, start: so.start + so.bars }; s.secs.push(c); selSec = { song: s.id, id: c.id }; }), { dis: room < so.bars }),
        it("sSplit", "Split at playhead", () => splitAt(s, b, nearestBoundary(s, pos)), { dis: !(playId === s.id && barAtTime(s, pos) > so.start && barAtTime(s, pos) < so.start + so.bars) }),
        it("sSettings", "Section settings…", () => { selectSec(s.id, b); if (window.SL13D) SL13D.openDetails(document.querySelector(`.secs .lane[data-song="${s.id}"] .sec[data-sid="${b}"]`)); }), // 13 D: what the side panel showed (cue words, notes, MIDI…)
        sep(),
        it("sDel", "Delete", () => deleteSec(s, b), { danger: true }),
      ];
    }
    // 11: versions, markers, tempo and time signature changes, setlists, libraries, presets, cue words, scenes
    if (window.SL11) { const L = SL11.items(kind, a, b); if (L) return objOf(kind, a, b, "o11", true); }
    return [];
  }
  // open an object's menu at a point (right-click) or under a button (⋯)
  function obj(kind, at, a, b) {
    if (at && at.currentTarget && at.currentTarget.getBoundingClientRect && at.type === "click") { const r = at.currentTarget.getBoundingClientRect(); at = { clientX: r.left, clientY: r.bottom + 4 }; }
    const items = objItems(kind, a, b, at); if (!items.length) return;
    ctxMenu(at, toCtx(items, at));
  }

  // ================================================================ sending, running
  let last = "", timer = 0;
  function update() { clearTimeout(timer); timer = setTimeout(send, 80); }
  async function send() {
    try { if (mod().libraries) libs = await mod().libraries(); } catch (e) { libs = []; }
    // the app shows (and on the Mac answers) only keys with ⌘ / Ctrl, and ⌥↑ / ⌥↓: ↩ and ⌫ depend on what's
    // selected, so the page alone handles them (the page's menus, ⌘K and the ⌘/ sheet still show them)
    const sp = spec(), j = JSON.stringify(sp, (k, v) => (k === "key" && v && !/cmd/.test(v) && !/^alt\+(up|down)$/.test(v) ? "" : v));
    if (j === last) return; last = j;
    if (native()) ncall("setMenus", JSON.parse(j));
  }
  // text editing commands with a text field focused: the field's own (WebView2 and WebKit do these themselves when
  // the key is pressed; a menu click needs execCommand, and on the Mac the app sends the standard action)
  const TEXT = { undo: "undo", redo: "redo", cut: "cut", copy: "copy", paste: "paste", selectAll: "selectAll" };
  const inText = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)); };
  function run(cmd) {
    const id = String(cmd).replace(/^m:/, "");
    if (DRY) { DRY.push(id); return; }
    if (TEXT[id] && inText()) { try { document.execCommand(TEXT[id]); } catch (e) {} return; }
    spec(); // 14 §4: the actions as of now (a spec built up to a second ago acted on the song focused then)
    const f = ACT[id]; if (f) try { f(); } catch (e) { console.error(e); }
    update();
  }
  setInterval(() => { if (!document.hidden) send(); }, 1000);
  // tell the app when a text field has focus (the Mac's Edit menu then edits text, as in any app)
  let tf = false; const tfSend = () => { const now = inText(); if (now !== tf) { tf = now; if (native()) ncall("textFocus", { on: now }).catch?.(() => {}); } };
  document.addEventListener("focusin", tfSend); document.addEventListener("focusout", () => setTimeout(tfSend, 0));

  // ================================================================ every shortcut a menu shows works
  // (keys with ⌘ / Ctrl here; ↩, ⌫ and ⌥↑ / ⌥↓ are the page's own: they depend on what's selected)
  const CODE = { Comma: "comma", Minus: "minus", Equal: "equals", Slash: "slash", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Backspace: "backspace", Enter: "return", Space: "space" };
  function comboOf(e) {
    let k = CODE[e.code] || (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : (e.key || "").toLowerCase());
    if (k === "+" || k === "=") k = "equals"; if (k === "-") k = "minus"; if (k === "/") k = "slash"; if (k === ",") k = "comma";
    const m = []; if (MAC ? e.metaKey : e.ctrlKey) m.push("cmd"); if (MAC && e.ctrlKey) m.push("ctrl"); if (e.altKey) m.push("alt"); if (e.shiftKey) m.push("shift");
    return [...m, k].join("+");
  }
  const norm = (k) => { const P = k.split("+"), key = P.pop(); return [...["cmd", "ctrl", "alt", "shift"].filter((x) => P.includes(x)), key].join("+"); };
  function keyIndex(sp) { const map = {}; const walk = (items) => (items || []).forEach((x) => { if (x.sub) walk(x.sub); else if (x.key && x.id) { const k = norm(x.key); if (!map[k]) map[k] = x; } }); sp.menus.forEach((m) => walk(m.items)); walk(sp.app); return map; }
  document.addEventListener("keydown", (e) => {
    if (!(MAC ? e.metaKey : e.ctrlKey)) return;
    const t = e.target; const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (t && t.closest && t.closest("[data-keys=own]")) return; // an editor with its own ⌘D / ⌘C / ⌘V (the click clip)
    const c = comboOf(e);
    if (typing && !["cmd+k", "cmd+slash", "cmd+comma"].includes(c)) return; // a text field keeps ⌘C, ⌘V, ⌘Z, ⌘A…
    if (document.querySelector(".cfbg") && !["cmd+z", "cmd+shift+z"].includes(c)) return; // a dialog is open
    const sp = spec(), item = keyIndex(sp)[c]; if (!item) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (item.dis) return; // greyed out (e.g. while playing): the key does nothing either
    run(item.id);
  }, true);
  // no in-app menu button: the menus are in the window chrome
  const fb = $("fileBtn"); if (fb && fb.parentElement) fb.parentElement.remove();

  // every item, flat (⌘K, the ⌘/ sheet, the menu test): {id, label, key, path, dis, group}
  function flat(sp) {
    sp = sp || spec(); const out = [];
    const walk = (items, path) => (items || []).forEach((x) => { if (x.sep || x.header) return; if (x.sub) { walk(x.sub, [...path, x.label]); return; } out.push({ id: x.id.replace(/^m:/, ""), label: x.label, key: x.key, keyText: keyText(x.key), path, dis: x.dis, check: x.check, danger: x.danger, help: x.help }); });
    sp.menus.forEach((m) => walk(m.items, [m.name])); walk(sp.app, ["set.Line"]);
    return out;
  }
  window.SLMenus = { spec, update, run, send, flat, keyText, obj, objItems, toCtx, nativeKeys: () => false,
    dry: (on) => { DRY = on ? [] : null; }, fired: () => (DRY ? DRY.slice() : []), clearFired: () => { if (DRY) DRY.length = 0; } };
  update();
})();
