// Edit page in the desktop app: Play/Stop/locate drive the real engine, and the playhead, LCD and meters
// follow its events. The page keeps its own state (playing, pos, playId); this module only feeds it.
// Positions cross the bridge as bar/beat, so the playhead stays on the page's bar grid even where the
// engine plays a tempo ramp as a jump.
import { SL } from "../bridge";

interface Bar { bar: number; t: number; dur: number; sig: [number, number]; beatT: number[] }
interface Song { id: string; name: string; tracks: string[]; bars: Bar[]; total: number; audio: number; [k: string]: any }
interface Page {
  songs: Song[]; playId: string | null; selId: string | null; pos: number; playing: boolean;
  isOff(s: Song, t: string): boolean; loopRange(s: Song): [number, number] | null;
  toast(msg: string): void; ROLE: Record<string, string>; PORTS: string[];
  clickCfg(s: Song): Record<string, unknown>;
  setPos(t: number): void; setPlayId(id: string): void; setPlaying(b: boolean): void; redraw(): void;
}
interface Transport { playing: boolean; loaded: boolean; song: string; bar: number; beat: number; seconds: number; ended?: boolean }
interface LoadResult { ok?: boolean; error?: string; code?: string; warnings?: string[]; epoch?: number }

declare global { interface Window { SLPage?: Page; SLE?: typeof SLE } }

// Default routing = the Outputs page's design defaults (outputs numbered from 1).
const DEFAULT_ROUTING: Record<string, number[]> = {
  click: [1], cues: [2], drums: [3, 4], bass: [5], keys: [7, 8], guitars: [9, 10], bgvs: [11, 12], synth: [13, 14], fx: [15],
};
function routing(): Record<string, number[]> {
  try { return { ...DEFAULT_ROUTING, ...JSON.parse(localStorage.getItem("setline.routing") || "{}") }; } catch { return DEFAULT_ROUTING; }
}

const page = () => window.SLPage!;
let loadedKey: string | null = null, loadedSongId: string | null = null, warnedKey: string | null = null;
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

async function ensureLoaded(s: Song): Promise<boolean> {
  const body = payload(s);
  const key = JSON.stringify(body);
  if (key === loadedKey && loadedSongId === s.id) return true;
  const r = await SL.call<LoadResult>("loadSong", body);
  if (r.error) { page().toast(r.error); loadedKey = null; return false; }
  loadedKey = key; loadedSongId = s.id;
  const w = r.warnings || [];
  if (w.length && warnedKey !== key) {
    warnedKey = key;
    page().toast(w[0] + (w.length > 1 ? `  (+${w.length - 1} more)` : ""));
    console.info(`set.Line: "${s.name}" loaded with notes:\n- ` + w.join("\n- "));
  }
  return true;
}

// ---------------------------------------------------------------- transport
async function run(s: Song, t: number) {
  busy = true;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await ensureLoaded(s))) { page().setPlaying(false); return; }
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
  // Meter level for a track: the peak of the outputs it's routed to (the engine meters outputs).
  trackLevel(s: Song, t: string): number {
    if (s.id !== loadedSongId) return 0;
    const outs = routing()[page().ROLE[t] || ""] || [];
    let v = 0;
    for (const o of outs) v = Math.max(v, peaks[o - 1] || 0);
    return v;
  },
};

function onTransport(st: Transport) {
  const p = page();
  if (busy || !p.playing) return;
  const s = p.songs.find((x) => x.id === p.playId);
  if (!s || s.id !== loadedSongId) return;
  if (st.playing) {
    p.setPos(toTime(s, st.bar, st.beat));
    const cy = p.loopRange(s);
    if (cy && p.pos >= cy[1]) SLE.playFrom(s, cy[0]); // loop: back to the start of the range
    return;
  }
  // The engine stopped by itself: end of the song (or the device went away).
  const cy = p.loopRange(s);
  if (st.ended && cy) { SLE.playFrom(s, cy[0]); return; }
  p.setPos(st.ended ? Math.max(0, s.audio - 0.01) : toTime(s, st.bar, st.beat));
  p.setPlaying(false);
}

// ---------------------------------------------------------------- start
async function main() {
  if (!SL.native) return;
  window.SLE = SLE;
  await SL.ready;
  SL.on("transport", onTransport);
  SL.on("meters", (m: { peaks: number[] }) => { peaks = m.peaks || []; });
  SL.on("audioSetupChanged", () => { loadedKey = null; });

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
