// 13 D, E, F: runs inside the page (Chrome and WebKit at 1280x800).
// D §13 no right panel; the Song and Track menus; Song info (⌥⌘I); a section's settings in the details card; breaks'
//   popover. §15 Songs · Setlists tabs in Cards and Folders (no Presets). E §16 natural voices only; §17 the Cues menu
//   (modes, announcements, count-in, output); §18 the prompt goes once a song has sections. F §19 the save state;
//   §21 Key Commands (remap, clash, reset, presets, the menus show the key).
async function check13c() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const S = (id) => songs.find((x) => x.id === id), R = (el) => el.getBoundingClientRect();
  const MAC = /Mac/.test(navigator.platform), cmdO = MAC ? { metaKey: true } : { ctrlKey: true };
  const key = (k, o = {}, t = document.body) => t.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: o.code, bubbles: true, cancelable: true, ...o }));
  const menu = (name) => SLMenus.spec().menus.find((m) => m.name === name), labels = (name) => (menu(name) ? menu(name).items : []).map((x) => x.header ? "[" + x.header + "]" : x.sep ? "-" : x.label);
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);

  // ================================================================ D §13
  { const ins = document.querySelector(".insp"); ok(!ins || getComputedStyle(ins).display === "none", "no right-side panel");
    ok(!document.getElementById("tglR") || getComputedStyle(document.getElementById("tglR")).display === "none", "…and no toggle for it");
    ok(!SLMenus.flat().some((x) => x.label === "Side panel"), "View › Side panel is gone");
    const g = S("glass"); openSong(g.id); await wait(300);
    const sm = labels("Song"); for (const l of ["Song info…", "Rename…", "Colour", "Key", "Versions", "New version", "Add section", "Add time signature…", "Add tempo change…", "Make sections from cues…", "Song fields", "Notes for the band…", "Add to setlist", "Delete song…"]) ok(sm.includes(l), "Song menu has " + l);
    ok(!sm.some((l) => /After this song/.test(l)), "Song menu: no After this song");
    const tsel = document.querySelector(`.row.trk > .lh[data-song="glass"][data-track="Bass"] .tn`); tsel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); tsel.click(); await frames(2);
    const tm = labels("Track"); for (const l of ["Rename…", "Colour", "Output", "Height", "Mute", "Solo", "Device", "Port & channel", "Edit patch changes…", "Clip gain…", "Fades", "Split", "Add audio track", "Add click track", "Add MIDI track", "Duplicate track", "Delete track"]) ok(tm.includes(l), "Track menu has " + l);
    ok(SLMenus.flat().some((x) => x.path[0] === "Track" && x.label === "Output" ) || menu("Track").items.find((x) => x.label === "Output").sub.length > 2, "Track › Output lists the outputs");
    // Song info
    key("i", { code: "KeyI", altKey: true, ...cmdO }); await wait(200); ok(SL13D.songInfoOpen(), "⌥⌘I opens Song info");
    const si = document.querySelector(".si13"); ok(si && [...si.querySelectorAll(".si13tabs button")].map((b) => b.textContent).join() === "General,Versions,Fields,Notes", "Song info tabs: General, Versions, Fields, Notes");
    const nm = si.querySelector("#si13name"); nm.value = "Glasshouse II"; nm.dispatchEvent(new Event("change")); await frames(2); ok(S("glass").name === "Glasshouse II", "Song info › name renames"); undo(); await frames(2);
    SL13D.songInfo("glass", "notes"); await wait(100); const t = document.querySelector("#si13note"); t.value = "Capo 2"; t.dispatchEvent(new Event("change")); await frames(1); ok(S("glass").bandNote === "Capo 2", "Notes for the band are kept with the song"); undo(); SL13D.closeSongInfo();
    // a section's settings: the details card
    const sec = document.querySelector('.secs .lane[data-song="glass"] .sec'); sec.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: R(sec).left + 10, clientY: R(sec).top + 5 })); await frames(2);
    const it = [...document.querySelectorAll(".xm.ctx .it")].find((x) => /Section settings/.test(x.textContent)); ok(!!it, "a section's menu has Section settings…"); if (it) { it.click(); await wait(150); }
    ok(SL13D.details() && /Section/i.test(SL13D.details().textContent) && SL13D.details().querySelector("#sName"), "Section settings open in the details card (name, type, ending, notes…)"); SL13D.closeDetails(); document.querySelectorAll(".xm.ctx").forEach((x) => x.remove());
    closeSong(); await wait(150); }

  // ================================================================ D §15 the tabs
  { ok(![...document.querySelectorAll("#cardTabs button")].some((b) => /Presets/.test(b.textContent)), "no Presets tab");
    SL9.setMode("folders"); await wait(200); const tabs = document.getElementById("cardTabs"); ok(tabs && getComputedStyle(tabs).display !== "none", "Folders has the Songs · Setlists tabs");
    tabs.querySelector('[data-t="sets"]').click(); await wait(200); const rows = document.querySelectorAll(".set13"); ok(rows.length === setlists.length, `Folders › Setlists: one row per setlist (${rows.length})`);
    if (rows[0]) { rows[0].querySelector(".set13h").click(); await wait(100); ok(document.querySelectorAll(".set13 .set13s").length >= 1, "…opening to its songs"); }
    SL9.setMode("cards"); await wait(200); ok(document.querySelector('#cardTabs [data-t="sets"]').classList.contains("on"), "the chosen tab stays when switching views");
    document.querySelector('#cardTabs [data-t="songs"]').click(); await wait(150); }

  // ================================================================ E
  { ok(!voiceList().some((v) => v.engine !== "kokoro"), "§16 no computer voices in the lists");
    const cm = labels("Cues"); ok(menu("Cues") && SLMenus.spec().menus.map((m) => m.name).join().includes("Setlist,Cues,Customize"), "§17 a Cues menu between Setlist and Customize");
    for (const l of ["Voice", "Announce", "Count-in", "Output", "Level…", "Cue words…", "Record missing words…"]) ok(cm.includes(l), "Cues menu has " + l);
    const s = S("neon"), cs = s.cues = [{ id: "e1", bar: 3, beat: 1, text: "Verse" }, { id: "e2", bar: 5, beat: 1, text: "1" }];
    const mode0 = CUEV.mode, ann0 = CUEV.announce;
    CUEV.mode = "rec"; ok(SL13E.cuesFor(s, cs).length === 0, "Voice › Your recordings: words without a recording stay silent");
    CUEV.mode = "both"; CUEV.announce = { sections: true, countins: false }; const out = SL13E.cuesFor(s, cs);
    ok(!out.some((c) => c.text === "1") && out.some((c) => c.gen13), "Announce › section names adds them; count-ins off drops the counts");
    CUEV.mode = mode0; CUEV.announce = ann0; s.cues = [];
    // §18
    const g = S("glass"); g.cues = [{ id: "z1", bar: 9, beat: 1, text: "Verse" }]; openSong(g.id); await wait(300); SLix.syncBar && SLix.syncBar();
    ok(!document.querySelector(`.row.secs > .lh .lhcues10[data-song="glass"]`) && !document.querySelector('.sug11[data-song="glass"]'), "§18 a song with sections: no sections-from-cues prompt");
    ok(SLMenus.flat().some((x) => x.label === "Make sections from cues…"), "…Song › Make sections from cues… is still there");
    g.cues = []; closeSong(); await wait(150); }

  // ================================================================ F
  { const fm = labels("File"); ok(fm.includes("Save Library") && fm.includes("Save Library As…") && /^\[(Saved|● Unsaved changes)\]$/.test(fm[0]), "§19 File: the save state, Save Library, Save Library As… (" + fm.slice(0, 3).join(" | ") + ")");
    ok((menu("File").items.find((x) => x.label === "Save Library") || {}).key === "cmd+s", "Save Library is ⌘S");
    // §21
    SLKeys.reset(); SLKeys.open(); await wait(150); const kc = document.querySelector(".kc13"); ok(!!kc, "Key Commands opens (Edit › Key Commands…)");
    ok(SLMenus.flat().some((x) => x.label === "Key Commands…" && x.key === "cmd+alt+k"), "Edit › Key Commands… is ⌥⌘K");
    const row = kc.querySelector('.kc13r[data-id="newVersion"]'); ok(!!row, "commands listed with Mac and Windows keys");
    if (row) { row.click(); await frames(1); kc.closest(".kc13bg").dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true, cancelable: true, ...cmdO, altKey: true })); await frames(2);
      ok(SLKeys.map().newVersion === "cmd+alt+j", "remapping: select, press a key, saved (" + JSON.stringify(SLKeys.map()) + ")");
      ok(SLMenus.flat().some((x) => x.label === "New version" && x.key === "cmd+alt+j"), "…the menu shows the new key"); }
    const r2 = [...document.querySelectorAll(".kc13r[data-id]")].find((r) => /Add section/.test(r.textContent)); if (r2) { r2.click(); await frames(1); document.querySelector(".kc13bg").dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", bubbles: true, cancelable: true, ...cmdO, altKey: true })); await frames(2);
      ok(/is “New version” now/.test(document.querySelector(".kc13f").textContent), "a clash shows a warning: " + document.querySelector(".kc13f").textContent); }
    SLKeys.preset("logic"); ok(SLMenus.flat().some((x) => x.id === "split" && x.key === "cmd+t"), "Logic-style preset: Split is ⌘T");
    SLKeys.reset(); ok(SLMenus.flat().some((x) => x.id === "split" && x.key === "cmd+e"), "Reset all: back to set.Line's keys"); SLKeys.close(); }
  return { problems: P, log };
}
