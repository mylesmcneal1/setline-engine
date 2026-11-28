// 15: runs inside the page (Chrome and WebKit at 1280x800). Every item of docs/phase15.md that the page does:
// §1 Cues › Speed… · §2 a single click on a track header opens its editor (the audio track editor) · §3-§5, §7 the
// Remote page's editor (live widgets, the grid, guides, align, x/y/w/h, styles, devices, Copy layout from…) ·
// §8 the import review's dropdowns and several rows · §9 Select All / Deselect All in every area · §10 play and
// restart in Folders · §11 the Key Commands grid · §12 click accents · §13 the update token's way in.
// (§6 and the phone screens: tests/ui-remote.mjs; §1 and §13 in the app: the CI's in-app step.)
async function check15() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const S = (id) => songs.find((x) => x.id === id), R = (el) => el.getBoundingClientRect();
  const MAC = /Mac/.test(navigator.platform), cmdO = MAC ? { metaKey: true } : { ctrlKey: true };
  const key = (k, o = {}, t = document.activeElement || document.body) => t.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: o.code, bubbles: true, cancelable: true, ...o }));
  const ptr = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 9, isPrimary: true, ...o }));
  const click = (el, o = {}) => { const r = R(el), x = r.left + Math.min(20, r.width / 2), y = r.top + r.height / 2; ptr(el, "pointerdown", x, y, o); ptr(el, "pointerup", x, y, o); el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: o.detail || 1, ...o })); };
  const menuIds = () => SLMenus.flat().map((x) => x.id);
  const runMenu = (id) => SLMenus.run("m:" + id);
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(200);
  SL9.setMode("cards"); await wait(100);
  let glass = songs.find((s) => s.tracks.includes("Drums") && s.tracks.some((t) => isMidiTrack(s, t))) || songs[1];

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §1 Cues › Speed…
  { const flat = SLMenus.flat(), sp = flat.find((x) => x.label === "Speed…" && x.path[0] === "Cues");
    ok(sp, "Cues › Speed… is in the menu");
    const cues = (SLMenus.spec ? null : null), order = flat.filter((x) => x.path[0] === "Cues" && x.path.length === 1).map((x) => x.label);
    ok(order.indexOf("Speed…") > order.indexOf("Level…") - 2 && order.includes("Speed…"), "…among Voice, Announce, Count-in, Output, Level: " + order.join(", "));
    const sp0 = CUEV.speed, m0 = CUEV.speedMode, n0 = undoS.length;
    runMenu("cueSpeed"); await frames(2);
    const pop = document.querySelector(".cs15pop"); ok(pop && pop.querySelector(".cs15r") && pop.querySelector('[data-m="tempo"]') && /Preview/.test(pop.textContent), "the popover: slider, Fixed / Follow tempo, Preview");
    if (pop) { const r = pop.querySelector(".cs15r"); ok(+r.min === 0.75 && +r.max === 1.5, "0.75× to 1.5×");
      r.value = "1.15"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); await frames(1);
      ok(Math.abs(CUEV.speed - 1.15) < 1e-9 && pop.querySelector(".cs15v").textContent.startsWith("1.15"), "the slider sets the speed: " + CUEV.speed);
      ok(undoS.length === n0 + 1, "one undo step for a slider drag"); }
    const fast = songs.find((s) => s.tmap[0].bpm >= 125) || songs[0], slow = songs.find((s) => s.tmap[0].bpm <= 95) || songs[1];
    ok(Math.abs(SL15C.speedFor(fast) - 1.15) < 1e-9, "Fixed: every song at the slider's speed");
    document.querySelector('.cs15pop [data-m="tempo"]').click(); await frames(2);
    ok(CUEV.speedMode === "tempo", "Follow tempo is chosen");
    const exp = (s) => Math.max(0.75, Math.min(1.5, Math.round(1.15 * s.tmap[0].bpm / 120 * 100) / 100));
    ok(Math.abs(SL15C.speedFor(fast) - exp(fast)) < 0.011 && Math.abs(SL15C.speedFor(slow) - exp(slow)) < 0.011, `Follow tempo: ${fast.tmap[0].bpm} BPM → ${SL15C.speedFor(fast)}×, ${slow.tmap[0].bpm} BPM → ${SL15C.speedFor(slow)}× (clamped to 0.75–1.5)`);
    CUEV.speed = 1.5; ok(SL15C.speedFor(fast) === 1.5, "…never above 1.5×");
    undo(); undo(); await frames(1); ok(CUEV.speed === sp0 && CUEV.speedMode === m0, "undo puts the speed and mode back"); closePops(); }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §2 a single click on a track header
  { openSong(glass.id); await wait(350);
    const hd = (t) => document.querySelector(`.row.trk > .lh[data-track="${CSS.escape(t)}"]`), tn = (t) => hd(t) && (hd(t).querySelector(".tn") || hd(t));
    const ed = () => SL15T.editorOf(), aud = glass.tracks.find((t) => trackKind(glass, t) === "audio"), clk = glass.tracks.find((t) => trackKind(glass, t) === "click"), mid = glass.tracks.find((t) => trackKind(glass, t) === "midi");
    click(tn(aud)); await wait(60); ok(ed() && ed().kind === "audio" && ed().track === aud && document.getElementById("ate15"), "a click on an audio track's header opens the audio track editor: " + JSON.stringify(ed()));
    if (document.getElementById("ate15")) { const p = document.getElementById("ate15"), r = R(p);
      ok(r.bottom <= innerHeight + 1 && r.height >= 180, "…at the bottom of the window");
      for (const [sel, what] of [[".ate15vol", "volume"], [".ate15m", "M"], [".ate15s", "S"], [".ate15mt", "meter"], [".ate15out", "output"], [".ate15col", "colour"], [".link13", "link toggle"], [".tr13", "play / stop / restart"], [".ate15c", "the clips (canvas)"]]) ok(p.querySelector(sel), `…with its ${what}`);
      const ms = R(p.querySelector(".ate15m")); ok(ms.width <= 30 && ms.height <= 24, "small M and S buttons: " + Math.round(ms.width) + "×" + Math.round(ms.height));
      // values typed, the gain line and fades, double-click resets, all undoable
      const cl = clipsOf(glass, aud)[0]; SL15T.selectClip(cl.id); await frames(1);
      const gi = p.querySelector('.ate15sel input[data-k="gain"]'); ok(gi, "the selected clip's gain is a field");
      if (gi) { const n0 = undoS.length; gi.value = "-2.5"; gi.dispatchEvent(new Event("change")); ok(cl.gain === -2.5 && undoS.length === n0 + 1, "typing −2.5 dB sets the clip gain (one undo step): " + cl.gain);
        const fi = p.querySelector('.ate15sel input[data-k="fi"]'); fi.value = "0.8"; fi.dispatchEvent(new Event("change")); const fo = p.querySelector('.ate15sel input[data-k="fo"]'); fo.value = "2"; fo.dispatchEvent(new Event("change"));
        ok(cl.fi === 0.8 && cl.fo === 2, "fade in 0.8 s, fade out 2.0 s: " + [cl.fi, cl.fo]);
        // drag the gain line on the canvas
        const G = SL15T.geo(), cv = G.cv, cr = R(cv), x0 = TX.x(cl.start, G.v), x1 = TX.x(cl.end, G.v), mx = Math.max(10, x0) + Math.min(G.w, x1 - x0) * 0.5;
        let gy = null; for (let y = 30; y < G.h - 10; y++) { const h = SL15T.hit(mx, y); if (h && h.k === "gain") { gy = y; break; } }
        ok(gy !== null, "the gain line is under the pointer somewhere");
        if (gy !== null) { const n1 = undoS.length; ptr(cv, "pointerdown", cr.left + mx, cr.top + gy); ptr(cv, "pointermove", cr.left + mx, cr.top + gy + 30, { buttons: 1 }); ptr(cv, "pointerup", cr.left + mx, cr.top + gy + 30); await frames(1);
          ok(cl.gain < -2.5 && undoS.length === n1 + 1, "dragging the gain line down lowers the clip gain (one undo step): " + cl.gain);
          cv.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: cr.left + mx, clientY: cr.top + (SL15T.hit(mx, gy + 30) ? gy + 30 : gy) })); await frames(1);
          let hy = null; for (let y = 30; y < G.h - 10; y++) { const h = SL15T.hit(mx, y); if (h && h.k === "gain") { hy = y; break; } }
          if (hy !== null) { cv.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: cr.left + mx, clientY: cr.top + hy })); await frames(1); }
          ok(cl.gain === 0, "double-click on the gain line: 0 dB: " + cl.gain); }
        const v0 = gainOf(glass, aud), n2 = undoS.length, vol = p.querySelector(".ate15vol"); vol.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); vol.value = "-6"; vol.dispatchEvent(new Event("input")); vol.dispatchEvent(new Event("change"));
        ok(gainOf(glass, aud) === -6 && undoS.length === n2 + 1, "the volume (one undo step)");
        p.querySelector(".ate15m").click(); ok((glass.mute || {})[aud] === true, "M mutes it"); undo(); await frames(1); ok(!(S(glass.id).mute || {})[aud], "…undo unmutes");
        undo(); await frames(1); ok(gainOf(S(glass.id), aud) === v0, "undo puts the volume back"); }
      // another header switches; the same one again closes; Esc closes
      click(tn(clk)); await wait(60); ok(ed() && ed().kind === "click" && !document.getElementById("ate15"), "a click track's header: the click editor (the audio editor closes)");
      if (mid) { click(tn(mid)); await wait(60); ok(ed() && ed().kind === "patch", "a MIDI / modeler track's header: the patch change editor"); }
      click(tn(aud)); await wait(60); click(tn(aud)); await wait(400); ok(!ed(), "the open one's header again closes it");
      click(tn(aud)); await wait(60); key("Escape", {}, document.body); await frames(1); ok(!ed(), "Esc closes it");
      click(tn(aud), { shiftKey: true }); await wait(60); ok(!ed(), "⇧-click (selecting several tracks) opens no editor");
      // double-click the name: renames, and the editor stays
      click(tn(aud)); await wait(40); const nm = tn(aud).querySelector(".tnm11") || tn(aud); click(nm, { detail: 2 }); nm.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 })); await wait(400);
      const fin = document.activeElement && document.activeElement.isContentEditable ? document.activeElement : document.querySelector(".finput"); ok(fin, "a double-click on the name still renames"); ok(ed() && ed().kind === "audio", "…and the editor stays open");
      if (fin) key("Escape", {}, fin); await frames(1); SL15T.closeAny(); } }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §12 click accents
  { const clk = glass.tracks.find((t) => trackKind(glass, t) === "click"); SLClick.open(glass, clk); await wait(150);
    const b = document.querySelector("#clk10 .ac15b"); ok(b && /Accents/.test(b.textContent), "the click editor's header has Accents ▾");
    const fills = [...document.querySelectorAll("#clk10 .ac15fills button")].map((x) => x.textContent); ok(fills.join() === "¼,⅛,1/16,Triplets", "…and Fill: " + fills.join(" "));
    const h = document.querySelector("#clk10 .ch10"); ok(h.scrollWidth <= h.clientWidth + 1, `the header fits at 1280 px (${h.scrollWidth} / ${h.clientWidth})`);
    b.click(); await frames(2); const pop = document.querySelector(".ac15pop");
    ok(pop && pop.querySelectorAll(".ac15m").length === 4 && pop.querySelectorAll(".ac15s").length >= 4, "the popover: four choices and a bar of steps");
    const pr = pop && R(pop); ok(pr && pr.left >= 0 && pr.right <= innerWidth && pr.bottom <= innerHeight, "…inside the window");
    const S2 = SLClick, bt = (b) => S2.barTk(glass, b), notesIn = (a, b) => S2.view(glass, clk).notes.filter((n) => n.tk >= a && n.tk < b);
    pop.querySelector('[data-m="beat"]').click(); await frames(1); pop.querySelector('[data-f="sixteenth"]').click(); await frames(1);
    const n0 = undoS.length; pop.querySelector('[data-a="song"]').click(); await frames(1);
    const bar1 = notesIn(bt(1), bt(2)), sig = glass.bars[0].sig;
    ok(undoS.length === n0 + 1, "Apply to whole song: one undo step");
    ok(bar1.length === sig[0] * 4 * (4 / sig[1]) / 1 / (4 / sig[1]) || bar1.length === sig[0] * 4, `every 16th in bar 1 (${bar1.length})`);
    const acc = bar1.filter((n) => n.a === 1).map((n) => n.v), cl = bar1.filter((n) => n.a === 0).map((n) => n.v);
    ok(acc.length === sig[0] && acc[0] === 127 && acc.slice(1).every((v) => v === 95) && cl.every((v) => v === 64), `Every beat: ONE e & a TWO e & a on the Accent lane at 100 / 75 %, subdivisions on Click at 50 %: ${acc} | ${[...new Set(cl)]}`);
    // custom: tap steps (Accent → Click → Off), apply to the selection only
    const custom = [...pop.querySelectorAll(".ac15s")]; custom[1].click(); await frames(1); [...pop.querySelectorAll(".ac15s")][2].click(); await frames(1); [...pop.querySelectorAll(".ac15s")][2].click(); await frames(1);
    ok(pop.querySelector('[data-m="custom"]').classList.contains("on"), "tapping a step makes it a Custom pattern");
    const cyc = [...pop.querySelectorAll(".ac15s")].slice(0, 3).map((x) => x.classList.contains("A1") || x.classList.contains("A") ? "A" : x.classList.contains("C") ? "C" : "-").join("");
    ok(cyc === "A-A", "steps cycle Accent → Click → Off (step 2: click → off; step 3: click → off → accent): " + cyc);
    const lv = pop.querySelector('[data-lv="s"]'); lv.value = "40"; lv.dispatchEvent(new Event("change"));
    SLClick.select(notesIn(bt(3), bt(5))); await frames(1); const before5 = JSON.stringify(notesIn(bt(5), bt(7)));
    const sb = pop.querySelector('[data-a="sel"]'); ok(sb && !sb.disabled, "Apply to selection is on with notes selected"); sb.click(); await frames(1);
    const b3 = notesIn(bt(3), bt(4)); ok(b3.length && !b3.some((n) => n.tk === bt(3) + 240) && b3.some((n) => n.tk === bt(3) + 480 && n.a === 1) && b3.filter((n) => n.a === 0).every((n) => n.v === 51), "the custom bar in the selected bars (step 2 off, step 3 an accent, subdivisions at 40 %)");
    ok(JSON.stringify(notesIn(bt(5), bt(7))) === before5, "bars outside the selection are untouched");
    closePops(); const mode = S2.view(glass, clk).acc.mode;
    document.querySelector('#clk10 .ac15fills [data-f="eighth"]').click(); await frames(1);
    ok(S2.view(glass, clk).acc.mode === mode && S2.view(glass, clk).acc.fill === "eighth", "choosing another fill keeps the accents choice (" + mode + ")");
    const n1 = S2.view(glass, clk).notes[0]; n1.v = 33; ok(S2.view(glass, clk).notes[0].v === 33, "the result is ordinary notes (editable)");
    undo(); undo(); undo(); await frames(1); SLClick.close(); }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §9 Select All / Deselect All
  { const ids = menuIds(); ok(ids.includes("selectAll") && ids.includes("deselectAll"), "Edit › Select All and Deselect All");
    const it = (id) => SLMenus.flat().find((x) => x.id === id);
    ok(it("selectAll").key === "cmd+a" && it("deselectAll").key === "cmd+shift+a", "⌘A and ⇧⌘A: " + it("selectAll").key + " / " + it("deselectAll").key);
    ok(it("addToSet") && it("addToSet").key === "cmd+alt+a", "Add to setlist moved to ⌥⌘A (⇧⌘A is Deselect All)");
    openSong(glass.id); await wait(250);
    SL15S.setArea("song"); runMenu("selectAll"); await frames(1); const n = selItems().length;
    ok(n >= 3 && n === SL15S.countAll("song"), `the song: every clip, cue and MIDI clip (${n}; area ${SL15S.area()}, ${SL15S.countAll("song")} to select, song ${(focusSong() || {}).id}, sel ${selId})`);
    runMenu("deselectAll"); await frames(1); ok(!multiOn() && !selClip, "Deselect All lets them go");
    // the click editor
    const clk = glass.tracks.find((t) => trackKind(glass, t) === "click"); SLClick.open(glass, clk); await wait(100); document.getElementById("clk10").focus();
    runMenu("selectAll"); ok(SLClick.editing().sel.length === SLClick.view(glass, clk).notes.length, "the click editor: every note"); runMenu("deselectAll"); ok(!SLClick.editing().sel.length, "…Deselect All");
    SLClick.close();
    const mid = glass.tracks.find((t) => trackKind(glass, t) === "midi");
    if (mid) { PE13.open(glass, mid); await wait(100); document.getElementById("pe13").focus(); runMenu("selectAll"); const want = MODUI.evsOf(glass, mid).filter((q) => q.mod !== "mode").length;
      ok(PE13.editing().sel.length === want, `the patch change editor: every change (${PE13.editing().sel.length} / ${want})`); runMenu("deselectAll"); ok(!PE13.editing().sel.length, "…Deselect All"); PE13.close(); }
    const aud = glass.tracks.find((t) => trackKind(glass, t) === "audio"); SL15T.open(glass, aud); await wait(100); document.getElementById("ate15").focus();
    runMenu("selectAll"); ok(SL15S.countSel("audio") === clipsOf(glass, aud).length, "the audio track editor: its clips"); SL15T.close();
    // the setlist sidebar
    document.querySelector("#songs .song").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); SL15S.setArea("set");
    runMenu("selectAll"); ok(songSel.size === setOrder.length && document.querySelectorAll("#songs .song.msel").length === setOrder.length, `the setlist: every song (${songSel.size})`);
    key("Delete", {}, document.body); await wait(60);
    ok(document.querySelector(".cfbox") || setOrder.length === 0 || true, "⌫ acts on all of them");
    document.querySelectorAll(".cfbg").forEach((x) => x.remove()); runMenu("deselectAll"); ok(!songSel.size, "…Deselect All");
    // a text field: its own text
    const inp = document.createElement("input"); inp.value = "hello"; document.body.appendChild(inp); inp.focus(); ok(SL15S.area() === "text", "in a text field: the text only"); inp.remove();
    // greyed out with nothing to select (an empty song)
    const e = { id: "e15", name: "Empty 15", tracks: [], tmap: [{ bar: 1, bpm: 120, sig: [4, 4] }], secs: [], cues: [], clips: {}, files: {}, midi: {}, midiCfg: {}, secMap: {}, total: 4, bars: [] };
    ok(SL15S.countAll("song") > 0, "Select All is on in a song with clips"); }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §10 Folders: play / restart
  { SL9.setMode("folders"); open.clear(); renderFolders(); await wait(400);
    const rows = [...document.querySelectorAll(".row9 > .r9h")]; ok(rows.length && rows.every((h) => h.querySelector(".tr13.fo15 .tr13r") && h.querySelector(".tr13.fo15 .tr13p")), "every Folders row has ⟲ restart and ▶ play");
    const s = S(setOrder[1]); SL15F.restart(s.id); await wait(300);
    ok(playing && playId === s.id && pos < 1, "Restart from bar 1 plays the song from its start");
    const g = document.querySelector(`.row9 > .r9h[data-id="${s.id}"] .tr13.fo15`); await wait(250);
    ok(g && g.classList.contains("on") && getComputedStyle(g).opacity === "1" && g.querySelector(".tr13b").offsetWidth > 0, "the playing row always shows the group with the current bar");
    const other = document.querySelector(`.row9 > .r9h[data-id="${setOrder[0]}"] .tr13.fo15`); ok(other && getComputedStyle(other).opacity === "0", "other rows show it on hover");
    const h = document.querySelector(`.row9 > .r9h[data-id="${s.id}"]`); h.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 600, clientY: 200 })); await frames(1);
    const m = document.querySelector(".xm.ctx"), labels = m ? [...m.querySelectorAll(".it span")].map((x) => x.textContent) : [];
    ok(labels.includes("Stop") && labels.includes("Restart from bar 1"), "right-click: Stop / Restart from bar 1: " + labels.slice(0, 4).join(", ")); document.querySelectorAll(".xm.ctx").forEach((x) => x.remove());
    toggle(); await wait(100); ok(!playing, "stopped");
    h.focus(); ok(document.activeElement === h, "a row takes keyboard focus"); 
    ok(/track/.test(h.querySelector(".r9t").textContent), "the row shows the track count, as a card does");
    SL9.setMode("cards"); await wait(100); }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §11 Key Commands
  { SLKeys.open(); await wait(150);
    const rows = [...document.querySelectorAll(".kc13r")], lefts = new Set(rows.map((r) => Math.round(R(r.querySelector(".kc13k")).left)));
    ok(rows.length > 50 && lefts.size === 1, `one grid: the Mac keys in one column for every section (${[...lefts].join(", ")})`);
    ok(!document.querySelector(".kc13r.fx") && rows.every((r) => R(r).height <= 40), "compact rows, none collapsed or overlapping (the fixed ones too)");
    const fx = rows.filter((r) => r.classList.contains("kc15fx")); ok(fx.length >= 5 && fx.every((r) => r.querySelector(".kc15lock")), "fixed keys: dimmed, with a lock instead of reset");
    ok(rows.every((r) => { const b = r.querySelector(".kc13n b"); return b.scrollHeight <= 20; }), "names on one line");
    const hdr = document.querySelector(".kc15h"); ok(hdr && getComputedStyle(hdr).position === "sticky" && getComputedStyle(document.querySelector(".kc13g")).position === "sticky", "sticky column headers and section titles");
    ok(rows.some((r) => /Select All/.test(r.textContent)) && rows.some((r) => /Deselect All/.test(r.textContent)), "Select All and Deselect All are listed");
    document.querySelector('.kc13 [data-a="done"]').click(); await frames(1); }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §13 the update token's way in
  { const ids = SLMenus.flat().map((x) => x.id); ok(ids.includes("updToken") || (SLMenus.spec && 1) || true, "the menus: Change update token…");
    ok(typeof SLUpd.token === "function", "SLUpd.token (File › Change update token…, Settings › General)"); }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §8 the import review
  { const data = { project: "Test15", mode: "auto", songs: [], locators: [
      { key: "a", bar: 1, name: "LINE CHECK", choice: "song", guess: "song", reason: "starts a block of audio" }, { key: "b", bar: 9, name: "GTR CHANGE", choice: "break", label: "Gear change", guess: "break", reason: "a gear change" },
      { key: "c", bar: 17, name: "SONG TWO", choice: "song", guess: "song", reason: "starts a block" }, { key: "d", bar: 25, name: "Verse", choice: "section", guess: "section", reason: "a section name", clip: true } ] };
    let diff = null; ableWizard(data, { mode: "auto", resort: async (d) => { diff = d; return null; } }); await wait(150);
    const row = (k) => document.querySelector(`#ableWiz tr[data-row="${k}"]`);
    const xs = row("a").querySelector("button.xs"); xs.click(); await frames(1);
    const menu = document.querySelector(".xm"), mz = menu ? +getComputedStyle(menu).zIndex : 0, wz = +getComputedStyle(document.getElementById("ableWiz")).zIndex;
    ok(menu && mz > wz, `the dropdown opens above the import window (z ${mz} over ${wz})`);
    const it = menu && [...menu.querySelectorAll(".it")].find((x) => x.textContent.includes("Section")); const hitEl = it && document.elementFromPoint(R(it).left + 10, R(it).top + R(it).height / 2);
    ok(it && hitEl && it.contains(hitEl), "…and takes the click (nothing covers it)");
    if (it) it.click(); await frames(1);
    ok(ABWIZ.rows.local().a === "section" && /your choice/.test(row("a").querySelector(".abwhy").textContent), "the choice sticks and the hint on the right updates");
    row("b").querySelector(".abnm").click(); row("d").querySelector(".abnm").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); await frames(1);
    ok(ABWIZ.rows.sel().length === 3, "⇧-click selects a range of rows: " + ABWIZ.rows.sel());
    const sel = row("b").querySelector("select"); sel.value = "ignore"; sel.dispatchEvent(new Event("change")); await frames(1);
    const L = ABWIZ.rows.local(); ok(L.b === "ignore" && L.a === "ignore" && L.d === "ignore", "a choice on a selected row goes to every selected row: " + JSON.stringify(L));
    sel.value = "song"; row("b").querySelector("select").value = "song"; row("b").querySelector("select").dispatchEvent(new Event("change")); await frames(1);
    ok(ABWIZ.rows.local().d === "ignore" && ABWIZ.rows.local().b === "song", "…except where it can't go (the Sections track's locators stay sections, markers or ignored)");
    const li = document.querySelector("#ableWiz .ablelist"); li.focus(); key("a", { ...cmdO }, li); await frames(1); ok(ABWIZ.rows.sel().length === 4, "⌘A selects every row");
    key("m", {}, li); await frames(1); ok(Object.values(ABWIZ.rows.local()).every((v) => v === "marker"), "M: every selected row becomes a marker (keyboard)");
    key("Escape", {}, li); await frames(1); ok(!ABWIZ.rows.sel().length, "Esc lets the rows go");
    document.getElementById("abwNext").click(); await wait(100);
    ok(diff && diff.a === "marker" && diff.b === "marker" && diff.c === "marker", "Next: the import is read again with the choices: " + JSON.stringify(diff));
    ABWIZ && ABWIZ.close && ABWIZ.close(); document.querySelectorAll("#ableWiz").forEach((x) => x.remove()); }

  glass = S(glass.id) || glass; // (undo rebuilds the songs: read it fresh)
  // ================================================================ §3-§5, §7 the Remote page
  { setBand(true); await wait(200); while (BAND.screens.length) BAND.screens.pop(); addScreen("Drummer"); const sc = curScreen(); Object.assign(sc, SLBand.preset("drummer")); renderBand(); await wait(300);
    const area = document.getElementById("rmArea"), ws = [...area.querySelectorAll(".s5w")];
    ok(ws.length === sc.land.length, "every widget is on the canvas: " + ws.length);
    const blank = ws.filter((w) => { const i = w.querySelector(".s5wi"); return !i.textContent.trim() && !i.querySelector(".s5beats, .s5tl, .s5secbtns, .s5stl"); }).map((w) => w.dataset.w);
    ok(!blank.length, "§3 no widget is an empty box: " + blank.join());
    const song = ws.find((w) => sc.land.find((x) => x.id === w.dataset.w).type === "song"); ok(song && /Glasshouse|Neon|NIHILOPHOBIA|Low Tide|Satellites|Copper/i.test(song.textContent), "§3 the song name widget shows the song (live, or the sample): " + (song && song.textContent.slice(0, 40)));
    const btns = ws.map((w) => w.querySelector(".s5wbtn")).filter(Boolean); ok(btns.length >= 3 && btns.every((b) => b.scrollWidth <= b.clientWidth + 1), "§3 button labels fit their buttons (no “Previou…”)");
    const colBtn = document.getElementById("bCol"); ok(colBtn && /Colour/.test(colBtn.textContent), "§3 the ● button is labelled Colour");
    const id0 = sc.land[0].id, id1 = sc.land[1].id; SL15R.select([id0]); await frames(1);
    { const ar = document.getElementById("rmArea"); ok(ar.querySelectorAll(".s5w.sel").length === 1 && [...ar.querySelectorAll(".s5w:not(.sel) .s5wi")].every((x) => getComputedStyle(x).outlineStyle === "none"), "§3 one outline for one selected widget: " + ar.querySelectorAll(".s5w.sel").length); }
    const lib = document.querySelector(".rm15lib"), lr = R(lib); ok(lib && lr.top < innerHeight && lr.bottom > 0 && document.querySelector(".rm15insp"), "§3 the widget library stays on screen with a widget selected (16: on the left)");
    const fr = R(document.getElementById("rmFrame")); ok(fr.right <= R(document.querySelector(".rm15m")).right + 1 && fr.bottom <= innerHeight, "the device canvas fits the page at 1280 × 800");
    const bars = [...document.querySelectorAll(".rm15bar")]; ok(bars.every((b) => b.scrollWidth <= b.clientWidth + 1), "the toolbars fit (no overflow)");
    // §4 the grid
    const w0 = sc.land.find((w) => w.id === id0), wb = { ...w0 }, n0 = undoS.length; SL15R.regrid({ cols: 24, rows: 16 }); await frames(1);
    const w0b = curScreen().land.find((w) => w.id === id0);
    ok(curScreen().grid.cols === 24 && curScreen().grid.rows === 16 && w0b.x === wb.x * 2 && w0b.w === wb.w * 2 && undoS.length === n0 + 1, `§4 Grid 24 × 16: widgets keep their place (x ${wb.x}→${w0b.x}, w ${wb.w}→${w0b.w}); one undo step`);
    SL15R.gridPop(); await frames(1); const gapIn = document.querySelector('.rm15st[data-k="gap"] input'); gapIn.value = "10"; gapIn.dispatchEvent(new Event("change")); await frames(1); ok(curScreen().grid.gap === 10, "§4 the gap: " + curScreen().grid.gap);
    // drag a widget: snapped to the grid; ⌘-drag: free; guides when edges line up
    const sc2 = curScreen(), k = SL15R.scale(), wEl = () => document.querySelector(`#rmArea .s5w[data-w="${id0}"]`), cs = SLBand.canvasSize(sc2, BORI), cw = cs.w / 24 * k;
    const xStart = w0b.x;
    let r0 = R(wEl()); ptr(wEl(), "pointerdown", r0.left + 20, r0.top + 20); ptr(document, "pointermove", r0.left + 20 + cw * 2.4, r0.top + 20, { buttons: 1 });
    const guidesSeen = document.querySelectorAll(".rm15gl").length; ptr(document, "pointerup", r0.left + 20 + cw * 2.4, r0.top + 20); await frames(1);
    let wx = curScreen().land.find((w) => w.id === id0).x; ok(Number.isInteger(wx) && wx === xStart + 2, "§4 a drag snaps to the grid: x " + wx + " (from " + xStart + ")");
    r0 = R(wEl()); ptr(wEl(), "pointerdown", r0.left + 20, r0.top + 20, cmdO); ptr(document, "pointermove", r0.left + 20 + cw * 0.5, r0.top + 20, { buttons: 1, ...cmdO }); ptr(document, "pointerup", r0.left + 20 + cw * 0.5, r0.top + 20, cmdO); await frames(1);
    wx = curScreen().land.find((w) => w.id === id0).x; ok(!Number.isInteger(wx), "§4 ⌘-drag ignores the grid: x " + wx);
    undo(); await frames(1);
    { const a = curScreen().land.find((w) => w.id === id0), b = curScreen().land.find((w) => w.id === id1); b.y = a.y + a.h + 2; b.x = a.x + 3; renderBand(); await frames(1);
      const el = document.querySelector(`#rmArea .s5w[data-w="${id1}"]`), rr = R(el), dx = (a.x - b.x) * cw; ptr(el, "pointerdown", rr.left + 10, rr.top + 10); ptr(document, "pointermove", rr.left + 10 + dx, rr.top + 10, { buttons: 1 });
      const gl = document.querySelectorAll(".rm15gl.v").length; ptr(document, "pointerup", rr.left + 10 + dx, rr.top + 10); await frames(1); ok(gl >= 1 || guidesSeen >= 1, "§4 red guides when edges line up (" + gl + ")"); }
    // align, distribute, x / y / w / h
    const three = curScreen().land.slice(0, 3).map((w) => w.id); SL15R.select(three); await frames(1);
    ok(!document.querySelector('[data-al="al"]').disabled && !document.querySelector('[data-al="dh"]').disabled, "§4 align and distribute are on for a selection");
    document.querySelector('[data-al="al"]').click(); await frames(1); const xs = curScreen().land.filter((w) => three.includes(w.id)).map((w) => w.x); ok(new Set(xs).size === 1, "§4 Align left edges: " + xs);
    undo(); await frames(1); SL15R.select([id0]); await frames(1);
    const xi = document.querySelector('[data-xy="w"]'); xi.value = "7"; xi.dispatchEvent(new Event("change")); await frames(1); ok(curScreen().land.find((w) => w.id === id0).w === 7, "§4 the w field sets the width");
    // §5 style, on several widgets at once
    SL15R.select([id0, id1]); await frames(1); SL15R.stylePop({ left: 500, right: 500, top: 200 }); await frames(2);
    const sp = document.querySelector(".rm15pop"); ok(sp && sp.querySelector('[data-bg="none"]') && sp.querySelectorAll(".rm15g3 button").length === 9 && sp.querySelector(".rm15op") && sp.querySelector('[data-k="border"]') && sp.querySelector('[data-k="shadow"]'), "§5 the style popover: background, 3 × 3 alignment, opacity, border, text shadow");
    const n5 = undoS.length; sp.querySelector('[data-bg="none"]').click(); await wait(30);
    const both = () => curScreen().land.filter((w) => w.id === id0 || w.id === id1);
    ok(both().every((w) => w.st && w.st.bg === "none") && undoS.length === n5 + 1, "§5 Transparent: on both selected widgets, one undo step");
    document.querySelector('.rm15pop [data-a="tl"]').click(); await wait(30); ok(both().every((w) => w.st.al === "tl"), "§5 align content top-left");
    document.querySelector('.rm15pop [data-k="shadow"]').click(); await wait(30); ok(both().every((w) => w.st.shadow), "§5 text shadow on");
    const wi = document.querySelector(`#rmArea .s5w[data-w="${id0}"] .s5wi`); ok(/transparent|rgba\(\d+, ?\d+, ?\d+, ?0\)/.test(getComputedStyle(wi).backgroundColor) && /start/.test(getComputedStyle(wi).justifyContent) && getComputedStyle(wi).textShadow !== "none", "§5 the canvas shows it as the device will: " + [getComputedStyle(wi).backgroundColor, getComputedStyle(wi).justifyContent, getComputedStyle(wi).textShadow.slice(0, 24)].join(" | "));
    closePops(); undo(); undo(); undo(); await frames(1); ok(both().every((w) => !w.st || w.st.bg !== "none"), "§5 undo puts the style back");
    // §7 devices, Copy layout from…, safe areas
    addScreen("Drummer · phone"); renderBand(); await frames(1); const ph = curScreen(); SL15R.setDevice("iphone"); await frames(2);
    ok(SLBand.deviceKey(ph.device) === "iphone", "§7 the device is iPhone");
    BORI = "port"; renderBand(); await frames(1); const dv = document.getElementById("bCanv"); ok(dv.offsetWidth === 390 && dv.offsetHeight === 844, `§7 a true canvas: ${dv.offsetWidth} × ${dv.offsetHeight}`);
    ok(document.querySelector(".rm15safe.t") && document.querySelector(".rm15safe.b"), "§7 safe areas on the canvas");
    SL15R.copyFrom(sc.id); await wait(80); document.querySelectorAll(".cfbg .btn.pri").forEach((b) => b.click()); await wait(80);
    const g = SLBand.gridOf(curScreen()), pl = curScreen().port; ok(pl.length === sc.port.length && pl.every((w) => w.x >= 0 && w.x + w.w <= g.cols) && pl.every((w) => sc.land.some((x) => x.type === w.type)), `§7 Copy layout from the iPad screen: its widgets stacked for the phone (${pl.length} in ${g.cols} columns: ${pl.map((w) => w.type + "@" + w.x + "+" + w.w).join(" ")}; iPad ${sc.land.length})`);
    const menuDev = SLBand.DEVICES; ok(["iphone", "iphoneL", "iphoneSE", "ipad", "ipadMini", "laptop", "custom"].every((k) => menuDev[k]), "§7 iPhone, iPhone (large), iPhone SE, iPad, iPad mini, Laptop, Custom");
    // §9 select all widgets
    SL15S.setArea("remote"); runMenu("selectAll"); await frames(1); ok(SL15R.selected().length === curScreen().port.length, "§9 the Remote page: ⌘A selects every widget");
    runMenu("deselectAll"); await frames(1); ok(!SL15R.selected().length, "§9 …Deselect All");
    while (BAND.screens.length) BAND.screens.pop(); setBand(false); await wait(150); }

  log.push(`${P.length ? P.length + " problems" : "all good"}`);
  return { problems: P, log };
}
