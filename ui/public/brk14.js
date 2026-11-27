// set.Line 14 §1: one popup for a break (mockup docs/design/phase14/bk2.png), anchored next to its setlist row.
// The same popup for + Break, ⌘B / Setlist › Add break, double-clicking a break, Setlist › Edit break…, the break's
// right-click › Edit… and ⌘K. Name (quick-label chips fill it), Length (m:ss or seconds, ▲▼ 5 s, ⇧ 30 s, presets),
// a note for the band, and what happens when the time runs out. ↩ saves, Esc (or clicking away) cancels; a new break
// is only added on save, as one undo step.
(() => {
  "use strict";
  const B = () => window.SLBreaks;
  const PRESETS = [30, 45, 75, 120, 300];
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t) % 60).padStart(2, "0")}`;
  // "1:15", "75", "1:5" (1:05), " 2:00 " -> seconds; null if it isn't a time
  function parseLen(v) {
    const m = String(v || "").trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/); if (!m) return null;
    const s = m[2] !== undefined ? +m[1] * 60 + +m[2] : +m[1];
    return s >= 1 && s <= 7200 ? s : null;
  }
  let POP = null; // {el, id (edit) | null (new), place: {after, row}}

  function close() { if (!POP) return; const p = POP; POP = null; p.el.remove(); document.removeEventListener("pointerdown", p.off, true); }
  const songName = (id) => { const s = typeof songs !== "undefined" && songs.find((x) => x.id === id); return s ? s.name : ""; };
  const rowOf = (id) => document.querySelector(`#songs .brk9[data-b="${id}"]`);
  const songRow = (id) => document.querySelector(`#songs .song[data-id="${id}"]`);

  // open: {id} edits that break; {} adds a new one where + Break would put it (after the selected item, or at the end)
  function open(o) {
    o = o || {}; close();
    const L = B(); if (!L) return false;
    const b = o.id ? L.list().find((x) => x.id === o.id) : null;
    if (o.id && !b) return false;
    const place = b ? { after: b.after } : L.placeNew();
    const v = b ? { label: b.label, len: +b.len || 60, note: b.note || "", runout: b.runout === "start" ? "start" : "wait" } : { label: "", len: 45, note: "", runout: "wait" };
    const el = document.createElement("div"); el.className = "bk14"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", b ? "Edit break" : "New break");
    const after = place.after ? songName(place.after) : "";
    el.innerHTML = `<i class="bk14arr"></i>
      <div class="bk14h"><span class="bk14ico" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.2"/><path d="M6.5 5.6v4.8M9.5 5.6v4.8"/></svg></span>
        <b class="bk14t">${b ? "Edit break" : "New break"}</b><span class="bk14at">${after ? "after " + esc(after) : b ? "" : "at the start"}</span></div>
      <label class="bk14l" for="bk14name">Name</label>
      <input id="bk14name" class="bk14in" maxlength="24" spellcheck="false" autocomplete="off" placeholder="Gear change" value="${esc(v.label)}">
      <div class="bk14chips">${L.LABELS.map((x) => `<button type="button" data-l="${x}">${x}</button>`).join("")}</div>
      <label class="bk14l" for="bk14len">Length</label>
      <div class="bk14len"><input id="bk14len" class="mono" spellcheck="false" autocomplete="off" aria-label="Length (m:ss or seconds)" value="${mmss(v.len)}">
        <span class="bk14step"><button type="button" data-d="1" title="5 s longer (⇧ 30 s)" aria-label="Longer">▲</button><button type="button" data-d="-1" title="5 s shorter (⇧ 30 s)" aria-label="Shorter">▼</button></span>
        <span class="bk14pre">${PRESETS.map((x) => `<button type="button" class="mono" data-s="${x}">${mmss(x)}</button>`).join("")}</span></div>
      <label class="bk14l" for="bk14note">Note for the band <small>(optional)</small></label>
      <input id="bk14note" class="bk14in" maxlength="200" spellcheck="false" autocomplete="off" placeholder="Brett: baritone, capo off" value="${esc(v.note)}">
      <label class="bk14l">When the time runs out</label>
      <div class="bk14seg" role="radiogroup"><button type="button" data-r="wait">Wait for Play</button><button type="button" data-r="start">Start next song</button></div>
      <div class="bk14f">${b ? `<button type="button" class="bk14more" title="Play a loop during the break, send the next song's presets at its start">More…</button>` : ""}<span style="flex:1"></span><button type="button" class="btn line bk14c">Cancel</button><button type="button" class="btn pri bk14ok">${b ? "Save" : "Add break"} <span aria-hidden="true">↩</span></button></div>`;
    document.body.appendChild(el);
    const $q = (s) => el.querySelector(s), name = $q("#bk14name"), len = $q("#bk14len"), note = $q("#bk14note");
    const paint = () => {
      const s = parseLen(len.value); len.classList.toggle("bad", s === null);
      el.querySelectorAll(".bk14pre button").forEach((x) => x.classList.toggle("on", +x.dataset.s === s));
      el.querySelectorAll(".bk14chips button").forEach((x) => x.classList.toggle("on", x.dataset.l === name.value.trim()));
      el.querySelectorAll(".bk14seg button").forEach((x) => { x.classList.toggle("on", x.dataset.r === v.runout); x.setAttribute("aria-checked", String(x.dataset.r === v.runout)); });
    };
    const step = (d, big) => { const s = parseLen(len.value) ?? v.len, k = big ? 30 : 5; len.value = mmss(Math.max(5, Math.min(7200, d > 0 ? Math.floor(s / k) * k + k : Math.ceil(s / k) * k - k))); paint(); };
    el.querySelectorAll(".bk14chips button").forEach((x) => x.onclick = () => { const was = name.value.trim(); name.value = x.dataset.l;
      // a quick label also brings its usual length while the length is still the previous label's (or untouched)
      const s = parseLen(len.value); if (!b && (s === 45 || s === L.DEFLEN[was])) len.value = mmss(L.DEFLEN[x.dataset.l] || s);
      paint(); name.focus(); });
    el.querySelectorAll(".bk14step button").forEach((x) => { x.onpointerdown = (e) => e.preventDefault(); x.onclick = (e) => step(+x.dataset.d, e.shiftKey); });
    el.querySelectorAll(".bk14pre button").forEach((x) => x.onclick = () => { len.value = mmss(+x.dataset.s); paint(); });
    el.querySelectorAll(".bk14seg button").forEach((x) => x.onclick = () => { v.runout = x.dataset.r; paint(); });
    len.oninput = paint; name.oninput = paint;
    len.onblur = () => { const s = parseLen(len.value); if (s !== null) len.value = mmss(s); };
    const save = () => {
      const s = parseLen(len.value); if (s === null) { len.classList.add("bad"); len.focus(); len.select(); return false; }
      const lab = (name.value.trim() || "Break").slice(0, 24), vals = { label: lab, len: Math.max(5, s), note: note.value.trim().slice(0, 200), runout: v.runout };
      const id = POP && POP.id; close();
      if (id) { const bk = L.list().find((x) => x.id === id); if (!bk) return false; if (["label", "len", "note", "runout"].every((k) => bk[k] === vals[k] || (k === "note" && !bk.note && !vals.note))) return true; snap(); Object.assign(bk, vals); L.select(id); refresh(); toast(`Changed the break “${lab}”`, undo); }
      else { const nb = L.add(lab, null, vals); toast(`Added the break “${nb.label}” (${mmss(nb.len)})`, undo); }
      return true;
    };
    $q(".bk14ok").onclick = save; $q(".bk14c").onclick = () => close();
    if ($q(".bk14more")) $q(".bk14more").onclick = () => { const id = POP.id; if (!save()) return; if (window.SL13D) { L.select(id); SL13D.openDetails(rowOf(id)); } };
    el.addEventListener("keydown", (e) => {
      e.stopPropagation(); // the page's single keys (Space, N, ⌫…) don't fire while the popup has the keyboard
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); save(); return; }
      if (e.target === len && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); step(e.key === "ArrowUp" ? 1 : -1, e.shiftKey); }
    });
    // where: beside the setlist row it belongs to (the break, or the song it comes after), arrow pointing at it
    const row = (b && rowOf(b.id)) || (place.after && songRow(place.after)) || document.getElementById("addBreak9") || null;
    const r = row && row.getClientRects().length ? row.getBoundingClientRect() : null, side = document.getElementById("songs");
    const sr = side && side.getClientRects().length ? side.getBoundingClientRect() : null;
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = r ? Math.max(8, Math.min(innerWidth - w - 8, (sr ? sr.right : r.right) + 12)) : Math.round((innerWidth - w) / 2);
    const cy = r ? (r.top + r.bottom) / 2 : innerHeight / 2, y = Math.max(8, Math.min(innerHeight - h - 8, Math.round(cy - 74)));
    el.style.left = x + "px"; el.style.top = y + "px";
    const arr = $q(".bk14arr"); if (r) arr.style.top = Math.max(14, Math.min(h - 26, cy - y - 7)) + "px"; else arr.hidden = true;
    const off = (e) => { if (!el.contains(e.target)) close(); };
    POP = { el, id: b ? b.id : null, off };
    setTimeout(() => { if (POP && POP.el === el) document.addEventListener("pointerdown", off, true); }, 0);
    paint(); name.focus(); name.select();
    return true;
  }
  // double-click a break row: the first click re-renders the setlist (it selects the break), so the second click lands
  // on a new element and the browser sends no dblclick. Two presses on the same break within 450 ms open it.
  let last = { id: null, t: 0, x: 0, y: 0 };
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; const r = e.target.closest && e.target.closest("#songs .brk9[data-b]"); if (!r || e.target.closest("input, [contenteditable]")) { last.id = null; return; }
    const id = r.dataset.b, now = performance.now();
    if (last.id === id && now - last.t < 450 && Math.abs(e.clientX - last.x) < 6 && Math.abs(e.clientY - last.y) < 6) { last.id = null; e.preventDefault(); setTimeout(() => edit(id), 0); return; }
    last = { id, t: now, x: e.clientX, y: e.clientY };
  }, true);
  function edit(id) { if (POP && POP.id === id) return true; return open({ id }); }
  window.SL14B = { open, edit, add: () => open({}), close, isOpen: () => !!POP, el: () => POP && POP.el, parseLen };
})();
