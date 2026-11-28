// set.Line band screens (phase 6g): the logic shared by the host (the desktop page) and the band screens (band.html),
// plain JavaScript so the unit tests run it with Node (tests/band/logic.test.mjs).
//
// The "show" document the host sends describes the current setlist: for each entry, the song as it plays in that
// setlist (its version laid out): length, bars [t, num, den, bpm] (seconds from the song's start), sections
// [{id, name, type, t0, t1, bars, note}], cues [{t, text}], patches {track: [{t, name}]}, fields {id: value} (the
// version's values win over the song's), and what happens after it ({mode: stop | segue | auto, sec}).

// ---------------------------------------------------------------- clock sync
// NTP-style: the client sends its time c0, the host answers with its time h, the reply arrives at c1. The host's
// clock minus the client's is h - (c0 + c1) / 2. The median of the last 8 exchanges is used (a slow Wi-Fi round
// trip now and then doesn't move it).
export class ClockSync {
  constructor(keep = 8) { this.keep = keep; this.samples = []; }
  add(c0, h, c1) {
    const rtt = c1 - c0;
    if (!(rtt >= 0) || !isFinite(h)) return this.offset();
    this.samples.push({ off: h - (c0 + c1) / 2, rtt });
    if (this.samples.length > this.keep) this.samples.shift();
    return this.offset();
  }
  get ready() { return this.samples.length > 0; }
  offset() {
    if (!this.samples.length) return 0;
    const v = this.samples.map((s) => s.off).sort((a, b) => a - b), n = v.length;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  }
  rtt() { if (!this.samples.length) return 0; const v = this.samples.map((s) => s.rtt).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; }
  hostNow(clientNow) { return clientNow + this.offset(); }
}

// ---------------------------------------------------------------- where the song is
// The position (seconds) the host's transport is at now, predicted from the last state and the synced clock.
export function predictPos(state, hostNow) {
  if (!state || !state.tr) return 0;
  const t = +(state.tr.seconds ?? state.tr.time) || 0;
  if (state.tr.playing) return t + Math.max(0, (hostNow - state.h) / 1000);
  return state.tr.songId && state.cur && state.tr.songId !== state.cur ? 0 : t; // stopped: where it stopped (another song selected: its start)
}
// 15 §6: the position a screen SHOWS, frame by frame. The target (predictPos from the host's timestamped state and the
// synced clock) can wobble by a few ms when a new state or a new clock estimate arrives; drawing it as it is would make
// the playhead and the beat lights twitch. The shown position runs on the device's own clock and is steered towards the
// target gently (at most `rate` faster or slower than real time, 20 %: under 4 ms per 60 fps frame), so a small error
// disappears without a visible step. A big error (over `snapAt` s: a locate, a jump, another song, a stall) or a
// stop / start goes straight to the target.
export class PosSmoother {
  constructor(rate = 0.2, snapAt = 0.25) { this.rate = rate; this.snapAt = snapAt; this.shown = null; this.at = 0; this.key = ""; this.jumps = 0; }
  // target (s), playing, key (what a change of makes it jump: the song), now (ms, the device's clock) -> shown (s)
  step(target, playing, key, now) {
    if (this.shown === null || key !== this.key || !playing || !this.playing) { this.shown = target; this.key = key; this.at = now; this.playing = playing; return target; }
    const dt = Math.max(0, Math.min(0.25, (now - this.at) / 1000)); this.at = now;
    let next = this.shown + dt; const err = target - next;
    if (Math.abs(err) > this.snapAt) { next = target; this.jumps++; }
    else { const k = dt * this.rate; next += Math.max(-k, Math.min(k, err)); }
    this.shown = next; return next;
  }
}
// bars: [[t, num, den, bpm], ...] -> {bar (1-based), beat (1-based, fractional), num, den, bpm, barT, barLen}
export function barBeatAt(song, t) {
  const bars = (song && song.bars) || [];
  if (!bars.length) return { bar: 1, beat: 1, num: 4, den: 4, bpm: 120, barT: 0, barLen: 2 };
  let i = 0, lo = 0, hi = bars.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m][0] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  const [bt, num, den, bpm] = bars[i];
  const beatLen = (60 / bpm) * (4 / den), barLen = beatLen * num;
  return { bar: i + 1, beat: 1 + Math.max(0, t - bt) / beatLen, num, den, bpm, barT: bt, barLen };
}
// 10c: the last click note at or before t: [time, 1 = accent] (the beat lights follow the actual notes), or null
export function hitAt(song, t) {
  const H = song && song.hits; if (!H || !H.length || H[0][0] > t + 1e-4) return null;
  let lo = 0, hi = H.length - 1, i = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (H[m][0] <= t + 1e-4) { i = m; lo = m + 1; } else hi = m - 1; }
  return H[i];
}
export function sectionAt(song, t) {
  const secs = (song && song.secs) || [];
  return secs.find((s) => t >= s.t0 && t < s.t1) || null;
}
export function nextSection(song, t) {
  const secs = (song && song.secs) || [];
  return secs.find((s) => s.t0 > t + 1e-6) || null;
}
// Bars from bar b (1-based) up to the bar starting at time tEnd.
export function barsUntil(song, t, tEnd) {
  const a = barBeatAt(song, t), bars = song.bars || [];
  let k = a.bar; while (k < bars.length && bars[k][0] < tEnd - 1e-6) k++;
  return Math.max(0, k - a.bar + (t >= tEnd ? 0 : 0));
}
// Meter or tempo changes within n bars after t: [{inBars, text}]
export function changesAhead(song, t, n = 4) {
  const bars = (song && song.bars) || [], a = barBeatAt(song, t), out = [];
  for (let k = a.bar; k < bars.length && k < a.bar + n; k++) {
    const p = bars[k - 1], q = bars[k], d = k - a.bar + 1;
    const when = d === 1 ? "next bar" : `in ${d}`;
    if (q[1] !== p[1] || q[2] !== p[2]) out.push({ inBars: d, text: `${q[1]}/${q[2]} ${when}` });
    if (Math.abs(q[3] - p[3]) > 0.01) out.push({ inBars: d, text: `→ ${+q[3].toFixed(2)} BPM ${when}` });
  }
  return out;
}

// ---------------------------------------------------------------- song fields
// A field's value for a setlist entry: the version's value wins over the song's (sent merged as entry.fields).
export function fieldValue(show, songId, fieldId) {
  const s = show && show.songs && show.songs[songId];
  if (!s) return "";
  const v = s.fields ? s.fields[fieldId] : undefined;
  return v === undefined || v === null ? "" : String(v);
}
// Merges a song's own values with its version's overrides (host side).
export function mergeFields(songFields, verFields) {
  const out = { ...(songFields || {}) };
  for (const [k, v] of Object.entries(verFields || {})) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

// ---------------------------------------------------------------- Until next change
// The next song in the setlist whose value of `field` differs from the current song's, and how long until it starts:
// what's left of the current song + the full lengths of the songs in between. A Stop or Auto-next before it makes the
// time unknowable: {after: <the song it follows>} instead. -> null (no change ahead) or
// {value, songId, songName, index, inSec | null, after | null, progress (0..1 since the last change), fromValue}
// 9b: a field's value at time t of a song: its value at the start, then each preset change inside it that sets the
// field (fchg: [{t, f: {field: value}}], sent by the host for fields the song doesn't set itself)
export function fieldValueAt(show, songId, fieldId, t) {
  let v = fieldValue(show, songId, fieldId);
  const s = show && show.songs && show.songs[songId];
  for (const c of (s && s.fchg) || []) if (c.t <= t + 1e-6 && c.f && c.f[fieldId] !== undefined) v = String(c.f[fieldId]);
  return v;
}
export function untilNextChange(show, curIndex, pos, field) {
  const order = (show && show.setlist && show.setlist.order) || [];
  if (curIndex < 0 || curIndex >= order.length) return null;
  const val = (i) => fieldValue(show, order[i].id, field);
  const songOf = (i) => show.songs[order[i].id] || { len: 0, name: "" };
  const inner = (i) => (songOf(i).fchg || []).filter((c) => c.f && c.f[field] !== undefined).map((c) => ({ t: c.t, v: String(c.f[field]) }));
  const here = fieldValueAt(show, order[curIndex].id, field, pos);
  const res = (j, at, value, after, progress) => ({ value, fromValue: here, songId: order[j].id, songName: songOf(j).name, index: j, inSec: after === null ? at : null, after, progress, inSong: j === curIndex });
  // 9b: later in this song (a preset change in the middle of it)
  const mine = inner(curIndex);
  const last = mine.filter((c) => c.t <= pos + 1e-6).pop();
  for (const c of mine) if (c.t > pos + 1e-6 && c.v !== here) { const from = last ? last.t : 0; return res(curIndex, c.t - pos, c.v, null, c.t > from ? Math.min(1, Math.max(0, (pos - from) / (c.t - from))) : 0); }
  // the next songs: at their start, or inside them. A Stop or Auto-next anywhere before makes the time unknowable:
  // "after <the last such song>" (from then on the time is exact).
  let t = Math.max(0, songOf(curIndex).len - pos), after = null;
  // 9d: the breaks after a song add their length; one that waits for Play makes the time unknowable
  const brk = (i) => { let s = 0; for (const b of order[i].brk || []) { s += +b.len || 0; if (b.wait) after = songOf(i).name; } return s; };
  const a0 = order[curIndex].after || { mode: "stop" };
  if (a0.mode === "stop" || a0.mode === "auto") after = songOf(curIndex).name;
  t += brk(curIndex);
  // progress since the last change: from the first song with this value (going back) to the change
  const progressTo = (endT) => { let s0 = curIndex; if (!last) while (s0 > 0 && val(s0 - 1) === here && !inner(s0 - 1).length) s0--;
    let span = 0, done = 0; for (let k = s0; k < curIndex; k++) { span += songOf(k).len; done += songOf(k).len; }
    const from = last ? last.t : 0; span += Math.max(0, songOf(curIndex).len - from) + endT; done += Math.max(0, Math.min(pos, songOf(curIndex).len) - from);
    return span > 0 ? Math.min(1, done / span) : 0; };
  let between = 0;
  for (let j = curIndex + 1; j < order.length; j++) {
    if (val(j) !== here) return res(j, t, val(j), after, progressTo(between));
    for (const c of inner(j)) if (c.v !== here) return res(j, t + c.t, c.v, after, progressTo(between + c.t));
    t += songOf(j).len; between += songOf(j).len;
    const a = order[j].after || { mode: "stop" };
    if (a.mode === "stop" || a.mode === "auto") after = songOf(j).name;
    const bl = brk(j); t += bl; between += bl;
    // the value at the end of song j (its last inner change) carries on
    const ins = inner(j); if (ins.length && ins[ins.length - 1].v !== here) return res(j, t, ins[ins.length - 1].v, after, progressTo(between));
  }
  return null;
}

// ---------------------------------------------------------------- curfew
// finishBy "HH:MM" (local time). The rest of the set: what's left of this song + the remaining songs' real lengths,
// + known waits (Auto-next after N s). Songs set to Stop add an unknown pause: talking = true.
// -> {endsAt (ms), finishAt (ms), overSec (+ = over the curfew), talking, leftSec}
export function curfew(show, curIndex, pos, nowMs, finishBy) {
  const order = (show && show.setlist && show.setlist.order) || [];
  let left = 0, talking = false;
  for (let k = Math.max(0, curIndex); k < order.length; k++) {
    const s = show.songs[order[k].id] || { len: 0 };
    left += k === curIndex ? Math.max(0, s.len - pos) : s.len;
    if (k < order.length - 1) {
      const a = order[k].after || { mode: "stop" };
      if (a.mode === "auto" && a.sec != null) left += +a.sec;
      else if (a.mode === "stop") talking = true;
    }
  }
  const endsAt = nowMs + left * 1000;
  if (!finishBy || !/^\d{1,2}:\d{2}$/.test(finishBy)) return { endsAt, finishAt: null, overSec: null, talking, leftSec: left };
  const [hh, mm] = finishBy.split(":").map(Number);
  const d = new Date(nowMs); d.setHours(hh, mm, 0, 0);
  let finishAt = d.getTime();
  if (finishAt < nowMs - 12 * 3600 * 1000) finishAt += 24 * 3600 * 1000; // after midnight
  return { endsAt, finishAt, overSec: (endsAt - finishAt) / 1000, talking, leftSec: left };
}

// ---------------------------------------------------------------- widgets, permissions, presets
// group, name, default size (w x h in a 12 x 9 grid), what a control may do (cmd)
export const WIDGETS = {
  song: { group: "Info", name: "Song name", w: 6, h: 2 },
  bpm: { group: "Info", name: "BPM & meter", w: 3, h: 2 },
  next: { group: "Info", name: "Next song", w: 6, h: 2 },
  timeline: { group: "Info", name: "Section timeline", w: 12, h: 2 },
  barsLeft: { group: "Info", name: "Bars left", w: 3, h: 2 },
  beats: { group: "Info", name: "Beat lights", w: 6, h: 1 },
  nextSec: { group: "Info", name: "Next section", w: 4, h: 2 },
  countIn: { group: "Info", name: "Count-in overlay", w: 3, h: 1 },
  changes: { group: "Info", name: "Change warnings", w: 6, h: 1 },
  songLeft: { group: "Info", name: "Song time left", w: 3, h: 2 },
  setLeft: { group: "Info", name: "Set time left", w: 3, h: 2 },
  clock: { group: "Info", name: "Clock", w: 3, h: 2 },
  curfew: { group: "Info", name: "Curfew clock", w: 4, h: 2 },
  field: { group: "Info", name: "Song field", w: 4, h: 2 },
  until: { group: "Info", name: "Until next change", w: 6, h: 3 },
  setlist: { group: "Info", name: "Setlist with a field", w: 4, h: 6 },
  notes: { group: "Info", name: "Section notes", w: 6, h: 2 },
  cueFeed: { group: "Info", name: "Cue feed", w: 6, h: 1 },
  patch: { group: "Info", name: "Patch name", w: 4, h: 2 },
  label: { group: "Info", name: "Text label", w: 4, h: 1 },
  status: { group: "Communication", name: "Status buttons", w: 6, h: 2 },
  statusShow: { group: "Communication", name: "Status display", w: 4, h: 2 },
  checklist: { group: "Communication", name: "Per-song checklist", w: 4, h: 4 },
  conn: { group: "Communication", name: "Connection light", w: 2, h: 1 },
  playStop: { group: "Controls", name: "Play / Stop", w: 3, h: 2, cmd: ["play", "stop"] },
  nextSong: { group: "Controls", name: "Next song", w: 3, h: 2, cmd: ["nextSong"] },
  prevSong: { group: "Controls", name: "Previous song", w: 3, h: 2, cmd: ["prevSong"] },
  soundcheck: { group: "Controls", name: "Soundcheck", w: 4, h: 2, cmd: ["soundcheck"] },
  exitLoop: { group: "Controls", name: "Exit loop", w: 3, h: 2, cmd: ["exitLoop"] },
  vamp: { group: "Controls", name: "Vamp", w: 3, h: 2, cmd: ["vamp"] },
  sections: { group: "Controls", name: "Section buttons", w: 12, h: 2, cmd: ["jump", "cancelJump"] },
  verFlip: { group: "Controls", name: "Version flip (next song)", w: 4, h: 2, cmd: ["flipVersion"] },
  midiBtn: { group: "Controls", name: "MIDI button", w: 3, h: 2, cmd: ["midi"] },
  syncMidi: { group: "Controls", name: "Sync MIDI", w: 3, h: 2, cmd: ["syncMidi"] },
};
// Commands a screen sends: {cmd, w (the widget's id), arg}. Status, checklist and hello aren't commands.
// Allowed only if that screen's layout (either orientation) has that widget and its type grants the command.
// Levels, gain and mute: never (no widget grants them).
export function allowed(screen, cmd, widgetId) {
  if (!screen || !cmd) return { ok: false, why: "unknown screen" };
  const all = [...(screen.land || []), ...(screen.port || [])];
  const w = all.find((x) => x.id === widgetId);
  if (!w) return { ok: false, why: "this screen has no such button" };
  const def = WIDGETS[w.type];
  if (!def || !def.cmd || !def.cmd.includes(cmd)) return { ok: false, why: `a ${def ? def.name : w.type} can't do that` };
  return { ok: true, widget: w };
}

let wid = 0;
const W = (type, x, y, w, h, cfg = {}) => ({ id: "w" + Date.now().toString(36) + (wid++).toString(36), type, x, y, w, h, cfg });
// Start from preset: Drummer, Guitar tech, Music director, Vocals, Blank. -> {land, port}
export function preset(kind) {
  if (kind === "drummer") return {
    land: [W("song", 0, 0, 8, 2), W("bpm", 8, 0, 4, 2), W("timeline", 0, 2, 12, 2), W("beats", 0, 4, 6, 1), W("barsLeft", 6, 4, 3, 2), W("nextSec", 9, 4, 3, 2),
      W("changes", 0, 5, 6, 1), W("countIn", 0, 6, 1, 1), W("syncMidi", 6, 6, 3, 1, { label: "⇄ Sync MIDI", col: "#0a84ff" }), W("playStop", 0, 7, 3, 2, { label: "Play / Stop", col: "#30d158" }), W("soundcheck", 3, 7, 3, 2, { label: "Soundcheck", col: "#0a84ff" }),
      W("vamp", 6, 7, 3, 2, { label: "Vamp", col: "#bf5af2" }), W("next", 9, 6, 3, 3)],
    port: [W("song", 0, 0, 12, 1), W("bpm", 0, 1, 6, 1), W("barsLeft", 6, 1, 6, 1), W("timeline", 0, 2, 12, 1), W("beats", 0, 3, 12, 1), W("nextSec", 0, 4, 12, 1),
      W("playStop", 0, 5, 6, 2, { label: "Play / Stop", col: "#30d158" }), W("soundcheck", 6, 5, 6, 2, { label: "Soundcheck", col: "#0a84ff" }), W("next", 0, 7, 12, 2)],
  };
  if (kind === "tech") return {
    land: [W("song", 0, 0, 6, 2), W("field", 6, 0, 3, 2, { field: "", which: "this" }), W("clock", 9, 0, 3, 2), W("until", 0, 2, 7, 4, { field: "", also: "" }),
      W("setlist", 7, 2, 5, 7, { field: "" }), W("status", 0, 6, 7, 1, { labels: ["Ready", "Need 30 s", "Problem"] }), W("checklist", 0, 7, 7, 2, { items: ["Tuned", "Spare ready"] })],
    port: [W("song", 0, 0, 12, 1), W("field", 0, 1, 6, 1, { field: "", which: "this" }), W("clock", 6, 1, 6, 1), W("until", 0, 2, 12, 3, { field: "", also: "" }),
      W("setlist", 0, 5, 12, 3, { field: "" }), W("status", 0, 8, 12, 1, { labels: ["Ready", "Need 30 s", "Problem"] })],
  };
  if (kind === "md") return {
    land: [W("song", 0, 0, 6, 2), W("next", 6, 0, 6, 2), W("timeline", 0, 2, 12, 2), W("sections", 0, 4, 12, 2), W("barsLeft", 0, 6, 3, 2), W("curfew", 3, 6, 4, 2),
      W("statusShow", 7, 6, 5, 2), W("exitLoop", 0, 8, 3, 1, { label: "Exit loop" }), W("verFlip", 3, 8, 4, 1), W("nextSong", 7, 8, 5, 1, { label: "Next song" })],
    port: [W("song", 0, 0, 12, 1), W("next", 0, 1, 12, 1), W("timeline", 0, 2, 12, 1), W("sections", 0, 3, 12, 2), W("curfew", 0, 5, 6, 2), W("statusShow", 6, 5, 6, 2), W("verFlip", 0, 7, 12, 2)],
  };
  if (kind === "vocals") return {
    land: [W("song", 0, 0, 8, 2), W("bpm", 8, 0, 4, 2), W("notes", 0, 2, 12, 3), W("nextSec", 0, 5, 6, 2), W("cueFeed", 6, 5, 6, 2), W("next", 0, 7, 12, 2)],
    port: [W("song", 0, 0, 12, 1), W("notes", 0, 1, 12, 3), W("nextSec", 0, 4, 12, 2), W("cueFeed", 0, 6, 12, 1), W("next", 0, 7, 12, 2)],
  };
  return { land: [], port: [] };
}
export const PRESETS = [["drummer", "Drummer"], ["tech", "Guitar tech"], ["md", "Music director"], ["vocals", "Vocals"], ["blank", "Blank"]];

// Fits a widget inside its screen's grid (12 x 9 unless the screen says otherwise, 15 §4).
export function clampWidget(w, cols = 12, rows = 9) {
  w.w = Math.max(1, Math.min(cols, Math.round(w.w))); w.h = Math.max(1, Math.min(rows, Math.round(w.h)));
  w.x = Math.max(0, Math.min(cols - w.w, Math.round(w.x))); w.y = Math.max(0, Math.min(rows - w.h, Math.round(w.y)));
  return w;
}
export const fmtTime = (sec) => { if (sec == null || !isFinite(sec)) return "–"; const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
