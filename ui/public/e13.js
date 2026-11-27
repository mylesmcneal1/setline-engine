// set.Line 13 E: cues.
// §16 Cues come from your recordings or the downloaded natural voices (Kokoro); the computer's own voices are gone.
//     Songs (and the library) that used a computer voice switch to the natural voice chosen once, with an undo note.
// §17 The Cues menu (between Setlist and Customize), for every song: Voice › (your recordings / a natural voice /
//     recordings first), Announce › (section names, count-ins, next song name, breaks), Count-in › (off / 1 / 2 bars;
//     before songs / before every section), Output ›, Level…, Cue words…, Record missing words…. Each song keeps
//     where its cues fall; the per-song cue settings are gone from the song.
// The settings live with the library (CUEV.mode, CUEV.announce, CUEV.countIn, CUEV.ciWhere).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const CV = () => (typeof CUEV !== "undefined" ? CUEV : {});
  const ANN = [["sections", "Section names"], ["countins", "Count-ins"], ["next", "Next song name"], ["breaks", "Breaks"]];
  const announce = () => ({ sections: false, countins: true, next: false, breaks: false, ...(CV().announce || {}) });
  const mode = () => CV().mode || "both"; // rec | voice | both
  const natural = () => (typeof voiceList === "function" ? voiceList().filter((v) => v.engine === "kokoro").sort((a, b) => (b.rank || 0) - (a.rank || 0) || a.name.localeCompare(b.name)) : []);
  const ready = () => typeof VMODEL !== "undefined" && VMODEL.state === "ready";
  const cueTracks = (s) => s.tracks.filter((t) => typeof ROLE !== "undefined" && ROLE[t] === "cues");
  const changed = (what) => { refresh(); if (window.SLE && SLE.nextChanged) SLE.nextChanged(); if (what) toast(what, undo); };

  // ---------------------------------------------------------------- §16 no computer voices: switch to a natural voice
  const isSys = (v) => !!v && (v.voice || v.name) && !/^kokoro:/.test(v.voice || "");
  function migrateVoices(quiet) {
    const nat = natural(), pick = (CV().voice && /^kokoro:/.test(CV().voice)) ? CV().voice : nat[0] ? nat[0].id : "kokoro:af_heart";
    const pickName = (nat.find((v) => v.id === pick) || {}).name || "";
    let n = 0; const fix = (v) => { if (isSys(v)) { v.voice = pick; v.name = pickName; n++; } };
    const before = typeof ser === "function" ? ser() : null;
    if (isSys(CV())) { CV().voice = pick; CV().name = pickName; n++; }
    songs.forEach((s) => { if (s.cueVoice) { fix(s.cueVoice); if (s.cueVoice && !Object.keys(s.cueVoice).some((k) => k !== "voice" && k !== "name" && k !== "speed")) { delete s.cueVoice; } } (s.cues || []).forEach((c) => { if (c.voice) fix(c.voice); }); });
    if (n && before) { undoS.push(before); redoS = []; if (!quiet) toast(`Cues now use the natural voice${pickName ? " " + pickName : ""} (the computer's own voices are gone)`, undo); refresh(); }
    return n;
  }
  // the per-song cue voice is gone (§17: the Cues menu applies to every song)
  function dropSongVoices() { let n = 0; songs.forEach((s) => { if (s.cueVoice) { delete s.cueVoice; n++; } }); return n; }

  // ---------------------------------------------------------------- the payload: modes and announcements
  // what the engine gets for a song's cues: recordings only / a voice only / recordings first; plus the announcements
  function cuesFor(s, list) {
    const m = mode(), A = announce(), out = [];
    for (const c of list) {
      if (!A.countins && (c.auto13 || /^\d+$/.test(String(c.text || "").trim()))) continue; // count-in words
      const rec = m === "voice" ? "" : typeof recFor === "function" ? recFor(s, c.text || "") : "";
      if (m === "rec" && !rec) continue; // your recordings only: a word you haven't recorded stays silent
      out.push({ ...c, ...(m === "voice" ? { norec: true } : {}) });
    }
    const has = (bar, beat) => out.some((c) => c.bar === bar && Math.abs((c.beat || 1) - (beat || 1)) < 1e-6);
    if (A.sections) (s.secs || []).forEach((x) => { if (x.type === "count-in" || has(x.start, 1)) return; const text = (x.say || x.name || "").trim(); if (text && (m !== "rec" || recFor(s, text))) out.push({ id: "a13s" + x.id, bar: x.start, beat: 1, text, gen13: true }); });
    const L = typeof curSetObj === "function" ? curSetObj() : null, i = L ? (L.order || []).indexOf(s.id) : -1, last = s.total;
    if (A.next && i >= 0 && i + 1 < L.order.length && last > 1) { const nx = songs.find((x) => x.id === L.order[i + 1]); if (nx && !has(last, 1) && (m !== "rec" || recFor(s, nx.name))) out.push({ id: "a13n", bar: last, beat: 1, text: nx.name, gen13: true }); }
    if (A.breaks && L && window.SLBreaks) { const b = (L.breaks || []).find((x) => x.after === s.id); if (b && last > 1 && !out.some((c) => c.id === "a13n") && !has(last, 1) && (m !== "rec" || recFor(s, b.label || "Break"))) out.push({ id: "a13b", bar: last, beat: 1, text: b.label || "Break", gen13: true }); }
    return out;
  }

  // ---------------------------------------------------------------- count-in for every song (Cues › Count-in)
  function countInAll(bars, where) {
    snap(); const W = where || CV().ciWhere || "songs"; CV().countIn = bars; CV().ciWhere = W; let made = 0, none = 0;
    songs.forEach((s) => {
      s.cues = (s.cues || []).filter((c) => !c.auto13); if (bars) s.countIn = bars; else delete s.countIn;
      const starts = W === "sections" ? (s.secs || []).filter((x) => x.type !== "count-in").map((x) => x.start).filter((b) => b > 1) : [(s.secs || []).map((x) => x.start).sort((a, b) => a - b)[0] || 1];
      starts.forEach((into) => { if (!bars || into <= 1) { if (bars) none++; return; } const sig = s.bars[into - 2].sig[0], cs = addCountIn(s, { into, n: Math.min(into - 1, bars) * sig, spacing: "beat" }); cs.forEach((c) => { c.auto13 = true; }); made += cs.length; });
    });
    changed(bars ? `Count-in ${bars} bar${bars > 1 ? "s" : ""} before ${W === "sections" ? "every section" : "songs"} (${made} counts${none ? `; ${none} song${none > 1 ? "s" : ""} start right at bar 1` : ""})` : "Count-ins off");
  }

  // ---------------------------------------------------------------- Output and Level (every song's Cues track)
  function outputs() { if (typeof outCount !== "function") return []; const n = outCount(), out = []; for (let a = 1; a < n; a += 2) out.push({ label: pairName(a), o: [a, a + 1] }); for (let a = 1; a <= n; a++) out.push({ label: outName(a) + " (mono)", o: [a] }); return out; }
  const curOut = () => { const s = songs.find((x) => cueTracks(x).length); return s ? JSON.stringify(outsOf(s, cueTracks(s)[0])) : ""; };
  function setOut(o) { snap(); songs.forEach((s) => cueTracks(s).forEach((t) => { (s.outs || (s.outs = {}))[t] = o; })); changed(`Cues play on ${o.length > 1 ? pairName(o[0]) : outName(o[0])} in every song`); }
  function levelBox() {
    const s0 = songs.find((x) => cueTracks(x).length), g0 = s0 ? gainOf(s0, cueTracks(s0)[0]) : 0;
    popAt({ left: innerWidth / 2 - 140, right: innerWidth / 2 - 140, top: 160 }, `<div class="cg13"><b>Cue level · every song</b><input type="range" min="-30" max="6" step="0.5" value="${g0}" class="cg13r"><span><input type="number" min="-60" max="6" step="0.5" value="${g0}" class="cg13n"> dB</span><button class="btn pri cg13ok">Set</button></div>`, (p) => {
      const r = p.querySelector(".cg13r"), n = p.querySelector(".cg13n"); r.oninput = () => { n.value = r.value; }; n.oninput = () => { r.value = n.value; };
      const ok = () => { const v = Math.max(-60, Math.min(6, +n.value || 0)); closePops(); snap(); songs.forEach((s) => cueTracks(s).forEach((t) => { (s.gain || (s.gain = {}))[t] = v; })); changed(`Cue level ${v > 0 ? "+" : ""}${v} dB in every song`); };
      p.querySelector(".cg13ok").onclick = ok; n.onkeydown = (e) => { if (e.key === "Enter") ok(); }; });
  }

  // ---------------------------------------------------------------- Cue words… (every word: preview, re-record, rename, add, remove)
  function words() { const m = new Map(); songs.forEach((s) => (s.cues || []).forEach((c) => { const t = String(c.text || "").trim(); if (!t) return; const k = t.toLowerCase(); const e = m.get(k) || { text: t, n: 0, songs: new Set() }; e.n++; e.songs.add(s.name); m.set(k, e); }));
    (typeof CUEWORDS !== "undefined" ? CUEWORDS : []).forEach((w) => { const k = String(w.word || "").trim().toLowerCase(); if (k && !m.has(k)) m.set(k, { text: w.word, n: 0, songs: new Set() }); });
    return [...m.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text)); }
  function wordsWindow(onlyMissing) {
    document.querySelectorAll(".cw13bg").forEach((x) => x.remove());
    const bg = document.createElement("div"); bg.className = "cfbg cw13bg"; document.body.appendChild(bg); bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); bg.remove(); } }, true);
    const s0 = songs.find((x) => x.id === selId) || songs[0];
    const draw = () => { const L = words().filter((w) => !onlyMissing || !recFor(s0, w.text));
      bg.innerHTML = `<div class="cfbox cw13win"><div class="si13h"><b>${onlyMissing ? "Record missing words" : "Cue words"}</b><span>${L.length} word${L.length === 1 ? "" : "s"} · ${onlyMissing ? "these play with the natural voice until you add a recording" : "every word your cues say, in every song"}</span><button class="btn pri" data-a="done">Done</button></div>
        <div class="cw13list">${L.map((w, i) => { const rec = recFor(s0, w.text); return `<div class="cw13r" data-i="${i}"><button class="ibtn" data-a="play" title="Preview">▶</button><input class="cw13t" value="${esc(w.text)}" spellcheck="false" title="Rename it in every cue"><span class="cw13n">${w.n} cue${w.n === 1 ? "" : "s"}</span><span class="cw13s ${rec ? "on" : ""}">${rec ? "● your recording" : "natural voice"}</span><button class="btn line" data-a="rec">${rec ? "Replace recording…" : "Add recording…"}</button>${rec ? '<button class="ibtn" data-a="unrec" title="Remove the recording">⌫</button>' : ""}${w.n ? `<button class="ibtn" data-a="del" title="Remove this word from every cue">✕</button>` : ""}</div>`; }).join("") || '<p class="faint" style="padding:16px">Nothing here.</p>'}</div>
        ${onlyMissing ? "" : '<div class="racts" style="padding:0 18px 16px"><input class="cw13new" placeholder="Add a word (it joins the cue picker)" spellcheck="false"><button class="btn line" data-a="add">Add</button></div>'}</div>`;
      bg.querySelector('[data-a="done"]').onclick = () => bg.remove();
      bg.querySelectorAll(".cw13r").forEach((r) => { const w = L[+r.dataset.i];
        r.querySelector('[data-a="play"]').onclick = () => previewCue(s0, w.text);
        r.querySelector(".cw13t").onchange = (e) => { const to = e.target.value.trim(); if (!to || to === w.text) return; snap(); songs.forEach((s) => (s.cues || []).forEach((c) => { if (String(c.text || "").trim().toLowerCase() === w.text.toLowerCase()) c.text = to; })); (CUEWORDS || []).forEach((x) => { if (String(x.word).trim().toLowerCase() === w.text.toLowerCase()) x.word = to; }); changed(`Renamed “${w.text}” to “${to}” in every cue`); draw(); };
        r.querySelector('[data-a="rec"]').onclick = () => { if (window.SLC && SLC.addWords) SLC.addWords(s0, false); else toast("In the app this picks a recording (WAV, AIFF, FLAC) named like the word"); };
        const un = r.querySelector('[data-a="unrec"]'); if (un) un.onclick = () => { snap(); const k = w.text.toLowerCase(); for (let i = CUEWORDS.length - 1; i >= 0; i--) if (String(CUEWORDS[i].word).trim().toLowerCase() === k) CUEWORDS.splice(i, 1); songs.forEach((s) => { if (s.cueWords) s.cueWords = s.cueWords.filter((x) => String(x.word).trim().toLowerCase() !== k); }); changed(`“${w.text}” plays with the natural voice again`); draw(); };
        const del = r.querySelector('[data-a="del"]'); if (del) del.onclick = () => { snap(); songs.forEach((s) => { s.cues = (s.cues || []).filter((c) => String(c.text || "").trim().toLowerCase() !== w.text.toLowerCase()); }); changed(`Removed “${w.text}” from every cue`); draw(); }; });
      const add = bg.querySelector('[data-a="add"]'); if (add) add.onclick = () => { const v = bg.querySelector(".cw13new").value.trim(); if (!v) return; if (typeof PHRASES !== "undefined" && PHRASES && Array.isArray(PHRASES.list)) { if (!PHRASES.list.some((p) => String(p.t).toLowerCase() === v.toLowerCase())) PHRASES.list.push({ t: v, n: 0 }); } toast(`“${v}” is in the cue picker`); draw(); };
    };
    draw();
  }

  // ---------------------------------------------------------------- the menu
  function menu(it, sub, sep, head) {
    const m = mode(), A = announce(), nat = natural(), cur = CV().voice || "", ci = CV().countIn || 0, ciw = CV().ciWhere || "songs", co = curOut();
    const setMode = (k, n) => () => { snap(); CV().mode = k; changed(`Cues: ${n.toLowerCase()}`); };
    return [
      sub("Voice", [
        it("cvRec", "Your recordings", setMode("rec", "Your recordings"), { check: m === "rec" }),
        it("cvNat", "A natural voice", setMode("voice", "A natural voice"), { check: m === "voice" }),
        it("cvBoth", "Recordings first, a natural voice for the rest", setMode("both", "Recordings first, a natural voice for the rest"), { check: m === "both" }),
        sep(), head(ready() ? "Natural voice" : "Natural voices aren't downloaded yet"),
        ...(ready() ? nat.map((v, i) => it("cvv" + i, typeof kokoroLabel === "function" ? kokoroLabel(v) : v.name, () => { snap(); CV().voice = v.id; CV().name = v.name; changed(`Cues: ${v.name}`); }, { check: cur === v.id })) : [it("cvDl", "Download natural voices…", () => window.SLE && SLE.downloadVoices ? SLE.downloadVoices() : openSettings("voices"))]),
      ]),
      sub("Announce", ANN.map(([k, n]) => it("ann_" + k, n, () => { snap(); CV().announce = { ...A, [k]: !A[k] }; changed(`${n}: ${!A[k] ? "announced" : "not announced"}`); }, { check: !!A[k] }))),
      sub("Count-in", [
        ...[[0, "Off"], [1, "1 bar"], [2, "2 bars"]].map(([b, n]) => it("ci_" + b, n, () => countInAll(b, ciw), { check: ci === b })), sep(),
        it("ciSongs", "Before songs", () => countInAll(ci || 1, "songs"), { check: ciw === "songs" }), it("ciSecs", "Before every section", () => countInAll(ci || 1, "sections"), { check: ciw === "sections" }),
      ]),
      sub("Output", outputs().map((o, i) => it("cueOut" + i, o.label, () => setOut(o.o), { check: JSON.stringify(o.o) === co }))),
      it("cueLevel", "Level…", levelBox),
      sep(),
      it("cueWords", "Cue words…", () => wordsWindow(false)),
      it("cueMissing", "Record missing words…", () => wordsWindow(true)),
    ];
  }

  // §16: a library whose cues (or a song's) used a computer voice switches to a natural voice once, with an undo note
  let MIGKEY = "";
  setInterval(() => { if (typeof songs === "undefined" || !songs.length) return; const key = songs.map((s) => s.id).join(); if (key === MIGKEY) return; MIGKEY = key; try { migrateVoices(false); } catch (e) {} }, 2000);

  // §18: on purpose, any time: the Sections row's right-click (as well as Song › Make sections from cues… and ⌘K)
  document.addEventListener("contextmenu", (e) => {
    const lane = e.target.closest && e.target.closest(".row.secs > .lane[data-song]"); if (!lane || e.target.closest(".sec")) return;
    const s = songs.find((x) => x.id === lane.dataset.song); if (!s) return; e.preventDefault(); e.stopPropagation();
    const bar = typeof barAtTime === "function" ? barAtTime(s, TX.timeAt(e, lane)) : 1;
    ctxMenu(e, [{ cap: "Sections" }, { label: "Add section here", icon: "", act: () => addSecAt(s, bar) }, { label: "Make sections from cues…", icon: "", dis: !(s.cues || []).length, act: () => SLMenus.run("m:secsFromCues") }]);
  }, true);

  window.SL13E = { menu, cuesFor, mode, announce, migrateVoices, countInAll, wordsWindow, words, natural };
})();
