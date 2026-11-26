// set.Line band screens (6g): the web app on the band's phones and tablets (band.html, served by set.Line).
// One WebSocket to the host; reconnects by itself (backoff); the clock is synced every few seconds (NTP-style, the
// median of the last 8); between the host's updates (15 a second) everything that moves (beat lights, bars left,
// countdowns) is predicted from the synced clock and the setlist's bars, so a laggy Wi-Fi device still flashes on
// the beat. It shows one screen's layout (12 x 9 grid, landscape or portrait); its buttons only do what they do.
import * as L from "./logic.js";

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const clock = new L.ClockSync();
let ws: WebSocket | null = null, connected = false, backoff = 500, everConnected = false;
let screens: any[] = [], screen: any = null, show: any = null, state: any = null, network = "";
let statuses: { from: string; label: string; screen: string }[] = [];
const myStatus: Record<string, boolean> = {};
let checklist: Record<string, boolean> = {}, checklistSong: string | null = null;
const acks: Record<string, string> = {};
let confirmAsk: { w: string; until: number } | null = null;
let pinNeeded = false;
const store = { get screen() { return localStorage.getItem("setline.band.screen") || ""; }, set screen(v: string) { localStorage.setItem("setline.band.screen", v || ""); },
  get pin() { return localStorage.getItem("setline.band.pin") || ""; }, set pin(v: string) { localStorage.setItem("setline.band.pin", v || ""); } };
// ?screen=<id> picks the screen (a link per device from the Band page)
{ const q = new URLSearchParams(location.search).get("screen"); if (q) store.screen = q; }
const now = () => performance.timeOrigin + performance.now();
const hostNow = () => clock.hostNow(now());

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
    overlay();
  };
  ws.onmessage = (e) => onMessage(String(e.data));
  ws.onclose = () => { connected = false; ws = null; overlay(); retry(); };
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
    case "show": show = m; layout(); break;
    case "state": state = m; break;
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
  overlay(); layout();
}

// ---------------------------------------------------------------- overlays: reconnecting, PIN, which screen
function overlay(msg = "") {
  const o = $("ovl");
  if (!connected) {
    o.className = "show";
    o.innerHTML = `<h1>${everConnected ? "Reconnecting…" : "Connecting…"}</h1><p>${everConnected ? "The host can’t be reached. This screen comes back by itself." : "Looking for set.Line on this network."}</p>`;
    document.body.style.filter = everConnected ? "brightness(.55)" : "";
    return;
  }
  document.body.style.filter = "";
  if (pinNeeded) {
    o.className = "show";
    o.innerHTML = `<h1>Join PIN</h1><p>${esc(msg) || "This band’s screens need a PIN (Settings › Band on the host)."}</p><div class="pick"><input id="pinIn" inputmode="numeric" autocomplete="off" placeholder="PIN"><button id="pinGo">Join</button></div>`;
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

// ---------------------------------------------------------------- layout
const ori = () => (innerWidth >= innerHeight ? "land" : "port");
let built = "";
function layout() {
  const g = $("grid");
  if (!screen) { g.innerHTML = ""; built = ""; return; }
  const list = (screen[ori()] && screen[ori()].length ? screen[ori()] : screen[ori() === "land" ? "port" : "land"]) || [];
  const key = JSON.stringify(list) + ori();
  if (key === built) return;
  built = key;
  g.innerHTML = list.map((w: any) => `<div class="w" data-w="${esc(w.id)}" style="left:${(w.x / 12) * 100}%;top:${(w.y / 9) * 100}%;width:${(w.w / 12) * 100}%;height:${(w.h / 9) * 100}%"><div class="wi"></div></div>`).join("")
    || `<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--muted)">“${esc(screen.name)}” has no widgets yet: add some on the Band page.</div>`;
  g.querySelectorAll<HTMLElement>(".w").forEach((el) => { el.addEventListener("click", (e) => tap(el.dataset.w!, e)); });
  cache.clear();
}
addEventListener("resize", () => { built = ""; layout(); });

// ---------------------------------------------------------------- taps: commands, status, checklist
function widgetById(id: string) { return [...(screen?.land || []), ...(screen?.port || [])].find((w: any) => w.id === id); }
function tap(id: string, e: Event) {
  const w = widgetById(id); if (!w) return;
  const t = e.target as HTMLElement, cfg = w.cfg || {}, def = L.WIDGETS[w.type];
  wake();
  if (w.type === "status") { const b = t.closest<HTMLElement>("[data-l]"); if (!b) return; const label = b.dataset.l!; const on = !myStatus[label]; Object.keys(myStatus).forEach((k) => delete myStatus[k]); if (on) myStatus[label] = true; send({ t: "status", label, on }); return; }
  if (w.type === "checklist") { const b = t.closest<HTMLElement>("[data-i]"); if (b) { checklist[b.dataset.i!] = !checklist[b.dataset.i!]; cache.delete(id); } return; }
  if (!def || !def.cmd) return;
  let cmd = def.cmd[0], arg: any;
  if (w.type === "playStop") cmd = live().playing ? "stop" : "play";
  if (w.type === "sections") { const b = t.closest<HTMLElement>("[data-sec]"); if (!b) return; arg = +b.dataset.sec!; if (live().jumpQ === arg) { cmd = "cancelJump"; arg = undefined; } }
  if (cfg.confirm) { if (!confirmAsk || confirmAsk.w !== id || confirmAsk.until < now()) { confirmAsk = { w: id, until: now() + 3000 }; return; } confirmAsk = null; }
  send({ t: "cmd", cmd, w: id, arg });
}
let lock: any = null, tipShown = false;
async function wake() {
  try { if ("wakeLock" in navigator && !lock) { lock = await (navigator as any).wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); return; } } catch {}
  if (!("wakeLock" in navigator) && !tipShown && !localStorage.getItem("setline.band.tip")) {
    tipShown = true; localStorage.setItem("setline.band.tip", "1");
    const tip = $("tip"); tip.textContent = "Keep this screen on: iPad Settings › Display › Auto-Lock › Never (or Guided Access). Android: Settings › Display › Screen timeout."; tip.className = "show";
    setTimeout(() => (tip.className = ""), 9000);
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { lock = null; wake(); } });
document.addEventListener("pointerdown", () => wake(), { once: true });

// ---------------------------------------------------------------- rendering (every frame, predicted)
const cache = new Map<string, string>();
function put(id: string, el: HTMLElement, html: string) { if (cache.get(id) === html) return; cache.set(id, html); el.innerHTML = html; }
const live = () => state || { cur: null, idx: -1, playing: false };
function fit(text: string, wPx: number, hPx: number, lines = 1, max = 400) {
  const n = Math.max(1, String(text).length);
  return Math.max(10, Math.min(max, (hPx / lines) * 0.78, (wPx / n) * 1.75));
}
function frame() {
  requestAnimationFrame(frame);
  if (!screen) return;
  const st = live(), songId = st.cur, song = show && songId ? show.songs[songId] : null;
  // 9c: the band screens use the app's title font for song names (their own look otherwise)
  { const tf = (st as any).tf as string | undefined; if (tf && document.documentElement.dataset.tf !== tf) { document.documentElement.dataset.tf = tf; document.documentElement.style.setProperty("--title", `"${tf}", -apple-system, sans-serif`); } }
  // 9c: the show is playing on the host computer's own outputs: a small red chip on every screen
  { let c = document.getElementById("pcChip"); const on = !!(st as any).pc; if (on && !c) { c = document.createElement("div"); c.id = "pcChip"; c.textContent = "computer outputs"; c.style.cssText = "position:fixed;top:6px;right:8px;z-index:50;padding:2px 8px;border-radius:7px;border:1px solid #ff453a;background:rgba(255,69,58,.18);color:#ff8a82;font:600 12px system-ui,sans-serif;pointer-events:none"; document.body.appendChild(c); } if (c) c.style.display = on ? "" : "none"; }
  const hn = hostNow(), pos = state ? L.predictPos(state, hn) : 0;
  const bb = song ? L.barBeatAt(song, pos) : null, sec = song ? L.sectionAt(song, pos) : null, nsec = song ? L.nextSection(song, pos) : null;
  if (songId !== checklistSong) { checklist = {}; checklistSong = songId; }
  // count-in: full screen 1 2 3 4 while a Count-in section plays (if the layout has the overlay)
  const wantCount = !!(screen && [...(screen.land || []), ...(screen.port || [])].some((w: any) => w.type === "countIn"));
  const cnt = $("count");
  if (wantCount && st.playing && sec && sec.type === "count-in" && bb) { cnt.className = "show"; cnt.textContent = String(Math.floor(bb.beat)); } else cnt.className = "";
  document.querySelectorAll<HTMLElement>("#grid .w").forEach((el) => {
    const id = el.dataset.w!, w = widgetById(id); if (!w) return;
    const box = el.firstElementChild as HTMLElement, r = box.getBoundingClientRect(), cfg = w.cfg || {}, def = L.WIDGETS[w.type] || { name: w.type };
    const why = acks[id] ? `<div class="why">${esc(acks[id])}</div>` : "";
    let h = "";
    const big = (txt: string, cap = "", sub = "", lines = 1) => `${cap ? `<div class="cap">${esc(cap)}</div>` : ""}<div class="big" style="font-size:${fit(txt, r.width - 20, r.height - (cap ? 16 : 0) - (sub ? 18 : 0), lines)}px">${esc(txt)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}`;
    const ctl = (label: string, sub = "", on = false, dis = false) => { box.style.padding = "0"; box.style.background = "transparent"; const ask = confirmAsk && confirmAsk.w === id && confirmAsk.until > now();
      return `<div class="btn ${on ? "on" : ""} ${dis ? "dis" : ""} ${ask ? "ask" : ""}" style="--c:${esc(cfg.col || "#3a3a40")};font-size:${fit(label, r.width - 16, r.height * 0.55, 1, 64)}px">${esc(ask ? "Tap again" : label)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>${why}`; };
    const fieldOf = (sid: string | null | undefined, f: string) => (sid && show ? L.fieldValue(show, sid, f) : "");
    const fname = (f: string) => ((show && show.fields) || []).find((x: any) => x.id === f)?.name || "Field";
    switch (w.type) {
      case "song": h = big(song ? song.name : "No song", "", song && song.ver ? song.ver : "").replace("class=\"big\"", "class=\"big stitle\""); break; // 9c: the app's title font
      case "bpm": h = bb ? big(`${+bb.bpm.toFixed(2)}`, "BPM", `${bb.num}/${bb.den}`) : big("–", "BPM"); break;
      case "next": { const n = st.next, a = show && st.idx >= 0 ? (show.setlist.order[st.idx] || {}).after : null;
        h = big(n ? n.name : "End of set", "Next", n ? [n.vname, a ? (a.mode === "segue" ? "segue" : a.mode === "auto" ? `auto after ${a.sec || 0} s` : "stop") : ""].filter(Boolean).join(" · ") : ""); break; }
      case "timeline": h = song ? `<div class="tl">${song.secs.map((s: any) => { const on = sec && s.t0 === sec.t0, p = on ? (pos - s.t0) / Math.max(0.001, s.t1 - s.t0) : 0; return `<div class="${on ? "on" : ""} ${st.jumpQ === s.id ? "q" : ""}" style="flex:${s.bars}">${on ? `<i style="width:${(p * 100).toFixed(1)}%"></i>` : ""}<span style="position:relative">${esc(s.name)}</span></div>`; }).join("")}</div>` : big("–"); break;
      case "barsLeft": { const left = sec && bb ? Math.max(0, L.barBeatAt(song, sec.t1 - 1e-6).bar - bb.bar + 1) : null; h = big(left === null ? "–" : String(left), "Bars left", sec ? sec.name : ""); break; }
      case "beats": { const n = bb ? bb.num : 4, k = bb && st.playing ? Math.floor(bb.beat) : 0; h = `<div class="beats">${Array.from({ length: n }, (_, i) => `<i class="${i + 1 === k ? "on" : ""} ${i === 0 ? "one" : ""}"></i>`).join("")}</div>`; box.style.background = "transparent"; break; }
      case "nextSec": h = nsec && song ? big(nsec.name, "Next section", `in ${Math.max(0, L.barBeatAt(song, nsec.t0 - 1e-6).bar - (bb ? bb.bar : 1) + 1)} bars`) : big("–", "Next section"); break;
      case "countIn": h = `<div class="cap">Count-in</div><div class="sub">${sec && sec.type === "count-in" ? "now" : "full screen when it plays"}</div>`; break;
      case "changes": { const c = song ? L.changesAhead(song, pos, cfg.bars || 4) : []; h = big(c.length ? c.map((x) => x.text).join(" · ") : "No changes ahead", "Coming up"); break; }
      case "songLeft": h = big(song ? L.fmtTime(song.len - pos) : "–", "Song left"); break;
      case "setLeft": { const c = show ? L.curfew(show, st.idx, pos, Date.now(), "") : null; h = big(c ? L.fmtTime(c.leftSec) : "–", "Set left", c && c.talking ? "+ talking" : ""); break; }
      case "clock": h = big(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), "Clock"); break;
      case "curfew": { const fb = show && show.setlist.finishBy; const c = show ? L.curfew(show, st.idx, pos, Date.now(), fb) : null;
        if (!c || c.overSec === null) h = big("–", "Curfew", "no finish time set");
        else { const over = c.overSec > 0; h = `<div class="cap">Curfew ${esc(fb)}</div><div class="big" style="color:${over ? "var(--red)" : "var(--green)"};font-size:${fit("+0:00", r.width - 20, r.height - 34)}px">${over ? "+" : "−"}${L.fmtTime(Math.abs(c.overSec))}</div><div class="sub">${over ? "over" : "under"}${c.talking ? " + talking" : ""}</div>`; } break; }
      case "field": { const sid = cfg.which === "next" ? st.next && st.next.id : songId; h = big(cfg.field ? (cfg.which !== "next" && sid && show ? L.fieldValueAt(show, sid, cfg.field, st.playing ? pos : 0) : fieldOf(sid, cfg.field)) || "–" : "Pick a field", cfg.field ? fname(cfg.field) + (cfg.which === "next" ? " · next song" : "") : ""); break; }
      case "until": { if (!cfg.field) { h = big("Pick a field"); break; }
        const u = show ? L.untilNextChange(show, st.idx, st.playing ? pos : 0, cfg.field) : null;
        if (!u) { h = big("No change", fname(cfg.field), "for the rest of the set"); break; }
        const also = cfg.also ? fieldOf(u.songId, cfg.also) : "";
        h = `<div class="cap">${esc(fname(cfg.field))} → ${esc(u.value)}${also ? " · " + esc(also) : ""}</div>${(() => { const txt = u.inSec === null ? "after " + u.after : L.fmtTime(u.inSec); return `<div class="big" style="font-size:${fit(u.inSec === null ? txt : "00:00", r.width - 20, r.height - 60, 1, u.inSec === null ? 72 : 400)}px">${esc(txt)}</div>`; })()}<div class="sub">for “${esc(u.songName)}”</div><div class="bar"><i style="width:${(u.progress * 100).toFixed(1)}%"></i></div>`; break; }
      case "setlist": { if (!show) break; const u = cfg.field ? L.untilNextChange(show, st.idx, 0, cfg.field) : null;
        h = `<div class="list">${show.setlist.order.map((o: any, i: number) => { const s = show.songs[o.id]; if (!s) return ""; return `<div class="${i === st.idx ? "cur" : ""} ${u && u.index === i ? "chg" : ""}"><span>${i + 1}. ${esc(s.name)}</span><span>${cfg.field ? esc(fieldOf(o.id, cfg.field)) : L.fmtTime(s.len)}</span></div>`; }).join("")}</div>`; box.style.justifyContent = "flex-start"; break; }
      case "notes": { const role = cfg.role || "drums", t = sec && sec.notes ? sec.notes[role] || "" : ""; h = `<div class="cap">${esc(sec ? sec.name : "")} · ${esc(role)}</div><div class="big" style="white-space:normal;font-size:${fit(t || "–", (r.width - 20) * 3, r.height - 20, 3, 48)}px">${esc(t || "–")}</div>`; break; }
      case "cueFeed": { const c = song ? [...song.cues].reverse().find((x: any) => x.t <= pos && pos - x.t < 4) : null; h = big(c && st.playing ? c.text : "", "Cue"); break; }
      case "patch": { const l = song && cfg.track ? song.patches[cfg.track] || [] : []; const p = [...l].reverse().find((x: any) => x.t <= pos + 1e-3) || l[0]; h = big(p ? p.name : "–", cfg.track || "Patch"); break; }
      case "label": h = big(cfg.text || ""); break;
      case "status": { const labels = cfg.labels && cfg.labels.length ? cfg.labels : ["Ready", "Need 30 s", "Problem"]; box.style.padding = "0"; box.style.background = "transparent"; h = `<div class="stl">${labels.map((l: string) => `<button data-l="${esc(l)}" class="${myStatus[l] ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`; break; }
      case "statusShow": h = statuses.length ? `<div class="list">${statuses.map((s) => `<div><span>${esc(s.from)}</span><span style="color:var(--accent)">${esc(s.label)}</span></div>`).join("")}</div>` : big("All quiet", "Status"); break;
      case "checklist": { const items: string[] = cfg.items && cfg.items.length ? cfg.items : ["Ready"]; h = `<div class="ck">${items.map((x, i) => `<label data-i="${i}"><input type="checkbox" ${checklist[i] ? "checked" : ""} tabindex="-1">${esc(x)}</label>`).join("")}</div>`; box.style.justifyContent = "flex-start"; break; }
      case "conn": h = `<div><span class="light ${connected ? "on" : ""}"></span>${connected ? `${Math.round(clock.rtt())} ms` : "offline"}${(st as any).pc ? ` <b style="color:#ff453a;border:1px solid #ff453a;border-radius:6px;padding:1px 6px;font-size:.8em">computer outputs</b>` : ""}</div>`; break;
      case "playStop": h = ctl(cfg.label && cfg.label !== "Play / Stop" ? cfg.label : st.playing ? "Stop" : "Play", st.soundcheck ? "soundcheck" : "", st.playing); break;
      case "nextSong": h = ctl(cfg.label || "Next song", st.next ? st.next.name : ""); break;
      case "prevSong": h = ctl(cfg.label || "Previous song"); break;
      case "soundcheck": { const busy = st.playing && !st.soundcheck; const s = show && cfg.song ? (show.songs[cfg.song] || null) : null;
        h = ctl(st.soundcheck ? "Stop soundcheck" : cfg.label || "Soundcheck", busy ? "the set is playing" : s ? s.name : "", !!st.soundcheck, busy); break; }
      case "exitLoop": h = ctl(cfg.label || "Exit loop", st.loop ? "looping" : "", !!st.loop, !st.loop); break;
      case "vamp": h = ctl(cfg.label || "Vamp", st.vamp !== null && st.vamp !== undefined ? "looping this section" : sec ? sec.name : "", st.vamp !== null && st.vamp !== undefined, !st.playing); break;
      case "sections": { const secs = song ? song.secs.filter((s: any) => s.type !== "x") : []; const cols = Math.min(6, Math.max(1, secs.length)); box.style.padding = "0"; box.style.background = "transparent";
        h = `<div class="secbtns" style="grid-template-columns:repeat(${cols},1fr)">${secs.map((s: any) => `<button data-sec="${s.id}" class="${sec && sec.t0 === s.t0 ? "on" : ""} ${st.jumpQ === s.id ? "q" : ""}">${esc(s.name)}</button>`).join("")}</div>${why}`; break; }
      case "verFlip": h = ctl(cfg.label || (st.next ? st.next.name : "Next version"), st.next && st.next.vname ? st.next.vname : "", false, !st.next); break;
      case "midiBtn": h = ctl(cfg.label || "MIDI"); break;
      case "syncMidi": h = ctl(cfg.label || "Sync MIDI"); break;
      default: h = big(def.name);
    }
    put(id, box, h);
  });
}
requestAnimationFrame(frame);
connect();
overlay();
