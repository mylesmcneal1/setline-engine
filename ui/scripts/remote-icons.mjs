// 15 §7: the remote screens' home-screen icons, from the app icon's own artwork (assets/brand/setline-icon.svg), so a
// phone's home screen shows the same set.Line icon as the Mac and Windows app.
//   node ui/scripts/remote-icons.mjs        (needs Playwright: PLAYWRIGHT=<path to the playwright package>)
// Writes ui/public/remote/: apple-touch-icon.png (180, full bleed: iOS rounds the corners itself), icon-192.png and
// icon-512.png (the rounded icon, as on the desktop), icon-maskable-512.png (full bleed, the artwork inside the 80 %
// safe zone), favicon-32.png. The PNGs are committed; run this again only if the artwork changes.
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const here = import.meta.dirname, root = resolve(here, "../..");
const svg = await readFile(join(root, "assets/brand/setline-icon.svg"), "utf8");
const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect width="100" height="100" rx="23" fill="#16191e"\/>/, "");
if (inner.includes('rx="23"')) throw new Error("unexpected icon artwork");
const BG = "#16191e";
// full: the artwork on a square background; rounded: as the app icon; scale: the artwork's size inside the square
const make = (rounded, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" ${rounded ? 'rx="23"' : ""} fill="${BG}"/><g transform="translate(${50 - 50 * scale} ${50 - 50 * scale}) scale(${scale})">${inner}</g></svg>`;
const out = join(root, "ui/public/remote"); await mkdir(out, { recursive: true });
const pw = process.env.PLAYWRIGHT ? createRequire(import.meta.url)(process.env.PLAYWRIGHT) : await import("playwright");
const b = await pw.chromium.launch(process.env.CHANNEL ? { channel: process.env.CHANNEL } : {}); const pg = await b.newPage();
for (const [name, size, rounded, scale] of [["apple-touch-icon.png", 180, false, 1], ["icon-192.png", 192, true, 1], ["icon-512.png", 512, true, 1], ["icon-maskable-512.png", 512, false, 0.8], ["favicon-32.png", 32, true, 1]]) {
  await pg.setViewportSize({ width: size, height: size });
  await pg.setContent(`<html><body style="margin:0;background:transparent">${make(rounded, scale).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await pg.screenshot({ path: join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote", name);
}
await b.close();
