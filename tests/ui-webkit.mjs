// The UI suites (tests/ui-suites.mjs) in WebKit, the engine of the macOS app (the show machine runs macOS 12's
// WebKit; Playwright's WebKit is the closest a CI runner gets). Each suite: ui/dist at 1280x800, a fresh page.
//   node tests/ui-webkit.mjs [--shots <dir>] [--only 10a,10b]
// Needs Playwright: `npm i --no-save playwright && npx playwright install webkit` (CI), or PLAYWRIGHT=<path to the
// playwright package>. Without it: skipped (exit 0) unless --require is given.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";
import { pick, suiteCode } from "./ui-suites.mjs";

const root = resolve(import.meta.dirname, "../ui/dist");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
if (!existsSync(join(root, "1-arrange.html"))) { console.error("ui/dist not built (cd ui && npm run build)"); process.exit(2); }
let pw = null;
try { pw = process.env.PLAYWRIGHT ? createRequire(import.meta.url)(process.env.PLAYWRIGHT) : await import("playwright"); } catch (e) { pw = null; }
if (!pw || !pw.webkit) { console.log("UI WEBKIT SKIPPED (no Playwright)"); process.exit(args.includes("--require") ? 1 : 0); }

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  let p, body; try { p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)); body = await readFile(p); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/1-arrange.html`;

const browser = await pw.webkit.launch();
console.log("WebKit " + browser.version());
if (shots) await mkdir(shots, { recursive: true });
let fails = 0;
for (const suite of pick(args)) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e).split("\n")[0]));
  // 11b: the rename suite saves a picture of each spot before and while editing (CI artifact: rename/*.png)
  if (shots) { await mkdir(join(shots, "rename"), { recursive: true }); await pg.exposeFunction("__shot", async (name, clip) => { try { await pg.screenshot({ path: join(shots, "rename", String(name).replace(/[^\w%-]+/g, "_") + ".png"), clip }); } catch (e) {} return true; }); }
  await pg.goto(base + "?webkit=" + Date.now()); await pg.waitForTimeout(800);
  let r;
  try { r = await pg.evaluate(`(async()=>{ ${await suiteCode(suite)} })()`); } catch (e) { r = { problems: ["error: " + String(e.message).split("\n")[0]], log: [] }; }
  if (errs.length) r.problems.push("page errors: " + errs.slice(0, 3).join(" | "));
  console.log(`${r.problems.length ? "FAIL" : "ok  "} webkit 1280x800 ${suite.name}`);
  for (const l of r.log) console.log("      " + l);
  for (const p of r.problems.slice(0, 14)) console.log("   !! " + p);
  if (r.problems.length) fails++;
  if (shots) await pg.screenshot({ path: join(shots, `webkit-${suite.name}.png`) });
  await pg.close();
}
await browser.close(); server.close();
console.log(fails ? `UI WEBKIT FAILED (${fails})` : "UI WEBKIT OK");
process.exit(fails ? 1 : 0);
