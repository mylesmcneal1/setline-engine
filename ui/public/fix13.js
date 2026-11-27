// set.Line 13 (B-F): editing like a DAW, look and feel, no side panel, cues, library basics.
// Loaded last (after fix12.js). Sections are marked with the spec's numbers (docs/phase13.md).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const songOf = (id) => songs.find((x) => x.id === id);

  // ================================================================ §10 text on coloured blocks: black or white
  // The colour a block shows (col at alpha over the dark lane), then whichever of black / white contrasts more.
  const rgb = (c) => { c = String(c || "").trim(); if (c[0] === "#") { if (c.length === 4) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]; const n = parseInt(c.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; } const m = c.match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : [128, 128, 128]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => { const [r, g, b] = rgb(c); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  function inkOn(col, alpha, under) {
    const a = alpha == null ? 1 : alpha, [r, g, b] = rgb(col), [R2, G2, B2] = rgb(under || "#15171b");
    const mix = `rgb(${r * a + R2 * (1 - a)},${g * a + G2 * (1 - a)},${b * a + B2 * (1 - a)})`, L = lum(mix);
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? "#000" : "#fff";
  }
  window.inkOn = inkOn;

  // ================================================================ §3 ⌘E splits a MIDI or click clip too (at the nearest bar line to the insert line / playhead)
  addEventListener("DOMContentLoaded", () => { if (!window.SL12 || !SL12.split || SL12.split._13) return; const S0 = SL12.split;
    SL12.split = function () { if (typeof selClip !== "undefined" && selClip) return S0.apply(this, arguments);
      const p = typeof pick !== "undefined" ? pick : null; if (!p || (p.kind !== "mreg" && p.kind !== "ck")) return S0.apply(this, arguments);
      const s = songOf(p.song), L = s && regList(s, p.track, p.kind), r = L && L.find((x) => x.id === p.id); if (!r) return false;
      const at = SL12.insert(s) != null ? SL12.insert(s) : playId === s.id ? pos : null, b = at == null ? null : nearestBoundary(s, at);
      if (b == null || !(b > r.bar && b < r.bar + r.bars)) { toast("Put the insert line (click) inside the clip, then ⌘E"); return false; }
      snap(); const nr = { ...JSON.parse(JSON.stringify(r)), id: "r" + regSeq++, bar: b, bars: r.bar + r.bars - b }; if (p.kind === "ck") { nr.notes = r.notes.filter((n) => n.b >= b - r.bar).map((n) => ({ ...n, b: n.b - (b - r.bar) })); r.notes = r.notes.filter((n) => n.b < b - r.bar); }
      r.bars = b - r.bar; L.push(nr); L.sort((a, c) => a.bar - c.bar); redrawSong(s); toast(`Split the clip at bar ${b}`, undo); return true; };
    SL12.split._13 = true; });

  // §4 a song picked in the library (cards, Folders rows, the pool) is a library selection: ⌫ deletes it (with undo)
  document.addEventListener("pointerdown", (e) => { if (e.button === 0 && e.target.closest && e.target.closest(".card9[data-id], .row9 .r9h, #pool .ps[data-id]") && typeof songSelFrom !== "undefined") songSelFrom = "lib"; }, true);

  // ================================================================ §8 drag chips (SLDrag in fix10a.js, the patch editor's tiles)
  // A compact, solid chip follows the pointer with a soft shadow: a song shows its colour bar, name and length (about a
  // setlist row); a block (a scene tile) shows itself at its true size. Text size: the chip's inside is zoomed like the
  // page, its position isn't. Dropping slides it into place; cancelling slides it back.
  const zoomNow = () => (document.body.classList.contains("zoomed9") ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--zoom")) || 1 : 1);
  function chipFor(o) {
    const c = document.createElement("div"); c.className = "chip13"; const z = zoomNow();
    const inner = document.createElement("div"); inner.className = "chip13in"; if (z !== 1) inner.style.zoom = z;
    const bar = document.createElement("i"); bar.style.background = o.color || "#8a909b"; const nm = document.createElement("b"); nm.textContent = o.label || "";
    inner.append(bar, nm); if (o.sub) { const sp = document.createElement("span"); sp.textContent = o.sub; inner.appendChild(sp); }
    c.appendChild(inner); document.body.appendChild(c); c._h = c.getBoundingClientRect().height || 30; return c;
  }
  // a block: a copy of the element at its own size
  function chip(el, e) { const r = el.getBoundingClientRect(), c = document.createElement("div"); c.className = "chip13 blk"; const k = el.cloneNode(true); k.classList.remove("on"); k.style.width = r.width + "px"; k.style.height = r.height + "px"; c.appendChild(k); document.body.appendChild(c);
    c._dx = e.clientX - r.left; c._dy = e.clientY - r.top; c._h = r.height; el.classList.add("drag10src"); c._src = el; chipMove(c, e); return c; }
  function chipMove(c, p) { const x = p.x != null ? p.x : p.clientX, y = p.y != null ? p.y : p.clientY; if (c._dx != null) { c.style.left = x - c._dx + "px"; c.style.top = y - c._dy + "px"; } else { c.style.left = x + 14 + "px"; c.style.top = y - (c._h || 30) / 2 + "px"; } }
  function chipEnd(c, line, src, done) {
    let to = null; if (line) to = { left: line.left, top: line.top - (c._h || 30) / 2 }; else if (src && src.isConnected) { const r = src.getBoundingClientRect(); to = { left: r.left, top: r.top + r.height / 2 - (c._h || 30) / 2 }; }
    const end = () => { c.remove(); if (c._src) c._src.classList.remove("drag10src"); if (done) done(); };
    if (!to || document.body.classList.contains("calm")) { end(); return; }
    c.classList.add("go"); if (line) c.classList.add("land"); c.style.left = to.left + "px"; c.style.top = to.top + "px"; setTimeout(end, 170);
  }
  const chipDrop = (c) => chipEnd(c, null, null), chipCancel = (c) => chipEnd(c, null, c._src);
  // lists open a gap: the rows from the landing point on move down (and back when the drag moves on or ends)
  function gap(g, old) {
    if (old && (!g || old.rows !== g.rows || old.at !== g.at)) old.rows.forEach((r) => { r.style.transform = ""; r.classList.remove("gap13"); });
    if (g) g.rows.forEach((r, i) => { r.classList.add("gap13"); r.style.transform = i >= g.at ? "translateY(" + g.h + "px)" : ""; });
  }

  // ================================================================ §10 a colour wheel everywhere
  // A wheel (hue around, saturation outwards), a brightness slider, a hex field and the colours used lately. It
  // replaces the preset swatches wherever a colour is chosen (songs, tracks, sections, clips, scenes, breaks,
  // setlists, the Customize accent). A pick is one change (one undo step), made when the pointer lets go of the wheel
  // or the slider, on Enter in the hex field, or on a recent colour; callers apply it to every selected item.
  const hsv2hex = (h, s, v) => { const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join(""); };
  const hex2hsv = (hex) => { const [r, g, b] = rgb(hex).map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; return { h, s: mx ? d / mx : 0, v: mx }; };
  const normHex = (v) => { v = String(v || "").trim().replace(/^#?/, "#"); if (/^#[0-9a-f]{3}$/i.test(v)) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; };
  const recents = () => { try { return JSON.parse(localStorage.getItem("setline.recentColours") || "[]"); } catch (e) { return []; } };
  const addRecent = (c) => { try { localStorage.setItem("setline.recentColours", JSON.stringify([c, ...recents().filter((x) => x !== c)].slice(0, 10))); } catch (e) {} };
  let WHEEL = null; // the wheel's pixels, drawn once
  function wheelImage(size, dpr) {
    const n = Math.round(size * dpr); if (WHEEL && WHEEL.n === n) return WHEEL.c;
    const c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d"), im = g.createImageData(n, n), R = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = x + 0.5 - R, dy = y + 0.5 - R, d = Math.hypot(dx, dy) / R; if (d > 1) continue; const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, [r, gg, b] = rgb(hsv2hex(h, d, 1)), i = (y * n + x) * 4; im.data[i] = r; im.data[i + 1] = gg; im.data[i + 2] = b; im.data[i + 3] = d > 0.985 ? 255 * (1 - d) / 0.015 : 255; }
    g.putImageData(im, 0, 0); WHEEL = { n, c }; return c;
  }
  // the picker inside any box: onPick(hex) once per choice
  function colorPicker(box, cur, onPick) {
    const S = 150, dpr = window.devicePixelRatio || 1; let hsv = hex2hsv(normHex(cur) || "#ff9f0a");
    box.classList.add("cw13"); box.innerHTML = `<div class="cw13top"><canvas class="cw13w" width="${S * dpr}" height="${S * dpr}" style="width:${S}px;height:${S}px"></canvas>
      <div class="cw13side"><i class="cw13sw"></i><input class="cw13hex" spellcheck="false" maxlength="7" aria-label="Hex colour"></div></div>
      <input type="range" class="cw13v" min="0" max="100" step="1" aria-label="Brightness"><div class="cw13rec"></div>`;
    const cv = box.querySelector(".cw13w"), g = cv.getContext("2d"), v = box.querySelector(".cw13v"), hx = box.querySelector(".cw13hex"), sw = box.querySelector(".cw13sw");
    const hexNow = () => hsv2hex(hsv.h, hsv.s, hsv.v);
    function paint() { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(wheelImage(S, dpr), 0, 0); g.fillStyle = `rgba(0,0,0,${1 - hsv.v})`; g.beginPath(); g.arc(cv.width / 2, cv.height / 2, cv.width / 2, 0, 7); g.fill();
      const a = hsv.h * Math.PI / 180, x = cv.width / 2 + Math.cos(a) * hsv.s * cv.width / 2, y = cv.height / 2 + Math.sin(a) * hsv.s * cv.height / 2; g.lineWidth = 2 * dpr; g.strokeStyle = "#fff"; g.beginPath(); g.arc(x, y, 6 * dpr, 0, 7); g.stroke(); g.strokeStyle = "rgba(0,0,0,.5)"; g.lineWidth = dpr; g.beginPath(); g.arc(x, y, 7.5 * dpr, 0, 7); g.stroke();
      const h = hexNow(); sw.style.background = h; if (document.activeElement !== hx) hx.value = h; v.value = Math.round(hsv.v * 100); v.style.background = `linear-gradient(90deg,#000,${hsv2hex(hsv.h, hsv.s, 1)})`; }
    const pick = () => { const h = hexNow(); addRecent(h); rec(); onPick(h); };
    function rec() { const L = recents(), r = box.querySelector(".cw13rec"); r.innerHTML = L.map((c) => `<i data-c="${c}" style="background:${c}" title="${c}"></i>`).join("") || '<span>Recent colours show here</span>'; r.querySelectorAll("i").forEach((i) => i.onclick = () => { hsv = hex2hsv(i.dataset.c); paint(); pick(); }); }
    const at = (e) => { const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1; hsv.h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; hsv.s = Math.min(1, Math.hypot(x, y)); if (hsv.v < 0.15) hsv.v = 1; paint(); };
    cv.onpointerdown = (e) => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} at(e); cv.onpointermove = (m) => at(m); cv.onpointerup = () => { cv.onpointermove = null; pick(); }; };
    v.oninput = () => { hsv.v = +v.value / 100; paint(); }; v.onchange = pick;
    hx.onkeydown = (e) => { if (e.key === "Enter") { const n = normHex(hx.value); if (n) { hsv = hex2hsv(n); paint(); pick(); } else hx.classList.add("bad"); } else hx.classList.remove("bad"); };
    hx.onchange = () => { const n = normHex(hx.value); if (n) { hsv = hex2hsv(n); paint(); pick(); } };
    paint(); rec(); return { set: (c) => { const n = normHex(c); if (n) { hsv = hex2hsv(n); paint(); } }, get: hexNow };
  }
  // the preset swatches everywhere become this popover (the callers' pick(colour) stays as it was)
  addEventListener("DOMContentLoaded", () => {
    if (typeof popAt !== "function") return;
    window.swatchPop = function (anchor, cur, pick) { return popAt(anchor, '<div class="cw13box"></div>', (p) => { p.classList.add("cwpop13"); colorPicker(p.querySelector(".cw13box"), cur, (c) => { closePops(); pick(c); }); }); };
  });

  // the landing line a timeline drag shows goes when the drag's tooltip does (the drag ended)
  addEventListener("DOMContentLoaded", () => { if (typeof window.hideTip === "function" && !window.hideTip._13) { const H0 = window.hideTip; window.hideTip = function () { const r = H0.apply(this, arguments); document.querySelectorAll(".gh12").forEach((g) => { g.style.display = "none"; }); return r; }; window.hideTip._13 = true; } });

  window.SL13 = { inkOn, colorPicker, hex2hsv, hsv2hex, chipFor, chip, chipMove, chipEnd, chipDrop, chipCancel, gap };
})();
