// 8c: modeler-native MIDI (Neural DSP Quad Cortex, Fractal Axe-Fx III). Plain script: the page loads it as
// window.SLMod; tests/modeler.test.mjs loads it with require. No DOM here, only messages and the lane's model.
//
// Under the hood a modeler track is the ordinary MIDI events list (s.midi[track]): a preset is a Program Change with
// its Bank Select, a scene is a CC, a footswitch press is a CC. Each such event carries mod: 'preset' | 'scene' |
// 'fs' | 'mode' so the lane can draw and edit it as presets and scenes; switching the track to Generic shows the raw
// events, which still play the same.
(function (root) {
  "use strict";
  const DEVICES = {
    qc: { name: "Quad Cortex", badge: "QC", scenes: "ABCDEFGH", sceneCC: 43, fsCC: 35, modeCC: 47 },
    axe: { name: "Axe-Fx III", badge: "AXE III", scenes: "12345678", sceneCC: 34 },
  };
  // the mockup's scene palette (A-H / 1-8)
  const SCENE_COLS = ["#64d2ff", "#ffd60a", "#ff453a", "#bf5af2", "#30d158", "#ff9f0a", "#ff375f", "#5e5ce6"];

  // ---- messages
  // Quad Cortex: presets 1-256 in 32 banks of 8 (1A-32H); setlist 0-12. CC0 = group (0: 1-128, 1: 129-256),
  // CC32 = setlist, then Program Change = the preset within its group.
  function qcPreset(preset, setlist) {
    const n = Math.max(1, Math.min(256, Math.round(preset))) - 1;
    return [{ cc: 0, val: n >> 7 }, { cc: 32, val: Math.max(0, Math.min(12, Math.round(setlist || 0))) }, { pc: n & 127 }];
  }
  const qcScene = (k) => ({ cc: 43, val: Math.max(0, Math.min(7, k)) });            // scene A-H = 0-7
  const qcStomp = (k) => ({ cc: 35 + Math.max(0, Math.min(7, k)), val: 127 });      // footswitch A-H
  const qcMode = (m) => ({ cc: 47, val: Math.max(0, Math.min(2, m)) });             // 0 preset, 1 scene, 2 stomp
  // Axe-Fx III: presets 0-1023: Bank Select CC0 = preset / 128, then Program Change = preset mod 128.
  function axePreset(preset) {
    const n = Math.max(0, Math.min(1023, Math.round(preset)));
    return [{ cc: 0, val: n >> 7 }, { pc: n & 127 }];
  }
  const axeScene = (k, cc) => ({ cc: cc === undefined ? 34 : cc, val: Math.max(0, Math.min(7, k)) }); // scene 1-8 = 0-7

  // bank / letter names for the Quad Cortex: preset 129 = "17A"
  const qcName = (preset) => { const n = Math.max(1, Math.min(256, preset)) - 1; return (Math.floor(n / 8) + 1) + "ABCDEFGH"[n % 8]; };
  const qcFromName = (s) => { const m = /^\s*(\d{1,2})\s*([A-Ha-h])\s*$/.exec(String(s || "")); if (!m) return null; const b = +m[1]; return b >= 1 && b <= 32 ? (b - 1) * 8 + "abcdefgh".indexOf(m[2].toLowerCase()) + 1 : null; };
  const presetLabel = (dev, preset) => dev === "qc" ? qcName(preset) : String(preset);
  const sceneLabel = (dev, k) => (DEVICES[dev] || DEVICES.qc).scenes[k] || String(k + 1);
  const sceneCC = (dev, cfg) => dev === "axe" ? (cfg && cfg.sceneCC !== undefined && cfg.sceneCC !== "" ? +cfg.sceneCC : 34) : 43;

  // ---- events (the existing model) from a modeler action
  // a preset event: one Program Change event with msb / lsb (the engine sends CC0, CC32, PC in that order)
  function presetEvent(dev, preset, setlist, pos) {
    const msgs = dev === "qc" ? qcPreset(preset, setlist) : axePreset(preset);
    const e = { kind: "pc", mod: "preset", preset: Math.round(preset), bar: pos.bar, beat: pos.beat || 1, pc: msgs.find((m) => m.pc !== undefined).pc, msb: msgs[0].val };
    if (dev === "qc") { e.lsb = msgs[1].val; e.setlist = msgs[1].val; }
    return e;
  }
  const sceneEvent = (dev, cfg, k, pos) => ({ kind: "cc", mod: "scene", scene: k, cc: sceneCC(dev, cfg), val: Math.max(0, Math.min(7, k)), bar: pos.bar, beat: pos.beat || 1 });
  const stompEvent = (k, pos) => ({ kind: "cc", mod: "fs", fs: k, cc: 35 + k, val: 127, bar: pos.bar, beat: pos.beat || 1 });
  // what an event sends, in words: "Sends CC 43 = 2 (Scene C) on Ch 1"
  function describe(dev, e, ch) {
    const c = " on Ch " + (ch || 1);
    if (e.mod === "scene") return "Sends CC " + e.cc + " = " + e.val + " (Scene " + sceneLabel(dev, e.val) + ")" + c;
    if (e.mod === "fs") return "Sends CC " + e.cc + " = " + e.val + " (footswitch " + "ABCDEFGH"[e.fs] + ")" + c;
    if (e.mod === "mode") return "Sends CC 47 = " + e.val + " (" + ["Preset", "Scene", "Stomp"][e.val] + " mode)" + c;
    if (e.mod === "preset") return dev === "qc" ? "Sends CC 0 = " + e.msb + ", CC 32 = " + e.lsb + ", PC " + e.pc + " (preset " + qcName(e.preset) + ", setlist " + e.lsb + ")" + c
                                                : "Sends CC 0 = " + e.msb + ", PC " + e.pc + " (preset " + e.preset + ")" + c;
    return "";
  }
  // a modeler event as the lane knows it, or null (a raw event made in Generic)
  function classify(dev, cfg, e) {
    if (e.mod === "preset" || e.mod === "scene" || e.mod === "fs" || e.mod === "mode") return e.mod;
    if (e.kind === "pc") return "preset";
    if (e.kind === "cc" && e.cc === sceneCC(dev, cfg) && e.val <= 7) return "scene";
    if (dev === "qc" && e.kind === "cc" && e.cc >= 35 && e.cc <= 42) return "fs";
    if (dev === "qc" && e.kind === "cc" && e.cc === 47) return "mode";
    return null;
  }
  // the preset a raw Program Change (with Bank Select) selects
  function presetOf(dev, e) {
    if (e.preset !== undefined) return e.preset;
    return dev === "qc" ? ((+e.msb || 0) << 7) + (+e.pc || 0) + 1 : ((+e.msb || 0) << 7) + (+e.pc || 0);
  }

  // ---- the lane's model: blocks between scene changes; edits are on positions in beats from the song start.
  // pos(e) -> beats (any monotonic unit); at(x) -> {bar, beat} for a position; snap(x) -> x on the grid.
  // Each function returns the new events list (the input isn't changed).
  const byPos = (pos) => (a, b) => pos(a) - pos(b);
  // scene blocks: [{e, start, end}] (end = the next scene change, or `end`)
  function blocks(events, pos, end, kind) {
    const sc = events.filter((e) => e.mod === (kind || "scene")).sort(byPos(pos));
    return sc.map((e, i) => ({ e, start: pos(e), end: i + 1 < sc.length ? pos(sc[i + 1]) : end }));
  }
  const clone = (events) => events.map((e) => ({ ...e }));
  // move a block (its scene change) to x; another change already there is replaced. copy: keep the original.
  function moveBlock(events, id, x, at, copy, newId) {
    const out = clone(events), i = out.findIndex((e) => e.id === id);
    if (i < 0) return out;
    const p = at(x), moved = copy ? { ...out[i], id: newId } : out[i];
    Object.assign(moved, { bar: p.bar, beat: p.beat });
    const rest = out.filter((e, k) => (copy || k !== i) && !(e.mod === moved.mod && e !== moved && e.bar === p.bar && Math.abs((e.beat || 1) - p.beat) < 1e-6));
    if (copy) rest.push(moved); else if (!rest.includes(moved)) rest.push(moved);
    return rest;
  }
  // drag a block's edge: its start edge moves its own change; its end edge moves the next change. Limited to the
  // neighbours (a block never shrinks below minLen) so blocks never cross.
  function dragEdge(events, id, side, x, pos, at, end, minLen) {
    const out = clone(events), bl = blocks(out, pos, end), i = bl.findIndex((b) => b.e.id === id);
    if (i < 0) return out;
    const m = minLen || 0;
    if (side === "start") { const lo = i > 0 ? bl[i - 1].start + m : -Infinity, hi = bl[i].end - m; Object.assign(bl[i].e, at(Math.max(lo, Math.min(hi, x)))); }
    else if (i + 1 < bl.length) { const lo = bl[i].start + m, hi = bl[i + 1].end - m; Object.assign(bl[i + 1].e, at(Math.max(lo, Math.min(hi, x)))); }
    return out;
  }
  // drop a scene onto the lane: on a block, it replaces that block's scene; on empty lane, a new change at x
  function dropScene(dev, cfg, events, k, x, pos, at, end, newId) {
    const out = clone(events), hit = blocks(out, pos, end).find((b) => x >= b.start - 1e-9 && x < b.end);
    if (hit) { Object.assign(hit.e, { scene: k, val: k, cc: sceneCC(dev, cfg), mod: "scene", kind: "cc" }); delete hit.e.presetId; return out; }
    out.push({ ...sceneEvent(dev, cfg, k, at(x)), id: newId });
    return out;
  }
  // a scene change at x (the double-click picker): one already exactly there changes scene; else a new change
  function setSceneAt(dev, cfg, events, k, p, newId) {
    const out = clone(events), same = out.find((e) => e.mod === "scene" && e.bar === p.bar && Math.abs((e.beat || 1) - (p.beat || 1)) < 1e-6);
    if (same) { Object.assign(same, { scene: k, val: k, cc: sceneCC(dev, cfg) }); delete same.presetId; return out; }
    out.push({ ...sceneEvent(dev, cfg, k, p), id: newId });
    return out;
  }
  // set the preset at x (the bar on top): replaces the preset change in force there, or adds one
  function dropPreset(dev, events, preset, setlist, x, pos, at, newId) {
    const out = clone(events), ps = out.filter((e) => e.mod === "preset").sort(byPos(pos));
    const cur = [...ps].reverse().find((e) => pos(e) <= x + 1e-9);
    const ne = presetEvent(dev, preset, setlist, cur ? { bar: cur.bar, beat: cur.beat } : at(x));
    if (cur) { Object.assign(cur, ne); delete cur.presetId; if (dev !== "qc") delete cur.lsb; return out; } // no longer a generic preset (its PC came from that)
    out.push({ ...ne, id: newId });
    return out;
  }
  // the Quad Cortex's "mode on load": a CC 47 right after every preset change (1/96 beat later) or none
  function syncMode(events, mode) {
    const out = events.filter((e) => e.mod !== "mode").map((e) => ({ ...e }));
    if (mode === "" || mode === undefined || mode === null) return out;
    out.filter((e) => e.mod === "preset").forEach((p, k) => out.push({ kind: "cc", mod: "mode", cc: 47, val: +mode, bar: p.bar, beat: +((p.beat || 1) + 1 / 96).toFixed(5), id: (p.id || "p") + "m" }));
    return out;
  }

  // ---- presets in the library: names, 8 scene names + colours, fields (per device; key = the preset number)
  function presetInfo(lib, dev, preset) {
    const p = (lib && lib[dev] && lib[dev][preset]) || {};
    const sc = DEVICES[dev] ? DEVICES[dev].scenes : "ABCDEFGH";
    return { name: p.name || "", fields: p.fields || {}, scenes: [...sc].map((l, k) => ({ label: l, name: (p.scenes && p.scenes[k] && p.scenes[k].name) || "", col: (p.scenes && p.scenes[k] && p.scenes[k].col) || SCENE_COLS[k] })) };
  }
  // a song's field value: its own (or its version's) wins; else the value of the preset it starts with on any
  // modeler track that has one for this field
  function fieldValue(fid, own, presetsUsed, lib) {
    if (own !== undefined && own !== null && own !== "") return { value: own, from: "song" };
    for (const u of presetsUsed) { const v = presetInfo(lib, u.dev, u.preset).fields[fid]; if (v !== undefined && v !== "") return { value: v, from: "preset", dev: u.dev, preset: u.preset }; }
    return { value: "", from: "" };
  }

  const api = { DEVICES, SCENE_COLS, qcPreset, qcScene, qcStomp, qcMode, axePreset, axeScene, qcName, qcFromName, presetLabel, sceneLabel, sceneCC,
    presetEvent, sceneEvent, stompEvent, describe, classify, presetOf, blocks, moveBlock, dragEdge, dropScene, setSceneAt, dropPreset, syncMode, presetInfo, fieldValue };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SLMod = api;
})(typeof window !== "undefined" ? window : globalThis);
