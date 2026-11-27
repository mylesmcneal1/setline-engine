// 9e: the song timeline as one grid, in headless Chrome at 1280x800 (the band's 2015 MacBook): one song open, and
// two songs open in Folders. Scrolls down 3 screens and sideways 50 bars, zooms in and out at the pointer, and checks
// that the ruler, time signature, tempo and sections rows and every lane line up (±1 px), the headers never move,
// there's no dead column and the top rows stay pinned (tests/timeline-check.js); then the Time signature row, track
// heights, Fit tracks / Fit all, cue labels and the macOS 12 colour fallback (tests/timeline-sizes.js). No dependencies.
//   node tests/ui-timeline.mjs [--shots <dir>] [--only song,10a]     (CHROME=<path> to pick the browser)
// The suites: tests/ui-suites.mjs (10a and later phases too). The same suites run in WebKit: tests/ui-webkit.mjs.
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pick, suiteCode } from "./ui-suites.mjs";

const root = resolve(import.meta.dirname, "../ui/dist");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
if (!existsSync(join(root, "1-arrange.html"))) { console.error("ui/dist not built (cd ui && npm run build)"); process.exit(2); }
const browsers = process.env.CHROME ? [process.env.CHROME] : [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
].filter((p) => existsSync(p));
const chrome = browsers[0];
if (!chrome) { console.log("UI TIMELINE SKIPPED (no Chrome found)"); process.exit(0); }
const suites = pick(args);

// ---- a static server for ui/dist
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  let p, body; try { const pn = decodeURIComponent(new URL(req.url, "http://x").pathname); p = pn === "/demo13.js" ? join(import.meta.dirname, "fixtures/demo13.js") : join(root, pn); body = await readFile(p); } /* 13 §20: the example songs are the tests' own */ catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/1-arrange.html`;

// ---- Chrome
const prof = await mkdtemp(join(tmpdir(), "sl-ui-"));
// (a fresh CI runner can take well over 10 s to start Chrome the first time: wait up to 30 s, then try the next
//  browser, and print what the browser said if none starts)
let proc = null, port = 0, said = "";
for (const exe of browsers) {
  for (let attempt = 0; attempt < 2 && !port; attempt++) {
    const dir = attempt || exe !== chrome ? await mkdtemp(join(tmpdir(), "sl-ui-")) : prof;
    proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    let exited = false; proc.on("exit", () => { exited = true; }); proc.stderr.on("data", (d) => { said = (said + d).slice(-2000); });
    for (let i = 0; i < 300 && !port && !exited; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = +(await readFile(join(dir, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch {} }
    if (!port) { console.log(`(${exe} didn't start${exited ? ": it exited" : " in 30 s"}; trying again)`); try { proc.kill(); } catch {} }
  }
  if (port) break;
}
if (!port) { console.error("Chrome didn't start\n" + said); process.exit(2); }
const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const waiters = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) for (const w of [...waiters]) if (w.ev === d.method) { waiters.splice(waiters.indexOf(w), 1); w.fn(d.params); } };
const cdp = (method, params = {}) => new Promise((r, j) => { const id = ++seq; pending.set(id, (d) => d.error ? j(new Error(method + ": " + d.error.message)) : r(d.result)); ws.send(JSON.stringify({ id, method, params })); });
const once = (ev) => new Promise((fn) => waiters.push({ ev, fn }));
const evaluate = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
await cdp("Page.enable"); await cdp("Runtime.enable");

let fails = 0;
if (shots) await mkdir(shots, { recursive: true });
for (const suite of suites) {
  const mode = suite.name;
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const loaded = once("Page.loadEventFired");
  await cdp("Page.navigate", { url: base + "?demo&timeline=" + Date.now() });
  await loaded;
  await evaluate(`await new Promise(r=>setTimeout(r,600));`);
  let r;
  try { r = await evaluate(await suiteCode(suite)); } catch (e) { r = { problems: ["error: " + e.message.split("\n")[0]], log: [] }; }
  console.log(`${r.problems.length ? "FAIL" : "ok  "} 1280x800 ${mode}`);
  for (const l of r.log) console.log("      " + l);
  for (const p of r.problems.slice(0, 12)) console.log("   !! " + p);
  if (r.problems.length) fails++;
  if (shots) { const s = await cdp("Page.captureScreenshot", { format: "png" }); await writeFile(join(shots, `timeline-${mode}.png`), Buffer.from(s.data, "base64")); }
}
ws.close(); proc.kill(); server.close();
await rm(prof, { recursive: true, force: true }).catch(() => {});
console.log(fails ? `UI TIMELINE FAILED (${fails})` : "UI TIMELINE OK");
process.exit(fails ? 1 : 0);
