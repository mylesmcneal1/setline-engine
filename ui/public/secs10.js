// set.Line 10c: Make sections from cues, front and centre (8b's logic: a section starts at a section cue's bar).
// - The Sections row header: "From cues" next to +.
// - An empty Sections lane in a song with section cues: ghost sections (dashed, named) with "Make these N sections"
//   and "Edit…" right in the lane.
// - Song › Make sections from cues…, the right-click menus, ⌘K, the selection bar; several songs at once.
// - After an Ableton import: "Make sections from cues for N songs?" in the summary.
// - Edit…: the ghost sections with a tick and an editable name each, the cue words found ("counts as a section"),
//   count words skipped, Replace my sections / Keep my sections and fill the gaps. Undo.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  // the words that start a section by default (cueSecType decides the type)
  const DEFAULT_WORDS = ["Intro", "Verse", "Pre", "Prechorus", "Chorus", "Bridge", "Breakdown", "Solo", "Outro", "Ending", "Tag", "Interlude", "Drop", "Vamp"];
  const isCount = (w) => COUNT_WORD.test(String(w || "").trim()) || /^(go|one,|1,|2,)/i.test(String(w || "").trim()) || /^(one|two|three|four)([\s,.-]+(one|two|three|four|and))+$/i.test(String(w || "").trim());
  const wordKey = (t) => String(t || "").trim().toLowerCase();
  // the cue words in a song: [{word, n, on, type}] (count words left out)
  function words(s) {
    const m = new Map();
    for (const c of cuesOf(s)) { const k = wordKey(c.text); if (!k || isCount(c.text)) continue; if (!m.has(k)) m.set(k, { word: String(c.text).trim(), n: 0, type: cueSecType(c.text) }); m.get(k).n++; }
    return [...m.values()].map((x) => ({ ...x, on: !!x.type || DEFAULT_WORDS.some((d) => wordKey(x.word).startsWith(d.toLowerCase())) }));
  }
  // the sections the cues make: [{start, bars, name, type, on}] (an Intro before the first one)
  function plan(s, on) {
    const W = new Map(words(s).map((w) => [wordKey(w.word), w])), ok = (t) => { const w = W.get(wordKey(t)); return w && (on ? on.has(wordKey(t)) : w.on); };
    const starts = [];
    cuesOf(s).slice().sort((a, b) => a.bar - b.bar || (a.beat || 1) - (b.beat || 1)).forEach((c) => { if (!ok(c.text) || starts.some((x) => x.start === c.bar)) return; starts.push({ start: c.bar, name: String(c.text).trim(), type: cueSecType(c.text) || "verse" }); });
    if (!starts.length) return [];
    if (starts[0].start > 1) { if (starts[0].type === "intro") starts[0].start = 1; else starts.unshift({ start: 1, name: "Intro", type: "intro" }); }
    return starts.map((x, i) => ({ ...x, bars: Math.max(1, (starts[i + 1] ? starts[i + 1].start : s.total + 1) - x.start), on: true }));
  }
  // write them: replace the song's sections, or keep them and fill only the bars no section covers
  function apply(s, P, mode) {
    const mk = (x) => ({ id: sid++, name: x.name, type: x.type, start: x.start, bars: x.bars, end: "continue", say: "", notes: {}, tile: true });
    const use = P.filter((x) => x.on);
    if (mode !== "fill" || !(s.secs || []).length) s.secs = use.map(mk);
    else {
      const taken = new Set(); s.secs.forEach((x) => { for (let b = x.start; b < x.start + x.bars; b++) taken.add(b); });
      for (const x of use) { let a = x.start; while (a < x.start + x.bars) { while (a < x.start + x.bars && taken.has(a)) a++; let b = a; while (b < x.start + x.bars && !taken.has(b)) b++; if (b > a) s.secs.push(mk({ ...x, start: a, bars: b - a })); a = b; } }
      s.secs.sort((p, q) => p.start - q.start);
    }
    normSecs(s); buildBars(s); return use.length;
  }
  const can = (s) => !!s && plan(s).length > 0;
  // several songs: each without sections gets them; with sections: the gaps are filled
  function batch(list) {
    const L = list.filter(can); if (!L.length) { toast(list.length > 1 ? "None of those songs has section cues (Verse, Chorus…)" : "No section cues (Verse, Chorus…) in this song"); return 0; }
    snap(); let filled = 0; L.forEach((s) => { const had = (s.secs || []).length; apply(s, plan(s), had ? "fill" : "replace"); if (had) filled++; });
    refresh(); toast(`Made sections from cues in ${L.length > 1 ? L.length + " songs" : "“" + L[0].name + "”"}${filled ? ` (${filled} kept ${filled > 1 ? "their" : "its"} own and filled the gaps)` : ""}`, undo);
    return L.length;
  }
  function fromCues(list) {
    list = (list || []).filter(Boolean);
    if (list.length > 1) return batch(list);
    const s = list[0]; if (!s) return 0;
    if (!can(s)) { toast("No section cues (Verse, Chorus…) in “" + s.name + "”"); return 0; }
    editor(s); return 1;
  }

  // ---- Edit…: the preview
  function editor(s) {
    const W = words(s), on = new Set(W.filter((w) => w.on).map((w) => wordKey(w.word)));
    let P = plan(s, on), mode = (s.secs || []).length ? "fill" : "replace";
    const bg = document.createElement("div"); bg.className = "cfbg"; bg.id = "secEd10";
    const draw = () => {
      const n = P.filter((x) => x.on).length, x = (bar) => ((s.bars[Math.min(bar, s.total + 1) - 1] || { t: s.len }).t / s.len) * 100;
      bg.innerHTML = `<div class="cfbox seced10" role="dialog" aria-label="Make sections from cues"><b>Make sections from cues · ${esc(s.name)}</b>
        <p>Each ticked cue word starts a section at its bar. Count-ins (“One, two, three, four”, numbers, “Go”) are skipped.</p>
        <div class="sstrip10">${P.map((p, i) => `<span class="${p.on ? "" : "off"}" style="left:${x(p.start)}%;width:${x(p.start + p.bars) - x(p.start)}%;--sc:${SEC_C[p.type] || "#888"}">${esc(p.name)}</span>`).join("")}</div>
        <div class="scols10"><div><h4>Sections</h4><div class="slist10">${P.map((p, i) => `<label class="srow10"><input type="checkbox" data-s="${i}" ${p.on ? "checked" : ""}><i style="background:${SEC_C[p.type] || "#888"}"></i><input class="sname10" data-n="${i}" value="${esc(p.name)}" spellcheck="false"><span class="mono">bars ${p.start}–${p.start + p.bars - 1}</span></label>`).join("")}</div></div>
          <div><h4>Cue words found</h4><div class="slist10">${W.map((w) => `<label class="wrow10"><input type="checkbox" data-w="${esc(wordKey(w.word))}" ${on.has(wordKey(w.word)) ? "checked" : ""}> ${esc(w.word)} <span class="faint">×${w.n}</span> <em>${on.has(wordKey(w.word)) ? "counts as a section" : ""}</em></label>`).join("") || `<p class="faint">No cue words besides count-ins</p>`}</div></div></div>
        ${(s.secs || []).length ? `<div class="bseg9 two" id="sMode10"><button data-v="replace" class="${mode === "replace" ? "on" : ""}">Replace my sections</button><button data-v="fill" class="${mode === "fill" ? "on" : ""}">Keep my sections and fill the gaps</button></div>` : ""}
        <div class="cfa"><button class="btn line" data-a="no">Cancel</button><button class="btn pri" data-a="ok" ${n ? "" : "disabled"}>Make ${n === 1 ? "this section" : `these ${n} sections`}</button></div></div>`;
      bg.querySelectorAll("[data-s]").forEach((c) => c.onchange = () => { P[+c.dataset.s].on = c.checked; draw(); });
      bg.querySelectorAll("[data-n]").forEach((c) => c.onchange = () => { P[+c.dataset.n].name = c.value.trim() || P[+c.dataset.n].name; });
      bg.querySelectorAll("[data-w]").forEach((c) => c.onchange = () => { if (c.checked) on.add(c.dataset.w); else on.delete(c.dataset.w); const was = new Map(P.map((p) => [p.start + "|" + wordKey(p.name), p])); P = plan(s, on).map((p) => { const o = was.get(p.start + "|" + wordKey(p.name)); return o ? { ...p, on: o.on } : p; }); draw(); }); // ticks kept where the section stays
      bg.querySelectorAll("#sMode10 button").forEach((b) => b.onclick = () => { mode = b.dataset.v; draw(); });
      bg.querySelector('[data-a="no"]').onclick = () => bg.remove();
      bg.querySelector('[data-a="ok"]').onclick = () => { bg.remove(); snap(); const k = apply(s, P, mode); refresh(); toast(`Made ${k} section${k === 1 ? "" : "s"} from the cues in “${s.name}”`, undo); };
    };
    document.body.appendChild(bg); draw(); bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
    const key = (e) => { if (!document.body.contains(bg)) { document.removeEventListener("keydown", key, true); return; } if (e.key === "Escape") { e.stopPropagation(); bg.remove(); } }; document.addEventListener("keydown", key, true);
  }

  // ---- in the timeline: "From cues" in the Sections header; ghost sections in an empty Sections lane
  function decorate() {
    document.querySelectorAll(".row.secs > .lh").forEach((lh) => {
      const add = lh.querySelector(".lhadd"), s = add && songOf(add.dataset.song); if (!s || lh.querySelector(".lhcues10")) return;
      if (!(s.cues || []).length) return;
      add.insertAdjacentHTML("beforebegin", `<button class="lhcues10" data-song="${s.id}" title="Make sections from the cues (Verse, Chorus…)">From cues</button>`);
    });
    document.querySelectorAll(".row.secs > .lane[data-song]").forEach((lane) => {
      const s = songOf(lane.dataset.song); if (!s || lane.querySelector(".sec") || lane.querySelector(".ghost10")) return;
      const P = plan(s); if (!P.length) return;
      const xOf = (bar) => s.bars[Math.min(bar, s.total + 1) - 1].t * PXS;
      const h = P.map((p) => `<div class="ghost10" style="left:${xOf(p.start) + 1}px;width:${Math.max(6, xOf(p.start + p.bars) - xOf(p.start) - 2)}px"><span>${esc(p.name)}</span></div>`).join("");
      const at = Math.max((window.TL9 ? TL9.hx : 0) + 8, 8);
      lane.insertAdjacentHTML("beforeend", h + `<div class="gact10" style="left:${at}px"><button class="btn pri" data-gs="${s.id}">✓ Make these ${P.length} sections</button><button class="btn line" data-ge="${s.id}">Edit…</button></div>`);
      const hint = lane.querySelector(".lanehint"); if (hint) hint.hidden = true;
    });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".lhcues10, [data-gs], [data-ge]"); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const s = songOf(b.dataset.song || b.dataset.gs || b.dataset.ge); if (!s) return;
    if (b.dataset.gs) { snap(); const k = apply(s, plan(s), "replace"); refresh(); toast(`Made ${k} sections from the cues in “${s.name}”`, undo); }
    else editor(s);
  }, true);
  document.addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest(".gact10, .lhcues10")) e.stopPropagation(); }, true);
  // after any redraw of the timeline (a zoom frame, a row opening, a refresh): the lanes are new, decorate them again
  let pend = false;
  const later = () => { if (pend) return; pend = true; Promise.resolve().then(() => { pend = false; try { decorate(); } catch (x) {} }); };
  const watch = () => { const sc = $("scroller"); if (sc && !sc._secs10) { sc._secs10 = true; new MutationObserver(later).observe(sc, { childList: true, subtree: true }); } };
  watch(); setTimeout(() => { watch(); later(); }, 300);
  // the Sections row's right-click: its own menu, with Make sections from cues
  document.addEventListener("contextmenu", (e) => {
    const lh = e.target.closest && e.target.closest(".row.secs > .lh"); const lane = !lh && e.target.closest && e.target.closest(".row.secs > .lane"); if (!lh && !(lane && !e.target.closest(".sec"))) return;
    const s = songOf((lh && lh.querySelector(".lhadd") || {}).dataset ? lh.querySelector(".lhadd").dataset.song : lane.dataset.song); if (!s) return;
    e.preventDefault(); e.stopImmediatePropagation();
    ctxMenu(e, [{ label: "Add section", icon: "＋", key: "", act: () => addSecAt(s, playId === s.id ? barAtTime(s, pos) : 1) }, { label: "Make sections from cues…", icon: "✨", dis: !can(s), act: () => editor(s) }]);
  }, true);

  // ---- after an Ableton import: one offer for the songs that have section cues but no sections
  if (window.SLAble) {
    const FIN = SLAble.finish, ADD = SLAble.add; let lastAdded = [];
    SLAble.add = function () { const r = ADD.apply(this, arguments); lastAdded = r.added || []; return r; };
    const offer = () => { const L = lastAdded.map(songOf).filter((s) => s && !(s.secs || []).length && can(s)); const f = $("abwF"); if (!L.length || !f || f.querySelector("#abSecs10")) return;
      f.insertAdjacentHTML("afterbegin", `<button class="btn line" id="abSecs10">Make sections from cues for ${L.length} song${L.length > 1 ? "s" : ""}</button>`);
      $("abSecs10").onclick = () => { batch(L); $("abSecs10").disabled = true; $("abSecs10").textContent = "Sections made ✓"; }; };
    SLAble.finish = function () { const r = FIN.apply(this, arguments); try { offer(); } catch (e) {} return r; };
  }
  window.SLSecs = { words, plan, apply, fromCues, batch, editor, can, decorate };
})();
