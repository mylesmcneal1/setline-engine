// set.Line 13 §1: the ONE time <-> screen calculation. Everything that turns a time into an x or a pointer into a time
// goes through here: the ruler, grid lines, lanes, clips, waveforms, notes, sections, markers, tempo and meter
// points, the playhead, the hover ghost, the insert line, hit-testing, drags, box selection, the bottom editors and
// the overview strip.
//
// A view is { pxs, hx }: pixels per second and the sideways position (the song pixel at the view's left edge).
// The timeline's view is TX.main(); each bottom editor has its own (§5).
//   x = t * pxs - hx          (view x: 0 = the lanes' left edge)
//   t = (x + hx) / pxs
// Song pixels (what the lanes and their canvases are laid out in) are the same with hx = 0.
//
// Drawing and hit-testing round the same way: a line at time t is the 1-px column floor(x), whose centre is
// floor(x) + 0.5, at most half a pixel from x; DOM lines (playhead, ghost, insert line) are centred on x itself.
// Pointer positions are read from the pointer's offset in the element that draws (offsetX); when the event's
// target is something else, its offset is converted through the drawing element's own box, scaled by the ratio of
// its layout width to its on-screen width, so CSS zoom (Text size) and transforms can't shift it.
//
// Snapping rounds to the NEAREST grid line (never down): the bar by default, the Adaptive grid when zoomed in.
// ⌘ (Ctrl on Windows) places exactly under the pointer.
(() => {
  "use strict";
  const MAC = /Mac/.test(navigator.platform);
  const main = () => ({ pxs: typeof PXS === "number" ? PXS : 5, hx: window.TL9 ? TL9.hx : 0 });
  const x = (t, v) => { v = v || main(); return t * v.pxs - v.hx; };
  const t = (xx, v) => { v = v || main(); return (xx + v.hx) / v.pxs; };
  const songX = (tt, v) => tt * (v ? v.pxs : main().pxs);
  // the canvas column a 1-px line at view x is drawn in (its centre: col + 0.5)
  const col = (xx) => Math.floor(xx + 1e-6);
  // a DOM line `w` px wide centred on x
  const lineLeft = (xx, w) => xx - (w || 1) / 2;
  const free = (e) => !!e && (MAC ? !!e.metaKey : !!e.ctrlKey);

  // Text size zooms the page (CSS zoom on .main). Under it, browsers give the pointer's offsetX in zoomed screen
  // pixels (not the element's own), and macOS 12's WebKit gives getBoundingClientRect in the element's own units:
  // so with a zoom, positions come from the element's box, converted by the zoom factor, whichever units it uses.
  let ZK = '', ZV = 1;
  function zoomOf(el) {
    const b = document.body; if (!b.classList.contains('zoomed9') || !(el && el.closest && el.closest('.main, .perf, .bandv'))) return 1;
    const k = document.documentElement.style.getPropertyValue('--zoom') || getComputedStyle(document.documentElement).getPropertyValue('--zoom');
    if (k !== ZK) { ZK = k; ZV = parseFloat(k) || 1; } return ZV;
  }
  // the element's left / top edge in the pointer's (viewport) coordinates, and the factor to its own pixels
  function box(el, Z) {
    const r = el.getBoundingClientRect(), ow = el.offsetWidth, oh = el.offsetHeight;
    if (Z === 1) return { x: r.left, y: r.top, kx: r.width && ow ? ow / r.width : 1, ky: r.height && oh ? oh / r.height : 1 };
    const screenUnits = !ow || Math.abs(r.width - ow * Z) <= Math.abs(r.width - ow); // Chrome, newer WebKit
    return screenUnits ? { x: r.left, y: r.top, kx: 1 / Z, ky: 1 / Z } : { x: r.left * Z, y: r.top * Z, kx: 1 / Z, ky: 1 / Z };
  }
  // The pointer's x inside el (the element that draws), in el's own CSS pixels.
  function local(e, el) {
    if (!e) return 0;
    if (!el) return e.offsetX || 0;
    const tg = e.target;
    if (!tg && typeof e.offsetX === 'number') return e.offsetX; // a plain {offsetX} (a menu item calling a handler)
    const Z = zoomOf(el);
    if (Z === 1) {
      if (tg === el && typeof e.offsetX === 'number') return e.offsetX;
      // a child of el: its offset plus the child's layout position inside el (no transforms in between)
      if (tg && tg.nodeType === 1 && el.contains(tg) && typeof e.offsetX === 'number') {
        let xx = e.offsetX, n = tg, ok = true;
        while (n && n !== el) { if (n.style && n.style.transform && n.style.transform !== 'none') { ok = false; break; } const p = n.offsetParent; if (!p) { ok = false; break; } xx += n.offsetLeft + (p !== el ? p.clientLeft : 0); if (p === el) { n = p; break; } if (!el.contains(p)) { ok = false; break; } n = p; }
        if (ok && n === el) return xx;
      }
    }
    const q = box(el, Z); return (e.clientX - q.x) * q.kx;
  }
  const localY = (e, el) => {
    if (!e.target && typeof e.offsetY === 'number') return e.offsetY;
    const Z = zoomOf(el); if (Z === 1 && e.target === el && typeof e.offsetY === 'number') return e.offsetY;
    const q = box(el, Z); return (e.clientY - q.y) * q.ky;
  };
  // where el's own x lands on screen (for tests and popovers): the inverse of local()
  const screenX = (el, xx) => { const Z = zoomOf(el), q = box(el, Z); return q.x + xx / q.kx; };
  // a lane canvas: its drawing starts at song pixel dataset.vx (only the visible part is a canvas)
  const canvasSongX = (e, cv) => local(e, cv) + (+cv.dataset.vx || 0);
  // the time under the pointer in a lane-like element (a canvas with dataset.vx, or a lane laid out in song pixels)
  function timeAt(e, el, v) {
    v = v || main();
    if (el && el.tagName === "CANVAS" && el.dataset && el.dataset.vx != null) return canvasSongX(e, el) / v.pxs;
    if (el && el.dataset && el.dataset.view === "editor") return t(local(e, el), v);
    return local(e, el) / v.pxs; // song pixels
  }

  // ---------------------------------------------------------------- snapping
  // the grid points around time tt (the bar before, this one and the next), nearest wins; the song's end counts too
  function snap(s, tt, isFree, grid) {
    if (!s || !s.bars) return tt;
    tt = Math.max(0, tt);
    if (isFree || (typeof SNAP !== "undefined" && !SNAP && !grid)) return Math.round(tt * 1000) / 1000;
    const i = typeof barIdx === "function" ? barIdx(s, tt) : 0; let best = tt, bd = 1e9;
    for (const b of [s.bars[i - 1], s.bars[i], s.bars[i + 1]]) if (b) for (const g of gridPoints(s, b, grid)) { const d = Math.abs(g - tt); if (d < bd - 1e-9) { bd = d; best = g; } }
    if (s.audio && Math.abs(s.audio - tt) < bd) best = s.audio;
    return best;
  }
  // the grid points in bar b (its start first, the next bar's start last), for `grid` (a gridQ value: "bar" or quarter
  // notes) or the current Snap grid
  function gridPoints(s, b, grid) {
    const g = grid != null ? grid : typeof gridQ === "function" ? gridQ(s) : "bar";
    const out = [b.t];
    if (g !== "bar") { const Q = b.sig[0] * 4 / b.sig[1]; for (let k = 1; k * g < Q - 1e-6; k++) out.push(typeof qTime === "function" ? qTime(b, k * g) : b.t + b.dur * (k * g) / Q); }
    out.push(b.t + b.dur);
    return out;
  }

  // ---------------------------------------------------------------- editor views (§5)
  // Bottom editors keep their own {pxs, hx}; linked ones follow the timeline.
  const views = new Map();
  function view(id) { const v = views.get(id); if (!v || v.linked) return Object.assign(main(), v ? { linked: true, id } : {}); return v; }
  function setView(id, o) { const v = Object.assign(views.get(id) || { pxs: main().pxs, hx: main().hx, linked: false }, o); v.hx = Math.max(0, v.hx); views.set(id, v); return v; }

  window.TX = { MAC, zoomOf, screenX, main, x, t, songX, col, lineLeft, free, local, localY, canvasSongX, timeAt, snap, gridPoints, view, setView, views };
})();
