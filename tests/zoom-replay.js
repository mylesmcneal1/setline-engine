// 12: the pinch, replayed inside the app (the native "pinch" events the trackpad sends: begin, 24 steps, end), on a
// song made from real stems with their waveforms. Zooming in and out separately: the time each stretched frame takes
// during the gesture and the one sharp redraw after it, plus the Diagnostics timing log. CI (macOS) puts CFG in.
const CFG = /*CFG*/null; // {src: [wav paths]}
const P = hooks.page();
const res = { checks: [], times: {} };
const check = (name, ok, detail) => res.checks.push((ok ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const $ = (id) => document.getElementById(id);
check("a fresh library opens", (await hooks.openLibrary("")) === "");
await hooks.onFileDrag({ state: "drop", x: 5, y: 5, paths: CFG.src });
$("mName").value = "Zoom test"; const before = P.songs.length; $("mAdd").click();
for (let i = 0; i < 100 && P.songs.length === before; i++) await wait(100);
const s = P.songs[P.songs.length - 1];
check("a song from " + CFG.src.length + " stems", !!s && s.tracks.length >= CFG.src.length, s && s.tracks);
openSong(s.id); await wait(600);
// the waveforms: every level fetched ahead (what a gesture would use)
SL12.prefetch(); for (let i = 0; i < 100 && SLW.stats().queued + SLW.stats().busy > 0; i++) await wait(100);
res.waves = SLW.stats();
const sc = $("scroller"), LX = TL9.laneLeft();
SL9.zoomNow(TL9.viewW() / (s.audio * 0.6)); await frames(3); sc.scrollLeft = 200; await frames(3);
for (const [dir, total] of [["in", 1.0], ["out", -1.0], ["in", 1.4], ["out", -1.4]]) {
  const ax = 320, fr = [];
  SL12.pinch({ phase: "begin", m: 0, x: LX + ax, y: 400 });
  for (let i = 0; i < 24; i++) { const a = performance.now(); SL12.pinch({ phase: "change", m: total / 24, x: LX + ax, y: 400 }); await frames(1); fr.push(performance.now() - a); }
  const t0 = performance.now(); SL12.pinch({ phase: "end", m: 0, x: LX + ax, y: 400 }); await frames(1); const after = performance.now() - t0;
  await wait(300); // the finer waveforms that zooming in asks for
  const g = SL12.lastGesture(), f = g.frames.slice().sort((a, b) => a - b);
  const k = dir + " ×" + Math.exp(Math.abs(total) * SL12.speed()).toFixed(1);
  res.times[k] = { frameMedianMs: +f[Math.floor(f.length / 2)].toFixed(2), frameWorstMs: +f[f.length - 1].toFixed(2), redrawMs: +g.redraw.toFixed(1), frameToScreenMs: +after.toFixed(1), stepMedianMs: +fr.sort((a, b) => a - b)[12].toFixed(1) };
  check(`pinch ${k}: the redraw after the gesture is under 150 ms`, g.redraw < 150, res.times[k]);
}
res.diag = SL9.timings().filter((x) => /^pinch/.test(x.what));
res.fine = SLW.stats();
return res;
