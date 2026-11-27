// set.Line 13: what the bottom editors share (click, patch changes; Ableton's detail view).
// §5  Each editor has its own zoom and scroll (a TX view, tx13.js). Opening one frames what the timeline shows; the
//     chain toggle in its header ties it to the timeline (off by default). It follows the playhead inside its own
//     view; ⌘F toggles following for the view that has focus. ⌘ / ⌥ + wheel and the trackpad pinch zoom around the
//     pointer; the wheel and swipes scroll sideways.
// §7  A song's editor closes with the song (collapsed, closed, ← Library / Esc, another song, Perform / Remote) and
//     comes back at the same zoom and scroll when the song opens again.
// §11 Play / stop / restart in the song's header and each editor's header: a thin restart icon (bar 1 and play), a
//     small round play-stop button (a soft green ring while playing) and the current bar.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const store = { get: (k, d) => { try { const v = localStorage.getItem("setline." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("setline." + k, JSON.stringify(v)); } catch (e) {} } };
  const songOf = (id) => (typeof songs !== "undefined" ? songs.find((x) => x.id === id) : null);
  const MINP = 0.4, MAXP = 3000;

  // ---------------------------------------------------------------- views
  const W = new Map(); // id -> {cv, song(), redraw, follow}
  const SAVED = {}; // song id -> {id, track, view}  (§7: reopening the song restores its editor)
  function open(id, s, restore) {
    const m = TX.main(); // frame what the timeline shows (the editor's canvas starts at the lanes' left edge)
    const sv = restore && s && SAVED[s.id] && SAVED[s.id].id === id ? SAVED[s.id].view : null;
    TX.setView(id, sv ? { pxs: sv.pxs, hx: sv.hx, linked: sv.linked } : { pxs: m.pxs, hx: m.hx, linked: !!store.get("edLink." + id, false) });
  }
  function closed(id, s, track) { const v = TX.views.get(id); if (s && v) SAVED[s.id] = { id, track, view: { pxs: v.pxs, hx: v.hx, linked: v.linked } }; }
  const saved = (sid) => SAVED[sid] || null;
  function zoomAt(id, k, ax) {
    const v = TX.view(id); if (v.linked) { if (window.SL9 && SL9.zoomNow) { const sc = $("scroller"), a = sc.scrollLeft + ax, p1 = Math.max(MINP, Math.min(MAXP, PXS * k)); SL9.zoomNow(p1); sc.scrollLeft = a * (p1 / (p1 / k)) - ax; } return; }
    const p1 = Math.max(MINP, Math.min(MAXP, v.pxs * k)), kk = p1 / v.pxs, hx = (v.hx + ax) * kk - ax; // the time under ax stays put
    TX.setView(id, { pxs: p1, hx });
  }
  function scrollBy(id, dx) { const v = TX.view(id); if (v.linked) { $("scroller").scrollLeft += dx; return; } TX.setView(id, { hx: v.hx + dx }); }
  function setLinked(id, on) { const v = TX.view(id), m = TX.main(); TX.setView(id, on ? { linked: true } : { linked: false, pxs: m.pxs, hx: m.hx }); store.set("edLink." + id, !!on); }
  const linked = (id) => !!(TX.views.get(id) || {}).linked;

  // the wheel and gestures over an editor's canvas
  function wire(cv, id, song, redraw) {
    W.set(id, { cv, song, redraw, follow: store.get("edFollow." + id, true) });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault(); e.stopPropagation();
      const ax = TX.local(e, cv);
      if (e.altKey || e.ctrlKey || e.metaKey) { zoomAt(id, Math.exp(-(e.deltaY || e.deltaX) * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025)), ax); }
      else { const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; scrollBy(id, d); unfollowIfPlaying(id); }
      redraw();
    }, { passive: false });
    // WebKit's own pinch (gesturechange) over the editor
    let g0 = null;
    cv.addEventListener("gesturestart", (e) => { e.preventDefault(); e.stopPropagation(); g0 = 1; });
    cv.addEventListener("gesturechange", (e) => { if (g0 == null) return; e.preventDefault(); e.stopPropagation(); const sp = window.SL12 && SL12.speed ? SL12.speed() / 1.9 : 1, k = Math.pow(e.scale, sp) / g0; g0 = Math.pow(e.scale, sp); zoomAt(id, k, TX.local(e, cv)); redraw(); });
    cv.addEventListener("gestureend", (e) => { g0 = null; e.stopPropagation(); });
  }
  // the native pinch (macOS magnify events) lands where the pointer is: an editor zooms itself
  function pinchHere(m) {
    if (!m || m.x == null) return false;
    for (const [id, w] of W) { if (!w.cv.isConnected) continue; const r = w.cv.getBoundingClientRect(); if (m.x < r.left || m.x > r.right || m.y < r.top || m.y > r.bottom) continue;
      const sp = window.SL12 && SL12.speed ? SL12.speed() : 1.9, k = Math.exp((+m.m || 0) * sp);
      if (k !== 1) { zoomAt(id, k, (m.x - r.left) * (w.cv.offsetWidth / (r.width || 1))); w.redraw(); }
      return true; }
    return false;
  }
  // follow the playhead inside each editor's own view (pages, as the timeline does)
  function unfollowIfPlaying(id) { const w = W.get(id); if (w && w.follow && typeof playing !== "undefined" && playing) { w.follow = false; store.set("edFollow." + id, false); if (typeof toast === "function") toast("Follow playhead (editor): off (you scrolled) · ⌘F turns it back on"); } }
  function follow(id, on) { const w = W.get(id); if (!w) return null; if (on === undefined) return w.follow; w.follow = !!on; store.set("edFollow." + id, w.follow); if (typeof toast === "function") toast(`Follow playhead (editor): ${w.follow ? "on" : "off"}`); return w.follow; }
  function tick() {
    if (typeof playing !== "undefined" && playing && typeof pos === "number") for (const [id, w] of W) {
      if (!w.cv.isConnected || !w.follow || linked(id)) continue; const s = w.song(); if (!s || s.id !== playId) continue;
      const v = TX.view(id), x = TX.x(pos, v), vw = w.cv.offsetWidth || 400;
      if (x > vw * 0.92 || x < 0) { TX.setView(id, { hx: pos * v.pxs - vw * 0.08 }); w.redraw(); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  // ⌘F with an editor focused: that editor's Follow
  document.addEventListener("keydown", (e) => {
    const cmd = TX.MAC ? e.metaKey : e.ctrlKey; if (!cmd || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
    for (const [id, w] of W) { const p = w.cv.closest("[data-editor]"); if (p && (p.contains(document.activeElement) || p.contains(e.target))) { e.preventDefault(); e.stopImmediatePropagation(); follow(id, !w.follow); return; } }
  }, true);

  // ---------------------------------------------------------------- the editor header: link toggle
  const CHAIN = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 9.5l3-3"/><path d="M7 4.5l1.2-1.2a2.6 2.6 0 013.7 3.7L10.7 8.2"/><path d="M9 11.5l-1.2 1.2a2.6 2.6 0 01-3.7-3.7L5.3 7.8"/></svg>';
  const linkHTML = (id) => `<button class="btn line link13${linked(id) ? " on" : ""}" data-link="${id}" title="Tie this editor's zoom and scroll to the timeline">${CHAIN}<span>${linked(id) ? "Linked" : "Unlinked"}</span></button>`;
  function bindLink(root, id, redraw) { const b = root.querySelector(`.link13[data-link="${id}"]`); if (!b) return; b.onclick = () => { setLinked(id, !linked(id)); b.classList.toggle("on", linked(id)); b.querySelector("span").textContent = linked(id) ? "Linked" : "Unlinked"; redraw(); }; }

  // ---------------------------------------------------------------- §11 play / stop / restart
  const RESTART = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2 8a4.8 4.8 0 108-3.6"/><path d="M11.6 1.8v2.8H8.8"/></svg>';
  const PLAY = '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M5 3.2v9.6L12.6 8z"/></svg>';
  const STOP = '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.2"/></svg>';
  const trHTML = (sid) => `<span class="tr13" data-song="${sid}"><button class="tr13r" title="Restart from bar 1  ⌥Space" aria-label="Restart">${RESTART}</button><button class="tr13p" title="Play / Stop  Space · ⇧Space plays from the insert line" aria-label="Play">${PLAY}</button><span class="tr13b">1.1</span></span>`;
  function playSong(s, from) {
    if (!s) return;
    if (from != null) locate(s, from);
    else if (typeof playId === "undefined" || playId !== s.id) { const ins = window.SL12 && SL12.insert ? SL12.insert(s) : null; locate(s, ins != null ? ins : 0); }
    if (!playing) toggle();
  }
  function trClick(e) {
    const b = e.target.closest && e.target.closest(".tr13 button"); if (!b) return;
    e.preventDefault(); e.stopPropagation(); const s = songOf(b.closest(".tr13").dataset.song); if (!s) return;
    if (b.classList.contains("tr13r")) { if (playing && playId === s.id) toggle(); playSong(s, 0); return; }
    if (playing && playId === s.id) toggle(); else { if (playing) toggle(); playSong(s); }
  }
  document.addEventListener("click", trClick, true);
  document.addEventListener("pointerdown", (e) => { if (e.target.closest && e.target.closest(".tr13 button")) e.stopPropagation(); }, true);
  let trLast = "";
  function trUpdate() {
    const els = document.querySelectorAll(".tr13"); if (!els.length) return;
    const k = [playing, playId, typeof pos === "number" ? pos.toFixed(2) : "", els.length].join();
    if (k === trLast) return; trLast = k;
    els.forEach((el) => { const s = songOf(el.dataset.song); if (!s) return; const on = !!(playing && playId === s.id); el.classList.toggle("on", on);
      const p = el.querySelector(".tr13p"); if (p.dataset.on !== String(on)) { p.dataset.on = String(on); p.innerHTML = on ? STOP : PLAY; p.setAttribute("aria-label", on ? "Stop" : "Play"); }
      const t = playId === s.id && typeof pos === "number" ? pos : (window.SL12 && SL12.insert && SL12.insert(s)) || 0; let bb = null; try { bb = barBeatAt(s, t); } catch (x) {}
      el.querySelector(".tr13b").textContent = bb ? `${bb.bar}.${Math.floor(bb.beat + 1e-6)}` : "1.1"; });
  }
  setInterval(trUpdate, 100);
  // the song's header: the group goes next to the title (Show, one song or each open song in Folders)
  function decorate() {
    let n = 0;
    const add = (host, after, sid) => { if (!host || host.querySelector('.tr13')) return; const sp = document.createElement('span'); sp.innerHTML = trHTML(sid); const el = sp.firstChild; if (after && after.parentElement === host) after.after(el); else host.appendChild(el); n++; };
    const FS = typeof focusSong === 'function' ? focusSong() : null, h = document.querySelector('#hero .htitle');
    if (FS && h) add(h, h.querySelector('h2'), FS.id);
    document.querySelectorAll('.folder[data-id] > .fhead .fh').forEach((fh) => { const f = fh.closest('.folder'); if (songOf(f.dataset.id)) add(fh, fh.querySelector('.fnm'), f.dataset.id); });
    if (n) { trLast = ''; trUpdate(); }
  }
  setInterval(decorate, 250);
  // keys: ⇧Space plays from the insert line, ⌥Space restarts from bar 1 (Space and ↩ as before)
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.metaKey || e.ctrlKey || (!e.shiftKey && !e.altKey)) return;
    const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    const s = typeof focusSong === "function" ? focusSong() : null, s2 = s || (typeof selId !== "undefined" ? songOf(selId) : null); if (!s2) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.altKey) { if (playing) toggle(); playSong(s2, 0); return; }
    const ins = window.SL12 && SL12.insert ? SL12.insert(s2) : null; if (playing) toggle(); playSong(s2, ins != null ? ins : (playId === s2.id ? pos : 0));
  }, true);

  // ---------------------------------------------------------------- §7 a song's editors close with the song
  // Each bottom editor registers: what it has open ({song, track} or null), how to close it, how to open it again.
  const KINDS = new Map(); const PEND = {}; // song id -> {kind, track} to bring back when the song shows again
  function register(kind, o) { KINDS.set(kind, o); }
  const showTab = () => { const a = document.querySelector('.tabs a.on[data-tab]'); return !a || a.dataset.tab === 'show'; };
  function songShown(id) {
    if (!showTab()) return false;
    const FS = typeof focusSong === 'function' ? focusSong() : null; if (FS) return FS.id === id;
    return !!document.querySelector('.folder.open[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  }
  function closePops() { document.querySelectorAll('.ipop, .xm.ctx, .pop13').forEach((x) => x.remove()); if (typeof closeTpop === 'function') try { closeTpop(); } catch (e) {} const mp = document.getElementById('mpop'); if (mp) mp.style.display = 'none'; }
  function watch() {
    for (const [kind, o] of KINDS) {
      const cur = o.current(); if (!cur) continue;
      if (!songShown(cur.song)) { PEND[cur.song] = { kind, track: cur.track }; o.close(true); closePops(); }
    }
    for (const id of Object.keys(PEND)) {
      if (!songShown(id)) continue; const p = PEND[id]; delete PEND[id];
      const o = KINDS.get(p.kind), s = songOf(id); if (!o || !s || [...KINDS.values()].some((k) => k.current())) continue;
      o.reopen(s, p.track); // at the zoom and scroll it had (closed() saved them)
    }
  }
  setInterval(watch, 150);
  const forget = (id) => { delete PEND[id]; };

  window.ED13 = { register, songShown, forget, watch, pending: () => ({ ...PEND }), open, closed, saved, wire, zoomAt, scrollBy, setLinked, linked, follow, pinchHere, linkHTML, bindLink, trHTML, decorate, trUpdate, playSong, views: W };
  // wrap the pinch when fix12 has loaded; the header group goes in as the song header is drawn (not a moment later)
  addEventListener("DOMContentLoaded", () => {
    for (const k of ["renderHero", "renderFolders"]) { const f0 = window[k]; if (typeof f0 === "function" && !f0._ed13) { window[k] = function () { const r = f0.apply(this, arguments); try { decorate(); } catch (e) {} return r; }; window[k]._ed13 = true; } }
 if (window.SL12 && SL12.pinch && !SL12.pinch._ed13) { const P0 = SL12.pinch; let mine = false; SL12.pinch = function (m) { const ph = m && String(m.phase || ""); if (ph === "begin") mine = pinchHere(m); else if (mine) { if (ph === "end" || ph === "cancel") mine = false; else pinchHere(m); return; } if (mine) return; return P0.apply(this, arguments); }; SL12.pinch._ed13 = true; } });
})();
