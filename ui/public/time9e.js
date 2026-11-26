// set.Line 9e: the song timeline as one grid.
// - One sideways position (TL9.hx) for every layer: the ruler, time signature, tempo and sections rows, every
//   lane, the playhead, the loop and the overview frame. The scroller no longer scrolls sideways itself: each row
//   clips its lane, and the lanes move left by one amount set here, in the same frame as the lane pictures
//   are drawn. (The lanes are created in place; on a scroll each lane's transform is set.) Everything that used the scroller's scrollLeft (zoom, Fit, the overview frame, follow-playhead,
//   drag-to-zoom) keeps doing so: scrollLeft on #scroller reads and sets this position.
// - Track headers don't move sideways at all; the pinned rows (.pin9) stick to the top while the tracks scroll.
// - Sideways input: trackpad swipes, Shift + wheel, the scrollbar under the lanes, the overview frame.
// - Track heights (Mini · Small · Medium · Large · Huge, or dragged), Fit tracks to window, Fit all, compact top rows.
// - The Time signature row's meter at the left edge sticks while scrolling.
// - macOS 12's WebKit has no CSS color-mix(): those colours are swapped for plain ones there (they went transparent).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const sc = $("scroller"); if (!sc) return;

  // ---------------------------------------------------------------- color-mix() on older WebKit
  // A declaration using color-mix() with a var() can't be checked when the page loads, so it replaces the plain
  // colour before it and then computes to nothing (transparent) where color-mix() isn't supported. There: mixes of
  // 50 % or more become the first colour, the rest the second (subtle tints become the plain background).
  function colorMixFallback(force) {
    if (!force && window.CSS && CSS.supports && CSS.supports("color", "color-mix(in srgb, red 50%, blue)")) return 0;
    const plain = (v) => { let out = v, guard = 0;
      while (out.includes("color-mix(") && guard++ < 20) {
        const i = out.indexOf("color-mix("); let d = 0, j = i + 9;
        for (; j < out.length; j++) { if (out[j] === "(") d++; else if (out[j] === ")") { d--; if (d === 0) break; } }
        const inner = out.slice(i + 10, j), parts = []; let depth = 0, cur = "";
        for (const ch of inner) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch; }
        parts.push(cur.trim());
        const A = (parts[1] || "").replace(/\s+\d+(\.\d+)?%$/, ""), pa = +((parts[1] || "").match(/(\d+(\.\d+)?)%$/) || [0, 50])[1], B = (parts[2] || "transparent").replace(/\s+\d+(\.\d+)?%$/, "");
        out = out.slice(0, i) + (pa >= 50 ? A : B) + out.slice(j + 1);
      }
      return out; };
    let n = 0;
    const walk = (rules) => { for (const r of rules) {
      if (r.cssRules && !r.selectorText) { try { walk(r.cssRules); } catch (e) {} continue; }
      if (!r.style || !r.style.cssText.includes("color-mix(")) continue;
      // the declarations as written (shorthands with var() don't show in their longhands)
      const decl = []; let depth = 0, cur = "";
      for (const ch of r.style.cssText) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === ";" && depth === 0) { decl.push(cur); cur = ""; } else cur += ch; }
      decl.push(cur);
      for (const d of decl) { const k = d.indexOf(":"); if (k < 0 || !d.includes("color-mix(")) continue;
        const prop = d.slice(0, k).trim(); let val = d.slice(k + 1).trim(); const imp = /!important\s*$/.test(val) ? "important" : ""; val = val.replace(/!important\s*$/, "").trim();
        try { r.style.setProperty(prop, plain(val), imp); n++; } catch (e) {} }
    } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
    return n;
  }
  const mixFixed = colorMixFallback(/[?&]nocolormix\b/.test(location.search));

  // ---------------------------------------------------------------- the one sideways position
  const NATIVE = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
  let HX = 0, geo = null, box = null;
  // where the lanes are on screen: measured once, again only when the scroller's size or view changes (reading
  // it after every redraw would force a layout each zoom frame)
  const measureBox = () => {
    if (box) return box;
    const r = sc.getBoundingClientRect(), cs = getComputedStyle(sc), pr = (sc.parentElement || document.body).getBoundingClientRect();
    const lh = sc.querySelector(".fbody .row .lh"), lr = lh && lh.getBoundingClientRect();
    const left = lr && lr.width ? lr.right : r.left + sc.clientLeft + parseFloat(cs.paddingLeft) + headW();
    const right = r.left + sc.clientLeft + sc.clientWidth - parseFloat(cs.paddingRight);
    const b = { left, w: Math.max(40, right - left), pl: pr.left, pb: pr.bottom - (r.top + sc.clientTop + sc.clientHeight) };
    if (lr && lr.width) box = b; // without a lane yet it's a guess: not kept
    return b;
  };
  const forget = () => { box = null; geo = null; };
  if (window.ResizeObserver) new ResizeObserver(forget).observe(sc);
  new MutationObserver(forget).observe(sc, { attributes: true, attributeFilter: ["class"] });
  const measure = () => {
    if (geo) return geo;
    let cw = 0; sc.querySelectorAll("canvas.rcv").forEach((c) => { cw = Math.max(cw, +c.dataset.w || 0); });
    geo = { ...measureBox(), cw };
    Promise.resolve().then(() => { geo = null; });
    return geo;
  };
  const laneLeft = () => measure().left;
  const viewW = () => measure().w;
  const maxHX = () => Math.max(0, measure().cw - measure().w);
  // the lanes move (an inline transform each: a CSS variable on the scroller restyled everything in it, ~4 ms a
  // frame); new lanes are created in place (lanePos() in the page), so this is only for a scroll
  const hxVar = (v) => {
    const t = `translateX(${-v}px)`;
    for (const l of sc.querySelectorAll(".row>.lane,.fhead>.lane")) if (l.style.transform !== t) l.style.transform = t;
    for (const h of sc.querySelectorAll(".lanehint")) h.style.left = v + 10 + "px";
    for (const k of sc.querySelectorAll(".vskip")) k.style.left = `calc(var(--head) + ${(+k.dataset.x || 0) - v}px)`;
  };
  function apply(v, draw) {
    hxVar(v);
    if (typeof viewM !== "undefined") viewM = null;
    if (draw && typeof redrawView === "function") redrawView(false);
    if (typeof placePH === "function" && draw) { try { placePH(); } catch (e) {} }
    meters(); bar();
    sc.dispatchEvent(new Event("scroll")); // the page's own scroll listeners (popovers, the overview frame)
  }
  function set(v) {
    v = Math.round(Math.max(0, Math.min(maxHX(), +v || 0)));
    if (v === HX) return;
    HX = v; apply(v, true);
  }
  // before a redraw at a new zoom: the position the lanes will be drawn at (checked against the new width after)
  function preset(v) { HX = Math.max(0, Math.round(+v || 0)); geo = null; if (typeof viewM !== "undefined") viewM = null; }
  Object.defineProperty(sc, "scrollLeft", { configurable: true, get: () => HX, set: (v) => set(v) });
  // the scroller itself must never scroll sideways (a focus() or scrollIntoView could still do it)
  sc.addEventListener("scroll", () => { if (NATIVE.get.call(sc) !== 0) NATIVE.set.call(sc, 0); }, { passive: true });
  window.addEventListener("resize", () => { forget(); set(HX); bar(); });

  // trackpad swipes and Shift + wheel (⌥ / Ctrl / ⌘ + wheel zoom: show9)
  let pend = 0, praf = 0;
  sc.addEventListener("wheel", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sc.clientWidth : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    if (!dx || Math.abs(dx) < Math.abs(dy) * 0.5) return; // mostly up / down: the scroller's own scrolling
    if (!sc.querySelector("canvas.rcv")) return;
    e.preventDefault();
    if (dy) sc.scrollTop += dy;
    pend += dx;
    if (!praf) praf = requestAnimationFrame(() => { praf = 0; const d = pend; pend = 0; set(HX + d); });
  }, { passive: false });

  // ---------------------------------------------------------------- the scrollbar under the lanes
  const hb = document.createElement("div"); hb.className = "hb9"; hb.id = "hb9"; hb.innerHTML = "<i></i>"; hb.hidden = true;
  (sc.parentElement || document.body).appendChild(hb);
  const thumb = hb.firstChild;
  function bar() {
    const g = measure(), m = maxHX();
    if (!m || !sc.querySelector("canvas.rcv")) { hb.hidden = true; return; }
    hb.hidden = false;
    hb.style.left = g.left - g.pl + "px"; hb.style.width = g.w + "px"; hb.style.bottom = g.pb + 2 + "px";
    const tw = Math.max(28, g.w * g.w / g.cw);
    thumb.style.width = tw + "px"; thumb.style.transform = `translateX(${HX / m * (g.w - tw)}px)`;
  }
  hb.addEventListener("pointerdown", (e) => {
    e.preventDefault(); const g = measure(), m = maxHX(), tw = thumb.getBoundingClientRect().width;
    if (e.target !== thumb) { const tr = thumb.getBoundingClientRect(); set(HX + (e.clientX < tr.left ? -1 : 1) * g.w * 0.9); return; }
    hb.setPointerCapture(e.pointerId); const x0 = e.clientX, h0 = HX, k = m / Math.max(1, g.w - tw);
    hb.onpointermove = (mv) => set(h0 + (mv.clientX - x0) * k);
    hb.onpointerup = () => { hb.onpointermove = null; };
  });

  // ---------------------------------------------------------------- the Time signature row
  function meters() {
    sc.querySelectorAll(".meter9 .lane").forEach((l) => {
      const s = songs.find((x) => x.id === l.dataset.song); if (!s || !s.bars) return;
      const st = l.querySelector(".mstk9"), badges = [...l.querySelectorAll(".msig9")];
      // the change in force at the left edge, and whether its own badge (or the next one) is in the way
      const xs = badges.map((b) => parseFloat(b.style.left) || 0);
      let k = 0; for (let i = 0; i < xs.length; i++) if (xs[i] <= HX + 1) k = i;
      const show = HX > 0 && xs[k] < HX - 2 && !(xs[k + 1] !== undefined && xs[k + 1] < HX + 46);
      if (st) { st.hidden = !show; if (show) { st.textContent = badges[k].textContent; st.dataset.bar = badges[k].dataset.bar; st.title = badges[k].title; st.style.left = HX + "px"; } }
      const cur = l.parentElement.querySelector(".mcur9");
      if (cur) { const t = playId === s.id && typeof pos === "number" ? pos : HX / PXS;
        const b = s.bars.slice(0, s.total).filter((x) => x.t <= t + 1e-6).pop() || s.bars[0];
        const txt = sigAt(s, b.bar).join("/"); if (cur.textContent !== txt) cur.textContent = txt; }
    });
  }
  setInterval(() => { if (typeof playing !== "undefined" && playing && sc.querySelector(".meter9")) meters(); }, 250);

  // ---------------------------------------------------------------- after each render of the timeline
  function after(root) {
    geo = null; if (box && !sc.querySelector(".fbody .row .lh")) box = null;
    const v = Math.round(Math.max(0, Math.min(maxHX(), HX)));
    if (v !== HX) { HX = v; apply(v, true); } else { meters(); bar(); }
    void root;
  }

  // ---------------------------------------------------------------- track heights
  const SIZES = TSIZES; // [['Mini',18],['Small',32],['Medium',50],['Large',76],['Huge',120]]
  const curSong = () => (typeof focusSong === "function" && focusSong()) || songs.find((x) => open.has(x.id) && x.id === selId) || songs.find((x) => open.has(x.id)) || null;
  const visTracks = (s) => s.tracks.filter((t) => typeof trackInVer !== "function" || trackInVer(s, t, curVer(s)));
  function sizeOf(s) { if (!s || Object.keys(s.trkHs || {}).length) return -1; const h = s.trkH || TH; return SIZES.findIndex((x, i) => sizePx(i) === h); }
  function setAll(s, h) { if (!s) return; snap(); if (h) s.trkH = Math.round(Math.max(THMIN, Math.min(THMAX, h))); else delete s.trkH; delete s.trkHs; refresh(); }
  function setSize(s, i) { if (!s) return; setAll(s, sizePx(i) === TH ? 0 : sizePx(i)); } // the default: follows Customize
  function step(s, d) {
    if (!s) return; const h = s.trkH || TH, ps = SIZES.map((x, i) => sizePx(i));
    let i = d > 0 ? ps.findIndex((p) => p > h + 0.5) : ps.map((p, j) => (p < h - 0.5 ? j : -1)).filter((j) => j >= 0).pop();
    if (i === -1 || i === undefined) return; setSize(s, i);
  }
  // every track of the open song in the visible height (under the pinned rows)
  function fitTracks(s, quiet) {
    if (!s) return; const n = visTracks(s).length; if (!n) return;
    const f = sc.querySelector(`.folder[data-id="${s.id}"]`), first = f && f.querySelector(".row.trk");
    const keep = sc.scrollTop; sc.scrollTop = 0;
    const top = first ? first.getBoundingClientRect().top - sc.getBoundingClientRect().top : 150;
    const pad = parseFloat(getComputedStyle(first || sc).paddingBottom) || 0; // the rows' gap (Studio look)
    const h = Math.floor((sc.clientHeight - top - 14) / n - pad);
    sc.scrollTop = quiet ? 0 : keep;
    if (quiet) { if (h) s.trkH = Math.round(Math.max(THMIN, Math.min(THMAX, h))); delete s.trkHs; refresh(); sc.scrollTop = 0; return; }
    setAll(s, h); sc.scrollTop = 0;
  }
  // Fit all: compact top rows, the whole song across, every track down; again: back to how it was
  let fitPrev = null;
  const fitAllOn = (id) => !!fitPrev && (id == null || fitPrev.song === id);
  function fitAll(s) {
    if (!s) return;
    if (fitPrev && fitPrev.song === s.id) {
      const p = fitPrev; fitPrev = null; setCompact(p.compact, true);
      if (p.trkH) s.trkH = p.trkH; else delete s.trkH; if (p.trkHs) s.trkHs = p.trkHs; else delete s.trkHs;
      if (window.SL9 && SL9.zoomTo) { preset(p.hx); PXS = p.pxs; refresh(); set(p.hx); } else refresh();
      sc.scrollTop = p.st; return;
    }
    fitPrev = { song: s.id, pxs: PXS, hx: HX, st: sc.scrollTop, trkH: s.trkH, trkHs: s.trkHs ? { ...s.trkHs } : null, compact: compact() };
    snap(); setCompact(true, true);
    if (window.SL9) SL9.zoomPreset(s, "song");
    fitTracks(s, true);
  }
  const compact = () => document.body.classList.contains("top9c");
  function setCompact(on, quiet) { document.body.classList.toggle("top9c", !!on); try { localStorage.setItem("setline.top9c", on ? "1" : ""); } catch (e) {} if (!quiet) refresh(); }
  try { if (localStorage.getItem("setline.top9c")) document.body.classList.add("top9c"); } catch (e) {}

  // drag a track's bottom edge (⌥: every track of the song); double-click: back to the default
  document.addEventListener("pointerdown", (e) => {
    const g = e.target.closest && e.target.closest(".rsz9"); if (!g || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const lh = g.closest(".lh"), s = songs.find((x) => x.id === lh.dataset.song), t = lh.dataset.track; if (!s) return;
    const all = e.altKey, f = lh.closest(".folder"), y0 = e.clientY, h0 = trackH(s, t);
    const rows = all ? [...f.querySelectorAll(".row.trk")] : [lh.parentElement];
    document.body.classList.add("rsz9on");
    let h = h0, raf = 0;
    const show = () => { raf = 0; rows.forEach((r) => { r.style.setProperty("--th", h + "px"); r.classList.remove("sz-mini", "sz-small", "sz-huge"); const c = sizeClass(h); if (c) r.classList.add(c);
      const cv = r.querySelector("canvas[data-t]"); if (cv) { cv.height = h; cv.style.height = h + "px"; drawLane(cv); } }); };
    const mv = (m) => { h = Math.round(Math.max(THMIN, Math.min(THMAX, h0 + m.clientY - y0))); if (!raf) raf = requestAnimationFrame(show); };
    const up = () => { document.removeEventListener("pointermove", mv, true); document.removeEventListener("pointerup", up, true); document.body.classList.remove("rsz9on");
      if (h === h0) return; snap(); if (all) { s.trkH = h; delete s.trkHs; } else (s.trkHs || (s.trkHs = {}))[t] = h; fitPrev = null; refresh(); };
    document.addEventListener("pointermove", mv, true); document.addEventListener("pointerup", up, true);
  }, true);
  document.addEventListener("dblclick", (e) => {
    const g = e.target.closest && e.target.closest(".rsz9"); if (!g) return;
    e.preventDefault(); e.stopPropagation();
    const lh = g.closest(".lh"), s = songs.find((x) => x.id === lh.dataset.song); if (!s) return;
    snap(); if (e.altKey) { delete s.trkH; delete s.trkHs; } else if (s.trkHs) { delete s.trkHs[lh.dataset.track]; if (!Object.keys(s.trkHs).length) delete s.trkHs; } refresh();
  }, true);

  // ⌥⌘− / ⌥⌘= shrink / grow every track, ⌥⌘F fit tracks to window
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
    const tg = e.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    const s = curSong(); if (!s) return;
    if (e.code === "Minus" || e.key === "-" || e.key === "–") { e.preventDefault(); step(s, -1); }
    else if (e.code === "Equal" || e.key === "=" || e.key === "≠" || e.key === "+") { e.preventDefault(); step(s, 1); }
    else if (e.code === "KeyF") { e.preventDefault(); fitTracks(s); }
  });

  // the ruler's header cell: ↕ fit tracks · Fit all · track height (each song's own, in Folders too)
  function sizeMenu(s, at) { const cur = sizeOf(s);
    ctxMenu(at, [{ cap: "Track height · " + s.name }, ...SIZES.map(([n], i) => ({ label: n + (cur === i ? "  ✓" : ""), act: () => setSize(s, i) })), "-",
      { label: "Fit tracks to window  ⌥⌘F", act: () => fitTracks(s) }, { label: (fitAllOn(s.id) ? "✓ " : "") + "Fit all", act: () => fitAll(s) }, { label: (compact() ? "✓ " : "") + "Compact top rows", act: () => setCompact(!compact()) }]); }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".rt9 button"); if (!b) return;
    e.stopPropagation(); const s = songs.find((x) => x.id === b.parentElement.dataset.song); if (!s) return;
    if (b.dataset.a === "fitTracks") fitTracks(s); else if (b.dataset.a === "fitAll") fitAll(s);
    else { const r = b.getBoundingClientRect(); sizeMenu(s, { clientX: r.left, clientY: r.bottom + 4 }); }
  }, true);
  document.addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest(".rt9")) e.stopPropagation(); }, true);

  window.TL9 = { get hx() { return HX; }, set, preset, after, laneLeft, viewW, maxHX, bar, meters, SIZES, song: curSong, sizeOf, setSize, step, fitTracks, fitAll, fitAllOn, compact, setCompact, mixFixed, colorMixFallback };
})();
