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
// the page's plain scripts (8c: modeler.js, modeler-ui.js; served as they are from ui/public)
for (const f of ["ui/public/modeler.js", "ui/public/modeler-ui.js", "ui/public/show9.js", "ui/public/look9.js", "ui/public/menus9.js", "ui/public/breaks9.js", "ui/public/time9e.js", "ui/public/fix10a.js", "ui/public/ix10.js"]) {
  try { new vm.Script(readFileSync(new URL("../" + f, import.meta.url), "utf8"), { filename: f }); console.log(`${f}: checked`); }
  catch (e) { bad++; console.error(`FAIL ${f}: ${e.message}`); }
}
if (bad) process.exit(1);
console.log("UI SYNTAX OK");
