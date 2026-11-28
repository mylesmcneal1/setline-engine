// set.Line 15: what a remote screen's widgets look like, in ONE place: the phones and tablets (band.html, client.ts)
// and the Remote page's editor (rm15.js) both draw them with render() and the CSS below, so the editor shows
// exactly what the device will (§3: live data when a song is loaded, sample data otherwise, never blank boxes).
// Also here: the devices a screen is made for (§7), the screen grid (§4), a widget's style (§5) and the automatic
// stacked phone layout (§7). Plain JavaScript (tests/band/logic.test.mjs runs the layout parts in Node).
import * as L from "./logic.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- §7 devices
// [name, width, height] in CSS px, portrait; the grid a new screen for it starts with
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

// ---------------------------------------------------------------- §4 the grid
// a screen's grid: columns x rows, the gap (px) between widgets, snap and guides (editor only)
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
// fits a widget inside the grid; free (⌘ while dragging): keeps fractions of a cell
export function clamp(w, g, free) {
  const r = (v) => (free ? Math.round(v * 100) / 100 : Math.round(v));
  w.w = Math.max(free ? 0.5 : 1, Math.min(g.cols, r(w.w))); w.h = Math.max(free ? 0.5 : 1, Math.min(g.rows, r(w.h)));
  w.x = Math.max(0, Math.min(g.cols - w.w, r(w.x))); w.y = Math.max(0, Math.min(g.rows - w.h, r(w.y)));
  return w;
}

// ---------------------------------------------------------------- §5 a widget's style
// st: {bg: "solid" | "none" | "#rrggbb", op: 0..100 (the background's opacity), border: bool, shadow: bool,
//      al: "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br" (the content: top/middle/bottom x left/centre/right)}
export const STYLE0 = { bg: "solid", op: 100, border: false, shadow: false, al: "" };
export const styleOf = (w) => ({ ...STYLE0, ...((w && w.st) || {}) });
// a button colour mixed into the dark background (no CSS color-mix: macOS 12 WebKit has none)
const mix = (h) => { const c = hexRgb(h) || [58, 58, 64], k = 0.32; return `rgb(${c.map((v, i) => Math.round(v * k + [20, 20, 22][i] * (1 - k))).join(",")})`; };
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// the inline style of a widget's box
export function boxStyle(w) {
  const s = styleOf(w), out = [];
  const rgb = s.bg === "none" ? null : s.bg === "solid" ? [18, 18, 20] : hexRgb(s.bg) || [18, 18, 20];
  const op = s.bg === "none" ? 0 : Math.max(0, Math.min(100, +s.op)) / 100;
  out.push(`background:${rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${op})` : "transparent"}`);
  if (s.border) out.push("box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.28)");
  if (s.shadow) out.push("text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 10px rgba(0,0,0,.7)");
  const al = s.al || "";
  if (al) { const v = { t: "flex-start", m: "center", b: "flex-end" }[al[0]], h = { l: "left", c: "center", r: "right" }[al[1]], hi = { l: "flex-start", c: "center", r: "flex-end" }[al[1]];
    if (v) out.push(`justify-content:${v}`); if (h) out.push(`text-align:${h};align-items:${hi}`); }
  return out.join(";");
}

// ---------------------------------------------------------------- §7 the automatic phone layout
// How a widget sits in a phone column: "half" (two side by side), "third" (three: previous / play / next), or full
// width; its height in rows of a 6 x 14 grid.
const PH = {
  song: [6, 3], next: [6, 2], timeline: [6, 1], beats: [6, 1], changes: [6, 1], countIn: [6, 1], cueFeed: [6, 1], label: [6, 1],
  until: [6, 3], setlist: [6, 4], notes: [6, 2], status: [6, 2], checklist: [6, 3], sections: [6, 4],
  bpm: [3, 2], clock: [3, 2], barsLeft: [3, 2], nextSec: [3, 2], songLeft: [3, 2], setLeft: [3, 2], curfew: [3, 2], field: [3, 2], patch: [3, 2], statusShow: [3, 2], conn: [3, 1],
  playStop: [3, 2], syncMidi: [3, 2], vamp: [3, 2], exitLoop: [3, 2], soundcheck: [3, 2], midiBtn: [3, 2], verFlip: [3, 2], nextSong: [2, 2], prevSong: [2, 2],
};
// list (any grid) -> new widgets on a cols-wide grid, in reading order (top to bottom, left to right), full width
// or side by side as PH says; -> {list, rows}. Ids are kept (the same buttons).
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
    const [pw, ph] = PH[w.type] || [6, 2], ww = wOf(w);
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

// ---------------------------------------------------------------- sample data (§3: the editor with no song loaded)
export function sampleShow() {
  const bars = []; let t = 0; for (let i = 0; i < 96; i++) { bars.push([+t.toFixed(4), 4, 4, 156]); t += 4 * 60 / 156; }
  const sec = (id, name, type, b0, nb) => ({ id, name, type, t0: bars[b0 - 1][0], t1: (bars[b0 - 1 + nb] || [t])[0], bars: nb, notes: { drums: name === "Chorus" ? "Ride, push the fills" : "Hats, half time" } });
  const secs = [sec(1, "Intro", "intro", 1, 8), sec(2, "Verse A", "verse", 9, 16), sec(3, "Pre", "pre", 25, 8), sec(4, "Chorus", "chorus", 33, 16), sec(5, "Verse B", "verse", 49, 16), sec(6, "Bridge", "bridge", 65, 16), sec(7, "Outro", "outro", 81, 16)];
  const songs = { s1: { name: "Mercy", len: 212, bars, secs, cues: [], patches: {}, fields: {} }, s2: { name: "Seneca", len: 227, bars, secs, cues: [], patches: {}, fields: {} },
    s3: { name: "NIHILOPHOBIA", len: 281, bars, secs, cues: [{ t: secs[1].t0, text: "Verse" }], patches: { "Brett · Quad Cortex": [{ t: 0, name: "Preset 17A · Scene B" }] }, fields: {} },
    s4: { name: "HAND OF FATE", len: 225, bars, secs, cues: [], patches: {}, fields: {} } };
  const order = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"].map((id) => ({ id, after: { mode: "stop" } }));
  for (let i = 5; i <= 11; i++) songs["s" + i] = { name: ["Proxima II", "Death Avenue", "End of Heartache", "Hourglass", "Garden", "Seneca II", "Line Check"][i - 5], len: 240, bars, secs, cues: [], patches: {}, fields: {} };
  return { t: "show", sample: true, setlist: { id: "L", name: "Winter run", finishBy: "", order }, songs, fields: [] };
}
export function sampleState() { return { cur: "s3", idx: 2, playing: true, soundcheck: null, vamp: null, loop: false, jumpQ: null, next: { id: "s4", name: "HAND OF FATE", vname: "" }, pos: 0, pc: false, tf: "" }; }

// ---------------------------------------------------------------- text that fits its box
let MC = null;
const measure = (text, px, weight) => {
  try { if (!MC && typeof document !== "undefined") MC = document.createElement("canvas").getContext("2d"); } catch (e) { MC = null; }
  if (!MC) return String(text).length * px * 0.58;
  MC.font = `${weight || 700} ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif`; return MC.measureText(String(text)).width;
};
// the biggest font size (px) at which text fits w x h on `lines` lines (never under 10)
export function fit(text, w, h, lines = 1, max = 400, weight = 700) {
  const s = String(text || " "), byH = (h / lines) * 0.82, at = Math.max(10, Math.min(max, byH));
  const width = measure(s, 100, weight) / 100; // width per px of font size
  if (width <= 0) return at;
  return Math.max(10, Math.min(at, (w * lines * 0.96) / width));
}

// ---------------------------------------------------------------- the widgets
// The widgets whose picture changes with the song position (drawn every frame); the others redraw when the setlist or
// the live state changes (a few times a second at most).
export const LIVE = new Set(["timeline", "beats", "barsLeft", "nextSec", "songLeft", "setLeft", "until", "clock", "curfew", "cueFeed", "patch", "field", "changes", "countIn", "notes", "bpm", "playStop", "vamp", "sections"]);
const clockText = (d, secs) => { const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), h12 = ((h + 11) % 12) + 1, ampm = h < 12 ? "AM" : "PM";
  return { main: `${h12}:${String(m).padStart(2, "0")}${secs ? ":" + String(s).padStart(2, "0") : ""}`, sub: ampm }; };
// One widget's inside. env: {show, st, pos, song, bb, sec, nsec, r: {width, height}, now: Date ms, connected, rtt,
// statuses, myStatus, checklist, acks, ask (this widget is asking "tap again"), editor}. -> {html, flush: true when the
// box drops its padding and background (buttons fill it)}
export function render(w, env) {
  const { show, pos, song, bb, sec, nsec } = env, st = env.st || { playing: false }, cfg = w.cfg || {}, def = L.WIDGETS[w.type] || { name: w.type };
  const W = Math.max(20, env.r.width - 20), H = Math.max(14, env.r.height - 14);
  const why = env.acks && env.acks[w.id] ? `<div class="s5why">${esc(env.acks[w.id])}</div>` : "";
  // a caption, a big value that fits its box, a line under it
  const big = (txt, cap = "", sub = "", lines = 1, maxPx = 400, cls = "") => { const hh = H - (cap ? 16 : 0) - (sub ? 18 : 0);
    return `${cap ? `<div class="s5cap">${esc(cap)}</div>` : ""}<div class="s5big ${cls}" style="font-size:${fit(txt, W, hh, lines, maxPx).toFixed(1)}px${lines > 1 ? ";white-space:normal" : ""}">${esc(txt)}</div>${sub ? `<div class="s5sub">${esc(sub)}</div>` : ""}`; };
  // a button: fills its box, its label sized to it (icon + word)
  const ctl = (label, sub = "", on = false, dis = false) => { const lab = env.ask ? "Tap again" : label, fs = fit(lab, env.r.width - 20, env.r.height * (sub ? 0.42 : 0.5), 1, 44);
    return { flush: true, html: `<div class="s5wbtn ${on ? "on" : ""} ${dis ? "dis" : ""} ${env.ask ? "ask" : ""}" style="--c:${esc(cfg.col || "#3a3a40")};--cb:${mix(cfg.col || "#3a3a40")};font-size:${fs.toFixed(1)}px">${esc(lab)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>${why}` }; };
  const fieldOf = (sid, f) => (sid && show ? L.fieldValue(show, sid, f) : "");
  const fname = (f) => ((show && show.fields) || []).find((x) => x.id === f)?.name || "Field";
  let h = "";
  switch (w.type) {
    case "song": { const cap = show && st.idx >= 0 ? `Now · ${st.idx + 1} of ${show.setlist.order.length}` : "Now", sub = [sec ? sec.name : "", bb ? `${+bb.bpm.toFixed(1)} BPM` : ""].filter(Boolean).join(" · ");
      h = `<div class="s5cap">${esc(cap)}</div><div class="s5big stitle" style="font-size:${fit(song ? song.name : "No song", W, H - 34, 2, 400).toFixed(1)}px;white-space:normal">${esc(song ? song.name : "No song")}</div>${sub ? `<div class="s5sub acc">${esc(sub)}</div>` : ""}`; break; }
    case "bpm": h = bb ? big(`${+bb.bpm.toFixed(2)}`, "BPM", `${bb.num}/${bb.den}`) : big("–", "BPM"); break;
    case "next": { const n = st.next, a = show && st.idx >= 0 ? (show.setlist.order[st.idx] || {}).after : null;
      h = big(n ? n.name : "End of set", "Next", n ? [n.vname, a ? (a.mode === "segue" ? "segue" : a.mode === "auto" ? `auto after ${a.sec || 0} s` : "") : ""].filter(Boolean).join(" · ") : ""); break; }
    case "timeline": h = song ? `<div class="s5tl">${song.secs.map((s) => { const on = sec && s.t0 === sec.t0; return `<div class="${on ? "on" : ""} ${(st.jumpQ != null && st.jumpQ === s.id) ? "q" : ""}" style="flex:${s.bars}">${on ? `<i class="s5tlp"></i>` : ""}<span>${esc(s.name)}</span></div>`; }).join("")}</div>` : big("–"); break;
    case "barsLeft": { const left = sec && bb ? Math.max(0, L.barBeatAt(song, sec.t1 - 1e-6).bar - bb.bar + 1) : null; h = big(left === null ? "–" : String(left), "Bars left", sec ? sec.name : ""); break; }
    case "beats": { const n = bb ? bb.num : 4; let k = bb && st.playing ? Math.floor(bb.beat) : 0;
      if (song && song.hits && bb && st.playing) { const hit = L.hitAt(song, pos); k = hit && hit[0] >= bb.barT - 1e-4 ? (hit[1] ? 1 : Math.floor(L.barBeatAt(song, hit[0]).beat)) : 0; }
      h = `<div class="s5beats">${Array.from({ length: n }, (_, i) => `<i class="${i + 1 === k ? "on" : ""} ${i === 0 ? "one" : ""}"></i>`).join("")}</div>`; return { html: h, flush: true }; }
    case "nextSec": h = nsec && song ? big(nsec.name, "Next section", `in ${Math.max(0, L.barBeatAt(song, nsec.t0 - 1e-6).bar - (bb ? bb.bar : 1) + 1)} bars`) : big("–", "Next section"); break;
    case "countIn": h = `<div class="s5cap">Count-in</div><div class="s5sub">${sec && sec.type === "count-in" ? "now" : "full screen when it plays"}</div>`; break;
    case "changes": { const c = song ? L.changesAhead(song, pos, cfg.bars || 4) : []; h = big(c.length ? c.map((x) => x.text).join(" · ") : "No changes ahead", "Coming up"); break; }
    case "songLeft": h = big(song ? L.fmtTime(song.len - pos) : "–", "Song left"); break;
    case "setLeft": { const c = show ? L.curfew(show, st.idx, pos, env.now, "") : null; h = big(c ? L.fmtTime(c.leftSec) : "–", "Set left", c && c.talking ? "+ talking" : ""); break; }
    case "clock": { const c = clockText(new Date(env.now), !!cfg.secs), hh = H - 16, fs = fit(c.main.replace(/d/g, "0") + " ", W * 0.72, hh, 1, 400, 400); // (tabular digits: every digit as wide as a 0; room for AM / PM)
      h = `<div class="s5cap">Clock</div><div class="s5big clk" style="font-size:${fs.toFixed(1)}px">${esc(c.main)}<small>${c.sub}</small></div>`; break; }
    case "curfew": { const fb = show && show.setlist.finishBy; const c = show ? L.curfew(show, st.idx, pos, env.now, fb) : null;
      if (!c || c.overSec === null) h = big("–", "Curfew", "no finish time set");
      else { const over = c.overSec > 0; h = `<div class="s5cap">Curfew ${esc(fb)}</div><div class="s5big" style="color:${over ? "var(--red)" : "var(--green)"};font-size:${fit("+0:00", W, H - 34).toFixed(1)}px">${over ? "+" : "−"}${L.fmtTime(Math.abs(c.overSec))}</div><div class="s5sub">${over ? "over" : "under"}${c.talking ? " + talking" : ""}</div>`; } break; }
    case "field": { const sid = cfg.which === "next" ? st.next && st.next.id : st.cur; h = big(cfg.field ? (cfg.which !== "next" && sid && show ? L.fieldValueAt(show, sid, cfg.field, st.playing ? pos : 0) : fieldOf(sid, cfg.field)) || "–" : env.editor ? "Drop D" : "Pick a field", cfg.field ? fname(cfg.field) + (cfg.which === "next" ? " · next song" : "") : env.editor ? "Song field" : ""); break; }
    case "until": { if (!cfg.field) { h = big(env.editor ? "2:40" : "Pick a field", env.editor ? "Tuning → Drop C" : "", env.editor ? "for “Death Avenue”" : ""); break; }
      const u = show ? L.untilNextChange(show, st.idx, st.playing ? pos : 0, cfg.field) : null;
      if (!u) { h = big("No change", fname(cfg.field), "for the rest of the set"); break; }
      const also = cfg.also ? fieldOf(u.songId, cfg.also) : "", txt = u.inSec === null ? "after " + u.after : L.fmtTime(u.inSec);
      h = `<div class="s5cap">${esc(fname(cfg.field))} → ${esc(u.value)}${also ? " · " + esc(also) : ""}</div><div class="s5big" style="font-size:${fit(u.inSec === null ? txt : "00:00", W, H - 60, 1, u.inSec === null ? 72 : 400).toFixed(1)}px">${esc(txt)}</div><div class="s5sub">for “${esc(u.songName)}”</div><div class="s5bar"><i style="width:${(u.progress * 100).toFixed(1)}%"></i></div>`; break; }
    case "setlist": { if (!show) { h = big("–", "Setlist"); break; } const u = cfg.field ? L.untilNextChange(show, st.idx, 0, cfg.field) : null;
      h = `<div class="s5cap">Setlist</div><div class="s5list">${show.setlist.order.map((o, i) => { const s = show.songs[o.id]; if (!s) return ""; return `<div class="${i === st.idx ? "cur" : ""} ${u && u.index === i ? "chg" : ""}"><span>${i + 1} · ${esc(s.name)}</span><span>${cfg.field ? esc(fieldOf(o.id, cfg.field)) : L.fmtTime(s.len)}</span></div>` + (o.brk || []).map((b) => `<div class="brk"><span>⏸ ${esc(b.label)}</span><span>${L.fmtTime(b.len)}</span></div>`).join(""); }).join("")}</div>`;
      return { html: h, top: true }; }
    case "notes": { const role = cfg.role || "drums", t = (sec && sec.notes ? sec.notes[role] || "" : "") || (song && song.note) || ""; h = `<div class="s5cap">${esc(sec ? sec.name : "")} · ${esc(role)}</div><div class="s5big" style="white-space:normal;font-size:${fit(t || "–", W, H - 20, 3, 48).toFixed(1)}px">${esc(t || "–")}</div>`; break; }
    case "cueFeed": { const c = song ? [...song.cues].reverse().find((x) => x.t <= pos && pos - x.t < 4) : null; h = big(c && st.playing ? c.text : env.editor ? "Verse" : "", "Cue"); break; }
    case "patch": { const l = song && cfg.track ? song.patches[cfg.track] || [] : []; const p = [...l].reverse().find((x) => x.t <= pos + 1e-3) || l[0]; h = big(p ? p.name : env.editor ? "Preset 17A · Scene B" : "–", cfg.track || "Patch"); break; }
    case "label": h = big(cfg.text || (env.editor ? "Text" : "")); break;
    case "status": { const labels = cfg.labels && cfg.labels.length ? cfg.labels : ["Ready", "Need 30 s", "Problem"]; return { flush: true, html: `<div class="s5stl">${labels.map((l) => `<button data-l="${esc(l)}" class="${env.myStatus && env.myStatus[l] ? "on" : ""}" style="font-size:${fit(l, env.r.width / labels.length - 12, env.r.height * 0.4, 1, 28).toFixed(1)}px">${esc(l)}</button>`).join("")}</div>` }; }
    case "statusShow": h = env.statuses && env.statuses.length ? `<div class="s5list">${env.statuses.map((s) => `<div><span>${esc(s.from)}</span><span style="color:var(--accent)">${esc(s.label)}</span></div>`).join("")}</div>` : big("All quiet", "Status"); break;
    case "checklist": { const items = cfg.items && cfg.items.length ? cfg.items : ["Ready"]; return { top: true, html: `<div class="s5ck">${items.map((x, i) => `<label data-i="${i}"><input type="checkbox" ${env.checklist && env.checklist[i] ? "checked" : ""} tabindex="-1">${esc(x)}</label>`).join("")}</div>` }; }
    case "conn": h = `<div class="s5conn"><span class="s5light ${env.connected ? "on" : ""}"></span>${env.connected ? `${Math.round(env.rtt || 0)} ms` : "offline"}</div>`; break;
    case "playStop": return ctl(cfg.label && cfg.label !== "Play / Stop" ? cfg.label : st.playing ? "❚❚ Stop" : "▶︎ Play", st.soundcheck ? "soundcheck" : "", st.playing);
    case "nextSong": return ctl(cfg.label || "Next ⏭︎", st.next ? st.next.name : "");
    case "prevSong": return ctl(cfg.label || "⏮︎ Previous");
    case "soundcheck": { const busy = st.playing && !st.soundcheck; const s = show && cfg.song ? show.songs[cfg.song] || null : null;
      return ctl(st.soundcheck ? "Stop soundcheck" : cfg.label || "Soundcheck", busy ? "the set is playing" : s ? s.name : "", !!st.soundcheck, busy); }
    case "exitLoop": return ctl(cfg.label || "Exit loop", st.loop ? "looping" : "", !!st.loop, !st.loop && !env.editor);
    case "vamp": return ctl(cfg.label || "Vamp", st.vamp !== null && st.vamp !== undefined ? "looping this section" : sec ? sec.name : "", st.vamp !== null && st.vamp !== undefined, !st.playing && !env.editor);
    case "sections": { const secs = song ? song.secs.filter((s) => s.type !== "x") : [], n = Math.max(1, secs.length), wide = env.r.width / Math.max(1, env.r.height) > 2.4;
      const cols = wide ? Math.min(8, n) : Math.min(env.r.width < 420 ? 2 : 4, n), rows = Math.ceil(n / cols), fs = fit("Chorus", env.r.width / cols - 14, (env.r.height - 26) / rows * 0.5, 1, 22);
      return { flush: true, html: `<div class="s5cap s5seccap">Sections · tap to jump</div><div class="s5secbtns" style="grid-template-columns:repeat(${cols},1fr);font-size:${fs.toFixed(1)}px">${secs.map((s) => `<button data-sec="${s.id}" class="${sec && sec.t0 === s.t0 ? "on" : ""} ${(st.jumpQ != null && st.jumpQ === s.id) ? "q" : ""}" style="--sc:${esc(SECCOL[s.type] || "#64748b")}">${esc(s.name)}</button>`).join("")}</div>${why}` }; }
    case "verFlip": return ctl(cfg.label || (st.next ? st.next.name : "Next version"), st.next && st.next.vname ? st.next.vname : "", false, !st.next);
    case "midiBtn": return ctl(cfg.label || "MIDI");
    case "syncMidi": return ctl(cfg.label || "⇄ Sync MIDI");
    default: h = big(def.name);
  }
  return { html: h };
}
const SECCOL = { intro: "#6b7cff", verse: "#22c3a6", pre: "#a06bff", chorus: "#f5a524", bridge: "#ff5fa2", outro: "#8a93a6", solo: "#ff7a45", "count-in": "#3a3f48" };

// ---------------------------------------------------------------- the CSS (scoped: .slw is the screen)
export const CSS = `
.slw{--bg:#000;--s1:#121214;--s2:#1c1c1e;--s3:#2a2a2e;--text:#f2f2f4;--muted:#8e8e96;--accent:#ff9f0a;--blue:#0a84ff;--green:#30d158;--red:#ff453a;--sec:#22c3a6;position:relative;background:var(--bg);color:var(--text);font:15px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.slw .s5w{position:absolute;box-sizing:border-box}
.slw .s5wi{position:relative;box-sizing:border-box;width:100%;height:100%;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:6px 10px;min-width:0}
.slw .s5wi.flush{padding:0}
.slw .s5wi.top{justify-content:flex-start}
.slw .s5cap{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}
.slw .s5big{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:clip;line-height:1.05;min-width:0}
.slw .s5big.stitle{font-family:var(--title,inherit);font-weight:800;line-height:1.02}
.slw .s5big.clk{font-weight:300;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.slw .s5big.clk small{font-size:.32em;font-weight:500;color:var(--muted);margin-left:.18em;letter-spacing:0}
.slw .s5sub{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none;font-size:14px}
.slw .s5sub.acc{color:var(--sec);font-weight:700;font-size:16px}
.slw .s5wbtn{box-sizing:border-box;width:100%;height:100%;border-radius:14px;background:var(--cb,#1f1f23);border:0;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;text-align:center;padding:4px 6px;line-height:1.05;white-space:nowrap;overflow:hidden;color:var(--text)}
.slw .s5wbtn:active{filter:brightness(1.35)} .slw .s5wbtn.on{background:var(--c,#3a3a40);color:#000} .slw .s5wbtn.dis{opacity:.45} .slw .s5wbtn.ask{animation:slwask .6s infinite alternate}
.slw .s5wbtn small{font-weight:500;font-size:max(11px,.36em);opacity:.8;max-width:100%;overflow:hidden;text-overflow:ellipsis}
@keyframes slwask{to{box-shadow:0 0 0 4px #fff inset}}
.slw .s5tl{display:flex;gap:3px;height:100%;align-items:stretch}
.slw .s5tl div{border-radius:6px;background:var(--s3);display:flex;align-items:center;justify-content:center;font-size:12px;overflow:hidden;white-space:nowrap;min-width:0;position:relative}
.slw .s5tl div span{position:relative}
.slw .s5tl div.on{background:var(--accent);color:#000;font-weight:700} .slw .s5tl div.q{outline:2px dashed #fff}
.slw .s5tl .s5tlp{position:absolute;left:0;top:0;bottom:0;width:100%;background:rgba(0,0,0,.25);transform-origin:0 0;transform:scaleX(var(--p,0))}
.slw .s5beats{display:flex;gap:6px;height:100%;align-items:center;justify-content:center;padding:0 6px}
.slw .s5beats i{flex:1;max-width:60px;height:70%;border-radius:10px;background:var(--s3)} .slw .s5beats i.on{background:var(--green)} .slw .s5beats i.on.one{background:var(--accent)}
.slw .s5seccap{padding:8px 10px 4px}
.slw .s5secbtns{display:grid;gap:6px;flex:1;min-height:0;padding:0 8px 8px}
.slw .s5secbtns button{font:inherit;border:0;border-radius:10px;background:var(--sc,var(--s3));color:#000;font-weight:800;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:2px 4px;min-height:0}
.slw .s5secbtns button.on{box-shadow:inset 0 0 0 3px #fff} .slw .s5secbtns button.q{outline:3px dashed #fff}
.slw .s5list{overflow:hidden;flex:1;display:flex;flex-direction:column;gap:2px;padding-top:6px;min-height:0}
.slw .s5list div{display:flex;justify-content:space-between;gap:8px;font-size:15px;padding:6px 8px;border-radius:8px;white-space:nowrap;flex:none}
.slw .s5list div span:first-child{overflow:hidden;text-overflow:ellipsis} .slw .s5list div.cur{font-weight:800;background:var(--s3);box-shadow:inset 3px 0 0 var(--green)} .slw .s5list div.chg{background:rgba(255,159,10,.22)} .slw .s5list div span:last-child{color:var(--muted);flex:none} .slw .s5list div.brk{opacity:.75;font-style:italic}
.slw .s5bar{height:6px;border-radius:3px;background:var(--s3);overflow:hidden;margin-top:6px;flex:none} .slw .s5bar i{display:block;height:100%;background:var(--accent)}
.slw .s5ck label{display:flex;gap:10px;align-items:center;font-size:16px;padding:6px 2px} .slw .s5ck input{width:24px;height:24px}
.slw .s5stl{display:flex;gap:4px;height:100%} .slw .s5stl button{font:inherit;flex:1;border:0;border-radius:10px;background:var(--s3);color:var(--text);font-weight:700;min-width:0;overflow:hidden;white-space:nowrap} .slw .s5stl button.on{background:var(--accent);color:#000}
.slw .s5conn{white-space:nowrap} .slw .s5light{width:14px;height:14px;border-radius:50%;background:var(--red);display:inline-block;vertical-align:-2px;margin-right:8px} .slw .s5light.on{background:var(--green);box-shadow:0 0 8px var(--green)}
.slw .s5why{position:absolute;left:4px;right:4px;bottom:4px;background:#000c;color:#ffb340;font-size:11px;border-radius:6px;padding:2px 4px;text-align:center}
`;
// a widget's position in a grid with a gap: left / top / width / height (CSS), gap applied inside
export function place(w, g) { const p = (v, n) => `${(v / n) * 100}%`; return `left:${p(w.x, g.cols)};top:${p(w.y, g.rows)};width:${p(w.w, g.cols)};height:${p(w.h, g.rows)};padding:${g.gap / 2}px`; }
