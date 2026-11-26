// 10a: runs inside the page (tests/ui-timeline.mjs in Chrome, tests/ui-webkit.mjs in WebKit). Pinch and ⌥ + wheel
// zoom (exponential, anchored, WebKit gesture events), the zoom glide (and Reduce animations), renaming a song from
// every place, every drag done with pointer events (a card onto the setlist, setlist songs and breaks, a selection
// as a group, track headers in one song and in Folders, an older HTML5 drag through the bridge), ⌥↑ / ⌥↓, MIDI
// tracks at the bottom. Returns { problems: [...], log: [...] }.
async function check10a() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const settle = async () => { await frames(1); await SL9.settled(); await frames(1); };
  const P = [], log = [], sc = document.getElementById("scroller");
  const ok = (c, m) => { if (!c) P.push(m); };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const S = (id) => songs.find((x) => x.id === id);
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);

  // ================================================================ zoom
  const g = S("glass"); openSong(g.id); await wait(300);
  const barDur = g.bars[1].t - g.bars[0].t;
  SL9.zoomTo(30 / barDur); await settle();
  sc.scrollLeft = 600; await frames(2);
  const LX = TL9.laneLeft(), px = LX + 300, py = sc.getBoundingClientRect().top + 260;
  const wheel = (o) => sc.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: px, clientY: py, ...o }));
  const tUnder = () => (px - LX + sc.scrollLeft) / PXS;
  // a pinch (Chrome / WebView2): 10 small ctrl + wheel steps, -10 each: exp(0.02 · 100) ≈ 7.4×
  { const z0 = PXS, t0 = tUnder(); for (let i = 0; i < 10; i++) { wheel({ deltaY: -10, ctrlKey: true }); await frames(1); } await settle();
    const want = z0 * Math.exp(0.02 * 100);
    log.push(`pinch (ctrl + wheel, 10 × −10): ${z0.toFixed(2)} → ${PXS.toFixed(2)} px/s (×${(PXS / z0).toFixed(2)})`);
    ok(PXS / z0 > 4 || near(PXS, 2000, 1), `a full pinch zooms ~4× or more (got ×${(PXS / z0).toFixed(2)}, wanted ×${(want / z0).toFixed(2)})`);
    ok(near(tUnder(), t0, 1.5 / PXS + 0.02), `pinch keeps the time under the pointer (${t0.toFixed(3)} → ${tUnder().toFixed(3)} s)`); }
  // ⌥ + wheel: the same exponential curve, back out
  { const z0 = PXS, t0 = tUnder(); for (let i = 0; i < 4; i++) { wheel({ deltaY: 100, altKey: true }); await frames(1); } await settle();
    ok(near(PXS / z0, Math.exp(-0.0025 * 400), 0.02), `⌥ + wheel is exponential (×${(PXS / z0).toFixed(3)} for 4 notches, wanted ×${Math.exp(-1).toFixed(3)})`);
    ok(near(tUnder(), t0, 1.5 / PXS + 0.02), "⌥ + wheel keeps the time under the pointer"); }
  // WebKit's own pinch: gesturestart / gesturechange with a scale relative to the start
  { const z0 = PXS, t0 = tUnder();
    const gev = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, "scale", { value: scale }); Object.defineProperty(e, "clientX", { value: px }); Object.defineProperty(e, "clientY", { value: py }); sc.dispatchEvent(e); return e.defaultPrevented; };
    const took = gev("gesturestart", 1); for (const k of [1.2, 1.5, 1.8, 2]) { gev("gesturechange", k); await frames(1); }
    wheel({ deltaY: -30, ctrlKey: true }); // WebKit can also send the same pinch as ctrl + wheel: ignored during a gesture
    gev("gestureend", 2); await settle();
    ok(took, "the gesture is taken (no page zoom)");
    ok(near(PXS / z0, 2, 0.02), `a WebKit pinch to scale 2 zooms 2× (×${(PXS / z0).toFixed(3)})`);
    ok(near(tUnder(), t0, 1.5 / PXS + 0.02), "a WebKit pinch keeps the time under the pointer"); }
  // the glide: + / − doesn't jump; it arrives in ~100–250 ms; more input mid-glide retargets
  { const z0 = PXS; SL9.zoomBy(2); await frames(1); const mid = PXS;
    ok(mid > z0 * 1.001 && mid < z0 * 2 * 0.999, `zoom glides (after one frame ${(mid / z0).toFixed(3)}× of 2×)`);
    const t0 = performance.now(); await SL9.settled();
    const took = performance.now() - t0;
    log.push(`glide to 2×: ${Math.round(took)} ms`);
    ok(near(PXS / z0, 2, 0.001), `the glide ends exactly at the target (×${(PXS / z0).toFixed(4)})`);
    ok(took < 400, `the glide takes ${Math.round(took)} ms (wanted about 120–250)`);
    SL9.zoomBy(1.5); await frames(2); SL9.zoomBy(1.5); await settle();
    ok(near(PXS / z0, 4.5, 0.01), `input mid-glide stacks on the target (×${(PXS / z0).toFixed(3)} of 4.5)`); }
  // Fit glides too, and lands on the whole song
  { SL9.zoomPreset(g, "song"); await frames(1); const w0 = g.len * PXS; await settle(); const w1 = g.len * PXS;
    ok(w0 > TL9.viewW() || Math.abs(w0 - w1) > 1, "Fit glides (not a jump)"); ok(w1 <= TL9.viewW() && sc.scrollLeft <= 1, `Fit lands on the whole song (${Math.round(w1)} of ${Math.round(TL9.viewW())} px, at ${sc.scrollLeft})`); }
  // Customize › Reduce animations: a jump
  { document.body.classList.add("calm"); const z0 = PXS; SL9.zoomBy(2); ok(near(PXS / z0, 2, 1e-3), "Reduce animations: the zoom jumps"); document.body.classList.remove("calm"); }
  // zoom frame times (the Diagnostics timing log)
  { const z = SL9.timings().filter((x) => x.what === "zoom frame").map((x) => x.ms).sort((a, b) => a - b);
    if (z.length) log.push(`zoom frames: ${z[Math.floor(z.length / 2)]} ms median, ${z[Math.floor(z.length * 0.9)]} p90 (${z.length})`); }

  // ================================================================ renaming a song
  const typeName = async (v, key = "Enter") => { await frames(2); const i = document.querySelector(".ren10"); if (!i) return false; i.value = v; i.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await frames(2); return true; };
  const click = (el, o = {}) => { const r = el.getBoundingClientRect(), x = r.left + Math.min(20, r.width / 2), y = r.top + r.height / 2;
    const p = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...o };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...p, pointerId: 1, buttons: 1 })); el.dispatchEvent(new MouseEvent("mousedown", p));
    el.dispatchEvent(new PointerEvent("pointerup", { ...p, pointerId: 1 })); el.dispatchEvent(new MouseEvent("mouseup", p)); el.dispatchEvent(new MouseEvent("click", { ...p, detail: o.detail || 1 })); };
  const dbl = async (sel) => { let el = document.querySelector(sel); if (!el) return false; click(el); await frames(2); el = document.querySelector(sel) || el; click(el, { detail: 2 }); el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 })); return true; };
  const renameVia = async (how, fn, id, v) => { const before = S(id).name; const went = await fn(); const typed = went !== false && await typeName(v); ok(typed && S(id).name === v, `rename from ${how}: “${before}” → “${S(id).name}” (wanted “${v}”)`); };
  closeSong(); SL9.setMode("cards"); await wait(150);
  await renameVia("a card (double-click)", () => dbl('.card9[data-id="low"] .c9h b'), "low", "Low Tide A");
  ok(!focusSong(), "double-clicking a card's name renames it (doesn't open the song)");
  await renameVia("↩ on a selected card", async () => { const c = document.querySelector('.card9[data-id="low"]'); c.focus(); c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); }, "low", "Low Tide B");
  await renameVia("a setlist row (double-click)", () => dbl('#songs .song[data-id="sat"] .t'), "sat", "Satellites A");
  await renameVia("right-click › Rename…", async () => { songMenu({ clientX: 300, clientY: 300 }, "copper", "list"); await frames(1); const it = [...document.querySelectorAll(".xm.ctx .it")].find((x) => /^Rename/.test(x.textContent)); if (!it) return false; it.click(); }, "copper", "Copper Sun A");
  await renameVia("Song › Rename song…", async () => { closeSong(); await frames(1); select("paper", false); SLMenus.run("m:renameSong"); }, "paper", "Paper Kings A");
  SL9.setMode("folders"); await wait(200);
  await renameVia("a Folders row (double-click)", () => dbl('.row9[data-row="neon"] .r9n'), "neon", "Neon Rivers A");
  SL9.setMode("cards"); await wait(150); openSong("glass"); await wait(250);
  await renameVia("the opened song's title (double-click)", () => dbl("#hero .htitle h2"), "glass", "Glasshouse A");
  ok(document.querySelector("#hero .htitle h2").textContent.includes("Glasshouse A"), "the title shows the new name");
  // Esc cancels, undo puts it back
  { await dbl("#hero .htitle h2"); await typeName("Nope", "Escape"); ok(S("glass").name === "Glasshouse A", "Esc cancels the rename"); }
  { undo(); await frames(2); ok(S("glass").name === "Glasshouse", `undo puts the old name back (${S("glass").name})`); }
  closeSong(); await wait(150);

  // ================================================================ drag and drop (pointer events)
  const drag = async (from, to, o = {}) => {
    const a = from.getBoundingClientRect(), x0 = o.x0 ?? a.left + Math.min(30, a.width / 2), y0 = o.y0 ?? a.top + a.height / 2;
    const [x1, y1] = to;
    const pe = (t, x, y, b) => (t === "pointerdown" ? from : document.elementFromPoint(x, y) || document).dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: b, pointerId: 7, altKey: !!o.alt }));
    pe("pointerdown", x0, y0, 1);
    for (let i = 1; i <= 8; i++) { pe("pointermove", x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8, 1); await frames(1); }
    const lineEl = document.querySelector(".line10"), line = lineEl && !lineEl.hidden ? lineEl.className : "";
    pe("pointerup", x1, y1, 0); await frames(2);
    return line;
  };
  const rowsY = (i) => { const r = [...document.querySelectorAll("#songs > .song, #songs > .brk9")]; const e = r[i]; if (!e) { const l = r[r.length - 1].getBoundingClientRect(); return [l.left + 40, l.bottom + 4]; } const b = e.getBoundingClientRect(); return [b.left + 40, b.top + 3]; };
  const order = () => SLDrag.items().map((x) => (x.kind === "song" ? x.id : "B:" + x.b.label)).join(",");
  // a card onto the setlist, between #1 and #2
  { const c = document.querySelector('.card9[data-id="paper"]'); const before = order(); const line = await drag(c, rowsY(1));
    ok(order() === before.split(",").slice(0, 1).concat("paper", before.split(",").slice(1)).join(","), `a card dropped between #1 and #2: ${order()}`);
    ok(/line10(?! blue)/.test(line), "an orange landing line while dragging over the setlist");
    undo(); await frames(2); ok(order() === before, "undo takes it out again"); }
  // a Folders row onto the end of the setlist
  { SL9.setMode("folders"); await wait(200); const h = document.querySelector('.row9[data-row="under"] .r9h'); const n = setOrder.length; await drag(h, rowsY(99));
    ok(setOrder[setOrder.length - 1] === "under" && setOrder.length === n + 1, `a Folders row dropped at the end: ${order()}`); SL9.setMode("cards"); await wait(150); }
  // reorder inside the setlist: #1 to below #3
  { const before = setOrder.slice(); const r = document.querySelector(`#songs .song[data-id="${before[0]}"]`); await drag(r, rowsY(3));
    ok(setOrder.join() === [before[1], before[2], before[0], ...before.slice(3)].join(), `a setlist song moved from #1 to #3: ${setOrder.join()}`); }
  // a break: add one, drag it to the top
  { SLBreaks.add("Tuning"); await frames(2); const b = document.querySelector("#songs .brk9"); const line = await drag(b, rowsY(0));
    ok(order().startsWith("B:Tuning,"), `a break dragged to the top: ${order()}`); ok(!!line, "a landing line for the break");
    // and a song dragged above it
    const last = setOrder[setOrder.length - 1]; await drag(document.querySelector(`#songs .song[data-id="${last}"]`), rowsY(0));
    ok(order().startsWith(last + ",B:Tuning,"), `a song dragged above the break: ${order()}`); }
  // a selection drags as a group
  { SL9.select(true); await frames(1); songSel.clear(); songSel.add(setOrder[2]); songSel.add(setOrder[3]); const ids = [setOrder[2], setOrder[3]];
    await drag(document.querySelector(`#songs .song[data-id="${ids[0]}"]`), rowsY(0));
    ok(setOrder.slice(0, 2).join() === ids.join(), `two selected songs dragged to the top together: ${order()}`); SL9.select(false); await frames(1); }
  // ⌥↓ / ⌥↑ on the selected setlist song
  { const id = setOrder[0]; select(id, false); document.querySelector(`#songs .song[data-id="${id}"]`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, buttons: 0, clientX: 1, clientY: 1 }));
    const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, altKey: true, bubbles: true, cancelable: true }));
    key("ArrowDown"); await frames(2); ok(setOrder[1] === id, `⌥↓ moves the selected song down (${setOrder.join()})`);
    key("ArrowUp"); await frames(2); ok(setOrder[0] === id, "⌥↑ moves it back up"); }
  // the band screens, Perform and the backup rig read setOrder: the new order is what they get
  ok(curSetObj().order === setOrder, "the setlist's own order is the one changed (band screens, Perform and the rig read it)");

  // tracks: drag a header (one song open), blue line; then in Folders
  { openSong("glass"); await wait(250); const s = S("glass"), before = s.tracks.slice();
    const lh = (t) => document.querySelector(`.row.trk > .lh[data-track="${CSS.escape(t)}"]`);
    const target = lh("Drums").getBoundingClientRect(); const line = await drag(lh("Strings"), [target.left + 60, target.top + 3], { x0: lh("Strings").getBoundingClientRect().left + 70 });
    ok(s.tracks.indexOf("Strings") === s.tracks.indexOf("Drums") - 1, `a track dragged above Drums: ${s.tracks.join(", ")}`);
    ok(/blue/.test(line), "a blue landing line for tracks");
    // MIDI tracks move too
    const t2 = lh("Bass").getBoundingClientRect(); await drag(lh("Lights"), [t2.left + 60, t2.top + 3], { x0: lh("Lights").getBoundingClientRect().left + 70 });
    ok(s.tracks.indexOf("Lights") === s.tracks.indexOf("Bass") - 1, `a MIDI track dragged above Bass: ${s.tracks.join(", ")}`);
    // ⌥↓ on the selected track
    openTrack(s, "Lights"); lh("Lights").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, buttons: 0, clientX: 1, clientY: 1 })); const i0 = s.tracks.indexOf("Lights");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true })); await frames(2);
    ok(s.tracks.indexOf("Lights") === i0 + 1, `⌥↓ moves the selected track down (${s.tracks.join(", ")})`);
    undo(); undo(); undo(); await frames(2); ok(S("glass").tracks.join() === before.join(), `undo puts the tracks back (${S("glass").tracks.join(", ")})`); closeSong(); await wait(150); }
  { SL9.setMode("folders"); await wait(200); SL9.toggleRow("low", true); await wait(200); const s = S("low");
    const lh = (t) => document.querySelector(`.row9[data-row="low"] .row.trk > .lh[data-track="${CSS.escape(t)}"]`);
    const t = lh("Click").getBoundingClientRect(); await drag(lh("Pads"), [t.left + 60, t.top + 3], { x0: lh("Pads").getBoundingClientRect().left + 70 });
    ok(s.tracks[0] === "Pads", `a track dragged to the top in Folders: ${s.tracks.join(", ")}`); SL9.setMode("cards"); await wait(150); }

  // an older HTML5 drag (presets, scenes, band widgets, version sections) goes through the same pointer drag
  { const a = document.createElement("div"), b = document.createElement("div"); a.dataset.drag10 = ""; a.textContent = "Scene A";
    Object.assign(a.style, { position: "fixed", left: "400px", top: "300px", width: "80px", height: "30px", zIndex: 99999, background: "#333" });
    Object.assign(b.style, { position: "fixed", left: "700px", top: "500px", width: "120px", height: "60px", zIndex: 99999, background: "#555" });
    document.body.append(a, b); let got = "", ended = false, x = 0;
    a.ondragstart = (e) => { e.dataTransfer.setData("text/sl-scene", "2"); }; a.ondragend = () => { ended = true; };
    b.ondragover = (e) => { if ([...e.dataTransfer.types].includes("text/sl-scene")) e.preventDefault(); };
    b.ondrop = (e) => { got = e.dataTransfer.getData("text/sl-scene"); x = e.clientX; };
    await drag(a, [760, 530]); a.remove(); b.remove();
    ok(got === "2" && ended && near(x, 760, 1), `an HTML5-style drag via pointer events delivers its data (${got}, ${x})`); }
  ok(!document.querySelector('[draggable="true"]'), "no HTML5 draggable elements left (" + [...document.querySelectorAll('[draggable="true"]')].map((e) => e.className).join(", ") + ")");

  // ================================================================ MIDI tracks at the bottom
  { const s = S("glass"), before = s.tracks.slice(); select("glass", false);
    ok(before.indexOf("Intro pad ◆") > before.indexOf("Lights"), "test song: an audio track under the MIDI ones");
    const n = SL10a.sortMidi(["glass"]); await frames(1);
    const firstMidi = s.tracks.findIndex((t) => SL10a.isMidi(s, t));
    ok(n === 1 && s.tracks.slice(firstMidi).every((t) => SL10a.isMidi(s, t)), `Sort tracks › MIDI to the bottom: ${s.tracks.join(", ")}`);
    ok(s.tracks.filter((t) => !SL10a.isMidi(s, t)).join() === before.filter((t) => !SL10a.isMidi(s, t)).join(), "the other tracks keep their order");
    undo(); await frames(1); ok(S("glass").tracks.join() === before.join(), "undo puts the MIDI tracks back");
    // several songs at once
    const m = S("neon"); m.tracks.splice(3, 0, m.tracks.splice(m.tracks.indexOf("Lights"), 1)[0]);
    ok(SL10a.sortMidi(["glass", "neon"]) === 2, "sorting a selection of songs");
    // a new click track goes above the MIDI tracks; a new MIDI track at the bottom
    addTrack(S("low"), "click"); const l = S("low").tracks; ok(l.indexOf("Click (2)") < l.indexOf("Guitar rig"), `a new click track goes above the MIDI tracks: ${l.join(", ")}`);
    newMidiTrack("low"); await frames(1); ok(SL10a.isMidi(S("low"), l[l.length - 1]), "a new MIDI track goes at the bottom");
    if (typeof closeTpop === "function") closeTpop(); }
  // the Song menu has both
  { const sm = SLMenus.spec().menus.find((x) => x.name === "Song").items.map((x) => x.label); ok(sm.includes("Rename song…") && sm.some((x) => /MIDI to the bottom/.test(x || "")), "Song menu: " + sm.filter(Boolean).join(" · ")); }
  return { problems: P, log };
}
