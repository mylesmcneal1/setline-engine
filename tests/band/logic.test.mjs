// Unit tests for the band screens' shared logic (ui/src/band/logic.js): node tests/band/logic.test.mjs
import { ClockSync, untilNextChange, fieldValueAt, curfew, allowed, mergeFields, preset, WIDGETS, barBeatAt, changesAhead, predictPos, hitAt } from "../../ui/src/band/logic.js";

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

console.log(failed ? `${failed} FAILED, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
