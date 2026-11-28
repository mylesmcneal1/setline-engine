// set.Line 15 §10: play and restart in Folders, as in Cards and the song's header (mockup f4-folders-restart.png).
// - The playing song's row always shows the group: ⟲ restart, ■ stop, the current bar. Hovering any other row shows
//   ⟲ restart (cue it from bar 1 and play) and ▶ play. (ED13's group: the same buttons, keys and tooltips.)
// - The row's ⋯ menu and right-click: Play / Stop and Restart from bar 1 (also in the Cards' menus); ⌥Space restarts
//   the selected song (ED13).
// - Folders against Cards: a row takes keyboard focus as a card does (↑ ↓ move, ↩ renames: conventions §11) and shows
//   the track count, as a card does.
(() => {
  "use strict";
  const songOf = (id) => songs.find((x) => x.id === id) || null;
  function decorate() {
    if (!window.ED13) return;
    let n = 0;
    document.querySelectorAll(".row9 > .r9h[data-id]").forEach((h) => {
      const id = h.dataset.id, s = songOf(id); if (!s) return;
      if (!h.querySelector(".tr13")) { const sp = document.createElement("span"); sp.innerHTML = ED13.trHTML(id); const g = sp.firstChild; g.classList.add("fo15"); const x = h.querySelector(".r9x"); if (x) h.insertBefore(g, x); else h.appendChild(g); n++; }
      if (!h.hasAttribute("tabindex")) h.tabIndex = 0; // keyboard focus: ↑ ↓ move, ↩ renames (conventions §11), as on a card
      const t = h.querySelector(".r9t"); if (t && !t.dataset.fo15) { t.dataset.fo15 = "1"; const nt = s.tracks.length; t.textContent = [t.textContent === "–" ? "" : t.textContent, `${nt} track${nt === 1 ? "" : "s"}`].filter(Boolean).join(" · "); }
    });
    if (n && ED13.trUpdate) ED13.trUpdate();
  }
  addEventListener("DOMContentLoaded", () => { const R = window.renderFolders; if (typeof R === "function" && !R._fo15) { window.renderFolders = function () { const r = R.apply(this, arguments); try { decorate(); } catch (e) {} return r; }; window.renderFolders._fo15 = true; } });
  setInterval(decorate, 300);

  // the row's ⋯ / right-click (songMenu) and the menus' song items: Play / Stop and Restart from bar 1
  const playing_ = (id) => typeof playing !== "undefined" && playing && playId === id;
  const play = (id) => { const s = songOf(id); if (!s) return; if (playing_(id)) { toggle(); return; } if (playing) toggle(); ED13.playSong(s); };
  const restart = (id) => { const s = songOf(id); if (!s) return; if (playing) toggle(); ED13.playSong(s, 0); };
  addEventListener("DOMContentLoaded", () => {
    const SM = window.songMenu; if (typeof SM === "function" && !SM._fo15) {
      window.songMenu = function (e, id, where) {
        if (typeof songSel !== "undefined" && songSel.size > 1 && songSel.has(id)) return SM.apply(this, arguments);
        const C0 = window.ctxMenu; window.ctxMenu = function (at, items) { window.ctxMenu = C0; return C0.call(this, at, [{ label: playing_(id) ? "Stop" : "Play", icon: playing_(id) ? "■" : "▶", key: "Space", act: () => play(id) }, { label: "Restart from bar 1", icon: "⟲", key: "⌥Space", act: () => restart(id) }, "-", ...items]); };
        try { return SM.apply(this, arguments); } finally { window.ctxMenu = C0; }
      };
      window.songMenu._fo15 = true;
    }
  });
  window.SL15F = { decorate, play, restart };
})();
