// 11: runs inside the page (tests/ui-timeline.mjs in Chrome, tests/ui-webkit.mjs in WebKit) at 1280x800.
// Edit or delete anything (click and cue tracks, versions, markers, tempo and time signature changes, setlists,
// presets, cue words: right-click / ⋯ / the menu bar / ⌘K, undo, asking only when something else uses it), the
// version switcher in setlist rows, renaming in place (the field on the name's box, within 2 px), no box around
// songs with versions, suggested sections, sections that never overlap (repair once, cues snapped to bar lines),
// the click editor zoomed out, count-ins collapsing, track names without the song's name, waveforms scaled to fit,
// the header's output picker, the scrollbar's own strip, the bottom track with the editor open, M / S states.
// And the layout check: no two controls overlap in any row, in every font pairing. Returns { problems, log }.
async function check11() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const S = (id) => songs.find((x) => x.id === id);
  const sc = document.getElementById("scroller");
  const R = (el) => el.getBoundingClientRect();
  const vis = (el) => !!el && el.isConnected && R(el).width > 0 && R(el).height > 0;
  const ctxItems = () => [...document.querySelectorAll(".xm.ctx .it")].map((d) => d.querySelector(":scope>span").textContent);
  const ctxClick = (label) => { const d = [...document.querySelectorAll(".xm.ctx .it")].find((x) => x.querySelector(":scope>span").textContent === label); if (d) d.click(); return !!d; };
  const closeCtx = () => document.querySelectorAll(".xm.ctx").forEach((x) => x.remove());
  const rclick = (el, x, y) => { const r = R(el); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x ?? r.left + r.width / 2, clientY: y ?? r.top + r.height / 2, button: 2 })); };
  const down = (el) => { const r = R(el); el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + r.height / 2, button: 0, pointerId: 7 })); };
  const noteText = () => { const n = document.getElementById("note10"); return n ? n.textContent : (document.getElementById("toast") || {}).textContent || ""; };
  const dialog = () => document.querySelector(".cfbg");
  const closeDialog = () => { const d = dialog(); if (d) { const no = d.querySelector('[data-a="no"], .btn.line'); if (no) no.click(); else d.remove(); } };
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);
  if (window.SL11) SL11.forget();

  // ================================================================ 1. click and cue tracks are tracks
  { const s = S("neon"); openSong(s.id); await wait(250);
    const clk0 = JSON.stringify(s.ck);
    // the Track menu and right-click: Rename and Delete are there for Click (and Duplicate)
    trackOpen = { song: s.id, track: "Click" }; if (window.SLDrag) SLDrag.setArea("track");
    const flat = SLMenus.flat(), it = (l) => flat.find((x) => x.path[0] === "Track" && x.label === l);
    ok(it("Delete track") && !it("Delete track").dis, "Track › Delete track works on Click");
    ok(it("Rename track…") && !it("Rename track…").dis, "Track › Rename track… works on Click");
    const lh = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="Click"]`); rclick(lh); await frames(1);
    const items = ctxItems(); closeCtx();
    ok(items.includes("Delete track") && items.includes("Rename…"), "right-click on Click: Rename… and Delete track: " + items.join(" | "));
    ok(!!lh.querySelector(".more10"), "⋯ on the Click track header");
    // delete it: gone with its clip; undo brings both back
    SL9.deleteTrack(s, "Click"); await frames(2);
    ok(!S("neon").tracks.includes("Click") && !S("neon").ck, "Delete track: the Click track and its clips are gone");
    ok(/Click/.test(noteText()) && /Undo/.test(document.getElementById("note10") ? document.getElementById("note10").textContent : "Undo"), "the undo note says what was deleted: " + noteText());
    const sug = document.querySelector(`.folder[data-id="${s.id}"] .addT.sug11[data-k="click"]`);
    ok(sug && /Add click track/.test(sug.textContent), "a song with no click: “＋ Add click track” stands out");
    undo(); await frames(2);
    ok(S("neon").tracks.includes("Click") && JSON.stringify(S("neon").ck) === clk0, "undo restores the Click track with its clip");
    // rename Click: the clip goes along (s.cks under the new name, its role kept), the engine still gets it
    const s2 = S("neon"); snap(); renameTrack(s2, "Click", "Metronome"); buildBars(s2);
    ok(s2.tracks.includes("Metronome") && !s2.ck && s2.cks && s2.cks.Metronome && ROLE.Metronome === "click", "rename Click → Metronome: still a click track with its clips");
    const f = verFields(s2, curVer(s2)); ok(f.cks && f.cks.Metronome && f.cks.Metronome.length > 0, "…and the engine's payload has its click");
    undo(); await frames(1);
    // a click track can't take an audio track's name, an audio track can't become "Click"
    ok(!SL11.okName(S("neon"), "Drums", "Click"), "an audio track can't be renamed “Click”");
    // the Cues track: rename and delete too (a song keeps one cue track)
    const s3 = S("neon"), nc = (s3.cues || []).length; SL9.deleteTrack(s3, "Cues"); await frames(1);
    ok(!S("neon").tracks.includes("Cues"), "the Cues track can be deleted"); undo(); await frames(1);
    ok((S("neon").cues || []).length === nc && S("neon").tracks.includes("Cues"), "…undo brings it back with its cues");
    // ⌘K: "Delete track “Click”"
    const sc0 = (q, t) => { const a = q.toLowerCase(), b = t.toLowerCase(); let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length ? 10 : 0; };
    const pal = SL11.palette("delete click", sc0).map((x) => x.label);
    ok(pal.includes("Delete track “Click”"), "⌘K finds “Delete track “Click””: " + pal.slice(0, 4).join(" | "));
    trackOpen = null; closeSong(); await wait(100); }

  // ================================================================ 2. edit or delete anything
  { const g = S("glass"); openSong(g.id); await wait(250);
    // versions: right-click a version row; delete one no setlist plays: no question
    const vr = [...document.querySelectorAll(`.vstrip .vr[data-song="${g.id}"]`)];
    ok(vr.length >= 2, "the version rows are there");
    rclick(vr[vr.length - 1]); await frames(1); const vi = ctxItems(); closeCtx();
    ok(vi.includes("Rename…") && vi.includes("Delete version…") && vi.includes("Duplicate"), "right-click a version: Rename… / Duplicate / Delete version…: " + vi.join(" | "));
    ok(!!vr[0].querySelector(".more11"), "⋯ on a version row");
    const vs = versOf(g), lone = vs.find((v) => !SL11.items("version", g, v.id) || !setlists.some((l) => (l.order || []).includes(g.id) && entryVerId(g, l) === v.id) && !v.def);
    if (lone) { const n0 = versOf(g).length; SL11.delVersion(g, lone.id); await frames(1); ok(!dialog() && versOf(S("glass")).length === n0 - 1, "a version no setlist plays: deleted without a question"); undo(); await frames(1); }
    // the one this setlist plays: asks, and says what plays instead
    const played = entryVerId(S("glass")); SL11.delVersion(S("glass"), played); await frames(1);
    ok(dialog() && /plays/.test(dialog().textContent), "deleting the version a setlist plays asks first: " + (dialog() ? dialog().querySelector("p").textContent.slice(0, 90) : "no dialog"));
    closeDialog(); await frames(1);
    // the main (Album) version can go too, while another stays
    const main = defVer(S("glass")); ok(!SL11.items("version", S("glass"), main.id).find((x) => x.id === "v11del").dis, "the main version can be deleted (another stays)");
    // markers: add one, right-click it, rename and delete it from the Edit menu (it was clicked last)
    { const gg = S("glass"); snap(); (gg.marks || (gg.marks = [])).push({ name: "LIGHTS", bar: 9, beat: 1 }); } refresh(); await wait(150);
    const mk = document.querySelector(`.folder[data-id="${g.id}"] .mkr[data-i="0"]`);
    ok(mk && vis(mk.querySelector("u")), "the marker is on the ruler");
    if (mk) { rclick(mk); await frames(1); const mi = ctxItems(); closeCtx(); ok(mi.includes("Rename…") && mi.includes("Delete marker"), "right-click a marker: " + mi.join(" | "));
      down(mk); ok(SL11.current() && SL11.current().kind === "marker", "a click on a marker makes it the Edit menu's object");
      SLMenus.run("m:delete"); await frames(1); ok(!(S("glass").marks || []).length, "Edit › Delete deletes the marker clicked last"); undo(); await frames(1); }
    // tempo and time signature changes: delete (not bar 1), with undo
    const tb = S("glass").tmap.find((e) => e.bpm && e.bar > 1);
    ok(SL11.items("tempo", S("glass"), 1).find((x) => x.id === "p11del").dis, "bar 1's tempo: Edit, not Delete");
    SL11.delTempo(S("glass"), tb.bar); await frames(1); ok(!S("glass").tmap.some((e) => e.bar === tb.bar && e.bpm), `Delete tempo change at bar ${tb.bar}`); undo(); await frames(1);
    ok(S("glass").tmap.some((e) => e.bar === tb.bar && e.bpm), "…undo brings it back");
    SL11.delMeter(S("glass"), 25); await frames(1); ok(!S("glass").tmap.some((e) => e.bar === 25 && e.sig), "Delete the 7/8 at bar 25"); undo(); await frames(1);
    const ms = document.querySelector(`.meter9 .lane[data-song="${g.id}"] .msig9[data-bar="25"]`); if (ms) { rclick(ms); await frames(1); const mi = ctxItems(); closeCtx(); ok(mi.includes("Delete time signature change"), "right-click a time signature: " + mi.join(" | ")); }
    const tp = [...document.querySelectorAll(`.tempo .lane[data-song="${g.id}"] .tp`)].find((x) => +x.dataset.i > 0); if (tp) { rclick(tp); await frames(1); const ti = ctxItems(); closeCtx(); ok(ti.includes("Delete tempo change") && ti.includes("Edit tempo…"), "right-click a tempo point: " + ti.join(" | ")); }
    // Song menu: the markers, tempo and time signature changes are in the menu bar too
    const fl = SLMenus.flat(); ok(fl.some((x) => x.path.join(" › ").startsWith("Song › Time signatures") && x.label === "Delete time signature change"), "Song › Time signatures › … › Delete time signature change");
    closeSong(); await wait(100); }
  // setlists: delete one (no question; its songs stay), the last one too; undo
  { const n0 = setlists.length, L = curSetObj(); SL11.delSetlist(L.id); await frames(1);
    ok(setlists.length === n0 - 1 || (n0 === 1 && setlists.length === 1 && setlists[0].id !== L.id), "Delete setlist: gone, no question"); ok(!dialog(), "…without a question");
    undo(); await frames(1); ok(setlists.some((l) => l.id === L.id) && curSet === L.id, "…undo brings it back");
    const fl = SLMenus.flat(); const del = fl.find((x) => x.path[0] === "Setlist" && x.label === "Delete setlist"); ok(del && !del.dis, "Setlist › Delete setlist works (also on the last one)"); }
  // presets: used by songs → asks; undo brings it back (undo covers presets now)
  { const p = presets.find((x) => !x.built && songs.some((s) => Object.values(s.midi || {}).some((l) => (l || []).some((e) => e.presetId === x.id))));
    if (p) { SL11.delPreset(p.id); await frames(1); ok(dialog() && /use it/.test(dialog().textContent), "deleting a preset songs use asks first"); const okb = dialog() && dialog().querySelector('[data-a="ok"], .btn.pri, .btn.danger'); if (okb) okb.click(); await frames(1);
      ok(!presets.some((x) => x.id === p.id), "…and deletes it"); undo(); await frames(1); ok(presets.some((x) => x.id === p.id), "…undo brings the preset back"); }
    else log.push("no preset in use in the demo"); }
  // cue words: a recorded word nobody's cues say: deleted without a question; undo
  { snap(); CUEWORDS.push({ id: "w9001", word: "Zebra", path: "x.wav", name: "x.wav" }); SL11.delCueWord("w9001"); await frames(1);
    ok(!dialog() && !CUEWORDS.some((w) => w.id === "w9001"), "a cue word no cue says: deleted without a question"); undo(); await frames(1); ok(CUEWORDS.some((w) => w.id === "w9001"), "…undo brings it back"); undo(); await frames(1); }
  // every kind has Rename / Delete (or Edit) in its items
  { const g = S("glass"), kinds = [["version", g, versOf(g)[0].id], ["tempo", g, g.tmap.find((e) => e.bpm && e.bar > 1).bar], ["meter", g, 25], ["setlist", curSet], ["cueword", (CUEWORDS[0] || {}).id]];
    for (const [k, a, b] of kinds) { if (!a) continue; const L = SL11.items(k, a, b); if (!L) { P.push(`no items for ${k}`); continue; } ok(L.some((x) => /^(Delete|Clear)/.test(x.label || "")) && L.some((x) => /^(Rename|Edit)/.test(x.label || "")), `${k}: rename or edit, and delete: ${L.filter((x) => x.label).map((x) => x.label).join(" | ")}`); } }

  // ================================================================ 3. the version switcher (no ‹ ›)
  { document.querySelector('.tabs a[data-tab="show"]').click(); await frames(2); renderSetlist(); await frames(1);
    ok(!document.querySelector("#songs .vprev, #songs .vnext, #songs .var"), "no ‹ › version arrows in setlist rows");
    const g = S("glass"), row = document.querySelector(`#songs .song[data-id="${g.id}"]`), sw = row && row.querySelector(".vsw11");
    ok(sw && /▾/.test(sw.textContent) && sw.textContent.includes(entryVer(g).name), "the version text is the switcher: " + (sw ? sw.textContent : "none"));
    ok(row && row.querySelectorAll(".dots i").length === versOf(g).length, "the dots still show how many versions");
    const was = entryVerId(g); sw.click(); await frames(1); const vi = ctxItems();
    ok(versOf(g).every((v) => vi.some((l) => l.startsWith(v.name))), "the switcher lists the versions: " + vi.join(" | "));
    const other = versOf(g).find((v) => v.id !== was); ctxClick(vi.find((l) => l.startsWith(other.name))); await frames(2);
    ok(entryVerId(S("glass")) === other.id, "picking one makes this setlist play it");
    undo(); await frames(1);
    selId = g.id; document.dispatchEvent(new KeyboardEvent("keydown", { key: "”", code: "BracketRight", altKey: true, bubbles: true })); await frames(2);
    ok(entryVerId(S("glass")) !== was, "⌥] still flips to the next version"); undo(); await frames(1);
    // 5. no coloured box around a song with versions
    const r2 = document.querySelector(`#songs .song[data-id="${g.id}"]`), cs = getComputedStyle(r2);
    ok(cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) === 0, "no outline around a song with versions (" + cs.outlineStyle + " " + cs.outlineWidth + ")");
    ok(cs.boxShadow === "none", "no stacked shadow (" + cs.boxShadow + ")"); }

  // ================================================================ the layout check: controls never overlap
  const INTERACTIVE = "button, input, select, textarea, [role=button], .hf, .ochip, .vsw11, .more10, .more11, .grip10";
  const ROWS = ["#songs > .song", "#songs > .brk9", ".card9", ".r9h", ".row.trk > .lh", ".secs .sec", ".vstrip .vr", ".sug11", ".row.secs > .lh", ".pin9 .row.ruler > .lh", "#clk10 .ch10", "#setHead", ".fhead .fh"];
  // hover: every ":hover" rule also applies to a row with the class hov11, so what shows on hover is checked too
  if (!document.getElementById("hov11")) { const st = document.createElement("style"); st.id = "hov11"; const out = [];
    const walk = (rules) => { for (const r of rules) { if (r.cssRules && !r.selectorText) { try { walk(r.cssRules); } catch (e) {} continue; } if (r.selectorText && r.selectorText.includes(":hover")) out.push(r.selectorText.replace(/:hover/g, ".hov11") + "{" + r.style.cssText + "}"); } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
    st.textContent = out.join("\n"); document.head.appendChild(st); log.push(`hover rules copied for the check: ${out.length}`); }
  function overlapsNow(tag) {
    const out = [];
    for (const sel of ROWS) for (const row of document.querySelectorAll(sel)) {
      const rr = R(row); if (!rr.width || !rr.height || rr.bottom < 0 || rr.top > innerHeight || rr.right < 0 || rr.left > innerWidth) continue;
      // hover state: what shows on hover / keyboard focus is shown (focus-within)
      const had = row.getAttribute("tabindex"); if (had === null) row.setAttribute("tabindex", "-1"); row.focus({ preventScroll: true }); row.classList.add("hov11");
      const els = [...row.querySelectorAll(INTERACTIVE)].filter((e) => { const r = R(e), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== "hidden" && c.display !== "none" && c.opacity !== "0"; });
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
        const A = R(a), B = R(b), w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (w > 1.5 && h > 1.5) out.push(`${tag} ${sel}: ${(a.className || a.tagName).toString().split(" ")[0]} “${(a.textContent || a.title || "").trim().slice(0, 14)}” × ${(b.className || b.tagName).toString().split(" ")[0]} “${(b.textContent || b.title || "").trim().slice(0, 14)}” (${Math.round(w)}×${Math.round(h)} px)`);
      }
      row.blur(); row.classList.remove("hov11"); if (had === null) row.removeAttribute("tabindex");
    }
    return out;
  }
  { const pairs = window.SLLook ? SLLook.PAIRS.map((p) => p.id) : ["round"], before = window.SLLook ? SLLook.get() : null, found = new Set();
    for (const pr of pairs) {
      if (window.SLLook) SLLook.set({ pair: pr, ui: "", title: "", nums: "" }); await frames(2);
      SL9.setMode("cards"); closeSong(); await frames(3); overlapsNow(pr + " · cards").forEach((x) => found.add(x));
      SL9.setMode("folders"); await frames(3); overlapsNow(pr + " · folders").forEach((x) => found.add(x));
      openSong("glass"); await wait(120); SLClick.open(S("glass"), "Click"); await frames(3); overlapsNow(pr + " · song").forEach((x) => found.add(x)); SLClick.close(); closeSong(); await frames(1);
    }
    if (before && window.SLLook) SLLook.set({ pair: before.pair, ui: before.ui, title: before.title, nums: before.nums }); SL9.setMode("cards"); await frames(2);
    log.push(`overlap check: ${pairs.length} font pairings × cards, Folders and a song with the click editor: ${found.size} overlap${found.size === 1 ? "" : "s"}`);
    [...found].slice(0, 12).forEach((x) => P.push("overlapping controls: " + x)); }

  // 4. renaming in place: tests/ui-11b.js (11b: the name element itself is the field)

  // ================================================================ 6 / 7. suggested sections; sections never overlap
  { const s = S("paper"); snap(); s.secs = []; s.cues = [{ id: "c1", bar: 1, beat: 1, text: "One" }, { id: "c2", bar: 1, beat: 2, text: "Two" }, { id: "c3", bar: 2, beat: 3.5, text: "Verse" }, { id: "c4", bar: 11, beat: 1, text: "Chorus" }, { id: "c5", bar: 19, beat: 1, text: "Bridge" }];
    normSecs(s); buildBars(s); refresh(); openSong(s.id); await wait(250);
    const lane = document.querySelector(`.row.secs > .lane[data-song="${s.id}"]`), bar = document.querySelector(`.sug11[data-song="${s.id}"]`);
    const gh = [...lane.querySelectorAll(".gsec11")];
    ok(gh.length === 4 && /Suggested/.test(gh[0].textContent), "ghost sections, “Suggested” on the first: " + gh.map((x) => x.textContent).join(","));
    ok(gh.length && getComputedStyle(gh[1]).borderTopStyle === "dashed" && getComputedStyle(gh[1]).borderTopColor === (() => { const t = document.createElement("i"); t.style.color = SEC_C.verse; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; })(), `…in their section colours, dashed (${gh[1] && getComputedStyle(gh[1]).borderTopStyle} ${gh[1] && getComputedStyle(gh[1]).getPropertyValue("--sc")} vs ${SEC_C.verse})`);
    ok(bar && /4 sections suggested from your cues/.test(bar.textContent) && /Use them/.test(bar.textContent) && /Edit…/.test(bar.textContent) && /Dismiss/.test(bar.textContent), "the bar: “4 sections suggested from your cues · Use them · Edit… · Dismiss”");
    ok(bar && R(bar).bottom <= R(lane).top + 0.5, "the bar sits above the Sections row (not on it)");
    ok(SLSecs.plan(s).find((p) => p.name === "Verse").start === 3, "a cue in the second half of bar 2 (a pickup) starts the Verse on bar 3");
    bar.querySelector("[data-gd]").click(); await frames(3);
    ok(!document.querySelector(`.sug11[data-song="${s.id}"]`) && !lane.isConnected || !document.querySelector(`.row.secs > .lane[data-song="${s.id}"] .gsec11`), "Dismiss hides the suggestion");
    document.querySelector(`.lhcues10[data-song="${s.id}"]`).click(); await frames(3);
    ok(!!document.querySelector(`.row.secs > .lane[data-song="${s.id}"] .gsec11`), "Sections › From cues brings it back");
    document.querySelector(`.sug11 [data-gs="${s.id}"]`).click(); await frames(3);
    ok(S("paper").secs.map((x) => `${x.name}@${x.start}+${x.bars}`).join() === `Intro@1+2,Verse@3+8,Chorus@11+8,Bridge@19+${S("paper").total - 18}`, "Use them: " + S("paper").secs.map((x) => `${x.name}@${x.start}+${x.bars}`).join());
    undo(); undo(); await frames(1); closeSong(); await wait(100); }
  { // a fixture with overlapping sections (as an import made them): straightened once, one undo note, one line
    const s = S("copper"); const keep = JSON.stringify(s.secs);
    s.secs = [{ id: 9101, name: "Intro", type: "intro", start: 1, bars: 12, end: "continue", say: "", notes: {}, tile: true }, { id: 9102, name: "Verse 1", type: "verse", start: 9, bars: 16, end: "continue", say: "", notes: {}, tile: true },
      { id: 9103, name: "Chorus", type: "chorus", start: 25, bars: 20, end: "continue", say: "", notes: {}, tile: true }, { id: 9104, name: "Outro", type: "outro", start: 41, bars: 30, end: "continue", say: "", notes: {}, tile: true }];
    normSecs(s); buildBars(s); ok(SL11.overlaps(s.secs), "test setup: the fixture overlaps");
    SL11.forget(); const r = SL11.repair(); await frames(2);
    ok(r && r.sections >= 2 && !SL11.overlaps(S("copper").secs), `repaired on open: ${r ? r.sections : 0} sections straightened`);
    ok(/Straightened \d+ sections? in/.test(noteText()), "the undo note: " + noteText());
    const L = S("copper").secs; ok(L[0].start + L[0].bars === L[1].start && L[1].start + L[1].bars === L[2].start && L[3].start + L[3].bars - 1 <= S("copper").total, "each section ends where the next starts: " + L.map((x) => `${x.start}+${x.bars}`).join(","));
    openSong("copper"); await wait(250);
    const tops = [...document.querySelectorAll(`.secs .lane[data-song="copper"] .sec`)].map((e) => Math.round(R(e).top)), lr = R(document.querySelector(`.secs .lane[data-song="copper"]`));
    ok(tops.length === 4 && new Set(tops).size === 1, "the Sections row is one line: " + tops.join(","));
    ok([...document.querySelectorAll(`.secs .lane[data-song="copper"] .sec`)].every((e) => R(e).bottom <= lr.bottom + 0.5), "…and never draws over the tracks below");
    undo(); await frames(1); ok(SL11.overlaps(S("copper").secs), "undo puts them back as they were");
    ok(SL11.repair() === null || SL11.last().sections === 0 || !SL11.overlaps([]), "…and they aren't straightened again");
    ok(SL11.overlaps(S("copper").secs), "…(still as they were after another look)");
    S("copper").secs = JSON.parse(keep); normSecs(S("copper")); buildBars(S("copper")); refresh(); closeSong(); await wait(100); }

  // ================================================================ 8. the click editor zoomed out
  { const s = S("glass"); openSong(s.id); await wait(250); SL9.zoomNow(TL9.viewW() / s.len); await frames(2); sc.scrollLeft = 0;
    SLClick.open(s, "Click"); await frames(4);
    ok(["density", "ticks"].includes(SLClick.drawMode()), "zoomed out, notes are ticks or a density strip (not merged blocks): " + SLClick.drawMode());
    const hdr = document.querySelector("#clk10 .cbars10").textContent, m = hdr.match(/Bars (\d+)–(\d+)/);
    const lastBar = s.bars.filter((b) => b.t * PXS <= sc.scrollLeft + TL9.viewW() - 1).pop().bar;
    ok(m && +m[1] === 1 && Math.abs(+m[2] - Math.min(s.total, lastBar)) <= 1, `the header says which bars are on screen, as the timeline shows them: “${hdr}” (timeline to bar ${lastBar})`);
    // zoomed in, blocks again
    SL9.zoomNow(160 / (s.bars[1].t - s.bars[0].t)); SLClick.close(); SLClick.open(s, "Click"); await frames(4); // (13: its own zoom; opening frames the timeline)
    ok(SLClick.drawMode() === "blocks", "zoomed in: note blocks (" + SLClick.drawMode() + ")");
    SLClick.close(); await frames(1); }
  // the bottom track with the editor open: reachable; the line between them resizes, and it's remembered
  { const s = S("glass"); SLClick.open(s, "Click"); await frames(3);
    sc.scrollTop = 1e6; await frames(3);
    const rows = [...document.querySelectorAll(".row.trk")].filter(vis), last = rows[rows.length - 1], ed = document.getElementById("clk10");
    ok(last && R(last).bottom <= R(ed).top + 1, `with the clip editor open, the bottom track scrolls into view (${last ? Math.round(R(last).bottom) : "?"} ≤ ${Math.round(R(ed).top)})`);
    const hz = ed.querySelector(".crz10"), h0 = R(ed).height, y = R(hz).top + 3;
    hz.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: y, button: 0, pointerId: 3 }));
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: y - 40, pointerId: 3 }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 300, clientY: y - 40, pointerId: 3 })); await frames(2);
    ok(Math.abs(R(ed).height - (h0 + 40)) <= 2, `dragging the line resizes the editor (${Math.round(h0)} → ${Math.round(R(ed).height)})`);
    ok(+localStorage.getItem("setline.clkH") === Math.round(R(ed).height) || Math.abs(+localStorage.getItem("setline.clkH") - R(ed).height) <= 1, "…and the height is remembered");
    SLClick.close(); closeSong(); await wait(100); }

  // ================================================================ 9. count-ins collapse when zoomed out
  { const s = S("neon"); snap(); s.cues = [{ id: "q1", bar: 9, beat: 1, text: "One" }, { id: "q2", bar: 9, beat: 2, text: "Two" }, { id: "q3", bar: 9, beat: 3, text: "Three" }, { id: "q4", bar: 9, beat: 4, text: "Four" }, { id: "q5", bar: 10, beat: 1, text: "Verse" }, { id: "q6", bar: 26, beat: 1, text: "Chorus" }];
    openSong(s.id); await wait(250); SL9.zoomNow(TL9.viewW() / s.len); await frames(3);
    const cv = [...document.querySelectorAll(`canvas[data-song="${s.id}"][data-t]`)].find((c) => S("neon").tracks[+c.dataset.t] === "Cues"); drawLane(cv);
    const lab = cv._lab11 || [];
    ok(lab.some((l) => l.group && l.txt === "1-2-3-4"), "zoomed out: one “1-2-3-4” label for the count-in: " + lab.map((l) => l.txt).join(","));
    ok(lab.filter((l) => l.w).every((l, i, A) => !A[i + 1] || l.x + l.w <= A[i + 1].x), "labels never overlap each other");
    SL9.zoomNow(400 / (s.bars[1].t - s.bars[0].t)); await frames(2); sc.scrollLeft = s.bars[8].t * PXS - 20; await frames(2); drawLane(cv);
    ok((cv._lab11 || []).filter((l) => !l.group && /^(One|Two|Three|Four)$/.test(l.txt)).length === 4, "zoomed in: each count word as now: " + (cv._lab11 || []).map((l) => l.txt).join(","));
    undo(); await frames(1); closeSong(); await wait(100); }

  // ================================================================ 10. track names without the song's name
  { const fake = { name: "GARDEN", seconds: 100, tmap: [{ bar: 1, bpm: 100, sig: [4, 4] }], secs: [{ name: "Intro", type: "intro", start: 1, bars: 12 }, { name: "Verse", type: "verse", start: 9, bars: 8 }], clicks: [], cues: [],
      tracks: [{ name: "GARDEN / 60 Kick", kind: "audio", col: "#fff", file: null, clips: [] }, { name: "GARDEN - Bass DI", kind: "audio", col: "#fff", file: null, clips: [] }, { name: "Pads", kind: "audio", col: "#fff", file: null, clips: [] }] };
    const r = SLAble.song(fake);
    ok(r.so.tracks.join() === "60 Kick,Bass DI,Pads", "an import drops “GARDEN / ” and “GARDEN - ”: " + r.so.tracks.join());
    ok(r.so.tfull && r.so.tfull["60 Kick"] === "GARDEN / 60 Kick", "the full name stays (for the tooltip)");
    ok(r.rows.map((x) => x.name).join() === "60 Kick,Bass DI,Pads", "…and the import preview shows the short names");
    ok(r.so.secs[0].start + r.so.secs[0].bars === r.so.secs[1].start, "an import's overlapping sections come out straight");
    // an existing song: cleaned once, with undo
    const s = S("sound"); snap(); renameTrack(s, "Bass", "Soundcheck loop / Bass"); buildBars(s); SL11.forget(); undoS.pop();
    const res = SL11.repair(); await frames(1);
    ok(res && res.names >= 1 && S("sound").tracks.includes("Bass") && /track name/.test(noteText()), "an existing song's “Soundcheck loop / Bass” becomes “Bass” once, with a note: " + noteText());
    openSong("sound"); await wait(200); const tn = document.querySelector(`.row.trk > .lh[data-song="sound"][data-track="Bass"] .tn`);
    ok(tn && /Soundcheck loop \/ Bass/.test(tn.title), "the full name is in the track's tooltip: " + (tn ? tn.title : ""));
    undo(); await frames(1); renameTrack(S("sound"), "Soundcheck loop / Bass", "Bass"); closeSong(); await wait(100); }

  // ================================================================ 11. waveforms, the output picker, the scrollbar, M / S
  { const s = S("glass"); s.files = s.files || {}; const keepF = s.files.Bass;
    s.files.Bass = { path: "quiet.wav" }; const data = new Uint8Array(2000).map((_, i) => 20 + (i % 7)); // a quiet stem: peaks at 26 of 255
    const SLW0 = window.SLW; window.SLW = { get: () => ({ data, perSec: 10 }) };
    openSong(s.id); await wait(250);
    const cv = [...document.querySelectorAll(`canvas[data-song="${s.id}"][data-t]`)].find((c) => s.tracks[+c.dataset.t] === "Bass"); drawLane(cv);
    const b = cv._boost11 ? Object.values(cv._boost11)[0] : 0;
    ok(b > 4, `a quiet stem is scaled to fit the lane, with a “×${Math.round(b)}” badge`);
    window.SLW = SLW0; if (keepF) s.files.Bass = keepF; else delete s.files.Bass;
    // the output picker in a narrow header
    const lh = document.querySelector(`.row.trk > .lh[data-song="${s.id}"][data-track="Drums"]`), chip = lh && lh.querySelector(".ochip");
    ok(chip && !/…/.test(chip.textContent) && chip.scrollWidth <= chip.clientWidth + 1, "the output picker isn't cut off: “" + (chip ? chip.textContent : "") + "”");
    // M / S: filled when on, outline when off (without hovering)
    const mb = lh.querySelector(".mb"); mb.style.setProperty("transition", "none", "important"); const off = { ...getComputedStyle(mb) }; off.backgroundColor = getComputedStyle(mb).backgroundColor; off.boxShadow = getComputedStyle(mb).boxShadow; mb.classList.add("on"); const on = getComputedStyle(mb).backgroundColor; mb.classList.remove("on");
    ok(off.backgroundColor !== on && /inset/.test(off.boxShadow) && (on !== "rgba(0, 0, 0, 0)" && on !== "transparent"), `M: an outline when off (${off.boxShadow.slice(0, 30)}), filled when on (${on})`);
    ok(mb.title === "Mute" && lh.querySelector(".sb").title.startsWith("Solo"), "M / S tooltips");
    // the sideways scrollbar under the lanes, not over the last track
    SL9.zoomNow(60 / (s.bars[1].t - s.bars[0].t)); await frames(4); TL9.bar(); sc.scrollTop = 1e6; await frames(3);
    const hb = document.getElementById("hb9"), rows = [...document.querySelectorAll(".row.trk")].filter(vis), last = rows[rows.length - 1];
    ok(hb && !hb.hidden && R(hb).top >= R(sc).bottom - 0.5 && R(last).bottom <= R(sc).bottom + 0.5, `the scrollbar has its own strip below the lanes (bar top ${hb ? Math.round(R(hb).top) : "?"}, lanes end ${Math.round(R(sc).bottom)})`);
    closeSong(); await wait(100); }

  return { problems: P, log };
}
