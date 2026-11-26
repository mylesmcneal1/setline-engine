// Edit page in the desktop app: Play/Stop/locate drive the real engine, and the playhead, LCD and meters
// follow its events. The page keeps its own state (playing, pos, playId); this module only feeds it.
// Positions cross the bridge as bar/beat, so the playhead stays on the page's bar grid even where the
// engine plays a tempo ramp as a jump. Loops run inside the engine (sample-exact); this module only
// tells it which range to loop.
import { startBandHost } from "../band/host";
import { SL } from "../bridge";

interface Bar { bar: number; t: number; dur: number; sig: [number, number]; beatT: number[] }
interface Song { id: string; name: string; tracks: string[]; bars: Bar[]; total: number; audio: number; [k: string]: any }
interface Page {
  // 6g: the band's screens (see 1-arrange.html, BAND)
  band: any; midiReconnected(names: string[]): void; setlistOpened(): void;
  // 6f: the Library
  setlistCmd(cmd: "new" | "dup"): void; curSetId(): string; setSaveState(st: "saving" | "saved" | "error", why?: string): void;
  importPlan(pkg: any): { differ: any[]; same: number; added: number }; importBox(name: string, plan: any, note: string): Promise<Record<string, string> | null>;
  importMerge(pkg: any, decisions: Record<string, string>): { setlist: string; added: number; same: number; replaced: number; both: number };
  mergeShow(o: any, name: string, refMap: Record<string, string>): { setlists: string[]; added: number; merged: number; notes: string[] };
  migrationBox(shows: { path: string; name: string; songs: number; bytes: number }[]): Promise<string[] | null>; exportProgress(p: any): void;
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
  // 6e: versions, the next song, transitions, queued jumps
  ver: { play(s: Song): any; cur(s: Song): any; payload(s: Song, v: any): any; map(s: Song, v: any): any[]; fields(s: Song, v: any): any; inVer(s: Song, t: string, v: any): boolean;
    nextOf(s: Song): { song: Song; ver: any } | null; after(s: Song): { mode: string; sec: number } };
  nextState(meta: any): void; readySong(id: string, playing?: boolean): void; autoNext(sec: number): void; jumpQueued(secId: number | null): void;
  setEngineBar(bar: number, beat: number): void; loopIsSection: boolean;
  addVerAudio(s: Song, v: any, list: { info: AudioInfo }[], refs: Record<string, string>, copy: boolean): void;
  setListen(st: ListenState, what?: string): void;
  nameBox(o: { title: string; value: string; where: string; hint?: string }, done: (r: { name?: string; elsewhere?: boolean } | null) => void): void;
  copyStatus(p: { done: number; total: number; files?: number; filesDone?: number; finished: boolean; error?: string }): void;
  recFor(s: Song, text: string): string; wordFiles(): { path: string; copy?: boolean }[];
  addWords(s: Song, list: { name: string; ref: string }[], only: boolean): void;
  menu(e: { clientX: number; clientY: number }, items: (MenuItem | "-")[]): void;
  saveBox(title: string, body: string, choice: (c: "save" | "discard") => void): void;
  about(info: { version?: string; platform?: string }): void;
  pron(): Record<string, string>; nudge(voiceId: string): number; setVoiceModel(st: VoiceModel): void; setUnknownWords(list: string[]): void;
}
// Cue voice choice as saved (voice id + name: ids differ between computers) and an installed voice.
interface CueVoice { voice: string; name: string; speed: number }
interface ListenState { on?: boolean; missing?: string; driver?: string; device?: string; current?: string; mode?: string; output?: number[]; click?: boolean; cues?: boolean; midi?: boolean; error?: string; devices?: { driver: string; device: string }[] }
interface Folders { shows: string; defaultShows: string; library: string }
interface MenuItem { label: string; icon?: string; key?: string; dis?: boolean; danger?: boolean; act: () => void }
interface VoiceInfo { id: string; name: string; lang: string; isDefault: boolean; engine?: string; gender?: string; grade?: string; rank?: number }
// The built-in Kokoro voices' download (Kokoro.h): missing | downloading | ready | failed.
interface VoiceModel { state: string; done: number; total: number; error: string }
// A file as the app read it (Media::probe). ok = false: error says why it can't be imported.
interface AudioInfo { path: string; name: string; ok: boolean; channels?: number; rate?: number; frames?: number; seconds?: number; format?: string; bits?: number; error?: string }
interface Progress { done: number; total: number; file: string; finished: boolean; files?: number; filesDone?: number; kind?: string; error?: string }
interface Transport { playing: boolean; loaded: boolean; song: string; songId?: string; bar: number; beat: number; seconds: number; ended?: boolean; segued?: boolean }
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

// ---------------------------------------------------------------- song versions (6e)
// The engine plays a version's parts laid end to end, so its bar numbers are the version's. The page keeps showing
// the song's own (source) timeline: these convert between the two with the version's map ([] parts; null = the
// whole source, the same bars).
interface VPart { vb: number; sb: number; bars: number; extra: boolean; secId?: number }
let curMap: VPart[] | null = null;   // the loaded song's version layout
let curVerId = "";
function mapOf(s: Song, v: any): VPart[] | null { return v && page().ver.payload(s, v) ? page().ver.map(s, v) : null; }

// ---------------------------------------------------------------- positions (page seconds <-> bar/beat)
function srcBarBeat(s: Song, t: number): { bar: number; beat: number } {
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
function srcTime(s: Song, bar: number, beat: number): number {
  const b = s.bars[Math.max(0, Math.min(s.bars.length - 1, bar - 1))];
  const k = Math.max(0, Math.min(b.beatT.length - 1, Math.floor(beat - 1)));
  const next = k + 1 < b.beatT.length ? b.beatT[k + 1] : b.t + b.dur;
  return b.beatT[k] + (beat - 1 - k) * (next - b.beatT[k]);
}
// page (source) seconds -> the engine's bar/beat (a skipped section: the next part the version plays)
function toBarBeat(s: Song, t: number, map: VPart[] | null = s.id === loadedSongId ? curMap : null): { bar: number; beat: number } {
  const x = srcBarBeat(s, t);
  if (!map || !map.length) return x;
  const src = map.filter((p) => !p.extra), last = map[map.length - 1];
  let part = src.find((p) => x.bar >= p.sb && x.bar < p.sb + p.bars);
  if (!part && !last.extra && x.bar >= last.sb + last.bars) part = last; // the source's tail after its last bar
  if (part) return { bar: part.vb + (x.bar - part.sb), beat: x.beat };
  const nx = src.find((p) => p.sb > x.bar);
  return { bar: nx ? nx.vb : 1, beat: 1 };
}
// the engine's bar/beat -> page (source) seconds (a version-only part: where the next section starts)
function toTime(s: Song, bar: number, beat: number, map: VPart[] | null = s.id === loadedSongId ? curMap : null): number {
  if (!map || !map.length) return srcTime(s, bar, beat);
  const part = map.find((p) => bar >= p.vb && bar < p.vb + p.bars) || map[map.length - 1];
  if (part.extra) { const nx = map.find((p) => !p.extra && p.vb > part.vb); return nx ? srcTime(s, nx.sb, 1) : 0; }
  return srcTime(s, part.sb + (bar - part.vb), beat);
}

// ---------------------------------------------------------------- loading songs
// song v: the version to play (default: the one the song plays now, its setlist entry's).
function payload(s: Song, v: any = page().ver.play(s)) {
  const p = page();
  // the song's fields for that version (a custom version's own; the source while a custom one is shown), without
  // the computed bar list / section positions; a MIDI or click clip's "bars" (its length) goes with it
  const song = p.ver.fields(s, v);
  song.tracks = (song.tracks || []).filter((t: string) => p.ver.inVer(s, t, v)); // another version's own audio stays out
  const roles: Record<string, string> = {};
  song.tracks.forEach((t: string) => (roles[t] = p.ROLE[t] || ""));
  const outs: Record<string, number[]> = {};
  song.tracks.forEach((t: string) => { if (!isMidiTrack(song, t)) outs[t] = outsOf(s, t); });
  // The show's pronunciations go with the cue voice (the song's own, or the set's), as the app keys cues by them.
  const pron = p.pron();
  // 7a: each voice's timing nudge (ms) goes with it; the app puts every word's onset on its beat, then nudges
  const nz = (v: any) => ({ ...v, pron, nudge: p.nudge(v && v.voice ? v.voice : "") });
  if (song.cueVoice) song.cueVoice = nz(song.cueVoice);
  for (const q of (song.cues || []) as { text?: string; rec?: string; voice?: Record<string, unknown> }[]) {
    if (q.voice) q.voice = nz(q.voice);
    const rec = p.recFor(s, q.text || ""); if (rec) q.rec = rec; // a recorded word plays instead of the voice
  }
  // each click track other than "Click" with its own settings (the app plays every click track, sample-exact)
  const clickTracks: Record<string, Record<string, unknown>> = {};
  song.tracks.forEach((t: string) => { if (p.ROLE[t] === "click" && t !== "Click") clickTracks[t] = p.clickCfg(s, t); });
  const version = p.ver.payload(s, v);
  return { song, outs, roles, click: p.clickCfg(s), clickTracks, cueVoice: nz(p.cueVoiceAll()), ...(version ? { version } : {}), verId: v ? v.id : "" };
}
// What forces a reload: everything except the mixer levels, which change live (setTrackLevel).
function loadKey(body: ReturnType<typeof payload>): string {
  const { gain, mute, solo, ...rest } = body.song;
  return JSON.stringify({ ...body, song: rest });
}

async function ensureLoaded(s: Song): Promise<boolean> {
  const v = page().ver.play(s);
  const body = payload(s, v);
  const key = loadKey(body);
  if (key === loadedKey && loadedSongId === s.id) return true;
  const r = await SL.call<LoadResult>("loadSong", body);
  if (r.error) { page().toast(r.error); loadedKey = null; return false; }
  loadedKey = key; loadedSongId = s.id; loopKey = ""; curMap = mapOf(s, v); curVerId = v ? v.id : "";
  nextKey = ""; // the next slot follows the song loaded
  const w = r.warnings || [];
  if (w.length && warnedKey !== key) {
    warnedKey = key;
    page().toast(w[0] + (w.length > 1 ? `  (+${w.length - 1} more)` : ""));
    console.info(`set.Line: "${s.name}" loaded with notes:\n- ` + w.join("\n- "));
  }
  return true;
}

// ---------------------------------------------------------------- 7a: click edits while playing
// A click clip added or extended while its song plays is heard when the playhead gets there: when only the click
// clips (song.ck / song.cks) changed since the load, the engine swaps in the new hits (updateClicks) without stopping.
// Any other edit still waits for the next Play, as before.
const withoutClicks = (key: string) => { try { const o = JSON.parse(key); delete o.song.ck; delete o.song.cks; return JSON.stringify(o); } catch { return ""; } };
let clickBusy = false;
async function liveClicks() {
  const p = page();
  if (clickBusy || busy || !p.playing || !loadedKey || p.playId !== loadedSongId) return;
  const s = p.songs.find((x) => x.id === loadedSongId); if (!s) return;
  const body = payload(s), key = loadKey(body);
  if (key === loadedKey || withoutClicks(key) !== withoutClicks(loadedKey)) return;
  clickBusy = true;
  try {
    const r = await SL.call<{ ok?: boolean; error?: string }>("updateClicks", body);
    if (r && r.ok) loadedKey = key;
  } catch (e) { console.warn("set.Line: live click", e); } finally { clickBusy = false; }
}

// ---------------------------------------------------------------- 7d: backup rig (RigLink.h)
// The backup follows the primary's state (every 100 ms and at once on each transport change): the same song started
// at the same moment (rigStartAt, a host time on this clock), the primary's jumps on the same sample, and a re-align
// whenever the two drift more than 3 ms apart (the interfaces' clocks differ; nothing is resampled).
let rigBusy = false, rigDrift = 0, rigLibKey = "", rigSeen = new Set<string>();
async function rigFollow(st: any) {
  const p = page();
  if (rigBusy) return;
  rigBusy = true;
  try {
    const h = await SL.call<{ now: number; rate: number }>("hostMs");
    const rate = h.rate || sessionRate || 48000;
    let missing = 0;
    if (!st.playing) { if (p.playing) { await SL.call("rigStop"); p.setPlaying(false); } }
    else {
      const s = p.songs.find((x) => x.id === st.songId);
      if (!s) missing = 1;
      else if (!p.playing || loadedSongId !== s.id || p.playId !== s.id) {
        p.setPlayId(s.id);
        if (await ensureLoaded(s)) {
          const at = h.now + 80, from = Math.round(st.pos + ((at - st.atLocal) * rate) / 1000);
          const r = await SL.call<{ error?: string }>("rigStartAt", { from, at });
          if (!r.error) p.setPlaying(true);
        }
      } else if (st.synced) {
        const mine = await SL.call<number>("rigSampleAt", { at: st.atLocal });
        if (mine >= 0) {
          rigDrift = ((mine - st.pos) / rate) * 1000;
          if (Math.abs(rigDrift) > 3) { const at = h.now + 60; await SL.call("rigJumpAt", { at, to: Math.round(st.pos + ((at - st.atLocal) * rate) / 1000) }); }
        }
      }
    }
    SL.call("rigStatus", { driftMs: rigDrift, missing, playing: !!p.playing }).catch(() => {});
  } catch (e) { console.warn("set.Line: backup rig", e); } finally { rigBusy = false; }
}
async function rigCommand(c: any) {
  if (!c || rigSeen.has(String(c.id))) return;
  rigSeen.add(String(c.id));
  if (c.kind === "jump" && c.songId === loadedSongId) await SL.call("rigJump", { at: c.at, to: c.to });
}
// the backup's library, for the primary's match check (songs, versions, audio by content)
function rigPushLibrary() {
  const list = page().songs.map((s: any) => ({ id: s.id, name: s.name, vers: (s.versions || []).map((v: any) => v.id), audio: Object.values(s.files || {}).map((f: any) => f && f.path).filter(Boolean) }));
  const key = JSON.stringify(list);
  if (key !== rigLibKey) { rigLibKey = key; SL.call("rigSetLibrary", { list }).catch(() => {}); }
}
// primary: "Send setlist to backup": the current setlist as a package (6f), over the network; the backup imports it
async function rigSendSetlist() {
  if (page().playing) { page().toast("Stop playback first: a setlist can't be sent while playing"); return { error: "playing" }; }
  const tmp = await SL.call<string>("tempPath", { name: "to-backup.setline" }).catch(() => "");
  const e = await exportSetlist(undefined, tmp);
  if (!e || (e as any).error || !(e as any).path) return { error: (e as any)?.error || "export failed" };
  const r = await SL.call<{ ok?: boolean; error?: string }>("rigSendPackage", { path: (e as any).path });
  page().toast(r.error ? "Backup: " + r.error : "Setlist sent to the backup");
  return r;
}

// ---------------------------------------------------------------- the next song (6e)
// While a song is loaded, the setlist's next song (in the version its entry plays) waits in the engine's next slot,
// primed: Segue plays it on the very next sample, Next and Play start it without loading. Changing a version, the
// order or "After this song" queues it again in the background; the song playing is never touched.
interface NextMeta { songId: string; verId: string; key: string; map: VPart[] | null; ready: boolean; loading: boolean; segue: boolean; error?: string }
let nextKey = "", nextMeta: NextMeta | null = null, nextPoll = 0;
async function queueNext(s: Song) {
  const p = page();
  if (s.id !== loadedSongId) return;
  const n = p.ver.nextOf(s);
  if (!n) { if (nextMeta) { nextMeta = null; nextKey = ""; p.nextState(null); SL.call("transport", { cmd: "segue", on: false }).catch(() => {}); } return; }
  const body = payload(n.song, n.ver), segue = p.ver.after(s).mode === "segue";
  const key = loadKey(body) + "|" + segue + "|" + s.id;
  if (key === nextKey) return;
  nextKey = key;
  const meta: NextMeta = { songId: n.song.id, verId: n.ver ? n.ver.id : "", key: loadKey(body), map: mapOf(n.song, n.ver), ready: false, loading: true, segue };
  nextMeta = meta; p.nextState({ ...meta });
  const r = await SL.call<LoadResult>("queueNext", { ...body, segue });
  if (nextMeta !== meta) return; // something newer was queued meanwhile
  if (r.error) { meta.loading = false; meta.error = r.error; nextKey = ""; p.nextState({ ...meta }); return; }
  clearInterval(nextPoll);
  nextPoll = window.setInterval(async () => {
    if (nextMeta !== meta) { clearInterval(nextPoll); return; }
    const st = await SL.call<{ loaded: boolean; ready: boolean; songId: string }>("nextState");
    if (st.ready && st.songId === meta.songId) { meta.loading = false; meta.ready = true; p.nextState({ ...meta }); clearInterval(nextPoll); }
    else if (!st.loaded) { meta.loading = false; p.nextState({ ...meta }); clearInterval(nextPoll); }
  }, 150);
}
// the next song took over (segue, Next, or Play on it): it's the loaded one now
function adoptNext() {
  if (!nextMeta) return;
  loadedSongId = nextMeta.songId; loadedKey = nextMeta.key; curMap = nextMeta.map; curVerId = nextMeta.verId;
  loopKey = ""; nextKey = ""; nextMeta = null; page().nextState(null); jumpQ = null; page().jumpQueued(null);
}
let autoTimer = 0;
function cancelAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = 0; page().autoNext(0); } }
// The song playing reached its end (not a segue): Stop selects the next song, ready; Auto-next waits, then plays it.
function songEnded(s: Song) {
  const p = page(), n = p.ver.nextOf(s), a = p.ver.after(s);
  p.setPlaying(false);
  const B = (window as any).SLBreaks; if (B && B.songEnded(s.id)) return; // 9d: a break follows this song: it becomes current
  if (!n) return;
  p.readySong(n.song.id);
  if (a.mode === "auto") {
    let left = a.sec;
    p.autoNext(left);
    autoTimer = window.setInterval(() => {
      left -= 1;
      if (left > 0) { p.autoNext(left); return; }
      cancelAuto();
      if (page().playId === n.song.id && !page().playing) { p.setPlaying(true); SLE.playFrom(n.song, 0); }
    }, 1000);
  }
}

// ---------------------------------------------------------------- loops and queued jumps (run in the engine)
let jumpQ: { secId: number; at: number } | null = null; // a queued jump, until playback passes its sample
async function syncLoop(s: Song) {
  if (s.id !== loadedSongId || jumpQ) return; // a queued jump has the engine's jump slot until it happens
  const cy = page().loopRange(s);
  const range = cy ? { from: toBarBeat(s, cy[0]), to: toBarBeat(s, cy[1]) } : null;
  const key = JSON.stringify(range);
  if (key === loopKey) return;
  loopKey = key;
  const r = await SL.call<LoadResult>("setLoop", range ? { fromBar: range.from.bar, fromBeat: range.from.beat, toBar: range.to.bar, toBeat: range.to.beat } : {});
  if (r.code === "reload") loopKey = "";
  // Turning a loop on while already past its end: go to its start (as the page always did).
  if (cy && page().playing && page().pos >= cy[1] - 0.02 && !page().loopIsSection) SLE.playFrom(s, cy[0]);
}

// ---------------------------------------------------------------- transport
async function run(s: Song, t: number) {
  busy = true;
  cancelAuto();
  try {
    // the song is waiting in the next slot, from its start: it becomes the song at once (no loading)
    if (t < 0.001 && nextMeta && nextMeta.songId === s.id && nextMeta.key === loadKey(payload(s))) {
      const r = await SL.call<Transport & LoadResult>("transport", { cmd: "play", songId: s.id, fromBar: 1, fromBeat: 1 });
      if (!r.error && r.songId === s.id) { adoptNext(); await syncLoop(s); queueNext(s); return; }
    }
    if (s.id === loadedSongId && took(/^(playStop|play)$/)) { await syncLoop(s); queueNext(s); return; } // 8d: a pedal started it natively
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await ensureLoaded(s))) { page().setPlaying(false); return; }
      await syncLoop(s); // armed before playing, so the first pass wraps too
      const at = toBarBeat(s, t);
      const r = await SL.call<Transport & LoadResult>("transport", { cmd: "play", fromBar: at.bar, fromBeat: at.beat });
      if (r.code === "reload") { loadedKey = null; continue; } // the device changed since loading
      if (r.error) { page().toast(r.error); page().setPlaying(false); }
      queueNext(s);
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
// 8d: the pedal fast path: what the app may do natively, kept current (Bridge::pedalFast); and what it just did
let nativeDid: { action: string; result: any; at: number } | null = null, lastArm = "";
const took = (action: string | RegExp) => { const d = nativeDid; if (!d || Date.now() - d.at > 1500 || !(typeof action === "string" ? d.action === action : action.test(d.action))) return null; nativeDid = null; return d; };
function pedalArmNow() {
  const p = page() as any, s = p.songs.find((x: Song) => x.id === loadedSongId), sel = p.playId || p.selId;
  const brk = (window as any).SLBreaks && (window as any).SLBreaks.holdsPedals(); // 9d: around a break the page decides
  const arm: any = { songId: loadedSongId || "", ready: !!s && sel === loadedSongId && !busy && !pending && !brk, when: p.jumpWhen ? p.jumpWhen() : "bar",
    nextId: nextMeta && nextMeta.ready ? nextMeta.songId : "", looping: p.looping ? !!p.looping() : false, vamp: p.vampOn ? !!p.vampOn() : false, sync: p.syncMsgs ? p.syncMsgs() : [] };
  if (s) {
    if (!p.playing) { const at = toBarBeat(s, p.pos); arm.bar = at.bar; arm.beat = at.beat; }
    arm.secs = curMap ? curMap.filter((q: any) => !q.extra).map((q: any) => [q.vb, q.vb + q.bars, q.secId]) : (s.secs || []).map((x: any) => [x.start, x.start + x.bars, x.id]);
    arm.jumps = (p.pedalOrder ? p.pedalOrder(s) : []).map((id: number) => { const q = arm.secs.find((x: any[]) => x[2] === id); return q ? q[0] : 0; });
  }
  const k = JSON.stringify(arm);
  if (k !== lastArm) { lastArm = k; SL.call("pedalArm", arm).catch(() => {}); }
}
setInterval(() => { if (SL.native) pedalArmNow(); }, 250);
const SLE = {
  edited: () => { setTimeout(() => liveClicks().catch(() => {}), 60); }, // 7a: after an edit (the page calls it from snap())
  flush: () => libSave().catch(() => {}), // 8d: the library on disk before an update restarts set.Line
  // 8d: a pedal's action was done natively (Bridge::pedalFast): the page catches up without sending it again
  nativeDid: (action: string, result: any) => { nativeDid = { action, result, at: Date.now() }; },
  rigSendSetlist: () => rigSendSetlist(), // 7d: Settings › Backup rig
  // Play song s from page time t (seconds). Called for Play, locate while playing, next song...
  // Requests made while one is in flight coalesce (dragging the playhead sends only the latest).
  playFrom(s: Song | undefined, t: number) {
    if (!s) return;
    if (busy) { pending = { s, t }; return; }
    run(s, t);
  },
  stop() {
    pending = null;
    cancelAuto();
    SL.call("transport", { cmd: "stop" }).catch(() => {});
  },
  // Next while playing (6e): the song waiting in the next slot takes over with a 10 ms fade; anything else loads.
  async nextSong(n: Song) {
    cancelAuto();
    if (nextMeta && nextMeta.songId === n.id && took("nextSong")) { adoptNext(); page().setPlayId(n.id); page().setPos(0); await syncLoop(n); queueNext(n); return; } // 8d: done natively
    if (nextMeta && nextMeta.songId === n.id && nextMeta.key === loadKey(payload(n)) && !busy) {
      busy = true;
      try {
        const r = await SL.call<Transport & LoadResult>("transport", { cmd: "next", songId: n.id });
        if (!r.error) { adoptNext(); page().setPlayId(n.id); page().setPos(0); await syncLoop(n); queueNext(n); return; }
      } finally { busy = false; }
    }
    SLE.playFrom(n, 0);
  },
  // The setlist, a version or "After this song" changed: the next slot follows (in the background).
  nextChanged() { const s = page().songs.find((x) => x.id === loadedSongId); if (s) queueNext(s); },
  // Perform: tap a section while playing -> a jump to it, at the next bar line / the end of this section / the next beat.
  async queueJump(s: Song, secId: number, when: "bar" | "section" | "beat") {
    if (s.id !== loadedSongId || !page().playing) return false;
    const map = curMap, sec = (s.secs || []).find((x: any) => x.id === secId);
    if (!sec) return false;
    let toBar = sec.start;
    if (map) { const part = map.find((p) => !p.extra && p.secId === secId) || map.find((p) => !p.extra && sec.start >= p.sb && sec.start < p.sb + p.bars); if (!part) { page().toast(`“${sec.name}” isn't in this version`); return false; } toBar = part.vb + (sec.start - part.sb); }
    // "End of section": where the section playing now ends, in the engine's bars
    const nowSrc = srcBarBeat(s, page().pos).bar, cur = (s.secs || []).find((x: any) => nowSrc >= x.start && nowSrc < x.start + x.bars);
    let atBar = 0;
    if (cur) { const e = toBarBeat(s, srcTime(s, Math.min(cur.start + cur.bars - 1, s.total), 1)); atBar = e.bar + 1; }
    const nd = took(/^jump\d+$/); // 8d: a pedal queued it natively: the same jump, not queued twice (a bar line could pass in between)
    const r = nd && nd.result && nd.result.queued ? nd.result : await SL.call<{ queued?: boolean; atSeconds?: number; error?: string }>("queueJump", { toBar, toBeat: 1, when: when === "section" && atBar ? "section" : when === "beat" ? "beat" : "bar", atBar });
    if (r.error || !r.queued) { if (r.error) page().toast(r.error); return false; }
    jumpQ = { secId, at: r.atSeconds || 0 }; page().jumpQueued(secId); loopKey = "";
    return true;
  },
  async cancelJump() {
    if (!jumpQ) return false;
    jumpQ = null; page().jumpQueued(null);
    await SL.call("queueJump", { cancel: true });
    loopKey = ""; const s = page().songs.find((x) => x.id === loadedSongId); if (s) syncLoop(s); // a section loop takes the slot back
    return true;
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
  // 6f: no Save or Open: Ctrl/Cmd+N is a new setlist
  newSession: () => page().setlistCmd("new"),
  // Glue (6c item 7): the clips of t from a to b (seconds) rendered exactly as they play into a new WAV
  glueAudio: (s: Song, t: string, a: number, b: number) => SL.call<{ ref?: string; offset?: number; frames?: number; seconds?: number; error?: string }>("glueAudio", { payload: payload(s, page().ver.cur(s)), track: t, ref: s.files[t]?.path || "", from: a, to: b }),
  listen: (req: Partial<ListenState>) => setListen(req),
  diagnostics: (how: "copy" | "save") => diagnostics(how),
  preferences: () => preferences(),
  openBackup: () => openBackup(),
  cleanUpAudio: () => cleanUpAudio(),
  // Settings (6d) asks the app directly: audio setup, listen devices, MIDI outputs, folders...
  call: <T = any>(name: string, args?: unknown) => SL.call<T>(name, args),
  fileMenu: (at: { clientX: number; clientY: number }) => fileMenu(at),
  // 9c: the module's commands for the menus in the window chrome (ui/public/menus9.js)
  mod: { exportSetlist: () => exportSetlist(), importPackage: () => importPackage(), importAbleton: () => importAbleton().catch((e) => page().toast(String(e))), cleanUpAudio: () => cleanUpAudio(), openBackup: () => openBackup(),
    switchLibrary: (n: string) => switchLibrary(n), newLibrary: () => newLibrary(), renameLibrary: () => renameLibrary(), reveal: () => SL.call("libraryReveal"), quit: () => quitApp(),
    libraries: () => SL.call<{ name: string; current: boolean; songs: number }[]>("libraryList").catch(() => []), currentLibrary: () => (lib ? lib.name : "") },
  // ---- step 2: stems ----
  pickStems: () => pickStems(),
  importStems: (infos: AudioInfo[], copy: boolean) => importStems(infos, copy),
  addStems: (s: Song) => addStems(s),
  // 6e: audio only one version plays (picked here; files dropped on the panel come through onFileDrag)
  addVerAudio: (s: Song, v: any) => addVerAudio(s, v),
};

function onTransport(st: Transport) {
  const p = page();
  // the engine moved into the next song by itself (Segue): that song is playing now, from its start
  if (st.segued && st.songId) {
    if (nextMeta && nextMeta.songId === st.songId) adoptNext(); else { loadedSongId = st.songId; loadedKey = null; curMap = null; }
    const s = p.songs.find((x) => x.id === st.songId);
    if (s) { p.setPlayId(s.id); p.readySong(s.id, true); p.setPos(toTime(s, st.bar, st.beat)); queueNext(s); }
    return;
  }
  if (busy || !p.playing) return;
  const s = p.songs.find((x) => x.id === p.playId);
  if (!s || s.id !== loadedSongId) return;
  if (st.playing) {
    p.setPos(toTime(s, st.bar, st.beat)); p.setEngineBar(st.bar, st.beat);
    if (jumpQ && st.seconds >= jumpQ.at - 0.005) { jumpQ = null; p.jumpQueued(null); loopKey = ""; }
    syncLoop(s); return;
  }
  // The engine stopped by itself: end of the song (or the device went away).
  p.setPos(st.ended ? Math.max(0, s.audio - 0.01) : toTime(s, st.bar, st.beat));
  if (jumpQ) { jumpQ = null; p.jumpQueued(null); }
  if (st.ended) songEnded(s); else p.setPlaying(false);
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
  // 8a: on a narrow window the chip is just its dot, so the tooltip starts with what the text says
  const said = txt.textContent || "";
  chip.title = (tip.startsWith(said) ? "" : said + "\n") + tip + "\nClick for Settings › Audio";
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
  liveClicks().catch(() => {});
  try { sessionStorage.setItem("setline.session", JSON.stringify({ doc, text, lib })); } catch {}
  if (lib && text !== libText) libSave().catch(() => {});
  if (lib) { const cs = page().curSetId(); if (cs !== lastSetSent) { lastSetSent = cs; SL.call("libraryState", { lastSetlist: cs }).catch(() => {}); } }
  const dirty = lib ? text !== libText : text !== doc.savedText;
  page().setDirty(dirty);
  const key = doc.name + "|" + dirty;
  if (key !== lastReported) { lastReported = key; SL.call("setDocument", { name: doc.name, dirty }).catch(() => {}); }
  prepareCues();
}

// ---------------------------------------------------------------- the Library (6f)
// One always-open Library of every song (with all its versions) and setlists replaces Shows: nothing to open or save.
// The whole Library lives in memory as before (one object: songs, setlists, presets, ...) and is written to its
// folder as separate files (LibraryStore.h): library.json, songs/<id>/song.json, setlists/<id>.json; only the files
// whose text changed are written, a moment after each change (autosave), each atomically. Undo / redo work as before.
interface LibInfo { name: string; root: string }
let lib: LibInfo | null = null;
let libWritten = new Map<string, string>(); // relative path -> the text last written
let libText = "";                           // the whole library as last written
let libSaving: Promise<void> | null = null, libBackupAt = 0, libBackupText = "";
const BACKUP_EVERY = 10 * 60 * 1000;
const safeId = (id: string) => String(id).replace(/[^A-Za-z0-9_-]/g, (c) => "_" + c.charCodeAt(0).toString(16));
// The library's text, split into its files.
function libFiles(text: string): Map<string, string> {
  const o = JSON.parse(text), files = new Map<string, string>();
  const { songs = [], setlists = [], curSet, format, version, ...rest } = o;
  files.set("library.json", JSON.stringify({ format: "setline-library", version: 1, ...rest, name: lib ? lib.name : rest.name,
    songOrder: songs.map((s: any) => s.id), setlistOrder: setlists.map((l: any) => l.id) }, null, 1));
  for (const s of songs) files.set(`songs/${safeId(s.id)}/song.json`, JSON.stringify(s, null, 1));
  for (const l of setlists) files.set(`setlists/${safeId(l.id)}.json`, JSON.stringify(l, null, 1));
  return files;
}
// Autosave: whatever changed since the last write, now (called every second by remember(), and before anything
// that replaces the library or quits). Resolves once it's on disk.
function libSave(force = false): Promise<void> {
  if (!lib) return Promise.resolve();
  if (libSaving) return libSaving.then(() => libSave(force));
  const text = sessionText();
  if (text === libText && !force) return Promise.resolve();
  const files = libFiles(text), changed: Record<string, string> = {}, remove: string[] = [];
  for (const [k, v] of files) if (libWritten.get(k) !== v) changed[k] = v;
  for (const k of libWritten.keys()) if (!files.has(k)) remove.push(k);
  if (!Object.keys(changed).length && !remove.length) { libText = text; return Promise.resolve(); }
  page().setSaveState("saving");
  libSaving = SL.call<{ ok?: boolean; error?: string }>("libraryWrite", { files: changed, remove }).then((r) => {
    libSaving = null;
    if (r.error) { page().setSaveState("error", r.error); page().toast(r.error); return; }
    libWritten = files; libText = text; doc.savedText = text;
    page().setSaveState("saved");
    if (Date.now() - libBackupAt > BACKUP_EVERY && text !== libBackupText) libBackup("");
  }).catch((e) => { libSaving = null; page().setSaveState("error", String(e)); });
  return libSaving;
}
function libBackup(reason: string) {
  const text = libText || sessionText();
  libBackupAt = Date.now(); libBackupText = text;
  return SL.call("libraryBackup", { text, reason }).catch(() => {});
}
// Opens a library (by name; "" = the last one, or a new "My Library") and the setlist to start on.
async function openLibrary(name = "", startEmpty?: boolean): Promise<string> {
  if (page().playing) { page().toast("Stop playback first"); return "playing"; }
  if (lib) await libSave();
  const r = await SL.call<{ name?: string; root?: string; text?: string; created?: boolean; error?: string }>("libraryOpen", { name });
  if (r.error || !r.text) { page().toast(r.error || "Couldn't open the library"); return r.error || "error"; }
  lib = { name: r.name!, root: r.root! };
  const st = await SL.call<{ lastSetlist: string; onLaunch: string }>("libraryState");
  const o = JSON.parse(r.text);
  o.setlists = Array.isArray(o.setlists) ? o.setlists : [];
  const empty = startEmpty ?? st.onLaunch === "empty";
  if (!o.setlists.length) o.setlists.push({ id: "L1", name: "Setlist 1", order: [] });
  let cur = o.setlists.find((l: any) => l.id === st.lastSetlist) || o.setlists[0];
  if (empty && cur.order && cur.order.length) { cur = { id: "L" + Date.now().toString(36), name: "New setlist", order: [] }; o.setlists.push(cur); }
  o.curSet = cur.id;
  doc = { name: lib.name, savedText: "" };
  applySession(JSON.stringify(o));
  // what's on disk now (so nothing is rewritten just for opening); format updates on open are written once
  libWritten = libFiles(r.text.length ? JSON.stringify({ ...JSON.parse(r.text), curSet: undefined }) : "{}");
  libWritten.delete("library.json"); // the index is always written once on open (it may have been damaged; unchanged text is skipped natively)
  libText = "";
  await libSave();
  libBackup("on launch");
  page().setSessionName(lib.name);
  remember();
  page().setlistOpened(); // its MIDI sync point, if it's set to go out when the setlist opens
  return "";
}
// ---- Export / Import (.setline packages) ----
// A setlist with every song it uses (all versions), only the audio those need, the song fields, dashboards, patch
// name lists, presets and cue words they use.
function exportText(listId: string): { text: string; audio: string[]; name: string } {
  const o = JSON.parse(sessionText());
  const L = o.setlists.find((l: any) => l.id === listId) || o.setlists[0];
  const songs = o.songs.filter((s: any) => L.order.includes(s.id));
  const audio = new Set<string>();
  for (const s of songs) for (const f of Object.values(s.files || {}) as any[]) if (f && f.path) audio.add(f.path);
  const words = (o.cueWords || []).filter((w: any) => songs.some((s: any) => (s.cues || []).some((c: any) => String(c.text || "").trim().toLowerCase() === String(w.word || "").trim().toLowerCase())));
  for (const w of words) if (w.path) audio.add(w.path);
  const pkg = { format: "setline-package", version: 1, from: lib ? lib.name : "", rate: o.rate, setlist: L, songs,
    presets: o.presets || [], click: o.click, clickT: o.clickT, cueVoice: o.cueVoice, pron: o.pron, cueWords: words,
    fields: o.fields || [], dashboards: o.dashboards || [], patchLists: o.patchLists || [], phrases: o.phrases };
  return { text: JSON.stringify(pkg, null, 1), audio: [...audio], name: L.name };
}
async function exportSetlist(listId?: string, to?: string) {
  await libSave();
  const e = exportText(listId || page().curSetId());
  const r = await SL.call<{ path?: string; cancelled?: boolean; error?: string }>("exportSetlist", { name: e.name, text: e.text, audio: e.audio, to: to || "" });
  if (r.error) page().toast(r.error); else if (r.path) page().toast(`Exported “${e.name}” to ${r.path}`);
  return r;
}
// ---- 7b / 9a: Import an Ableton Live project (.als). Read (in the app, read-only) -> ONE window: 1 Sort markers ->
// 2 Options -> 3 Import (copy the audio into the Library by content, one progress list, Run in background, Cancel
// removes what was copied) -> the songs added in one batch (after Stop if playing) -> the summary in the same window,
// saved next to the Library's migration log. choose: tests answer the preview themselves (no window then).
interface AbleData { project: string; live: string; mode: string; path: string; songs: any[]; ignored: string[]; missing: string[]; warnings: string[]; cuePads?: any[]; converted?: any[]; locators?: any[]; breaks?: any[]; removable?: boolean; error?: string; cancelled?: boolean }
type AbleChoice = { picks: { i: number; dup: string }[]; setlist: boolean; data?: AbleData; opt?: any };
// what the user chose in Sort markers, per project file (a re-import offers the same)
const ABLE_CHOICES = "setline.ableChoices";
const ableStore = (): Record<string, { mode: string; choices: Record<string, string> }> => { try { return JSON.parse(localStorage.getItem(ABLE_CHOICES) || "{}"); } catch { return {}; } };
let ableProg: ((p: any) => void) | null = null; // 9a: copy progress goes to the import window, not the generic box
async function importAbleton(path?: string, choose?: (data: AbleData, dups: any[]) => Promise<AbleChoice | null>, mode = "auto", choicesIn?: Record<string, string>) {
  if (page().playing) { page().toast("Stop playback first"); return { error: "playing" }; }
  if (!lib) { page().toast("Open a library first"); return { error: "no library" }; }
  const A = (window as any).SLAble;
  const ports = page().PORTS || [];
  const located: Record<string, string> = {};
  let choices: Record<string, string> = { ...(choicesIn || {}) };
  const readAs = async (m: string, p: string) => {
    const r = await SL.call<AbleData>("ableRead", { path: p, mode: m, ports, choices });
    if (r.error || r.cancelled) return r;
    // samples found with Locate… stay found when the mode changes
    for (const s of r.songs) for (const t of s.tracks || []) if (t.kind === "audio" && t.file && !t.file.found && located[t.file.name]) { t.file.found = true; t.file.path = located[t.file.name]; }
    return r;
  };
  let data = await readAs(mode, path || "");
  if (data.cancelled) return data;
  if (data.error) { page().toast(data.error); return data; }
  const src = data.path;
  // the choices made for this project last time (not in tests that pass their own)
  const kept = !choicesIn && !choose ? ableStore()[src] : undefined;
  if (kept && (Object.keys(kept.choices || {}).length || (kept.mode && kept.mode !== mode))) {
    choices = { ...(kept.choices || {}) }; mode = kept.mode || mode;
    const d = await readAs(mode, src); if (!d.error) data = d;
  }
  const dupsFor = async (d: AbleData) => {
    // 9a: only songs whose name is already in the library can be duplicates: hash just their files (hashing a whole
    // set off a USB drive took minutes before the window could open)
    const names = new Set(page().songs.map((x: any) => String(x.name).trim().toLowerCase()));
    const paths = [...new Set(d.songs.filter((s: any) => names.has(String(s.name).trim().toLowerCase())).flatMap((s: any) => (s.tracks || []).filter((t: any) => t.file && t.file.found).map((t: any) => t.file.path as string)))];
    const hashes = paths.length ? await SL.call<Record<string, string>>("hashFiles", { paths }) : {};
    return d.songs.map((s: any) => A.dups(s, hashes));
  };
  const remember = () => { const st = ableStore(); if (Object.keys(choices).length || ctx.mode !== "auto") st[src] = { mode: ctx.mode, choices }; else delete st[src]; try { localStorage.setItem(ABLE_CHOICES, JSON.stringify(st)); } catch { /* full */ } };
  const ctx: any = {
    mode, dups: await dupsFor(data),
    remode: async (m: string) => { const d = await readAs(m, src); if (d.error) { page().toast(d.error); return null; } data = d; ctx.dups = await dupsFor(d); return d; },
    // 9a: Sort markers: re-read with the user's choices (changes only; {} with a new mode starts over)
    resort: async (diff: Record<string, string>, m: string) => {
      if (m !== ctx.mode) choices = {};
      choices = { ...choices, ...diff };
      const d = await readAs(m, src); if (d.error) { page().toast(d.error); return null; }
      // keep only the choices that differ from set.Line's guesses
      for (const l of d.locators || []) { const v = l.choice === "break" ? "break:" + (l.label || "Gear change") : l.choice; if (choices[l.key] !== undefined && l.guess !== "break" && l.guess === ableKind(choices[l.key]) && v === choices[l.key]) delete choices[l.key]; }
      ctx.mode = m; data = d; ctx.dups = await dupsFor(d); remember(); return d;
    },
    locate: async (names: string[]) => {
      const r = await SL.call<{ found?: Record<string, string>; cancelled?: boolean }>("ableLocate", { names });
      if (!r.found) return null;
      Object.assign(located, r.found);
      const n = Object.keys(r.found).length;
      page().toast(n ? `Found ${n} of ${names.length} sample${names.length === 1 ? "" : "s"}` : "None of the missing samples are in that folder");
      const d = await readAs(ctx.mode, src); if (d.error) return null; data = d; ctx.dups = await dupsFor(d); return d;
    },
  };
  const choice: AbleChoice | null = choose ? await choose(data, ctx.dups) : await A.wizard(data, ctx);
  const W = choose ? null : A.wiz();
  if (!choice || !choice.picks.length) { if (W) W.close(); return { cancelled: true }; }
  if (choice.data) data = choice.data;
  // the audio the chosen songs use, each file once (with its size and a name for the list)
  const byPath = new Map<string, { name: string; bytes: number }>();
  for (const p of choice.picks) for (const t of data.songs[p.i].tracks || []) if (t.file && t.file.found && !byPath.has(t.file.path)) byPath.set(t.file.path, { name: `${data.songs[p.i].name} / ${t.file.name || t.name}`, bytes: t.file.bytes || 0 });
  const files = [...byPath.keys()];
  const rows = files.map((f) => ({ name: byPath.get(f)!.name, bytes: byPath.get(f)!.bytes, frac: 0, state: "wait" }));
  const total = rows.reduce((a, r) => a + r.bytes, 0);
  let cancel = false, doneBytes = 0;
  const t0 = performance.now();
  const show = (phase: string) => {
    const el = (performance.now() - t0) / 1000, cur = rows.find((r) => r.state === "run");
    const d = doneBytes + (cur ? cur.bytes * cur.frac : 0);
    const eta = d > 0 && el > 2 && total > d ? (total - d) / (d / el) : 0;
    if (W) A.prog({ phase, files: rows, done: d, total, eta });
  };
  if (W) W.onCancel = () => { cancel = true; };
  const refs: Record<string, string> = {}, copied: string[] = [];
  const cur = await SL.call<FileResult>("getSessionFile");
  let k = 0;
  ableProg = (p: any) => { const r = rows[k]; if (r && p.total > 0 && !p.finished) { r.frac = Math.min(1, p.done / p.total); show("copy"); } };
  try {
    for (k = 0; k < files.length && !cancel; k++) {
      rows[k].state = "run"; show("copy");
      const r = await SL.call<{ files?: { path: string; ref: string; copied?: string }[]; error?: string }>("importAudio", { session: cur.path || "", copy: true, hashed: true, files: [files[k]] });
      if (r.error) { rows[k].state = "err"; show("copy"); page().toast(r.error); cancel = true; break; }
      for (const f of r.files || []) { refs[f.path] = f.ref; if (f.copied) copied.push(f.copied); }
      rows[k].state = "ok"; rows[k].frac = 1; doneBytes += rows[k].bytes; show("copy");
    }
  } finally { ableProg = null; }
  if (cancel || (W && W.cancelled)) {
    const n = copied.length ? await SL.call<number>("removeImported", { session: cur.path || "", paths: copied }).catch(() => 0) : 0;
    if (W) W.close();
    page().toast(`Import cancelled: no songs were added${n ? `; ${n} copied file${n === 1 ? "" : "s"} removed again` : ""}`);
    return { cancelled: true };
  }
  const infos: Record<string, AudioInfo> = {};
  for (const i of await probe(files)) infos[i.path] = i;
  if (!sessionRate) sessionRate = Object.values(infos).find((i) => i.rate)?.rate || rateForImport();
  const otherRate = Object.values(infos).filter((i) => i.rate && i.rate !== sessionRate);
  // 8b: recorded cue audio: each pad the chosen songs use, its part of the sample cut into a WAV and copied into the
  // Library as that word ("Use your recorded cue audio")
  const opt = A.opt(choice.opt);
  let recWords = 0;
  if (opt.recCues && (data.cuePads || []).length) {
    show("cues");
    const used = new Set<string>();
    for (const p of choice.picks) for (const c of data.songs[p.i].cues || []) used.add(c.track + "|" + c.note);
    const items = (data.cuePads || []).filter((x: any) => used.has(x.track + "|" + x.note) && x.file && x.file.found)
      .map((x: any) => { const k2 = x.track + "|" + x.note; return { path: x.file.path, start: x.file.start || 0, end: x.file.end ?? -1, word: (opt.padWords[k2] !== undefined ? opt.padWords[k2] : x.word).trim() || x.word }; });
    const uniq = items.filter((x: any, i: number) => items.findIndex((y: any) => y.word.toLowerCase() === x.word.toLowerCase()) === i);
    if (uniq.length) {
      const cut = await SL.call<{ word: string; path: string }[]>("ableCueAudio", { items: uniq }).catch(() => []);
      if (cut.length) {
        ableProg = () => {};
        const imp = await SL.call<{ files?: { path: string; ref: string }[]; error?: string }>("importAudio", { session: cur.path || "", copy: true, files: cut.map((c) => c.path), sub: "Cues/Words" }).finally(() => { ableProg = null; });
        for (const f of imp.files || []) { const c = cut.find((x) => x.path === f.path); if (c) { opt.cueRefs[c.word.toLowerCase()] = { ref: f.ref, name: c.word + ".wav" }; recWords++; } }
      }
    }
  }
  // never into the library while playing: the files are copied; the songs go in at Stop
  while (page().playing) { show("wait"); await new Promise((r) => setTimeout(r, 300)); }
  show("add");
  const res = A.add(data, choice.picks, refs, infos, choice.setlist, opt);
  loadedKey = null; nextKey = "";
  const ms = Math.round(performance.now() - t0);
  // the summary (and the log next to the migration log)
  const fmtB = (v: number) => String(+(+v).toFixed(3));
  const lines: string[] = [`Imported from Ableton: ${data.project} (${data.path})`,
    `${res.added.length} new song${res.added.length === 1 ? "" : "s"}${res.versions.length ? `, ${res.versions.length} new version${res.versions.length === 1 ? "" : "s"}` : ""}${res.setlist ? `, setlist “${res.setlist}”` : ""}${res.breaks ? ` with ${res.breaks} break${res.breaks === 1 ? "" : "s"}` : ""}; ${files.length} audio file${files.length === 1 ? "" : "s"} (${(total / 1e9).toFixed(2)} GB) copied into the library in ${ms < 60000 ? (ms / 1000).toFixed(1) + " s" : (ms / 60000).toFixed(1) + " min"}.`];
  // 9a: Sort markers, meters, tempo clean-up
  const L = data.locators || [];
  const cnt = (c: string) => L.filter((l: any) => !l.clip && l.choice === c).length;
  if (L.length) lines.push(`Markers sorted: ${cnt("song")} song${cnt("song") === 1 ? "" : "s"}, ${cnt("ignore")} ignored, ${cnt("break")} break${cnt("break") === 1 ? "" : "s"}, ${cnt("marker")} marker${cnt("marker") === 1 ? "" : "s"}, ${cnt("section")} section locator${cnt("section") === 1 ? "" : "s"}${L.some((l: any) => l.clip) ? `, ${L.filter((l: any) => l.clip && l.choice !== "ignore").length} section clips` : ""}.`);
  if (recWords) lines.push(`${recWords} recorded cue word${recWords === 1 ? "" : "s"} from the Live pads (the same voice as in Live).`);
  for (const p of choice.picks) {
    const s = data.songs[p.i];
    const meters = (s.tmap || []).filter((x: any, i: number, a: any[]) => i === 0 || x.sig.join("/") !== a[i - 1].sig.join("/")).map((x: any) => `${x.sig.join("/")}${x.bar > 1 ? " at " + x.bar : ""}`);
    const notes: string[] = [];
    if (meters.length > 1) notes.push(`meters: ${meters.join(" → ")}`);
    if ((s.snapped || []).length) notes.push(`tempo cleaned: ${s.snapped.map((x: any) => `${x.from} → ${fmtB(x.to)}`).join(", ")}`);
    if (s.endMoved) notes.push(`end tempo: its last bar stays at ${fmtB(s.endMoved.to)} (the change to ${fmtB(s.endMoved.next)} belongs to the next song)`);
    if ((s.marks || []).length) notes.push(`${s.marks.length} marker${s.marks.length === 1 ? "" : "s"}`);
    lines.push(`- ${s.name}: ${s.audioTracks} audio, ${s.midiTracks} MIDI, ${(s.clicks || []).length} click, ${(s.cues || []).length} cues, ${opt.secs[p.i] ? "sections from cues" : s.secs.length + " sections"}${notes.length ? "; " + notes.join("; ") : ""}${(s.warnings || []).length ? "\n    " + s.warnings.join("\n    ") : ""}`);
  }
  if (otherRate.length) lines.push(`${otherRate.length} file${otherRate.length === 1 ? " isn't" : "s aren't"} at the library's rate (${sessionRate / 1000} kHz); set.Line never resamples, so ${otherRate.length === 1 ? "it plays" : "they play"} at the wrong speed until replaced: ${otherRate.map((i) => i.name).join(", ")}`);
  const missing = [...new Set(choice.picks.flatMap((p) => (data.songs[p.i].tracks || []).filter((t: any) => t.kind === "audio" && !(t.file && t.file.found)).map((t: any) => (t.file && t.file.name) as string)))].filter(Boolean);
  if (missing.length) lines.push(`Still missing (those tracks play silence until you add the file): ${missing.join(", ")}`);
  if ((data.ignored || []).length) lines.push(`Not imported (devices, plug-ins, returns): ${data.ignored.join(", ")}`);
  const logPath = await SL.call<string>("ableLog", { text: lines.join("\n") }).catch(() => "");
  if (W) A.finish(lines, logPath, res.added[0] || (res.versions[0] && res.versions[0][0]) || "");
  return { ...res, files: files.length, lines, logPath, ms, bytes: total };
}
const ableKind = (v: string) => String(v).split(":")[0];
// Import: songs are matched by their id, then by their audio; one that differs asks Keep mine / Use imported / Keep both.
async function importPackage(path?: string, choose?: (rows: any[]) => Promise<Record<string, string> | null>) {
  if (page().playing) { page().toast("Stop playback first"); return { error: "playing" }; }
  const r = await SL.call<{ path?: string; name?: string; text?: string; audio?: string[]; have?: string[]; cancelled?: boolean; error?: string }>("readPackage", { path: path || "" });
  if (r.cancelled) return r;
  if (r.error || !r.text) { page().toast(r.error || "Couldn't read that file"); return r; }
  const pkg = JSON.parse(r.text);
  const plan = page().importPlan(pkg);
  const bytesNote = `${(r.audio || []).length - (r.have || []).length} audio file${(r.audio || []).length - (r.have || []).length === 1 ? "" : "s"} to copy`;
  const decisions = plan.differ.length ? await (choose ? choose(plan.differ) : page().importBox(r.name || "", plan, bytesNote)) : await (choose ? Promise.resolve({}) : page().importBox(r.name || "", plan, bytesNote));
  if (!decisions) return { cancelled: true };
  const a = await SL.call<{ copied?: number; error?: string }>("importPackageAudio", { path: r.path });
  if (a.error) { page().toast(a.error); return a; }
  const res = page().importMerge(pkg, decisions);
  forgetMissingPeaks(); loadedKey = null; nextKey = "";
  await libSave();
  page().toast(`Imported “${res.setlist}”: ${res.added} new song${res.added === 1 ? "" : "s"}, ${res.same} already here${res.replaced ? `, ${res.replaced} replaced` : ""}${res.both ? `, ${res.both} kept both` : ""}`);
  return { ...res, copied: a.copied };
}
// ---- Bring your shows into the Library (first launch after 6f): each show becomes a setlist; songs that are the
// same (name + audio) merge. The shows' folders are only read, never changed. ----
async function migrateShows(paths: string[]) {
  const log: string[] = [];
  let made = 0;
  for (const path of paths) {
    const r = await SL.call<{ text?: string; folder?: string; error?: string }>("readShow", { path });
    if (r.error || !r.text) { log.push(`${path}: ${r.error || "empty"}`); continue; }
    let o: any;
    try { o = JSON.parse(r.text); } catch (e) { log.push(`${path}: not readable (${e})`); continue; }
    const name = path.split(/[\\/]/).pop()!.replace(/\.setline$/i, "");
    // the show's audio (and recorded cue words) into the library by content; references become library ones
    const refs = new Set<string>();
    for (const s of o.songs || []) for (const f of Object.values(s.files || {}) as any[]) if (f && f.path) refs.add(f.path);
    const wordRefs = new Set<string>();
    for (const w of [...(o.cueWords || []), ...(o.songs || []).flatMap((s: any) => s.cueWords || [])]) if (w && w.path) wordRefs.add(w.path);
    const abs = (ref: string) => (/^([A-Za-z]:[\\/]|\/)/.test(ref) ? ref : r.folder + "/" + ref);
    const map: Record<string, string> = {}, missing: string[] = [];
    const cur = await SL.call<FileResult>("getSessionFile");
    const doImport = async (list: string[], sub?: string) => {
      const exists = await SL.call<{ files: AudioInfo[] }>("probeAudio", { paths: list.map(abs), rate: 0 });
      const ok = list.filter((_, i) => exists.files[i] && exists.files[i].ok);
      list.filter((_, i) => !(exists.files[i] && exists.files[i].ok)).forEach((x) => missing.push(x));
      if (!ok.length) return;
      const im = await SL.call<{ files?: { path: string; ref: string }[]; error?: string }>("importAudio", { session: cur.path || "", copy: true, hashed: !sub, ...(sub ? { sub } : {}), files: ok.map(abs) });
      if (im.error) { log.push(`${name}: ${im.error}`); return; }
      (im.files || []).forEach((f, i) => { map[ok[i]] = f.ref; });
    };
    await doImport([...refs]);
    await doImport([...wordRefs], "Cues/Words");
    await SL.call("mergeCues", { from: r.folder + "/Cues" }); // its stored cues first: nothing is spoken again with this computer's voice
    const res = page().mergeShow(o, name, map);
    if (missing.length) log.push(`${name}: ${missing.length} audio file(s) missing (they play as silence): ${missing.slice(0, 8).join(", ")}`);
    log.push(`${name} (${path}): setlist${res.setlists.length > 1 ? "s" : ""} ${res.setlists.map((x: string) => "“" + x + "”").join(", ")}; ${res.added} new song(s), ${res.merged} merged with songs already in the library${res.notes.length ? "; " + res.notes.join("; ") : ""}`);
    made++;
  }
  const where = await SL.call<string>("migrationLog", { text: `Brought ${made} ${made === 1 ? "show" : "shows"} into the library “${lib ? lib.name : ""}”.\n` + log.join("\n") + "\nThe original show folders weren't changed; you can delete them yourself once you're happy." });
  page().rerender(); loadedKey = null; nextKey = "";
  await libSave(); remember(); prepareCues();
  return { made, log, where };
}
async function offerMigration() {
  if (await SL.call<boolean>("migrationAsked")) return;
  const shows = await SL.call<{ path: string; name: string; songs: number; bytes: number }[]>("findShows");
  if (!shows.length) { SL.call("migrationAsked", { set: true }); return; }
  const picked = await page().migrationBox(shows);
  SL.call("migrationAsked", { set: true });
  if (!picked || !picked.length) return;
  const r = await migrateShows(picked);
  page().toast(`Brought ${r.made} show${r.made === 1 ? "" : "s"} into the library. Your show folders weren't changed (log: ${r.where})`);
}
async function restoreBackup(path: string, into: "replace" | "new") {
  if (page().playing) { page().toast("Stop playback first"); return; }
  const r = await SL.call<{ text?: string; error?: string }>("readBackup", { path });
  if (r.error || !r.text) { page().toast(r.error || "Couldn't read that backup"); return; }
  if (into === "new") {
    const base = (lib ? lib.name : "Library") + " (restored)";
    let name = base, n = 2; const libs = await SL.call<{ name: string }[]>("libraryList");
    while (libs.some((l) => l.name === name)) name = `${base} ${n++}`;
    const c = await SL.call<{ error?: string }>("libraryCreate", { name });
    if (c.error) { page().toast(c.error); return; }
    // the backup's audio is the current library's: copied along by reference (Audio/ files are shared by content)
    const o = JSON.parse(r.text);
    await openLibrary(name);
    const refs = new Set<string>(); for (const s of o.songs || []) for (const f of Object.values(s.files || {}) as any[]) if (f && f.path) refs.add(f.path);
    page().toast(`Restored into a new library “${name}”`);
    applySession(JSON.stringify(o)); await libSave(true);
    return;
  }
  await libBackup("before restoring");
  applySession(r.text); await libSave(true);
  page().toast("The library is back as it was in that backup (a backup of how it was just before is kept)");
}

let lastSetSent = "";
let bandHost: ReturnType<typeof startBandHost> | null = null;

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
// Tests only (6f has no Save): writes the session as an old-style show (<folder>/<name>.setline with its stems in
// <folder>/Audio), e.g. to make the shows a migration test brings into the library. Never while a library is open.
async function saveSession(_as: boolean, to?: string): Promise<boolean> {
  if (saving || !to || lib) return false;
  saving = true;
  try {
    const cur = await SL.call<FileResult>("getSessionFile");
    const files = audioFiles(), words = page().wordFiles();
    if (files.length || words.length) {
      const c = await SL.call<{ map?: Record<string, string>; missing?: string[]; error?: string }>("collectAudio",
        { from: cur.path || "", to, background: false, files: [...files.map((x) => ({ ref: x.f.path, copy: true })), ...words.map((w) => ({ ref: w.path, copy: true, sub: "Cues/Words" }))] });
      if (c.error) { page().toast(c.error); return false; }
      applyRefMap(c.map || {});
    }
    const text = sessionText();
    const r = await SL.call<FileResult>("writeSession", { path: to, text });
    if (r.error) { page().toast(r.error); return false; }
    SL.call("storeCues", { cues: cueList() }).catch(() => {});
    doc = { name: r.name || doc.name, savedText: text };
    return true;
  } finally { saving = false; }
}

// File › Backups ▸ (6f): the library's automatic backups (on launch and every 10 minutes, the last 20), newest first.
// Restoring one goes into a new library, or replaces this one (after a confirm; a backup of how it was is kept).
async function openBackup(at?: { clientX: number; clientY: number }) {
  const list = await SL.call<{ name: string; path: string; time: number; size: number }[]>("libraryBackups");
  if (!list.length) { page().toast("No backups yet: one is made each time set.Line starts and every 10 minutes"); return; }
  const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const p = at || { clientX: 80, clientY: 60 };
  page().menu(p, [
    { label: `Backups of “${lib ? lib.name : ""}” (newest first)`, icon: "", dis: true, act: () => {} },
    ...list.map((b) => ({ label: when(b.time) + (/on launch/.test(b.name) ? " · on launch" : /before/.test(b.name) ? " · before a restore" : ""), icon: "🕘", act: () => page().menu(p, [
      { label: "Restore into a new library", icon: "＋", act: () => { restoreBackup(b.path, "new"); } },
      { label: "Replace this library with it…", icon: "↺", danger: true, act: () => page().confirm("Replace the library?", `Everything in “${lib ? lib.name : ""}” goes back to how it was on ${when(b.time)}. A backup of how it is now is kept first, so you can come back.`, "Replace", () => { restoreBackup(b.path, "replace"); }) },
    ]) })),
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

// ---------------------------------------------------------------- start-up (6f): the last library and setlist
const isDirty = () => (lib ? sessionText() !== libText : sessionText() !== doc.savedText);
let startProblem = "";
async function openAtStart(): Promise<string> {
  try { startProblem = await openLibrary(""); } catch (e) { startProblem = String((e as Error)?.message || e); }
  return startProblem;
}
async function retryStartShow() {
  const why = await openAtStart();
  const n = page().songs.length;
  await SL.call("loadingStep", why ? { id: "show", state: "failed", detail: why } : { id: "show", state: "done", detail: `${doc.name} · ${n} song${n === 1 ? "" : "s"}` });
}
// Tests only: opens an old show file as the session (no library).
async function openPath(path: string) {
  const r = await SL.call<FileResult>("openSessionPath", { path });
  if (r.error || !r.text) { page().toast(r.error || "Couldn't open that file"); return; }
  lib = null;
  doc = { name: r.name || "", savedText: "" };
  applySession(r.text);
  doc.savedText = sessionText();
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
  const libs = await SL.call<{ name: string; current: boolean; songs: number }[]>("libraryList").catch(() => [] as { name: string; current: boolean; songs: number }[]);
  const reveal = navigator.platform.startsWith("Mac") ? "Show in Finder" : "Show in Explorer";
  const sub = (title: string, items: (MenuItem | "-")[]) => ({ label: title + " ▸", icon: "", act: () => page().menu(at, items) });
  const items: (MenuItem | "-")[] = [
    { label: "New setlist", icon: "＋", act: () => page().setlistCmd("new") },
    { label: "Duplicate setlist", icon: "⧉", act: () => page().setlistCmd("dup") },
    "-",
    { label: "Export setlist…", icon: "⇪", act: () => { exportSetlist(); } },
    { label: "Import…", icon: "⇩", act: () => { importPackage(); } },
    { label: "Import Ableton project…", icon: "⇩", act: () => { importAbleton().catch((e) => page().toast(String(e))); } },
    "-",
    sub("Library", [
      ...libs.map((l) => ({ label: l.name + (l.current ? "  ✓" : ""), icon: "▤", dis: l.current, act: () => { switchLibrary(l.name); } })),
      "-",
      { label: "New library…", icon: "＋", act: () => { newLibrary(); } },
      { label: "Rename…", icon: "✎", act: () => { renameLibrary(); } },
      { label: reveal, icon: "📂", act: () => { SL.call("libraryReveal"); } },
    ]),
    { label: "Backups ▸", icon: "🕘", act: () => { openBackup(at); } },
    { label: "Clean up unused audio…", icon: "🧹", act: () => { cleanUpAudio(); } },
    "-",
    { label: "Settings…", icon: "⚙", key: (navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+") + ",", act: () => { preferences(); } },
    { label: "Copy diagnostics", icon: "⎘", act: () => { diagnostics("copy"); } },
    { label: "Check for updates…", icon: "⟳", act: () => { (window as any).SLUpd.check(true); } },
    "-",
    { label: "Quit", icon: "⏻", act: () => { quitApp(); } },
  ];
  page().menu(at, items);
}
async function quitApp() { await libSave().catch(() => {}); SL.call("quitNow").catch(() => {}); }
async function switchLibrary(name: string) {
  if (page().playing) { page().toast("Stop playback first: switching libraries is refused while playing"); return; }
  const why = await openLibrary(name);
  if (!why) page().toast(`Opened the library “${name}”`);
}
async function newLibrary() {
  if (page().playing) { page().toast("Stop playback first"); return; }
  const pick = await new Promise<{ name?: string } | null>((res) => page().nameBox({ title: "New library", value: "New Library", where: "", hint: "A library is completely separate: its own songs, setlists and audio." }, res));
  if (!pick || !pick.name) return;
  const r = await SL.call<{ name?: string; error?: string }>("libraryCreate", { name: pick.name });
  if (r.error) { page().toast(r.error); return; }
  await switchLibrary(r.name!);
}
async function renameLibrary() {
  if (!lib) return;
  const pick = await new Promise<{ name?: string } | null>((res) => page().nameBox({ title: "Rename library", value: lib!.name, where: "" }, res));
  if (!pick || !pick.name || pick.name === lib.name) return;
  await libSave();
  const r = await SL.call<{ name?: string; root?: string; error?: string }>("libraryRename", { name: pick.name });
  if (r.error) { page().toast(r.error); return; }
  lib = { name: r.name!, root: r.root! }; doc.name = lib.name;
  page().setSessionName(lib.name); await libSave(true); remember();
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
  // 6f: into the library, always copied, stored by content (the same file twice is stored once)
  const r = await SL.call<{ files?: { path: string; ref: string }[]; error?: string }>("importAudio",
    { session: cur.path || "", copy: lib ? true : copy, hashed: !!lib, files: infos.map((i) => i.path) });
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
// 6e: audio only one version plays (an intro pad...): imported like stems, placed in that version's own part.
async function addVerAudioFrom(s: Song, v: any, list: AudioInfo[]) {
  const bad = list.filter((x) => !x.ok), good = list.filter((x) => x.ok);
  if (bad.length) page().toast(`${bad[0].name}: ${bad[0].error}`);
  if (!good.length) return;
  const copy = copyPref();
  const refs = await importStems(good, copy);
  if (!refs) return;
  page().addVerAudio(s, v, good.map((info) => ({ info })), refs, copy);
  loadedKey = null; nextKey = "";
  page().toast(`Added ${good.length} file${good.length > 1 ? "s" : ""} to “${v.name}” only`);
}
async function addVerAudio(s: Song, v: any) { const list = await pickStems(); if (list) await addVerAudioFrom(s, v, list); }
async function addStems(s: Song) {
  const list = await pickStems();
  if (list) await addStemsFrom(s, list);
}

// Copy progress: a small sheet with a bar while files are copied.
let progressEl: HTMLElement | null = null;
function onProgress(p: Progress) {
  if (ableProg) { ableProg(p); return; } // 9a: an Ableton import shows it in its own window
  if ((p as any).kind === "export") { page().exportProgress(p); return; }
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
  const als = d.paths.filter((x) => /\.als$/i.test(x));
  if (als.length) { await importAbleton(als[0]); return; } // 7b: an Ableton project dropped anywhere (the Library panel too)
  if (!audio.length) {
    if (sessions.length) { await importPackage(sessions[0]); return; } // a .setline package: Import
    p.toast("Drop WAV, AIFF or FLAC files, or a .setline package to import");
    return;
  }
  const list = await probe(audio);
  if (p.modalOpen()) { p.addNative(list); return; }
  const target = document.elementFromPoint(d.x, d.y) as HTMLElement | null;
  const vbox = target?.closest<HTMLElement>("[data-vaudio]");
  if (vbox) { const s = p.songs.find((x) => x.id === p.selId); const v = s && p.ver.cur(s); if (s && v && v.id === vbox.dataset.vaudio) { await addVerAudioFrom(s, v, list); return; } }
  const folder = target?.closest<HTMLElement>(".folder[data-id]");
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
  const mark = (name: string, took = -1) => SL.call("startupMark", { name, took }).catch(() => {});
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const n = page().songs.length;
  // 7a: the window shows as soon as the library and setlist are on screen; waveforms and cues carry on behind it
  // (the splash rows say so), and their times go to the log ("Startup: …").
  try {
    if (showProblem) await step("show", "failed", showProblem);
    else await step("show", "done", `${doc.name || "Library"} · ${n} song${n === 1 ? "" : "s"}`);
    await step("waveforms", "done", "after the window opens");
    await step("cues", "done", "after the window opens");
  } catch (e) { console.warn("set.Line: loading", e); }
  await mark("setlist on screen");
  await SL.call("loadingDone").catch(() => {});
  const bg = async () => {
    const t0 = performance.now();
    try {
      const cur = await SL.call<FileResult>("getSessionFile");
      const refs = [...new Set(audioFiles().map((x) => x.f.path))];
      if (refs.length) {
        let r = await SL.call<{ ready: number; total: number }>("peaksReady", { refs, session: cur.path || "", prepare: true });
        for (let t = 0; !quick && r.ready < r.total && t < 600; t++) { await wait(100); r = await SL.call("peaksReady", { refs, session: cur.path || "" }); }
        await mark(`waveforms ${r.ready} of ${r.total}`, performance.now() - t0);
      } else await mark("waveforms none", performance.now() - t0);
      const t1 = performance.now();
      prepareCues();
      const list = cueList();
      if (list.length) {
        let r = await SL.call<{ ready: number; total: number }>("cuesReady", { cues: list });
        for (let t = 0; !quick && r.ready < r.total && t < 600; t++) { await wait(100); r = await SL.call("cuesReady", { cues: list }); }
        await mark(`cues ${r.ready} of ${r.total}`, performance.now() - t1);
      } else await mark("cues none", performance.now() - t1);
    } catch (e) { console.warn("set.Line: background loading", e); }
  };
  if (quick) await bg(); else bg();
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
  // 7a: the interface that was missing at launch is plugged in (while stopped): set.Line plays on it again
  SL.on("interfaceBack", (m: { device: string; listen: ListenState }) => { listen = m.listen; loadedKey = null; page().setListen(listen, listenWhat()); page().toast(`${m.device} is connected: playing on it again`); });
  SL.on("engineStats", (x: Stats) => showStatus(x));
  SL.on("audioProgress", onProgress);
  SL.on("fileDrag", (d) => { onFileDrag(d).catch((e) => page().toast(String(e))); });
  installDrop();
  const copyBox = document.getElementById("mCopy") as HTMLInputElement | null;
  if (copyBox && !SL.native) {
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
    if (m.cmd === "checkUpdates") { (window as any).SLUpd.check(true); return; } // 8d
    if (m.cmd.startsWith("m:")) { (window as any).SLMenus && (window as any).SLMenus.run(m.cmd); return; } // 9c: the menus in the window chrome
    if (m.cmd === "export") exportSetlist(); else if (m.cmd === "import") importPackage(); else if (m.cmd === "importAbleton") importAbleton().catch((e) => page().toast(String(e)));
    else if (m.cmd === "dupSetlist") page().setlistCmd("dup"); else if (m.cmd === "cleanUp") cleanUpAudio();
    else if (m.cmd === "about") showAbout();
    else if (m.cmd === "retryShow") retryStartShow();
    else if (m.cmd === "prefs") preferences();
    else if (m.cmd === "prefsAudio") page().openSettings("audio");
    else if (m.cmd === "openBackup") openBackup();
    else if (m.cmd === "copyDiagnostics") diagnostics("copy"); else if (m.cmd === "saveDiagnostics") diagnostics("save");
    else if (m.cmd === "new") page().setlistCmd("new");
    else if (m.cmd === "quit") { SL.call("quitAnswered").catch(() => {}); quitApp(); } // the last change goes to disk first
  });

  const info = await SL.call<{ roundTrip?: { in: string; out: string }; testScript?: string; reopenLast?: boolean }>("getAppInfo");
  // Session: carry on with the one from before a page switch, else this is a new, unsaved session.
  let showProblem = "", keptSession = false;
  try {
    const kept = JSON.parse(sessionStorage.getItem("setline.session") || "null");
    if (kept && kept.text) { doc = kept.doc; lib = kept.lib || null; applySession(kept.text); keptSession = true; }
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


  // Test hook (--session-roundtrip): open a file and write it back exactly as the page holds it.
  if (info.roundTrip) {
    const r = await SL.call<{ text: string }>("roundTripRead");
    doc = { name: "roundtrip", savedText: "" };
    applySession(r.text);
    await SL.call("roundTripDone", { text: sessionText() });
    return;
  }

  // Start-up (6f): the last library and setlist (tests: only when a script asks, hooks.openLibrary). A page switch
  // keeps what's on screen, and the library it belongs to: what's on disk is the baseline for the next autosave.
  if (keptSession && lib) {
    const r = await SL.call<{ text?: string; error?: string }>("libraryOpen", { name: lib.name }).catch(() => ({} as { text?: string }));
    if (r.text) libWritten = libFiles(r.text); else lib = null;
  } else if (!keptSession && !showProblem && (!info.testScript || info.reopenLast)) {
    showProblem = await openAtStart();
  }
  try { listen = await SL.call<ListenState>("getListen"); page().setListen(listen, listenWhat()); } catch (e) { console.warn("set.Line: listen", e); }
  onSetup(await SL.call<Setup>("getAudioSetup"));
  // 7a: the computer's voices list in the background (slow on some Macs); the set.Line voices come with voiceModel
  const tv = performance.now();
  SL.call<VoiceInfo[]>("getVoices").then((l) => { page().setVoices(l); SL.call("startupMark", { name: "computer voices listed", took: performance.now() - tv }).catch(() => {}); }).catch((e) => console.warn("set.Line: voices", e));
  // (a new show taking the Kokoro default voice is not an edit: an untouched session stays "saved")
  try { const clean = !isDirty(); page().setVoiceModel(await SL.call<VoiceModel>("voiceModel")); if (clean) doc.savedText = sessionText(); } catch (e) { console.warn("set.Line: voice model", e); }
  prepareCues();
  showStatus(await SL.call<Stats>("getEngineStats"));

  // Coming back to this page while a song plays (pages reload when you switch tabs): follow it.
  try {
    const st = await SL.call<Transport>("getTransport");
    const s = st.playing ? page().songs.find((x) => (st.songId ? x.id === st.songId : x.name === st.song)) : undefined;
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
  // 6g: the band's screens (tests start the server themselves, on their own port: hooks.bandStart)
  bandHost = startBandHost(SL, page);
  (window as any).SLBandHost = bandHost;
  SL.on("midiReconnected", (m: { reconnected: string[] }) => page().midiReconnected(m.reconnected || []));
  // 7c: footswitches / controllers (MidiControl.h)
  SL.on("midiAction", (m: any) => (page() as any).midiAction(m));
  SL.on("updateProgress", (m: { done: number }) => { const u = (window as any).SLUpd; if (u) { u.state().pct = m.done; const st = u.state(); if (st.draw) st.draw(); } });
  // 7d: the backup rig
  SL.on("rigState", (st: any) => { if (st && st.t === "st") rigFollow(st); });
  SL.on("rigCommand", (c: any) => { rigCommand(c).catch(() => {}); });
  SL.on("rigLost", (m: any) => (page() as any).rigLost(m));
  SL.on("rigBack", () => (page() as any).rigBack());
  SL.on("rigPaired", (m: any) => (page() as any).rigPaired(m));
  SL.on("rigLibrary", (l: any) => (page() as any).rigLibrary(l));
  SL.on("rigProgress", (m: any) => (page() as any).rigProgress(m));
  SL.on("rigPackage", (m: { path: string }) => { importPackage(m.path, async (rows: any[]) => { const d: Record<string, string> = {}; rows.forEach((x) => (d[x.id] = "theirs")); return d; }).then(() => page().toast("Setlist received from the primary")).catch(() => {}); });
  setInterval(() => { SL.call<any>("rigInfo").then((ri) => { (page() as any).rigInfo(ri); if (ri.role === "backup" && ri.paired) rigPushLibrary(); }).catch(() => {}); }, 1000);
  SL.on("midiIn", (m: any) => (page() as any).midiIn(m));
  SL.on("midiLearned", (m: any) => (page() as any).midiLearned(m));
  SL.call<{ list: any[]; inputs: string[] }>("midiMappings").then((r) => (page() as any).setMidiMap(r.list, r.inputs)).catch(() => {});
  if (!info.testScript) SL.call<{ error?: string }>("bandStart", {}).then((r) => { if (r && r.error) SL.call("logLine", { text: "Band server: " + r.error }); page().band.info(r); }).catch(() => {});
  await reportLoading(showProblem, !!info.testScript);
  if (!info.testScript && lib) offerMigration().catch((e) => console.warn("set.Line: migration", e));
  // 8d: set.Line closed unexpectedly while playing last time: offer to resume where it was (tests call it themselves)
  if (!info.testScript && lib) setTimeout(() => { const r = (window as any).SLResume; if (r) r.check().catch(() => {}); }, 600);
  // Test hook (--test-script): run an async script with the page and this module's functions; write its result.
  if (info.testScript) {
    let out: unknown;
    try {
      const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
      const hooks = { SLE, page, importStems, probe, audioFiles, applyRefMap, checkAudio, onFileDrag, sessionText, applySession,
        getRate: () => sessionRate, openPath: (p: string) => openPath(p), retryStartShow: () => retryStartShow(), docName: () => doc.name, saveTo: (path: string) => saveSession(false, path), cueList: () => cueList(), setListen: (r: Partial<ListenState>) => setListen(r), SLR: window.SLR, SLW, waves, SLC, prepareCues, remember, payload, toBarBeat, toTime, getNext: () => nextMeta, getLoaded: () => ({ id: loadedSongId, ver: curVerId, map: curMap }), isDirty: () => (lib ? sessionText() !== libText : sessionText() !== doc.savedText), setDoc: (n: string) => { doc = { name: n, savedText: "" }; },
        // 6f: the Library
        openLibrary: (n = "", empty?: boolean) => openLibrary(n, empty), libSave: () => libSave(), lib: () => lib, libFiles, exportSetlist: (id?: string, to?: string) => exportSetlist(id, to), exportText,
        bandStart: (port: number) => SL.call("bandStart", { port, test: true }), rigFollow: (st: any) => rigFollow(st), rigSendSetlist: () => rigSendSetlist(), bandHost: () => bandHost,
        importPackage: (p: string, choose?: any) => importPackage(p, choose), importAbleton: (p: string, choose?: any, mode?: string, choices?: any) => importAbleton(p, choose, mode, choices), migrateShows: (paths: string[]) => migrateShows(paths), restoreBackup: (p: string, how: "replace" | "new") => restoreBackup(p, how), switchLibrary: (n: string) => switchLibrary(n), offerMigration: () => offerMigration() };
      out = await new AsyncFn("SL", "hooks", info.testScript)(SL, hooks);
    } catch (e) { out = { error: String((e as Error)?.stack || e) }; }
    if (out !== undefined) await SL.call("testDone", { text: JSON.stringify(out, null, 1) }); // undefined: it went to another page
  }
}

main().catch((e) => { console.error("set.Line edit page:", e); SL.call("logLine", { text: "Page start-up failed: " + String((e && (e as Error).stack) || e) }).catch(() => {}); });
