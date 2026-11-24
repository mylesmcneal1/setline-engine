// Shows move between Windows and Mac, step 2, on the other system: open the show made by make.js, find every
// file, render every song and version offline and compare with what the first system rendered.
const CFG = /*CFG*/null; // {show, made: make.js's result}
const P = hooks.page();
const res = { checks: [] };
const check = (name, ok, detail) => res.checks.push((ok ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail).slice(0, 1500) : ""));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// every bridge call gives up after 60 s and says which one (a hang names itself)
res.steps = [];
const call0 = SL.call.bind(SL);
const within = (name, p) => { res.steps.push(name); return Promise.race([p, wait(60000).then(() => { const box = document.querySelector(".cfbox"); throw new Error(name + " didn't finish in 60 s" + (box ? "; a box is open: " + box.textContent : "") + "; calls: " + res.steps.slice(-8).join(", ")); })]); };
const SLx = { call: (name, a) => { res.steps.push(name); return Promise.race([call0(name, a), wait(60000).then(() => { throw new Error("no answer from " + name + " in 60 s"); })]); } };
res.platform = (await SLx.call("getAppInfo")).platform;
check("made on " + CFG.made.platform + ", opened on " + res.platform, true);

await within("openPath", hooks.openPath(CFG.show));
for (let i = 0; i < 50 && hooks.docName() === ""; i++) await wait(100);
check("the show opens", hooks.docName() !== "" && P.songs.length >= 2, { name: hooks.docName(), songs: P.songs.map((s) => s.name) });
document.querySelectorAll(".cfbox [data-a=no]").forEach((b) => b.click()); // (a "missing audio" box would be a failure below)
const refs = [...new Set(hooks.audioFiles().map((x) => x.f.path))];
const chk = await SLx.call("checkAudio", { session: CFG.show, refs });
check("every audio file found", !chk.missing.length, { missing: chk.missing, refs });
const same = (l) => JSON.stringify(l.map((x) => x.normalize("NFC")).sort()); // (macOS may spell accents decomposed)
check("the same files as when it was made", same(refs) === same(CFG.made.refs), { now: refs, made: CFG.made.refs });

const close = (a, b, tol) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const maxErr = (a, b) => (a && b ? Math.max(0, ...a.map((x, i) => Math.abs(x - (b[i] ?? 1e9)))) : null);
for (const e of CFG.made.expect) {
  const s = P.songs.find((x) => x.id === e.song);
  if (!s) { check(`song “${e.name}” is there`, false); continue; }
  if (e.ver) switchVer(s, e.ver);
  const r = await SLx.call("testRender", { payload: hooks.payload(s), seconds: 14, outputs: 8 });
  const label = `“${e.name}”${e.ver ? " (" + curVer(s).name + ")" : ""}`;
  const want = e.render;
  const keys = Object.keys(want.samples || {});
  // the same audio within float rounding (x86 vs ARM): 1e-5 is -100 dB
  const errs = Object.fromEntries(keys.map((k) => [k, maxErr(r.samples[k], want.samples[k])]));
  check(`${label} renders the same on every output`, keys.length > 0 && keys.every((k) => close(r.samples[k], want.samples[k], 1e-5)), errs);
  check(`${label}: the same onsets`, JSON.stringify(r.outs.slice(0, 8).map((o) => o.onsets)) === JSON.stringify(want.outs.map((o) => o.onsets)),
    { now: r.outs.slice(0, 8).map((o) => o.onsets), made: want.outs.map((o) => o.onsets) });
  check(`${label}: the same bars`, JSON.stringify(r.bars) === JSON.stringify(want.bars));
  check(`${label}: the same MIDI`, JSON.stringify(r.midi) === JSON.stringify(want.midi), { now: r.midi, made: want.midi });
  check(`${label}: no new warnings`, JSON.stringify(r.warnings) === JSON.stringify(want.warnings), { now: r.warnings, made: want.warnings });
  if (e.ver) switchVer(s, CFG.made.expect[0].ver);
}
// the cues came from the show, not from a voice on this system
const src = await SLx.call("cueSource");
res.cueSource = src;
check("the cues came from the show (not made again with a voice on this system)", src.from !== "render", src);
return res;
