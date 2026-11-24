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
  // step 2: stems
  guessRole(fileName: string): string;
  addNative(list: AudioInfo[]): void; openNewSong(): void; modalOpen(): boolean; dropZone(): HTMLElement;
  addStems(s: Song, list: { role: string; info: AudioInfo }[], refs: Record<string, string>, copy: boolean): void;
}
// A file as the app read it (Media::probe). ok = false: error says why it can't be imported.
interface AudioInfo { path: string; name: string; ok: boolean; channels?: number; rate?: number; frames?: number; seconds?: number; format?: string; bits?: number; error?: string }
interface Progress { done: number; total: number; file: string; finished: boolean }
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
const sessionText = () => JSON.stringify(tidy({ format: "setline-session", version: 1, ...(sessionRate ? { rate: sessionRate } : {}), ...page().sessionData(), routing: routing() }), null, 1);
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
  sessionRate = typeof o.rate === "number" && o.rate > 0 ? o.rate : null;
  page().loadSession(o);
  page().setSessionName(doc.name);
}

// Every audio file the session refers to (song stems).
function audioFiles(): { song: Song; track: string; f: { path: string; copy?: boolean } }[] {
  const out: { song: Song; track: string; f: { path: string; copy?: boolean } }[] = [];
  for (const s of page().songs) for (const [t, f] of Object.entries(s.files || {})) if (f && (f as any).path) out.push({ song: s, track: t, f: f as any });
  return out;
}
function applyRefMap(map: Record<string, string>) {
  for (const x of audioFiles()) if (map[x.f.path] !== undefined) x.f.path = map[x.f.path];
}

let saving = false;
async function saveSession(as: boolean) {
  if (saving) return;
  saving = true;
  try {
    // A session lives in its own folder: <folder>/<name>.setline with the stems in <folder>/Audio.
    const cur = await SL.call<FileResult>("getSessionFile");
    let target = cur.path || "";
    if (as || !target) {
      const r = await SL.call<FileResult>("chooseSessionFile");
      if (r.cancelled) return;
      if (r.error || !r.path) { page().toast(r.error || "Couldn't save"); return; }
      target = r.path;
    }
    // Stems flagged "Copy into session" are copied into its Audio folder; every reference becomes
    // relative to the session folder (absolute only for files kept outside it).
    const files = audioFiles();
    if (files.length) {
      const c = await SL.call<{ map?: Record<string, string>; missing?: string[]; error?: string }>("collectAudio",
        { from: cur.path || "", to: target, files: files.map((x) => ({ ref: x.f.path, copy: !!x.f.copy })) });
      if (c.error) { page().toast(c.error); return; }
      applyRefMap(c.map || {});
      if (c.missing && c.missing.length) page().toast(`${c.missing.length} audio file${c.missing.length > 1 ? "s are" : " is"} missing; saved without copying ${c.missing.length > 1 ? "them" : "it"}`);
    }
    const text = sessionText();
    const r = await SL.call<FileResult>("writeSession", { path: target, text });
    if (r.error) { page().toast(r.error); return; }
    doc = { name: r.name || doc.name, savedText: text };
    page().setSessionName(doc.name);
    page().toast(`Saved “${doc.name}”`);
    remember(text);
  } finally { saving = false; }
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
  if (sessionText() !== doc.savedText) page().confirm("Open another session?", "This session has unsaved changes. They will be lost.", "Open without saving", go);
  else go();
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

// ---------------------------------------------------------------- start
async function main() {
  if (!SL.native) return;
  window.SLE = SLE;
  await SL.ready;
  SL.on("transport", onTransport);
  SL.on("meters", (m: { peaks: number[] }) => { peaks = m.peaks || []; });
  SL.on("audioSetupChanged", (s: Setup) => { loadedKey = null; onSetup(s); });
  SL.on("engineStats", (x: Stats) => showStatus(x));
  SL.on("audioProgress", onProgress);
  SL.on("fileDrag", (d) => { onFileDrag(d).catch((e) => page().toast(String(e))); });
  const copyBox = document.getElementById("mCopy") as HTMLInputElement | null;
  if (copyBox) {
    document.getElementById("mCopyL")!.hidden = false;
    copyBox.checked = copyPref();
    copyBox.onchange = () => localStorage.setItem(COPY_PREF, copyBox.checked ? "1" : "0");
  }
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
  const info = await SL.call<{ roundTrip?: { in: string; out: string }; testScript?: string }>("getAppInfo");
  // Test hook (--test-script): run an async script with the page and this module's functions; write its result.
  if (info.testScript) {
    let out: unknown;
    try {
      const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
      const hooks = { SLE, page, importStems, probe, audioFiles, applyRefMap, checkAudio, onFileDrag, sessionText, applySession,
        getRate: () => sessionRate, setDoc: (n: string) => { doc = { name: n, savedText: "" }; } };
      out = await new AsyncFn("SL", "hooks", info.testScript)(SL, hooks);
    } catch (e) { out = { error: String((e as Error)?.stack || e) }; }
    await SL.call("testDone", { text: JSON.stringify(out, null, 1) });
    return;
  }
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
