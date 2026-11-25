// Every inline <script> in the UI pages must parse (a broken literal there stops the whole page).
import { readFileSync } from "node:fs";
import vm from "node:vm";
let bad = 0;
for (const page of ["ui/1-arrange.html", "ui/band.html"]) {
  const html = readFileSync(new URL("../" + page, import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((code, i) => {
    try { new vm.Script(code, { filename: `${page} script ${i}` }); }
    catch (e) { bad++; console.error(`FAIL ${page} script ${i}: ${e.message}`); }
  });
  console.log(`${page}: ${scripts.length} inline script(s) checked`);
}
if (bad) process.exit(1);
console.log("UI SYNTAX OK");
