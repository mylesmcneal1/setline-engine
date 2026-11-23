// Edit page in the desktop app: Play/Stop/locate drive the real engine, and the playhead, LCD and meters
// follow its events. The page keeps its own state (playing, pos, playId); this module only feeds it.
// Positions cross the bridge as bar/beat, so the playhead stays on the page's bar grid even where the
// engine plays a tempo ramp as a jump. Loops run inside the engine (sample-exact); this module only
// tells it which range to loop.
import { SL } from "../bridge";

interface Bar { bar: number; t: number; dur: number; sig: [number, number]; beatT: number[] }
interface Song { id: string; name: string; tracks: string[]; bars: Bar[]; total: number; audio: number; [k: string]: any }
interface Page {
  songs: Song[]; playId: string | null; selId: string | null; pos: number; playing: boolean;
  isOff(s: Song, t: string): boolean; loopRange(s: Song): [number, number] | null;
  toast(msg: string): void; ROLE: Record<string, string>; PORTS: string[];
  clickCfg(s: Song): Record<string, unknown>; gainOf(s: Song, t: string): number;
  setPos(t: number): void; setPlayId(id: string): void; setPlaying(b: boolean): void; redraw(): void;
  sessionData(): Record<string, any>; loadSession(o: Record<string, any>): void; setSessionName(n: string): void;
  confirm(title: string, body: string, ok: string, fn: () => void): void;
}
interface Transport { playing: boolean; loaded: boolean; song: string; bar: number; beat: number; seconds: number; ended?: boolean }
interface LoadResult { ok?: boolean; error?: string; code?: string; warnings?: string[]; epoch?: number }
interface FileResult { name?: string; path?: string; text?: string; cancelled?: boolean; error?: string }
interface Stats { running: boolean; xruns: number | null; underruns: number; midiSent: number; midiDropped: number; midiLateMaxMs: number; cpu: number; callbackMaxMs: number; budgetMs: number }
interface Setup { current: { driver: string; device: string; rate: number; buffer: number; latencyMs: number } | null; error?: string }

declare global { interface Window { SLPage?: Page; SLE?: typeof SLE } }

// Default routing = the Outputs page's design defaults (outputs numbered from 1).
const DEFAULT_ROUTING: Record<string, number[]> = {
  click: [1], cues: [2], drums: [3, 4], bass: [5], keys: [7, 8], guitars: [9, 10], bgvs: [11, 12], synth: [13, 14], fx: [15],
};
function routing(): Record<string, number[]> {
  try { return { ...DEFAULT_ROUTING, ...JSON.parse(localStorage.getItem("setline.routing") || "{}") }; } catch { return DEFAULT_ROUTING; }
}

const page = () => window.SLPage!;
let loadedKey: string | null = null, loadedSongId: string | null = null, warnedKey: string | null = null, loopKey = "";
let busy = false, pending: { s: Song; t: number } | null = null;
let peaks: number[] = [];

// ---------------------------------------------------------------- positions (page seconds <-> bar/beat)
function toBarBeat(s: Song, t: number): { bar: number; beat: number } {
  const bars = s.bars;
  let i = 0;
  while (i + 1 < bars.length && bars[i + 1].t <= t + 1e-9) i++;
  const b = bars[i];
  let k = 0;
  b.beatT.forEach((bt, j) => { if (t >= bt - 1e-9) k = j; });
  const next = k + 1 < b.beatT.length ? b.beatT[k + 1] : b.t + b.dur;
  const len = Math.max(1e-9, next - b.beatT[k]);
  return { bar: b.bar, beat: 1 + k + Math.max(0, Math.min(1, (t - b.beatT[k]) / len)) };
}
function toTime(s: Song, bar: number, beat: number): number {
  const b = s.bars[Math.max(0, Math.min(s.bars.length - 1, bar - 1))];
  const k = Math.max(0, Math.min(b.beatT.length - 1, Math.floor(beat - 1)));
  const next = k + 1 < b.beatT.length ? b.beatT[k + 1] : b.t + b.dur;
  return b.beatT[k] + (beat - 1 - k) * (next - b.beatT[k]);
}

// ---------------------------------------------------------------- loading songs
function payload(s: Song) {
  const p = page();
  const song = JSON.parse(JSON.stringify(s, (k, v) => (k === "bars" || k === "secPos" || k === "_yy" ? undefined : v)));
  const roles: Record<string, string> = {};
  s.tracks.forEach((t) => (roles[t] = p.ROLE[t] || ""));
  return { song, routing: routing(), roles, click: p.clickCfg(s) };
}
// What forces a reload: everything except the mixer levels, which change live (setTrackLevel).
function loadKey(body: ReturnType<typeof payload>): string {
  const { gain, mute, solo, ...rest } = body.song;
  return JSON.stringify({ ...body, song: rest });
}

async function ensureLoaded(s: Song): Promise<boolean> {
  const body = payload(s);
  const key = loadKey(body);
  if (key === loadedKey && loadedSongId === s.id) return true;
  const r = await SL.call<LoadResult>("loadSong", body);
  if (r.error) { page().toast(r.error); loadedKey = null; return false; }
  loadedKey = key; loadedSongId = s.id; loopKey = "";
  const w = r.warnings || [];
  if (w.length && warnedKey !== key) {
    warnedKey = key;
    page().toast(w[0] + (w.length > 1 ? `  (+${w.length - 1} more)` : ""));
    console.info(`set.Line: "${s.name}" loaded with notes:\n- ` + w.join("\n- "));
  }
  return true;
}

// ---------------------------------------------------------------- loop (runs in the engine)
async function syncLoop(s: Song) {
  if (s.id !== loadedSongId) return;
  const cy = page().loopRange(s);
  const range = cy ? { from: toBarBeat(s, cy[0]), to: toBarBeat(s, cy[1]) } : null;
  const key = JSON.stringify(range);
  if (key === loopKey) return;
  loopKey = key;
  const r = await SL.call<LoadResult>("setLoop", range ? { fromBar: range.from.bar, fromBeat: range.from.beat, toBar: range.to.bar, toBeat: range.to.beat } : {});
  if (r.code === "reload") loopKey = "";
  // Turning a loop on while already past its end: go to its start (as the page always did).
  if (cy && page().playing && page().pos >= cy[1]) SLE.playFrom(s, cy[0]);
}

// ---------------------------------------------------------------- transport
async function run(s: Song, t: number) {
  busy = true;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await ensureLoaded(s))) { page().setPlaying(false); return; }
      await syncLoop(s); // armed before playing, so the first pass wraps too
      const at = toBarBeat(s, t);
      const r = await SL.call<Transport & LoadResult>("transport", { cmd: "play", fromBar: at.bar, fromBeat: at.beat });
      if (r.code === "reload") { loadedKey = null; continue; } // the device changed since loading
      if (r.error) { page().toast(r.error); page().setPlaying(false); }
      return;
    }
  } catch (e) {
    page().toast(String(e)); page().setPlaying(false);
  } finally {
    busy = false;
    if (pending) { const p = pending; pending = null; if (page().playing) run(p.s, p.t); }
  }
}

let levelQueued: Song | null = null;
const SLE = {
  // Play song s from page time t (seconds). Called for Play, locate while playing, next song...
  // Requests made while one is in flight coalesce (dragging the playhead sends only the latest).
  playFrom(s: Song | undefined, t: number) {
    if (!s) return;
    if (busy) { pending = { s, t }; return; }
    run(s, t);
  },
  stop() {
    pending = null;
    SL.call("transport", { cmd: "stop" }).catch(() => {});
  },
  // Mixer levels of song s changed (fader, mute, solo, click button): send them live, at most once a frame.
  levels(s: Song) {
    if (s.id !== loadedSongId) return; // other songs get their levels when they load
    if (levelQueued) { levelQueued = s; return; }
    levelQueued = s;
    requestAnimationFrame(() => {
      const q = levelQueued!; levelQueued = null;
      const tracks = q.tracks.map((t) => ({ track: t, db: page().gainOf(q, t), mute: !!(q.mute || {})[t], solo: !!(q.solo || {})[t] }));
      SL.call("setTrackLevel", { tracks }).catch(() => {});
    });
  },
  // Meter level for a track: the peak of the outputs it's routed to (the engine meters outputs).
  trackLevel(s: Song, t: string): number {
    if (s.id !== loadedSongId) return 0;
    const outs = routing()[page().ROLE[t] || ""] || [];
    let v = 0;
    for (const o of outs) v = Math.max(v, peaks[o - 1] || 0);
    return v;
  },
  save: (as: boolean) => saveSession(as),
  open: () => openSession(),
};

function onTransport(st: Transport) {
  const p = page();
  if (busy || !p.playing) return;
  const s = p.songs.find((x) => x.id === p.playId);
  if (!s || s.id !== loadedSongId) return;
  if (st.playing) { p.setPos(toTime(s, st.bar, st.beat)); syncLoop(s); return; }
  // The engine stopped by itself: end of the song (or the device went away).
  p.setPos(st.ended ? Math.max(0, s.audio - 0.01) : toTime(s, st.bar, st.beat));
  p.setPlaying(false);
}

// ---------------------------------------------------------------- status chip
let setupText = "", setupTip = "";
function showStatus(stats?: Stats) {
  const chip = document.getElementById("statusChip"), dot = document.getElementById("statusDot"), txt = document.getElementById("statusTxt");
  if (!chip || !dot || !txt) return;
  txt.textContent = setupText || "No audio device";
  let tip = setupTip, colour = setupText ? "var(--green)" : "var(--red, #ff4d5e)";
  if (stats) {
    const problems = (stats.xruns || 0) + stats.underruns + stats.midiDropped;
    if (setupText && problems > 0) colour = "var(--amber, #f5a524)";
    if (setupText && !stats.running) colour = "var(--red, #ff4d5e)";
    tip += `\nDSP load ${Math.round(stats.cpu)}% · worst callback ${stats.callbackMaxMs.toFixed(2)} of ${stats.budgetMs.toFixed(2)} ms`
         + `\nDropouts ${stats.xruns === null ? "n/a" : stats.xruns} · disk underruns ${stats.underruns}`
         + `\nMIDI ${stats.midiSent} sent, ${stats.midiDropped} dropped, latest ${stats.midiLateMaxMs.toFixed(2)} ms late at most`;
  }
  chip.title = tip;
  dot.style.background = colour;
}
function onSetup(s: Setup) {
  const c = s.current;
  setupText = c ? `${String(Math.round(c.rate / 100) / 10).replace(/\.0$/, "")} kHz · ${c.buffer}` : "";
  setupTip = c ? `${c.device} (${c.driver.replace(/^Windows Audio/, "WASAPI")}) · ${c.rate / 1000} kHz · ${c.buffer} samples · ${c.latencyMs.toFixed(1)} ms output latency`
               : s.error || "No audio device. Choose one on the Outputs & MIDI page.";
  showStatus();
}

// ---------------------------------------------------------------- sessions
// The session survives page switches (each page is its own document) through sessionStorage.
interface Doc { name: string; savedText: string }
let doc: Doc = { name: "", savedText: "" };
// "Not muted" is stored either as false or not at all; drop the falses so toggling back counts as no change.
function tidy(v: any): any {
  if (Array.isArray(v)) return v.map(tidy);
  if (!v || typeof v !== "object") return v;
  const o: any = {};
  for (const [k, x] of Object.entries(v)) {
    if ((k === "mute" || k === "solo") && x && typeof x === "object") {
      const m: any = {}; for (const [t, b] of Object.entries(x)) if (b) m[t] = b;
      if (Object.keys(m).length) o[k] = m; // no entries = same as no map
    } else o[k] = tidy(x);
  }
  return o;
}
const sessionText = () => JSON.stringify(tidy({ format: "setline-session", version: 1, ...page().sessionData(), routing: routing() }), null, 1);
let lastReported = "";

function remember(text = sessionText()) {
  try { sessionStorage.setItem("setline.session", JSON.stringify({ doc, text })); } catch {}
  const dirty = text !== doc.savedText;
  const key = doc.name + "|" + dirty;
  if (key !== lastReported) { lastReported = key; SL.call("setDocument", { name: doc.name, dirty }).catch(() => {}); }
}

function applySession(text: string) {
  const o = JSON.parse(text);
  if (o.routing && typeof o.routing === "object") localStorage.setItem("setline.routing", JSON.stringify(o.routing));
  if (page().playing) { SLE.stop(); page().setPlaying(false); }
  loadedKey = null; loadedSongId = null;
  page().loadSession(o);
  page().setSessionName(doc.name);
}

async function saveSession(as: boolean) {
  const text = sessionText();
  const r = await SL.call<FileResult>(as ? "saveSessionAs" : "saveSession", { text });
  if (r.cancelled) return;
  if (r.error) { page().toast(r.error); return; }
  doc = { name: r.name || doc.name, savedText: text };
  page().setSessionName(doc.name);
  page().toast(`Saved “${doc.name}”`);
  remember(text);
}

async function openSession() {
  const go = async () => {
    const r = await SL.call<FileResult>("openSession");
    if (r.cancelled) return;
    if (r.error || !r.text) { page().toast(r.error || "Couldn't open that file"); return; }
    doc = { name: r.name || "", savedText: "" };
    applySession(r.text);
    doc.savedText = sessionText(); // what's on screen now is what's on disk
    page().toast(`Opened “${doc.name}”`);
    remember();
  };
  if (sessionText() !== doc.savedText) page().confirm("Open another session?", "This session has unsaved changes. They will be lost.", "Open without saving", go);
  else go();
}

// ---------------------------------------------------------------- start
async function main() {
  if (!SL.native) return;
  window.SLE = SLE;
  await SL.ready;
  SL.on("transport", onTransport);
  SL.on("meters", (m: { peaks: number[] }) => { peaks = m.peaks || []; });
  SL.on("audioSetupChanged", (s: Setup) => { loadedKey = null; onSetup(s); });
  SL.on("engineStats", (x: Stats) => showStatus(x));
  SL.on("menu", (m: { cmd: string }) => { if (m.cmd === "open") openSession(); else if (m.cmd === "save") saveSession(false); else if (m.cmd === "saveAs") saveSession(true); });

  // Session: carry on with the one from before a page switch, else this is a new, unsaved session.
  try {
    const kept = JSON.parse(sessionStorage.getItem("setline.session") || "null");
    if (kept && kept.text) { doc = kept.doc; applySession(kept.text); }
    else doc = { name: "", savedText: sessionText() };
  } catch (e) { console.warn("set.Line: session", e); doc = { name: "", savedText: sessionText() }; }
  page().setSessionName(doc.name);
  remember();
  setInterval(() => remember(), 1000); // unsaved marker + page-switch copy

  // Test hook (--session-roundtrip): open a file exactly as Open does, write it back exactly as Save does.
  const info = await SL.call<{ roundTrip?: { in: string; out: string } }>("getAppInfo");
  if (info.roundTrip) {
    const r = await SL.call<{ text: string }>("roundTripRead");
    doc = { name: "roundtrip", savedText: "" };
    applySession(r.text);
    await SL.call("roundTripDone", { text: sessionText() });
    return;
  }

  onSetup(await SL.call<Setup>("getAudioSetup"));
  showStatus(await SL.call<Stats>("getEngineStats"));

  // Coming back to this page while a song plays (pages reload when you switch tabs): follow it.
  try {
    const st = await SL.call<Transport>("getTransport");
    const s = st.playing ? page().songs.find((x) => x.name === st.song) : undefined;
    if (s) { loadedSongId = s.id; loadedKey = null; page().setPlayId(s.id); page().setPos(toTime(s, st.bar, st.beat)); page().setPlaying(true); }
  } catch (e) { console.warn("set.Line: transport state", e); }

  // The MIDI track "Port" menus list the real MIDI outputs (plus any port a song names that isn't connected).
  try {
    const outs = await SL.call<{ name: string }[]>("getMidiOutputs");
    const p = page(), used = new Set<string>();
    p.songs.forEach((s) => Object.values(s.midiCfg || {}).forEach((c: any) => c && c.port && used.add(c.port)));
    const real = outs.map((o) => o.name);
    p.PORTS.splice(0, p.PORTS.length, ...real, ...[...used].filter((u) => !real.includes(u)));
  } catch (e) { console.warn("set.Line: MIDI outputs", e); }
}

main().catch((e) => console.error("set.Line edit page:", e));
