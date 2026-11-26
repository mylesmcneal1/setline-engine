// set.Line 10c: merge songs as versions. Live has no versions, so "GARDEN" and "GARDEN (EXTENDED INTRO)" come in as
// two songs; merged, the second is a version of the first with its own timeline (its own tracks and audio, tempo
// map, time signatures, sections, click clip and cues). It's still the same song: same name, colour, fields and
// presets. The Versions ▾ picker lists both kinds (the 6e versions made from sections, and these).
// - The model: a version {own: true, custom: true, state: the timeline fields, from: the song it was}. Shown, its
//   state is swapped into the song (as a 6e custom version is, with more fields); the source waits in srcState.
// - Merge as versions… (Library menu, a selection's menu, the import's Sort step) and Unmerge version; Undo.
// - Setlists that had the merged song now play the main song with that version: nothing changes in what plays.
// - Audio: the library stores a file once by its content, so versions using the same files share them.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // the timeline fields an own version keeps (VER_FIELDS, 6e, is the smaller set a section version keeps)
  const OWN = ["tracks", "files", "clips", "gain", "mute", "solo", "tcol", "outs", "troles", "midiCfg", "midi", "malts", "muse", "secMap", "tmap", "origMap", "secs", "ck", "cks", "clk", "cues", "cueWords", "marks", "audio", "vonly", "trkH", "trkHs"];
  const fieldsFor = (v) => (v && v.own ? OWN : VER_FIELDS);
  const snapF = (s, L) => { s.tracks.filter((t) => isMidiTrack(s, t)).forEach((t) => altsOf(s, t)); return clone(L.reduce((o, k) => ((o[k] = s[k]), o), {})); };
  function putF(s, st, L) {
    L.forEach((k) => { if (k === "trans") return; const v = st ? st[k] : undefined;
      if (v === undefined || v === null) { if (k === "secs" || k === "tracks") s[k] = s[k] && L === VER_FIELDS ? s[k] : []; else delete s[k]; } else s[k] = clone(v); });
    if (!s.clips) s.clips = {}; if (!s.muse) s.muse = {};
    s.tracks.filter((t) => isMidiTrack(s, t)).forEach((t) => { const a = altsOf(s, t).find((x) => x.id === s.muse[t]) || altsOf(s, t)[0]; useAlt(s, t, a.id); });
  }
  // showing a version: the 6e swap, with each kind's own fields
  window.showVer = function (s, id, keepEntry) {
    const to = versOf(s).find((v) => v.id === id); if (!to) return; const from = curVer(s);
    if (from.id !== to.id) {
      if (from.custom) { from.state = snapF(s, fieldsFor(from)); putF(s, s.srcState, s.srcFields ? OWN : VER_FIELDS); delete s.srcState; delete s.srcFields; }
      if (to.custom) { const L = fieldsFor(to); s.srcState = snapF(s, L); if (L === OWN) s.srcFields = "own"; putF(s, to.state, L); }
      s.ver = to.id; if (typeof selSec !== "undefined" && selSec && selSec.song === s.id) selSec = null; if (typeof selClip !== "undefined" && selClip && selClip.song === s.id) selClip = null;
      buildBars(s);
    }
    if (!keepEntry && setOrder.includes(s.id)) setEntryVer(s, to.id);
  };
  // what the engine gets for a version: the source, a section version, or an own timeline
  window.verFields = function (s, v) {
    const o = JSON.parse(JSON.stringify(s, function (k, x) { return this === s && (k === "bars" || k === "secPos" || k === "_yy" || k === "srcState" || k === "srcFields" || k === "versions") ? undefined : x; }));
    const cv = curVer(s);
    const take = (st, L) => L.forEach((k) => { if (k === "trans") return; if (st[k] === undefined || st[k] === null) delete o[k]; else o[k] = clone(st[k]); });
    if (v && cv.id !== v.id) { if (cv.custom && s.srcState) take(s.srcState, s.srcFields ? OWN : VER_FIELDS); if (v.custom && v.state) take(v.state, fieldsFor(v)); }
    if (!o.tracks) o.tracks = [];
    if (o.malts) Object.keys(o.malts).forEach((t) => { const a = o.malts[t].find((y) => y.id === (o.muse || {})[t]) || o.malts[t][0]; if (a) (o.midi || (o.midi = {}))[t] = a.events; });
    return o;
  };
  // what plays is what's shown: a song starting with an own version not on screen switches to it
  if (window.SLPage && SLPage.ver) { const PL = SLPage.ver.play; SLPage.ver.play = function (s) { const v = PL.apply(this, arguments); if (v && v.own && curVer(s).id !== v.id) { showVer(s, v.id, true); try { refresh(); } catch (e) {} } return v; }; }

  // ================================================================ merge, unmerge
  // parts: [{id, name}] (the songs that become versions of main, and their version names)
  function merge(mainId, parts, o = {}) {
    const main = songOf(mainId); if (!main) return { error: "No main song" };
    const others = parts.map((p) => ({ ...p, s: songOf(p.id) })).filter((p) => p.s && p.s !== main);
    if (!others.length) return { error: "Choose at least one other song" };
    if (!o.quiet) snap();
    const out = [];
    if (curVer(main).custom) showVer(main, defVer(main).id, true);
    for (const p of others) {
      const x = p.s; if (curVer(x).custom) showVer(x, defVer(x).id, true);
      const mainFiles = new Set(Object.values(main.files || {}).map((f) => f && f.path).filter(Boolean));
      const shared = Object.values(x.files || {}).filter((f) => f && f.path && mainFiles.has(f.path)).length;
      const v = { id: "v" + verSeq++, name: p.name || "Version", custom: true, own: true, state: snapF(x, OWN), from: { id: x.id, name: x.name, col: x.col, key: x.key, added: x.added } };
      versOf(main).push(v);
      const both = [];
      for (const L of setlists) {
        const i = (L.order || []).indexOf(x.id); if (i < 0) continue;
        // a setlist with both (Live's own arrangement has both, having no versions): it keeps the main song once, at
        // the first of the two places; the other version is one ‹ › away
        if (L.order.includes(main.id)) {
          const j = L.order.indexOf(main.id); if (i < j) { L.order.splice(j, 1); L.order[i] = main.id; } else L.order.splice(i, 1);
          (L.breaks || []).forEach((b) => { if (b.after === x.id) b.after = main.id; }); (L.pendingBreaks || []).forEach((b) => { if (b.after === x.id) b.after = main.id; });
          if (L.vers) delete L.vers[x.id]; if (L.after) delete L.after[x.id]; both.push(L.name); continue;
        }
        L.order[i] = main.id; (L.vers || (L.vers = {}))[main.id] = v.id; if (L.vers[x.id]) delete L.vers[x.id];
        if (L.after && L.after[x.id]) { L.after[main.id] = L.after[x.id]; delete L.after[x.id]; }
        (L.breaks || []).forEach((b) => { if (b.after === x.id) b.after = main.id; }); (L.pendingBreaks || []).forEach((b) => { if (b.after === x.id) b.after = main.id; });
      }
      songs.splice(songs.indexOf(x), 1); open.delete(x.id);
      if (selId === x.id) selId = main.id; if (typeof focusId !== "undefined" && focusId === x.id) focusId = main.id;
      if (typeof songSel !== "undefined") songSel.delete(x.id);
      out.push({ main: main.name, song: x.name, version: v.name, tracks: v.state.tracks.length, shared, files: Object.keys(x.files || {}).length, both });
    }
    const had = [...new Set(out.flatMap((x) => x.both))];
    if (!o.quiet) { refresh(); toast(`Merged ${out.length > 1 ? out.length + " songs" : "“" + out[0].song + "”"} into “${main.name}” as ${out.length > 1 ? "versions" : "the version “" + out[0].version + "”"}${had.length ? ` (${had.join(", ")} had both: it keeps “${main.name}” once)` : ""}`, undo); }
    return { merged: out };
  }
  const canUnmerge = (s) => !!(s && curVer(s).own);
  function unmerge(s) {
    if (!canUnmerge(s)) { toast("Show the version to unmerge first (Versions ▾)"); return null; }
    const v = curVer(s); snap();
    const back = versOf(s).find((x) => x !== v && !x.own) || versOf(s).find((x) => x !== v);
    showVer(s, back.id, true); // the version's latest edits go into v.state
    const f = v.from || {}, id = f.id && !songs.some((x) => x.id === f.id) ? f.id : freshSongId();
    const n = { id, name: f.name || `${s.name} (${v.name})`, col: f.col || s.col, key: f.key || s.key, trans: "stop", added: f.added || Date.now(), ...(s.fields ? { fields: clone(s.fields) } : {}) };
    n.tracks = []; putF(n, v.state, OWN); normSecs(n); buildBars(n);
    songs.splice(songs.indexOf(s) + 1, 0, n);
    for (const L of setlists) if (L.vers && L.vers[s.id] === v.id) { const i = L.order.indexOf(s.id); if (i >= 0) L.order[i] = n.id; delete L.vers[s.id]; }
    s.versions = s.versions.filter((x) => x !== v); if (v.def && s.versions.length) s.versions[0].def = true;
    refresh(); toast(`“${n.name}” is its own song again`, undo);
    return n;
  }

  // ================================================================ variants: "GARDEN (EXTENDED INTRO)" is a version of "GARDEN"
  const VW = new Set(["EXT", "EXTENDED", "INTRO", "ALT", "ALTERNATE", "ACOUSTIC", "SHORT", "RADIO", "EDIT", "LIVE", "V2", "2"]);
  const norm = (n) => String(n || "").toUpperCase().replace(/[()[\]{}\-_.,:;/]+/g, " ").replace(/\s+/g, " ").trim();
  const nice = (rest) => { const w = rest.split(" ").filter(Boolean).map((x) => (x === "V2" ? "V2" : x.toLowerCase())); const s = w.join(" "); return s ? s[0].toUpperCase() + s.slice(1) : "Version"; };
  // the main song a name is a variant of (the longest matching name), and the version name: {main, name} or null
  function variantOf(name, mains) {
    const N = norm(name); let best = null;
    for (const m of mains) {
      const M = norm(m); if (!M || M === N || !N.startsWith(M + " ")) continue;
      const rest = N.slice(M.length).trim(); if (!rest.split(" ").every((w) => VW.has(w))) continue;
      if (!best || M.length > norm(best.main).length) best = { main: m, name: nice(rest) };
    }
    return best;
  }
  // suggestions among names (and the library's songs as possible mains): [{other, main, name}]
  function suggest(names, libNames = []) {
    const all = [...new Set([...names, ...libNames])], out = [];
    for (const n of names) { const v = variantOf(n, all); if (v) out.push({ other: n, main: v.main, name: v.name, on: true }); }
    return out;
  }

  // ---- the import (9a's window, step 2): the suggestions, ticked; the user can untick, pick another main, rename
  let MERGE = null; // [{other, main, name, on}] for the import in progress
  const AB = window.ableBox;
  window.ableBox = function (data, ctx, host) {
    const names = data.songs.map((s) => s.name), lib = songs.map((s) => s.name);
    MERGE = suggest(names, lib);
    const p = AB.apply(this, arguments);
    const box = host || $("ableBox");
    const inject = () => {
      if (!MERGE.length || !box || box.querySelector(".abver10")) return;
      const list = box.querySelector(".ablelist") || box.firstElementChild; if (!list) return;
      const opts = (m) => [...new Set([...names, ...lib])].filter((n) => n !== m.other).map((n) => `<option ${n === m.main ? "selected" : ""}>${esc(n)}</option>`).join("");
      const el = document.createElement("div"); el.className = "abver10";
      el.innerHTML = `<div class="abvh10"><b>Versions</b><span class="faint">Live has no versions, so these came in as separate songs</span></div>${MERGE.map((m, i) => `<label class="abvr10"><input type="checkbox" data-mi="${i}" ${m.on ? "checked" : ""}> Merge <b>${esc(m.other)}</b> into <select data-mm="${i}">${opts(m)}</select> as a version named <input data-mn="${i}" value="${esc(m.name)}" spellcheck="false"></label>`).join("")}`;
      list.parentElement.insertBefore(el, list);
      el.querySelectorAll("[data-mi]").forEach((c) => c.onchange = () => { MERGE[+c.dataset.mi].on = c.checked; });
      el.querySelectorAll("[data-mm]").forEach((c) => c.onchange = () => { MERGE[+c.dataset.mm].main = c.value; });
      el.querySelectorAll("[data-mn]").forEach((c) => c.oninput = () => { MERGE[+c.dataset.mn].name = c.value.trim() || "Version"; });
    };
    if (box) { inject(); new MutationObserver(inject).observe(box, { childList: true }); }
    return p.then((r) => { if (r && typeof r === "object" && r.opt) r.opt.merge = MERGE.filter((m) => m.on).map(({ other, main, name }) => ({ other, main, name })); return r; });
  };
  // after the songs are added: the merges (in the same Undo step as the import)
  if (window.SLAble) {
    const ADD = SLAble.add;
    SLAble.add = function (data, picks, refs, infos, setlist, opt) {
      const r = ADD.apply(this, arguments);
      let want = opt && opt.merge;
      if (want === undefined) want = suggest(picks.map((p) => data.songs[p.i].name), songs.map((s) => s.name)).map(({ other, main, name }) => ({ other, main, name })); // tests: ticked by default
      const added = new Set(r.added), byName = (n, onlyNew) => songs.find((s) => s.name === n && (!onlyNew || added.has(s.id))) || null;
      r.merged = []; r.mergeErrors = [];
      for (const m of want || []) {
        const x = byName(m.other, true), main = songs.find((s) => s.name === m.main && added.has(s.id)) || byName(m.main, false);
        if (!x || !main || x === main) continue;
        const res = merge(main.id, [{ id: x.id, name: m.name }], { quiet: true });
        if (res.error) r.mergeErrors.push(res.error); else { r.merged.push(...res.merged); r.added = r.added.filter((id) => id !== x.id); }
      }
      if (r.merged.length) refresh();
      return r;
    };
  }

  // ================================================================ Merge as versions… (Library menu, a selection)
  function mergeBox(ids) {
    ids = (ids || []).filter((id) => songOf(id));
    if (ids.length < 2) { toast("Select two or more songs to merge (Edit › Select songs, then ⌘-click)"); return; }
    const L = ids.map(songOf), guess = L.slice().sort((a, b) => a.name.length - b.name.length)[0];
    let main = guess.id; const names = {}; L.forEach((s) => { const v = variantOf(s.name, [guess.name]); names[s.id] = v ? v.name : s.name; });
    const bg = document.createElement("div"); bg.className = "cfbg";
    const draw = () => { bg.innerHTML = `<div class="cfbox mergebox10" role="dialog" aria-label="Merge as versions"><b>Merge ${L.length} songs as versions</b>
      <p>Pick the main song. The others become its versions, each with its own timeline (tracks, audio, tempo, sections, click, cues). Setlists keep playing exactly what they played.</p>
      <div class="mgl10">${L.map((s) => `<label class="mgr10 ${s.id === main ? "on" : ""}"><input type="radio" name="mg10" value="${s.id}" ${s.id === main ? "checked" : ""}><span class="mgn10">${esc(s.name)}</span>${s.id === main ? `<em>main song</em>` : `<span>version name <input data-n="${s.id}" value="${esc(names[s.id])}" spellcheck="false"></span>`}</label>`).join("")}</div>
      <div class="cfa"><button class="btn line" data-a="no">Cancel</button><button class="btn pri" data-a="ok">Merge as versions</button></div></div>`;
      bg.querySelectorAll('input[name="mg10"]').forEach((r) => r.onchange = () => { main = r.value; draw(); });
      bg.querySelectorAll("[data-n]").forEach((i) => i.oninput = () => { names[i.dataset.n] = i.value.trim() || "Version"; });
      bg.querySelector('[data-a="no"]').onclick = () => bg.remove();
      bg.querySelector('[data-a="ok"]').onclick = () => { const r = merge(main, L.filter((s) => s.id !== main).map((s) => ({ id: s.id, name: names[s.id] }))); if (r.error) { toast(r.error); return; } bg.remove(); if (window.SL9 && SL9.state.sel) SL9.select(false); }; };
    document.body.appendChild(bg); draw(); bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  }

  window.SL10c = Object.assign(window.SL10c || {}, { merge, unmerge, canUnmerge, mergeBox, variantOf, suggest, OWN, fieldsFor, openClip: (s, t) => window.SLClick && SLClick.open(s, t), fromCues: (list) => window.SLSecs && SLSecs.fromCues(list) });
})();
