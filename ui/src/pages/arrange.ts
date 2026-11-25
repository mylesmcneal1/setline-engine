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
  setOutputs(device: string, names: string[]): void; routeLog(): string[];
  openSettings(tab?: string): void; settingsChanged(): void;
  setListen(st: ListenState, what?: string): void;
  nameBox(o: { title: string; value: string; where: string }, done: (r: { name?: string; elsewhere?: boolean } | null) => void): void;
  copyStatus(p: { done: number; total: number; files?: number; filesDone?: number; finished: boolean; error?: string }): void;
  recFor(s: Song, text: string): string; wordFiles(): { path: string; copy?: boolean }[];
  addWords(s: Song, list: { name: string; ref: string }[], only: boolean): void;
  menu(e: { clientX: number; clientY: number }, items: (MenuItem | "-")[]): void;
  saveBox(title: string, body: string, choice: (c: "save" | "discard") => void): void;
  about(info: { version?: string; platform?: string }): void;
  pron(): Record<string, string>; setVoiceModel(st: VoiceModel): void; setUnknownWords(list: string[]): void;
}
// Cue voice choice as saved (voice id + name: ids differ between computers) and an installed voice.
interface CueVoice { voice: string; name: string; speed: number }
interface ListenState { on?: boolean; driver?: string; device?: string; current?: string; mode?: string; output?: number[]; click?: boolean; cues?: boolean; midi?: boolean; error?: string; devices?: { driver: string; device: string }[] }
interface Folders { shows: string; defaultShows: string; library: string }
interface MenuItem { label: string; icon?: string; key?: string; dis?: boolean; act: () => void }
interface VoiceInfo { id: string; name: string; lang: string; isDefault: boolean; engine?: string; gender?: string; grade?: string; rank?: number }
// The built-in Kokoro voices' download (Kokoro.h): missing | downloading | ready | failed.
interface VoiceModel { state: string; done: number; total: number; error: string }
// A file as the app read it (Media::probe). ok = false: error says why it can't be imported.
interface AudioInfo { path: string; name: string; ok: boolean; channels?: number; rate?: number; frames?: number; seconds?: number; format?: string; bits?: number; error?: string }
interface Progress { done: number; total: number; file: string; finished: boolean; files?: number; filesDone?: number; kind?: string; error?: string }
interface Transport { playing: boolean; loaded: boolean; song: string; bar: number; beat: number; seconds: number; ended?: boolean }
interface LoadResult { ok?: boolean; error?: string; code?: string; warnings?: string[]; epoch?: number }
interface FileResult { name?: string; path?: string; text?: string; cancelled?: boolean; error?: string }
interface Stats { running: boolean; xruns: number | null; underruns: number; midiSent: number; midiDropped: number; midiLateMaxMs: number; cpu: number; callbackMaxMs: number; budgetMs: number }
interface Setup { current: { driver: string; device: string; rate: number; buffer: number; latencyMs: number; outputs?: string[] } | null; error?: string }

interface Routes { setOverride(s: Song, t: string, o: number[] | null): void; label(s: Song, t: string): string; outsOf(s: Song, t: string): number[] }
declare global { interface Window { SLPage?: Page; SLE?: typeof SLE; SLR?: Routes; SLW?: typeof SLW; SLC?: typeof SLC } }

// ---------------------------------------------------------------- outputs (6d)
// Every track has its own output in its song (s.outs[track], 1-based outputs); the page owns that model and
// migrates shows saved with the old show-wide routing (1-arrange.html, migrateRouting).
const isMidiTrack = (s: Song, t: string) => !!(s.midiCfg && s.midiCfg[t]);
const outsOf = (s: Song, t: string): number[] => (window.SLR ? window.SLR.outsOf(s, t) : []);

const page = () => window.SLPage!;
let loadedKey: string | null = null, loadedSongId: string | null = null, warnedKey: string | null = null, loopKey = "";
let busy = false, pending: { s: Song; t: number } | null = null;
let peaks: number[] = [];
let trackPeaks: Record<string, number> = {}; // each track after its fader (the engine meters every track)

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
  // the song's own computed bar list / section positions stay behind; a MIDI or click clip's "bars" (its length)
  // goes with it (dropping those too made every MIDI clip one bar long: events after its first bar never played)
  const song = JSON.parse(JSON.stringify(s, function (this: Record<string, unknown>, k: string, v: unknown) {
    return this === (s as unknown) && (k === "bars" || k === "secPos" || k === "_yy") ? undefined : v;
  }));
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
  // Meter level for a track: its own peak after the fader, as the engine played it.
  trackLevel(s: Song, t: string): number {
    if (s.id !== loadedSongId) return 0;
    return trackPeaks[t] || 0;
  },
  save: (as: boolean) => saveSession(as),
  open: () => openSession(),
  newSession: () => newSession(),
  // Glue (6c item 7): the clips of t from a to b (seconds) rendered exactly as they play into a new WAV
  glueAudio: (s: Song, t: string, a: number, b: number) => SL.call<{ ref?: string; offset?: number; frames?: number; seconds?: number; error?: string }>("glueAudio", { payload: payload(s), track: t, ref: s.files[t]?.path || "", from: a, to: b }),
  listen: (req: Partial<ListenState>) => setListen(req),
  diagnostics: (how: "copy" | "save") => diagnostics(how),
  preferences: () => preferences(),
  openBackup: () => openBackup(),
  cleanUpAudio: () => cleanUpAudio(),
  // Settings (6d) asks the app directly: audio setup, listen devices, MIDI outputs, folders...
  call: <T = any>(name: string, args?: unknown) => SL.call<T>(name, args),
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
// One status pill (6d): "iD14 · 48k · 128" with a dot that turns red on a dropout or when the interface is gone.
// Clicking it opens Settings › Audio.
let setupText = "", setupTip = "", lastProblems = -1, problemSince = 0;
function showStatus(stats?: Stats) {
  const chip = document.getElementById("statusChip"), dot = document.getElementById("statusDot"), txt = document.getElementById("statusTxt");
  if (!chip || !dot || !txt) return;
  txt.textContent = setupText || "No audio device";
  let tip = setupTip, red = !setupText;
  if (stats) {
    const problems = (stats.xruns || 0) + stats.underruns + stats.midiDropped;
    if (lastProblems >= 0 && problems > lastProblems) problemSince = Date.now(); // a new dropout: red for a while
    lastProblems = problems;
    if (Date.now() - problemSince < 30000) red = true;
    if (setupText && !stats.running) red = true;
    tip += `\nAudio load ${Math.round(stats.cpu)}% · worst callback ${stats.callbackMaxMs.toFixed(2)} of ${stats.budgetMs.toFixed(2)} ms`
         + `\nDropouts ${stats.xruns === null ? "n/a" : stats.xruns} · disk underruns ${stats.underruns}`
         + `\nMIDI ${stats.midiSent} sent, ${stats.midiDropped} dropped`;
  }
  chip.title = tip + "\nClick for Settings › Audio";
  dot.style.background = red ? "var(--red, #ff453a)" : "var(--green, #30d158)";
  chip.classList.toggle("bad", red);
}
// ---------------------------------------------------------------- listen on this computer
// The show's interface output names, remembered while it's open (when listening, the device is the computer's).
let showOutNames: string[] = JSON.parse(localStorage.getItem("setline.showOutputNames") || "[]");
let listen: ListenState = {};
function showOutLabel(outs: number[]): string {
  const n = (i: number) => showOutNames[i - 1] || `Out ${i}`;
  return outs.length === 2 ? `${n(outs[0])} + ${n(outs[1])}` : n(outs[0]);
}
function listenWhat(): string {
  return listen.mode === "output" && listen.output && listen.output.length ? showOutLabel(listen.output) + " only" : "everything";
}
async function setListen(req: Partial<ListenState>) {
  const r = await SL.call<ListenState>("setListen", { ...req, rate: sessionRate || deviceRate || 48000 });
  if (r.error) {
    // never resampled: offer a device that can run at the show's rate
    const can = r.devices || [];
    if (!can.length) { page().toast(r.error); return; }
    page().menu({ clientX: innerWidth - 420, clientY: 60 }, [
      { label: r.error, icon: "⚠", dis: true, act: () => {} },
      { label: "These can run at the show's rate:", icon: "", dis: true, act: () => {} },
      ...can.map((d) => ({ label: `${d.device} (${d.driver})`, icon: "🔈", act: () => { setListen({ on: true, driver: d.driver, device: d.device }); } })),
    ]);
    return;
  }
  listen = r;
  page().setListen(listen, listenWhat());
  loadedKey = null; // mapped again for the new outputs
  onSetup(await SL.call<Setup>("getAudioSetup"));
}
function onSetup(s: Setup) {
  const c = s.current;
  deviceRate = c ? c.rate : null;
  page().setOutputs(c ? c.device : "", c?.outputs || []);
  if (!listen.on && c?.outputs?.length) { showOutNames = c.outputs; localStorage.setItem("setline.showOutputNames", JSON.stringify(showOutNames)); }
  page().rerender();
  // "Audient USB Audio ASIO Driver" -> "Audient USB Audio": the name without the driver words, kept short
  const short = (d: string) => d.replace(/\s*\((ASIO|WASAPI|Windows Audio|CoreAudio)[^)]*\)\s*$/i, "").replace(/\s+(ASIO\s+)?Driver$/i, "").replace(/\s+ASIO$/i, "").slice(0, 22);
  setupText = c ? `${short(c.device)} · ${String(Math.round(c.rate / 100) / 10).replace(/\.0$/, "")}k · ${c.buffer}` : "";
  setupTip = c ? `${c.device} (${c.driver.replace(/^Windows Audio/, "WASAPI")}) · ${c.rate / 1000} kHz · ${c.buffer} samples · ${c.latencyMs.toFixed(1)} ms output latency`
               : s.error || "No audio device. Choose one in Settings › Audio.";
  showStatus();
  page().settingsChanged();
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
const sessionText = () => JSON.stringify(tidy({ format: "setline-session", version: 2, ...(sessionRate ? { rate: sessionRate } : {}), ...page().sessionData() }), null, 1);
let lastReported = "";

// ---------------------------------------------------------------- spoken cues (step 2)
// Cues are rendered by the app ahead of time (Cues.h): every cue of the session is sent for rendering
// whenever the set of cue texts / voices changes, so Play only picks them up.
const cuesTrack = (s: Song) => s.tracks.find((t) => page().ROLE[t] === "cues");
let preparedKey = "";
// Every cue of the show as the app renders it: text, voice (the cue's own, else the song's / set's), pronunciations,
// and the recording it plays instead (recorded words).
function cueList() {
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
  return list;
}
function prepareCues() {
  if (!deviceRate) return;
  const list = cueList();
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
    if (!outs.length) { page().toast("The Cues track has no output (choose one on its header), so a preview can't be heard"); return; }
    const r = await SL.call<{ ok?: boolean; error?: string; fellBack?: boolean }>("previewCue",
      { text, voice: c.voice || "", name: c.name || "", speed: c.speed || 1, pron: page().pron(), rec: page().recFor(s, text), outs, db: t ? page().gainOf(s, t) : 0 });
    if (r.error) page().toast(r.error);
  },
  // "+ Recorded word…": WAV / AIFF / FLAC at any rate, copied into <show>/Cues/Words (on save if the show is new).
  async addWords(s: Song, only: boolean) {
    const r = await SL.call<{ files?: AudioInfo[]; cancelled?: boolean; error?: string }>("pickAudioFiles", { rate: 0, multiple: true, from: "cueWords" });
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
  try { sessionStorage.setItem("setline.session", JSON.stringify({ doc, text })); } catch {}
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
  page().loadSession(o); // shows saved with the old show-wide routing get one output per track (logged)
  const log = page().routeLog();
  if (log.length) SL.call("logLine", { text: "Routing moved onto the tracks: " + log.join("; ") }).catch(() => {});
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
      const where = await askShowName(as);
      if (!where) return false;
      target = where;
    }
    // Stems flagged "Copy into session" are copied into its Audio folder; every reference becomes
    // relative to the session folder (absolute only for files kept outside it).
    const files = audioFiles(), words = page().wordFiles();
    if (files.length || words.length) {
      // the session saves right away; the audio is copied after it in the background ("Copying audio… n of N")
      const c = await SL.call<{ map?: Record<string, string>; missing?: string[]; error?: string; copying?: number }>("collectAudio",
        { from: cur.path || "", to: target, background: true, files: [...files.map((x) => ({ ref: x.f.path, copy: !!x.f.copy })), ...words.map((w) => ({ ref: w.path, copy: true, sub: "Cues/Words" }))] });
      if (c.error) { page().toast(c.error); return false; }
      applyRefMap(c.map || {});
      if (c.missing && c.missing.length) page().toast(`${c.missing.length} audio file${c.missing.length > 1 ? "s are" : " is"} missing; saved without copying ${c.missing.length > 1 ? "them" : "it"}`);
    }
    const text = sessionText();
    const r = await SL.call<FileResult>("writeSession", { path: target, text });
    if (r.error) { page().toast(r.error); return false; }
    // the show's cue audio goes into <show>/Cues, so it plays the same on any computer (rendered once)
    SL.call("storeCues", { cues: cueList() }).catch(() => {});
    doc = { name: r.name || doc.name, savedText: text };
    page().setSessionName(doc.name);
    page().toast(`Saved “${doc.name}”`);
    remember(text);
    return true;
  } finally { saving = false; }
}

// Save / Save As (6c item 3): just a name; the show goes to <Shows>/<name>/<name>.setline ("Choose another
// place…" for the old dialog). -> the path, or "" when cancelled.
async function askShowName(as: boolean): Promise<string> {
  const f = await SL.call<Folders>("folders");
  const pick = await new Promise<{ name?: string; elsewhere?: boolean } | null>((res) =>
    page().nameBox({ title: as ? "Save show as" : "Save show", value: doc.name || "Untitled show", where: f.shows }, res));
  if (!pick) return "";
  if (pick.elsewhere) {
    const r = await SL.call<FileResult>("chooseSessionFile");
    if (r.cancelled) return "";
    if (r.error || !r.path) { page().toast(r.error || "Couldn't save"); return ""; }
    return r.path;
  }
  const t = await SL.call<{ path: string; name: string; exists: boolean }>("showTarget", { name: pick.name });
  const cur = await SL.call<FileResult>("getSessionFile");
  if (t.exists && t.path !== cur.path) {
    const yes = await new Promise<boolean>((res) => {
      let answered = false;
      page().confirm(`Replace “${t.name}”?`, `A show called “${t.name}” is already in ${f.shows}. Replacing it overwrites its show file (its audio stays).`, "Replace", () => { answered = true; res(true); });
      // Cancel / Esc close the box without calling back
      const watch = setInterval(() => { if (!document.querySelector(".cfbox")) { clearInterval(watch); if (!answered) res(false); } }, 150);
    });
    if (!yes) return askShowName(as);
  }
  const made = await SL.call<{ path?: string; error?: string }>("showTarget", { name: pick.name, create: true });
  if (made.error || !made.path) { page().toast(made.error || "Couldn't save"); return ""; }
  return made.path;
}
// File > Open Backup… (6c item 4): the show's automatic backups, newest first. Opening one replaces what's on
// screen (after the usual Save question) and leaves it unsaved: Save makes it the show again, nothing is
// overwritten before that.
async function openBackup(at?: { clientX: number; clientY: number }) {
  const list = await SL.call<{ name: string; path: string; time: number; size: number }[]>("listBackups");
  if (!list.length) { page().toast(doc.name ? "No backups yet: one is made each time a save changes the show" : "Save the show first: backups are kept next to it"); return; }
  const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  page().menu(at || { clientX: 80, clientY: 60 }, [
    { label: `Backups of “${doc.name}” (newest first)`, icon: "", dis: true, act: () => {} },
    ...list.map((b) => ({ label: when(b.time), icon: "🕘", act: () => askSave("Opening a backup replaces what’s on screen.", async () => {
      const r = await SL.call<{ text?: string; error?: string }>("readBackup", { path: b.path });
      if (r.error || !r.text) { page().toast(r.error || "Couldn't read that backup"); return; }
      applySession(r.text);
      doc = { name: doc.name, savedText: "" }; // unsaved until you save it
      page().rerender();
      remember();
      loadedKey = null;
      page().toast(`Opened the backup from ${when(b.time)}. Save to make it the show again.`);
    }) })),
  ]);
}
// File > Clean up unused audio… (6c item 8): the show's audio files nothing uses (not the show as it is now or as
// last saved, not its versions or backups), with their sizes; moved to the Recycle Bin / Trash only after OK.
async function cleanUpAudio() {
  if (!doc.name) { page().toast("Save the show first"); return; }
  const list = await SL.call<{ path: string; name: string; size: number }[]>("unusedAudio", { text: sessionText() });
  if (!list.length) { page().toast("Every audio file in the show is in use"); return; }
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const mb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const total = list.reduce((a, f) => a + f.size, 0), bin = navigator.platform.startsWith("Mac") ? "Trash" : "Recycle Bin";
  page().confirm(`${list.length} unused audio file${list.length > 1 ? "s" : ""} · ${mb(total)}`,
    `<span style="display:block;max-height:220px;overflow:auto;font-size:12px;line-height:1.7;margin:6px 0 10px">${list.map((f) => `${esc(f.name)} <span class="faint">· ${mb(f.size)}</span>`).join("<br>")}</span>Nothing in this show, its versions or its backups uses ${list.length > 1 ? "them" : "it"}. ${list.length > 1 ? "They go" : "It goes"} to the ${bin}, so you can still get ${list.length > 1 ? "them" : "it"} back.`,
    `Move to the ${bin}`, async () => {
      const r = await SL.call<{ moved: number; failed: string[] }>("trashAudio", { paths: list.map((f) => f.path) });
      page().toast(`${r.moved} file${r.moved === 1 ? "" : "s"} moved to the ${bin}${r.failed.length ? ` · ${r.failed.length} couldn’t be moved` : ""}`);
    });
}
// Preferences: the Settings sheet (6d), also File › Preferences… and Ctrl/Cmd+,.
function preferences() { page().openSettings(); }

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
    await SL.call("forgetLastShow").catch(() => {}); // a new / closed show: nothing to reopen next time
    doc = { name: "", savedText: "" };
    page().freshShow();
    applySession(BLANK);
    doc.savedText = sessionText();
    remember();
  });
}
// Start-up: open the last show quietly; "" when it opened, else why not (the loading window offers Retry).
let startPath = "";
async function openAtStart(path: string): Promise<string> {
  startPath = path;
  const name = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
  const r = await SL.call<FileResult>("openSessionPath", { path }).catch((e) => ({ error: String(e) } as FileResult));
  if (r.error || !r.text) return `“${name}” (${path}) couldn't be opened: ${r.error || "it's empty"}.`;
  try {
    doc = { name: r.name || "", savedText: "" };
    applySession(r.text);
    doc.savedText = sessionText();
    page().setSessionName(doc.name);
    remember();
  } catch (e) {
    doc = { name: "", savedText: sessionText() }; page().rerender();
    return `“${name}” couldn't be read (${String((e as Error)?.message || e)}).`;
  }
  if (r.path) checkAudio(r.path);
  return "";
}
async function retryStartShow() {
  const why = startPath ? await openAtStart(startPath) : "There's no show to try again.";
  const n = page().songs.length;
  await SL.call("loadingStep", why ? { id: "show", state: "failed", detail: why } : { id: "show", state: "done", detail: `${doc.name} · ${n} song${n === 1 ? "" : "s"}` });
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
// Diagnostics: version, OS, audio, listen mode, MIDI, the show, engine stats, the last 200 log lines (no audio, no
// show contents) on the clipboard or in a text file.
async function diagnostics(how: "copy" | "save") {
  if (how === "copy") { await SL.call("copyDiagnostics"); page().toast("Diagnostics copied: paste them into a message"); return; }
  const r = await SL.call<{ path?: string; error?: string; cancelled?: boolean }>("saveDiagnostics");
  if (r.path) page().toast("Diagnostics saved: " + r.path); else if (r.error) page().toast(r.error);
}
async function showAbout() { page().about(await SL.call("getAppInfo")); }
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
    { label: "Open Backup…", icon: "🕘", dis: !doc.name, act: () => { openBackup(at); } },
    { label: "Clean up unused audio…", icon: "🧹", dis: !doc.name, act: () => { cleanUpAudio(); } },
    { label: "Close", icon: "✕", act: () => newSession("Closing the session.") },
    "-",
    { label: "Preferences…", icon: "⚙", key: mod + ",", act: () => { preferences(); } },
    "-",
    { label: "About set.Line", icon: "ⓘ", act: () => { showAbout(); } },
  ];
  page().menu(at, items);
}

// After opening: find the session's audio. Files found in the session's Audio folder under their name are
// fixed silently; the rest are listed with "Locate…". Missing stems play as silence; nothing is blocked.
async function checkAudio(sessionPath: string) {
  const refs = [...new Set(audioFiles().map((x) => x.f.path))];
  if (!refs.length) return;
  const r = await SL.call<{ missing: string[]; map: Record<string, string>; resumed?: number }>("checkAudio", { session: sessionPath, refs });
  if (r.resumed) page().toast(`Finishing the audio copy that was interrupted (${r.resumed} file${r.resumed > 1 ? "s" : ""})`);
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
  if (p.kind === "save") { page().copyStatus(p); return; } // Save / Save As: a small indicator, nothing blocks
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
  // Dropping only ever copies: the page says "copy" on enter, over and drop, so Explorer never moves the files.
  window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; highlight(true); } }, true);
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
    e.dataTransfer!.dropEffect = "copy";
    highlight(false);
    const files = e.dataTransfer!.files;
    if (!files.length) return;
    wv.postMessageWithAdditionalObjects(JSON.stringify({ eventId: "setlineDrop", payload: { x: e.clientX, y: e.clientY } }), files);
  }, true);
}

// ---------------------------------------------------------------- start
// ---------------------------------------------------------------- loading window (start-up)
// Reports the real start-up steps to the app's loading window (Splash.h): the show (name · songs), the waveforms
// (n of total, computed in the background), the cues (n ready). Each waits at most a while; what's left carries on
// in the background. Then "loadingDone": the loading window fades and this window shows.
async function reportLoading(showProblem: string, quick: boolean) {
  const step = (id: string, state: string, detail = "", fraction = 0) => SL.call("loadingStep", { id, state, detail, fraction }).catch(() => {});
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const n = page().songs.length;
    if (showProblem) await step("show", "failed", showProblem);
    else await step("show", "done", `${doc.name || "Untitled session"} · ${n} song${n === 1 ? "" : "s"}`);
    // waveforms
    const cur = await SL.call<FileResult>("getSessionFile");
    const refs = [...new Set(audioFiles().map((x) => x.f.path))];
    if (!refs.length) await step("waveforms", "done", "none");
    else {
      let r = await SL.call<{ ready: number; total: number }>("peaksReady", { refs, session: cur.path || "", prepare: true });
      for (let t = 0; !quick && r.ready < r.total && t < 150; t++) { // up to 30 s
        await step("waveforms", "running", `${r.ready} of ${r.total}`, r.ready / r.total);
        await wait(200);
        r = await SL.call("peaksReady", { refs, session: cur.path || "" });
      }
      await step("waveforms", "done", r.ready < r.total ? `${r.ready} of ${r.total} (the rest in the background)` : `${r.total} of ${r.total}`);
    }
    // cues
    prepareCues();
    const list = cueList();
    if (!list.length) await step("cues", "done", "none");
    else {
      let r = await SL.call<{ ready: number; total: number }>("cuesReady", { cues: list });
      for (let t = 0; !quick && r.ready < r.total && t < 150; t++) {
        await step("cues", "running", `${r.ready} of ${r.total} ready`, r.ready / r.total);
        await wait(200);
        r = await SL.call("cuesReady", { cues: list });
      }
      await step("cues", "done", r.ready < r.total ? `${r.ready} ready (the rest in the background)` : `${r.total} cue${r.total === 1 ? "" : "s"} ready`);
    }
  } catch (e) { console.warn("set.Line: loading", e); }
  await SL.call("loadingDone").catch(() => {});
}

async function main() {
  if (!SL.native) return;
  window.SLE = SLE;
  window.SLW = SLW;
  window.SLC = SLC;
  await SL.ready;
  SL.on("transport", onTransport);
  SL.on("meters", (m: { peaks: number[]; tracks?: Record<string, number> }) => { peaks = m.peaks || []; trackPeaks = m.tracks || {}; });
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
    else if (m.cmd === "about") showAbout();
    else if (m.cmd === "retryShow") retryStartShow();
    else if (m.cmd === "prefs") preferences();
    else if (m.cmd === "openBackup") openBackup();
    else if (m.cmd === "copyDiagnostics") diagnostics("copy"); else if (m.cmd === "saveDiagnostics") diagnostics("save");
    else if (m.cmd === "new") newSession(); else if (m.cmd === "close") newSession("Closing the session.");
    else if (m.cmd === "quit") { SL.call("quitAnswered").catch(() => {}); askSave("Quitting set.Line.", () => { SL.call("quitNow").catch(() => {}); }); }
  });

  // Session: carry on with the one from before a page switch, else this is a new, unsaved session.
  let showProblem = "", keptSession = false;
  try {
    const kept = JSON.parse(sessionStorage.getItem("setline.session") || "null");
    if (kept && kept.text) { doc = kept.doc; applySession(kept.text); keptSession = true; }
    else { doc = { name: "", savedText: sessionText() }; }
  } catch (e) {
    console.warn("set.Line: session", e);
    showProblem = `It couldn't be read (${String((e as Error)?.message || e)}).`;
    doc = { name: "", savedText: sessionText() };
  }
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

  // Start-up: the show that was open when set.Line closed (if it can't be opened, the loading window asks:
  // Retry / Open another / New show).
  if (!keptSession && !showProblem) {
    const st = await SL.call<{ path?: string }>("takeStartShow").catch(() => ({} as { path?: string }));
    if (st.path) showProblem = await openAtStart(st.path);
  }
  try { listen = await SL.call<ListenState>("getListen"); page().setListen(listen, listenWhat()); } catch (e) { console.warn("set.Line: listen", e); }
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
  // The loading window (app start): show, waveforms, cues; then the main window appears. Tests don't wait for it.
  await reportLoading(showProblem, !!info.testScript);
  // Test hook (--test-script): run an async script with the page and this module's functions; write its result.
  if (info.testScript) {
    let out: unknown;
    try {
      const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
      const hooks = { SLE, page, importStems, probe, audioFiles, applyRefMap, checkAudio, onFileDrag, sessionText, applySession,
        getRate: () => sessionRate, openPath: (p: string) => openPath(p), retryStartShow: () => retryStartShow(), docName: () => doc.name, saveTo: (path: string) => saveSession(false, path), cueList: () => cueList(), setListen: (r: Partial<ListenState>) => setListen(r), SLR: window.SLR, SLW, waves, SLC, prepareCues, remember, payload, isDirty: () => sessionText() !== doc.savedText, setDoc: (n: string) => { doc = { name: n, savedText: "" }; } };
      out = await new AsyncFn("SL", "hooks", info.testScript)(SL, hooks);
    } catch (e) { out = { error: String((e as Error)?.stack || e) }; }
    if (out !== undefined) await SL.call("testDone", { text: JSON.stringify(out, null, 1) }); // undefined: it went to another page
  }
}

main().catch((e) => console.error("set.Line edit page:", e));
