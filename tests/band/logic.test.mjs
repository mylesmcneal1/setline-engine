// Unit tests for the band screens' shared logic (ui/src/band/logic.js): node tests/band/logic.test.mjs
import { ClockSync, untilNextChange, fieldValueAt, curfew, allowed, mergeFields, preset, WIDGETS, barBeatAt, changesAhead, predictPos, hitAt , PosSmoother, clampWidget } from "../../ui/src/band/logic.js";
import { stackLayout, gridOf, regrid, clamp, deviceOf, deviceKey, canvasSize, isPhoneScreen, boxStyle, styleOf, render, sampleShow, sampleState, VARIANTS, variantOf, variantsOf, fitWrap } from "../../ui/src/band/widgets.js";

let failed = 0, passed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else failed++; console.log((ok ? "ok   " : "FAIL ") + name + (ok || detail === undefined ? "" : "  " + JSON.stringify(detail))); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ---- the clock offset estimator
{
  const c = new ClockSync();
  check("no samples: offset 0, not ready", c.offset() === 0 && !c.ready);
  // the host is 5000 ms ahead; symmetric 20 ms round trips
  for (let i = 0; i < 8; i++) c.add(1000 + i * 100, 1000 + i * 100 + 10 + 5000, 1000 + i * 100 + 20);
  check("symmetric round trips: offset exact", near(c.offset(), 5000), c.offset());
  // two wild outliers (a slow Wi-Fi moment, one-sided) don't move the median of the last 8
  c.add(2000, 2000 + 400 + 5000, 2000 + 410); // reply delayed: estimate off by about -195
  c.add(2100, 2100 + 5 + 5000, 2100 + 900);   // request fast, reply slow: estimate off by about -445
  check("outliers: the median of the last 8 stays put", near(c.offset(), 5000, 1), c.offset());
  check("keeps only the last 8", c.samples.length === 8);
  check("hostNow = client time + offset", near(c.hostNow(123), 5123, 1));
  const d = new ClockSync(); d.add(10, 9, 5); // negative round trip: ignored
  check("an impossible exchange is ignored", !d.ready);
  // even count: the mean of the middle two
  const e = new ClockSync(4); [10, 20, 30, 40].forEach((o) => e.add(0, o, 0));
  check("even count: mean of the middle two", near(e.offset(), 25), e.offset());
}

// ---- a setlist: A (Drop D) -segue-> B (Drop D) -segue-> C (E std) -stop-> D (E std) -auto 5 s-> E (Drop C)
const song = (name, len, fields) => ({ name, len, fields, bars: [], secs: [] });
const show = {
  setlist: { order: [
    { id: "a", after: { mode: "segue" } }, { id: "b", after: { mode: "segue" } }, { id: "c", after: { mode: "stop" } },
    { id: "d", after: { mode: "auto", sec: 5 } }, { id: "e", after: { mode: "stop" } }] },
  songs: { a: song("A", 200, { tun: "Drop D", gtr: "Les Paul" }), b: song("B", 180, { tun: "Drop D" }), c: song("C", 240, { tun: "E std", gtr: "Strat" }),
    d: song("D", 210, { tun: "E std" }), e: song("E", 190, { tun: "Drop C", gtr: "Baritone" }) },
};
{
  const u = untilNextChange(show, 0, 50, "tun");
  check("Until next change: counts across songs (rest of A + all of B)", u && u.value === "E std" && u.songName === "C" && near(u.inSec, 150 + 180) && u.after === null, u);
  check("Until next change: progress since the last change", u && near(u.progress, 50 / 380), u && u.progress);
  const u2 = untilNextChange(show, 2, 30, "tun");
  check("Until next change: a Stop / Auto-next in between gives “after <song>”, not a fake time", u2 && u2.value === "Drop C" && u2.inSec === null && u2.after === "D", u2);
  const u3 = untilNextChange(show, 4, 0, "tun");
  check("Until next change: none ahead", u3 === null);
  // a version that overrides the tuning: B's live version is in E std, so the change comes after A
  const live = JSON.parse(JSON.stringify(show));
  live.songs.b.fields = mergeFields({ tun: "Drop D" }, { tun: "E std" });
  const u4 = untilNextChange(live, 0, 50, "tun");
  check("Until next change: the version's value wins over the song's", u4 && u4.songName === "B" && near(u4.inSec, 150), u4);
  // 9b: a preset change in the middle of a song changes an inherited field from that point
  const mid = JSON.parse(JSON.stringify(show));
  mid.songs.a.fchg = [{ t: 120, f: { tun: "Drop C#" } }];
  const m1 = untilNextChange(mid, 0, 50, "tun");
  check("Until next change: a preset change inside this song comes first (70 s), with its progress", m1 && m1.value === "Drop C#" && m1.songName === "A" && near(m1.inSec, 70) && m1.inSong && near(m1.progress, 50 / 120), m1);
  const m2 = untilNextChange(mid, 0, 130, "tun");
  check("Until next change: after it, the value is the preset's; the next change is B's start (Drop D again)", m2 && m2.fromValue === "Drop C#" && m2.value === "Drop D" && m2.songName === "B" && near(m2.inSec, 70), m2);
  check("fieldValueAt: the song's value, then the preset change's", fieldValueAt(mid, "a", "tun", 10) === "Drop D" && fieldValueAt(mid, "a", "tun", 121) === "Drop C#");
  const mid2 = JSON.parse(JSON.stringify(show)); mid2.songs.b.fchg = [{ t: 60, f: { tun: "Drop C" } }];
  const m3 = untilNextChange(mid2, 0, 50, "tun");
  check("Until next change: a change inside a later song counts its time into that song (150 + 60 s)", m3 && m3.value === "Drop C" && m3.songName === "B" && near(m3.inSec, 210), m3);
  // 9d: breaks between songs add their time; one that waits for Play makes it "after <song>"
  const br = JSON.parse(JSON.stringify(show)); br.setlist.order[0].brk = [{ label: "Gear change", len: 45, wait: false }];
  const b1 = untilNextChange(br, 0, 50, "tun");
  check("Until next change: a timed break after A adds its 45 s", b1 && near(b1.inSec, 150 + 45 + 180) && b1.after === null, b1);
  br.setlist.order[0].brk[0].wait = true;
  const b2 = untilNextChange(br, 0, 50, "tun");
  check("Until next change: a Wait-for-Play break makes it “after A”", b2 && b2.inSec === null && b2.after === "A", b2);
  check("mergeFields: empty version values don't override", mergeFields({ a: "1", b: "2" }, { a: "", b: "3" }).a === "1" && mergeFields({ a: "1", b: "2" }, { a: "", b: "3" }).b === "3");
}

// ---- curfew
{
  const now = new Date(2026, 10, 24, 22, 0, 0).getTime();
  // in song C at 40 s: rest of C (200) + D (210) + 5 s wait + E (190) = 605 s; a Stop after C: "+ talking"
  const r = curfew(show, 2, 40, now, "22:15");
  check("curfew: the rest of the set from the real lengths and known waits", near(r.leftSec, 605), r);
  check("curfew: over/under against the finish time (605 s left, 900 s to go: 295 s under)", near(r.overSec, -295, 0.01), r.overSec);
  check("curfew: a Stop in what's left adds “+ talking”", r.talking === true);
  const r2 = curfew(show, 3, 0, now, "22:05");
  check("curfew: over (405 s left, 300 s to go)", near(r2.overSec, 105, 0.01) && r2.talking === false, r2);
  const r3 = curfew(show, 0, 0, new Date(2026, 10, 24, 23, 50).getTime(), "00:10");
  check("curfew: a finish time after midnight", near(r3.finishAt - new Date(2026, 10, 24, 23, 50).getTime(), 20 * 60000), r3);
  check("curfew: no finish time set", curfew(show, 0, 0, now, "").overSec === null);
}

// ---- the server-side permission check
{
  const drummer = preset("drummer");
  const scr = { id: "s1", ...drummer };
  const play = drummer.land.find((w) => w.type === "playStop"), sc = drummer.land.find((w) => w.type === "soundcheck"), song = drummer.land.find((w) => w.type === "song");
  check("a screen with Play / Stop may play and stop", allowed(scr, "play", play.id).ok && allowed(scr, "stop", play.id).ok);
  check("… and Soundcheck", allowed(scr, "soundcheck", sc.id).ok);
  check("a command from a screen without that button is rejected", !allowed(scr, "nextSong", play.id).ok && !allowed(scr, "nextSong", "nope").ok);
  check("an info widget grants nothing", !allowed(scr, "play", song.id).ok);
  const tech = { id: "s2", ...preset("tech") };
  check("the tech layout can't start playback", tech.land.every((w) => !allowed(tech, "play", w.id).ok) && tech.port.every((w) => !allowed(tech, "play", w.id).ok));
  check("no widget can change a level, gain or mute", Object.values(WIDGETS).every((w) => !(w.cmd || []).some((c) => /level|gain|mute|fader|volume/i.test(c))));
  check("an unknown screen is rejected", !allowed(null, "play", "x").ok);
}

// ---- timing helpers
{
  const s = { bars: [[0, 4, 4, 120], [2, 4, 4, 120], [4, 7, 8, 90], [4 + 7 * (60 / 90) * 0.5, 4, 4, 96]] };
  const a = barBeatAt(s, 3);
  check("bar / beat from the bar list", a.bar === 2 && near(a.beat, 3), a);
  const ch = changesAhead(s, 2.5, 4).map((x) => x.text);
  check("change warnings: “7/8 next bar”, “→ 90 BPM next bar”, then 4/4 and 96 BPM", ch[0] === "7/8 next bar" && ch[1] === "→ 90 BPM next bar" && ch.includes("→ 96 BPM in 2"), ch);
  // 10c: the beat lights follow the click notes: the last note at or before a time
  const h = { ...s, hits: [[0, 1], [0.5, 0], [1.25, 0], [2, 1]] };
  check("hitAt: the last click note (an accent lights beat 1)", hitAt(h, 0.6)[0] === 0.5 && hitAt(h, 2.1)[1] === 1 && hitAt({ bars: s.bars }, 1) === null && hitAt(h, -0.1) === null, [hitAt(h, 0.6), hitAt(h, 2.1)]);
  check("position prediction between updates", near(predictPos({ h: 1000, tr: { playing: true, time: 10 } }, 1500), 10.5) && near(predictPos({ h: 1000, tr: { playing: false, time: 10 } }, 1500), 10));
}

// ---- 15 §6: the shown position: real time, steered gently, never a visible step for a small error
{
  // a target that wobbles by up to ±30 ms around the true position (new states, new clock estimates), 60 fps
  const sm = new PosSmoother(); let t = 0, worst = 0, last = null, err = 0, n = 0; const truth = (ms) => ms / 1000;
  for (let i = 0; i < 600; i++) { t += 1000 / 60; const target = truth(t) + 0.03 * Math.sin(i / 7) * (i % 13 === 0 ? 1 : 0.5); const p = sm.step(target, true, "s", t);
    if (last !== null && i > 60) { worst = Math.max(worst, Math.abs((p - last) - 1 / 60)); err += Math.abs(p - truth(t)); n++; } last = p; }
  check("§6 a wobbling target: no frame moves more than a frame against real time", worst < 1 / 60, worst);
  check("§6 …and the shown position stays close to the real one", err / n < 0.03, err / n);
  // a locate (a jump of 10 s) is followed at once
  const before = sm.step(truth(t += 16.7) + 10, true, "s", t); check("§6 a locate: straight there", near(before, truth(t) + 10, 1e-6) && sm.jumps === 1, before);
  // stopped: exactly the target; another song: exactly the target
  check("§6 stopped: the host's position as it is", sm.step(42, false, "s", t += 16.7) === 42 && sm.step(5, true, "other", t += 16.7) === 5);
  // a 100 ms error closes in under a second, never faster than 20 % of real time
  const s2 = new PosSmoother(); let tt = 0; s2.step(0, true, "a", tt); let p = 0; for (let i = 0; i < 60; i++) { tt += 16.7; p = s2.step(tt / 1000 + 0.1, true, "a", tt); }
  check("§6 a 100 ms error is gone within a second (20 % faster at most)", near(p, tt / 1000 + 0.1, 0.005), [p, tt / 1000 + 0.1]);
}
// ---- 15 §4 / §7: the grid, devices, the stacked phone layout
{
  check("§4 a screen's grid: 12 x 9 by default (screens made before 15)", JSON.stringify(gridOf({})) === JSON.stringify({ cols: 12, rows: 9, gap: 6, snap: true, guides: true }));
  const L = preset("drummer").land.map((w) => ({ ...w })), g0 = { cols: 12, rows: 9 }, g1 = { cols: 24, rows: 18 };
  const R = regrid(L.map((w) => ({ ...w })), g0, g1); check("§4 a finer grid keeps every widget in place", R.every((w, i) => w.x === L[i].x * 2 && w.y === L[i].y * 2 && w.w === L[i].w * 2 && w.h === L[i].h * 2));
  check("§4 clamp: inside the grid; free (⌘) keeps fractions", JSON.stringify(clamp({ x: 11, y: 0, w: 4, h: 1 }, g0)) === JSON.stringify({ x: 8, y: 0, w: 4, h: 1 }) && clamp({ x: 2.37, y: 1.5, w: 3, h: 2 }, g0, true).x === 2.37);
  check("clampWidget takes the screen's grid", clampWidget({ x: 20, y: 0, w: 4, h: 1 }, 24, 16).x === 20);
  check("§7 devices: the old names still work (phone → iPhone, desktop → laptop)", deviceKey("phone") === "iphone" && deviceKey("desktop") === "laptop" && deviceKey("ipad") === "ipad" && isPhoneScreen({ device: "phone" }));
  check("§7 an iPhone canvas: 390 x 844 portrait, 844 x 390 landscape; custom sizes", JSON.stringify(canvasSize({ device: "iphone" }, "port")) === '{"w":390,"h":844}' && canvasSize({ device: "iphone" }, "land").w === 844 && canvasSize({ device: "custom", size: { w: 500, h: 700 } }, "port").h === 700);
  for (const kind of ["drummer", "tech", "md", "vocals"]) {
    const src = preset(kind).land, st = stackLayout(src, 6);
    const ok1 = st.list.length === src.length && st.list.every((w) => w.x >= 0 && w.w >= 1 && w.x + w.w <= 6);
    let over = false; for (let i = 0; i < st.list.length; i++) for (let j = i + 1; j < st.list.length; j++) { const a = st.list[i], b = st.list[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) over = true; }
    const rows = new Map(); st.list.forEach((w) => rows.set(w.y, (rows.get(w.y) || 0) + w.w));
    check(`§7 ${kind}: stacked for a phone (6 columns, nothing off the edge or on top of another, every row full)`, ok1 && !over && [...rows.values()].every((v) => v === 6), st.list.map((w) => w.type + "@" + w.x + "," + w.y + "+" + w.w));
    check(`§7 ${kind}: reading order kept (the song first) and the same buttons (ids kept)`, st.list[0].type === "song" || src[0].type !== "song" ? st.list.every((w) => src.some((x) => x.id === w.id)) : false);
  }
  // §5 the box's style
  check("§5 transparent: no background", /background:transparent/.test(boxStyle({ st: { bg: "none" } })) && boxStyle({ st: { bg: "#0a84ff", op: 50 } }).includes("rgba(10,132,255,0.5)"));
  check("§5 border, text shadow, content top-left", /box-shadow/.test(boxStyle({ st: { border: true } })) && /text-shadow/.test(boxStyle({ st: { shadow: true } })) && /justify-content:flex-start/.test(boxStyle({ st: { al: "tl" } })) && /text-align:left/.test(boxStyle({ st: { al: "tl" } })));
  check("§5 no style: the solid box as before", styleOf({}).bg === "solid" && styleOf({}).op === 100);
  // §3 sample data: every widget draws something
  const show = sampleShow(), st = sampleState(), song = show.songs[st.cur];
  const empty = Object.keys(WIDGETS).filter((type) => { const out = render({ id: "x", type, cfg: {} }, { show, st, pos: 40, song, bb: barBeatAt(song, 40), sec: song.secs[1], nsec: song.secs[2], r: { width: 300, height: 120 }, now: Date.UTC(2026, 10, 28, 22, 24), connected: true, rtt: 12, statuses: [], myStatus: {}, checklist: {}, acks: {}, editor: true }); return !out.html.replace(/<[^>]+>/g, "").trim() && !/s5beats|s5tl|s5secbtns/.test(out.html); });
  check("§3 sample data: no widget draws an empty box", !empty.length, empty);
  const clk = render({ id: "c", type: "clock", cfg: {} }, { show, st, pos: 0, r: { width: 200, height: 100 }, now: new Date(2026, 10, 28, 22, 40, 36).getTime() });
  check("§7 the clock: h:mm (no seconds unless asked)", clk.html.includes(">10:40<small>PM</small>"), clk.html.slice(0, 200));
}

// ---------------------------------------------------------------- 16 §4: the styles
{
  const all = Object.keys(WIDGETS), missing = all.filter((t) => !VARIANTS[t] || variantsOf(t).length < 2 || variantsOf(t).length > 3);
  check("16 §4 every widget has 2-3 styles", !missing.length, missing);
  check("16 §4 a widget from before 16 is Big; an unknown style falls back to Big", variantOf({ type: "song" }) === "big" && variantOf({ type: "song", v: "nope" }) === "big" && variantOf({ type: "song", v: "sec" }) === "sec");
  // Play / Stop's Compact style is Play + Sync MIDI: only that style may sync; nothing grants levels, gain or mute
  const scr = (v) => ({ land: [{ id: "p", type: "playStop", v }], port: [] });
  check("16 §4 Play + Sync MIDI may sync", allowed(scr("compact"), "syncMidi", "p").ok && !allowed(scr("big"), "syncMidi", "p").ok && !allowed(scr("hold"), "syncMidi", "p").ok);
  check("16 §4 still no level, gain or mute from any widget", all.every((t) => !["level", "gain", "mute", "volume"].some((c) => allowed({ land: [{ id: "x", type: t, v: "compact" }], port: [] }, c, "x").ok)));
  // text that wraps: fits the box (the Node estimate: 0.6 em a letter)
  const fw = fitWrap("Mercy Dies With You", 300, 120, 400, 800, "", 1.08);
  check("16 §4 wrapped text fits its box", fw.lines >= 1 && fw.px * fw.lines * 1.08 <= 120 && "Mercy".length * 0.6 * fw.px <= 300, fw);
  const old = render({ id: "o", type: "playStop", cfg: { col: "#bf5af2" } }, { st: { playing: false }, r: { width: 200, height: 120 }, now: 0 });
  check("16 §4 an old button keeps its colour (Big style)", /background:#bf5af2/.test(old.html), old.html.slice(0, 160));
}
console.log(failed ? `${failed} FAILED, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
