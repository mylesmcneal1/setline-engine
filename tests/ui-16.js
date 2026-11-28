// 16: runs inside the page (Chrome and WebKit at 1280x800). docs/phase16.md, the Remote page's editor:
// §1 the library: live miniatures, search, category tabs, the preview over the library with the styles, dragging in
//    with a ghost that's already snapped (to the screen's centre here), double-click adds at the first free spot.
// §2 Centre / Middle to the screen and to the selection, a group centred as one block, smart guides snapping to the
//    centre while dragging ("Centred" badge), ⌘-drag ignores snapping, guides with the grid off, lock, nudge, the
//    Edit › Arrange commands and their keys (no clashes).
// §3 the inspector on several widgets ("—" for mixed values), every change one undo step, undo / redo.
// §4 every widget in every style at iPad (landscape and portrait), iPhone 390 x 844 and iPhone SE 375 x 667 sizes:
//    nothing overflows its box, no text is cut off.
// (The device itself, hold-to-stop and Play + Sync MIDI: tests/ui-remote.mjs.)
async function check16() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const R = (el) => el.getBoundingClientRect();
  const MAC = /Mac/.test(navigator.platform), cmdO = MAC ? { metaKey: true } : { ctrlKey: true };
  const ptr = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 9, isPrimary: true, ...o }));
  const key = (k, o = {}, t = document.body) => (t === document.body && document.activeElement && document.activeElement !== document.body && document.activeElement.blur && document.activeElement.blur(), t.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: o.code, bubbles: true, cancelable: true, ...o })));
  const runMenu = (id) => SLMenus.run("m:" + id);
  const near = (a, b, e = 0.002) => Math.abs(a - b) <= e;
  const W = (id) => curScreen().land.find((w) => w.id === id);

  setBand(true); await wait(200); while (BAND.screens.length) BAND.screens.pop(); addScreen("Stage"); BORI = "land"; renderBand(); await wait(300);
  for (const f of ["400", "600", "700", "800"]) try { await document.fonts.load(`${f} 40px Outfit`); } catch (e) {}
  SLBand.fontsChanged(); SL16R.paint(true); await frames(2);

  // ================================================================ §1 the library
  { const tiles = () => [...document.querySelectorAll("#rwTiles .rwt")], all = Object.keys(SLBand.WIDGETS);
    const left = document.getElementById("rwLeft"), frame = document.getElementById("rmFrame");
    ok(left && R(left).right <= R(frame).left, "§1 the library is on the left of the canvas");
    ok(tiles().length === all.length, `§1 a tile per widget: ${tiles().length} of ${all.length}`);
    const blank = tiles().filter((t) => { const i = t.querySelector(".rwnat .s5wi"); return !i || (!i.textContent.trim() && !i.querySelector(".s5beats, .s5tl, .s5secbtns, .s5stl, .s5dots, svg")); }).map((t) => t.dataset.add);
    ok(!blank.length, "§1 every tile is a live miniature (drawn by the device's renderer): blank " + blank.join());
    const song = document.querySelector('.rwt[data-add="song"] .rwnat'); ok(song && /NIHILOPHOBIA|Glasshouse|Neon|Low Tide|Satellites|Copper|Paper/i.test(song.textContent), "§1 the song tile shows the song (live or the sample): " + (song && song.textContent.slice(0, 30)));
    SL16R.lib.find("clock"); await frames(1);
    ok(tiles().length >= 2 && tiles().every((t) => /clock/i.test(t.textContent + " " + t.getAttribute("aria-label")) || ["clock", "curfew", "songLeft", "setLeft"].includes(t.dataset.add)), "§1 search: " + tiles().map((t) => t.dataset.add).join());
    SL16R.lib.find("zzzz"); await frames(1); ok(!tiles().length && /No widget matches/.test(document.getElementById("rwTiles").textContent), "§1 search with no match says so");
    SL16R.lib.find(""); await frames(1);
    const cats = [...document.querySelectorAll(".rwcats [data-cat]")].map((b) => b.textContent); ok(cats.join() === "All,Song,Time,Controls,Setlist", "§1 category tabs: " + cats.join());
    document.querySelector('.rwcats [data-cat="controls"]').click(); await frames(1);
    ok(tiles().some((t) => t.dataset.add === "playStop") && !tiles().some((t) => t.dataset.add === "song"), "§1 the Controls tab: " + tiles().map((t) => t.dataset.add).join());
    document.querySelector('.rwcats [data-cat="time"]').click(); await frames(1); ok(tiles().some((t) => t.dataset.add === "clock") && !tiles().some((t) => t.dataset.add === "playStop"), "§1 the Time tab");
    document.querySelector('.rwcats [data-cat="all"]').click(); await frames(1);
    ok(left.scrollWidth <= left.clientWidth + 1 && [...document.querySelectorAll(".rwcats")].every((c) => c.scrollWidth <= c.clientWidth + 1), "§1 the library fits its column (tabs included)");
    // the preview: over the library, never over the canvas; the styles; pick one
    const cue = document.querySelector('.rwt[data-add="cueFeed"]'); cue.dispatchEvent(new MouseEvent("mouseenter")); await wait(450);
    let pop = document.getElementById("rwPop");
    ok(pop && pop.querySelectorAll(".rwpchip").length === 3 && /Cue/.test(pop.textContent) && /drag to add/.test(pop.textContent), "§1 hover: a big preview with the 3 styles");
    if (pop) { const pr = R(pop), lr = R(left); ok(pr.left >= lr.left - 1 && pr.right <= lr.right + 1 && pr.right <= R(frame).left, `§1 the preview is over the library, not the canvas (${Math.round(pr.left)}–${Math.round(pr.right)}; library ${Math.round(lr.left)}–${Math.round(lr.right)})`);
      ok(pr.top >= 0 && pr.bottom <= innerHeight, "§1 the preview is on screen");
      const big = pop.querySelector(".rwpbig .s5wi"); ok(big && big.textContent.trim() && big.textContent === big.textContent.toUpperCase(), "§1 the preview is live (the song's next cue word): " + (big && big.textContent));
      pop.querySelector('.rwpchip[data-v="flash"]').click(); await wait(60); pop = document.getElementById("rwPop");
      ok(pop && pop.querySelector(".rwpchip.on").dataset.v === "flash" && document.querySelector('.rwt[data-add="cueFeed"] .rwnat').dataset.v === "flash", "§1 picking a style: the preview and the tile show it"); }
    cue.dispatchEvent(new MouseEvent("mouseleave")); SL16R.lib.hide();
    // keyboard: focus a tile = the preview; ↩ adds
    cue.focus(); if (!document.hasFocus()) cue.dispatchEvent(new FocusEvent("focus")); await wait(60); ok(document.getElementById("rwPop"), "§1 a tile focused with the keyboard shows the preview");
    const n0 = curScreen().land.length; key("Enter", {}, cue); await frames(2);
    const added = curScreen().land[n0]; ok(added && added.type === "cueFeed" && added.v === "flash", "§1 ↩ on a tile adds it (in the picked style): " + JSON.stringify(added && { t: added.type, v: added.v }));
    undo(); await frames(1); SL16R.lib.hide(); document.activeElement && document.activeElement.blur && document.activeElement.blur();
    // double-click: the first free spot
    document.querySelector('.rwt[data-add="song"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await frames(2);
    const s1 = curScreen().land.find((w) => w.type === "song"); ok(s1 && s1.x === 0 && s1.y === 0, "§1 double-click adds at the first free spot: " + JSON.stringify(s1 && [s1.x, s1.y, s1.w, s1.h]));
    document.querySelector('.rwt[data-add="bpm"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await frames(2);
    const b1 = curScreen().land.find((w) => w.type === "bpm"); ok(b1 && b1.x === 6 && b1.y === 0, "§1 …the next one beside it: " + JSON.stringify(b1 && [b1.x, b1.y]));
    // drag in: the ghost, snapped to the screen's centre before the drop
    const cv = document.getElementById("bCanv"), cr = R(cv), K = SL16R.scale(), cs = SL16R.cellsize(), top = cr.top + 24 * K; // (an iPad in landscape: 24 px of safe area)
    const tile = document.querySelector('.rwt[data-add="clock"]'), tr = R(tile), sx = tr.left + tr.width / 2, sy = tr.top + tr.height / 2;
    const tx = cr.left + (cs.aw / 2) * K + 3, ty = top + (2.3 * cs.ch + cs.ch) * K; // the clock is 3 x 2: its centre 3 px right of the screen's centre
    const u0 = undoS.length; ptr(tile, "pointerdown", sx, sy); for (let i = 1; i <= 6; i++) ptr(document, "pointermove", sx + (tx - sx) * i / 6, sy + (ty - sy) * i / 6); await frames(1);
    const ghost = document.querySelector("#rmArea .rwghost"), badge = document.querySelector("#rmArea .rwbadge");
    ok(ghost && +ghost.dataset.x === 4.5 && +ghost.dataset.y === 2, `§1 dragging in: a ghost at the drop place, snapped (x ${ghost && ghost.dataset.x}, y ${ghost && ghost.dataset.y}; the centre is 4.5)`);
    ok(document.querySelector('#rmArea .rm15gl.v[data-kind="centre"]') && badge && /Centred/.test(badge.textContent), "§1 …with the pink centre line and the Centred badge");
    ok(document.querySelector(".rwfly"), "§1 …and the widget under the pointer");
    ptr(document, "pointerup", tx, ty); await frames(2);
    const c1 = curScreen().land.find((w) => w.type === "clock"); ok(c1 && c1.x === 4.5 && c1.y === 2 && undoS.length === u0 + 1 && !document.querySelector(".rwghost, .rwfly"), "§1 the drop puts it where the ghost was: " + JSON.stringify(c1 && [c1.x, c1.y]) + ", one undo step");
    // Esc cancels a drag
    ptr(tile, "pointerdown", sx, sy); ptr(document, "pointermove", tx, ty); await frames(1); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); ptr(document, "pointerup", tx, ty); await frames(1);
    ok(curScreen().land.filter((w) => w.type === "clock").length === 1, "§1 Esc cancels a drag from the library");
  }

  // ================================================================ §2 Centre / Middle, groups, guides, ⌘-drag, lock
  { const sc = curScreen(), song = sc.land.find((w) => w.type === "song"), bpm = sc.land.find((w) => w.type === "bpm"), clock = sc.land.find((w) => w.type === "clock");
    const ids = { song: song.id, bpm: bpm.id, clock: clock.id }, btn = (k) => document.querySelector(`[data-al="${k}"]`);
    SL16R.select([ids.bpm]); await frames(1);
    ok(SL16R.alignMode() === "screen" && document.querySelector('#rwTo .on').dataset.v === "screen", "§2 one widget: Align to Screen");
    ok(btn("ac") && /Centre/.test(btn("ac").textContent) && /Middle/.test(btn("am").textContent) && !btn("ac").disabled, "§2 Centre and Middle buttons");
    let u = undoS.length; btn("ac").click(); await frames(1); ok(near(W(ids.bpm).x, (12 - 3) / 2) && undoS.length === u + 1, "§2 one click on Centre: the exact centre of the screen: x " + W(ids.bpm).x);
    btn("am").click(); await frames(1); ok(near(W(ids.bpm).y, (9 - 2) / 2), "§2 Middle: the vertical centre: y " + W(ids.bpm).y);
    btn("al").click(); await frames(1); ok(W(ids.bpm).x === 0, "§2 Align left on the screen: x 0");
    btn("ab").click(); await frames(1); ok(W(ids.bpm).y === 7, "§2 Align bottom on the screen: y " + W(ids.bpm).y);
    // several: Selection by default; align to each other
    SL16R.select([ids.song, ids.bpm]); await frames(1); ok(SL16R.alignMode() === "sel", "§2 several widgets: Align to Selection");
    btn("ac").click(); await frames(1); { const a = W(ids.song), b = W(ids.bpm); ok(near(a.x + a.w / 2, b.x + b.w / 2), `§2 Centre to the selection: centres line up (${a.x + a.w / 2} / ${b.x + b.w / 2})`); }
    // the group to the screen: centred as one block, keeping their places relative to each other
    { const a0 = { ...W(ids.song) }, b0 = { ...W(ids.bpm) }; SL16R.setAlignTo("screen"); await frames(1); ok(document.querySelector('#rwTo .on').dataset.v === "screen", "§2 Align to: Screen chosen");
      btn("ac").click(); await frames(1); const a = W(ids.song), b = W(ids.bpm), x0 = Math.min(a.x, b.x), x1 = Math.max(a.x + a.w, b.x + b.w);
      ok(near((x0 + x1) / 2, 6) && near(a.x - b.x, a0.x - b0.x) && a.y === a0.y && b.y === b0.y, `§2 a group centred on the screen as one block (${x0}–${x1}; offset kept ${a.x - b.x})`);
      btn("am").click(); await frames(1); const y0 = Math.min(W(ids.song).y, W(ids.bpm).y), y1 = Math.max(W(ids.song).y + W(ids.song).h, W(ids.bpm).y + W(ids.bpm).h); ok(near((y0 + y1) / 2, 4.5), `§2 …and Middle (${y0}–${y1})`); }
    // distribute and same size
    SL16R.select([ids.song, ids.bpm, ids.clock]); SL16R.setAlignTo("sel"); await frames(1); ok(!btn("dh").disabled && !btn("ss").disabled, "§2 distribute and same size are on for three");
    btn("ss").click(); await frames(1); ok([ids.bpm, ids.clock].every((id) => W(id).w === W(ids.song).w && W(id).h === W(ids.song).h), "§2 Make same size (as the first selected)");
    undo(); await frames(1);
    // smart guides while dragging: snap to the screen's centre, the badge; ⌘-drag ignores it
    SL16R.select([ids.clock]); await frames(1); W(ids.clock).x = 1; W(ids.clock).y = 6; renderBand(); await frames(1);
    const K = SL16R.scale(), cs = SL16R.cellsize(), el = () => document.querySelector(`#rmArea .s5w[data-w="${ids.clock}"]`);
    let r0 = R(el()), dx = ((12 - 3) / 2 - 1) * cs.cw * K + 4; // to 4 screen px right of centred
    ptr(el(), "pointerdown", r0.left + 30, r0.top + 30); ptr(document, "pointermove", r0.left + 30 + dx / 2, r0.top + 30); ptr(document, "pointermove", r0.left + 30 + dx, r0.top + 30); await frames(1);
    const cl = document.querySelector('#rmArea .rm15gl.v[data-kind="centre"]'), bd = document.querySelector("#rmArea .rwbadge");
    ok(cl && bd && /Centred/.test(bd.textContent) && getComputedStyle(cl).backgroundColor !== "rgba(0, 0, 0, 0)", "§2 dragging near the centre: the pink centre line and “Centred”");
    ptr(document, "pointerup", r0.left + 30 + dx, r0.top + 30); await frames(1); ok(W(ids.clock).x === 4.5, "§2 …it snaps to the exact centre: x " + W(ids.clock).x);
    ok(!document.querySelector("#rmArea .rm15gl, #rmArea .rwbadge"), "§2 the guides go when the drag ends");
    // ⌘-drag: no snapping at all (not to the grid, not to the centre)
    W(ids.clock).x = 1; renderBand(); await frames(1); r0 = R(el());
    ptr(el(), "pointerdown", r0.left + 30, r0.top + 30, cmdO); ptr(document, "pointermove", r0.left + 30 + dx, r0.top + 30, cmdO); await frames(1);
    const anyGuide = document.querySelectorAll("#rmArea .rm15gl").length; ptr(document, "pointerup", r0.left + 30 + dx, r0.top + 30, cmdO); await frames(1);
    ok(!anyGuide && !near(W(ids.clock).x, 4.5, 0.01) && !Number.isInteger(W(ids.clock).x), `§2 ${MAC ? "⌘" : "Ctrl"}-drag ignores snapping: x ${W(ids.clock).x}, ${anyGuide} guides`);
    // the grid off: free placement, the guides still snap
    SL16R.gridPop(); await frames(1); document.querySelector('.pop .rm15tg[data-t="snap"]').click(); await frames(1); closePops();
    ok(SLBand.gridOf(curScreen()).snap === false && /free/.test(document.getElementById("rwGrid").textContent), "§2 Snap off (the grid button says “free”)");
    W(ids.clock).x = 1; renderBand(); await frames(1); r0 = R(el());
    ptr(el(), "pointerdown", r0.left + 30, r0.top + 30); ptr(document, "pointermove", r0.left + 30 + dx, r0.top + 30); await frames(1); const g2 = document.querySelector('#rmArea .rm15gl.v[data-kind="centre"]'); ptr(document, "pointerup", r0.left + 30 + dx, r0.top + 30); await frames(1);
    ok(g2 && W(ids.clock).x === 4.5, "§2 grid off: the guides still snap to the centre: x " + W(ids.clock).x);
    // x / y / w / h in points with Snap off
    const xi = document.querySelector('#rwRight [data-xy="x"]'); ok(xi && Math.abs(+xi.value - W(ids.clock).x * cs.cw) <= 1, `§2 x in points with Snap off (${xi && xi.value} pt)`);
    xi.value = "100"; xi.dispatchEvent(new Event("change")); await frames(1); ok(Math.abs(W(ids.clock).x * cs.cw - 100) < 0.5, "§2 typing x = 100 pt: " + (W(ids.clock).x * cs.cw).toFixed(1));
    // arrows: 1 pt, ⇧ 10 pt (Snap off); a cell, ⇧ two (Snap on)
    let x0 = W(ids.clock).x * cs.cw; key("ArrowRight"); await frames(1); ok(Math.abs(W(ids.clock).x * cs.cw - x0 - 1) < 0.05, "§2 → nudges 1 pt with Snap off");
    x0 = W(ids.clock).x * cs.cw; key("ArrowRight", { shiftKey: true }); await frames(1); ok(Math.abs(W(ids.clock).x * cs.cw - x0 - 10) < 0.05, "§2 ⇧→ nudges 10 pt");
    SL16R.gridPop(); await frames(1); document.querySelector('.pop .rm15tg[data-t="snap"]').click(); await frames(1); closePops();
    W(ids.clock).x = 2; renderBand(); SL16R.select([ids.clock]); await frames(1);
    key("ArrowRight"); await frames(1); ok(W(ids.clock).x === 3, "§2 → nudges a cell with Snap on"); key("ArrowDown", { shiftKey: true }); await frames(1); ok(W(ids.clock).y === 8 || W(ids.clock).y === 7, "§2 ⇧↓ a bigger step (stays on the screen): y " + W(ids.clock).y);
    // lock
    document.getElementById("rwLock").click(); await frames(1); ok(W(ids.clock).lock === true && document.querySelector(`#rmArea .s5w[data-w="${ids.clock}"] .rwlk`), "§2 Lock position (a lock on the canvas)");
    const lx = W(ids.clock).x; r0 = R(el()); ptr(el(), "pointerdown", r0.left + 30, r0.top + 30); ptr(document, "pointermove", r0.left + 130, r0.top + 30); ptr(document, "pointerup", r0.left + 130, r0.top + 30); await frames(1);
    key("ArrowLeft"); await frames(1); ok(W(ids.clock).x === lx && document.querySelector('[data-al="ac"]').disabled, "§2 a locked widget doesn't move (drag, arrows, Centre)");
    runMenu("arrLock"); await frames(1); ok(!W(ids.clock).lock, "§2 Edit › Arrange › Lock position toggles it back");
    // the menu: every command with a key that nothing else uses
    const flat = SLMenus.flat(), arr = flat.filter((x) => /^arr/.test(x.id));
    ok(["arrLeft", "arrCentre", "arrRight", "arrTop", "arrMiddle", "arrBottom", "arrDistH", "arrDistV", "arrSame", "arrLock", "arrToScreen", "arrToSel"].every((id) => arr.some((x) => x.id === id)), "§2 Edit › Arrange (Remote) has every command: " + arr.map((x) => x.id).join());
    const keyed = arr.filter((x) => x.key), clash = keyed.filter((x) => flat.some((y) => y.id !== x.id && y.key && y.key === x.key));
    ok(keyed.length === 10 && !clash.length, `§2 ${keyed.length} shortcuts, none used by another command: ${clash.map((x) => x.id + " " + x.key).join(", ") || "no clashes"}`);
    ok(arr.every((x) => x.path[0] === "Edit"), "§2 …in the Edit menu (Key Commands lists them)");
    SL16R.select([ids.bpm]); await frames(1); runMenu("arrCentre"); await frames(1); ok(near(W(ids.bpm).x, 4.5), "§2 Edit › Arrange › Centre works (the key runs the same)");
    const kc = flat.find((x) => x.id === "arrCentre"); ok(kc && /H/.test(kc.keyText), "§2 Centre's key: " + (kc && kc.keyText));
    // the toolbars fit at 1280 x 800
    ok([...document.querySelectorAll(".rm15bar")].every((b) => b.scrollWidth <= b.clientWidth + 1), "§2 the toolbars fit at 1280 × 800");
    log.push(`Centre ${kc && kc.keyText}, Middle ${(flat.find((x) => x.id === "arrMiddle") || {}).keyText}`);
  }

  // ================================================================ §3 the inspector on several widgets, undo / redo
  { const sc = curScreen(), ids = sc.land.map((w) => w.id), [a, b, c] = ids;
    SL16R.select([a]); await frames(1); const pi = () => document.querySelector('#rwRight .rwsl[data-r="pad"] input[type=number]');
    pi().value = "4"; pi().dispatchEvent(new Event("change")); await frames(1); ok(W(a).st.pad === 4, "§3 padding on one widget");
    SL16R.select([a, b, c]); await frames(1);
    ok(pi().value === "" && pi().placeholder === "—", "§3 mixed values show “—”");
    ok(/3 selected/.test(document.querySelector(".rwhead").textContent), "§3 the header: 3 selected");
    let u = undoS.length; pi().value = "18"; pi().dispatchEvent(new Event("change")); await frames(1);
    ok([a, b, c].every((id) => W(id).st.pad === 18) && undoS.length === u + 1, "§3 padding on 3 widgets: one undo step");
    const rr = document.querySelector('#rwRight .rwsl[data-r="rad"] input[type=range]'); u = undoS.length;
    rr.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); for (const v of [20, 24, 28]) { rr.value = String(v); rr.dispatchEvent(new Event("input")); } rr.dispatchEvent(new Event("change")); await frames(1);
    ok([a, b, c].every((id) => W(id).st.rad === 28) && undoS.length === u + 1, "§3 corner radius slider: one undo step for the whole drag");
    ok(getComputedStyle(document.querySelector(`#rmArea .s5w[data-w="${a}"] .s5wi`)).borderTopLeftRadius === "28px", "§3 …and the canvas shows it");
    const segc = (s, v) => document.querySelector(`#rwRight .rwseg[data-s="${s}"] [data-v="${v}"]`).click();
    segc("wt", "bold"); await frames(1); segc("lab", "hidden"); await frames(1); segc("size", "fixed"); await frames(1); segc("bg", "none"); await frames(1);
    ok([a, b, c].every((id) => { const s = W(id).st; return s.wt === "bold" && s.lab === "hidden" && +s.size > 0 && s.bg === "none"; }), "§3 weight, label, fixed size, background on all three");
    const font = document.getElementById("rwFont"); font.value = "Inter"; font.dispatchEvent(new Event("change")); await frames(1); ok([a, b, c].every((id) => W(id).st.font === "Inter"), "§3 font on all three");
    document.querySelector('#rwRight .rm15tg[data-t="border"]').click(); await frames(1); ok([a, b, c].every((id) => W(id).st.border === true), "§3 border on all three");
    document.querySelector('#rwRight .rm15tg[data-t="sec"]').click(); await frames(1); const secv = W(a).st.sec; ok([a, b, c].every((id) => W(id).st.sec === secv), "§3 use section colour on all three: " + secv);
    ok(!document.querySelector("#rwRight .rwchip") && /Different widgets/.test(document.getElementById("rwRight").textContent), "§3 different kinds of widgets: no style chips");
    ok(!document.querySelector(`#rmArea .s5w[data-w="${a}"] .s5cap`), "§3 Label hidden: no label on the canvas");
    // undo / redo all of it
    const done = JSON.stringify([a, b, c].map((id) => W(id).st)); let n = 0; while (undoS.length && JSON.stringify(W(a) && W(a).st) !== JSON.stringify({ pad: 4 }) && n < 12) { undo(); n++; await frames(1); }
    ok(n === 9 && W(a).st.pad === 4 && !(W(b).st || {}).pad, `§3 undo takes the inspector's changes back one by one (${n} steps)`);
    for (let i = 0; i < n; i++) redo(); await frames(1); ok(JSON.stringify([a, b, c].map((id) => W(id).st)) === done, "§3 redo puts them all back");
    // styles as chips for one kind
    document.querySelector('.rwt[data-add="song"]').dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await frames(1); const s2 = SL16R.selected()[0];
    SL16R.select([curScreen().land.find((w) => w.type === "song" && w.id !== s2).id, s2]); await frames(2);
    const chips = [...document.querySelectorAll("#rwRight .rwchip")]; ok(chips.length === 3 && chips.map((x) => x.querySelector(":scope > span").textContent).join() === "Big,Compact,Section colour" && chips[0].classList.contains("on"), "§3 style chips (two song widgets): " + chips.map((x) => x.querySelector(":scope > span").textContent).join());
    ok(chips.every((x) => x.querySelector(".rwnat .s5wi").textContent.trim()), "§3 each chip is a live miniature of the style");
    u = undoS.length; chips[2].click(); await frames(1); ok(SL16R.selected().every((id) => W(id).v === "sec") && undoS.length === u + 1, "§3 picking a style chip: both, one undo step");
    ok(document.querySelector(`#rmArea .s5w[data-w="${s2}"] .s5stripe`), "§3 Section colour: the stripe on the canvas");
  }

  // ================================================================ §4 every widget × every style × device: nothing overflows
  { const D = SLBand, sh = D.sampleShow(), st = D.sampleState(), song = sh.songs.s3, pos = song.secs[1].t0 + 5.3, bb = D.barBeatAt(song, pos), sec = D.sectionAt(song, pos), nsec = D.nextSection(song, pos);
    const env = (r, extra) => ({ show: sh, st, pos, song, bb, sec, nsec, r, now: new Date(2026, 10, 28, 22, 47).getTime(), connected: true, rtt: 12, statuses: [{ from: "Guitar tech", label: "Need 30 s" }, { from: "Drums", label: "Ready" }], myStatus: {}, checklist: {}, acks: {}, editor: true, ...extra });
    const devices = [["iPad landscape", 1024, 768 - 44, 12, 9, false], ["iPad portrait", 768, 1024 - 44, 12, 9, false], ["iPhone 390x844", 390, 844 - 81, 6, 14, true], ["iPhone SE 375x667", 375, 667 - 20, 6, 12, true]];
    const host = document.createElement("div"); host.className = "slw"; host.style.cssText = "position:fixed;left:0;top:0;width:1100px;height:800px;z-index:99999;visibility:hidden"; document.body.appendChild(host);
    const bad = [], skip = ".s5tint,.s5stripe,.s5flash,.s5holdbar,.s5why,svg,svg *";
    let count = 0;
    for (const [dname, aw, ah, cols, rows, phone] of devices) {
      const cw = aw / cols, ch = ah / rows;
      for (const type of Object.keys(D.WIDGETS)) {
        const [wc, hc] = phone ? D.phoneSize(type) : [D.WIDGETS[type].w, D.WIDGETS[type].h], bw = Math.round(wc * cw - 6), bh = Math.round(hc * ch - 6);
        for (const [v] of D.variantsOf(type)) for (const longName of [false, true]) {
          const w = { id: "t", type, v, cfg: type === "label" ? { text: "Watch the MD" } : type === "checklist" ? { items: ["Tuned", "Spare ready", "In-ears on"] } : {}, st: {} };
          const s2 = longName ? { ...st, next: { id: "s4", name: "The End of Heartache (Extended)", vname: "Acoustic" } } : st, sh2 = longName ? { ...sh, songs: { ...sh.songs, s3: { ...song, name: "The End of Heartache (Live)" } } } : sh;
          const box = document.createElement("div"); box.className = "s5wi"; box.setAttribute("style", D.boxStyle(w) + `;position:absolute;left:0;top:0;width:${bw}px;height:${bh}px`); host.appendChild(box);
          const out = D.render(w, env({ width: bw, height: bh }, { st: s2, show: sh2, song: sh2.songs.s3 })); box.innerHTML = out.html; box.classList.toggle("top", !!out.top); count++;
          const B0 = box.getBoundingClientRect(), why = [];
          box.querySelectorAll("*").forEach((el) => { if (el.matches(skip)) return; const r = el.getBoundingClientRect(); if (r.width < 0.5 || r.height < 0.5) return;
            if (r.left < B0.left - 1 || r.right > B0.right + 1 || r.top < B0.top - 1 || r.bottom > B0.bottom + 1) why.push(`${el.className || el.tagName} sticks out (${Math.round(r.left - B0.left)},${Math.round(r.top - B0.top)} ${Math.round(r.width)}×${Math.round(r.height)} in ${bw}×${bh})`);
            if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) why.push(`${el.className || el.tagName} cut off (${el.scrollWidth} > ${el.clientWidth}: “${el.textContent.slice(0, 24)}”)`); });
          if (why.length) bad.push(`${dname} ${type}/${v}${longName ? " (long names)" : ""}: ${why[0]}`);
          box.remove();
        }
      }
    }
    host.remove();
    ok(!bad.length, `§4 ${bad.length} of ${count} renders overflow: ${bad.slice(0, 8).join(" | ")}`);
    log.push(`${count} renders (every widget × style × 4 device sizes, normal and long names)`);
    // the old screens: no style = Big, their colours kept
    const old = { id: "o", type: "playStop", x: 0, y: 0, w: 3, h: 2, cfg: { col: "#bf5af2", label: "Play / Stop" } };
    ok(D.variantOf(old) === "big" && /background:#bf5af2/.test(D.render(old, env({ width: 200, height: 120 }, { st: { ...st, playing: false } })).html), "§4 a widget from before 16 is the Big style, with its own colour");
  }
  // the pictures (CI artifact, with --shots): the library with a preview open, and every widget in every style
  if (window.__shot) { try {
    setBand(true); await wait(150); if (!BAND.screens.length) { addScreen("Shots"); renderBand(); await wait(200); } SL16R.lib.show("song"); await wait(400); await window.__shot("16-library", R(document.getElementById("rwLeft")));
    SL16R.lib.hide(); const D = SLBand, sh = D.sampleShow(), st = D.sampleState(), song = sh.songs.s3, pos = song.secs[0].t0 + 3.2, all = [];
    for (const t of Object.keys(D.WIDGETS)) for (const [v, n] of D.variantsOf(t)) all.push([t, v, n]);
    for (let page = 0; page * 24 < all.length; page++) {
      const g = document.createElement("div"); g.className = "slw"; g.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0d0d0f;display:grid;grid-template-columns:repeat(4,300px);gap:22px 14px;padding:14px;align-content:start;color:#f2f2f4;font:11px sans-serif"; document.body.appendChild(g);
      for (const [t, v, n] of all.slice(page * 24, page * 24 + 24)) { const w = { id: "g", type: t, v, cfg: {}, st: {} }, c = document.createElement("div"); c.innerHTML = `<div style="color:#8e8e96">${D.WIDGETS[t].name} · ${n}</div>`; const b = document.createElement("div"); b.className = "s5wi"; b.setAttribute("style", D.boxStyle(w) + ";width:300px;height:100px;position:relative;margin-top:3px"); c.appendChild(b); g.appendChild(c);
        b.innerHTML = D.render(w, { show: sh, st, pos, song, bb: D.barBeatAt(song, pos), sec: D.sectionAt(song, pos), nsec: D.nextSection(song, pos), r: { width: 300, height: 100 }, now: Date.now(), editor: true, statuses: [{ from: "Drums", label: "Ready" }] }).html; }
      await frames(2); await window.__shot("16-styles-" + (page + 1)); g.remove(); }
  } catch (e) { P.push("the pictures: " + e); } }
  while (BAND.screens.length) BAND.screens.pop(); setBand(false); await wait(150);
  log.push(`${P.length ? P.length + " problems" : "all good"}`);
  return { problems: P, log };
}
