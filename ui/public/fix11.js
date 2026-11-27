// set.Line 11: edit or delete anything, and the polish pass from testing 0.1.63 on the band's MacBook.
// 1. Click and Drum click tracks (and the Cues track) are tracks like any other: rename, delete (undo brings the track
//    back with its clip). A song with no click track offers "Add click track".
// 2. Every kind of object has the same rename / edit / delete in right-click, ⋯ (where it has a row), the menu bar
//    (Edit › Rename… / Edit… / Delete act on what was clicked last) and ⌘K (type its name): versions, markers, tempo
//    and time-signature changes, setlists, libraries, presets, modeler scenes, cue words. Deleting something used
//    elsewhere (a version a setlist plays, a preset songs use, a cue word cues use, a library) asks first.
// 3. Setlist rows: no ‹ › version arrows; "Album ▾" is the switcher (⌥[ / ⌥] still flip); ⋯ has its own space.
// 5. No coloured box around songs with versions; the playing song shows a green number and ▶.
// 7. Sections never overlap: imports, sections from cues and section edits trim to the next section's start; songs
//    that had overlapping sections are straightened once when the library opens (one undo note).
// 9. Count-ins on the Cues lane collapse into one "1-2-3-4" label when their words would overlap.
// 10. Track names lose a leading "<song name> / " (import, and once for existing songs, with undo).
// 11. The output picker stays readable ("Out 1"), the sideways scrollbar has its own strip, M / S states are clear.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = /Mac/.test(navigator.platform);
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const curSong = () => songOf((typeof focusId !== "undefined" && focusId) || selId);
  const busy = () => typeof playing !== "undefined" && playing;
  const note = (msg, u) => toast(msg, u === false ? undefined : undo);
  const store = { get: (k, d) => { try { const v = localStorage.getItem("setline." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("setline." + k, JSON.stringify(v)); } catch (e) {} } };
  const rename = (el, val, done, o) => (window.SL10a && SL10a.editInline ? SL10a.editInline(el, val, done, o || {}) : renameAt(el, val, done, o));
  const vis = (el) => !!el && el.isConnected && el.getBoundingClientRect().width > 0;
  const roleOf = (t) => (typeof ROLE !== "undefined" ? ROLE[t] || "" : "");

  // ================================================================ 1. click and cue tracks are tracks
  const tfull = (s, t) => (s.tfull && s.tfull[t]) || t;
  // renaming moves everything kept under the track's name; a click track named "Click" keeps its clips in s.ck,
  // any other in s.cks[name] (its role in s.troles), so moving between the two moves the clips
  const RT = window.renameTrack;
  window.renameTrack = function (s, a, b) {
    const ra = roleOf(a) || roleOf((s.troles || {})[a]);
    if (ra === "click") {
      if (a === "Click" && b !== "Click") { (s.cks || (s.cks = {}))[a] = s.ck || []; delete s.ck; (s.troles || (s.troles = {}))[a] = "Click"; }
      if (b === "Click" && a !== "Click") { s.ck = (s.cks || {})[a] || []; if (s.cks) delete s.cks[a]; if (s.troles) delete s.troles[a]; }
    }
    if (ra === "cues" && a === "Cues" && b !== "Cues") (s.troles || (s.troles = {}))[a] = "Cues";
    const r = RT.apply(this, arguments);
    if (s.troles && s.troles[b] === "Cues") regRoles(s);
    if (s.clk && s.clk[a]) { s.clk[b] = s.clk[a]; delete s.clk[a]; }
    if (s.tfull && s.tfull[a] !== undefined) { s.tfull[b] = s.tfull[a]; delete s.tfull[a]; }
    if (s.trkHs && s.trkHs[a] !== undefined) { s.trkHs[b] = s.trkHs[a]; delete s.trkHs[a]; }
    return r;
  };
  // a name that would change what a track is (an audio track called "Click") isn't taken
  const okName = (s, t, v) => {
    if (s.tracks.includes(v)) { toast(`“${v}” is already a track in ${s.name}`); return false; }
    const rv = roleOf(v), rt = roleOf(t) || roleOf((s.troles || {})[t]);
    if (rv && rv !== rt && (rv === "click" || rv === "cues")) { toast(`“${v}” is the name of a ${rv === "click" ? "click" : "cue"} track: pick another name`); return false; }
    return true;
  };
  // deleting: the track's own data goes too (Undo brings all of it back)
  if (window.SL9) {
    const DEL = SL9.deleteTrack, DUP = SL9.dupTrack;
    SL9.deleteTrack = function (s, t, rec) {
      const r = roleOf(t) || roleOf((s.troles || {})[t]);
      if (r !== "click" && r !== "cues") return DEL.call(this, s, t, rec);
      if (busy() && typeof playId !== "undefined" && playId === s.id) { toast("Stop playback first: this song is playing"); return; }
      snap();
      s.tracks.splice(s.tracks.indexOf(t), 1);
      if (r === "click") { if (t === "Click") delete s.ck; else if (s.cks) delete s.cks[t]; if (s.clk) delete s.clk[t]; if (window.SLClick && SLClick.close && SLClick.state && SLClick.state() && SLClick.state().t === t) SLClick.close(); }
      if (r === "cues" && !s.tracks.some((x) => roleOf(x) === "cues")) s.cues = [];
      ["gain", "mute", "solo", "tcol", "outs", "troles", "tfull"].forEach((k) => { if (s[k]) delete s[k][t]; });
      if (typeof trackOpen !== "undefined" && trackOpen && trackOpen.song === s.id && trackOpen.track === t) { trackOpen = null; clickOpen = false; cueOpen = false; }
      buildBars(s); refresh();
      toast(r === "click" ? `Deleted the “${t}” track and its click${clickTracks(s).length ? "" : ": this song has no click now"}` : `Deleted the “${t}” track and its cues`, undo);
    };
    // a click track's copy takes its clip along ("Click" keeps them in s.ck)
    SL9.dupTrack = function (s, t) {
      const r = roleOf(t) || roleOf((s.troles || {})[t]);
      if (r === "cues") { toast("A song has one cue track: its cues are the song’s"); return; }
      if (r !== "click") return DUP.call(this, s, t);
      snap(); let nt = t + " copy", k = 2; while (s.tracks.includes(nt)) nt = `${t} copy (${k++})`;
      const src = t === "Click" ? s.ck : (s.cks || {})[t];
      (s.cks || (s.cks = {}))[nt] = JSON.parse(JSON.stringify(src || [])); (s.troles || (s.troles = {}))[nt] = "Click";
      if (s.clk && s.clk[t]) s.clk[nt] = JSON.parse(JSON.stringify(s.clk[t]));
      ["gain", "mute", "tcol", "outs"].forEach((key) => { if (s[key] && s[key][t] !== undefined) s[key][nt] = JSON.parse(JSON.stringify(s[key][t])); });
      s.tracks.splice(s.tracks.indexOf(t) + 1, 0, nt); regRoles(s); buildBars(s); refresh(); toast(`Duplicated “${t}”`, undo);
    };
  }

  // ================================================================ 2. edit or delete anything
  const verName = (s, vid) => { const v = versOf(s).find((x) => x.id === vid); return v ? v.name : ""; };
  const inLists = (s, vid) => setlists.filter((l) => (l.order || []).includes(s.id) && entryVerId(s, l) === vid);
  function delVersion(s, vid) {
    const vs = versOf(s), v = vs.find((x) => x.id === vid); if (!v) return;
    if (vs.length < 2) { toast(`“${s.name}” keeps at least one version`); return; }
    if (busy() && playId === s.id && curVer(s).id === vid) { toast("Stop playback first: this version is playing"); return; }
    const go = () => { snap(); delVer(s, vid); refresh(); if (window.SLE && SLE.nextChanged) SLE.nextChanged(); toast(`Deleted the version “${v.name}” of ${s.name}`, undo); };
    const L = inLists(s, vid);
    if (!L.length) { go(); return; }
    const next = vs.find((x) => x.id !== vid && (v.def ? true : x.def)) || vs.find((x) => x.id !== vid);
    confirmBox(`Delete the version “${esc(v.name)}”?`, `${L.length === 1 ? `The setlist “${esc(L[0].name)}” plays` : `${L.length} setlists play`} this version of ${esc(s.name)}. ${L.length === 1 ? "It" : "They"} will play “${esc(next.name)}” instead. Undo brings it back.`, "Delete version", go);
  }
  function pickVersion(s, vid, list) {
    list = list || curSetObj();
    if (busy() && playId === s.id && list === curSetObj()) { toast(`“${s.name}” is playing: its version changes after it`); return; }
    snap(); setEntryVer(s, vid, list); if (selId === s.id || (typeof focusId !== "undefined" && focusId === s.id)) showVer(s, vid, true);
    refresh(); if (window.SLE && SLE.nextChanged) SLE.nextChanged();
  }
  const markerEl = (s, i) => document.querySelector(`.folder[data-id="${s.id}"] .mkr[data-i="${i}"] u`) || document.querySelector(`.mkr[data-i="${i}"] u`);
  const tempoEntry = (s, bar) => s.tmap.find((e) => e.bar === bar && e.bpm);
  const meterEntry = (s, bar) => s.tmap.find((e) => e.bar === bar && e.sig);
  function openTempo(s, bar) {
    const go = () => { const i = s.tmap.findIndex((e) => e.bar === bar && e.bpm); if (i < 0) return; tsel = { song: s.id, i }; selId = s.id; refresh(); setTimeout(() => openTpop(true), 30); };
    if (!document.querySelector(`.tempo .lane[data-song="${s.id}"]`)) { openSong(s.id); setTimeout(go, 200); } else go();
  }
  function delTempo(s, bar) {
    const e = tempoEntry(s, bar); if (!e) return; if (bar === 1) { toast("Bar 1’s tempo can be changed, not deleted"); return; }
    snap(); if (e.sig) { delete e.bpm; delete e.ramp; } else s.tmap.splice(s.tmap.indexOf(e), 1);
    tsel = null; if (typeof closeTpop === "function") closeTpop(); buildBars(s); refresh(); toast(`Deleted the tempo change at bar ${bar} in ${s.name}`, undo);
  }
  function openMeter(s, bar) {
    const go = () => { const b = document.querySelector(`.meter9 .lane[data-song="${s.id}"] .msig9[data-bar="${bar}"]`), r = b ? b.getBoundingClientRect() : { left: innerWidth / 2, bottom: innerHeight / 3 }; SLMeter.open(s, bar, { clientX: r.left, clientY: r.bottom + 4, target: b }); };
    if (!document.querySelector(`.meter9 .lane[data-song="${s.id}"]`)) { openSong(s.id); setTimeout(go, 200); } else go();
  }
  function delMeter(s, bar) {
    const e = meterEntry(s, bar); if (!e) return; if (bar === 1) { toast("Bar 1’s time signature can be changed, not deleted"); return; }
    snap(); const before = s.bars.map((b) => ({ sig: b.sig, grp: b.grp })); delete e.sig; delete e.grp; if (!e.bpm) s.tmap.splice(s.tmap.indexOf(e), 1);
    buildBars(s); if (typeof refillCkBars === "function") refillCkBars(s, before); if (typeof closeMpop === "function") closeMpop(); refresh();
    toast(`Deleted the time signature change at bar ${bar} in ${s.name}`, undo);
  }
  function delSetlist(id) {
    const L = setlists.find((l) => l.id === id); if (!L) return;
    if (busy() && id === curSet) { toast("Stop playback first: the setlist can’t change while a song plays"); return; }
    snap(); syncSet();
    const i = setlists.indexOf(L); setlists.splice(i, 1);
    if (!setlists.length) setlists.push({ id: "L" + setSeq++, name: "Setlist 1", order: [], col: SETCOLS[0] }); // the last one: an empty one takes its place
    if (curSet === id || !setlists.some((l) => l.id === curSet)) { curSet = setlists[Math.max(0, i - 1)].id; setOrder = curSetObj().order; }
    refresh(); toast(`Deleted the setlist “${L.name}” (its songs stay in the library)`, undo);
  }
  function renameSetlist(id) { if (id !== curSet && useSet(id) === false) return; refresh(); setTimeout(() => renameSet(), 0); }
  const presetUses = (id) => { let n = 0; const ss = new Set(); songs.forEach((x) => Object.values(x.midi || {}).forEach((l) => (l || []).forEach((e) => { if (e.presetId === id) { n++; ss.add(x.id); } }))); return { n, songs: ss.size }; };
  function delPreset(id) {
    const p = presets.find((x) => x.id === id); if (!p) return;
    const go = () => { snap(); songs.forEach((x) => Object.values(x.midi || {}).forEach((l) => (l || []).forEach((e) => { if (e.presetId === id) delete e.presetId; }))); presets = presets.filter((x) => x.id !== id); refresh(); toast(`Deleted the preset “${p.name}”`, undo); };
    const u = presetUses(id); if (!u.n) { go(); return; }
    confirmBox(`Delete the preset “${esc(p.name)}”?`, `${u.n} MIDI event${u.n === 1 ? "" : "s"} in ${u.songs} song${u.songs === 1 ? "" : "s"} use it. They keep sending the same message, without the preset’s name. Undo brings it back.`, "Delete preset", go);
  }
  function renamePreset(id) {
    const p = presets.find((x) => x.id === id); if (!p) return;
    const el = [...document.querySelectorAll(`tr[data-pid="${id}"] td:first-child`)].find(vis);
    rename(el || null, p.name, (v) => { snap(); p.name = v; if (typeof syncPreset === "function") syncPreset(p); refresh(); toast(`Renamed the preset to “${v}”`, undo); }, { label: "Preset name" });
  }
  const allCueWords = () => (typeof allWords === "function" ? allWords() : []);
  const wordUses = (w) => { let n = 0; songs.forEach((x) => (x.cues || []).forEach((c) => { if (normCue(c.text) === normCue(w.word)) n++; })); return n; };
  const wordList = (w) => (CUEWORDS.includes(w) ? CUEWORDS : (songs.find((x) => (x.cueWords || []).includes(w)) || {}).cueWords);
  function delCueWord(id) {
    const w = allCueWords().find((x) => x.id === id); if (!w) return;
    const go = () => { snap(); const L = wordList(w); if (L) L.splice(L.indexOf(w), 1); refresh(); if (typeof renderInsp === "function") renderInsp(); toast(`Deleted the recorded cue word “${w.word}”`, undo); };
    const n = wordUses(w); if (!n) { go(); return; }
    confirmBox(`Delete the recorded word “${esc(w.word)}”?`, `${n} cue${n === 1 ? " says" : "s say"} it. They’ll be spoken by the voice instead. Undo brings the recording back.`, "Delete word", go);
  }
  function renameCueWord(id) {
    const w = allCueWords().find((x) => x.id === id); if (!w) return;
    const inp = [...document.querySelectorAll(`.cwW[data-id="${id}"]`)].find(vis);
    if (inp) { inp.focus(); inp.select(); return; } // the panel's own field (it saves on change, with undo)
    rename(null, w.word, (v) => { snap(); w.word = v; refresh(); toast(`Renamed the cue word to “${v}”`, undo); }, { label: "Cue word" });
  }
  // modeler scenes: names kept per device preset in the library (MODP)
  const sceneList = () => { const out = [], M = window.MODP || {}; ["qc", "axe"].forEach((d) => Object.entries(M[d] || {}).forEach(([p, e]) => (e && e.scenes || []).forEach((sc, i) => { if (sc && sc.name) out.push({ d, p, i, name: sc.name, e }); }))); return out; };
  function renameScene(d, p, i) {
    const e = ((window.MODP || {})[d] || {})[p]; if (!e || !e.scenes || !e.scenes[i]) return; const sc = e.scenes[i];
    rename(null, sc.name, (v) => { snap(); sc.name = v; refresh(); toast(`Renamed the scene to “${v}”`, undo); }, { label: "Scene name" });
  }
  function clearScene(d, p, i) { const e = ((window.MODP || {})[d] || {})[p]; if (!e || !e.scenes || !e.scenes[i]) return; const was = e.scenes[i].name; snap(); e.scenes[i].name = ""; refresh(); toast(`Cleared the scene name “${was}”`, undo); }
  // libraries: the list comes from the app (refreshed now and then)
  let LIBS = [];
  const mod = () => (window.SLE && SLE.mod) || {};
  const pullLibs = async () => { try { if (mod().libraries) LIBS = (await mod().libraries()) || []; } catch (e) {} };
  setTimeout(pullLibs, 1500); setInterval(() => { if (!document.hidden) pullLibs(); }, 8000);
  function renameLibrary(name) {
    const cur = LIBS.find((l) => l.current); if (!cur || cur.name !== name) { toast("Open that library to rename it (Library › Switch library)"); return; }
    const el = $("crumbAll") && ($("crumbAll").querySelector(".libnm11") || $("crumbAll"));
    if (vis(el) && mod().renameLibrary) rename(el, name, (v) => { mod().renameLibrary(v).then?.(pullLibs); }, { row: "#crumb", maxRight: innerWidth - 8, label: "Library name" });
    else if (mod().renameLibrary) mod().renameLibrary();
  }

  // the items for each kind (menus9 makes them right-click / ⋯ menus; ⌘K lists them by name)
  function items(kind, a, b) {
    if (kind === "version") {
      const s = a, vid = b, vs = versOf(s), v = vs.find((x) => x.id === vid); if (!v) return [];
      const L = curSetObj(), inSet = setOrder.includes(s.id);
      return [
        ...(inSet ? [{ id: "v11play", label: `Play in ${L.name}`, act: () => pickVersion(s, vid), check: entryVerId(s) === vid }] : []),
        { id: "v11show", label: "Show", act: () => { snap(); showVer(s, vid); refresh(); }, check: curVer(s).id === vid },
        { id: "v11ren", label: "Rename…", key: "return", act: () => { const el = [...document.querySelectorAll(`.vstrip .vr[data-v="${vid}"] .vnm11`)].find(vis) || (entryVerId(s) === vid ? [...document.querySelectorAll(`#songs .song[data-id="${s.id}"] .vsw11 .vsn11`)].find(vis) : null); renameVerBox(s, vid, el || null); } },
        { id: "v11dup", label: "Duplicate", act: () => { snap(); showVer(s, vid); const n = newVer(s); refresh(); toast(`Added the version “${n.name}”`, undo); } },
        { id: "v11def", label: "Make it the main version", dis: !!v.def, act: () => { snap(); vs.forEach((x) => { x.def = x.id === vid; }); refresh(); toast(`“${v.name}” is ${s.name}’s main version`, undo); } },
        { sep: 1 },
        { id: "v11del", label: "Delete version…", danger: true, dis: vs.length < 2, act: () => delVersion(s, vid) },
      ];
    }
    if (kind === "marker") {
      const s = a, i = b, m = (s.marks || [])[i]; if (!m) return [];
      return [
        { id: "k11ren", label: "Rename…", key: "return", act: () => { const el = markerEl(s, i); rename(vis(el) ? el : null, m.name, (v) => { snap(); m.name = v.slice(0, 40); refresh(); toast(`Renamed the marker to “${m.name}”`, undo); }, { row: ".mkr", maxRight: innerWidth - 8, label: "Marker" }); } },
        { id: "k11go", label: "Go to it", act: () => locate(s, evTime(s, m)) },
        { sep: 1 },
        { id: "k11del", label: "Delete marker", danger: true, act: () => { snap(); s.marks.splice(i, 1); refresh(); toast(`Deleted the marker “${m.name}”`, undo); } },
      ];
    }
    if (kind === "tempo") {
      const s = a, bar = b, e = tempoEntry(s, bar); if (!e) return [];
      return [
        { id: "p11ed", label: "Edit tempo…", act: () => openTempo(s, bar) },
        { sep: 1 },
        { id: "p11del", label: "Delete tempo change", danger: true, dis: bar === 1, act: () => delTempo(s, bar) },
      ];
    }
    if (kind === "meter") {
      const s = a, bar = b, e = meterEntry(s, bar) || (bar === 1 ? { bar: 1 } : null); if (!e) return [];
      return [
        { id: "g11ed", label: "Edit time signature…", act: () => openMeter(s, bar) },
        { sep: 1 },
        { id: "g11del", label: "Delete time signature change", danger: true, dis: bar === 1, act: () => delMeter(s, bar) },
      ];
    }
    if (kind === "setlist") {
      const L = setlists.find((l) => l.id === a); if (!L) return [];
      return [
        { id: "l11open", label: "Open", check: L.id === curSet, act: () => { if (useSet(L.id) !== false) refresh(); } },
        { id: "l11ren", label: "Rename…", act: () => renameSetlist(L.id) },
        { id: "l11dup", label: "Duplicate", act: () => { if (L.id !== curSet && useSet(L.id) === false) return; snap(); setlistCmd("dup"); } },
        { sep: 1 },
        { id: "l11del", label: "Delete setlist", danger: true, act: () => delSetlist(L.id) },
      ];
    }
    if (kind === "library") {
      const l = LIBS.find((x) => x.name === a) || { name: a, current: false };
      return [
        { id: "y11open", label: "Open", dis: l.current || busy(), check: l.current, act: () => mod().switchLibrary && mod().switchLibrary(l.name) },
        { id: "y11ren", label: "Rename…", dis: !l.current, act: () => renameLibrary(l.name) },
        { sep: 1 },
        { id: "y11del", label: "Delete library…", danger: true, dis: l.current || !mod().deleteLibrary, act: () => mod().deleteLibrary(l.name).then?.(() => setTimeout(pullLibs, 300)) },
      ];
    }
    if (kind === "preset") {
      const p = presets.find((x) => x.id === a); if (!p) return [];
      return [
        { id: "r11ren", label: "Rename…", act: () => renamePreset(p.id) },
        { sep: 1 },
        { id: "r11del", label: "Delete preset…", danger: true, act: () => delPreset(p.id) },
      ];
    }
    if (kind === "cueword") {
      const w = allCueWords().find((x) => x.id === a); if (!w) return [];
      return [
        { id: "w11ren", label: "Rename…", act: () => renameCueWord(w.id) },
        { id: "w11play", label: "Preview", act: () => typeof previewCue === "function" && previewCue(curSong(), w.word) },
        { sep: 1 },
        { id: "w11del", label: "Delete recorded word…", danger: true, act: () => delCueWord(w.id) },
      ];
    }
    if (kind === "scene") {
      const [d, p, i] = a; return [
        { id: "z11ren", label: "Rename…", act: () => renameScene(d, p, i) },
        { sep: 1 },
        { id: "z11del", label: "Clear the name", danger: true, act: () => clearScene(d, p, i) },
      ];
    }
    return null;
  }
  const menuAt = (kind, at, a, b) => { if (window.SLMenus) SLMenus.obj(kind, at, a, b); };

  // what was clicked last (Edit › Rename… / Edit… / Delete act on it); a click on a song, a track, a section or a
  // lane forgets it (those have their own selection)
  let CUR = null;
  const classify = (t) => {
    if (!t || !t.closest) return undefined;
    let el;
    if ((el = t.closest(".mkr[data-i]"))) { const f = el.closest(".folder"), s = f && songOf(f.dataset.id); return s ? { kind: "marker", a: s, b: +el.dataset.i } : null; }
    if ((el = t.closest(".tempo .tp[data-i]"))) { const l = el.closest(".lane"), s = l && songOf(l.dataset.song), e = s && s.tmap[+el.dataset.i]; return e ? { kind: "tempo", a: s, b: e.bar } : null; }
    if ((el = t.closest(".msig9[data-bar]"))) { const l = el.closest(".lane"), s = l && songOf(l.dataset.song); return s ? { kind: "meter", a: s, b: +el.dataset.bar } : null; }
    if ((el = t.closest(".vstrip .vr[data-v]"))) { const s = songOf(el.dataset.song); return s ? { kind: "version", a: s, b: el.dataset.v } : null; }
    if ((el = t.closest(".vsw11"))) { const s = songOf(el.dataset.id); return s ? { kind: "version", a: s, b: entryVerId(s) } : null; }
    if ((el = t.closest("#setHead"))) return { kind: "setlist", a: curSet };
    if ((el = t.closest("tr[data-pid]"))) return presets.some((p) => p.id === el.dataset.pid) ? { kind: "preset", a: el.dataset.pid } : null;
    if ((el = t.closest(".kv"))) { const i = el.querySelector(".cwW[data-id]"); if (i) return { kind: "cueword", a: i.dataset.id }; }
    if (t.closest("#songs .song, #songs .brk9, .card9, .r9h, .trk, .sec, .folder, #pool .ps, canvas, #clk10")) return null;
    return undefined; // elsewhere (a menu, a button bar): keep what it was
  };
  document.addEventListener("pointerdown", (e) => { const c = classify(e.target); if (c !== undefined) CUR = c; }, true);
  document.addEventListener("contextmenu", (e) => { const c = classify(e.target); if (c !== undefined) CUR = c; }, true);
  const current = () => {
    if (!CUR) return null;
    if (CUR.a && CUR.a.id && !songOf(CUR.a.id)) { const s = songOf(CUR.a.id); if (!s) { CUR = null; return null; } }
    const L = items(CUR.kind, CUR.a, CUR.b); return L && L.length ? CUR : null;
  };
  // run Rename / Edit / Delete on the current object; false when there's none (the menus fall back to their own)
  function run(what) {
    const O = current(); if (!O) return false;
    const L = items(O.kind, O.a, O.b) || [];
    const pickIt = L.find((x) => !x.sep && !x.dis && (what === "rename" ? /^Rename/.test(x.label) : what === "delete" ? x.danger : /^Edit|^Open|^Show/.test(x.label)));
    if (!pickIt) return what === "delete" || what === "rename"; // known object, nothing to do (bar 1's tempo): don't fall through
    pickIt.act(); return true;
  }

  // right-click on the small things (each with its own items): markers, tempo points, time signatures, the version
  // rows, the setlist name, presets, cue words
  document.addEventListener("contextmenu", (e) => {
    const c = classify(e.target); if (!c || !["marker", "tempo", "meter", "version", "setlist", "preset", "cueword"].includes(c.kind)) return;
    if (c.kind === "setlist" && !e.target.closest("#setSel")) return;
    e.preventDefault(); e.stopImmediatePropagation(); CUR = c; menuAt(c.kind, e, c.a, c.b);
  }, true);
  // double-click a marker's name: rename it there
  document.addEventListener("dblclick", (e) => {
    const m = e.target.closest && e.target.closest(".mkr[data-i]"); if (!m) return; const f = m.closest(".folder"), s = f && songOf(f.dataset.id); if (!s) return;
    e.preventDefault(); e.stopImmediatePropagation(); const L = items("marker", s, +m.dataset.i); if (L) L[0].act();
  }, true);
  // a break's label: renamed where it is (double-click it, or ⋯ › Rename…)
  function renameBreak(id) {
    const B = window.SLBreaks, bk = B && B.list().find((x) => x.id === id); if (!bk) return;
    const el = [...document.querySelectorAll(`#songs .brk9[data-b="${id}"] .bt`)].find(vis);
    rename(el || null, bk.label, (v) => { snap(); bk.label = v.slice(0, 40); refresh(); toast(`Renamed the break to “${bk.label}”`, undo); }, { row: "#songs > .brk9", label: "Break" });
  }
  document.addEventListener("dblclick", (e) => { const t = e.target.closest && e.target.closest("#songs .brk9[data-b] .bt"); if (!t) return; e.preventDefault(); e.stopImmediatePropagation(); renameBreak(t.closest(".brk9").dataset.b); }, true);
  // ⋯ on a version row (the strip under a song's title)
  const decorateVers = () => document.querySelectorAll(".vstrip .vr[data-v]:not(.ix11)").forEach((r) => { r.classList.add("ix11"); r.insertAdjacentHTML("beforeend", `<button class="more11" aria-label="Version options" title="More  right-click">⋯</button>`); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".more11"); if (!b) return; e.preventDefault(); e.stopImmediatePropagation();
    const r = b.closest(".vr"), s = r && songOf(r.dataset.song); if (!s) return; const R = b.getBoundingClientRect();
    CUR = { kind: "version", a: s, b: r.dataset.v }; menuAt("version", { clientX: Math.min(R.left, innerWidth - 240), clientY: R.bottom + 4 }, s, r.dataset.v);
  }, true);

  // ⌘K: every object by name, with its actions ("Delete track “Click”", "Rename version “Album”"…)
  const KIND = { song: "song", track: "track", section: "section", break: "break", version: "version", marker: "marker", tempo: "tempo change", meter: "time signature", setlist: "setlist", library: "library", preset: "preset", cueword: "cue word", scene: "scene" };
  function objects() {
    const s = curSong(), out = [];
    if (s) {
      s.tracks.forEach((t) => out.push({ kind: "track", name: t, a: s, b: t }));
      (s.secs || []).forEach((x) => out.push({ kind: "section", name: x.name, a: s, b: x.id }));
      versOf(s).forEach((v) => out.push({ kind: "version", name: v.name, a: s, b: v.id }));
      (s.marks || []).forEach((m, i) => out.push({ kind: "marker", name: m.name, a: s, b: i }));
      s.tmap.filter((e) => e.bpm).forEach((e) => out.push({ kind: "tempo", name: `bar ${e.bar} (${fmtBpm(e.bpm)} BPM)`, a: s, b: e.bar }));
      s.tmap.filter((e) => e.sig).forEach((e) => out.push({ kind: "meter", name: `${e.sig.join("/")} at bar ${e.bar}`, a: s, b: e.bar }));
    }
    setlists.forEach((l) => out.push({ kind: "setlist", name: l.name, a: l.id }));
    LIBS.forEach((l) => out.push({ kind: "library", name: l.name, a: l.name }));
    presets.filter((p) => !p.built).forEach((p) => out.push({ kind: "preset", name: p.name, a: p.id }));
    allCueWords().forEach((w) => out.push({ kind: "cueword", name: w.word, a: w.id }));
    sceneList().forEach((x) => out.push({ kind: "scene", name: x.name, a: [x.d, x.p, x.i] }));
    if (window.SLBreaks) SLBreaks.list().filter((b) => setOrder.includes(b.after) || !b.after).forEach((b) => out.push({ kind: "break", name: b.label, a: b.id }));
    return out;
  }
  const VERB = /^(Rename|Delete|Remove|Edit|Duplicate|Clear)/;
  function palette(q, score) {
    if (!q || q.length < 2) return [];
    const out = [];
    for (const o of objects()) {
      if (!score(q, "rename delete edit duplicate remove clear " + KIND[o.kind] + " " + o.name)) continue;
      const own = items(o.kind, o.a, o.b);
      const L = own || (window.SLMenus ? SLMenus.objItems(o.kind, o.a, o.b) : []);
      for (const x of L || []) {
        if (!x || x.sep || x.header || x.sub || x.dis || !VERB.test(x.label)) continue;
        const verb = x.label.replace(/…$/, "").replace(/ (track|version|marker|setlist|library|preset|recorded word|tempo change|time signature change)$/i, "");
        const label = `${verb} ${KIND[o.kind]} “${o.name}”${/…$/.test(x.label) ? "…" : ""}`;
        const sc = score(q, label); if (!sc) continue;
        out.push({ g: "Edit", label, key: "", ctx: o.a && o.a.name && o.kind !== "setlist" && o.kind !== "library" && typeof o.a === "object" ? o.a.name : "", sc: sc + 5,
          run: () => { if (own) { const f = (items(o.kind, o.a, o.b) || []).find((y) => y.label === x.label); if (f) f.act(); } else { SLMenus.objItems(o.kind, o.a, o.b); SLMenus.run(x.id); } } });
      }
    }
    return out.slice(0, 30);
  }

  // ================================================================ 3 / 5. setlist rows: the version switcher
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".vsw11"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const s = songOf(b.dataset.id); if (!s) return; const r = b.getBoundingClientRect(), vs = versOf(s), cur = entryVerId(s);
    CUR = { kind: "version", a: s, b: cur };
    ctxMenu({ clientX: r.left, clientY: r.bottom + 4 }, [{ cap: `${s.name} · plays in ${curSetObj().name}` },
      ...vs.map((v) => ({ label: `${v.name}  ·  ${fmt(verLen(s, v))}`, icon: v.id === cur ? "✓" : "", act: () => { if (v.id !== cur) pickVersion(s, v.id); } })),
      "-", { label: "Rename this version…", icon: "", act: () => { const el = [...document.querySelectorAll(`#songs .song[data-id="${s.id}"] .vsw11 .vsn11`)].find(vis); renameVerBox(s, cur, el || null); } },
      { label: "More version options ▸", icon: "", act: () => menuAt("version", { clientX: r.left, clientY: r.bottom + 4 }, s, cur) }]);
  }, true);
  // the switcher is a button in the row: no drag, no open-the-song from it
  ["pointerdown", "dblclick", "mousedown"].forEach((t) => document.addEventListener(t, (e) => { if (e.target.closest && e.target.closest(".vsw11")) e.stopPropagation(); }, true));
  // ⌥[ / ⌥]: the selected setlist song's previous / next version
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || (e.code !== "BracketLeft" && e.code !== "BracketRight")) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const s = songOf(selId); if (!s || !setOrder.includes(s.id) || versOf(s).length < 2) return;
    e.preventDefault(); e.stopImmediatePropagation(); flipVer(s, e.code === "BracketRight" ? 1 : -1);
  }, true);
  // the playing song: a green number and ▶ (a cheap check, a few times a second)
  setInterval(() => {
    const id = busy() && typeof playId !== "undefined" ? playId : null;
    document.querySelectorAll("#songs > .song").forEach((r) => r.classList.toggle("pl11", r.dataset.id === id));
  }, 250);

  // ================================================================ 7. sections never overlap
  // trims each section to end where the next one starts (start bars snapped to whole bars, inside the song);
  // two sections on the same bar: the later one goes. Returns how many sections changed.
  function straighten(list, total) {
    if (!Array.isArray(list) || !list.length) return 0;
    let n = 0;
    const L = list.slice().sort((a, b) => a.start - b.start), drop = new Set();
    L.forEach((x) => { const st = Math.max(1, Math.min(total || 1e9, Math.round(+x.start || 1))); if (st !== x.start) { x.start = st; n++; } const b = Math.max(1, Math.round(+x.bars || 1)); if (b !== x.bars) { x.bars = b; n++; } });
    L.sort((a, b) => a.start - b.start);
    for (let i = 1; i < L.length; i++) if (L[i].start === L[i - 1].start) { drop.add(L[i]); n++; }
    const K = L.filter((x) => !drop.has(x));
    K.forEach((x, i) => { const nx = K[i + 1], end = nx ? nx.start : (total || 1e9) + 1; if (x.start + x.bars > end) { x.bars = Math.max(1, end - x.start); n++; } });
    if (drop.size) for (let i = list.length - 1; i >= 0; i--) if (drop.has(list[i])) list.splice(i, 1);
    return n;
  }
  const overlaps = (list) => { const L = (list || []).slice().sort((a, b) => a.start - b.start); return L.some((x, i) => i && (L[i - 1].start + L[i - 1].bars > x.start || x.start === L[i - 1].start || x.start % 1 || L[i - 1].start % 1)); };
  // a song's own sections and every version's that keeps its own (own-timeline versions, the main song's while a
  // version is shown)
  const sectionLists = (s) => { const out = [{ L: s.secs, total: s.total, where: "" }]; versOf(s).forEach((v) => { if (v.custom && v.state && v.state.secs && v.id !== s.ver) out.push({ L: v.state.secs, total: (v.state.tmap && s.total) || s.total, where: v.name }); }); if (s.srcState && s.srcState.secs) out.push({ L: s.srcState.secs, total: s.total, where: defVer(s).name }); return out; };
  const fixSong = (s) => { let n = 0; for (const x of sectionLists(s)) n += straighten(x.L, x.total); if (n) { normSecs(s); buildBars(s); } return n; };
  // after the edits that can make an overlap: sections from cues, an import, a section dragged or resized
  if (window.SLSecs) { const AP = SLSecs.apply; SLSecs.apply = function (s) { const r = AP.apply(this, arguments); fixSong(s); return r; }; }
  for (const f of ["addSecAt", "splitAt"]) { const F = window[f]; if (typeof F === "function") window[f] = function (s) { const r = F.apply(this, arguments); if (fixSong(s)) refresh(); return r; }; }
  document.addEventListener("pointerup", (e) => { const lane = e.target.closest && e.target.closest(".secs .lane[data-song]"); const s = lane && songOf(lane.dataset.song); if (s) setTimeout(() => { if (fixSong(s)) refresh(); }, 0); });

  // ================================================================ 10. no "<song> / " in front of track names
  const esc_re = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shortName = (song, t) => { const m = String(t).match(new RegExp("^\\s*" + esc_re(String(song).trim()) + "\\s*(/|-|–|—)\\s*(.+)$", "i")); return m && m[2].trim() ? m[2].trim() : null; };
  // renames inside one song (its own timeline versions too); returns how many
  function cleanNames(s, name) {
    let n = 0;
    const one = (o) => { (o.tracks || []).slice().forEach((t) => { const nt = shortName(name || s.name, t); if (!nt || nt === t || o.tracks.includes(nt) || roleOf(nt) === "click" || roleOf(nt) === "cues") return; window.renameTrack(o, t, nt); (o.tfull || (o.tfull = {}))[nt] = t; n++; }); };
    one(s); versOf(s).forEach((v) => { if (v.custom && v.state && v.state.tracks && v.id !== s.ver) one(v.state); }); if (s.srcState && s.srcState.tracks) one(s.srcState);
    return n;
  }
  if (window.SLAble && window.ableSong) {
    const AS = window.ableSong;
    window.ableSong = function (src) {
      const r = AS.apply(this, arguments), so = r && r.so; if (!so) return r;
      const before = so.tracks.slice(); const n = window.SL12 && SL12.applyTrackNames ? SL12.applyTrackNames(src, so, r.rows || []) : cleanNames(so, src.name);
      if (n) { const map = {}; before.forEach((t, i) => { if (so.tracks[i] !== t) map[t] = so.tracks[i]; }); (r.rows || []).forEach((x) => { if (map[x.name]) x.name = map[x.name]; }); }
      if (straighten(so.secs, so.total)) { normSecs(so); buildBars(so); }
      return r;
    };
    SLAble.song = window.ableSong;
  }

  // ================================================================ repair once, when the library opens
  // songs with overlapping sections are straightened, "<song> / " prefixes dropped; one undo note for all of it.
  // Each song once (kept on this computer), so an Undo stays undone.
  let seen = new Set(store.get("fix11", []));
  function repair() {
    if (busy() || !songs.length || document.querySelector(".cfbg")) return null;
    const todo = songs.filter((s) => !seen.has(s.id) && s.secs && s.bars);
    if (!todo.length) return null;
    const need = todo.filter((s) => sectionLists(s).some((x) => overlaps(x.L)) || s.tracks.some((t) => shortName(s.name, t)) || versOf(s).some((v) => v.custom && v.state && v.state.tracks && v.state.tracks.some((t) => shortName(s.name, t))));
    let secs = 0, names = 0; const sSongs = [], nSongs = [];
    if (need.length) {
      snap();
      need.forEach((s) => { const a = fixSong(s), b = cleanNames(s); if (a) { secs += a; sSongs.push(s.name); } if (b) { names += b; nSongs.push(s.name); } });
      refresh();
      const parts = []; if (secs) parts.push(`Straightened ${secs} section${secs === 1 ? "" : "s"} in ${sSongs.length === 1 ? sSongs[0] : sSongs.length + " songs"}`);
      if (names) parts.push(`${parts.length ? "shortened" : "Shortened"} ${names} track name${names === 1 ? "" : "s"} in ${nSongs.length === 1 ? nSongs[0] : nSongs.length + " songs"}`);
      if (parts.length) toast(parts.join(" and "), undo); else undoS.pop();
    }
    todo.forEach((s) => seen.add(s.id)); store.set("fix11", [...seen].slice(-4000));
    const r = { songs: sSongs.length, sections: secs, nameSongs: nSongs.length, names, sectionSongs: sSongs, nameSongList: nSongs };
    LAST = r; return r;
  }
  let LAST = null, PAUSE = false;
  setInterval(() => { if (!PAUSE) try { repair(); } catch (e) { console.error(e); } }, 1500);

  // ================================================================ 9. count-ins on the Cues lane
  const COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const countNum = (w) => { const k = String(w || "").trim().toLowerCase().replace(/[.!,]+$/, ""); if (COUNT[k]) return COUNT[k]; if (/^[1-8]$/.test(k)) return +k; return 0; };
  const DL = window.drawLane;
  window.drawLane = function (cv) {
    const s = songOf(cv.dataset.song), t = s && s.tracks[+cv.dataset.t];
    if (!s || !t || roleOf(t) !== "cues" || isMidiTrack(s, t)) return DL.apply(this, arguments);
    const { g, vx, vw } = laneView(cv), H = cv.height, W = +cv.dataset.w; g.clearRect(vx, 0, vw, H);
    const off = isOff(s, t), AW = s.audio * PXS, c = trackCol(s, t);
    const y0 = clip(g, 0, AW, H, "#7d8696", "Cues (generated)", off);
    g.clearRect(0, 0, W, H);
    const cs = cuesOf(s);
    g.font = "600 10.5px Inter, sans-serif";
    const top = H >= 40 ? y0 : 3, bot = H - 3, tiny = bot - top < 12, lh = Math.min(20, bot - top), ly = top + (bot - top - lh) / 2;
    const lay = cs.map((c) => ({ c, X: cueT(s, c) * PXS, n: countNum(c.text), full: g.measureText(c.text).width + 14 })).sort((a, b) => a.X - b.X);
    // groups: count words next to each other whose labels would run into each other
    const lab = [];
    for (let i = 0; i < lay.length; i++) {
      const o = lay[i];
      if (o.n) {
        const grp = [o]; let j = i + 1;
        while (j < lay.length && lay[j].n && lay[j].X < grp[grp.length - 1].X + grp[grp.length - 1].full + 2) { grp.push(lay[j]); j++; }
        if (grp.length > 1) { const nums = grp.map((x) => x.n); const txt = nums.length <= 4 ? nums.join("-") : nums.slice(0, 4).join("-") + "…"; lab.push({ X: o.X, txt, full: g.measureText(txt).width + 14, items: grp, group: true }); i = j - 1; continue; }
      }
      lab.push({ X: o.X, txt: o.c.text, full: o.full, items: [o], group: false });
    }
    // every label stops before the next one (shortened "Tur…", or only its tick when there's no room)
    lab.forEach((L, i) => { const nx = lab[i + 1]; L.tw = Math.min(L.full, nx ? nx.X - L.X - 3 : L.full, AW - L.X - 2); if (tiny || L.tw < 18) L.tw = 0; });
    cv._cues = lab.flatMap((L) => L.items.map((o, k) => ({ x0: o.X - 2, x1: o.X + Math.max(6, k === 0 ? L.tw : 0), t: o.c.text, y: ly, h: lh, w: k === 0 ? L.tw : 0 })));
    const isPick = (id) => (pick && pick.kind === "cue" && pick.song === s.id && pick.track === t && pick.id === id) || isMulti("cue", s.id, t, id);
    for (const L of lab) {
      const sel = L.items.some((o) => isPick(o.c.id));
      L.items.forEach((o) => { g.fillStyle = isPick(o.c.id) ? "#e9ebef" : "#8a909b"; g.fillRect(o.X, top, 1.5, bot - top); });
      if (!L.tw) continue;
      let txt = L.txt; if (L.tw < L.full) { while (txt.length > 1 && g.measureText(txt + "…").width + 14 > L.tw) txt = txt.slice(0, -1); txt += "…"; }
      g.fillStyle = sel ? "#e9ebef" : L.group ? "#232a33" : "#2a2f37"; g.beginPath(); g.roundRect(L.X, ly, L.tw, lh, 5); g.fill();
      g.fillStyle = sel ? "#0b0c0e" : L.group ? "#aab4c3" : "#d9dce1"; g.fillText(txt, L.X + 7, ly + lh / 2 + 4);
      if (!L.group && recFor(s, L.txt)) { g.fillStyle = sel ? "#0b0c0e" : "#f5a524"; g.beginPath(); g.arc(L.X + L.tw - 4, ly + 4, 2.2, 0, 7); g.fill(); }
    }
    cv._lab11 = lab.map((L) => ({ x: L.X, w: L.tw, txt: L.txt, group: L.group, n: L.items.length }));
    if (!cs.length) { g.fillStyle = "#4f555f"; g.font = "11px Inter, sans-serif"; g.fillText("No cues. Double-click to add a spoken cue.", (+cv.dataset.vx || 0) + 10, H / 2 + 4); }
  };

  // ================================================================ 11. headers, the scrollbar, M / S
  // the output picker keeps "Out 1" when the header is narrow (the name gives way first); its full name in the tooltip
  // 11b: the track name gets room first (about 90 px, or all of its own text if shorter). When it hasn't, in this
  // order: the level slider becomes a small knob, the output chip says "Out 1", then just "1" (the full output in
  // its tooltip); M / S stay; only then does the name shorten with "…". Measured in layout pixels (clientWidth /
  // scrollWidth), which Text size's zoom doesn't disturb.
  const NAMEW = 90;
  function fitHeader(lh) {
    const tn = lh.querySelector(".tn"), b = lh.querySelector(".ochip"); if (!tn) return;
    let full = "";
    if (b) { full = b.dataset.full11 || b.textContent; if (!b.dataset.full11) { b.dataset.full11 = full; if (!b.title || /^(Output|MIDI)/.test(b.title)) b.title = (b.title ? b.title + ": " : "") + full.replace(/ ▾$/, ""); } }
    const chip = (t) => { if (b && b.textContent !== t) b.textContent = t; };
    const shortOut = (x) => x.replace(/^Output(s)?\s+/, "Out ").replace(/^No output/, "No out");
    const tiny = (x) => { const m = x.match(/Ch\s*(\d+)/); if (/^Out(put)?s?\s/.test(x)) return x.replace(/^Out(put)?s?\s+/, ""); if (m) return "Ch " + m[1] + " ▾"; if (/^No output/.test(x)) return "– ▾"; return x; };
    lh.classList.remove("nm1", "nm2"); chip(full);
    const ok = () => tn.clientWidth >= Math.min(NAMEW, tn.scrollWidth) - 1;
    if (ok()) return 0;
    lh.classList.add("nm1"); if (ok()) return 1;
    if (b) { chip(shortOut(full)); if (ok()) return 2; lh.classList.add("nm2"); chip(tiny(full)); }
    return 3;
  }
  function headers() {
    if (window.SL10a && SL10a.editing && SL10a.editing()) return; // not while a name is being typed
    document.querySelectorAll(".row.trk > .lh").forEach(fitHeader);
    decorateVers();
    // a song without a click track: "＋ Click track" stands out
    document.querySelectorAll(".folder[data-id] .add .addT[data-k=\"click\"]").forEach((b) => { const s = songOf(b.dataset.song); b.classList.toggle("sug11", !!s && !clickTracks(s).length); if (s && !clickTracks(s).length) b.textContent = "＋ Add click track"; });
  }
  let hp = false; const later = () => { if (hp) return; hp = true; requestAnimationFrame(() => { hp = false; try { headers(); } catch (e) {} }); };
  const watch = () => { const sc = $("scroller"); if (sc && !sc._fix11) { sc._fix11 = true; new MutationObserver(later).observe(sc, { childList: true, subtree: true }); } };
  watch(); setTimeout(() => { watch(); later(); }, 300); addEventListener("resize", later);

  // 11b: while a name is being edited in place, the page doesn't redraw (it would replace the element being typed
  // in); what was asked for runs once the edit ends
  let held = false;
  for (const f of ["refresh", "renderSetlist", "renderFolders", "renderInsp"]) {
    const F = window[f]; if (typeof F !== "function") continue;
    window[f] = function () { if (window.SL10a && SL10a.editing && SL10a.editing()) { held = true; return; } return F.apply(this, arguments); };
  }
  if (window.SL10a && SL10a.onEnd) SL10a.onEnd(() => { if (held) { held = false; setTimeout(() => { if (!SL10a.editing()) refresh(); }, 0); } later(); });
  window.SL11 = { setCur: (o) => { CUR = o; }, fitHeader, renameBreak, items, current, run, palette, objects, fullName: tfull, straighten, overlaps, fixSong, repair, last: () => LAST, cleanNames, shortName, delVersion, pickVersion, delTempo, delMeter, delSetlist, delPreset, delCueWord, renameSetlist, okName, libs: () => LIBS, pullLibs, countNum, pause: (on) => { PAUSE = !!on; }, forget: () => { seen = new Set(); store.set("fix11", []); } };
})();
