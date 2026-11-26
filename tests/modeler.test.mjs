// 8c: modeler-native MIDI (ui/public/modeler.js): the messages each device needs, preset fields, and the lane's
// drag-and-drop model operations.   node tests/modeler.test.mjs
import { readFileSync } from "node:fs";
// the page loads it as a plain script (window.SLMod); here it runs the same way with a CommonJS-style module object
const mod = { exports: {} };
new Function("module", "window", readFileSync(new URL("../ui/public/modeler.js", import.meta.url), "utf8"))(mod, undefined);
const M = mod.exports;
let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  got " + JSON.stringify(got))); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- messages
check("QC preset 129 in setlist 5 -> CC0=1, CC32=5, PC 0", eq(M.qcPreset(129, 5), [{ cc: 0, val: 1 }, { cc: 32, val: 5 }, { pc: 0 }]), M.qcPreset(129, 5));
check("QC preset 1 (1A) in setlist 0 -> CC0=0, CC32=0, PC 0", eq(M.qcPreset(1, 0), [{ cc: 0, val: 0 }, { cc: 32, val: 0 }, { pc: 0 }]), M.qcPreset(1, 0));
check("QC preset 256 (32H) -> CC0=1, PC 127", eq(M.qcPreset(256, 12), [{ cc: 0, val: 1 }, { cc: 32, val: 12 }, { pc: 127 }]), M.qcPreset(256, 12));
check("QC names: 129 = 17A, 256 = 32H, and back", M.qcName(129) === "17A" && M.qcName(256) === "32H" && M.qcFromName("17a") === 129 && M.qcFromName("33A") === null, [M.qcName(129), M.qcFromName("17a")]);
check("QC scene C -> CC43=2", eq(M.qcScene(2), { cc: 43, val: 2 }), M.qcScene(2));
check("QC footswitch E -> CC39=127; mode on load Scene -> CC47=1", eq(M.qcStomp(4), { cc: 39, val: 127 }) && eq(M.qcMode(1), { cc: 47, val: 1 }), [M.qcStomp(4), M.qcMode(1)]);
check("Axe preset 414 -> CC0=3, PC 30", eq(M.axePreset(414), [{ cc: 0, val: 3 }, { pc: 30 }]), M.axePreset(414));
check("Axe preset 0 -> 0,0; 128 -> 1,0", eq(M.axePreset(0), [{ cc: 0, val: 0 }, { pc: 0 }]) && eq(M.axePreset(128), [{ cc: 0, val: 1 }, { pc: 0 }]), [M.axePreset(0), M.axePreset(128)]);
check("Axe scene 3 with CC 34 -> CC34=2", eq(M.axeScene(2, 34), { cc: 34, val: 2 }), M.axeScene(2, 34));
// as events (what the engine plays: CC0, CC32, PC from one Program Change event)
const qp = M.presetEvent("qc", 129, 5, { bar: 1, beat: 1 }), ap = M.presetEvent("axe", 414, 0, { bar: 9, beat: 1 });
check("QC preset event: pc 0, msb 1, lsb 5", qp.kind === "pc" && qp.pc === 0 && qp.msb === 1 && qp.lsb === 5 && qp.mod === "preset", qp);
check("Axe preset event: pc 30, msb 3, no lsb", ap.pc === 30 && ap.msb === 3 && ap.lsb === undefined, ap);
check("a scene event uses the Axe's Scene Select CC", M.sceneEvent("axe", { sceneCC: 50 }, 2, { bar: 1 }).cc === 50 && M.sceneEvent("axe", {}, 2, { bar: 1 }).cc === 34 && M.sceneEvent("qc", {}, 2, { bar: 1 }).cc === 43);
check("the picker's words: Sends CC 43 = 2 (Scene C) on Ch 1", M.describe("qc", M.sceneEvent("qc", {}, 2, { bar: 25 }), 1) === "Sends CC 43 = 2 (Scene C) on Ch 1" && M.describe("axe", M.sceneEvent("axe", {}, 2, { bar: 25 }), 2) === "Sends CC 34 = 2 (Scene 3) on Ch 2", M.describe("qc", M.sceneEvent("qc", {}, 2, { bar: 25 }), 1));
check("raw events read back as presets / scenes (Generic -> QC)", M.classify("qc", {}, { kind: "pc", pc: 0, msb: 1 }) === "preset" && M.presetOf("qc", { kind: "pc", pc: 0, msb: 1 }) === 129 && M.classify("qc", {}, { kind: "cc", cc: 43, val: 3 }) === "scene" && M.classify("qc", {}, { kind: "cc", cc: 7, val: 3 }) === null);

// ---- preset fields: inheritance and override
const lib = { qc: { 129: { name: "Glasshouse Rig", fields: { tuning: "Drop C", guitar: "Baritone" } } }, axe: { 414: { name: "Seneca Lead", fields: { tuning: "E standard" } } } };
const used = [{ dev: "qc", preset: 129 }];
check("a song using 17A inherits its Tuning", eq(M.fieldValue("tuning", undefined, used, lib), { value: "Drop C", from: "preset", dev: "qc", preset: 129 }), M.fieldValue("tuning", undefined, used, lib));
check("a song (or version) value overrides the preset's", eq(M.fieldValue("tuning", "Drop D", used, lib), { value: "Drop D", from: "song" }));
check("the first preset with the field wins; none: empty", M.fieldValue("tuning", "", [{ dev: "axe", preset: 414 }, ...used], lib).value === "E standard" && M.fieldValue("pickup", "", used, lib).value === "");
check("scene names and colours default to A-H / 1-8 and the palette", (() => { const i = M.presetInfo(lib, "axe", 414); return i.name === "Seneca Lead" && i.scenes[2].label === "3" && i.scenes[2].name === "" && i.scenes[2].col === M.SCENE_COLS[2]; })());

// ---- drag-and-drop model (positions in beats; 4/4, bar b beat k = (b-1)*4 + k-1)
const pos = (e) => (e.bar - 1) * 4 + ((e.beat || 1) - 1), at = (x) => ({ bar: Math.floor(x / 4) + 1, beat: (x % 4) + 1 }), END = 64;
const cfg = {}, sc = (id, k, bar) => ({ ...M.sceneEvent("qc", cfg, k, { bar, beat: 1 }), id });
const ev = [sc("a", 3, 1), sc("b", 0, 3), sc("c", 2, 9), sc("d", 0, 12)]; // D @1, A @3, C @9, A @12
const bl = (evs) => M.blocks(evs, pos, END).map((b) => M.sceneLabel("qc", b.e.scene) + "@" + (b.start / 4 + 1));
check("blocks: D@1 A@3 C@9 A@12", bl(ev).join(" ") === "D@1 A@3 C@9 A@12", bl(ev));
check("move: the C block from bar 9 to bar 7", bl(M.moveBlock(ev, "c", 24, at, false)).join(" ") === "D@1 A@3 C@7 A@12", bl(M.moveBlock(ev, "c", 24, at, false)));
check("Alt-drag copies: C stays at 9 and a copy at 17", bl(M.moveBlock(ev, "c", 64, at, true, "c2")).join(" ") === "D@1 A@3 C@9 A@12 C@17", bl(M.moveBlock(ev, "c", 64, at, true, "c2")));
check("move onto another change replaces it (A@12 -> C@12)", bl(M.moveBlock(ev, "c", 44, at, false)).join(" ") === "D@1 A@3 C@12", bl(M.moveBlock(ev, "c", 44, at, false)));
check("edge drag: C's start edge to bar 8", bl(M.dragEdge(ev, "c", "start", 28, pos, at, END, 4)).join(" ") === "D@1 A@3 C@8 A@12", bl(M.dragEdge(ev, "c", "start", 28, pos, at, END, 4)));
check("edge drag: C's end edge to bar 14 (the next change moves)", bl(M.dragEdge(ev, "c", "end", 52, pos, at, END, 4)).join(" ") === "D@1 A@3 C@9 A@14", bl(M.dragEdge(ev, "c", "end", 52, pos, at, END, 4)));
check("edge drag never crosses a neighbour (C's start to bar 1 stops a bar after A)", bl(M.dragEdge(ev, "c", "start", 0, pos, at, END, 4)).join(" ") === "D@1 A@3 C@4 A@12", bl(M.dragEdge(ev, "c", "start", 0, pos, at, END, 4)));
check("drop a scene onto a block replaces it (H onto the C block)", bl(M.dropScene("qc", cfg, ev, 7, 40, pos, at, END, "n")).join(" ") === "D@1 A@3 H@9 A@12", bl(M.dropScene("qc", cfg, ev, 7, 40, pos, at, END, "n")));
check("drop a scene on empty lane adds a change", bl(M.dropScene("qc", cfg, [sc("x", 0, 5)], 2, 0, pos, at, END, "n")).join(" ") === "C@1 A@5");
check("the picker adds a change inside a block (B at bar 10)", bl(M.setSceneAt("qc", cfg, ev, 1, { bar: 10, beat: 1 }, "n")).join(" ") === "D@1 A@3 C@9 B@10 A@12");
const pr = M.dropPreset("qc", [M.presetEvent("qc", 129, 5, { bar: 1 })].map((e) => ({ ...e, id: "p" })), 130, 5, 20, pos, at, "q");
check("drop a preset on the preset bar replaces the one in force there (17A -> 17B)", pr.length === 1 && pr[0].preset === 130 && pr[0].pc === 1, pr);
const md = M.syncMode([{ ...M.presetEvent("qc", 129, 5, { bar: 1 }), id: "p" }], 1);
check("mode on load: CC 47 just after each preset; none when off", md.length === 2 && md[1].cc === 47 && md[1].val === 1 && md[1].beat > 1 && md[1].beat < 1.02 && M.syncMode(md, "").length === 1, md);

console.log(fails ? `MODELER FAILED (${fails} of ${n})` : `MODELER OK (${n})`);
process.exit(fails ? 1 : 0);
