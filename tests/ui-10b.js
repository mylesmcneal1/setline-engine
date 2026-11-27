// 10b: runs inside the page (Chrome: tests/ui-timeline.mjs, WebKit: tests/ui-webkit.mjs). The reorganised menus and
// their shortcuts (each shown key fires its item once; no key means two things), right-click = ⋯ = the menu bar,
// ⌘K (an action, a song, a setting), the ⌘/ sheet, grips and ⋯ on hover / focus, the selection bar per selection,
// undo notes (and none during a show), tooltips with keys, first run on an empty library, empty setlist.
async function check10b() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const MAC = /Mac/.test(navigator.platform);
  const S = (id) => songs.find((x) => x.id === id);
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);
  select("glass", false); await frames(1);

  // ================================================================ the menus
  const sp = SLMenus.spec(), names = sp.menus.map((m) => m.name);
  ok(names.join() === "File,Edit,View,Library,Song,Track,Setlist,Cues,Customize,Window,Help", "menus in order: " + names.join());
  const labels = (n) => SLMenus.flat({ menus: [sp.menus.find((m) => m.name === n)], app: [] }).map((x) => (x.path.length > 1 ? x.path.slice(1).join(" › ") + " › " : "") + x.label);
  const has = (n, l) => labels(n).includes(l);
  for (const [m, l] of [["File", "Ableton project…"], ["File", "Audio as a new song…"], ["File", "set.Line package (.setline)…"], ["File", "This song…"], ["File", "This setlist…"], ["File", "Print setlist…"], ["File", "Backups…"],
    ["Edit", "Duplicate"], ["Edit", "Rename…"], ["Edit", "Select songs"], ["Library", "New library…"], ["Library", "Merge as versions…"], ["Library", "Unmerge version"], ["Library", "Sort by › Name"],
    ["Song", "Song info…"], ["Song", "Rename…"], ["Song", "Notes for the band…"], ["Song", "Duplicate song"], ["Song", "Delete song…"], ["Song", "New version"], ["Song", "Make sections from cues…"], ["Song", "Add to setlist"], ["Song", "Sort tracks: MIDI to the bottom"],
    ["Track", "Add audio track"], ["Track", "Add click track"], ["Track", "Add MIDI track"], ["Track", "Rename…"], ["Track", "Edit patch changes…"], ["Track", "Clip gain…"], ["Track", "Track settings…"], ["Track", "Move up"], ["Track", "Edit click (MIDI clip)"],
    ["Setlist", "Add song…"], ["Setlist", "Add break"], ["Setlist", "Remove from setlist"], ["Setlist", "Rename setlist…"], ["Setlist", "Delete setlist"],
    ["View", "Cards"], ["View", "Folders"], ["View", "Fit all"], ["View", "Setlist sidebar"], ["View", "Zoom › Zoom in"], ["View", "Track height › Mini"],
    ["Help", "Quick start"], ["Help", "Keyboard shortcuts"], ["Help", "Report a problem…"]]) ok(has(m, l), `${m} › ${l}`);
  ok(!labels("Customize").some((l) => /Density/.test(l)), "Customize: no Density (View › Track height has the sizes)");
  ok(!labels("File").some((l) => /Open recent|Add break/.test(l)), "File: no Open recent, no Add break");
  ok(labels("File").filter((l) => /Print/.test(l)).length === 1 && !labels("Setlist").some((l) => /Print/.test(l)), "Print setlist… once (File)");
  // no key means two things (⌥↑ / ⌥↓ move what's selected, a setlist item or a track: the same action)
  const keys = {}; SLMenus.flat().filter((x) => x.key).forEach((x) => (keys[x.key] = keys[x.key] || []).push(x.path.join(" › ") + " › " + x.label));
  const clash = Object.entries(keys).filter(([k, v]) => v.length > 1 && !/^alt\+(up|down)$/.test(k));
  ok(!clash.length, "shortcut clashes: " + clash.map(([k, v]) => k + " = " + v.join(" | ")).join("; "));
  log.push(`${SLMenus.flat().length} menu items, ${Object.keys(keys).length} shortcuts`);
  // every ⌘ / Ctrl key a menu shows fires its item, once
  { SLMenus.dry(true);
    const CODE = { comma: "Comma", minus: "Minus", equals: "Equal", slash: "Slash", left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", backspace: "Backspace", return: "Enter" };
    const KEYCH = { comma: ",", minus: "-", equals: "=", slash: "/", left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };
    let n = 0;
    for (const x of SLMenus.flat()) {
      if (!x.key || !/cmd/.test(x.key)) continue;
      const parts = x.key.split("+"), k = parts.pop();
      const code = CODE[k] || (/^[a-z]$/.test(k) ? "Key" + k.toUpperCase() : /^\d$/.test(k) ? "Digit" + k : k);
      const ev = new KeyboardEvent("keydown", { key: KEYCH[k] || k, code, bubbles: true, cancelable: true, metaKey: MAC && parts.includes("cmd"), ctrlKey: (!MAC && parts.includes("cmd")) || parts.includes("ctrl"), altKey: parts.includes("alt"), shiftKey: parts.includes("shift") });
      SLMenus.clearFired(); document.body.dispatchEvent(ev); n++;
      const f = SLMenus.fired();
      if (x.dis) ok(!f.length, `${x.keyText} (${x.label}, greyed out) does nothing: ${f.join()}`);
      else ok(f.length === 1 && f[0] === x.id, `${x.keyText} runs ${x.path.join(" › ")} › ${x.label} once: ${f.join() || "nothing"}`);
    }
    SLMenus.dry(false); log.push(`${n} shortcuts pressed`); }

  // ================================================================ right-click = ⋯ = the menu bar
  const ctxLabels = () => [...document.querySelectorAll(".xm.ctx .it span")].map((x) => x.textContent);
  const closeCtx = () => document.querySelectorAll(".xm.ctx").forEach((x) => x.remove());
  { songMenu({ clientX: 300, clientY: 200 }, "low", "list"); await frames(1); const L = ctxLabels(); closeCtx();
    ok(["Open", "Rename…", "Colour ▸", "Duplicate", "Versions ▸", "Make sections from cues", "Delete song…"].every((l) => L.includes(l)) && L.some((l) => /^(Add to|Remove from)/.test(l)), "right-click a song: " + L.join(" · ")); }
  { const more = document.querySelector('.card9[data-id="low"] .more10'); ok(!!more, "a card has a ⋯ button");
    if (more) { more.click(); await frames(1); const L = ctxLabels(); closeCtx(); ok(L.includes("Rename…") && L.includes("Delete song…"), "⋯ on a card opens the song menu: " + L.join(" · ")); } }
  { const row = document.querySelector("#songs > .song"); ok(row && row.querySelector(".grip10") && row.querySelector(".more10"), "a setlist row has a grip and ⋯");
    row.focus(); await frames(1); ok(getComputedStyle(row.querySelector(".more10")).opacity === "1", "the setlist row's ⋯ shows on keyboard focus"); row.blur(); }
  { SLBreaks.add("Talk"); await frames(2); const b = document.querySelector("#songs > .brk9"); b.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 300 })); await frames(1);
    const L = ctxLabels(); closeCtx(); ok(["Edit break…", "Label ▸", "Move up", "Move down", "Duplicate", "Remove"].every((l) => L.includes(l)), "right-click a break: " + L.join(" · ")); }
  openSong("glass"); await wait(300);
  { const lh = document.querySelector('.row.trk > .lh[data-track="Drums"]'); ok(lh.querySelector(".grip10") && lh.querySelector(".more10"), "a track header has a grip and ⋯");
    lh.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 300 })); await frames(1);
    const L = ctxLabels(); closeCtx(); ok(["Rename…", "Colour ▸", "Duplicate", "Move up", "Move down", "Height ▸", "Delete track"].every((l) => L.includes(l)), "right-click a track: " + L.join(" · ")); }
  { const s = S("glass"), sec = document.querySelector(".secs .sec[data-sid]"); secMenu({ clientX: 300, clientY: 300 }, s, +sec.dataset.sid); await frames(1);
    const L = ctxLabels(); closeCtx(); ok(["Rename…", "Colour ▸", "Loop until released (vamp)", "Duplicate", "Delete"].every((l) => L.includes(l)), "right-click a section: " + L.join(" · ")); }

  // ================================================================ the selection bar
  const bar = () => { const b = document.getElementById("selbar10"); return b && !b.hidden ? [...b.querySelectorAll("button")].map((x) => x.textContent).join(" · ") : ""; };
  SLix.syncBar(); ok(/^Rename · Colour · Versions ▾ · .*Add track ▾$/.test(bar()), "a song selected: " + bar()); // 13 §18: "Sections from cues" only until a song has sections
  { openTrack(S("glass"), "Bass"); SLDrag.setArea("track"); SLix.syncBar(); ok(bar() === "Rename · Colour · Height ▾ · Delete", "a track selected: " + bar()); closeTrack(); SLDrag.setArea("set"); }
  closeSong(); await wait(150);
  { SL9.select(true); songSel.clear(); songSel.add("low"); songSel.add("sat"); SLix.syncBar(); ok(!bar() && !!document.getElementById("selBar9"), "several songs: the bulk bar instead"); SL9.select(false); await frames(1); }

  // ================================================================ ⌘K
  const pal = async (q) => { SLix.palette(); await frames(1); const i = document.querySelector("#pal10 input"); i.value = q; i.dispatchEvent(new Event("input")); await frames(1); return [...document.querySelectorAll("#pal10 .pi10")].map((x) => x.closest(".pres10").querySelector(".pg10") && x.textContent); };
  const groupOf = (txt) => { const r = [...document.querySelectorAll("#pal10 .pi10")].find((x) => x.textContent.includes(txt)); if (!r) return ""; let g = r.previousElementSibling; while (g && !g.classList.contains("pg10")) g = g.previousElementSibling; return g ? g.textContent : ""; };
  const closePal = () => { const p = document.getElementById("pal10"); if (p) p.remove(); };
  { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: MAC, ctrlKey: !MAC, bubbles: true, cancelable: true })); await frames(1);
    ok(!!document.getElementById("pal10"), (MAC ? "⌘" : "Ctrl+") + "K opens the palette"); closePal(); }
  { await pal("sections from"); const first = document.querySelector("#pal10 .pi10"); ok(first && /Make sections from cues/.test(first.textContent) && groupOf("Make sections") === "Actions", "⌘K finds an action: " + (first && first.textContent)); closePal(); }
  { await pal("msc"); ok(groupOf("Make sections from cues") === "Actions", "fuzzy: “msc” finds Make sections from cues"); ok(!groupOf("Text size"), "fuzzy doesn't match across unrelated words"); closePal(); }
  { await pal("low ti"); ok(groupOf("Low Tide") === "Songs", "⌘K finds a song"); const i = document.querySelector("#pal10 input"); const row = [...document.querySelectorAll("#pal10 .pi10")].findIndex((x) => x.textContent.includes("Low Tide"));
    for (let k = 0; k < row; k++) i.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await wait(120);
    ok(focusSong() && focusSong().id === "low", "↩ on a song opens it"); closeSong(); await frames(1); }
  { await pal("outputs"); ok(groupOf("Outputs") === "Settings", "⌘K finds a setting"); closePal(); }
  { await pal(""); ok([...document.querySelectorAll("#pal10 .pg10")].map((x) => x.textContent).includes("Recent songs"), "with nothing typed: recent songs and actions"); closePal(); }

  // ================================================================ ⌘/
  { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", code: "Slash", metaKey: MAC, ctrlKey: !MAC, bubbles: true, cancelable: true })); await frames(1);
    // 13 §21: ⌘/ opens the Key Commands window (it replaces the read-only sheet)
    const sh = document.querySelector(".kc13"); const G = sh ? [...sh.querySelectorAll(".kc13g")].map((x) => x.textContent) : [];
    ok(sh && ["Playback", "Editing", "View", "Setlist"].every((g) => G.includes(g)), "⌘/ opens Key Commands: " + G.join(", "));
    ok(sh && /Fit all/.test(sh.textContent) && /Play \/ Stop/.test(sh.textContent), "it lists menu keys and page keys");
    if (sh) { const i = sh.querySelector(".kc13q"); i.value = "fit"; i.dispatchEvent(new Event("input")); ok(sh.querySelectorAll(".kc13r").length >= 2 && [...sh.querySelectorAll(".kc13r")].every((r) => /fit/i.test(r.textContent)), "it is searchable"); SLKeys.close(); } }

  // ================================================================ the undo note
  { const s = S("sat"), c0 = s.col; snap(); s.col = "#123456"; refresh(); await wait(30);
    const n = document.getElementById("note10"); ok(n && n.classList.contains("show") && /Satellites/.test(n.textContent) && /Undo/.test(n.textContent), "a change without its own note gets one: " + (n && n.textContent));
    n.querySelector("button").click(); await frames(1); ok(S("sat").col === c0, "Undo in the note undoes it"); }
  { toast("Moved “Drums” to the top", undo); const n = document.getElementById("note10"); ok(/Moved “Drums” to the top/.test(n.textContent) && n.querySelector("kbd"), "a note: the message, Undo and its key"); }
  { perfOn = true; playing = true; const n = document.getElementById("note10"); n.classList.remove("show"); toast("Should not show", undo); ok(!n.classList.contains("show") || !/Should not/.test(n.textContent), "no note in Perform while playing"); perfOn = false; playing = false; }

  // ================================================================ tooltips with keys
  { const b = document.getElementById("playBtn"); b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); await wait(600);
    const t = document.getElementById("tip10"); ok(t && t.style.display === "block" && /Play/.test(t.textContent) && t.querySelector("kbd") && /Space/.test(t.querySelector("kbd").textContent), "a tooltip with its key after ~500 ms: " + (t && t.textContent));
    document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); }

  // ================================================================ first run: an empty library
  { const keepB = (curSetObj().breaks || []).splice(0); const keep = songs.splice(0, songs.length), keepSet = setOrder.splice(0, setOrder.length); localStorage.removeItem("setline.qsHidden"); refresh(); SLix.emptyStates(true); await frames(2);
    const q = document.getElementById("qs10"); ok(q && q.querySelectorAll(".qsr10").length === 5, "an empty library shows the 5-step checklist");
    ok(q && /Drop an Ableton project/.test(q.textContent), "…and the drop zone line");
    ok(q && !q.querySelector('[data-q="songs"]').classList.contains("done"), "“Bring in your songs” isn't ticked");
    const es = document.querySelector("#songs .es10"); ok(es && /Drag songs here|Songs you add/.test(es.textContent), "the empty setlist says what goes there");
    q.querySelector(".qshide10").click(); await frames(1); ok(!document.getElementById("qs10"), "Hide dismisses it");
    songs.push(...keep); setOrder.push(...keepSet); curSetObj().breaks.push(...keepB); refresh(); await frames(1);
    SLix.quickStart(); await frames(1); const box = document.querySelector(".qsbox10"); ok(box && box.querySelector('[data-q="songs"]').classList.contains("done"), "Help › Quick start shows it again, with songs ticked");
    if (box) box.closest(".cfbg").remove(); }
  { const L = curSetObj(), keepO = L.order.splice(0), keepB = (L.breaks || []).splice(0); refresh(); await frames(1); const es = document.querySelector("#songs .es10"); ok(es && /Drag songs here/.test(es.textContent) && es.querySelector("button"), "an empty setlist: “Drag songs here” and ＋ Add song"); L.order.push(...keepO); L.breaks.push(...keepB); refresh(); }

  // ================================================================ the search pill
  ok(!!document.getElementById("srch10"), "a search pill in the top bar");
  return { problems: P, log };
}
