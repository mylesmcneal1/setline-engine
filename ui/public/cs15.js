// set.Line 15 §1: Cues › Speed… (mockup docs/design/phase15/cs.png). How fast the natural voices (Kokoro) say the cue
// words: 0.75× to 1.5× (1× by default), Fixed, or Follow tempo (each song's speed is scaled by its tempo against
// 120 BPM, kept inside the slider's range). Your recordings always play as recorded. One setting for the library
// (CUEV.speed, CUEV.speedMode, saved with it); every change is one undo step.
// A change renders the words again in the background (never at Play: Phase 14): the status chip counts them, and the
// old words play until the new ones are ready (the app keeps them; app-gui/Cues.cpp cachedAnySpeed).
(() => {
  "use strict";
  const MIN = 0.75, MAX = 1.5;
  const CV = () => (typeof CUEV !== "undefined" ? CUEV : {});
  const clamp = (v) => Math.max(MIN, Math.min(MAX, Math.round(v * 100) / 100));
  const mode = () => (CV().speedMode === "tempo" ? "tempo" : "fixed");
  const base = () => clamp(+CV().speed || 1);
  // the speed song s's words are rendered at (base: a cue's own voice speed, else the library's)
  function speedFor(s, b) {
    const sp = clamp(+b || base());
    if (mode() !== "tempo" || !s || !s.tmap || !s.tmap[0]) return sp;
    return clamp(sp * (+s.tmap[0].bpm || 120) / 120);
  }
  const fmt = (v) => v.toFixed(2).replace(/0$/, "") + "×";

  // ---------------------------------------------------------------- the popover
  function open(at) {
    const s = songs.find((x) => x.id === selId) || songs[0];
    const word = (() => { if (!s) return "Chorus"; const c = (s.cues || []).find((x) => x.text && x.text.trim()); return c ? c.text.trim() : (s.secs || []).find((x) => x.name) ? s.secs.find((x) => x.name).name : "Chorus"; })();
    const html = `<div class="cs15"><div class="cs15h"><b>Cue speed</b><span class="cs15v mono">${fmt(base())}</span></div>
      <input type="range" class="cs15r" min="${MIN}" max="${MAX}" step="0.05" value="${base()}" aria-label="Cue speed">
      <div class="cs15t"><span>0.75×</span><span>1×</span><span>1.5×</span></div>
      <div class="segm cs15m"><button data-m="fixed" class="${mode() === "fixed" ? "on" : ""}">Fixed</button><button data-m="tempo" class="${mode() === "tempo" ? "on" : ""}">Follow tempo</button></div>
      <p class="cs15p">${mode() === "tempo" ? "Follow tempo speeds words up in fast songs so each fits its beat" + (s ? ` (“${esc(s.name)}”: ${fmt(speedFor(s))})` : "") + "." : "Every song's words at this speed."} Natural voices only: your recordings always play as recorded.</p>
      <button class="btn line cs15pv">▶ Preview “${esc(word)}”</button></div>`;
    popAt(at, html, (p) => {
      p.classList.add("cs15pop");
      const r = p.querySelector(".cs15r"), v = p.querySelector(".cs15v");
      const pc = () => r.style.setProperty("--p", ((r.value - MIN) / (MAX - MIN) * 100).toFixed(1) + "%"); pc();
      let snapped = false;
      r.oninput = () => { if (!snapped) { snap(); snapped = true; } CV().speed = +(+r.value).toFixed(2); v.textContent = fmt(+r.value); pc(); };
      r.onchange = () => { snapped = false; done(`Cue speed ${fmt(base())}`); };
      p.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { if (mode() === b.dataset.m) return; snap(); CV().speedMode = b.dataset.m; done(b.dataset.m === "tempo" ? "Cue speed follows each song's tempo" : `Cue speed fixed at ${fmt(base())}`); open(at); }));
      p.querySelector(".cs15pv").onclick = () => { if (s && typeof previewCue === "function") previewCue(s, word); };
    });
  }
  // after a change: the words render again (in the background), the chip counts them
  function done(what) {
    if (typeof refresh === "function") refresh();
    if (window.SLE && SLE.nextChanged) SLE.nextChanged();
    toast(what + " · the words are made again in the background", undo);
    watch();
  }
  let timer = 0;
  async function watch() {
    clearTimeout(timer); const chip = document.getElementById("cs15chip") || (() => { const c = document.createElement("div"); c.id = "cs15chip"; c.setAttribute("role", "status"); document.body.appendChild(c); return c; })();
    if (!window.SLE || !SLE.cueProgress) { chip.hidden = true; return; }
    let first = true;
    const tick = async () => {
      let r = null; try { r = await SLE.cueProgress(first); } catch (e) {} first = false;
      if (!r || !r.total || r.ready >= r.total) { if (r && r.total) { chip.textContent = `Cue words ready (${r.total})`; chip.className = "done"; setTimeout(() => { chip.hidden = true; }, 1800); } else chip.hidden = true; return; }
      chip.hidden = false; chip.className = ""; chip.textContent = `Making cue words at the new speed · ${r.ready} of ${r.total} (the old ones play until then)`;
      timer = setTimeout(tick, 600);
    };
    tick();
  }

  // ---------------------------------------------------------------- Cues › Speed…  (after Count-in)
  const attach = () => {
    if (!window.SL13E || SL13E.menu._cs15) return false;
    const M0 = SL13E.menu;
    SL13E.menu = function (it, sub, sep, head) {
      const L = M0.apply(this, arguments), i = L.findIndex((x) => x && x.label === "Output");
      const item = it("cueSpeed", "Speed…", () => open({ left: innerWidth / 2 - 150, right: innerWidth / 2 - 150, top: 90 }));
      L.splice(i >= 0 ? i : 3, 0, item); return L;
    };
    SL13E.menu._cs15 = true; return true;
  };
  if (!attach()) addEventListener("DOMContentLoaded", attach);
  window.SL15C = { speedFor, open, watch, MIN, MAX };
})();
