// set.Line remote screens (6g, 15): the web app on the band's phones and tablets (band.html, served by set.Line).
// One WebSocket to the host; reconnects by itself (backoff); the clock is synced every few seconds (NTP-style, the
// median of the last 8). 15 §6: the host stamps every state with its clock and the engine's transport; the device
// predicts where the song is from that (its own clock + the offset) and draws at 60 fps with requestAnimationFrame,
// steering the shown position gently (logic.PosSmoother) so new states and clock estimates never make it twitch.
// Only what changed is redrawn: the timeline's progress is a transform, the other widgets are rebuilt only when their
// text changes, and the ones that don't follow the song's position at most 4 times a second.
// 15 §7: a screen made for a phone fills the phone (safe areas included); a phone that opens a screen made for an iPad
// or a laptop gets the same widgets stacked in a phone column (widgets.stackLayout), never the big layout shrunk.
// Status (connection, "computer outputs") has its own line at the top, never over a widget.
import * as L from "./logic.js";
import * as W from "./widgets.js";

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const clock = new L.ClockSync();
const smooth = new L.PosSmoother();
let ws: WebSocket | null = null, connected = false, backoff = 500, everConnected = false;
let screens: any[] = [], screen: any = null, show: any = null, state: any = null, network = "", stateAt = 0;
let statuses: { from: string; label: string; screen: string }[] = [];
const myStatus: Record<string, boolean> = {};
let checklist: Record<string, boolean> = {}, checklistSong: string | null = null;
const acks: Record<string, string> = {};
let confirmAsk: { w: string; until: number } | null = null;
let pinNeeded = false;
const store = { get screen() { return localStorage.getItem("setline.band.screen") || ""; }, set screen(v: string) { localStorage.setItem("setline.band.screen", v || ""); },
  get pin() { return localStorage.getItem("setline.band.pin") || ""; }, set pin(v: string) { localStorage.setItem("setline.band.pin", v || ""); } };
// ?screen=<id> picks the screen (a link per device from the Remote page)
{ const q = new URLSearchParams(location.search).get("screen"); if (q) store.screen = q; }
const now = () => performance.timeOrigin + performance.now();
const hostNow = () => clock.hostNow(now());

// the widgets' look (shared with the Remote page's editor)
{ const st = document.createElement("style"); st.textContent = W.CSS; document.head.appendChild(st); }

// ---------------------------------------------------------------- connection
// 7d: the hosts to try: this page's own, then a backup rig's (sent by the primary), in turn while reconnecting
let tries = 0;
const hosts = () => [location.host, ...((JSON.parse(localStorage.getItem("setline.band.alt") || "[]") as string[]).filter((h) => h && h !== location.host))];
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const list = hosts(), host = list[tries++ % list.length];
  try { ws = new WebSocket(`${proto}//${host}/ws`); } catch { retry(); return; }
  ws.onopen = () => {
    connected = true; everConnected = true; backoff = 500; tries = 0;
    send({ t: "hello", screen: store.screen, pin: store.pin, device: navigator.userAgent.replace(/^.*?\(([^)]*)\).*$/, "$1").slice(0, 60) });
    for (let i = 0; i < 5; i++) setTimeout(ping, i * 150); // a quick first estimate
    overlay(); wake(); status();
  };
  ws.onmessage = (e) => onMessage(String(e.data));
  ws.onclose = () => { connected = false; ws = null; overlay(); status(); retry(); };
  ws.onerror = () => { try { ws && ws.close(); } catch {} };
}
function retry() { setTimeout(connect, backoff); backoff = hosts().length > 1 ? Math.min(1500, backoff * 1.5) : Math.min(8000, backoff * 2); } // with a backup: try it quickly
function send(o: unknown) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function ping() { send({ t: "ping", c: now() }); }
setInterval(ping, 3000);

function onMessage(text: string) {
  let m: any; try { m = JSON.parse(text); } catch { return; }
  switch (m.t) {
    case "pong": clock.add(m.c, m.h, now()); break;
    case "needPin": pinNeeded = true; if (m.wrong) store.pin = ""; overlay(m.wrong ? "That PIN isn’t right." : ""); break;
    case "welcome": pinNeeded = false; screens = m.screens || []; show = m.show; network = m.network || ""; setScreen(m.screen); break;
    case "screens": screens = m.screens || []; if (m.network !== undefined) network = m.network; if (!screen) overlay(); break;
    case "layout": setScreen(m.screen); break;
    case "assign": screens = m.screens || screens; setScreen(m.screen); break;
    case "show": show = m; built = ""; layout(); break;
    case "state": { const pc = !!(state && state.pc); state = m; stateAt = now(); if (!!m.pc !== pc) status(); break; }
    case "status":
      if (m.clear) { statuses = []; Object.keys(myStatus).forEach((k) => delete myStatus[k]); break; }
      statuses = statuses.filter((x) => x.screen !== m.screen);
      if (m.on) statuses.push({ from: m.from, label: m.label, screen: m.screen });
      break;
    case "alt": localStorage.setItem("setline.band.alt", JSON.stringify(Array.isArray(m.hosts) ? m.hosts : [])); break;
    case "ack": if (!m.ok) { acks[m.w] = m.why || "Not allowed"; setTimeout(() => { delete acks[m.w]; }, 3000); } break;
  }
}
function setScreen(s: any) {
  screen = s || null;
  if (screen) store.screen = screen.id; else store.screen = "";
  built = ""; overlay(); layout();
}

// ---------------------------------------------------------------- overlays: reconnecting, PIN, which screen
function overlay(msg = "") {
  const o = $("ovl");
  if (!connected) {
    o.className = "show";
    o.innerHTML = `<h1>${everConnected ? "Reconnecting…" : "Connecting…"}</h1><p>${everConnected ? "The host can’t be reached. This screen comes back by itself." : "Looking for set.Line on this network."}</p>`;
    $("grid").style.filter = everConnected ? "brightness(.55)" : "";
    return;
  }
  $("grid").style.filter = "";
  if (pinNeeded) {
    o.className = "show";
    o.innerHTML = `<h1>Join PIN</h1><p>${esc(msg) || "This remote screens need a PIN (Settings › Remote on the host)."}</p><div class="pick"><input id="pinIn" inputmode="numeric" autocomplete="off" placeholder="PIN"><button id="pinGo">Join</button></div>`;
    const go = () => { store.pin = (document.getElementById("pinIn") as HTMLInputElement).value.trim(); send({ t: "hello", screen: store.screen, pin: store.pin }); };
    $("pinGo").onclick = go; (document.getElementById("pinIn") as HTMLInputElement).onkeydown = (e) => { if (e.key === "Enter") go(); };
    return;
  }
  if (!screen) {
    o.className = "show";
    o.innerHTML = `<h1>Which screen is this?</h1><p>${network ? "On " + esc(network) + " · " : ""}Chosen once; set.Line remembers it on this device.</p>
      <div class="pick">${screens.map((s) => `<button data-s="${esc(s.id)}"><span class="av" style="background:${esc(s.col || "#888")}">${esc(String(s.name).slice(0, 2).toUpperCase())}</span>${esc(s.name)}</button>`).join("")}
      <input id="newScr" placeholder="New screen: its name"><button id="newGo">＋ New screen</button></div>`;
    o.querySelectorAll<HTMLElement>("[data-s]").forEach((b) => (b.onclick = () => send({ t: "pick", screen: b.dataset.s })));
    $("newGo").onclick = () => { const n = (document.getElementById("newScr") as HTMLInputElement).value.trim(); if (n) send({ t: "pick", newName: n }); };
    return;
  }
  o.className = ""; o.innerHTML = "";
}

// ---------------------------------------------------------------- the status line (15 §7: its own line, never over a widget)
function status() {
  const on = !!(state && state.pc), el = $("stat");
  const items: string[] = [];
  if (on) items.push(`<span class="pc">● Playing through computer outputs</span>`);
  el.innerHTML = items.join("");
  const had = document.body.classList.contains("stat"); document.body.classList.toggle("stat", items.length > 0);
  if (had !== items.length > 0) { built = ""; layout(); }
}

// ---------------------------------------------------------------- layout
const ori = () => (innerWidth >= innerHeight ? "land" : "port");
const phoneHere = () => Math.min(innerWidth, innerHeight) < 600;
let built = "", G = { cols: 12, rows: 9, gap: 6 }, LIST: any[] = [], STACKED = false;
// the widgets this device shows and the grid they sit in
function arrangement() {
  const mine = screen[ori()] && screen[ori()].length ? screen[ori()] : screen[ori() === "land" ? "port" : "land"] || [];
  const g = W.gridOf(screen);
  // a phone opening a screen made for something bigger: its widgets stacked in a phone column
  if (phoneHere() && !W.isPhoneScreen(screen) && mine.length) {
    const st = W.stackLayout(mine, 6), vis = ori() === "port" ? 12 : 6;
    return { list: st.list, g: { cols: 6, rows: Math.max(vis, st.rows), gap: 6 }, stacked: true, vis };
  }
  return { list: mine, g: { cols: g.cols, rows: g.rows, gap: g.gap }, stacked: false, vis: g.rows };
}
function layout() {
  const g = $("grid");
  if (!screen) { g.innerHTML = ""; built = ""; return; }
  const a = arrangement(), key = JSON.stringify([a.list, a.g, a.stacked, ori(), innerWidth, innerHeight]);
  if (key === built) return;
  built = key; G = a.g; LIST = a.list; STACKED = a.stacked;
  // a stacked column taller than the screen scrolls (the rows keep their height)
  const inner = $("gridIn");
  inner.style.height = a.g.rows > a.vis ? `${(a.g.rows / a.vis) * 100}%` : "100%";
  g.classList.toggle("scroll", a.g.rows > a.vis);
  inner.innerHTML = a.list.map((w: any) => `<div class="s5w" data-w="${esc(w.id)}" style="${W.place(w, a.g)}"><div class="s5wi" style="${W.boxStyle(w)}"></div></div>`).join("")
    || `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--muted);padding:20px;text-align:center">“${esc(screen.name)}” has no widgets yet: add some on the Remote page.</div>`;
  inner.querySelectorAll<HTMLElement>(".s5w").forEach((el) => { el.addEventListener("click", (e) => tap(el.dataset.w!, e)); el.addEventListener("pointerdown", (e) => holdStart(el.dataset.w!, e)); });
  cache.clear(); boxes.clear();
}
// 16 §4: a "hold to press" button (Hold to stop): only a hold of HOLD_MS does it; a tap does nothing (safety on stage).
// The button fills up while held; letting go early, or sliding off, cancels.
const HOLD_MS = 800;
let held: { id: string; at: number; done: boolean; timer: number } | null = null;
function holdStart(id: string, e: PointerEvent) {
  const t = e.target as HTMLElement; if (!t.closest || !t.closest("[data-hold]")) return;
  wake(); holdEnd();
  held = { id, at: now(), done: false, timer: window.setTimeout(() => { if (!held || held.id !== id) return; held.done = true; tap(id, e, true); setTimeout(holdEnd, 250); }, HOLD_MS) };
  const up = () => { removeEventListener("pointerup", up); removeEventListener("pointercancel", up); if (held && held.id === id && !held.done) holdEnd(); };
  addEventListener("pointerup", up); addEventListener("pointercancel", up);
}
function holdEnd() { if (held) clearTimeout(held.timer); held = null; }
const holdNow = (id: string) => (held && held.id === id ? Math.min(1, (now() - held.at) / HOLD_MS) : 0);
addEventListener("resize", () => { layout(); });
addEventListener("orientationchange", () => { setTimeout(layout, 200); });

// ---------------------------------------------------------------- taps: commands, status, checklist
function widgetById(id: string) { return LIST.find((w: any) => w.id === id) || [...(screen?.land || []), ...(screen?.port || [])].find((w: any) => w.id === id); }
function tap(id: string, e: Event, byHold = false) {
  const w = widgetById(id); if (!w) return;
  const t = e.target as HTMLElement, cfg = w.cfg || {}, def = L.WIDGETS[w.type];
  // a hold-to-press button: the tap itself does nothing (holdStart presses it)
  if (!byHold && t.closest && t.closest("[data-hold]")) return;
  // Play / Stop's Compact style: Play and Sync MIDI side by side
  const act = t.closest ? t.closest<HTMLElement>("[data-act]") : null;
  if (w.type === "playStop" && act && act.dataset.act === "syncMidi") { send({ t: "cmd", cmd: "syncMidi", w: id }); return; }
  if (w.type === "playStop" && W.variantOf(w) === "compact" && !act) return; // the gap between the two buttons
  wake();
  if (w.type === "status") { const b = t.closest<HTMLElement>("[data-l]"); if (!b) return; const label = b.dataset.l!; const on = !myStatus[label]; Object.keys(myStatus).forEach((k) => delete myStatus[k]); if (on) myStatus[label] = true; send({ t: "status", label, on }); cache.delete(id); return; }
  if (w.type === "checklist") { const b = t.closest<HTMLElement>("[data-i]"); if (b) { checklist[b.dataset.i!] = !checklist[b.dataset.i!]; cache.delete(id); } return; }
  if (!def || !def.cmd) return;
  let cmd = def.cmd[0], arg: any;
  if (w.type === "playStop") cmd = live().playing ? "stop" : "play";
  if (w.type === "sections") { const b = t.closest<HTMLElement>("[data-sec]"); if (!b) return; arg = +b.dataset.sec!; if (live().jumpQ === arg) { cmd = "cancelJump"; arg = undefined; } }
  if (cfg.confirm) { if (!confirmAsk || confirmAsk.w !== id || confirmAsk.until < now()) { confirmAsk = { w: id, until: now() + 3000 }; return; } confirmAsk = null; }
  send({ t: "cmd", cmd, w: id, arg });
}

// ---------------------------------------------------------------- 15 §7: a full-screen app that stays awake
// The Screen Wake Lock while connected (asked again when the page comes back); without it, a one-time tip.
let lock: any = null, tipShown = false;
async function wake() {
  if (document.visibilityState !== "visible") return;
  try { if ("wakeLock" in navigator && !lock) { lock = await (navigator as any).wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); return; } } catch {}
  if (!("wakeLock" in navigator) && !tipShown && !localStorage.getItem("setline.band.tip")) {
    tipShown = true; localStorage.setItem("setline.band.tip", "1");
    const tip = $("tip"); tip.textContent = "Keep this screen on: Settings › Display & Brightness › Auto-Lock › Never (or Guided Access). Android: Settings › Display › Screen timeout."; tip.className = "show";
    setTimeout(() => (tip.className = ""), 9000);
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { lock = null; if (connected) wake(); } });
document.addEventListener("pointerdown", () => wake(), { once: true });
// no pinch zoom, no double-tap zoom (iOS ignores user-scalable=no), no rubber-band scrolling outside a list
for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false } as any);
let lastTouch = 0;
document.addEventListener("touchend", (e) => { const t = Date.now(); if (t - lastTouch < 320) e.preventDefault(); lastTouch = t; }, { passive: false });
document.addEventListener("touchmove", (e) => { if (!(e.target as HTMLElement).closest || !(e.target as HTMLElement).closest("#grid.scroll")) e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------- rendering (every frame, predicted)
const cache = new Map<string, string>(); const boxes = new Map<string, { el: HTMLElement; box: HTMLElement; w: any; at: number; held?: boolean }>();
function put(id: string, el: HTMLElement, html: string) { if (cache.get(id) === html) return false; cache.set(id, html); el.innerHTML = html; return true; }
const live = () => state || { cur: null, idx: -1, playing: false };
// what the jitter test reads: the position shown in each frame
const probe = { pos: 0, target: 0, frames: 0, jumps: 0, log: [] as number[][] };
(window as any).__band = probe;
let lastSlow = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!screen) return;
  const st = live(), songId = st.cur, song = show && songId ? show.songs[songId] : null, t = now();
  // 9d: a break: the countdown, the note and the next song over the whole screen
  { const b = (st as any).brk; let o = document.getElementById("brkOv");
    if (b && !o) { o = document.createElement("div"); o.id = "brkOv"; o.style.cssText = "position:fixed;inset:0;z-index:40;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vh;text-align:center;padding:4vw"; document.body.appendChild(o); }
    if (o) {
      o.style.display = b ? "flex" : "none";
      if (b) {
        const l = b.paused ? b.left : b.left - Math.max(0, (hostNow() - (state ? state.h : hostNow())) / 1000);
        const m = (x: number) => { const n = x < 0; x = Math.abs(Math.round(x)); return (n ? "+" : "") + Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0"); };
        const pct = Math.max(0, Math.min(100, (1 - l / Math.max(1, b.len)) * 100)), over = l < 0;
        put("brkOv", o, `<div style="color:var(--accent);font:700 4vh system-ui;letter-spacing:.14em;text-transform:uppercase">⏸ ${esc(b.label)}</div>
          <div style="font:800 28vh/1 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;color:${over ? "#ff453a" : "#fff"}">${m(l)}</div>${over ? '<div style="color:#ff453a;font:600 3vh system-ui">over</div>' : ""}
          <div style="width:60vw;height:1.2vh;border-radius:1vh;background:#222;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent)"></div></div>
          ${b.note ? `<div style="font:500 4vh system-ui;color:#eee">${esc(b.note)}</div>` : ""}
          <div style="font:500 3vh system-ui;color:#aaa">${b.next ? `Next: <b style="color:#fff;font-family:var(--title,inherit)">${esc(b.next.name)}</b> · ${esc(b.next.bpm)} BPM${b.next.tun ? " · " + esc(b.next.tun) : ""} · ${b.auto && l > 0 ? "starts automatically" : "when ready"}` : "The end of the set"}</div>`);
      }
    } }
  // 9c: the remote screens use the app's title font for song names (their own look otherwise)
  { const tf = (st as any).tf as string | undefined; if (tf && document.documentElement.dataset.tf !== tf) { document.documentElement.dataset.tf = tf; document.documentElement.style.setProperty("--title", `"${tf}", -apple-system, sans-serif`); } }
  // §6: where the song is: predicted from the host's last state, shown smoothly
  const target = state ? L.predictPos(state, hostNow()) : 0;
  const pos = smooth.step(target, !!st.playing, String(songId || ""), t);
  probe.pos = pos; probe.target = target; probe.frames++; probe.jumps = smooth.jumps; if (probe.log.length < 4000) probe.log.push([t, pos, target]);
  const bb = song ? L.barBeatAt(song, pos) : null, sec = song ? L.sectionAt(song, pos) : null, nsec = song ? L.nextSection(song, pos) : null;
  if (songId !== checklistSong) { checklist = {}; checklistSong = songId; }
  // count-in: full screen 1 2 3 4 while a Count-in section plays (if the layout has the overlay)
  const wantCount = LIST.some((w: any) => w.type === "countIn");
  const cnt = $("count");
  if (wantCount && st.playing && sec && sec.type === "count-in" && bb) { cnt.className = "show"; cnt.textContent = String(Math.floor(bb.beat)); } else cnt.className = "";
  const slow = t - lastSlow > 250; if (slow) lastSlow = t; // the widgets that don't follow the position: 4 times a second
  const nowMs = Date.now(), confirmLive = confirmAsk && confirmAsk.until > t ? confirmAsk.w : "";
  for (const w of LIST) {
    let b = boxes.get(w.id);
    if (!b) { const el = document.querySelector<HTMLElement>(`#grid .s5w[data-w="${CSS.escape(w.id)}"]`); if (!el) continue; b = { el, box: el.firstElementChild as HTMLElement, w, at: 0 }; boxes.set(w.id, b); }
    const hold = holdNow(w.id);
    if (hold || b.held) { const hb = b.box.querySelector<HTMLElement>(".s5hold"); if (hb) hb.style.setProperty("--hold", hold.toFixed(3)); b.held = hold > 0; } // (the fill only: the button stays under the finger)
    if (!slow && !W.LIVE.has(w.type) && cache.has(w.id) && !acks[w.id] && confirmLive !== w.id) continue;
    const r = { width: b.box.clientWidth, height: b.box.clientHeight };
    const out = W.render(w, { show, st, pos, song, bb, sec, nsec, r, now: nowMs, connected, rtt: clock.rtt(), statuses, myStatus, checklist, acks, ask: confirmLive === w.id });
    if (put(w.id, b.box, out.html)) { b.box.classList.toggle("flush", !!out.flush); b.box.classList.toggle("top", !!out.top); }
    // the timeline's progress: a transform on the element already there (no rebuild, no layout)
    if (w.type === "timeline" && sec) { const p = Math.max(0, Math.min(1, (pos - sec.t0) / Math.max(0.001, sec.t1 - sec.t0))); const i = b.box.querySelector<HTMLElement>(".s5tlp"); if (i) i.style.setProperty("--p", p.toFixed(4)); }
  }
}
requestAnimationFrame(frame);
connect();
overlay();
