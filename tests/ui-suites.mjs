// The in-page UI suites, run the same way in Chrome (tests/ui-timeline.mjs) and WebKit (tests/ui-webkit.mjs):
// each loads ui/dist at 1280x800, evaluates its files and calls one function returning { problems, log }.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const here = import.meta.dirname;
export const SUITES = [
  { name: "song", files: ["timeline-check.js"], call: 'timelineCheck("song")' },
  { name: "folders", files: ["timeline-check.js"], call: 'timelineCheck("folders")' },
  { name: "sizes", files: ["timeline-sizes.js"], call: "timelineSizes()" },
  { name: "10a", files: ["ui-10a.js"], call: "check10a()" },
  { name: "10b", files: ["ui-10b.js"], call: "check10b()" },
  { name: "10c", files: ["ui-10c.js"], call: "check10c()" },
  { name: "11", files: ["ui-11.js"], call: "check11()" },
  { name: "11b", files: ["ui-11b.js"], call: "check11b()" },
  { name: "12", files: ["ui-12.js"], call: "check12()" },
  { name: "13", files: ["ui-13.js"], call: "check13()" },
  { name: "13b", files: ["ui-13b.js"], call: "check13b()" },
  { name: "13c", files: ["ui-13c.js"], call: "check13c()" },
];
export async function suiteCode(s) { return (await Promise.all(s.files.map((f) => readFile(resolve(here, f), "utf8")))).join("\n") + `\nreturn await ${s.call};`; }
// --only a,b: just those suites
export function pick(args) { const i = args.indexOf("--only"); if (i < 0) return SUITES; const w = args[i + 1].split(","); return SUITES.filter((s) => w.includes(s.name)); }
