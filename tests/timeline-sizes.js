// 9e: runs inside the page (tests/ui-timeline.mjs). The Time signature row, track heights (drag, ⌥-drag,
// ⌥-double-click, the five sizes, ⌥⌘= / ⌥⌘−), Fit tracks to window, Fit all (and back), cue labels that don't
// overlap, the View menu, and the color-mix() fallback for macOS 12's WebKit.
// Returns { problems: [...], log: [...] }.
async function timelineSizes() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const P = [], log = [], sc = document.getElementById("scroller");
  const ok = (c, m) => { if (!c) P.push(m); };
  const settle = async () => { await frames(1); await SL9.settled(); await frames(1); }; // 10a: zoom glides
  document.querySelector('.tabs a[data-tab="show"]').click(); await wait(300);
  SL9.setMode("cards"); await wait(150);
  const S = SLPage.songs, s = S.find((x) => x.name === "Glasshouse"); openSong(s.id); await wait(300);
  const barDur = s.bars[1].t - s.bars[0].t;
  const rows = () => [...sc.querySelectorAll(`.folder[data-id="${s.id}"] .row.trk`)];
  const hOf = (r) => Math.round(r.querySelector("canvas[data-t]").getBoundingClientRect().height);
  const plain = (r) => !r.classList.contains("midi"); // modeler lanes default taller

  // ---- the Time signature row
  const badges = [...sc.querySelectorAll(".meter9 .msig9")].map((b) => b.dataset.bar + ":" + b.textContent);
  ok(badges.join(" ") === "1:4/4 25:7/8 27:4/4", "time signature badges: " + badges.join(" "));
  const order = [...sc.querySelectorAll(".pin9 > .row")].map((r) => r.classList[1]);
  ok(order.join(",") === "ruler,meter9,tempo,secs", "pinned rows in order ruler, time signature, tempo, sections: " + order);
  ok(sc.querySelector(".meter9 .mcur9").textContent === "4/4", "the Time signature header shows 4/4");
  ok(!sc.querySelector(".ruler .msig"), "no time signature badges left on the ruler");
  SL9.zoomTo(40 / barDur); await settle();
  sc.scrollLeft = s.bars[29].t * PXS; await frames(2);
  const st = sc.querySelector(".meter9 .mstk9");
  ok(st && !st.hidden && st.textContent === "4/4" && Math.abs(st.getBoundingClientRect().left - TL9.laneLeft()) <= 1, "the meter in force sticks at the left edge (4/4 at bar 30)");
  sc.scrollLeft = 0; await frames(2);
  ok(sc.querySelector(".meter9 .mstk9").hidden, "…and isn't shown at the song's start (the bar-1 badge is there)");
  sc.querySelector('.meter9 .msig9[data-bar="25"]').click(); await wait(80);
  ok(!!document.getElementById("mpop"), "clicking a time signature opens its popover");
  if (typeof closeMpop === "function") closeMpop();
  const other = S.find((x) => x !== s && !x.tmap.some((e) => e.bar > 1 && e.sig));
  if (other) { openSong(other.id); await wait(200);
    ok(sc.querySelectorAll(".meter9 .msig9").length === 1, "a song without changes still has the Time signature row (" + other.name + ")");
    openSong(s.id); await wait(200); }

  // ---- drag a track's bottom edge; ⌥-drag: every track; ⌥-double-click: back to the default
  const drag = async (i, alt, dy) => {
    const g = rows()[i].querySelector(".rsz9"), r = g.getBoundingClientRect(), x = r.left + 40, y = r.top + 3;
    g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, altKey: alt, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y + dy, pointerId: 1 })); await frames(2);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y + dy, pointerId: 1 })); await frames(2);
  };
  const t2 = rows()[2].querySelector(".lh").dataset.track;
  await drag(2, false, 30);
  ok((s.trkHs || {})[t2] === TH + 30 && hOf(rows()[2]) === TH + 30 && hOf(rows()[1]) === TH, `dragging ${t2}'s edge changes only that track (${JSON.stringify(s.trkHs)})`);
  await drag(2, true, -20);
  ok(s.trkH === TH + 10 && !s.trkHs && rows().filter(plain).every((r) => hOf(r) === TH + 10), "⌥-drag: every track the same height (" + s.trkH + ")");
  rows()[0].querySelector(".rsz9").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, altKey: true })); await frames(2);
  ok(!s.trkH && !s.trkHs, "⌥-double-click: back to the default");

  // ---- the five sizes, and the keys
  TL9.setSize(s, 0); await frames(2);
  ok(rows().every((r) => r.classList.contains("sz-mini")) && hOf(rows()[3]) === 18, "Mini: 18 px tracks");
  const lh = rows()[3].querySelector(".lh");
  ok(getComputedStyle(lh.querySelector(".tn")).display !== "none" && [...lh.querySelectorAll(".hf,.ochip,.ms")].every((e) => getComputedStyle(e).display === "none"), "Mini: the header keeps the colour and the name only");
  ok(TL9.sizeOf(s) === 0, "View › Track height shows Mini");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "=", code: "Equal", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })); await frames(2);
  ok(s.trkH === 32, "⌥⌘= grows to Small (" + s.trkH + ")");
  ok(rows().every((r) => r.classList.contains("sz-small")) && [...rows()[3].querySelectorAll(".hf,.ochip")].every((e) => getComputedStyle(e).display === "none"), "Small: no fader or output chip in the header");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "-", code: "Minus", ctrlKey: true, altKey: true, bubbles: true, cancelable: true })); await frames(2);
  ok(s.trkH === 18, "⌥⌘− shrinks to Mini (" + s.trkH + ")");
  TL9.setSize(s, 4); await frames(2); ok(hOf(rows()[3]) === 120, "Huge: 120 px");
  TL9.setSize(s, 2); await frames(2); ok(!s.trkH, "Medium: the default again");

  // ---- Fit tracks to window
  sc.scrollTop = 200; TL9.fitTracks(s); await frames(3);
  const scr = sc.getBoundingClientRect(), last = rows()[rows().length - 1].getBoundingClientRect();
  ok(sc.scrollTop === 0 && last.bottom <= scr.top + sc.clientHeight + 1 && s.trkH > 18, `Fit tracks to window: every track in view (${s.trkH} px each; the last ends at ${Math.round(last.bottom - scr.top)} of ${sc.clientHeight})`);
  log.push(`fit tracks: ${s.trkH} px for ${rows().length} tracks`);

  // ---- Fit all, and back
  TL9.setSize(s, 2); SL9.zoomTo(40 / barDur); await settle(); sc.scrollLeft = 500; await frames(2);
  const z0 = PXS, h0 = sc.scrollLeft;
  TL9.fitAll(s); await settle();
  const W = s.len * PXS, last2 = rows()[rows().length - 1].getBoundingClientRect();
  ok(document.body.classList.contains("top9c") && W <= TL9.viewW() && sc.scrollLeft === 0 && last2.bottom <= sc.getBoundingClientRect().top + sc.clientHeight + 1,
    `Fit all: every bar (${Math.round(W)} of ${Math.round(TL9.viewW())} px) and every track on screen`);
  log.push(`fit all: ${s.trkH} px tracks, ${PXS.toFixed(2)} px/s`);
  ok(sc.querySelector('.rt9 [data-a="fitAll"]').classList.contains("on"), "Fit all is lit");
  TL9.fitAll(s); await settle();
  ok(Math.abs(PXS - z0) < 1e-6 && sc.scrollLeft === h0 && !s.trkH && !document.body.classList.contains("top9c"), `Fit all again: back to the zoom (${PXS.toFixed(2)} vs ${z0.toFixed(2)}), position (${sc.scrollLeft} vs ${h0}) and sizes from before`);

  // ---- cue labels: never on top of each other, at most 2 rows
  for (const z of ["song", "32"]) {
    SL9.zoomPreset(s, z); await settle();
    const cv = [...sc.querySelectorAll("canvas[data-t]")].find((c) => c._cues && c._cues.length);
    if (!cv) { P.push("no cue lane"); break; }
    const L = cv._cues.filter((c) => c.w > 0); let clash = 0;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j]; if (a.y < b.y + b.h && b.y < a.y + a.h && a.x0 + 2 < b.x0 + 2 + b.w && b.x0 + 2 < a.x0 + 2 + a.w) clash++; }
    ok(!clash, `cue labels overlap at zoom ${z} (${clash})`);
    ok(new Set(L.map((c) => Math.round(c.y))).size <= 3, `cue labels on at most 2 rows at zoom ${z}`);
    log.push(`cues at zoom ${z}: ${cv._cues.length}, ${L.length} with a label`);
  }

  // ---- the View menu
  // (10b: the sizes, Shrink / Grow, Fit tracks and Compact top rows are in View › Track height)
  const view = SLMenus.flat ? SLMenus.flat().filter((x) => x.path[0] === "View").flatMap((x) => [...x.path.slice(1), x.label]) : SLMenus.spec().menus.find((m) => m.name === "View").items.map((x) => x.label).filter(Boolean);
  ok(["Track height", "Shrink tracks", "Grow tracks", "Fit tracks to window", "Fit all", "Compact top rows"].every((l) => view.includes(l)), "View menu: " + view.join(" · "));

  // ---- macOS 12's WebKit (no color-mix()): the overview strip's sections keep their colours
  const n = TL9.colorMixFallback(true); await frames(1);
  const bg = getComputedStyle(document.querySelector(".hsec button")).backgroundColor;
  ok(n > 10 && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent", `color-mix fallback: ${n} declarations; the overview strip's first section is ${bg}`);
  return { problems: P, log };
}
