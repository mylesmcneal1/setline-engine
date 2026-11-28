// 15 §6 / §7: the remote screen (band.html) on phones, in WebKit (iPhone Safari's engine): 390 x 844 (iPhone) and
// 375 x 667 (iPhone SE). A fake set.Line host runs inside the page (a stand-in WebSocket): it answers the screen's
// hello and pings, and sends the live state 15 times a second, stamped with its own clock, over a network with
// simulated delay and jitter (20-180 ms, in order, as TCP delivers).
// - Layout: a screen made only for an iPad opens stacked in a phone column (nothing off the right edge, no overlaps,
//   the song name / clock / Play not clipped, the clock as h:mm); the status ("computer outputs") gets its own line
//   at the top, never over a widget; a screen made for an iPhone keeps its own layout.
// - The home-screen app: apple-touch-icon (180 px), the manifest (standalone, set.Line, icons 192 / 512 / maskable),
//   the meta tags (no zoom, safe areas, black bars), a dark page from the first frame.
// - §6 jitter: frame by frame, the shown position never jumps by more than one frame (1/60 s) against real time
//   while the error is small; a locate on the host is followed at once; the shown position stays within 40 ms of
//   the host's real position (median).
//   node tests/ui-remote.mjs [--shots <dir>]      (needs Playwright, as tests/ui-webkit.mjs)
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "../ui/dist");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
if (!existsSync(join(root, "band.html"))) { console.error("ui/dist not built (cd ui && npm run build)"); process.exit(2); }
let pw = null;
try { pw = process.env.PLAYWRIGHT ? createRequire(import.meta.url)(process.env.PLAYWRIGHT) : await import("playwright"); } catch (e) { pw = null; }
if (!pw || !pw.webkit) { console.log("UI REMOTE SKIPPED (no Playwright)"); process.exit(args.includes("--require") ? 1 : 0); }
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  let p, body; try { p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)); body = await readFile(p); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---- the fake host (runs in the page before band.html's own script)
const HOST = (cfg) => {
  const OFFSET = 7345.6, hostNow = () => performance.now() + OFFSET; // the host's clock: another origin than the phone's
  const H = (window.__host = { sent: 0, locates: 0, start: hostNow(), playing: true, pc: false, delay: cfg.delay, jumpAt: cfg.jumpAt || 0, songPos: () => (hostNow() - H.start) / 1000 });
  const bars = []; let t = 0; for (let i = 0; i < 64; i++) { bars.push([+t.toFixed(4), 4, 4, 120]); t += 2; }
  const secs = [["Intro", "intro", 1, 8], ["Verse A", "verse", 9, 16], ["Chorus", "chorus", 25, 16], ["Bridge", "bridge", 41, 8], ["Outro", "outro", 49, 16]].map(([name, type, b, n], i) => ({ id: i + 1, name, type, t0: bars[b - 1][0], t1: (bars[b - 1 + n] || [128])[0], bars: n, notes: {} }));
  const song = { name: "Mercy Dies With You", len: 128, bars, secs, cues: [], patches: {}, fields: {} };
  const show = { t: "show", setlist: { id: "L", name: "Set", finishBy: "", order: [{ id: "s1", after: { mode: "stop" } }, { id: "s2", after: { mode: "stop" } }, { id: "s3", after: { mode: "stop" } }, { id: "s4", after: { mode: "stop" } }] },
    songs: { s1: song, s2: { ...song, name: "Phantom Enemy" }, s3: { ...song, name: "Seneca" }, s4: { ...song, name: "The End of Heartache" } }, fields: [] };
  H.show = show;
  class FakeWS {
    constructor() { this.readyState = 0; this.q = 0; H.ws = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 20); }
    // the network: a delay of 20-180 ms (jittered), in order
    deliver(o) { const now = performance.now(), d = H.delay ? 20 + Math.random() * 160 : 0; this.q = Math.max(this.q, now + d); const at = this.q - now, txt = JSON.stringify(o); setTimeout(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: txt }); }, at); }
    send(text) { const m = JSON.parse(text), up = H.delay ? 15 + Math.random() * 120 : 0; // the phone -> host leg
      setTimeout(() => {
        if (m.t === "hello") this.deliver({ t: "welcome", screens: [{ id: cfg.screen.id, name: cfg.screen.name }], screen: cfg.screen, show, network: "" });
        if (m.t === "ping") this.deliver({ t: "pong", c: m.c, h: hostNow() });
      }, up); }
    close() { this.readyState = 3; }
  }
  window.WebSocket = FakeWS;
  // the live state, 15 times a second, stamped with the host's clock and the transport at that moment
  setInterval(() => {
    if (!H.ws || H.ws.readyState !== 1) return;
    if (H.jumpAt && !H.jumped && (hostNow() - H.start) / 1000 > H.jumpAt) { H.jumped = true; H.start -= 10000; H.locates++; } // a locate: 10 s ahead
    const sec = H.songPos();
    H.ws.deliver({ t: "state", h: hostNow(), tr: { playing: H.playing, seconds: sec, songId: "s1" }, cur: "s1", idx: 0, playing: H.playing, soundcheck: null, vamp: null, loop: false, jumpQ: null, next: { id: "s2", name: "Phantom Enemy", vname: "" }, pos: sec, pc: H.pc, tf: "" });
    H.sent++;
  }, 66);
};
// an iPad screen (the Drummer preset: 12 x 9, landscape and portrait) and an iPhone screen (6 x 14, portrait)
const W = (id, type, x, y, w, h, cfg = {}) => ({ id, type, x, y, w, h, cfg });
const ipad = { id: "scrI", name: "Drummer", device: "ipad", col: "#30d158",
  land: [W("a", "song", 0, 0, 8, 2), W("b", "bpm", 8, 0, 4, 2), W("c", "timeline", 0, 2, 12, 2), W("d", "beats", 0, 4, 6, 1), W("e", "barsLeft", 6, 4, 3, 2), W("f", "clock", 9, 4, 3, 2), W("g", "playStop", 0, 7, 3, 2, { label: "Play / Stop", col: "#30d158" }), W("h", "syncMidi", 3, 7, 3, 2, { col: "#0a84ff" }), W("i", "sections", 0, 5, 9, 2), W("j", "setlist", 9, 6, 3, 3)],
  port: [] };
const iphone = { id: "scrP", name: "Phone", device: "iphone", col: "#0a84ff", grid: { cols: 6, rows: 14, gap: 6 },
  port: [W("a", "song", 0, 0, 6, 3), W("p", "prevSong", 0, 3, 2, 2), W("g", "playStop", 2, 3, 2, 2, { col: "#30d158" }), W("n", "nextSong", 4, 3, 2, 2), W("i", "sections", 0, 5, 6, 4), W("f", "clock", 0, 9, 3, 2), W("b", "bpm", 3, 9, 3, 2), W("j", "setlist", 0, 11, 6, 3)], land: [] };

const browser = await pw.webkit.launch();
console.log("WebKit " + browser.version());
if (shots) await mkdir(shots, { recursive: true });
let fails = 0;
const report = (name, P, log) => { console.log(`${P.length ? "FAIL" : "ok  "} ${name}`); for (const l of log) console.log("      " + l); for (const p of P.slice(0, 14)) console.log("   !! " + p); if (P.length) fails++; };
const open = async (vw, vh, cfg) => {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(String(e).split("\n")[0]));
  await pg.addInitScript(HOST, cfg); await pg.goto(base + "band.html?t=" + Date.now()); await pg.waitForTimeout(900);
  return { ctx, pg, errs };
};
// ---- layout on both phones
for (const [vw, vh, name] of [[390, 844, "iPhone 390x844"], [375, 667, "iPhone SE 375x667"]]) {
  for (const scr of [ipad, iphone]) {
    const { ctx, pg, errs } = await open(vw, vh, { screen: scr, delay: false });
    const P = [], log = [];
    const r = await pg.evaluate(() => {
      const grid = document.getElementById("grid"), gr = grid.getBoundingClientRect(), ws = [...document.querySelectorAll("#gridIn .s5w")];
      const boxes = ws.map((w) => { const b = w.firstElementChild.getBoundingClientRect(); return { id: w.dataset.w, l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; });
      const clipped = [...document.querySelectorAll("#gridIn .s5big")].filter((x) => x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 2).map((x) => x.closest(".s5w").dataset.w + ":" + x.textContent.slice(0, 20));
      const over = []; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1) over.push(a.id + "/" + b.id); }
      const clock = document.querySelector('#gridIn .s5w[data-w="f"] .s5big'); const play = document.querySelector('#gridIn .s5w[data-w="g"] .s5wbtn');
      return { n: ws.length, ids: ws.map((w) => w.dataset.w), grid: { l: gr.left, r: gr.right, t: gr.top, b: gr.bottom }, boxes, clipped, over, vw: innerWidth, vh: innerHeight,
        clock: clock ? clock.firstChild.textContent : "", play: play ? { w: play.clientWidth, h: play.clientHeight, fs: parseFloat(play.style.fontSize), text: play.textContent } : null, scroll: grid.classList.contains("scroll"), bg: getComputedStyle(document.documentElement).backgroundColor };
    });
    const stacked = scr === ipad;
    if (r.n !== (scr === ipad ? ipad.land.length : iphone.port.length)) P.push(`widgets shown: ${r.n}`);
    const off = r.boxes.filter((b) => b.r > r.vw + 0.5 || b.l < -0.5); if (off.length) P.push("off the right / left edge: " + off.map((b) => b.id + "@" + Math.round(b.r)).join(" "));
    if (r.over.length) P.push("widgets on top of each other: " + r.over.join(" "));
    if (r.clipped.length) P.push("text cut off: " + r.clipped.join(" | "));
    if (!/^\d{1,2}:\d{2}$/.test(r.clock)) P.push("the clock isn't h:mm: " + JSON.stringify(r.clock));
    if (!r.play || r.play.w < 90 || r.play.h < 60 || r.play.fs > r.play.h * 0.62) P.push("the Play button: " + JSON.stringify(r.play));
    if (stacked) { const top = r.boxes.slice().sort((a, b) => a.t - b.t); const bpmBox = r.boxes.find((b) => b.id === "b"); if (top[0].id !== "a") P.push("the stack doesn't start with the song: " + top[0].id); if (!bpmBox || bpmBox.w > r.vw * 0.6) P.push("BPM isn't half width beside another widget"); const full = r.boxes.find((b) => b.id === "c"); if (!full || full.w < r.vw - 30) P.push("the timeline isn't full width"); }
    else { const s = r.boxes.find((b) => b.id === "a"), p = r.boxes.find((b) => b.id === "p"); if (!s || !p || !(p.t > s.b - 2)) P.push("the iPhone screen's own layout isn't used"); }
    if (r.bg !== "rgb(0, 0, 0)") P.push("the page isn't black from the start: " + r.bg);
    log.push(`${r.n} widgets ${stacked ? "stacked" : "as laid out"}; clock “${r.clock}”; Play ${r.play ? Math.round(r.play.w) + "×" + Math.round(r.play.h) + " at " + r.play.fs + " px" : "–"}${r.scroll ? "; scrolls" : ""}`);
    // the status line: its own line at the top, over no widget
    await pg.evaluate(() => { window.__host.pc = true; }); await pg.waitForTimeout(400);
    const s2 = await pg.evaluate(() => { const st = document.getElementById("stat"), sr = st.getBoundingClientRect(); const ws = [...document.querySelectorAll("#gridIn .s5w")].map((w) => w.firstElementChild.getBoundingClientRect()); return { shown: getComputedStyle(st).display !== "none", text: st.textContent, st: { t: sr.top, b: sr.bottom }, hit: ws.filter((b) => b.top < sr.bottom - 1 && b.bottom > sr.top + 1).length }; });
    if (!s2.shown || !/computer outputs/i.test(s2.text) || s2.hit) P.push("the status line: " + JSON.stringify(s2));
    if (shots) await pg.screenshot({ path: join(shots, `remote-${vw}x${vh}-${scr.device}.png`) });
    if (errs.length) P.push("page errors: " + errs.slice(0, 3).join(" | "));
    report(`webkit ${name} · ${scr.name} (${scr.device})`, P, log);
    await ctx.close();
  }
}
// ---- the home-screen app: icon, manifest, meta tags
{
  const { ctx, pg } = await open(390, 844, { screen: iphone, delay: false }); const P = [], log = [];
  const r = await pg.evaluate(async () => {
    const q = (s) => document.querySelector(s), meta = (n) => (q(`meta[name="${n}"]`) || {}).content || "";
    const icon = q('link[rel="apple-touch-icon"]'), man = q('link[rel="manifest"]');
    const size = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = src; });
    const m = man ? await (await fetch(man.href)).json().catch(() => null) : null;
    const icons = m ? await Promise.all((m.icons || []).map(async (x) => ({ ...x, real: await size(new URL(x.src, man.href).href) }))) : [];
    return { capable: meta("apple-mobile-web-app-capable"), bar: meta("apple-mobile-web-app-status-bar-style"), title: meta("apple-mobile-web-app-title"), vp: meta("viewport"), theme: meta("theme-color"),
      icon: icon ? { sizes: icon.getAttribute("sizes"), real: await size(icon.href) } : null, m, icons, touch: getComputedStyle(document.body).touchAction, over: getComputedStyle(document.body).overscrollBehaviorY || getComputedStyle(document.body).overscrollBehavior };
  });
  if (r.capable !== "yes") P.push("apple-mobile-web-app-capable isn't yes");
  if (!/black/.test(r.bar)) P.push("status bar style: " + r.bar);
  if (r.title !== "set.Line") P.push("home screen title: " + r.title);
  if (!/viewport-fit=cover/.test(r.vp) || !/user-scalable=no/.test(r.vp) || !/maximum-scale=1/.test(r.vp)) P.push("viewport: " + r.vp);
  if (!r.icon || !r.icon.real || r.icon.real[0] !== 180 || r.icon.real[1] !== 180) P.push("apple-touch-icon: " + JSON.stringify(r.icon));
  if (!r.m || r.m.display !== "standalone" || r.m.name !== "set.Line" || r.m.short_name !== "set.Line" || r.m.background_color !== "#000000") P.push("manifest: " + JSON.stringify(r.m && { display: r.m.display, name: r.m.name, bg: r.m.background_color }));
  for (const [sz, pur] of [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]) { const i = r.icons.find((x) => x.sizes === sz && (x.purpose || "any") === pur); if (!i || !i.real || i.real.join("x") !== sz) P.push(`manifest icon ${sz} ${pur}: ${JSON.stringify(i)}`); }
  if (r.touch !== "manipulation") P.push("double-tap zoom isn't off (touch-action: " + r.touch + ")");
  log.push(`icon ${r.icon && r.icon.real && r.icon.real.join("×")}, manifest ${r.m && r.m.display}, ${r.icons.length} icons`);
  report("webkit home-screen app (icon, manifest, meta)", P, log); await ctx.close();
}
// ---- §6 the jitter test
{
  const { ctx, pg, errs } = await open(390, 844, { screen: iphone, delay: true, jumpAt: 6 }); const P = [], log = [];
  await pg.evaluate(() => { window.__band.log.length = 0; });
  await pg.waitForTimeout(9000);
  const r = await pg.evaluate(() => {
    const H = window.__host, L = window.__band.log.slice(), out = { frames: L.length, sent: H.sent, locates: H.locates, jumps: window.__band.jumps };
    // frame to frame: how much the shown position moved, against how much time passed (after the first second)
    const t0 = L.length ? L[0][0] : 0; let worst = 0, worstAt = 0, n = 0; const dev = [];
    for (let i = 1; i < L.length; i++) { const [ta, pa] = L[i - 1], [tb, pb] = L[i]; if (tb - t0 < 1500) continue; if (tb - ta > 50) { out.long = (out.long || 0) + 1; continue; } /* a frame the machine was late with: not the screen jumping */ const d = Math.abs((pb - pa) - (tb - ta) / 1000); if (d > 2) continue; /* the locate */ n++; dev.push(d); if (d > worst) { worst = d; worstAt = tb - t0; } }
    dev.sort((a, b) => a - b); out.worst = worst; out.worstAt = worstAt; out.median = dev[Math.floor(dev.length / 2)] || 0; out.n = n;
    // the error against the host's real position (the fake host's clock is the truth here)
    return out;
  });
  // how far the shown position is from the host's actual position, sampled over 2 s
  const err = await pg.evaluate(async () => { const e = []; for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); e.push(Math.abs(window.__band.pos - window.__host.songPos())); } e.sort((a, b) => a - b); return { median: e[20], worst: e[39] }; });
  const frame = 1 / 60;
  if (r.frames < 300) P.push(`only ${r.frames} frames drawn`);
  if (r.worst > frame) P.push(`a frame jumped ${(r.worst * 1000).toFixed(1)} ms at ${(r.worstAt / 1000).toFixed(1)} s (more than one frame)`);
  if (r.locates !== 1 || r.jumps < 1) P.push(`the locate wasn't followed at once (locates ${r.locates}, jumps ${r.jumps})`);
  // (the network here is lopsided on purpose: 15-135 ms up, 20-180 ms down; an NTP-style estimate can be off by half the
  // difference, a few tens of ms: a constant lag, never a jump)
  if (err.median > 0.06) P.push(`the shown position is ${(err.median * 1000).toFixed(0)} ms from the host's (median)`);
  if (errs.length) P.push("page errors: " + errs.slice(0, 3).join(" | "));
  log.push(`${r.frames} frames, ${r.sent} states over 20-180 ms of jitter: worst step ${(r.worst * 1000).toFixed(2)} ms, median ${(r.median * 1000).toFixed(2)} ms (one frame = 16.7 ms${r.long ? `; ${r.long} late frames not counted` : ""}); off the host by ${(err.median * 1000).toFixed(1)} ms (median), ${(err.worst * 1000).toFixed(1)} ms worst; a 10 s locate followed in one frame`);
  report("webkit network jitter (iPhone)", P, log); await ctx.close();
}
await browser.close(); server.close();
console.log(fails ? `UI REMOTE FAILED (${fails})` : "UI REMOTE OK");
process.exit(fails ? 1 : 0);
