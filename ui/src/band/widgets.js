// set.Line 15 + 16: what a remote screen's widgets look like, in ONE place: the phones and tablets (band.html,
// client.ts) and the Remote page's editor (rm15.js, rw16.js: the canvas, the library's live miniatures, the inspector's
// style chips) all draw them with render() and the CSS below, so the editor shows exactly what the device will (live data
// when a song is loaded, sample data otherwise, never blank boxes).
// Also here: the devices a screen is made for, the screen grid, a widget's style and the automatic stacked phone layout.
// 16 §4 (docs/design/phase16/rw2.png): every widget has 2–3 built-in styles (VARIANTS: Big / Compact / one alternate),
// soft gradient boxes, consistent small-caps labels, bigger and bolder numbers (Outfit unless the widget's font says
// otherwise), and text that always fits its box: every size is measured (canvas) and wrapped, never cut off.
// Plain JavaScript (tests/band/logic.test.mjs runs the layout parts in Node).
import * as L from "./logic.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- devices
export const DEVICES = {
  iphone: { name: "iPhone", w: 390, h: 844, phone: true, safe: { top: 47, bottom: 34 }, grid: [6, 14] },
  iphoneL: { name: "iPhone (large)", w: 430, h: 932, phone: true, safe: { top: 59, bottom: 34 }, grid: [6, 14] },
  iphoneSE: { name: "iPhone SE", w: 375, h: 667, phone: true, safe: { top: 20, bottom: 0 }, grid: [6, 12] },
  ipad: { name: "iPad", w: 768, h: 1024, safe: { top: 24, bottom: 20 }, grid: [12, 9] },
  ipadMini: { name: "iPad mini", w: 744, h: 1133, safe: { top: 24, bottom: 20 }, grid: [12, 9] },
  laptop: { name: "Laptop", w: 800, h: 1280, safe: { top: 0, bottom: 0 }, grid: [16, 10] },
  custom: { name: "Custom…", w: 600, h: 900, safe: { top: 0, bottom: 0 }, grid: [12, 9] },
};
// screens made before 15 kept their device as ipad / phone / tablet / desktop
const OLD = { phone: "iphone", tablet: "ipad", desktop: "laptop" };
export const deviceKey = (k) => (DEVICES[k] ? k : OLD[k] || "ipad");
export const deviceOf = (screen) => { const k = deviceKey(screen && screen.device), d = DEVICES[k]; return k === "custom" && screen.size ? { ...d, w: +screen.size.w || d.w, h: +screen.size.h || d.h } : d; };
export const isPhoneScreen = (screen) => !!deviceOf(screen).phone;
// the size (CSS px) of the canvas for a screen in an orientation ("land" | "port")
export function canvasSize(screen, ori) { const d = deviceOf(screen), a = Math.min(d.w, d.h), b = Math.max(d.w, d.h); return ori === "land" ? { w: b, h: a } : { w: a, h: b }; }

// ---------------------------------------------------------------- the grid
export function gridOf(screen) {
  const g = (screen && screen.grid) || {};
  return { cols: Math.max(2, Math.min(48, +g.cols || 12)), rows: Math.max(2, Math.min(48, +g.rows || 9)), gap: Math.max(0, Math.min(24, g.gap === undefined ? 6 : +g.gap)), snap: g.snap !== false, guides: g.guides !== false };
}
// a new grid size: every widget keeps its place on the screen (scaled, rounded to the new cells)
export function regrid(list, from, to) {
  for (const w of list || []) {
    const fx = to.cols / from.cols, fy = to.rows / from.rows;
    w.x = Math.round(w.x * fx); w.y = Math.round(w.y * fy); w.w = Math.max(1, Math.round(w.w * fx)); w.h = Math.max(1, Math.round(w.h * fy));
    clamp(w, to);
  }
  return list;
}
// fits a widget inside the grid; free (no grid snap): keeps fractions of a cell
export function clamp(w, g, free) {
  const r = (v) => (free ? Math.round(v * 10000) / 10000 : Math.round(v));
  w.w = Math.max(free ? 0.25 : 1, Math.min(g.cols, r(w.w))); w.h = Math.max(free ? 0.25 : 1, Math.min(g.rows, r(w.h)));
  w.x = Math.max(0, Math.min(g.cols - w.w, r(w.x))); w.y = Math.max(0, Math.min(g.rows - w.h, r(w.y)));
  return w;
}

// ---------------------------------------------------------------- 16 §4 the styles
// The built-in styles of each widget: [key, name]. The first is the default (and what screens made before 16 show).
const T3 = [["big", "Big"], ["compact", "Compact"], ["ring", "Ring"]];
const BTN = [["big", "Big"], ["compact", "Compact"], ["hold", "Hold to press"]];
const VAL = [["big", "Big"], ["compact", "Compact"], ["sec", "Section colour"]];
export const VARIANTS = {
  song: [["big", "Big"], ["compact", "Compact"], ["sec", "Section colour"]],
  bpm: [["big", "Big"], ["compact", "Compact"], ["lights", "Beat lights"]],
  clock: T3, songLeft: T3, setLeft: T3, barsLeft: T3, curfew: T3,
  playStop: [["big", "Big"], ["compact", "Play + Sync MIDI"], ["hold", "Hold to stop"]],
  nextSong: BTN, prevSong: BTN, soundcheck: BTN, exitLoop: BTN, vamp: BTN, verFlip: BTN, midiBtn: BTN, syncMidi: BTN,
  cueFeed: [["big", "Big word"], ["compact", "Countdown"], ["flash", "Flash"]],
  setlist: [["big", "Big"], ["compact", "Compact"], ["now", "Now / next"]],
  next: [["big", "Big"], ["compact", "Compact"], ["count", "Countdown"]],
  sections: [["big", "Big"], ["compact", "Compact"], ["strip", "Timeline"]],
  notes: VAL, nextSec: VAL, field: VAL, patch: VAL, changes: VAL, label: VAL, until: VAL,
  timeline: [["big", "Big"], ["compact", "Compact"], ["sec", "Section colours"]],
  beats: [["big", "Big"], ["compact", "Dots"], ["num", "Beat number"]],
  countIn: [["big", "Big"], ["compact", "Compact"]],
  status: [["big", "Big"], ["compact", "Compact"]], statusShow: [["big", "Big"], ["compact", "Compact"]],
  checklist: [["big", "Big"], ["compact", "Compact"]], conn: [["big", "Big"], ["compact", "Compact"]],
};
export const variantsOf = (type) => VARIANTS[type] || [["big", "Big"]];
export const variantOf = (w) => { const v = w && w.v, list = variantsOf(w && w.type); return list.some((x) => x[0] === v) ? v : list[0][0]; };

// ---------------------------------------------------------------- a widget's look (st)
// bg: "solid" | "none" | "#rrggbb", op: 0..100 (the background's opacity), border, shadow (text shadow),
// al: "" | "tl" … "br" (where the content sits), and 16 §3: pad (px), rad (corner radius, px), size: "auto" | px (the
// main text; never more than fits), wt: "" | "regular" | "bold" | "heavy", lab: "top" | "bottom" | "hidden" (the
// label), font: "" (Outfit for numbers, the app's title font for names) | a font name, fg (text colour), acc (accent
// colour), sec: true / false / undefined (the accent follows the current section's colour; undefined = the widget's
// own default).
export const STYLE0 = { bg: "solid", op: 100, border: false, shadow: false, al: "", pad: 10, rad: 14, size: "auto", wt: "", lab: "top", font: "", fg: "", acc: "", sec: undefined };
export const styleOf = (w) => ({ ...STYLE0, ...((w && w.st) || {}) });
export const FONTS = ["Outfit", "Inter", "Big Shoulders Display", "Bricolage Grotesque", "Instrument Sans", "Montserrat", "Archivo Black", "Anton", "Tektur", "National Park", "Smooch Sans", "Gloock", "Pixelify Sans", "Erica One", "System"];
// (single quotes: these go inside style="…" attributes)
const UI = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif";
const famCss = (f) => (!f || f === "System" ? UI : `'${f}', ${UI}`);
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (h, a) => { const c = hexRgb(h) || [255, 159, 10]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
const light = (h) => { const c = hexRgb(h); if (!c) return false; return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.55; };
// the inline style of a widget's box (.s5wi)
export function boxStyle(w) {
  const s = styleOf(w), out = [], op = s.bg === "none" ? 0 : Math.max(0, Math.min(100, +s.op)) / 100;
  if (s.bg === "none") out.push("background:transparent");
  else if (s.bg === "solid") out.push(`background-color:rgba(24,24,27,${op});background-image:linear-gradient(180deg,rgba(40,40,46,${op}) 0%,rgba(20,20,23,${op}) 100%)`);
  else { const c = hexRgb(s.bg) || [24, 24, 27], hi = c.map((v) => Math.min(255, Math.round(v + (255 - v) * 0.12))); out.push(`background-color:rgba(${c.join(",")},${op});background-image:linear-gradient(180deg,rgba(${hi.join(",")},${op}) 0%,rgba(${c.join(",")},${op}) 100%)`); }
  out.push(`border-radius:${Math.max(0, Math.min(60, +s.rad || 0))}px`);
  if (s.border) out.push("box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.28)");
  else if (s.bg !== "none") out.push(`box-shadow:inset 0 0 0 1px rgba(255,255,255,${(0.07 * op).toFixed(3)})`);
  if (s.shadow) out.push("text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 10px rgba(0,0,0,.7)");
  if (s.fg) out.push(`color:${s.fg}`);
  const al = s.al || "";
  if (al) { const v = { t: "flex-start", m: "center", b: "flex-end" }[al[0]], h = { l: "left", c: "center", r: "right" }[al[1]], hi = { l: "flex-start", c: "center", r: "flex-end" }[al[1]];
    if (v) out.push(`justify-content:${v}`); if (h) out.push(`text-align:${h};align-items:${hi}`); }
  return out.join(";");
}

// ---------------------------------------------------------------- the automatic phone layout
const PH = {
  song: [6, 3], next: [6, 2], timeline: [6, 1], beats: [6, 1], changes: [6, 1], countIn: [6, 1], cueFeed: [6, 2], label: [6, 1],
  until: [6, 3], setlist: [6, 4], notes: [6, 2], status: [6, 2], checklist: [6, 3], sections: [6, 4],
  bpm: [3, 2], clock: [3, 2], barsLeft: [3, 2], nextSec: [3, 2], songLeft: [3, 2], setLeft: [3, 2], curfew: [3, 2], field: [3, 2], patch: [3, 2], statusShow: [3, 2], conn: [3, 1],
  playStop: [3, 2], syncMidi: [3, 2], vamp: [3, 2], exitLoop: [3, 2], soundcheck: [3, 2], midiBtn: [3, 2], verFlip: [3, 2], nextSong: [2, 2], prevSong: [2, 2],
};
export const phoneSize = (type) => PH[type] || [6, 2];
export function stackLayout(list, cols = 6) {
  const src = [...(list || [])].sort((a, b) => a.y - b.y || a.x - b.x), out = [];
  let y = 0, x = 0, rowH = 0;
  const flush = () => { if (x > 0) { y += rowH; x = 0; rowH = 0; } };
  const wOf = (w) => Math.max(1, Math.round((PH[w.type] || [6, 2])[0] * cols / 6));
  // a side-by-side widget never sits alone: the next one that fits (a few widgets on) moves up beside it
  for (let i = 0; i < src.length; i++) {
    let used = 0, j = i;
    while (j < src.length && wOf(src[j]) < cols && used + wOf(src[j]) <= cols) { used += wOf(src[j]); j++; }
    if (j === i || used >= cols) { i = Math.max(i, j - 1); continue; }
    for (let k = j; k < Math.min(src.length, j + 4) && used < cols; k++) { const ww = wOf(src[k]); if (ww < cols && used + ww <= cols) { const [x] = src.splice(k, 1); src.splice(j, 0, x); used += ww; j++; } }
    i = j - 1;
  }
  for (const w of src) {
    const [, ph] = PH[w.type] || [6, 2], ww = wOf(w);
    if (ww >= cols) { flush(); out.push({ ...w, x: 0, y, w: cols, h: ph }); y += ph; continue; }
    if (x + ww > cols) flush();
    out.push({ ...w, x, y, w: ww, h: ph }); x += ww; rowH = Math.max(rowH, ph);
    if (x >= cols) flush();
  }
  flush();
  // a row that isn't full: its widgets share the width
  const rows = new Map(); for (const w of out) { const k = w.y; (rows.get(k) || rows.set(k, []).get(k)).push(w); }
  for (const r of rows.values()) { const used = r.reduce((a, w) => a + w.w, 0); if (used < cols && r.length > 1) { let xx = 0; r.forEach((w, i) => { const nw = i === r.length - 1 ? cols - xx : Math.round(w.w * cols / used); w.x = xx; w.w = nw; xx += nw; }); } else if (r.length === 1 && used < cols) { r[0].x = 0; r[0].w = cols; } }
  return { list: out, rows: Math.max(1, y) };
}

// ---------------------------------------------------------------- sample data (the editor with no song loaded)
export function sampleShow() {
  const bars = []; let t = 0; for (let i = 0; i < 96; i++) { bars.push([+t.toFixed(4), 4, 4, 156]); t += 4 * 60 / 156; }
  const sec = (id, name, type, b0, nb) => ({ id, name, type, t0: bars[b0 - 1][0], t1: (bars[b0 - 1 + nb] || [t])[0], bars: nb, notes: { drums: name === "Chorus" ? "Ride, push the fills" : "Hats, half time" } });
  const secs = [sec(1, "Intro", "intro", 1, 8), sec(2, "Verse A", "verse", 9, 16), sec(3, "Pre", "pre", 25, 8), sec(4, "Chorus", "chorus", 33, 16), sec(5, "Verse B", "verse", 49, 16), sec(6, "Bridge", "bridge", 65, 16), sec(7, "Outro", "outro", 81, 16)];
  const cues = secs.slice(1).map((s) => ({ t: s.t0, text: s.name.replace(/ [AB]$/, "") }));
  const songs = { s1: { name: "Mercy", len: 212, bars, secs, cues: [], patches: {}, fields: {} }, s2: { name: "Seneca", len: 227, bars, secs, cues: [], patches: {}, fields: {} },
    s3: { name: "NIHILOPHOBIA", len: 281, bars, secs, cues, patches: { "Brett · Quad Cortex": [{ t: 0, name: "Preset 17A · Scene B" }] }, fields: {} },
    s4: { name: "HAND OF FATE", len: 225, bars, secs, cues: [], patches: {}, fields: {} } };
  const order = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"].map((id) => ({ id, after: { mode: "stop" } }));
  for (let i = 5; i <= 11; i++) songs["s" + i] = { name: ["Proxima II", "Death Avenue", "End of Heartache", "Hourglass", "Garden", "Seneca II", "Line Check"][i - 5], len: 240, bars, secs, cues: [], patches: {}, fields: {} };
  return { t: "show", sample: true, setlist: { id: "L", name: "Winter run", finishBy: "", order }, songs, fields: [] };
}
export function sampleState() { return { cur: "s3", idx: 2, playing: true, soundcheck: null, vamp: null, loop: false, jumpQ: null, next: { id: "s4", name: "HAND OF FATE", vname: "" }, pos: 0, pc: false, tf: "" }; }

// ---------------------------------------------------------------- text that fits its box
let MC = null;
const MCACHE = new Map();
// the width of text at px (canvas: the same font the page draws with)
const measure = (text, px, weight, fam) => {
  try { if (!MC && typeof document !== "undefined") MC = document.createElement("canvas").getContext("2d"); } catch (e) { MC = null; }
  if (!MC) return String(text).length * px * 0.6;
  const k = `${weight}|${fam || ""}|${text}`; let w = MCACHE.get(k);
  if (w === undefined) { MC.font = `${weight || 700} 100px ${famCss(fam)}`; w = MC.measureText(String(text)).width / 100 * calib(weight, fam); if (MCACHE.size > 4000) MCACHE.clear(); MCACHE.set(k, w); }
  return w * px;
};
// the canvas and the page don't always draw a font alike (Chrome on macOS: the system font): each font is measured
// once both ways and the canvas's widths corrected (never made smaller: that's the safe side)
const CAL = new Map();
function calib(weight, fam) {
  const k = `${weight}|${fam || ""}`; let c = CAL.get(k); if (c !== undefined) return c;
  c = 1;
  try { if (document.body) { const s = document.createElement("span"), t = "Mercy Dies With You · 0123456789 hold to press";
    s.style.cssText = `position:absolute;left:-9999px;top:0;white-space:nowrap;font:${weight || 700} 100px ${famCss(fam)};letter-spacing:0`; s.textContent = t; document.body.appendChild(s);
    MC.font = `${weight || 700} 100px ${famCss(fam)}`; const cw = MC.measureText(t).width, dw = s.getBoundingClientRect().width; s.remove(); if (cw > 0 && dw > 0) c = Math.max(1, dw / cw); } } catch (e) { c = 1; }
  CAL.set(k, c); return c;
}
// the fonts arrive after the first frames: the sizes are measured again then
export function fontsChanged() { MCACHE.clear(); CAL.clear(); }
if (typeof document !== "undefined" && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", fontsChanged);
// the biggest font size (px) at which text fits w x h on one line (fam: the font; min: the smallest size)
export function fit(text, w, h, lines = 1, max = 400, weight = 700, fam = "", min = 10) {
  const s = String(text || " "), byH = (h / lines) * 0.82, at = Math.max(min, Math.min(max, byH));
  const width = measure(s, 1, weight, fam);
  if (width <= 0) return at;
  return Math.max(min, Math.min(at, (w * lines * 0.95) / width));
}
// the biggest font size at which text, wrapped at spaces, fits w x h (lh: line height) -> {px, lines}
export function fitWrap(text, w, h, max = 400, weight = 700, fam = "", lh = 1.1, min = 6) {
  const words = String(text || " ").split(/\s+/).filter(Boolean); if (!words.length) return { px: Math.max(min, Math.min(max, h / lh * 0.9)), lines: 1 };
  const ww = words.map((x) => measure(x, 1, weight, fam)), sp = measure(" ", 1, weight, fam) || 0.28, longest = Math.max(...ww);
  const linesAt = (px) => { let n = 1, cur = 0; for (const x of ww) { if (cur && (cur + sp + x) * px > w * 0.95) { n++; cur = x; } else cur += (cur ? sp : 0) + x; } return n; };
  const ok = (px) => longest * px <= w * 0.95 && linesAt(px) * px * lh <= h * 0.97;
  let lo = min, hi = Math.max(min, Math.min(max, h / lh));
  if (ok(hi)) return { px: hi, lines: linesAt(hi) };
  for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return { px: lo, lines: linesAt(lo) };
}

// ---------------------------------------------------------------- the widgets
// The widgets whose picture changes with the song position (drawn every frame); the others redraw when the setlist or
// the live state changes (a few times a second at most).
export const LIVE = new Set(["song", "next", "timeline", "beats", "barsLeft", "nextSec", "songLeft", "setLeft", "until", "clock", "curfew", "cueFeed", "patch", "field", "changes", "countIn", "notes", "bpm", "playStop", "vamp", "sections"]);
export const SECCOL = { intro: "#6b7cff", verse: "#22c3a6", pre: "#a06bff", chorus: "#f5a524", bridge: "#ff5fa2", outro: "#8a93a6", solo: "#ff7a45", "count-in": "#3a3f48", x: "#5a5a62" };
const secColOf = (s) => (s ? s.col || SECCOL[s.type] || "#22c3a6" : "#22c3a6");
// the accent follows the section's colour by default on these
const SECDEF = new Set(["song", "nextSec", "notes", "timeline", "sections", "cueFeed", "label", "field", "patch", "changes", "until"]);
const BTNCOL = { playStop: "#30d158", nextSong: "#0a84ff", prevSong: "#0a84ff", soundcheck: "#0a84ff", exitLoop: "#ff9f0a", vamp: "#bf5af2", verFlip: "#64d2ff", midiBtn: "#8e8e96", syncMidi: "#30d158" };
const WT = { regular: 500, bold: 700, heavy: 800 };
const clockText = (d, secs) => { const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), h12 = ((h + 11) % 12) + 1, ampm = h < 12 ? "AM" : "PM";
  return { main: `${h12}:${String(m).padStart(2, "0")}${secs ? ":" + String(s).padStart(2, "0") : ""}`, sub: ampm }; };
const ring = (p, size, col) => { const r = 42, c = 2 * Math.PI * r, k = Math.max(0, Math.min(1, p || 0));
  return `<svg class="s5ring" viewBox="0 0 100 100" width="${size.toFixed(1)}" height="${size.toFixed(1)}"><circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="9"/><circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(c * k).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 50 50)"/></svg>`; };
const px1 = (v) => Math.max(0, v).toFixed(1) + "px";
const digits0 = (t) => String(t).replace(/[0-9]/g, "0");

// One widget's inside. env: {show, st, pos, song, bb, sec, nsec, r: {width, height} (the box), now: Date ms, connected,
// rtt, statuses, myStatus, checklist, acks, ask (this widget is asking "tap again"), hold (0..1: being held), editor}.
// -> {html, flush: true when the content fills the box edge to edge (buttons), top: a list (starts at the top)}
export function render(w, env) {
  const { show, pos, song, bb, sec, nsec } = env, st = env.st || { playing: false }, cfg = w.cfg || {}, def = L.WIDGETS[w.type] || { name: w.type };
  const s = styleOf(w), v = variantOf(w), r = env.r || { width: 200, height: 100 };
  const pad = Math.max(2, Math.min(+s.pad >= 0 ? +s.pad : 10, r.height * 0.14, r.width * 0.1));
  const W = Math.max(8, r.width - 2 * pad), H = Math.max(8, r.height - 2 * pad);
  const numF = s.font || "Outfit", titleF = s.font || st.tf || "Outfit", uiF = s.font && s.font !== "System" ? s.font : "";
  const wt = (d) => WT[s.wt] || d, fixed = s.size !== "auto" && +s.size > 0 ? +s.size : 0;
  const useSec = s.sec === undefined || s.sec === null ? SECDEF.has(w.type) : !!s.sec;
  const scol = secColOf(sec), acc = useSec ? scol : s.acc || (w.type === "cueFeed" || w.type === "bpm" ? "#ff9f0a" : "#22c3a6");
  const why = env.acks && env.acks[w.id] ? `<div class="s5why">${esc(env.acks[w.id])}</div>` : "";
  const fam = (f) => `font-family:${famCss(f)}`;
  const capOn = s.lab !== "hidden";
  const capPx = Math.max(7, Math.min(13, H * 0.13)), subPx = Math.max(8, Math.min(20, H * 0.15));
  const small = (txt, size, maxW, weight = 600, f = uiF) => Math.max(5, Math.min(size, fit(txt, maxW, size * 1.3, 1, size, weight, f, 5)));
  // a label: small caps, letter-spaced (measured with room for the spacing)
  const capH = (txt, maxW = W, col = "") => `<div class="s5cap" style="font-size:${px1(small(String(txt).toUpperCase() + "   ", capPx, maxW * 0.86, 650))}${col ? ";color:" + col : ""}">${esc(txt)}</div>`;
  const subH = (html, plain, maxW = W, col = "") => `<div class="s5sub" style="font-size:${px1(small(plain, subPx, maxW))}${col ? ";color:" + col : ""}">${html}</div>`;
  // the big value: one line, or wrapped at spaces (lines > 1)
  const bigH = (txt, bw, bh, o = {}) => { const f = o.f || numF, weight = wt(o.wt || 700), max = Math.min(o.max || 400, fixed || 400), t = txt || "–";
    if ((o.lines || 1) > 1) { const fw = fitWrap(t, bw, bh, max, weight, f, 1.08, 6); return `<div class="s5big s5wrap ${o.cls || ""}" style="${fam(f)};font-weight:${weight};font-size:${px1(fw.px)};line-height:1.08${o.col ? ";color:" + o.col : ""}">${esc(t)}</div>`; }
    const px = fit(o.measure || t, bw, bh, 1, max, weight, f, 6); return `<div class="s5big ${o.cls || ""}" style="${fam(f)};font-weight:${weight};font-size:${px1(px)}${o.col ? ";color:" + o.col : ""}">${o.html || esc(t)}</div>`; };
  // a column: label, the big value, a line under it, a progress bar; parts drop out (the line, then the label, then
  // the bar) when the box is too short for them
  const column = (o) => { let cap = capOn && o.cap ? o.cap : "", sub = o.sub || "", bar = o.bar === undefined || o.bar === null ? null : o.bar;
    const barH = Math.max(4, Math.min(8, H * 0.05));
    const need = () => (cap ? capPx * 1.3 + 2 : 0) + (sub ? subPx * 1.25 + 2 : 0) + (bar !== null ? barH + 8 : 0);
    if (sub && H - need() < H * 0.42) sub = ""; if (cap && H - need() < H * 0.42) cap = ""; if (bar !== null && H - need() < H * 0.45) bar = null;
    const bh = Math.max(6, H - need()), bw = o.bw || W;
    const parts = [cap ? capH(cap, W, o.capCol) : "", bigH(o.big, bw, bh, o), sub ? subH(o.subHtml || esc(sub), sub, W, o.subCol) : "", bar !== null ? `<div class="s5bar" style="height:${px1(barH)};width:${o.barW || "100%"}"><i style="width:${(Math.max(0, Math.min(1, bar)) * 100).toFixed(1)}%;background:${o.barCol || acc}"></i></div>` : ""];
    if (s.lab === "bottom" && cap) parts.push(parts.shift());
    return parts.join(""); };
  // the box's inside: the padding and where the content sits (the style's alignment wins over the variant's)
  const wrap = (html, o = {}) => { const al = s.al ? "" : `justify-content:${o.v || "center"};align-items:${o.h || "center"};text-align:${o.t || "center"}`;
    return `${o.bg || ""}<div class="s5in ${o.cls ? "s5" + o.cls : ""}" style="padding:${px1(o.pad === undefined ? pad : o.pad)};${al}${o.gap ? ";gap:" + o.gap : ""}">${html}</div>`; };
  const tint = (c) => `<i class="s5tint" style="background-image:linear-gradient(100deg,${rgba(c, 0.32)} 0%,${rgba(c, 0.05)} 75%)"></i><i class="s5stripe" style="background:${c}"></i>`;
  // a side-by-side pair: [label, value] | [label, value] with a line between
  const pair = (a, b) => { const cw = W / 2 - 12, hh = H - (capOn ? capPx * 1.3 + 2 : 0);
    const one = (x) => `<div class="s5half">${capOn ? capH(x.cap, cw) : ""}${bigH(x.big, cw, hh, { wt: x.wt || 800, measure: x.measure })}</div>`;
    return wrap(`${one(a)}<i class="s5div"></i>${one(b)}`, { cls: "row" }); };
  const fieldOf = (sid, f) => (sid && show ? L.fieldValue(show, sid, f) : "");
  const fname = (f) => ((show && show.fields) || []).find((x) => x.id === f)?.name || "Field";
  const barOfSec = () => (sec && song && bb ? { at: bb.bar - L.barBeatAt(song, sec.t0 + 1e-6).bar + 1, of: sec.bars || 1 } : null);
  const barsTo = (t) => (song && bb ? Math.max(0, L.barBeatAt(song, t - 1e-6).bar - bb.bar + 1) : 0);
  const order = (show && show.setlist && show.setlist.order) || [];
  const songP = song ? Math.max(0, Math.min(1, pos / Math.max(1, song.len))) : 0;
  const secP = sec ? Math.max(0, Math.min(1, (pos - sec.t0) / Math.max(0.01, sec.t1 - sec.t0))) : 0;
  const setP = () => { if (!show || st.idx < 0) return 0; let a = 0, b = 0; order.forEach((o, i) => { const x = show.songs[o.id]; if (!x) return; b += x.len; if (i < st.idx) a += x.len; else if (i === st.idx) a += Math.min(x.len, pos); }); return b ? a / b : 0; };

  // the generic "value" widget: Big (centred), Compact (the value | its label and line), Section colour (stripe + tint)
  const value = (o) => {
    if (v === "compact") { const lw = Math.min(W * 0.42, Math.max(W * 0.28, 60)), vw = W - lw - 10;
      const right = `${capOn && o.cap ? capH(o.cap, lw) : ""}${o.sub ? subH(esc(o.sub), o.sub, lw) : ""}`;
      return wrap(`<div class="s5half s5grow s5l">${bigH(o.big, right ? vw : W, H, o)}</div>${right ? `<div class="s5half s5side">${right}</div>` : ""}`, { cls: "row" }); }
    if (v === "sec") return wrap(column({ ...o, capCol: acc }), { bg: tint(acc), h: "flex-start", t: "left", pad: pad + 5 });
    return wrap(column(o));
  };
  // a button that fills its box (Big: filled; Compact: dark with the colour as text; Hold: held to press)
  const button = (label, sub = "", o = {}) => { const col = o.col || (cfg.col && cfg.col !== "#3a3a40" ? cfg.col : s.acc || BTNCOL[w.type] || "#3a3a40");
    const lab = env.ask ? "Tap again" : label, hold = v === "hold" && !o.noHold, kind = o.kind || (hold ? "hold" : v === "compact" ? "compact" : "big");
    const bw = r.width - 24, bh = r.height * (sub || hold ? 0.44 : 0.56), fs = fit(lab, bw, bh, 1, Math.min(fixed || 64, 64), wt(800), uiF, 7);
    const subTxt = hold ? o.holdSub || "hold to press · tap does nothing" : sub, ss = subTxt ? small(subTxt, Math.max(8, Math.min(16, r.height * 0.13)), bw, 600) : 0;
    const bg = kind === "big" ? `background:${col};color:${light(col) ? "#0b0b0c" : "#fff"}` : kind === "hold" ? `background:${rgba(col, 0.16)};box-shadow:inset 0 0 0 1.5px ${rgba(col, 0.75)};color:${col}` : `color:${col}`;
    return { flush: true, html: `<div class="s5wbtn s5k${kind} ${o.on ? "on" : ""} ${o.dis ? "dis" : ""} ${env.ask ? "ask" : ""} ${hold ? "s5hold" : ""}" ${hold ? 'data-hold="1"' : ""} style="${bg};font-size:${px1(fs)};${fam(uiF)};font-weight:${wt(800)}">${hold ? '<i class="s5holdbar"></i>' : ""}<span>${esc(lab)}</span>${subTxt ? `<small style="font-size:${px1(ss)}">${esc(subTxt)}</small>` : ""}</div>${why}` }; };

  let h = "";
  switch (w.type) {
    case "song": {
      const name = song ? song.name : "No song", n = order.length, at = barOfSec();
      if (v === "compact") {
        const nx = nsec ? nsec.name : "", i = st.idx >= 0 && n ? `${st.idx + 1}/${n}` : "", ip = subPx * 0.9, iw = i ? measure(i, ip, 600, uiF) + 10 : 0;
        const showLine = H > 40, showBar = H > 58 && !!sec, tH = H - (showLine ? subPx * 1.3 + 4 : 0) - (showBar ? 12 : 0);
        const tpx = fit(name, W - iw, tH, 1, Math.min(fixed || 400, 400), wt(800), titleF, 6), lineTxt = `${sec ? sec.name : ""}    next: ${nx}`;
        h = wrap(`<div class="s5line"><span class="s5big" style="${fam(titleF)};font-weight:${wt(800)};font-size:${px1(tpx)}">${esc(name)}</span>${i ? `<span class="s5m" style="font-size:${px1(ip)}">${i}</span>` : ""}</div>`
          + (showLine ? `<div class="s5line" style="font-size:${px1(small(lineTxt, subPx, W))}"><span style="color:${acc};font-weight:700">${esc(sec ? sec.name : "")}</span>${nx ? `<span class="s5m">next: ${esc(nx)}</span>` : ""}</div>` : "")
          + (showBar ? `<div class="s5bar" style="height:${px1(Math.max(4, H * 0.05))};width:100%"><i style="width:${(secP * 100).toFixed(1)}%;background:${acc}"></i></div>` : ""), { h: "stretch", t: "left", gap: "3px" });
        break; }
      if (v === "sec") {
        const nb = nsec && song ? barsTo(nsec.t0) : 0, capT = sec ? `${sec.name}${at ? ` · bar ${at.at}` : ""}` : "Now";
        const subT = nsec ? `next: ${nsec.name} in ${nb} bar${nb === 1 ? "" : "s"}` : "", subHTML = nsec ? `next: <b style="color:${secColOf(nsec)}">${esc(nsec.name)}</b> in ${nb} bar${nb === 1 ? "" : "s"}` : "";
        h = wrap(column({ cap: capT, capCol: acc, big: name, lines: 2, f: titleF, wt: 800, sub: subT, subHtml: subHTML }), { bg: tint(acc), h: "flex-start", t: "left", pad: pad + 5 });
        break; }
      const cap = st.idx >= 0 && n ? `Now · ${st.idx + 1} of ${n}` : "Now", sub = sec ? `${sec.name}${at ? ` · bar ${at.at} of ${at.of}` : ""}` : bb ? `${+bb.bpm.toFixed(1)} BPM` : "";
      h = wrap(column({ cap, big: name, lines: 2, f: titleF, wt: 800, cls: "stitle", sub, subCol: acc })); break; }
    case "bpm": {
      const bpm = bb ? `${Math.abs(bb.bpm - Math.round(bb.bpm)) < 0.05 ? Math.round(bb.bpm) : +bb.bpm.toFixed(1)}` : "–", m = bb ? `${bb.num}/${bb.den}` : "";
      if (v === "compact") { const sw = Math.max(30, W * 0.26), nw = W - sw - 10;
        const side = `${capOn ? `<div class="s5cap" style="font-size:${px1(small("BPM   ", subPx, sw, 650))}">BPM</div>` : ""}<div class="s5sub" style="font-size:${px1(small(m, subPx, sw))}">${esc(m)}</div>`;
        h = wrap(`<div class="s5half" style="flex:0 1 auto">${bigH(bpm, nw, H, { wt: 800, measure: digits0(bpm) })}</div><div class="s5half s5side">${side}</div>`, { cls: "row" }); break; }
      if (v === "lights") { const n = bb ? bb.num : 4, k = bb && st.playing ? Math.floor(bb.beat) : 1, dot = Math.max(5, Math.min(H * 0.3, (W - (n - 1) * 8) / n * 0.75, 28));
        const lh = H - dot - 8, txt = `${bpm} · ${m}`;
        h = wrap(`<div class="s5dots" style="gap:${px1(dot * 0.45)}">${Array.from({ length: n }, (_, i) => `<i style="width:${px1(dot)};height:${px1(dot)}" class="${i + 1 === k ? "on" : ""} ${i === 0 ? "one" : ""}"></i>`).join("")}</div>${lh > 10 ? bigH(txt, W, lh, { wt: 800, html: `${esc(bpm)}<small> · ${esc(m)}</small>`, measure: digits0(bpm) + " · 0/0" }) : ""}`, { gap: px1(Math.max(2, H * 0.06)) }); break; }
      h = wrap(column({ cap: "Tempo", big: bpm, wt: 800, sub: m, measure: digits0(bpm) })); break; }
    case "clock": case "songLeft": case "setLeft": case "barsLeft": case "curfew": {
      const c = clockText(new Date(env.now), !!cfg.secs), sl = song ? L.fmtTime(Math.max(0, song.len - pos)) : "–";
      const cf = show ? L.curfew(show, st.idx, pos, env.now, w.type === "curfew" ? show.setlist.finishBy : "") : null;
      const left = sec && bb && song ? Math.max(0, L.barBeatAt(song, sec.t1 - 1e-6).bar - bb.bar + 1) : null, bbTxt = bb ? `${bb.bar}.${Math.floor(bb.beat)}` : "–";
      let me;
      if (w.type === "clock") me = { cap: "Clock", big: c.main, html: `${esc(c.main)}<small>${c.sub}</small>`, measure: digits0(c.main) + "   ", wt: 400, p: songP };
      else if (w.type === "songLeft") me = { cap: "Time left", big: sl, sub: song ? `of ${L.fmtTime(song.len)}` : "", measure: digits0(sl), p: songP };
      else if (w.type === "setLeft") me = { cap: "Set left", big: cf ? L.fmtTime(cf.leftSec) : "–", sub: cf && cf.talking ? "+ talking" : "", p: setP() };
      else if (w.type === "barsLeft") me = { cap: "Bars left", big: left === null ? "–" : String(left), sub: sec ? sec.name : "", measure: "00", p: secP };
      else { const fb = show && show.setlist.finishBy; if (!cf || cf.overSec === null) me = { cap: "Curfew", big: "–", sub: "no finish time set", p: setP() };
        else { const over = cf.overSec > 0; me = { cap: `Curfew ${fb}`, big: `${over ? "+" : "−"}${L.fmtTime(Math.abs(cf.overSec))}`, col: over ? "#ff453a" : "#30d158", sub: `${over ? "over" : "under"}${cf.talking ? " + talking" : ""}`, p: setP() }; } }
      if (v === "compact") { const other = w.type === "clock" ? { cap: "Left", big: sl, measure: digits0(sl) } : w.type === "barsLeft" ? { cap: "Bar.beat", big: bbTxt } : { cap: "Clock", big: c.main, wt: 400, measure: digits0(c.main) };
        h = pair({ cap: w.type === "songLeft" ? "Left" : me.cap, big: me.big, wt: me.wt, measure: me.measure }, other); break; }
      if (v === "ring") { const sz = Math.max(16, Math.min(H, W * 0.42)), tw = W - sz - 12, isClock = w.type === "clock";
        const val = isClock ? bbTxt : me.big, cap = isClock ? "Bar.beat" : me.cap, hh = H - (capOn ? capPx * 1.3 + 2 : 0);
        h = wrap(`${ring(me.p, sz, acc)}<div class="s5half s5side s5l">${capOn ? capH(cap, tw) : ""}${bigH(val, tw, hh, { wt: 800, col: me.col, measure: isClock ? "000.0" : me.measure })}</div>`, { cls: "row", gap: "12px" }); break; }
      h = wrap(column({ cap: me.cap, big: me.big, html: me.html, measure: me.measure, wt: me.wt || 800, col: me.col, sub: me.sub, cls: w.type === "clock" ? "clk" : "", bar: w.type === "clock" ? null : me.p, barW: "78%", barCol: w.type === "songLeft" ? "#f2f2f4" : acc })); break; }
    case "next": { const n = st.next, a = show && st.idx >= 0 ? (order[st.idx] || {}).after : null;
      const how = n ? [n.vname, a ? (a.mode === "segue" ? "segue" : a.mode === "auto" ? `auto after ${a.sec || 0} s` : "") : ""].filter(Boolean).join(" · ") : "";
      if (v === "count") { const left = song ? L.fmtTime(Math.max(0, song.len - pos)) : ""; h = wrap(column({ cap: n && left ? `Next · in ${left}` : "Next", big: n ? n.name : "End of set", lines: 2, f: titleF, wt: 800, sub: how || (n ? "after this song" : ""), bar: song ? songP : null, barW: "80%" })); break; }
      h = value({ cap: "Next", big: n ? n.name : "End of set", lines: v === "compact" ? 1 : 2, f: titleF, wt: 800, sub: how }); break; }
    case "timeline": {
      if (!song) { h = wrap(bigH("–", W, H)); break; }
      const list = song.secs, compact = v === "compact", lblH = compact ? Math.max(0, Math.min(18, H * 0.45)) : 0, hh = compact ? Math.max(6, Math.min(H - lblH - 4, 14)) : H;
      const tot = list.reduce((a, x) => a + (x.bars || 1), 0) || 1, usable = W - 3 * (list.length - 1);
      const segs = list.map((x) => { const on = sec && x.t0 === sec.t0, sw = usable * (x.bars || 1) / tot, c = secColOf(x);
        const fs = compact ? 0 : Math.min(15, fit(x.name, sw - 6, hh, 1, 15, 700, uiF, 0)), showName = fs >= 7;
        const bg = v === "sec" ? `background:${on ? c : rgba(c, 0.45)}` : on ? `background:${acc}` : "";
        return `<div class="${on ? "on" : ""} ${(st.jumpQ != null && st.jumpQ === x.id) ? "q" : ""}" style="flex:${x.bars || 1};${bg}">${on ? `<i class="s5tlp"></i>` : ""}${showName ? `<span style="font-size:${px1(fs)}">${esc(x.name)}</span>` : ""}</div>`; }).join("");
      const lt = sec ? `${sec.name}    → ${nsec ? nsec.name : ""}` : "", lbl = compact && sec && lblH >= 8 ? `<div class="s5line" style="font-size:${px1(small(lt, lblH * 0.8, W))}"><b style="color:${acc}">${esc(sec.name)}</b>${nsec ? `<span class="s5m">→ ${esc(nsec.name)}</span>` : ""}</div>` : "";
      h = wrap(`${lbl}<div class="s5tl s5v${v}" style="height:${px1(hh)}">${segs}</div>`, { h: "stretch", gap: "3px" }); break; }
    case "beats": { const n = bb ? bb.num : 4; let k = bb && st.playing ? Math.floor(bb.beat) : 0;
      if (song && song.hits && bb && st.playing) { const hit = L.hitAt(song, pos); k = hit && hit[0] >= bb.barT - 1e-4 ? (hit[1] ? 1 : Math.floor(L.barBeatAt(song, hit[0]).beat)) : 0; }
      if (v === "num") { h = wrap(column({ cap: "Beat", big: k ? String(k) : "–", wt: 800, sub: `of ${n}`, col: k === 1 ? "#ff9f0a" : "" })); break; }
      if (v === "compact") { const dot = Math.max(5, Math.min(H * 0.7, (W - (n - 1) * 8) / n * 0.7, 30)); h = wrap(`<div class="s5dots" style="gap:${px1(dot * 0.5)}">${Array.from({ length: n }, (_, i) => `<i style="width:${px1(dot)};height:${px1(dot)}" class="${i + 1 === k ? "on" : ""} ${i === 0 ? "one" : ""}"></i>`).join("")}</div>`); break; }
      return { html: `<div class="s5beats">${Array.from({ length: n }, (_, i) => `<i class="${i + 1 === k ? "on" : ""} ${i === 0 ? "one" : ""}"></i>`).join("")}</div>`, flush: true }; }
    case "nextSec": { const nb = nsec && song ? barsTo(nsec.t0) : 0; h = value({ cap: "Next section", big: nsec ? nsec.name : "–", sub: nsec ? `in ${nb} bar${nb === 1 ? "" : "s"}` : "", col: nsec && v !== "sec" ? secColOf(nsec) : "", f: titleF, wt: 800 }); break; }
    case "countIn": h = wrap(column({ cap: "Count-in", big: sec && sec.type === "count-in" && bb ? String(Math.floor(bb.beat)) : "1 2 3 4", wt: 800, sub: sec && sec.type === "count-in" ? "now" : v === "compact" ? "" : "full screen when it plays" })); break;
    case "changes": { const c = song ? L.changesAhead(song, pos, cfg.bars || 4) : []; h = value({ cap: "Coming up", big: c.length ? c.map((x) => x.text).join(" · ") : "No changes ahead", lines: 2, f: uiF, wt: 700 }); break; }
    case "field": { const sid = cfg.which === "next" ? st.next && st.next.id : st.cur;
      const val = cfg.field ? (cfg.which !== "next" && sid && show ? L.fieldValueAt(show, sid, cfg.field, st.playing ? pos : 0) : fieldOf(sid, cfg.field)) || "–" : env.editor ? "Drop D" : "Pick a field";
      h = value({ cap: cfg.field ? fname(cfg.field) + (cfg.which === "next" ? " · next song" : "") : env.editor ? "Song field" : "", big: val, lines: 2, f: uiF, wt: 800 }); break; }
    case "until": { let o;
      if (!cfg.field) o = env.editor ? { cap: "Tuning → Drop C", big: "2:40", sub: "for “Death Avenue”", bar: 0.4 } : { big: "Pick a field" };
      else { const u = show ? L.untilNextChange(show, st.idx, st.playing ? pos : 0, cfg.field) : null;
        if (!u) o = { cap: fname(cfg.field), big: "No change", sub: "for the rest of the set" };
        else { const also = cfg.also ? fieldOf(u.songId, cfg.also) : ""; o = { cap: `${fname(cfg.field)} → ${u.value}${also ? " · " + also : ""}`, big: u.inSec === null ? "after " + u.after : L.fmtTime(u.inSec), measure: u.inSec === null ? "" : "00:00", sub: `for “${u.songName}”`, bar: u.progress }; } }
      h = value({ ...o, wt: 800 }); break; }
    case "setlist": {
      if (!show) { h = wrap(bigH("–", W, H)); break; }
      const u = cfg.field ? L.untilNextChange(show, st.idx, 0, cfg.field) : null;
      const rows = []; order.forEach((o, i) => { const x = show.songs[o.id]; if (x) rows.push({ i, name: x.name, right: cfg.field ? fieldOf(o.id, cfg.field) : L.fmtTime(x.len), cur: i === st.idx, chg: u && u.index === i }); (o.brk || []).forEach((b) => rows.push({ i: -1, name: "⏸ " + b.label, right: L.fmtTime(b.len), brk: true })); });
      if (v === "now") { const nx = rows.filter((x) => x.i > st.idx && !x.brk), cur = rows.find((x) => x.cur), then = nx.slice(1, 4).map((x) => x.name).join(" · ");
        const capRoom = capOn ? capPx * 1.3 + 2 : 0, showThen = !!then && H > 110, a = (H - capRoom * 2 - (showThen ? subPx * 1.3 + 4 : 0)) / 1.6;
        h = wrap(`${capOn ? capH(`Now · ${st.idx + 1} of ${order.length}`) : ""}${bigH(cur ? cur.name : "–", W, a, { f: titleF, wt: 800 })}${capOn ? capH("Next") : ""}${bigH(nx[0] ? nx[0].name : "End of set", W, a * 0.6, { f: titleF, wt: 700, col: "#c7c7cc" })}${showThen ? subH(esc("then " + then), "then " + then) : ""}`, { h: "flex-start", t: "left", gap: "1px" });
        break; }
      const compact = v === "compact", head = capOn ? capPx * 1.3 + 6 : 0, base = compact ? Math.max(9, Math.min(15, H / 9)) : Math.max(10, Math.min(22, H / 6.5)), rowH = base * 1.75;
      const nRows = Math.max(1, Math.min(rows.length, Math.floor((H - head) / rowH))), cur = Math.max(0, rows.findIndex((x) => x.cur)), start = Math.max(0, Math.min(rows.length - nRows, cur - 1));
      const view = rows.slice(start, start + nRows), more = rows.length > nRows;
      h = wrap(`${capOn ? capH(`Setlist${more ? ` · ${st.idx + 1} of ${order.length}` : ""}`) : ""}<div class="s5list ${compact ? "s5c" : ""}">${view.map((x) => { const lbl = `${x.i >= 0 ? x.i + 1 + " · " : ""}${x.name}`, rp = Math.min(base * 0.9, 16), rw = measure(x.right, rp, 500, uiF) + 8, fs = Math.min(base * (x.cur && !compact ? 1.12 : 1), fit(lbl, W - rw - 24, rowH, 1, base * 1.12, x.cur ? 800 : 600, uiF, 5));
        return `<div class="${x.cur ? "cur" : ""} ${x.chg ? "chg" : ""} ${x.brk ? "brk" : ""}" style="height:${px1(rowH - 2)}${x.cur ? `;box-shadow:inset 3px 0 0 ${acc}` : ""}"><span style="font-size:${px1(fs)}">${esc(lbl)}</span><span style="font-size:${px1(Math.min(rp, Math.max(fs, 8)))}">${esc(x.right)}</span></div>`; }).join("")}</div>`, { v: "flex-start", h: "stretch", t: "left" });
      return { html: h, top: true }; }
    case "notes": { const role = cfg.role || "drums", t = (sec && sec.notes ? sec.notes[role] || "" : "") || (song && song.note) || "", cap = `${sec ? sec.name : "Notes"} · ${role}`;
      if (v === "compact") { const chip = sec ? sec.name : "", cw = chip ? Math.min(W * 0.35, measure(chip, subPx, 700, uiF) + 16) : 0;
        h = wrap(`${chip ? `<span class="s5chip" style="background:${acc};color:${light(acc) ? "#111" : "#fff"};font-size:${px1(small(chip, subPx, cw - 16, 700))}">${esc(chip)}</span>` : ""}<div class="s5half s5grow s5l">${bigH(t || "–", W - cw - 12, H, { lines: 3, f: uiF, wt: 600, max: 40 })}</div>`, { cls: "row", gap: "10px" }); break; }
      h = v === "sec" ? wrap(column({ cap, capCol: acc, big: t || "–", lines: 3, f: uiF, wt: 700, max: 56 }), { bg: tint(acc), h: "flex-start", t: "left", pad: pad + 5 }) : wrap(column({ cap, big: t || "–", lines: 3, f: uiF, wt: 700, max: 56 })); break; }
    case "cueFeed": {
      const cues = song ? song.cues || [] : [], last = [...cues].reverse().find((x) => x.t <= pos && pos - x.t < 4), up = cues.find((x) => x.t > pos + 1e-3);
      const cueCol = (c) => (c && song ? secColOf(L.sectionAt(song, c.t + 1e-3)) : acc);
      if (v === "compact") { const c = up || last, nb = up && bb ? Math.max(0, barsTo(up.t) - 1) : 0, beatsIn = up && bb && nb === 0 ? Math.max(0, Math.ceil((up.t - pos) / (bb.barLen / bb.num))) : 0;
        const word = (c ? c.text : env.editor ? "Chorus" : "–").toUpperCase(), countTxt = up ? (nb > 0 ? `in ${nb} bar${nb === 1 ? "" : "s"}` : "now") : "", n = bb ? bb.num : 4;
        const dots = Array.from({ length: n }, (_, i) => `<b class="${up && nb === 0 && n - i === beatsIn ? "on" : ""}">${n - i}</b>`).join(" ");
        h = wrap(column({ big: word, f: titleF, wt: 800, col: cueCol(c), sub: countTxt ? `${countTxt} · ${Array.from({ length: n }, (_, i) => n - i).join(" ")}` : "", subHtml: `${esc(countTxt)} · <span class="s5cd">${dots}</span>` })); break; }
      const c = last && st.playing ? last : env.editor ? up || last : null, txt = c ? c.text.toUpperCase() : env.editor ? "CHORUS" : "", col = c ? cueCol(c) : acc;
      if (v === "flash") { const on = !!c, fresh = !!(last && st.playing && pos - last.t < 1.2);
        h = wrap(bigH(txt || " ", W, H, { f: titleF, wt: 800, col: on ? (light(col) ? "#0b0b0c" : "#fff") : col }), { bg: on ? `<i class="s5flash ${fresh ? "s5go" : ""}" style="background:${col}"></i>` : "" }); break; }
      h = wrap(bigH(txt || " ", W, H, { f: titleF, wt: 800, col })); break; }
    case "patch": { const l = song && cfg.track ? song.patches[cfg.track] || [] : []; const p = [...l].reverse().find((x) => x.t <= pos + 1e-3) || l[0]; h = value({ cap: cfg.track || "Patch", big: p ? p.name : env.editor ? "Preset 17A · Scene B" : "–", lines: 2, f: uiF, wt: 800 }); break; }
    case "label": h = value({ big: cfg.text || (env.editor ? "Text" : " "), lines: 2, f: titleF, wt: 800 }); break;
    case "status": { const labels = cfg.labels && cfg.labels.length ? cfg.labels : ["Ready", "Need 30 s", "Problem"], c = v === "compact";
      return { flush: true, html: `<div class="s5stl ${c ? "s5c" : ""}">${labels.map((l) => `<button data-l="${esc(l)}" class="${env.myStatus && env.myStatus[l] ? "on" : ""}" style="font-size:${px1(fit(l, (r.width - 12) / labels.length - 18, r.height * (c ? 0.3 : 0.4), 1, c ? 18 : 28, 700, uiF, 5))}">${esc(l)}</button>`).join("")}</div>` }; }
    case "statusShow": {
      if (!(env.statuses && env.statuses.length)) { h = value({ cap: "Status", big: "All quiet", wt: 700, f: uiF }); break; }
      const base = Math.max(9, Math.min(v === "compact" ? 14 : 18, H / 4)), rowH = base * 1.7, n = Math.max(1, Math.floor((H - (capOn ? capPx * 1.4 : 0)) / rowH));
      h = wrap(`${capOn ? capH("Status") : ""}<div class="s5list">${env.statuses.slice(0, n).map((x) => { const fs = fit(`${x.from}    ${x.label}`, W - 20, rowH, 1, base, 600, uiF, 5); return `<div style="height:${px1(rowH - 2)}"><span style="font-size:${px1(fs)}">${esc(x.from)}</span><span style="font-size:${px1(fs)};color:var(--accent)">${esc(x.label)}</span></div>`; }).join("")}</div>`, { v: "flex-start", h: "stretch", t: "left" });
      return { html: h, top: true }; }
    case "checklist": { const items = cfg.items && cfg.items.length ? cfg.items : ["Ready"], c = v === "compact";
      const rowH = Math.max(12, Math.min(44, H / items.length)), n = Math.max(1, Math.floor(H / rowH)), base = Math.max(7, Math.min(c ? 14 : 18, rowH * 0.6)), box = Math.max(9, Math.min(24, base * 1.2));
      return { top: true, html: wrap(`<div class="s5ck">${items.slice(0, n).map((x, i) => { const fs = fit(x, W - box - 16, rowH, 1, base, 600, uiF, 5); return `<label data-i="${i}" style="height:${px1(rowH)};font-size:${px1(fs)}"><input type="checkbox" ${env.checklist && env.checklist[i] ? "checked" : ""} tabindex="-1" style="width:${px1(box)};height:${px1(box)}">${esc(x)}</label>`; }).join("")}</div>`, { v: "flex-start", h: "stretch", t: "left" }) }; }
    case "conn": { const t = env.connected ? `${Math.round(env.rtt || 0)} ms` : "offline", d = Math.max(6, Math.min(14, H * 0.4)), fs = fit(t, W - d - 12, H, 1, v === "compact" ? 14 : 22, 600, uiF, 5);
      h = wrap(`<div class="s5conn" style="font-size:${px1(fs)}"><span class="s5light ${env.connected ? "on" : ""}" style="width:${px1(d)};height:${px1(d)}"></span>${t}</div>`); break; }
    case "playStop": { const playing = !!st.playing, from = sec ? sec.name : "the start", nm = song ? song.name : "";
      const lab = cfg.label && cfg.label !== "Play / Stop" ? cfg.label : playing ? "■ Stop" : "▶︎ Play";
      if (v === "compact") { const pc = playing ? "#ff453a" : cfg.col && cfg.col !== "#3a3a40" ? cfg.col : "#30d158", sc = s.acc || "#30d158";
        const av = r.width - 24, f1 = fit(env.ask ? "Tap again" : lab, av * 1.3 / 2.3 - 26, r.height * 0.4, 1, 40, 800, uiF, 6), f2 = fit("Sync MIDI", av / 2.3 - 26, r.height * 0.3, 1, 24, 700, uiF, 6);
        return { flush: true, html: `<div class="s5pair"><div class="s5wbtn s5kbig ${env.ask ? "ask" : ""}" data-act="play" style="background:${pc};color:${light(pc) ? "#0b0b0c" : "#fff"};font-size:${px1(f1)}"><span>${esc(env.ask ? "Tap again" : lab)}</span></div><div class="s5wbtn s5kcompact" data-act="syncMidi" style="color:${sc};font-size:${px1(f2)}"><span>⇄</span><span>Sync MIDI</span></div></div>${why}` }; }
      if (v === "hold") { if (!playing) return button(lab, sec ? `from ${from}` : "", { noHold: true, kind: "hold", col: "#30d158" });
        return button(lab, "", { col: "#ff453a", holdSub: "hold to stop · tap does nothing" }); }
      return button(lab, st.soundcheck ? "soundcheck" : playing ? (sec ? `${sec.name}${nm ? " · " + nm : ""}` : nm) : nm ? `from ${from} · ${nm}` : "", { on: playing, col: playing ? "#ff453a" : undefined }); }
    case "nextSong": return button(cfg.label || "Next ⏭︎", st.next ? st.next.name : "");
    case "prevSong": return button(cfg.label || "⏮︎ Previous");
    case "soundcheck": { const busy = st.playing && !st.soundcheck; const x = show && cfg.song ? show.songs[cfg.song] || null : null;
      return button(st.soundcheck ? "Stop soundcheck" : cfg.label || "Soundcheck", busy ? "the set is playing" : x ? x.name : "", { on: !!st.soundcheck, dis: busy }); }
    case "exitLoop": return button(cfg.label || "Exit loop", st.loop ? "looping" : "", { on: !!st.loop, dis: !st.loop && !env.editor });
    case "vamp": return button(cfg.label || "Vamp", st.vamp !== null && st.vamp !== undefined ? "looping this section" : sec ? sec.name : "", { on: st.vamp !== null && st.vamp !== undefined, dis: !st.playing && !env.editor });
    case "sections": { const secs = song ? song.secs.filter((x) => x.type !== "x") : [], n = Math.max(1, secs.length), cap = capOn && r.height > 70 ? "Sections · tap to jump" : "", capRoom = cap ? capPx * 1.3 + 8 : 0;
      const capHtml = cap ? `<div class="s5cap s5seccap" style="font-size:${px1(small(cap.toUpperCase() + "   ", capPx, (r.width - 20) * 0.86, 650))}">${cap}</div>` : "";
      const btn = (x, fs, extra = "") => `<button data-sec="${x.id}" class="${sec && sec.t0 === x.t0 ? "on" : ""} ${(st.jumpQ != null && st.jumpQ === x.id) ? "q" : ""}" style="--sc:${esc(secColOf(x))};${extra}font-size:${fs >= 6 ? px1(fs) : "0"}">${fs >= 6 ? esc(x.name) : ""}</button>`;
      if (v === "strip") { const hh = Math.max(8, r.height - 14 - capRoom), tot = secs.reduce((a, x) => a + (x.bars || 1), 0) || 1, usable = r.width - 16 - 4 * (n - 1);
        return { flush: true, html: `${capHtml}<div class="s5secstrip" style="height:${px1(hh)}">${secs.map((x) => btn(x, Math.min(18, fit(x.name, usable * (x.bars || 1) / tot - 10, hh * 0.5, 1, 18, 800, uiF, 0)), `flex:${x.bars || 1};`)).join("")}</div>${why}` }; }
      const wide = r.width / Math.max(1, r.height) > 2.4, cols = v === "compact" ? Math.min(n, Math.max(1, Math.floor(r.width / 74))) : wide ? Math.min(8, n) : Math.min(r.width < 420 ? 2 : 4, n), rows = Math.ceil(n / cols);
      const cw = (r.width - 16 - 6 * (cols - 1)) / cols, ch = (r.height - 14 - capRoom - 6 * (rows - 1)) / rows, longest = secs.reduce((a, x) => (measure(x.name, 1, 800, uiF) > measure(a, 1, 800, uiF) ? x.name : a), "Chorus");
      const fs = fit(longest, cw - 12, ch * 0.6, 1, v === "compact" ? 16 : 24, 800, uiF, 0);
      return { flush: true, html: `${capHtml}<div class="s5secbtns s5v${v}" style="grid-template-columns:repeat(${cols},1fr)">${secs.map((x) => btn(x, fs)).join("")}</div>${why}` }; }
    case "verFlip": return button(cfg.label || (st.next ? st.next.name : "Next version"), st.next && st.next.vname ? st.next.vname : "", { dis: !st.next });
    case "midiBtn": return button(cfg.label || "MIDI");
    case "syncMidi": return button(cfg.label || "⇄ Sync MIDI");
    default: h = wrap(column({ big: def.name, f: uiF }));
  }
  return { html: h };
}

// ---------------------------------------------------------------- the CSS (scoped: .slw is the screen)
export const CSS = `
.slw{--bg:#000;--s1:#121214;--s2:#1c1c1e;--s3:#2a2a2e;--text:#f2f2f4;--muted:#8e8e96;--accent:#ff9f0a;--blue:#0a84ff;--green:#30d158;--red:#ff453a;--sec:#22c3a6;position:relative;background:var(--bg);color:var(--text);font:15px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.slw .s5w{position:absolute;box-sizing:border-box}
.slw .s5wi{position:relative;box-sizing:border-box;width:100%;height:100%;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:0;min-width:0}
.slw .s5wi.top{justify-content:flex-start}
.slw .s5in{position:relative;z-index:1;box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.slw .s5in.s5row{flex-direction:row;gap:10px;justify-content:center}
.slw .s5half{display:flex;flex-direction:column;justify-content:center;align-items:center;min-width:0;flex:1 1 0;height:100%}
.slw .s5half.s5grow{flex:1 1 auto} .slw .s5half.s5grow.s5r{align-items:flex-end} .slw .s5half.s5grow.s5l{align-items:flex-start;text-align:left}
.slw .s5half.s5side{flex:0 0 auto;align-items:flex-start;text-align:left;max-width:45%} .slw .s5half.s5side.s5l{max-width:none;flex:1 1 0}
.slw .s5div{flex:none;width:1px;align-self:stretch;margin:8% 0;background:rgba(255,255,255,.12)}
.slw .s5cap{font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;white-space:nowrap;flex:none;line-height:1.3;max-width:100%}
.slw .s5big{font-weight:700;white-space:nowrap;line-height:1.05;min-width:0;max-width:100%;letter-spacing:-.01em}
.slw .s5big.s5wrap{white-space:normal;overflow-wrap:normal;word-break:normal}
.slw .s5big.clk small{font-size:.32em;font-weight:500;color:var(--muted);margin-left:.18em;letter-spacing:0}
.slw .s5big small{font-size:.42em;font-weight:600;color:var(--muted);letter-spacing:0}
.slw .s5sub{color:var(--muted);white-space:nowrap;flex:none;font-weight:600;line-height:1.25;max-width:100%}
.slw .s5sub .s5cd b{color:var(--text)} .slw .s5sub .s5cd b.on{color:var(--accent)}
.slw .s5line{display:flex;justify-content:space-between;align-items:baseline;gap:8px;white-space:nowrap;min-width:0;max-width:100%}
.slw .s5line .s5m{color:var(--muted);font-weight:600;flex:none}
.slw .s5bar{border-radius:9px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:6px;flex:none;align-self:center} .slw .s5bar i{display:block;height:100%;border-radius:9px;background:var(--accent)}
.slw .s5tint{position:absolute;inset:0;z-index:0} .slw .s5stripe{position:absolute;left:0;top:0;bottom:0;width:5px;z-index:0}
.slw .s5flash{position:absolute;inset:0;z-index:0} .slw .s5flash.s5go{animation:s5flash .3s steps(2) 3}
@keyframes s5flash{50%{opacity:.25}}
.slw .s5chip{flex:none;border-radius:8px;padding:3px 8px;font-weight:700;white-space:nowrap}
.slw .s5ring{flex:none}
.slw .s5dots{display:flex;align-items:center;justify-content:center;flex:none} .slw .s5dots i{border-radius:50%;background:rgba(255,255,255,.16);flex:none} .slw .s5dots i.on{background:var(--green)} .slw .s5dots i.on.one{background:var(--accent);box-shadow:0 0 10px rgba(255,159,10,.6)}
.slw .s5wbtn{position:relative;box-sizing:border-box;width:100%;height:100%;border-radius:inherit;background:transparent;border:0;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;padding:4px 10px;line-height:1.05;white-space:nowrap;overflow:hidden;color:var(--text)}
.slw .s5wbtn > span{position:relative;max-width:100%} .slw .s5wbtn:active{filter:brightness(1.25)} .slw .s5wbtn.dis{opacity:.45} .slw .s5wbtn.ask{animation:slwask .6s infinite alternate}
.slw .s5wbtn small{position:relative;font-weight:600;opacity:.8;max-width:100%;letter-spacing:0}
.slw .s5wbtn.s5kcompact{background:linear-gradient(180deg,#2a2a30,#1d1d22)}
.slw .s5holdbar{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:0 0;transform:scaleX(var(--hold,0));background:currentColor;opacity:.25}
@keyframes slwask{to{box-shadow:0 0 0 4px #fff inset}}
.slw .s5pair{display:flex;gap:8px;width:100%;height:100%;padding:8px;box-sizing:border-box} .slw .s5pair .s5wbtn{border-radius:12px;flex:1.3 1 0;min-width:0} .slw .s5pair .s5wbtn.s5kcompact{flex:1 1 0}
.slw .s5tl{display:flex;gap:3px;align-items:stretch;flex:none;width:100%}
.slw .s5tl div{border-radius:6px;background:var(--s3);display:flex;align-items:center;justify-content:center;overflow:hidden;white-space:nowrap;min-width:0;position:relative}
.slw .s5tl div span{position:relative;font-weight:600}
.slw .s5tl div.on{color:#000} .slw .s5tl div.on span{font-weight:700} .slw .s5tl div.q{outline:2px dashed #fff}
.slw .s5tl.s5vsec div{color:#000}
.slw .s5tl .s5tlp{position:absolute;left:0;top:0;bottom:0;width:100%;background:rgba(0,0,0,.25);transform-origin:0 0;transform:scaleX(var(--p,0))}
.slw .s5beats{display:flex;gap:6px;height:100%;align-items:center;justify-content:center;padding:0 6px}
.slw .s5beats i{flex:1;max-width:60px;height:70%;border-radius:10px;background:var(--s3)} .slw .s5beats i.on{background:var(--green)} .slw .s5beats i.on.one{background:var(--accent)}
.slw .s5seccap{padding:8px 10px 0;line-height:1.3}
.slw .s5secbtns{display:grid;gap:6px;flex:1;min-height:0;padding:6px 8px 8px}
.slw .s5secbtns button,.slw .s5secstrip button{font:inherit;border:0;border-radius:10px;background:var(--sc,var(--s3));color:#000;font-weight:800;overflow:hidden;white-space:nowrap;padding:2px 4px;min-height:0;min-width:0}
.slw .s5secbtns.s5vcompact button{background:rgba(255,255,255,.08);color:var(--sc);box-shadow:inset 0 -3px 0 var(--sc)}
.slw .s5secbtns button.on,.slw .s5secstrip button.on{box-shadow:inset 0 0 0 3px #fff} .slw .s5secbtns button.q,.slw .s5secstrip button.q{outline:3px dashed #fff}
.slw .s5secstrip{display:flex;gap:4px;padding:6px 8px 8px;box-sizing:border-box;flex:none} .slw .s5secstrip button{border-radius:6px}
.slw .s5list{flex:1;display:flex;flex-direction:column;gap:2px;padding-top:4px;min-height:0;width:100%}
.slw .s5list div{box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 8px;border-radius:8px;white-space:nowrap;flex:none}
.slw .s5list div span:first-child{min-width:0} .slw .s5list div.cur{font-weight:800;background:rgba(255,255,255,.08)} .slw .s5list div.chg{background:rgba(255,159,10,.22)} .slw .s5list div span:last-child{color:var(--muted);flex:none} .slw .s5list div.brk{opacity:.75;font-style:italic}
.slw .s5ck{display:flex;flex-direction:column;width:100%} .slw .s5ck label{display:flex;gap:10px;align-items:center;box-sizing:border-box;white-space:nowrap;font-weight:600} .slw .s5ck input{flex:none;margin:0}
.slw .s5stl{display:flex;gap:6px;height:100%;padding:6px;box-sizing:border-box} .slw .s5stl button{font:inherit;flex:1;border:0;border-radius:10px;background:var(--s3);color:var(--text);font-weight:700;min-width:0;overflow:hidden;white-space:nowrap} .slw .s5stl button.on{background:var(--accent);color:#000}
.slw .s5stl.s5c button{background:transparent;box-shadow:inset 0 0 0 1.5px var(--s3)}
.slw .s5conn{white-space:nowrap;font-weight:600} .slw .s5light{border-radius:50%;background:var(--red);display:inline-block;vertical-align:-1px;margin-right:8px} .slw .s5light.on{background:var(--green);box-shadow:0 0 8px var(--green)}
.slw .s5why{position:absolute;left:4px;right:4px;bottom:4px;background:#000c;color:#ffb340;font-size:11px;border-radius:6px;padding:2px 4px;text-align:center;z-index:3}
`;
// a widget's position in a grid with a gap: left / top / width / height (CSS), gap applied inside
export function place(w, g) { const p = (v, n) => `${(v / n) * 100}%`; return `left:${p(w.x, g.cols)};top:${p(w.y, g.rows)};width:${p(w.w, g.cols)};height:${p(w.h, g.rows)};padding:${g.gap / 2}px`; }
