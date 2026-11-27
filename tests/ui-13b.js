// 13 B: runs inside the page (Chrome and WebKit at 1280x800). Editing like a DAW:
// §3 audio clips (select, move snapped / ⌘ free, to another audio track, ⌥-drag copy, trim, gain line, rename,
//    ⌘E split) and MIDI clips (⌥-drag copy, to another MIDI track, rename, double-click opens the editor)
// §4 ⌫ / Delete on every selectable type: select, ⌫, gone, ⌘Z back
// §5 / §6 the patch change editor: opens from the lane, rows, a scene tile dragged onto the lane (the orange line),
//    selection details in the header, ⌫, its own zoom
// §7 a song's editor closes with the song and comes back as it was
async function check13b() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], ok = (c, m) => { if (!c) P.push(m); };
  const sc = document.getElementById("scroller"), R = (el) => el.getBoundingClientRect(), S = (id) => songs.find((x) => x.id === id);
  const MAC = /Mac/.test(navigator.platform), cmdO = MAC ? { metaKey: true } : { ctrlKey: true };
  const ptr = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 7, isPrimary: true, ...o }));
  const click = (el, x, y, o = {}) => { ptr(el, "pointerdown", x, y, o); ptr(el, "pointerup", x, y, o); el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1, ...o })); };
  const drag = async (el, x0, y0, x1, y1, o = {}) => { ptr(el, "pointerdown", x0, y0, o); for (let k = 1; k <= 6; k++) ptr(el, "pointermove", x0 + (x1 - x0) * k / 6, y0 + (y1 - y0) * k / 6, o); await frames(1); ptr(el, "pointerup", x1, y1, { ...o, buttons: 0 }); await frames(2); };
  const dbl = (el, x, y) => el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 2 }));
  const key = (k, o = {}, t = document.body) => t.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));
  const laneOf = (s, t) => [...document.querySelectorAll(`canvas[data-song="${s.id}"][data-t]`)].find((c) => s.tracks[+c.dataset.t] === t);
  const sx = (cv, songX) => TX.screenX(cv, songX - (+cv.dataset.vx || 0)); // a lane's song pixel on screen
  const undoTo = async (n) => { let g = 0; while (undoS.length > n && g++ < 20) { undo(); await frames(1); } await frames(1); };
  const typeIn = async (txt) => { const ed = SL10a.editing(); if (!ed) return false; if ("value" in ed.el) ed.el.value = txt; else ed.el.textContent = txt; key("Enter", {}, ed.el); await frames(2); return true; };
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);

  // ================================================================ §3 audio clips
  try { const s = S("neon"); openSong(s.id); await wait(300); SL9.zoomNow(TL9.viewW() / 60); await frames(2); sc.scrollLeft = 0; await frames(3);
    const aud = s.tracks.filter((t) => isAudio(s, t)); const [t1, t2] = aud; log.push(`audio tracks: ${aud.join(", ")}`);
    snap(); s.clips = s.clips || {}; s.clips[t1] = [{ id: clipSeq++, start: s.bars[2].t, end: s.bars[6].t, off: s.bars[2].t, gain: 0, fi: 0, fo: 0, mute: false }]; s.clips[t2] = [{ id: clipSeq++, start: s.bars[12].t, end: s.bars[14].t, off: 0, gain: 0, fi: 0, fo: 0, mute: false }];
    s.files = s.files || {}; s.files[t1] = { path: "/x/" + t1 + ".wav", len: 300 }; s.files[t2] = { path: "/x/" + t2 + ".wav", len: 300 }; refresh(); await frames(3); const base = undoS.length;
    let cv = laneOf(s, t1), r = R(cv); const cl = () => clipsOf(S("neon"), t1)[0], mid = (c) => sx(cv, (c.start + c.end) / 2 * PXS), y = r.top + r.height * 0.75;
    click(cv, mid(cl()), y); await frames(2); ok(selClip && selClip.id === cl().id, "a click selects the audio clip");
    // move (snapped to the grid: the bar at this zoom), then ⌘ free
    const st0 = cl().start; await drag(cv, mid(cl()), y, mid(cl()) + (s.bars[1].t - s.bars[0].t) * PXS * 1.1, y); ok(Math.abs(cl().start - (st0 + (s.bars[1].t - s.bars[0].t))) < 1e-3, `dragging moves it, snapped to the bar (${cl().start.toFixed(3)})`);
    const st1 = cl().start; await drag(cv, mid(cl()), y, mid(cl()) + 7, y, cmdO); ok(Math.abs(cl().start - st1 - 7 / PXS) < 2 / PXS, "⌘-drag places it freely"); await undoTo(base);
    // ⌥-drag copies (the original stays)
    cv = laneOf(S("neon"), t1); r = R(cv); const n0 = clipsOf(S("neon"), t1).length, c0 = cl().start;
    await drag(cv, mid(cl()), y, mid(cl()) + (cl().end - cl().start) * PXS + 20, y, { altKey: true }); ok(clipsOf(S("neon"), t1).length === n0 + 1 && clipsOf(S("neon"), t1).some((c) => Math.abs(c.start - c0) < 1e-6), "⌥-drag copies the clip (the original stays)"); await undoTo(base);
    // trim: the left edge (non-destructive: the offset follows)
    cv = laneOf(S("neon"), t1); r = R(cv); { const c = { ...cl() }, o0 = c.off, x0 = sx(cv, c.start * PXS) + 3; await drag(cv, x0, y, x0 + (s.bars[1].t - s.bars[0].t) * PXS, y); const c2 = cl(); ok(c2.start > c.start - 1e-6 && Math.abs(c2.off - o0 - (c2.start - c.start)) < 1e-6, `trimming the start keeps the audio in place (start ${c.start.toFixed(2)}→${c2.start.toFixed(2)}, off ${o0.toFixed(2)}→${c2.off.toFixed(2)})`); await undoTo(base); }
    // the gain line: drag it down
    cv = laneOf(S("neon"), t1); r = R(cv); click(cv, mid(cl()), y); await frames(2); cv = laneOf(S("neon"), t1); r = R(cv); { const H = cv.height, gy = r.top + clipGainY(cl(), H) * (r.height / (cv.offsetHeight || H)); await drag(cv, mid(cl()), gy, mid(cl()), gy + 18); ok(cl().gain < -1, `dragging the clip's level line sets its gain (${cl().gain} dB)`); await undoTo(base); }
    // rename: double-click its name strip
    cv = laneOf(S("neon"), t1); r = R(cv); { dbl(cv, mid(cl()), r.top + 9); await frames(2); ok(await typeIn("Big intro"), "double-clicking a clip's name edits it in place"); ok(cl().name === "Big intro", "…and renames the clip: " + cl().name); await undoTo(base); }
    // to another audio track (dropped on its lane): it keeps its own audio file
    cv = laneOf(S("neon"), t1); r = R(cv); { const cv2 = laneOf(S("neon"), t2), r2 = R(cv2), id = cl().id; await drag(cv, mid(cl()), y, mid(cl()), r2.top + r2.height * 0.6);
      const moved = clipsOf(S("neon"), t2).find((c) => c.id === id); ok(!!moved && !clipsOf(S("neon"), t1).some((c) => c.id === id), "dragging a clip onto another audio track moves it there");
      ok(moved && moved.file && moved.file.path === "/x/" + t1 + ".wav", "…and it plays its own file there"); await undoTo(base); }
    // ⌘E splits at the insert line
    cv = laneOf(S("neon"), t1); r = R(cv); { const c = cl(), xm = mid(c); click(cv, xm, y); await frames(1); const n1 = clipsOf(S("neon"), t1).length; SL12.split(); await frames(1); ok(clipsOf(S("neon"), t1).length === n1 + 1, "⌘E splits the selected clip at the insert line"); await undoTo(base); }
    // ⌫ deletes it, ⌘Z brings it back
    cv = laneOf(S("neon"), t1); r = R(cv); { const n1 = clipsOf(S("neon"), t1).length; click(cv, mid(cl()), y); await frames(2); key("Backspace"); await frames(2); ok(clipsOf(S("neon"), t1).length === n1 - 1 && S("neon"), "⌫ deletes the selected clip"); await undoTo(base); ok(clipsOf(S("neon"), t1).length === n1, "⌘Z brings it back"); }
    await undoTo(base); closeSong(); await wait(150); } catch (e) { P.push("§3 audio crashed: " + e.message + " " + String(e.stack).split(String.fromCharCode(10))[1]); try { PE13.close(); closeSong(); } catch (x) {} await wait(150); }

  // ================================================================ §3 MIDI clips
  try { const s = S("glass"); openSong(s.id); await wait(300); SL9.zoomNow(TL9.viewW() / 40); await frames(2); sc.scrollLeft = 0; await frames(2);
    snap(); addTrack(s, "midi"); addTrack(S("glass"), "midi"); await frames(2); const so = S("glass"), mt = so.tracks.filter((t) => isMidiTrack(so, t) && !MODUI.dev(so, t)); const [m1, m2] = mt.slice(-2);
    const L = regsOf(so, m1); L.splice(0, L.length, { id: "r" + regSeq++, bar: 3, bars: 4 }); (so.midi[m1] || (so.midi[m1] = curAlt(so, m1).events)).push({ kind: "pc", pc: 5, bar: 3, beat: 1, id: evId++ }); refresh(); await frames(3); const base = undoS.length;
    { const l2 = laneOf(S("glass"), m2); if (l2) { l2.scrollIntoView({ block: "end" }); await frames(3); } } // both MIDI lanes on screen
    let cv = laneOf(S("glass"), m1), r = R(cv); const y = r.top + r.height * 0.6, xr = (q) => sx(cv, (S("glass").bars[q.bar - 1].t + S("glass").bars[q.bar + 1].t) / 2 * PXS);
    const reg = () => regsOf(S("glass"), m1)[0];
    click(cv, xr(reg()), y); await frames(2); ok(pick && pick.kind === "mreg", "a click selects the MIDI clip");
    await drag(cv, xr(reg()), y, xr(reg()) + (S("glass").bars[9].t - S("glass").bars[3].t) * PXS, y, { altKey: true }); ok(regsOf(S("glass"), m1).length === 2 && regsOf(S("glass"), m1).some((q) => q.bar === 3), `⌥-drag copies a MIDI clip (${regsOf(S("glass"), m1).map((q) => q.bar).join(",")})`);
    ok((S("glass").midi[m1] || []).filter((e) => e.kind === "pc").length === 2, "…with its events"); await undoTo(base);
    cv = laneOf(S("glass"), m1); r = R(cv); { const cv2 = laneOf(S("glass"), m2), r2 = R(cv2); await drag(cv, xr(reg()), y, xr(reg()), r2.top + r2.height * 0.6);
      ok(regsOf(S("glass"), m2).length === 1 && !regsOf(S("glass"), m1).length && (S("glass").midi[m2] || []).some((e) => e.pc === 5), "dragging a MIDI clip onto another MIDI track moves it and its events"); await undoTo(base); }
    cv = laneOf(S("glass"), m1); r = R(cv); { dbl(cv, xr(reg()), r.top + 9); await frames(2); ok(await typeIn("Pads"), "double-clicking a MIDI clip's name edits it"); ok(reg().name === "Pads", "…renamed"); await undoTo(base); }
    cv = laneOf(S("glass"), m1); r = R(cv); dbl(cv, xr(reg()), y); await wait(200); ok(PE13.editing() && PE13.editing().track === m1, "double-clicking a MIDI clip opens its editor at the bottom"); ok(document.getElementById("pe13") && !document.getElementById("clk10"), "…in the one bottom panel");
    PE13.close(); await undoTo(base); closeSong(); await wait(150); } catch (e) { P.push("§3 MIDI crashed: " + e.message + " " + String(e.stack).split(String.fromCharCode(10))[1]); try { PE13.close(); closeSong(); } catch (x) {} await wait(150); }

  // ================================================================ §6 the patch change editor
  try { const s = S("glass"); openSong(s.id); await wait(300); SL9.zoomNow(TL9.viewW() / s.len); await frames(2); sc.scrollLeft = 0; await frames(2);
    snap(); addTrack(s, "midi"); await frames(2); const so = S("glass"), t = so.tracks.filter((x) => isMidiTrack(so, x)).pop(); so.midiCfg[t].dev = "qc"; MODUI.norm(so, t); refresh(); await frames(2);
    const M = SLMod, Pz = (e) => evTime(so, e), AT = (x) => { const p = cueAt(so, x); return { bar: p.bar, beat: +p.beat }; };
    MODUI.setEvents(so, t, M.dropPreset("qc", MODUI.evsOf(so, t), 17, 0, 0, Pz, AT, "pp1")); refresh(); await frames(2);
    const lane = laneOf(S("glass"), t), lr = R(lane); dbl(lane, lr.left + 40, lr.top + lr.height / 2); await wait(300);
    ok(PE13.editing() && PE13.editing().track === t, "double-clicking a modeler track opens the patch change editor");
    ok(PE13.rows().map((r) => r.k).join() === "preset,scene,fs,other", "rows: Preset, Scene, Footswitch, Other MIDI (" + PE13.rows().map((r) => r.k).join() + ")");
    const G = PE13.geo(), cv = G.cv, r = R(cv), row = (k) => PE13.rows().find((q) => q.k === k), yS = r.top + row("scene").y + row("scene").h / 2, xb = (bar) => TX.screenX(cv, TX.x(S("glass").bars[bar - 1].t, G.v));
    // drag tile C onto bar 9
    const tile = document.querySelector('#pe13 .pe13tile[data-k="2"]'), tr = R(tile); ptr(tile, "pointerdown", tr.left + 10, tr.top + 10); for (let k = 1; k <= 6; k++) document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: tr.left + 10 + (xb(9) + 1 - tr.left - 10) * k / 6, clientY: tr.top + 10 + (yS - tr.top - 10) * k / 6, buttons: 1 }));
    await frames(1); const landing = document.querySelector("#pe13") && true; document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: xb(9) + 1, clientY: yS })); await frames(2);
    const scn = MODUI.evsOf(S("glass"), t).filter((e) => e.mod === "scene"); ok(scn.length === 1 && scn[0].scene === 2 && scn[0].bar === 9, `a scene tile dragged onto the lane lands on the nearest bar (${scn.map((e) => e.bar + ":" + e.scene).join(",")})`);
    // select it: the details in the header line
    click(cv, xb(9) + 12, yS); await frames(2); const d = document.getElementById("pe13d").textContent; ok(/Scene C/.test(d) && /CC 43 = 2/.test(d) && /ch 1/.test(d), "the selected change's details are in the header: " + d);
    document.getElementById("pe13").focus(); key("Backspace", {}, document.getElementById("pe13")); await frames(2); ok(!MODUI.evsOf(S("glass"), t).some((e) => e.mod === "scene"), "⌫ deletes the selected scene change"); undo(); await frames(2);
    ok(MODUI.evsOf(S("glass"), t).some((e) => e.mod === "scene"), "⌘Z brings it back");
    // its own zoom: the timeline zooming doesn't move it
    const v0 = { ...TX.view("patch") }; SL9.zoomNow(PXS * 1.5); await frames(2); ok(TX.view("patch").pxs === v0.pxs, "the patch editor has its own zoom");
    ED13.zoomAt("patch", 2, 100); await frames(1); ok(Math.abs(TX.view("patch").pxs - v0.pxs * 2) < 1e-6, "…and zooms by itself");
    // §7: closing the song closes it; opening the song brings it back as it was
    const v1 = { ...TX.view("patch") }; closeSong(); await wait(400); ok(!document.getElementById("pe13"), "§7 closing the song closes its editor");
    openSong(S("glass").id); await wait(500); ok(PE13.editing() && PE13.editing().track === t, "§7 opening the song again brings its editor back");
    ok(Math.abs(TX.view("patch").pxs - v1.pxs) < 1e-6 && Math.abs(TX.view("patch").hx - v1.hx) < 1e-6, "…at the same zoom and scroll");
    document.querySelector('.tabs a[data-tab="perform"]').click(); await wait(400); ok(!document.getElementById("pe13"), "§7 switching to Perform closes it"); document.querySelector('.tabs a[data-tab="show"]').click(); await wait(500);
    PE13.close(); ED13.forget(S("glass").id); undo(); undo(); await frames(2); closeSong(); await wait(150); } catch (e) { P.push("§6/§7 crashed: " + e.message + " " + String(e.stack).split(String.fromCharCode(10))[1]); try { PE13.close(); closeSong(); } catch (x) {} await wait(150); }

  // ================================================================ §4 ⌫ / Delete on everything selectable
  const del = async (name, sel, count, how = "Backspace", target, okAsk) => { const n0 = count(); if (!(await sel())) { P.push(name + ": couldn't select it"); return; } await frames(2); key(how, {}, target ? target() : document.body); await frames(3);
    if (okAsk) { const b = document.querySelector(".cfbg [data-a=ok]"); ok(!!b, name + ": used in a setlist, so it asks first"); if (b) b.click(); await frames(2); }
    const n1 = count(); ok(n1 === n0 - 1, `⌫ ${name}: ${n0} → ${n1} (last ${JSON.stringify(SL12.last())}, sel ${selId}, from ${typeof songSelFrom !== "undefined" ? songSelFrom : ""}, dialog ${!!document.querySelector(".cfbg")}, focus ${document.activeElement.tagName}.${document.activeElement.className})`); document.querySelectorAll(".cfbg").forEach((x) => x.remove()); undo(); await frames(3); ok(count() === n0, `⌘Z brings back ${name}`); };
  { const s = S("neon"); openSong(s.id); await wait(300); SL9.zoomNow(TL9.viewW() / 80); await frames(2); sc.scrollLeft = 0; await frames(2);
    await del("a track", async () => { const lh = document.querySelector(`.row.trk > .lh[data-song="neon"][data-track="${S("neon").tracks[2]}"] .tn`), r = R(lh); click(lh, r.left + 3, r.top + 4); return true; }, () => S("neon").tracks.length);
    await del("a section", async () => { const e = document.querySelector('.secs .lane[data-song="neon"] .sec'), r = R(e); ptr(e, "pointerdown", r.left + r.width / 2, r.top + 5); ptr(e, "pointerup", r.left + r.width / 2, r.top + 5); e.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; }, () => S("neon").secs.length, "Delete");
    { snap(); S("neon").marks = [{ name: "HIT", bar: 3, beat: 1 }, { name: "OUT", bar: 9, beat: 1 }]; refresh(); await frames(3);
      await del("a marker", async () => { const u = document.querySelector('.folder[data-id="neon"] .mkr[data-i="1"] u'); if (!u) return false; const r = R(u); ptr(u, "pointerdown", r.left + 2, r.top + 2); ptr(u, "pointerup", r.left + 2, r.top + 2); return true; }, () => (S("neon").marks || []).length); undo(); await frames(2); }
    { snap(); S("neon").tmap.push({ bar: 9, bpm: 140 }); buildBars(S("neon")); refresh(); await frames(3);
      await del("a tempo point", async () => { const i = S("neon").tmap.findIndex((x) => x.bar === 9), p = document.querySelector(`.folder[data-id="neon"] .tempo .tp[data-i="${i}"]`); if (!p) return false; const r = R(p); ptr(p, "pointerdown", r.left + r.width / 2, r.top + r.height / 2); ptr(p, "pointerup", r.left + r.width / 2, r.top + r.height / 2); p.dispatchEvent(new MouseEvent("click", { bubbles: true })); await frames(1); return true; }, () => S("neon").tmap.filter((x) => x.bpm).length);
      const b1 = S("neon").tmap.filter((x) => x.bpm).length; { const p = document.querySelector('.folder[data-id="neon"] .tempo .tp[data-i="0"]'); if (p) { const r = R(p); ptr(p, "pointerdown", r.left + 3, r.top + 3); ptr(p, "pointerup", r.left + 3, r.top + 3); p.dispatchEvent(new MouseEvent("click", { bubbles: true })); await frames(1); key("Backspace"); await frames(2); } ok(S("neon").tmap.filter((x) => x.bpm).length === b1 && S("neon").tmap.some((x) => x.bar === 1), "bar 1's tempo can't be deleted"); }
      undo(); await frames(2); }
    { snap(); S("neon").tmap.push({ bar: 5, sig: [3, 4] }); buildBars(S("neon")); refresh(); await frames(3);
      await del("a time signature", async () => { const b = document.querySelector('.folder[data-id="neon"] .msig9[data-bar="5"]'); if (!b) return false; const r = R(b); ptr(b, "pointerdown", r.left + 3, r.top + 3); ptr(b, "pointerup", r.left + 3, r.top + 3); b.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); await frames(1); return true; }, () => S("neon").tmap.filter((x) => x.sig).length);
      undo(); await frames(2); }
    { const sn = S("neon"), ct = sn.tracks.find((t) => ROLE[t] === "cues"); if (ct) { snap(); sn.cues = [{ id: "cx1", bar: 4, beat: 1, text: "Verse" }]; refresh(); await frames(3); const cv = laneOf(S("neon"), ct);
      await del("a cue", async () => { if (!cv) return false; const r = R(cv), x = sx(cv, cueT(S("neon"), S("neon").cues[0]) * PXS) + 6; click(cv, x, r.top + r.height / 2); await frames(1); return !!pick; }, () => (S("neon").cues || []).length); undo(); await frames(2); } else log.push("(no Cues track on Neon Rivers)"); }
    closeSong(); await wait(200); }
  // the setlist: a row (removed from the setlist), a break, a library song (deleted, with undo), a version, a setlist
  await del("a setlist row (out of the setlist)", async () => { const row = document.querySelector("#songs .song[data-id]"); if (!row) return false; const r = R(row); click(row, r.left + 30, r.top + r.height / 2); return true; }, () => setOrder.length);
  { if (window.SLBreaks) { const b0 = SLBreaks.list().length; SLBreaks.add("Talk"); await frames(3);
      await del("a break", async () => { const b = document.querySelector("#songs .brk9[data-b]"); if (!b) return false; const r = R(b); click(b, r.left + 30, r.top + r.height / 2); return true; }, () => SLBreaks.list().length); undo(); await frames(2); ok(SLBreaks.list().length === b0, "(tidy)"); } }
  await del("a library song", async () => { SL9.setMode("cards"); await wait(150); const c = document.querySelector(".card9[data-id]"); if (!c) return false; const r = R(c); click(c, r.left + 40, r.top + 20); return true; }, () => songs.length);
  { const g = S("glass"); openSong(g.id); await wait(300);
    snap(); newVer(S("glass")); refresh(); await frames(3);
    await del("a version", async () => { const v = [...document.querySelectorAll(`.vstrip .vr[data-v]`)].pop(); if (!v) return false; const r = R(v); click(v, r.left + 10, r.top + r.height / 2); return true; }, () => versOf(S("glass")).length, "Backspace", null, true); undo(); await frames(2);
    closeSong(); await wait(150); }
  log.push("§4 types checked: track, clip, section, marker, tempo, time signature, cue, setlist row, break, library song, version, note (12), scene / preset (above)");
  return { problems: P, log };
}
