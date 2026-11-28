// set.Line 15 §12: click accents (mockup docs/design/phase15/ac.png, approved). The click editor's header: Fill (¼, ⅛,
// 1/16, Triplets) and Accents ▾ (also on the right-click of a selection):
// - First beat of the bar only (as before): ONE e & a 2 e & a
// - Every beat: ONE e & a TWO e & a (beat 1 the accent, every beat a beat, the rest subdivisions)
// - Every half bar: ONE … THREE …
// - Custom: one bar of steps at the fill; tap a step to cycle Accent → Click → Off (odd meters, 3+3+2…).
// Three levels: Accent, Beat, Subdivision (velocity, %). Applied to the selection's bars or the whole song. The result
// is ordinary notes on the Accent and Click lanes, edited by hand as before; one undo step. The clip keeps its accent
// choice (C.acc), so choosing another fill applies it again with the same accents.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const FILLS = [["quarter", "¼", 960], ["eighth", "⅛", 480], ["sixteenth", "1/16", 240], ["triplet", "Triplets", 320]];
  const MODES = [["first", "First beat of the bar only", "ONE e & a 2 e & a"], ["beat", "Every beat", "ONE e & a TWO e & a"], ["half", "Every half bar", "ONE … THREE …"], ["custom", "Custom pattern — tap the steps below", ""]];
  const SHORT = { first: "First beat", beat: "Every beat", half: "Every half bar", custom: "Custom" };
  const C = () => window.SLClick;
  const ed = () => (C() && C().editing ? C().editing() : null);
  const songOf = (id) => songs.find((x) => x.id === id);
  const DEF = { mode: "first", fill: "sixteenth", lv: { a: 100, b: 75, s: 50 }, steps: null };
  const cfgOf = (s, t) => { const v = C().view(s, t); return { ...DEF, ...(v.acc || {}), lv: { ...DEF.lv, ...((v.acc || {}).lv || {}) } }; };
  const stepTk = (fill) => (FILLS.find((f) => f[0] === fill) || FILLS[2])[2];
  // the steps of one bar (bar index b, 1-based) at a fill: [{tk, k, beat: on a beat, one: the bar's first}]
  function barSteps(s, bar, fill) {
    const S = C(), b0 = S.barTk(s, bar), b1 = S.barTk(s, bar + 1), st = stepTk(fill), sig = s.bars[bar - 1].sig, beat = S.PPQ * 4 / sig[1], out = [];
    for (let k = 0; b0 + k * st < b1 - 1; k++) { const tk = Math.round(b0 + k * st), off = tk - b0; out.push({ tk, k, one: k === 0, beat: Math.abs(off / beat - Math.round(off / beat)) < 1e-3, half: Math.abs(off - Math.ceil(sig[0] / 2) * beat) < 1 }); }
    return out;
  }
  // what each step is for a mode: "A" (accent lane), "C" (click lane) or "-" (nothing)
  function patternFor(cfg, steps) {
    if (cfg.mode === "custom" && Array.isArray(cfg.steps) && cfg.steps.length) return steps.map((x, i) => cfg.steps[i % cfg.steps.length] || "-");
    return steps.map((x) => (x.one ? "A" : cfg.mode === "beat" && x.beat ? "A" : cfg.mode === "half" && x.half ? "A" : "C"));
  }
  // the default custom pattern: the current mode's first bar
  const customFrom = (s, cfg) => patternFor({ ...cfg, mode: cfg.mode === "custom" ? "beat" : cfg.mode }, barSteps(s, 1, cfg.fill));
  const vel = (pct) => Math.max(1, Math.min(127, Math.round(127 * pct / 100)));
  // the notes for bars [from, to) ticks: replaces what's there
  function apply(s, t, from, to, cfg) {
    const S = C(), clip = S.keep(s, t), first = S.barOf(s, from).bar;
    clip.notes = clip.notes.filter((n) => n.tk < from || n.tk >= to);
    for (let bar = first; bar <= s.total; bar++) {
      if (S.barTk(s, bar) >= to) break;
      const st = barSteps(s, bar, cfg.fill), pat = patternFor(cfg, st);
      st.forEach((x, i) => { const p = pat[i]; if (p === "-" || x.tk < from || x.tk >= to) return; clip.notes.push({ tk: x.tk, a: p === "A" ? 1 : 0, v: vel(x.one ? cfg.lv.a : x.beat ? cfg.lv.b : cfg.lv.s), len: 120 }); });
    }
    clip.notes.sort((p, q) => p.tk - q.tk || q.a - p.a); clip.acc = JSON.parse(JSON.stringify(cfg)); clip.sig = S.sigKey(s);
    return clip;
  }
  const selSpan = (s, t) => { const e = ed(); if (!e || !e.sel.length) return null; const S = C(), tks = e.sel.map((n) => n.tk); return [S.barTk(s, S.barOf(s, Math.min(...tks)).bar), S.barTk(s, S.barOf(s, Math.max(...tks)).bar + 1)]; };
  function run(s, t, where, cfg, what) {
    const S = C(), span = where === "sel" ? selSpan(s, t) : [0, S.endTk(s)]; if (!span) { toast("Select some click notes first (or apply to the whole song)"); return; }
    snap(); apply(s, t, span[0], span[1], cfg); const bars = [S.barOf(s, span[0]).bar, S.barOf(s, span[1] - 1).bar];
    toast(`${what || "Accents: " + SHORT[cfg.mode].toLowerCase()} · ${FILLS.find((f) => f[0] === cfg.fill)[1]} · ${where === "sel" ? `bars ${bars[0]}–${bars[1]}` : "whole song"} in “${s.name}”`, undo);
    redraw();
  }
  const redraw = () => { if (C().draw) C().draw(); document.querySelectorAll("canvas[data-t]").forEach((cv) => { const s = songOf(cv.dataset.song), t = s && s.tracks[+cv.dataset.t]; if (s && t && ROLE[t] === "click") window.drawLane(cv); }); decorate(true); };
  // the clip's choice changes without new notes (the levels, the custom steps): saved with the clip, one undo step
  const keepCfg = (s, t, cfg) => { snap(); C().keep(s, t).acc = JSON.parse(JSON.stringify(cfg)); };

  // a popover filled after popAt placed it: inside the window
  const fitPop = (p, a) => { const w = p.offsetWidth, h = p.offsetHeight; p.style.left = Math.max(8, Math.min(innerWidth - w - 8, a.left)) + "px"; p.style.top = Math.max(8, Math.min(innerHeight - h - 8, a.top)) + "px"; };
  // ---------------------------------------------------------------- the popover (ac.png)
  let POP = null;
  function open(anchor) {
    const e = ed(); if (!e) return; const s = songOf(e.song), t = e.track; if (!s) return;
    let cfg = cfgOf(s, t); if (!cfg.steps || cfg.mode !== "custom") cfg.steps = customFrom(s, cfg);
    const draw = (p) => {
      const st = barSteps(s, 1, cfg.fill), pat = cfg.mode === "custom" ? st.map((x, i) => cfg.steps[i % cfg.steps.length] || "-") : patternFor(cfg, st);
      const per = st.length / (s.bars[0].sig[0] || 4), lab = (x) => (x.beat ? String(Math.round(x.k / per) + 1) : per >= 4 ? ["", "e", "&", "a"][x.k % 4] : per === 3 ? ["", "&", "a"][x.k % 3] : "&");
      p.innerHTML = `<div class="ac15"><h5>Accents</h5>${MODES.map(([k, n, h]) => `<button class="ac15m ${cfg.mode === k ? "on" : ""}" data-m="${k}" role="radio" aria-checked="${cfg.mode === k}"><i></i><span>${n}</span><em>${h}</em></button>`).join("")}
        <h5>Pattern · 1 bar · tap to cycle: accent → click → off <span class="ac15fill segm">${FILLS.map(([k, n]) => `<button data-f="${k}" class="${cfg.fill === k ? "on" : ""}">${n}</button>`).join("")}</span></h5>
        <div class="ac15steps" style="grid-template-columns:repeat(${st.length},minmax(0,1fr))">${st.map((x, i) => `<button data-i="${i}" class="ac15s ${pat[i] === "A" ? (x.one ? "A1" : "A") : pat[i] === "C" ? "C" : "off"}" title="${pat[i] === "A" ? "Accent" : pat[i] === "C" ? "Click" : "Off"}"><i></i><span>${lab(x)}</span></button>`).join("")}</div>
        <div class="ac15lv">${[["a", "Accent level"], ["b", "Beat level"], ["s", "Subdivision level"]].map(([k, n]) => `<label>${n} <input type="number" min="1" max="100" step="5" value="${cfg.lv[k]}" data-lv="${k}"><b>%</b></label>`).join("")}</div>
        <div class="ac15a"><button class="btn line" data-a="sel" title="The bars of the selected notes">Apply to selection</button><button class="btn line" data-a="song">Apply to whole song</button><span style="flex:1"></span><button class="btn pri" data-a="done">Done</button></div></div>`;
      p.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { cfg.mode = b.dataset.m; if (cfg.mode === "custom" && !cfg.steps) cfg.steps = customFrom(s, cfg); draw(p); }));
      p.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { const old = cfg.fill; cfg.fill = b.dataset.f; if (cfg.mode === "custom" && old !== cfg.fill) cfg.steps = customFrom(s, { ...cfg, mode: "beat" }); draw(p); }));
      p.querySelectorAll(".ac15s").forEach((b) => (b.onclick = () => { if (cfg.mode !== "custom") { cfg.steps = pat.slice(); cfg.mode = "custom"; } const i = +b.dataset.i, cur = cfg.steps[i] || "-"; cfg.steps[i] = cur === "A" ? "C" : cur === "C" ? "-" : "A"; draw(p); }));
      p.querySelectorAll("[data-lv]").forEach((i) => (i.onchange = () => { cfg.lv[i.dataset.lv] = Math.max(1, Math.min(100, Math.round(+i.value || 0))); i.value = cfg.lv[i.dataset.lv]; }));
      p.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => { const a = b.dataset.a; if (a === "done") { closePops(); return; } run(s, t, a, cfg); }));
    };
    POP = popAt(anchor, "", (p) => { p.classList.add("ac15pop"); draw(p); fitPop(p, anchor); });
  }

  // ---------------------------------------------------------------- the header: Fill and Accents ▾ (replace Fill ▾ / Pattern ▾)
  function decorate(force) {
    const p = $("clk10"), e = ed(); if (!p || !e) return; const h = p.querySelector(".ch10"); if (!h) return;
    const s = songOf(e.song); if (!s) return; const cfg = cfgOf(s, e.track);
    let box = h.querySelector(".ac15h");
    if (!box) { box = document.createElement("span"); box.className = "ac15h"; const at = h.querySelector(".cfill10"); h.insertBefore(box, at || h.querySelector(".link13")); force = true;
      h.querySelectorAll(".cfill10, .cpat10").forEach((x) => (x.style.display = "none")); }
    const key = cfg.mode + cfg.fill; if (!force && box.dataset.k === key) return; box.dataset.k = key;
    box.innerHTML = `<span class="clab10">Fill</span><div class="seg10 ac15fills">${FILLS.map(([k, n]) => `<button data-f="${k}" class="${cfg.fill === k ? "on" : ""}" title="Fill the ${selSpan(s, e.track) ? "selected bars" : "song"} with ${n === "Triplets" ? "8th triplets" : n + " notes"}, with these accents">${n}</button>`).join("")}</div><button class="btn line ac15b" title="Accents: first beat, every beat, half bar or your own pattern">Accents: ${SHORT[cfg.mode]} ▾</button>`;
    box.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { const c2 = { ...cfgOf(s, e.track), fill: b.dataset.f }; if (c2.mode === "custom" && c2.fill !== cfgOf(s, e.track).fill) c2.steps = customFrom(s, { ...c2, mode: "beat" }); run(s, e.track, selSpan(s, e.track) ? "sel" : "song", c2, `Filled with ${b.textContent === "Triplets" ? "triplets" : b.textContent + " notes"}`); }));
    box.querySelector(".ac15b").onclick = (ev) => { const r = ev.currentTarget.getBoundingClientRect(); open({ left: r.left, right: r.left, top: r.bottom + 6 }); };
  }
  setInterval(() => decorate(false), 200);
  // at once when the editor opens (not on the next tick)
  const hook = () => { const S = C(); if (!S || S.open._ac15) return; const O = S.open; S.open = function () { const r = O.apply(this, arguments); try { decorate(true); } catch (e) {} return r; }; S.open._ac15 = true; };
  hook(); addEventListener("DOMContentLoaded", hook);
  // the ⋯ menu keeps what Fill ▾ / Pattern ▾ did that the header no longer shows
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("#clk10 .cmore10"); if (!b) return; const x = ed(); if (!x) return; const s = songOf(x.song); e.stopImmediatePropagation(); e.preventDefault();
    const r = b.getBoundingClientRect(), at = { clientX: r.left - 160, clientY: r.bottom + 4 }, S = C(), sp = selSpan(s, x.track);
    ctxMenu(at, [{ label: "Accents…", icon: "", act: () => open({ left: r.left - 300, right: r.left - 300, top: r.bottom + 6 }) },
      { label: "Fill from time signature", icon: "", act: () => { snap(); S.fill(s, x.track, 0, S.endTk(s)); toast(`Filled the click from the time signature in “${s.name}”`, undo); redraw(); } },
      { label: "Half-time", icon: "", act: () => { snap(); const a = sp || [0, S.endTk(s)]; S.keep(s, x.track); S.pattern(s, x.track, "half", a[0], a[1]); toast("Filled with half-time", undo); redraw(); } },
      "-", { label: "Clear", icon: "", act: () => { snap(); S.keep(s, x.track).notes = []; toast(`Cleared the click in “${s.name}”`, undo); redraw(); } }]); }, true);
  // right-click in the click editor: Accents… (for the selection)
  document.addEventListener("contextmenu", (e) => { const cv = e.target.closest && e.target.closest("#clk10 canvas.cc10"); if (!cv) return; const x = ed(); if (!x) return; e.preventDefault(); e.stopPropagation();
    ctxMenu(e, [{ cap: x.sel.length ? `${x.sel.length} note${x.sel.length > 1 ? "s" : ""} selected` : "Click" }, { label: "Accents…", icon: "", act: () => open({ left: e.clientX, right: e.clientX, top: e.clientY }) }]); }, true);

  window.SL15A = { open, apply, barSteps, patternFor, cfgOf, run: (where, cfg) => { const x = ed(); if (!x) return; const s = songOf(x.song); run(s, x.track, where, { ...cfgOf(s, x.track), ...cfg }); }, FILLS, MODES, keepCfg };
})();
