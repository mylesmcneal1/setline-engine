// 9e: runs inside the page (tests/ui-timeline.mjs). Scrolls down 3 screens and sideways 50 bars, zooms in and out at
// the pointer, and checks after each step that every layer of the timeline agrees: the ruler, the time signature,
// tempo and sections rows and every lane share one origin (so the same bar is under the same x, ±1 px), the lane
// pictures cover what's on screen, the headers' left edge never moves, there's no dead column, and the pinned rows
// stay at the top. MODE: "song" (one song open) or "folders" (two songs open as rows).
// Returns { problems: [...], log: [...] }.
async function timelineCheck(MODE) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], sc = document.getElementById("scroller");
  const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
  const settle = async () => { await frames(1); await SL9.settled(); await frames(1); }; // 10a: zoom glides
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  const S = SLPage.songs, A = S.find((x) => x.name === "Glasshouse"), B = S.find((x) => x !== A && x.tracks.length >= 3);
  // tall tracks so there are 3 screens to scroll down; ~40 px a bar so there are 50 bars to scroll sideways
  A.trkH = 170; if (B) B.trkH = 170;
  const barDur = A.bars[1].t - A.bars[0].t;
  if (MODE === "song") { SL9.setMode("cards"); await wait(150); openSong(A.id); }
  else { if (focusSong()) closeSong(); SL9.setMode("folders"); await wait(150); SL9.state.oneOpen = false; SL9.toggleRow(A.id, true); SL9.toggleRow(B.id, true); }
  await wait(300);
  SL9.zoomTo(40 / barDur); await settle();
  const heads0 = () => [...sc.querySelectorAll(".fbody .row .lh")].filter((x) => x.getBoundingClientRect().height > 0);
  const headLeft = heads0()[0].getBoundingClientRect().left;
  const NATIVE = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");

  function checkAll(label) {
    const bad = (m) => P.push(`${label}: ${m}`);
    const scr = sc.getBoundingClientRect(), HX = sc.scrollLeft;
    if (NATIVE.get.call(sc) !== 0) bad(`the scroller itself scrolled sideways (${NATIVE.get.call(sc)})`);
    const heads = heads0(); const laneL = heads[0].getBoundingClientRect().right;
    for (const h of heads) { const r = h.getBoundingClientRect(); if (!near(r.left, headLeft, 0.5)) { bad(`a header's left edge moved: ${r.left} vs ${headLeft}`); break; } }
    for (const f of sc.querySelectorAll(".folder")) {
      const s = S.find((x) => x.id === f.dataset.id); if (!s || !f.querySelector(".fbody .row")) continue;
      const lanes = [...f.querySelectorAll(".fbody .row > .lane")], O = f.querySelector(".ruler .lane").getBoundingClientRect().left;
      // one origin for every row of the song, and the same sideways position as everything else
      if (!near(O + HX, laneL)) bad(`${s.name}: the lanes don't start right after the headers (origin ${O} + ${HX} vs ${laneL}): a dead column or a drift`);
      for (const l of lanes) { const x = l.getBoundingClientRect().left; if (!near(x, O)) { bad(`${s.name}: a ${l.parentElement.className} lane is ${x - O} px off the ruler`); break; } }
      // the bars: ruler numbers, time signature badges, sections, tempo points at the x of their time
      const xOf = (bar) => O + s.bars[bar - 1].t * PXS;
      for (const sp of f.querySelectorAll(".ruler .lane > span")) { const b = +sp.textContent; if (b && !near(sp.getBoundingClientRect().left, xOf(b))) { bad(`${s.name}: ruler bar ${b} at ${sp.getBoundingClientRect().left}, expected ${xOf(b)}`); break; } }
      for (const m of f.querySelectorAll(".meter9 .msig9")) if (!near(m.getBoundingClientRect().left, xOf(+m.dataset.bar))) { bad(`${s.name}: time signature at bar ${m.dataset.bar} is off`); break; }
      for (const e of f.querySelectorAll(".secs .sec[data-sid]")) { const p = s.secPos.find((q) => String(q.id) === e.dataset.sid); if (p && !near(e.getBoundingClientRect().left, xOf(p.start) + 1)) { bad(`${s.name}: section ${p.name} is off by ${e.getBoundingClientRect().left - xOf(p.start) - 1}`); break; } }
      // the lane pictures: at their own offset in lane coordinates, covering the visible part of the lane
      const viewR = Math.min(laneL + TL9.viewW(), O + (+f.querySelector("canvas.rcv").dataset.w || 0));
      for (const cv of f.querySelectorAll("canvas[data-t], canvas.rcv")) {
        const r = cv.getBoundingClientRect(); if (r.bottom < scr.top || r.top > scr.bottom) continue;
        if (!near(r.left, O + (+cv.dataset.vx || 0))) { bad(`${s.name}: lane picture ${cv.dataset.t || "ruler"} is at ${r.left}, expected ${O + (+cv.dataset.vx || 0)}`); break; }
        if (r.left > laneL + 1 || r.right < viewR - 1) { bad(`${s.name}: lane picture ${cv.dataset.t || "ruler"} leaves a gap (${r.left}…${r.right} for ${laneL}…${viewR})`); break; }
      }
      // the pinned rows: at the top of the scroller while this song's tracks fill it
      const pin = f.querySelector(".pin9"), fb = f.querySelector(".fbody").getBoundingClientRect();
      if (pin && fb.top < scr.top - 5 && fb.bottom > scr.top + 200) { const pt = pin.getBoundingClientRect().top; if (!near(pt, scr.top + sc.clientTop, 2)) bad(`${s.name}: the ruler / tempo / sections rows aren't pinned (top ${pt} vs ${scr.top})`); }
    }
  }

  checkAll("start");
  // the pinned rows, with the first song's tracks filling the top of the screen
  { const f = sc.querySelector('.folder[data-id="' + A.id + '"]'), fb = f.querySelector('.fbody'), scr = sc.getBoundingClientRect();
    sc.scrollTop += fb.getBoundingClientRect().top - scr.top + 300; await frames(2);
    const pt = f.querySelector('.pin9').getBoundingClientRect().top, top = sc.getBoundingClientRect().top + sc.clientTop;
    if (!near(pt, top, 2)) P.push(`the ruler / time signature / tempo / sections rows aren't pinned to the top: ${pt - top} px below it`);
    checkAll("pinned"); sc.scrollTop = 0; await frames(2); }
  // down 3 screens
  const want = Math.min(sc.scrollHeight - sc.clientHeight, sc.scrollTop + 3 * sc.clientHeight);
  sc.scrollTop = want; await frames(3);
  if (want < 2 * sc.clientHeight) P.push(`not enough to scroll down 3 screens (${want})`);
  log.push(`scrolled down ${sc.scrollTop} px`);
  checkAll("scrolled down");
  // sideways 50 bars: trackpad swipes (deltaX) in steps, then Shift + wheel back 10 bars and forward again
  const laneL = heads0()[0].getBoundingClientRect().right, px = laneL + 200, py = sc.getBoundingClientRect().top + 250;
  const fire = (o) => sc.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: px, clientY: py, ...o }));
  sc.scrollLeft = 0; await frames(2);
  const per = 50 * 40 / 10;
  for (let i = 0; i < 10; i++) { fire({ deltaX: per }); await frames(1); }
  await frames(2);
  log.push(`sideways ${sc.scrollLeft} px = ${(sc.scrollLeft / PXS / barDur).toFixed(1)} bars`);
  if (!near(sc.scrollLeft, 50 * 40, 2)) P.push(`trackpad sideways: ${sc.scrollLeft} px, expected ${50 * 40}`);
  checkAll("sideways 50 bars");
  fire({ deltaY: 400, shiftKey: true }); await frames(3);
  if (!near(sc.scrollLeft, 50 * 40 + 400, 2)) P.push(`Shift + wheel: ${sc.scrollLeft} px, expected ${50 * 40 + 400}`);
  checkAll("shift + wheel");
  // zoom in and out at the pointer (⌥ + wheel): the time under the pointer stays put
  for (const [dir, n] of [["in", -120], ["out", 100], ["in again", -60]]) {
    const O0 = sc.querySelector(".folder .ruler .lane").getBoundingClientRect().left, t0 = (px - O0) / PXS, z0 = PXS;
    for (let i = 0; i < 4; i++) { fire({ deltaY: n, altKey: true }); await frames(1); }
    await settle();
    const O1 = sc.querySelector(".folder .ruler .lane").getBoundingClientRect().left, t1 = (px - O1) / PXS;
    log.push(`zoom ${dir}: ${z0.toFixed(2)} -> ${PXS.toFixed(2)} px/s; under the pointer ${t0.toFixed(3)} s -> ${t1.toFixed(3)} s`);
    if (near(PXS, z0, 0.01)) P.push(`zoom ${dir}: didn't zoom`);
    const edge = sc.scrollLeft <= 0 || sc.scrollLeft >= TL9.maxHX() - 1; // held at the song's start or end
    if (edge) log.push(`zoom ${dir}: held at the ${sc.scrollLeft <= 0 ? "start" : "end"} of the song`);
    if (!edge && Math.abs(t1 - t0) * PXS > 1.5) P.push(`zoom ${dir}: the pointer's time moved ${((t1 - t0) * PXS).toFixed(1)} px`);
    checkAll("zoom " + dir);
  }
  // the scrollbar and the overview frame follow the same position
  const hb = document.getElementById("hb9");
  if (!hb || hb.hidden) P.push("no sideways scrollbar under the lanes");
  if (MODE === "song") {
    const f = document.getElementById("vf9"), s = focusSong(), [a] = [sc.scrollLeft / PXS];
    if (!f || !near(parseFloat(f.style.left), a / s.len * 100, 0.5)) P.push(`the overview frame is at ${f && f.style.left}, expected ${(a / s.len * 100).toFixed(2)}%`);
    // playhead
    locate(s, (sc.scrollLeft + 300) / PXS); await frames(2);
    const O = sc.querySelector(".folder .ruler .lane").getBoundingClientRect().left, rph = sc.querySelector(".rph").getBoundingClientRect().left;
    if (!near(rph, O + pos * PXS, 1.5)) P.push(`the playhead on the ruler is at ${rph}, expected ${O + pos * PXS}`);
    const ph = sc.querySelector(".folder .ph"); if (ph && getComputedStyle(ph).display !== "none" && !near(ph.getBoundingClientRect().left, O + pos * PXS, 1.5)) P.push(`the playhead line is at ${ph.getBoundingClientRect().left}, expected ${O + pos * PXS}`);
  }
  // back to the top and the start
  sc.scrollTop = 0; sc.scrollLeft = 0; await frames(2); checkAll("back");
  return { problems: P, log };
}
