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
  clickCfg(s: Song, t?: string): Record<string, unknown>; gainOf(s: Song, t: string): number;
  setPos(t: number): void; setPlayId(id: string): void; setPlaying(b: boolean): void; redraw(): void;
  sessionData(): Record<string, any>; loadSession(o: Record<string, any>): void; setSessionName(n: string): void;
  confirm(title: string, body: string, ok: string, fn: () => void): void;
  // step 2: stems
  guessRole(fileName: string): string;
  addNative(list: AudioInfo[]): void; openNewSong(): void; modalOpen(): boolean; dropZone(): HTMLElement;
  addStems(s: Song, list: { role: string; info: AudioInfo }[], refs: Record<string, string>, copy: boolean): void;
  colourOf(t: string): string; roleOf(t: string): string; rerender(): void; redrawTrack(s: Song, t: string): void;
  // step 2: spoken cues
  cueCfg(s: Song): CueVoice; cueVoiceAll(): CueVoice; setVoices(list: VoiceInfo[]): void;
  setDirty(d: boolean): void; freshShow(): void;
  recFor(s: Song, text: string): string; wordFiles(): { path: string; copy?: boolean }[];
  addWords(s: Song, list: { name: string; ref: string }[], only: boolean): void;
  menu(e: { clientX: number; clientY: number }, items: (MenuItem | "-")[]): void;
  saveBox(title: string, body: string, choice: (c: "save" | "discard") => void): void;
  pron(): Record<string, string>; setVoiceModel(st: VoiceModel): void; setUnknownWords(list: string[]): void;
}
// Cue voice choice as saved (voice id + name: ids differ between computers) and an installed voice.
interface CueVoice { voice: string; name: string; speed: number }
interface MenuItem { label: string; icon?: string; key?: string; dis?: boolean; act: () => void }
interface VoiceInfo { id: string; name: string; lang: string; isDefault: boolean; engine?: string; gender?: string; grade?: string; rank?: number }
// The built-in Kokoro voices' download (Kokoro.h): missing | downloading | ready | failed.
interface VoiceModel { state: string; done: number; total: number; error: string }
// A file as the app read it (Media::probe). ok = false: error says why it can't be imported.
interface AudioInfo { path: string; name: string; ok: boolean; channels?: number; rate?: number; frames?: number; seconds?: number; format?: string; bits?: number; error?: string }
interface Progress { done: number; total: number; file: string; finished: boolean }
interface Transport { playing: boolean; loaded: boolean; song: string; bar: number; beat: number; seconds: number; ended?: boolean }
interface LoadResult { ok?: boolean; error?: string; code?: string; warnings?: string[]; epoch?: number }
interface FileResult { name?: string; path?: string; text?: string; cancelled?: boolean; error?: string }
interface Stats { running: boolean; xruns: number | null; underruns: number; midiSent: number; midiDropped: number; midiLateMaxMs: number; cpu: number; callbackMaxMs: number; budgetMs: number }
interface Setup { current: { driver: string; device: string; rate: number; buffer: number; latencyMs: number; outputs?: string[] } | null; error?: string }

declare global { interface Window { SLPage?: Page; SLE?: typeof SLE; SLR?: typeof SLR; SLW?: typeof SLW; SLC?: typeof SLC } }

// ---------------------------------------------------------------- output routing (by track name)
// Each distinct track name is routed once for the whole show: every song's track with that name follows
// it. A song can override a track's outputs for that song only (s.outs[track]). A name with no route
// plays nowhere ("not routed") until it's routed on the Outputs & MIDI page. Click and cues are tracks
// like any other. Stored in the session as routing: {v: 2, tracks: {name: [outputs, 1-based]}}.
interface Routing { v: 2; tracks: Record<string, number[]> }
let route: Routing = { v: 2, tracks: {} };
let outNames: string[] = [];

// Step 1 routed fixed track types (roles); these were its defaults.
const OLD_DEFAULTS: Record<string, number[]> = {
  click: [1], cues: [2], drums: [3, 4], bass: [5], keys: [7, 8], guitars: [9, 10], bgvs: [11, 12], synth: [13, 14], fx: [15],
};
const STEREO_ROLES = new Set(["drums", "keys", "guitars", "bgvs", "synth", "strings"]);
const isMidiTrack = (s: Song, t: string) => !!(s.midiCfg && s.midiCfg[t]);

// Every routable (non-MIDI) track name in the session, in order of first appearance.
function trackNames(): { name: string; songs: number; ch: number; overrides: number }[] {
  const m = new Map<string, { name: string; songs: number; ch: number; overrides: number }>();
  for (const s of page().songs)
    for (const t of s.tracks) {
      if (isMidiTrack(s, t)) continue;
      let e = m.get(t);
      if (!e) { e = { name: t, songs: 0, ch: 0, overrides: 0 }; m.set(t, e); }
      e.songs++;
      const f = (s.files || {})[t];
      e.ch = Math.max(e.ch, f && f.ch ? f.ch : STEREO_ROLES.has(page().roleOf(t)) ? 2 : 1);
      if (s.outs && Array.isArray(s.outs[t])) e.overrides++;
    }
  return [...m.values()];
}
// Old type-based routing {role: outputs} -> {name: outputs}, through each name's role.
function migrate(old: Record<string, unknown> | null | undefined): Routing {
  const src = old && typeof old === "object" ? old : OLD_DEFAULTS;
  const r: Routing = { v: 2, tracks: {} };
  for (const { name } of trackNames()) {
    const o = src[page().roleOf(name)];
    if (Array.isArray(o) && o.length) r.tracks[name] = o.map(Number);
  }
  return r;
}
function oldLocalRouting(): Record<string, unknown> | null {
  try { const o = JSON.parse(localStorage.getItem("setline.routing") || "null"); return o && !o.v ? o : null; } catch { return null; }
}
function loadRouting(o: any) {
  route = o && o.v === 2 && o.tracks && typeof o.tracks === "object" ? { v: 2, tracks: { ...o.tracks } } : migrate(o || oldLocalRouting());
}
// The outputs track t plays on in song s ([] = not routed).
function outsOf(s: Song, t: string): number[] {
  const o = s.outs && Array.isArray(s.outs[t]) ? s.outs[t] : route.tracks[t];
  return Array.isArray(o) ? o : [];
}
// "Line 3-4", "Out 5", "ADAT 1-2 + Line 7"
function outLabel(outs: number[]): string {
  const sorted = [...outs].sort((a, b) => a - b), runs: number[][] = [];
  for (const o of sorted) { const r = runs[runs.length - 1]; if (r && o === r[r.length - 1] + 1) r.push(o); else runs.push([o]); }
  const nm = (o: number) => outNames[o - 1] || `Out ${o}`;
  return runs.map((r) => {
    const a = nm(r[0]), b = nm(r[r.length - 1]);
    if (r.length === 1) return a;
    const ma = a.match(/^(.*?)\s*(\d+)$/), mb = b.match(/^(.*?)\s*(\d+)$/);
    return ma && mb && ma[1] === mb[1] ? `${ma[1]} ${ma[2]}-${mb[2]}` : `${a} – ${b}`;
  }).join(" + ");
}
const SLR = {
  label: (s: Song, t: string) => { const o = outsOf(s, t); return o.length ? outLabel(o) : ""; },
  isOverride: (s: Song, t: string) => !!(s.outs && Array.isArray(s.outs[t])),
  // Choices for the inspector's per-song menu: the show's routing, then each output and stereo pair.
  choices(s: Song, t: string) {
    const show = route.tracks[t] || [], cur = SLR.isOverride(s, t) ? JSON.stringify(s.outs[t]) : "";
    const list = [{ v: "", l: `Show: ${show.length ? outLabel(show) : "not routed"}`, on: cur === "" }];
    const n = Math.max(outNames.length, ...show, ...(s.outs?.[t] || []), 2);
    const stereo = ((s.files || {})[t]?.ch || (STEREO_ROLES.has(page().roleOf(t)) ? 2 : 1)) === 2;
    const add = (o: number[]) => { const v = JSON.stringify(o); list.push({ v, l: `This song: ${outLabel(o)}`, on: v === cur }); };
    if (stereo) for (let i = 1; i < n; i += 2) add([i, i + 1]);
    for (let i = 1; i <= n; i++) add([i]);
    add([]);
    list[list.length - 1].l = "This song: nowhere";
    if (cur && !list.some((c) => c.on)) list.push({ v: cur, l: `This song: ${outLabel(s.outs[t])}`, on: true });
    return list;
  },
  setOverride(s: Song, t: string, outs: number[] | null) {
    if (outs) (s.outs || (s.outs = {}))[t] = outs;
    else if (s.outs) { delete s.outs[t]; if (!Object.keys(s.outs).length) delete s.outs; }
    loadedKey = null;
  },
};
window.SLR = SLR;

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
  const outs: Record<string, number[]> = {};
  s.tracks.forEach((t) => { if (!isMidiTrack(s, t)) outs[t] = outsOf(s, t); });
  // The show's pronunciations go with the cue voice (the song's own, or the set's), as the app keys cues by them.
  const pron = p.pron();
  if (song.cueVoice) song.cueVoice = { ...song.cueVoice, pron };
  for (const q of (song.cues || []) as { text?: string; rec?: string; voice?: Record<string, unknown> }[]) {
    if (q.voice) q.voice = { ...q.voice, pron };
    const rec = p.recFor(s, q.text || ""); if (rec) q.rec = rec; // a recorded word plays instead of the voice
  }
  // each click track other than "Click" with its own settings (the app plays every click track, sample-exact)
  const clickTracks: Record<string, Record<string, unknown>> = {};
  s.tracks.forEach((t) => { if (p.ROLE[t] === "click" && t !== "Click") clickTracks[t] = p.clickCfg(s, t); });
  return { song, outs, roles, click: p.clickCfg(s), clickTracks, cueVoice: { ...p.cueVoiceAll(), pron } };
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
    const outs = outsOf(s, t);
    let v = 0;
    for (const o of outs) v = Math.max(v, peaks[o - 1] || 0);
    return v;
  },
  save: (as: boolean) => saveSession(as),
  open: () => openSession(),
  newSession: () => newSession(),
  fileMenu: (at: { clientX: number; clientY: number }) => fileMenu(at),
  // ---- step 2: stems ----
  pickStems: () => pickStems(),
  importStems: (infos: AudioInfo[], copy: boolean) => importStems(infos, copy),
  addStems: (s: Song) => addStems(s),
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
  deviceRate = c ? c.rate : null;
  outNames = c?.outputs || [];
  page().rerender();
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
// The show's sample rate: set by the first imported stem (the device's rate then), stored in the session.
// Stems at any other rate are refused; set.Line never resamples.
let sessionRate: number | null = null;
let deviceRate: number | null = null;
const rateForImport = () => sessionRate || deviceRate || 48000;
const sessionText = () => JSON.stringify(tidy({ format: "setline-session", version: 1, ...(sessionRate ? { rate: sessionRate } : {}), ...page().sessionData(), routing: route }), null, 1);
let lastReported = "";

// ---------------------------------------------------------------- spoken cues (step 2)
// Cues are rendered by the app ahead of time (Cues.h): every cue of the session is sent for rendering
// whenever the set of cue texts / voices changes, so Play only picks them up.
const cuesTrack = (s: Song) => s.tracks.find((t) => page().ROLE[t] === "cues");
let preparedKey = "";
function prepareCues() {
  if (!deviceRate) return;
  const list: { text: string; voice: string; name: string; speed: number; pron: Record<string, string>; rec: string }[] = [];
  const pron = page().pron();
  for (const s of page().songs) {
    if (!cuesTrack(s)) continue;
    const c = page().cueCfg(s);
    for (const q of (s.cues || []) as { text?: string; voice?: CueVoice }[]) {
      if (!q.text || !q.text.trim()) continue;
      const v = q.voice || c; // a cue's own voice (count-in), else the song's / set's
      list.push({ text: q.text.trim(), voice: v.voice || "", name: v.name || "", speed: v.speed || c.speed || 1, pron, rec: page().recFor(s, q.text) });
    }
  }
  const key = deviceRate + JSON.stringify(list);
  if (key === preparedKey) return;
  preparedKey = key;
  if (list.length) SL.call("prepareCues", { cues: list }).catch(() => {});
}
const SLC = {
  // Speaks text with song s's cue voice, once, on the Cues track's outputs at its level.
  async preview(s: Song, text: string) {
    const t = cuesTrack(s), c = page().cueCfg(s);
    const outs = t ? outsOf(s, t) : [];
    if (!outs.length) { page().toast("The Cues track isn't routed (Outputs & MIDI page), so a preview can't be heard"); return; }
    const r = await SL.call<{ ok?: boolean; error?: string; fellBack?: boolean }>("previewCue",
      { text, voice: c.voice || "", name: c.name || "", speed: c.speed || 1, pron: page().pron(), rec: page().recFor(s, text), outs, db: t ? page().gainOf(s, t) : 0 });
    if (r.error) page().toast(r.error);
  },
  // "+ Recorded word…": WAV / AIFF / FLAC at any rate, copied into <show>/Cues/Words (on save if the show is new).
  async addWords(s: Song, only: boolean) {
    const r = await SL.call<{ files?: AudioInfo[]; cancelled?: boolean; error?: string }>("pickAudioFiles", { rate: 0, multiple: true });
    if (r.error) { page().toast(r.error); return; }
    if (r.cancelled || !r.files) return;
    const good = r.files.filter((x) => x.ok);
    if (good.length < r.files.length) { const bad = r.files.find((x) => !x.ok)!; page().toast(`${bad.name}: ${bad.error}`); }
    if (!good.length) return;
    const cur = await SL.call<FileResult>("getSessionFile");
    const imp = await SL.call<{ files?: { path: string; ref: string }[]; error?: string }>("importAudio", { session: cur.path || "", copy: true, files: good.map((x) => x.path), sub: "Cues/Words" });
    if (imp.error) { page().toast(imp.error); return; }
    page().addWords(s, (imp.files || []).map((f) => ({ name: f.path.split(/[\\/]/).pop() || f.path, ref: f.ref })), only);
    preparedKey = ""; prepareCues(); loadedKey = null;
  },
  downloadVoices() { SL.call("downloadVoices").catch(() => {}); },
  cancelVoiceDownload() { SL.call("cancelVoiceDownload").catch(() => {}); },
  // Words in the show's cues no dictionary knows (Kokoro voices): shown on the Cue voice panel.
  async checkWords(s: Song) {
    const c = page().cueCfg(s);
    if (!/^kokoro:/.test(c.voice || "")) { page().setUnknownWords([]); return; }
    const texts: string[] = [];
    for (const x of page().songs) for (const q of (x.cues || []) as { text?: string }[]) if (q.text && q.text.trim() && !page().recFor(x, q.text)) texts.push(q.text.trim());
    const r = await SL.call<{ unknown?: string[] }>("checkCueWords", { texts, voice: c.voice, name: c.name, speed: c.speed || 1, pron: page().pron() });
    page().setUnknownWords(r.unknown || []);
  },
};

function remember(text = sessionText()) {
  // tracks: what the Outputs & MIDI page lists (it's a separate page; it edits routing in this copy).
  const tracks = trackNames().map((x) => ({ ...x, colour: page().colourOf(x.name) }));
  try { sessionStorage.setItem("setline.session", JSON.stringify({ doc, text, tracks })); } catch {}
  const dirty = text !== doc.savedText;
  page().setDirty(dirty);
  const key = doc.name + "|" + dirty;
  if (key !== lastReported) { lastReported = key; SL.call("setDocument", { name: doc.name, dirty }).catch(() => {}); }
  prepareCues();
}

function applySession(text: string) {
  const o = JSON.parse(text);
  if (page().playing) { SLE.stop(); page().setPlaying(false); }
  loadedKey = null; loadedSongId = null;
  sessionRate = typeof o.rate === "number" && o.rate > 0 ? o.rate : null;
  page().loadSession(o);
  loadRouting(o.routing); // after the songs: old type-based routing is migrated through their track names
  page().setSessionName(doc.name);
  page().rerender();
}

// Every audio file the session refers to (song stems).
function audioFiles(): { song: Song; track: string; f: { path: string; copy?: boolean } }[] {
  const out: { song: Song; track: string; f: { path: string; copy?: boolean } }[] = [];
  for (const s of page().songs) for (const [t, f] of Object.entries(s.files || {})) if (f && (f as any).path) out.push({ song: s, track: t, f: f as any });
  return out;
}
function applyRefMap(map: Record<string, string>) {
  for (const x of audioFiles()) if (map[x.f.path] !== undefined) x.f.path = map[x.f.path];
  for (const w of page().wordFiles()) if (map[w.path] !== undefined) w.path = map[w.path]; // recorded cue words
  forgetMissingPeaks(); // located files get their waveforms
}

// ---------------------------------------------------------------- waveforms (step 2)
// The app computes each stem's peaks in the background (Peaks.h) at 256, 1024 and 4096 frames per value.
// The Edit page asks SLW.get for the level that fits its zoom; null means "not here yet": the request is
// queued and the track redrawn when it arrives. Lanes on screen are fetched first, a few at a time, so
// opening a session with many stems never blocks the page. Another level already here is drawn meanwhile.
interface Wave { data: Uint8Array; perSec: number }
const LEVELS = [256, 1024, 4096];
const waves = new Map<string, Wave | "pending" | "missing">(); // key: ref|level
const waveQueue: { key: string; ref: string; level: number }[] = [];
let waveBusy = 0;
const levelFor = (rate: number, pxs: number) => { let l = LEVELS[0]; for (const v of LEVELS) if (v <= rate / pxs) l = v; return l; };

const SLW = {
  get(s: Song, t: string, pxs: number): Wave | null {
    const f = (s.files || {})[t];
    if (!f || !f.path) return null;
    const level = levelFor(f.rate || sessionRate || 48000, pxs), key = f.path + "|" + level;
    const w = waves.get(key);
    if (w && w !== "pending" && w !== "missing") return w;
    if (!w) { waves.set(key, "pending"); waveQueue.push({ key, ref: f.path, level }); schedulePump(); }
    for (const l of LEVELS) { const o = waves.get(f.path + "|" + l); if (o && typeof o === "object") return o; } // another zoom's peaks
    return null;
  },
  stats: () => ({ cached: [...waves.values()].filter((w) => typeof w === "object").length, queued: waveQueue.length, busy: waveBusy }),
};

function laneVisible(ref: string) {
  const sc = document.getElementById("scroller");
  if (!sc) return false;
  const box = sc.getBoundingClientRect();
  for (const s of page().songs)
    for (const [t, f] of Object.entries(s.files || {}))
      if ((f as any)?.path === ref) {
        const cv = document.querySelector(`canvas[data-song="${s.id}"][data-t="${s.tracks.indexOf(t)}"]`);
        const r = cv?.getBoundingClientRect();
        if (r && r.bottom > box.top && r.top < box.bottom) return true;
      }
  return false;
}

// After the current redraw has queued all its lanes, so the choice sees every lane on screen.
let pumpSoon = false;
function schedulePump() {
  if (pumpSoon) return;
  pumpSoon = true;
  setTimeout(() => { pumpSoon = false; pumpWaves(); }, 0);
}
function pumpWaves() {
  while (waveBusy < 3 && waveQueue.length) {
    let i = waveQueue.findIndex((q) => laneVisible(q.ref)); // what's on screen first
    if (i < 0) i = 0;
    const q = waveQueue.splice(i, 1)[0];
    waveBusy++;
    SL.call<{ peaks?: string; rate?: number; spp?: number; error?: string }>("getPeaks", { ref: q.ref, spp: q.level })
      .then((r) => {
        if (r.error || !r.peaks) { waves.set(q.key, "missing"); return; }
        const bin = atob(r.peaks), data = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) data[k] = bin.charCodeAt(k);
        waves.set(q.key, { data, perSec: r.rate! / r.spp! });
        for (const s of page().songs)
          for (const [t, f] of Object.entries(s.files || {})) if ((f as any)?.path === q.ref) page().redrawTrack(s, t);
      })
      .catch(() => waves.set(q.key, "missing"))
      .finally(() => { waveBusy--; pumpWaves(); });
  }
}
function forgetMissingPeaks() {
  for (const [k, w] of waves) if (w === "missing") waves.delete(k);
}

let saving = false;
// Saves (asks where for a new session or Save As). true when the session is on disk afterwards.
// to: tests only, the target path instead of the dialog.
async function saveSession(as: boolean, to?: string): Promise<boolean> {
  if (saving) return false;
  saving = true;
  try {
    // A session lives in its own folder: <folder>/<name>.setline with the stems in <folder>/Audio.
    const cur = await SL.call<FileResult>("getSessionFile");
    let target = to || cur.path || "";
    if (!to && (as || !target)) {
      const r = await SL.call<FileResult>("chooseSessionFile");
      if (r.cancelled) return false;
      if (r.error || !r.path) { page().toast(r.error || "Couldn't save"); return false; }
      target = r.path;
    }
    // Stems flagged "Copy into session" are copied into its Audio folder; every reference becomes
    // relative to the session folder (absolute only for files kept outside it).
    const files = audioFiles(), words = page().wordFiles();
    if (files.length || words.length) {
      const c = await SL.call<{ map?: Record<string, string>; missing?: string[]; error?: string }>("collectAudio",
        { from: cur.path || "", to: target, files: [...files.map((x) => ({ ref: x.f.path, copy: !!x.f.copy })), ...words.map((w) => ({ ref: w.path, copy: true, sub: "Cues/Words" }))] });
      if (c.error) { page().toast(c.error); return false; }
      applyRefMap(c.map || {});
      if (c.missing && c.missing.length) page().toast(`${c.missing.length} audio file${c.missing.length > 1 ? "s are" : " is"} missing; saved without copying ${c.missing.length > 1 ? "them" : "it"}`);
    }
    const text = sessionText();
    const r = await SL.call<FileResult>("writeSession", { path: target, text });
    if (r.error) { page().toast(r.error); return false; }
    doc = { name: r.name || doc.name, savedText: text };
    page().setSessionName(doc.name);
    page().toast(`Saved “${doc.name}”`);
    remember(text);
    return true;
  } finally { saving = false; }
}

// ---------------------------------------------------------------- File menu (phase 6b)
// Before replacing the session (New, Open, Open Recent, Close, Quit): Save / Don't save / Cancel when it has
// unsaved changes. then() runs once it's saved or the user chose not to.
const isDirty = () => sessionText() !== doc.savedText;
function askSave(what: string, then: () => void) {
  if (!isDirty()) { then(); return; }
  const name = doc.name || "Untitled session";
  page().saveBox(`Save changes to “${name}”?`, `${what} Your changes are lost if you don’t save them.`, async (c) => {
    if (c === "discard") { then(); return; }
    if (await saveSession(false)) then();
  });
}
const BLANK = JSON.stringify({ songs: [], setlists: [{ id: "L1", name: "Setlist 1", order: [] }], curSet: "L1" });
// New and Close: an empty, untitled session (the next Save asks where).
function newSession(verb = "Starting a new session closes this one.") {
  askSave(verb, async () => {
    await SL.call("closeSession");
    doc = { name: "", savedText: "" };
    page().freshShow();
    applySession(BLANK);
    doc.savedText = sessionText();
    remember();
  });
}
async function openPath(path: string) {
  const r = await SL.call<FileResult>("openSessionPath", { path });
  if (r.error || !r.text) { page().toast(r.error || "Couldn't open that file"); return; }
  doc = { name: r.name || "", savedText: "" };
  applySession(r.text);
  doc.savedText = sessionText();
  page().toast(`Opened “${doc.name}”`);
  remember();
  if (r.path) await checkAudio(r.path);
}
async function fileMenu(at: { clientX: number; clientY: number }) {
  const mod = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";
  let recent: { name: string; path: string; exists: boolean }[] = [];
  try { recent = await SL.call("getRecentSessions"); } catch {}
  const items: (MenuItem | "-")[] = [
    { label: "New", icon: "＋", key: mod + "N", act: () => newSession() },
    { label: "Open…", icon: "📂", key: mod + "O", act: () => openSession() },
    { label: "Open Recent", icon: "", dis: true, act: () => {} },
    ...(recent.length ? recent.map((x) => ({ label: x.name + (x.exists ? "" : " (not found)"), icon: "·", dis: !x.exists,
      act: () => askSave("Opening another session closes this one.", () => openPath(x.path)) }))
      : [{ label: "No recent sessions", icon: "", dis: true, act: () => {} }]),
    ...(recent.length ? [{ label: "Clear the list", icon: "", act: () => { SL.call("clearRecentSessions").catch(() => {}); } }] : []),
    "-",
    { label: "Save", icon: "💾", key: mod + "S", act: () => { saveSession(false); } },
    { label: "Save As…", icon: "", key: (mod === "⌘" ? "⇧⌘" : "Ctrl+Shift+") + "S", act: () => { saveSession(true); } },
    "-",
    { label: "Close", icon: "✕", act: () => newSession("Closing the session.") },
  ];
  page().menu(at, items);
}

// After opening: find the session's audio. Files found in the session's Audio folder under their name are
// fixed silently; the rest are listed with "Locate…". Missing stems play as silence; nothing is blocked.
async function checkAudio(sessionPath: string) {
  const refs = [...new Set(audioFiles().map((x) => x.f.path))];
  if (!refs.length) return;
  const r = await SL.call<{ missing: string[]; map: Record<string, string> }>("checkAudio", { session: sessionPath, refs });
  applyRefMap(r.map || {});
  if (r.missing && r.missing.length) askLocate(sessionPath, r.missing);
}
function askLocate(sessionPath: string, missing: string[]) {
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const names = missing.map((m) => m.split(/[\\/]/).pop() || m);
  const list = names.slice(0, 8).map(esc).join("<br>") + (names.length > 8 ? `<br>and ${names.length - 8} more` : "");
  const n = missing.length;
  page().confirm(`${n} audio file${n > 1 ? "s" : ""} missing`,
    `${list}<br><br>Missing stems play as silence. Locate one and set.Line finds the others in the same folder.`, "Locate…", async () => {
      const r = await SL.call<{ map?: Record<string, string>; cancelled?: boolean }>("locateAudio", { session: sessionPath, missing });
      if (r.cancelled || !r.map) return;
      applyRefMap(r.map);
      loadedKey = null;
      page().redraw();
      const still = missing.filter((m) => r.map![m] === undefined);
      if (still.length) askLocate(sessionPath, still);
      else page().toast("All audio found");
    });
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
    if (r.path) await checkAudio(r.path);
  };
  askSave("Opening another session closes this one.", go);
}

// ---------------------------------------------------------------- stems (step 2)
const COPY_PREF = "setline.copyAudio";
const copyPref = () => localStorage.getItem(COPY_PREF) !== "0";

// Native picker; each file comes back read and checked against the show's rate.
async function pickStems(): Promise<AudioInfo[] | null> {
  const r = await SL.call<{ files?: AudioInfo[]; cancelled?: boolean; error?: string }>("pickAudioFiles", { rate: rateForImport(), multiple: true });
  if (r.error) { page().toast(r.error); return null; }
  return r.cancelled ? null : r.files || [];
}
async function probe(paths: string[]): Promise<AudioInfo[]> {
  const r = await SL.call<{ files: AudioInfo[] }>("probeAudio", { paths, rate: rateForImport() });
  return r.files || [];
}

// Copies the files into the session's Audio folder (if it has one and copy is on) and returns
// {file path: reference to store}. An unsaved session keeps absolute paths until it's saved.
async function importStems(infos: AudioInfo[], copy: boolean): Promise<Record<string, string> | null> {
  localStorage.setItem(COPY_PREF, copy ? "1" : "0");
  if (!infos.length) return {};
  const cur = await SL.call<FileResult>("getSessionFile");
  const r = await SL.call<{ files?: { path: string; ref: string }[]; error?: string }>("importAudio",
    { session: cur.path || "", copy, files: infos.map((i) => i.path) });
  if (r.error) { page().toast(r.error); return null; }
  if (!sessionRate) sessionRate = infos.find((i) => i.rate)?.rate || rateForImport();
  const refs: Record<string, string> = {};
  for (const f of r.files || []) refs[f.path] = f.ref;
  return refs;
}

// "+ Track > Audio" (and files dropped on a song): new audio tracks on song s.
async function addStemsFrom(s: Song, list: AudioInfo[]) {
  const bad = list.filter((x) => !x.ok), good = list.filter((x) => x.ok);
  if (bad.length) page().toast(`${bad[0].name}: ${bad[0].error}` + (bad.length > 1 ? `  (+${bad.length - 1} more not imported)` : ""));
  if (!good.length) return;
  const copy = copyPref();
  const refs = await importStems(good, copy);
  if (!refs) return;
  page().addStems(s, good.map((info) => ({ role: page().guessRole(info.name), info })), refs, copy);
  loadedKey = null;
  page().toast(`Added ${good.length} track${good.length > 1 ? "s" : ""} to “${s.name}”`);
}
async function addStems(s: Song) {
  const list = await pickStems();
  if (list) await addStemsFrom(s, list);
}

// Copy progress: a small sheet with a bar while files are copied.
let progressEl: HTMLElement | null = null;
function onProgress(p: Progress) {
  if (p.finished) { progressEl?.remove(); progressEl = null; return; }
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.className = "cfbg";
    progressEl.innerHTML = `<div class="cfbox" style="min-width:340px"><b>Copying audio into the session…</b><p class="pf" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></p>`
      + `<div style="height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;margin:4px 0 6px"><div class="pb" style="height:100%;width:0;background:var(--amber,#f5a524)"></div></div><p class="pn" style="margin:0"></p></div>`;
    document.body.appendChild(progressEl);
  }
  const mb = (x: number) => (x / 1048576).toFixed(0);
  progressEl.querySelector<HTMLElement>(".pf")!.textContent = p.file;
  progressEl.querySelector<HTMLElement>(".pb")!.style.width = `${p.total > 0 ? (100 * p.done) / p.total : 0}%`;
  progressEl.querySelector<HTMLElement>(".pn")!.textContent = `${mb(p.done)} of ${mb(p.total)} MB`;
}

// Files dragged onto the window. The app takes the drop (the web view gives pages no paths) and tells
// the page where: onto the New Song sheet, onto a song (new tracks), or anywhere else (a new song).
async function onFileDrag(d: { state: string; x: number; y: number; paths: string[] }) {
  const p = page();
  const dz = p.dropZone();
  const audio = (d.paths || []).filter((x) => /\.(wav|wave|aiff?|flac)$/i.test(x));
  if (d.state === "over") { dz.classList.toggle("over", p.modalOpen() && audio.length > 0); return; }
  dz.classList.remove("over");
  if (d.state !== "drop") return;
  const sessions = d.paths.filter((x) => /\.setline$/i.test(x));
  if (!audio.length) {
    p.toast(sessions.length ? "To open a session, use Open (Ctrl/Cmd+O)" : "Drop WAV, AIFF or FLAC files");
    return;
  }
  const list = await probe(audio);
  if (p.modalOpen()) { p.addNative(list); return; }
  const folder = (document.elementFromPoint(d.x, d.y) as HTMLElement | null)?.closest<HTMLElement>(".folder[data-id]");
  const s = folder ? p.songs.find((x) => x.id === folder.dataset.id) : undefined;
  if (s) { await addStemsFrom(s, list); return; }
  p.openNewSong();
  p.addNative(list);
}

// Windows: the page takes the drop. A dropped File has no path in a page, so the files are posted to the
// app with WebView2's postMessageWithAdditionalObjects; the app reads their real paths and answers with a
// "fileDrag" drop event (onFileDrag above). macOS: the window takes the drop instead (app-gui/MacDrop.mm).
function installDrop() {
  const wv = (window as any).chrome?.webview;
  if (!wv || typeof wv.postMessageWithAdditionalObjects !== "function") return;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
  const highlight = (on: boolean) => page().dropZone().classList.toggle("over", on && page().modalOpen());
  // Capture phase: file drags never reach the page's own drag handlers (those move songs and clips).
  window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { e.preventDefault(); highlight(true); } }, true);
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer!.dropEffect = "copy";
    highlight(true);
  }, true);
  window.addEventListener("dragleave", (e) => { if (hasFiles(e) && !e.relatedTarget) highlight(false); }, true);
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    highlight(false);
    const files = e.dataTransfer!.files;
    if (!files.length) return;
    wv.postMessageWithAdditionalObjects(JSON.stringify({ eventId: "setlineDrop", payload: { x: e.clientX, y: e.clientY } }), files);
  }, true);
}

// ---------------------------------------------------------------- start
async function main() {
  if (!SL.native) return;
  window.SLE = SLE;
  window.SLW = SLW;
  window.SLC = SLC;
  await SL.ready;
  SL.on("transport", onTransport);
  SL.on("meters", (m: { peaks: number[] }) => { peaks = m.peaks || []; });
  SL.on("audioSetupChanged", (s: Setup) => { loadedKey = null; onSetup(s); });
  SL.on("engineStats", (x: Stats) => showStatus(x));
  SL.on("audioProgress", onProgress);
  SL.on("fileDrag", (d) => { onFileDrag(d).catch((e) => page().toast(String(e))); });
  installDrop();
  const copyBox = document.getElementById("mCopy") as HTMLInputElement | null;
  if (copyBox) {
    document.getElementById("mCopyL")!.hidden = false;
    copyBox.checked = copyPref();
    copyBox.onchange = () => localStorage.setItem(COPY_PREF, copyBox.checked ? "1" : "0");
  }
  // Kokoro voices: download progress; once they're in, the cues are rendered with them and the next Play reloads.
  SL.on("voiceDownload", (st: VoiceModel) => {
    const clean = !isDirty();
    page().setVoiceModel(st);
    if (clean) doc.savedText = sessionText();
    if (st.state === "ready") { preparedKey = ""; prepareCues(); loadedKey = null; }
  });
  SL.on("menu", (m: { cmd: string }) => {
    if (m.cmd === "open") openSession(); else if (m.cmd === "save") saveSession(false); else if (m.cmd === "saveAs") saveSession(true);
    else if (m.cmd === "new") newSession(); else if (m.cmd === "close") newSession("Closing the session.");
    else if (m.cmd === "quit") { SL.call("quitAnswered").catch(() => {}); askSave("Quitting set.Line.", () => { SL.call("quitNow").catch(() => {}); }); }
  });

  // Session: carry on with the one from before a page switch, else this is a new, unsaved session.
  try {
    const kept = JSON.parse(sessionStorage.getItem("setline.session") || "null");
    if (kept && kept.text) { doc = kept.doc; applySession(kept.text); }
    else { loadRouting(oldLocalRouting()); doc = { name: "", savedText: sessionText() }; }
  } catch (e) { console.warn("set.Line: session", e); loadRouting(null); doc = { name: "", savedText: sessionText() }; }
  page().rerender();
  addEventListener("pagehide", () => remember()); // switching pages: keep the very latest
  page().setSessionName(doc.name);
  remember();
  setInterval(() => remember(), 1000); // unsaved marker + page-switch copy

  // Test hook (--session-roundtrip): open a file exactly as Open does, write it back exactly as Save does.
  const info = await SL.call<{ roundTrip?: { in: string; out: string }; testScript?: string }>("getAppInfo");

  if (info.roundTrip) {
    const r = await SL.call<{ text: string }>("roundTripRead");
    doc = { name: "roundtrip", savedText: "" };
    applySession(r.text);
    await SL.call("roundTripDone", { text: sessionText() });
    return;
  }

  onSetup(await SL.call<Setup>("getAudioSetup"));
  try { page().setVoices(await SL.call<VoiceInfo[]>("getVoices")); } catch (e) { console.warn("set.Line: voices", e); }
  // (a new show taking the Kokoro default voice is not an edit: an untouched session stays "saved")
  try { const clean = !isDirty(); page().setVoiceModel(await SL.call<VoiceModel>("voiceModel")); if (clean) doc.savedText = sessionText(); } catch (e) { console.warn("set.Line: voice model", e); }
  prepareCues();
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
  // Test hook (--test-script): run an async script with the page and this module's functions; write its result.
  if (info.testScript) {
    let out: unknown;
    try {
      const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
      const hooks = { SLE, page, importStems, probe, audioFiles, applyRefMap, checkAudio, onFileDrag, sessionText, applySession,
        getRate: () => sessionRate, saveTo: (path: string) => saveSession(false, path), SLR, SLW, waves, SLC, prepareCues, remember, payload, getRoute: () => route, isDirty: () => sessionText() !== doc.savedText, setDoc: (n: string) => { doc = { name: n, savedText: "" }; } };
      out = await new AsyncFn("SL", "hooks", info.testScript)(SL, hooks);
    } catch (e) { out = { error: String((e as Error)?.stack || e) }; }
    if (out !== undefined) await SL.call("testDone", { text: JSON.stringify(out, null, 1) }); // undefined: it went to another page
  }
}

main().catch((e) => console.error("set.Line edit page:", e));
