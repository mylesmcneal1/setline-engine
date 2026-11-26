// set.Line 9c: the menus (File · Edit · View · Song · Setlist · Customize · Window · Help, and the macOS app menu).
// Described here from the page's state and sent to the app, which shows them in the macOS menu bar or the Windows
// window's menu bar (no in-app menu button any more). An item's command comes back as a "menu" event "m:<id>".
// Shortcuts: shown in the menus; the page handles the keys itself (below), so they work while it has focus.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const MAC = /Mac/.test(navigator.platform);
  const native = () => typeof NATIVE !== "undefined" && NATIVE && typeof ncall === "function";
  const mod = () => (window.SLE && SLE.mod) || {};
  const song = () => songs.find((x) => x.id === (focusId || selId)) || null;
  const busy = () => typeof playing !== "undefined" && playing;
  let ACT = {}, libs = [];
  const it = (id, label, act, o = {}) => { ACT[id] = act; return { id: "m:" + id, label, key: o.key || "", dis: !!o.dis, check: !!o.check }; };
  const sep = () => ({ sep: true });
  const sub = (label, items, dis) => ({ label, sub: items, dis: !!dis });
  const tab = (t) => { const a = document.querySelector(`.tabs a[data-tab="${t}"]`); if (a) a.click(); };
  const breaks = () => window.SLBreaks || null;

  function spec() {
    ACT = {};
    const s = song(), p = busy();
    const look = window.SLLook ? SLLook.get() : {};
    const file = [
      it("newSong", "New song…", () => openNewSong(), { key: "cmd+n", dis: p }),
      it("newSetlist", "New setlist", () => setlistCmd("new"), { key: "cmd+shift+n", dis: p }),
      it("addBreak", "Add break", () => breaks() && breaks().add(), { key: "cmd+b", dis: !breaks() }),
      sep(),
      it("importAbleton", "Import Ableton project…", () => mod().importAbleton(), { key: "cmd+i", dis: p }),
      it("importAudio", "Import audio files…", () => openNewSong(), { dis: p }),
      it("importPackage", "Import .setline package…", () => mod().importPackage(), { dis: p }),
      sep(),
      it("export", "Export song or setlist…", () => mod().exportSetlist(), { key: "cmd+e" }),
      it("print", "Print setlist…", () => window.SLPrint && SLPrint.box(), { key: "cmd+p" }),
      sep(),
      sub("Libraries", [
        ...libs.map((l, i) => it("lib" + i, l.name + (l.songs !== undefined ? `  (${l.songs})` : ""), () => mod().switchLibrary(l.name), { check: l.current, dis: p || l.current })),
        sep(), it("newLibrary", "New library…", () => mod().newLibrary(), { dis: p }), it("renameLibrary", "Rename library…", () => mod().renameLibrary()),
        it("revealLibrary", MAC ? "Show in Finder" : "Show in Explorer", () => mod().reveal()),
      ]),
      sub("Open recent", libs.filter((l) => !l.current).slice(0, 8).map((l, i) => it("recent" + i, l.name, () => mod().switchLibrary(l.name), { dis: p })), libs.filter((l) => !l.current).length === 0),
      it("backups", "Backups…", () => mod().openBackup()),
      it("cleanUp", "Clean up unused audio…", () => mod().cleanUpAudio(), { dis: p }),
      ...(MAC ? [] : [sep(), it("checkUpdates", "Check for updates…", () => window.SLUpd && SLUpd.check(true)), it("settings", "Settings…", () => openSettings(), { key: "cmd+comma" }), sep(), it("quit", "Exit", () => mod().quit())]),
    ];
    const edit = [
      it("undo", "Undo", () => undo(), { key: "cmd+z" }), it("redo", "Redo", () => redo(), { key: "cmd+shift+z" }), sep(),
      it("cut", "Cut", () => typeof doCut === "function" && doCut(), { key: MAC ? "" : "cmd+x" }), it("copy", "Copy", () => typeof doCopy === "function" && doCopy(), { key: MAC ? "" : "cmd+c" }),
      it("paste", "Paste", () => typeof doPaste === "function" && doPaste(), { key: MAC ? "" : "cmd+v" }),
      it("delete", "Delete", () => typeof doDelete === "function" && doDelete()),
      it("selectAll", "Select all", () => { const x = song(); if (x && typeof selectAllIn === "function") selectAllIn(x); }, { key: MAC ? "" : "cmd+a", dis: !s }), sep(),
      it("selectMode", "Select songs", () => window.SL9 && SL9.select(!SL9.state.sel), { check: !!(window.SL9 && SL9.state.sel) }),
    ];
    const v = window.SL9 ? SL9.mode() : "cards";
    const view = [
      it("tabShow", "Show", () => tab("show"), { key: "cmd+1", check: !document.body.classList.contains("pf") && !(typeof perfOn !== "undefined" && perfOn) && !(typeof bandOn !== "undefined" && bandOn) }),
      it("tabPerform", "Perform", () => tab("perform"), { key: "cmd+2", check: typeof perfOn !== "undefined" && perfOn }),
      it("tabBand", "Band", () => tab("band"), { key: "cmd+3", check: typeof bandOn !== "undefined" && bandOn }), sep(),
      it("cards", "Cards", () => SL9.setMode("cards"), { check: v === "cards" }), it("folders", "Folders", () => SL9.setMode("folders"), { check: v === "folders" }),
      it("collapseAll", "Collapse all", () => SL9.collapseAll(), { key: "cmd+alt+left" }), sep(),
      it("zoomIn", "Zoom in", () => window.SL9 && SL9.zoomBy(1.5)), it("zoomOut", "Zoom out", () => window.SL9 && SL9.zoomBy(1 / 1.5)),
      it("zoomFit", "Fit the song", () => { const x = song(); if (x && window.SL9) SL9.zoomPreset(x, "song"); }, { dis: !s }), sep(),
      it("toggleSetlist", "Show the setlist", () => setPanel("L", !isOpen("L")), { check: isOpen("L") }),
      it("togglePanel", "Show the side panel", () => setPanel("R", !isOpen("R")), { check: isOpen("R") }),
    ];
    const vers = s && typeof versOf === "function" ? versOf(s) : [];
    const songM = [
      it("addTrack", "Add track…", () => { const b = $("newTrackB"); if (b) b.click(); }, { dis: !s }),
      it("addSection", "Add section", () => { const x = song(); if (x) addSecAt(x, playId === x.id ? barAtTime(x, pos) : 1); }, { dis: !s }),
      it("addMeter", "Add time signature…", () => { const x = song(); if (x && window.SLMeter) SLMeter.open(x, playId === x.id ? barAtTime(x, pos) : 1, null); }, { dis: !s }),
      it("addTempo", "Add tempo change…", () => { const x = song(); if (!x) return; const bar = Math.max(2, playId === x.id ? barAtTime(x, pos) : 2); addPoint(x, { bar, bpm: +bpmAt(x, bar).toFixed(3) }); tsel = { song: x.id, i: x.tmap.findIndex((e) => e.bar === bar) }; setTimeout(() => openTpop(true), 30); }, { dis: !s }),
      sep(),
      sub("Versions", [...vers.map((x, i) => it("ver" + i, x.name, () => { snap(); showVer(s, x.id); refresh(); }, { check: typeof curVer === "function" && curVer(s) === x })), sep(), it("newVersion", "New version", () => { snap(); newVer(s); refresh(); })], !s),
    ];
    const setM = [
      it("addSongToSet", "Add song…", () => { const b = $("addSong9"); if (b) b.click(); }),
      it("addBreak2", "Add break", () => breaks() && breaks().add(), { dis: !breaks() }),
      it("print2", "Print setlist…", () => window.SLPrint && SLPrint.box()), sep(),
      it("renameSet", "Rename…", () => setlistCmd("ren")), it("dupSet", "Duplicate", () => setlistCmd("dup"), { dis: p }),
    ];
    const Lk = window.SLLook;
    const cust = Lk ? [
      sub("Theme", [...Lk.THEMES.map(([k, n]) => it("th_" + k, n, () => Lk.set({ theme: k }), { check: look.theme === k })), ...((look.themes || []).length ? [sep(), ...look.themes.map((t, i) => it("ths" + i, t.name, () => Lk.set({ ...t.look, themes: look.themes })))] : [])]),
      sub("Accent colour", Lk.ACCENTS.map(([n, c]) => it("acc_" + n, n, () => Lk.set({ accent: c }), { check: String(look.accent).toLowerCase() === c }))),
      sub("Fonts", Lk.PAIRS.map((pr) => it("pair_" + pr.id, pr.name + (pr.id === "round" ? " (default)" : ""), () => Lk.set({ pair: pr.id, ui: "", title: "", nums: "" }), { check: look.pair === pr.id && !look.ui && !look.title && !look.nums }))),
      sub("Text size", [90, 100, 110, 120, 130].map((z) => it("size_" + z, z + "%", () => Lk.set({ size: z }), { check: look.size === z }))),
      sub("Transport style", [["console", "Console"], ["hardware", "Hardware"], ["minimal", "Minimal"]].map(([k, n]) => it("tp_" + k, n, () => Lk.set({ transport: k }), { check: look.transport === k }))),
      sub("Density", Lk.TRACKS.map(([n], i) => it("dens_" + i, n, () => Lk.set({ track: i }), { check: look.track === i }))),
      sep(),
      it("customize", "Customize the look…", () => Lk.open(), { key: "cmd+alt+comma" }),
      it("lookReset", "Reset to default", () => Lk.reset()),
    ] : [];
    const win = [it("minimise", "Minimise", () => native() && ncall("windowCmd", { what: "minimise" }), { key: MAC ? "cmd+m" : "" }), it("fullscreen", "Full screen", () => native() && ncall("windowCmd", { what: "fullscreen" }), { key: MAC ? "cmd+ctrl+f" : "" })];
    const help = [
      it("docs", "set.Line documentation", () => { if (native()) ncall("openUrl", { url: "https://github.com/mylesmcneal1/setline-engine/tree/main/docs" }); }),
      it("diag", "Diagnostics", () => openSettings("diag")),
      it("copyDiag", "Copy diagnostics", () => SLE && SLE.diagnostics && SLE.diagnostics("copy")),
      it("report", "Report a problem…", () => { if (SLE && SLE.diagnostics) SLE.diagnostics("save"); if (native()) ncall("openUrl", { url: "https://github.com/mylesmcneal1/setline-engine/issues/new" }); }),
    ];
    // the macOS app menu: the module already answers these commands (about, checkUpdates, prefs)
    const app = [{ id: "about", label: "About set.Line" }, { id: "checkUpdates", label: "Check for updates…" }, { id: "prefs", label: "Settings…", key: "cmd+comma" }];
    return { menus: [{ name: "File", items: file }, { name: "Edit", items: edit }, { name: "View", items: view }, { name: "Song", items: songM }, { name: "Setlist", items: setM }, { name: "Customize", items: cust }, { name: "Window", items: win }, { name: "Help", items: help }], app: MAC ? app : [] };
  }

  let last = "", timer = 0;
  function update() { clearTimeout(timer); timer = setTimeout(send, 80); }
  async function send() {
    try { if (mod().libraries) libs = await mod().libraries(); } catch (e) { libs = []; }
    const sp = spec(), j = JSON.stringify(sp);
    if (j === last) return; last = j;
    if (native()) ncall("setMenus", sp);
  }
  function run(cmd) {
    const id = String(cmd).replace(/^m:/, "");
    if (!ACT[id]) spec();
    const f = ACT[id]; if (f) try { f(); } catch (e) { console.error(e); }
    update();
  }
  // the state the menus show: checked when something changes (cheap; sends only if the menus differ)
  setInterval(() => { if (!document.hidden) send(); }, 1000);

  // the shortcuts the menus show, handled here (where the page didn't already): ⌘N new song (was New setlist),
  // ⇧⌘N new setlist, ⌘B add break, ⌘I import Ableton, ⌘E export, ⌘P print, ⌘1/2/3 Show / Perform / Band
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const k = e.key.toLowerCase(), map = { n: e.shiftKey ? "newSetlist" : "newSong", b: "addBreak", i: "importAbleton", e: "export", p: "print", 1: "tabShow", 2: "tabPerform", 3: "tabBand" };
    const id = map[k]; if (!id || (k !== "n" && e.shiftKey)) return;
    const sp = spec(), f = ACT[id]; if (!f) return;
    const find = (items) => { for (const x of items || []) { if (x.id === "m:" + id) return x; const y = find(x.sub); if (y) return y; } return null; };
    let item = null; for (const m of sp.menus) item = item || find(m.items);
    if (item && item.dis) return; // greyed out (e.g. while playing): the key does nothing either
    e.preventDefault(); e.stopImmediatePropagation(); f();
  }, true);
  // no in-app menu button: the menus are in the window chrome now
  const fb = $("fileBtn"); if (fb && fb.parentElement) fb.parentElement.remove();
  window.SLMenus = { spec, update, run, send, nativeKeys: () => false };
  update();
})();
