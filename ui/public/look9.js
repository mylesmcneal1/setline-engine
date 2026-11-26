// set.Line 9c: the look. Font pairings (14 + Original), themes, accent colour, text size, track height, corners, the
// transport (Console / Hardware / Minimal, text layouts Even / Hero / One line), the outputs pill (no more orange
// banner) and the Customize the look panel. Per computer: localStorage, mirrored to the app's preferences.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // ---------------------------------------------------------------- the 14 pairings (+ Original)
  const PAIRS = [
    { id: "stage", name: "Stage", title: "Big Shoulders Display", ui: "Inter", nums: "Geist Mono", tw: 800 },
    { id: "character", name: "Character", title: "Bricolage Grotesque", ui: "Bricolage Grotesque", nums: "Geist Mono", tw: 700 },
    { id: "studio", name: "Studio", title: "Instrument Sans", ui: "Instrument Sans", nums: "IBM Plex Mono", tw: 700 },
    { id: "round", name: "Round", title: "Outfit", ui: "Outfit", nums: "Outfit", tw: 700 },
    { id: "bold", name: "Bold", title: "Archivo Black", ui: "Work Sans", nums: "DM Mono", tw: 400 },
    { id: "machine", name: "Machine", title: "Tektur", ui: "Work Sans", nums: "Jura", tw: 600 },
    { id: "marquee", name: "Marquee", title: "Anton", ui: "DM Sans", nums: "Geist Mono", tw: 400 },
    { id: "trail", name: "Trail", title: "National Park", ui: "Fira Sans", nums: "Red Hat Mono", tw: 700 },
    { id: "wide", name: "Wide", title: "Boldonse", ui: "Inter", nums: "DM Mono", tw: 400 },
    { id: "poster", name: "Tour poster", title: "Smooch Sans", ui: "Poppins", nums: "IBM Plex Mono", tw: 800 },
    { id: "classic", name: "Classic", title: "Montserrat", ui: "Montserrat", nums: "Jura", tw: 700 },
    { id: "editorial", name: "Editorial", title: "Gloock", ui: "Instrument Sans", nums: "IBM Plex Mono", tw: 400 },
    { id: "retro", name: "Retro LED", title: "Pixelify Sans", ui: "Fira Sans", nums: "Silkscreen", tw: 600 },
    { id: "metal", name: "Heavy metal", title: "Erica One", ui: "Work Sans", nums: "Geist Mono", tw: 400 },
    { id: "original", name: "Original", title: "Inter", ui: "Inter", nums: "JetBrains Mono", tw: 700 },
  ];
  const UI_FONTS = ["Inter", "Outfit", "Instrument Sans", "Work Sans", "DM Sans", "Fira Sans", "Poppins", "Montserrat", "Bricolage Grotesque"];
  const TITLE_FONTS = [...new Set(PAIRS.map((p) => p.title))];
  const NUM_FONTS = ["Geist Mono", "JetBrains Mono", "IBM Plex Mono", "DM Mono", "Red Hat Mono", "Jura", "Silkscreen", "Outfit", "Tektur"];
  const SINGLE = new Set(["Archivo Black", "Anton", "Boldonse", "Gloock", "Erica One"]); // one weight: never synthetic bold
  const ACCENTS = [["Orange", "#ff9f0a"], ["Blue", "#64d2ff"], ["Green", "#30d158"], ["Red", "#ff453a"], ["Purple", "#bf5af2"], ["Yellow", "#ffd60a"], ["White", "#f2f2f7"]];
  const THEMES = [["dark", "Dark"], ["black", "Black (OLED)"], ["dim", "Dim"], ["stage", "Stage"]];
  // 9e: the same five sizes as View › Track height; this one is the default for songs without their own size
  const TRACKS = [["Mini", 18], ["Small", 32], ["Medium", 50], ["Large", 76], ["Huge", 120]];
  const DEF = { theme: "dark", pair: "round", ui: "", title: "", nums: "", accent: "#ff9f0a", size: 100, track: 2, transport: "console", layout: "even", corners: "rounded", themes: [] };
  let LOOK = { ...DEF };
  try { LOOK = { ...DEF, ...JSON.parse(localStorage.getItem("setline.look") || "{}") }; } catch (e) { /* default */ }
  const native = () => typeof NATIVE !== "undefined" && NATIVE && typeof ncall === "function";
  function save() { try { localStorage.setItem("setline.look", JSON.stringify(LOOK)); } catch (e) {} if (native()) ncall("lookSet", { look: JSON.stringify(LOOK) }); }
  const pairOf = (id) => PAIRS.find((p) => p.id === id) || PAIRS[3];
  const fontsNow = () => { const p = pairOf(LOOK.pair); return { ui: LOOK.ui || p.ui, title: LOOK.title || p.title, nums: LOOK.nums || p.nums, tw: LOOK.title ? (SINGLE.has(LOOK.title) ? 400 : 700) : p.tw }; };
  const stack = (f, tail) => `"${f}", ${tail}`;

  // ---------------------------------------------------------------- apply
  function apply(redraw = true) {
    const r = document.documentElement.style, f = fontsNow();
    r.setProperty("--sf", stack(f.ui, '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif'));
    r.setProperty("--ui", stack(f.ui, "system-ui, sans-serif"));
    r.setProperty("--title", stack(f.title, "var(--ui)"));
    r.setProperty("--title-w", String(f.tw));
    r.setProperty("--nums", stack(f.nums, 'ui-monospace, "JetBrains Mono", Menlo, monospace'));
    r.setProperty("--code", stack(f.nums, 'ui-monospace, "JetBrains Mono", Menlo, monospace'));
    r.setProperty("--accent", LOOK.accent);
    r.setProperty("--r", LOOK.corners === "square" ? "3px" : LOOK.corners === "xround" ? "14px" : "8px");
    r.setProperty("--zoom", String(Math.max(0.9, Math.min(1.3, LOOK.size / 100))));
    const b = document.body.classList;
    THEMES.forEach(([k]) => b.toggle("th-" + k, LOOK.theme === k));
    ["console", "hardware", "minimal"].forEach((k) => b.toggle("tp-" + k, LOOK.transport === k));
    ["even", "hero", "line"].forEach((k) => b.toggle("tl-" + k, LOOK.layout === k));
    b.toggle("zoomed9", LOOK.size !== 100);
    const th = TRACKS[Math.max(0, Math.min(4, LOOK.track))][1];
    if (typeof TH !== "undefined" && TH !== th) { TH = th; r.setProperty("--th", th + "px"); if (redraw && typeof renderFolders === "function") try { renderFolders(); } catch (e) {} }
    lcdStrip.key = ""; // the strip redraws with the new colours
    if ($("lookBox")) drawBox();
    if (window.SLMenus && SLMenus.update) SLMenus.update();
  }
  function set(patch) { Object.assign(LOOK, patch); save(); apply(); }
  function reset() { const themes = LOOK.themes; LOOK = { ...DEF, themes }; save(); apply(); }

  // ---------------------------------------------------------------- the transport
  function buildTransport() {
    const tr = document.querySelector(".transport"), lc = document.querySelector(".lcd"); if (!tr || !lc || $("fwdBtn")) return;
    // the play button wears the song's progress as a ring
    const pb = $("playBtn"); pb.insertAdjacentHTML("beforeend", `<svg class="pring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" pathLength="100"/></svg>`);
    $("rtz").insertAdjacentHTML("beforebegin", ""); $("rtz").title = "Back: to the start of the song  ↵";
    pb.insertAdjacentHTML("afterend", `<button class="tb" id="fwdBtn" title="Forward: the next section"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3v10l5.5-5zM8 3v10l5.5-5z"/></svg></button>`);
    $("fwdBtn").onclick = () => { if (window.SLActions) SLActions.run("nextSection"); };
    const nx = $("nextSong"); if (nx && nx.previousElementSibling !== $("fwdBtn")) $("fwdBtn").after(nx);
    // the display: Even layout cells (number, caption underneath), beat lights, "left · next", the section strip
    const pos = lc.querySelector(".lpos"), cells = [...lc.children];
    const bpmCell = cells.find((c) => c.querySelector("#lcdBpm")), sigCell = cells.find((c) => c.querySelector("#lcdSig")), song = lc.querySelector(".lsong");
    pos.classList.add("lc"); bpmCell.classList.add("lc", "lbpm"); sigCell.classList.add("lc", "lsig"); song.classList.add("lc");
    const time = $("lcdTime"); time.remove();
    pos.insertAdjacentHTML("beforeend", `<span class="cap"><i class="beats" id="lcdBeats"></i></span>`); pos.querySelector(".cap").appendChild(time);
    bpmCell.querySelector("span").className = "cap"; sigCell.querySelector("span").className = "cap";
    const sn = $("lcdSong"), sec = $("lcdSec");
    song.innerHTML = `<b class="lsn"></b><span class="cap" id="lcdLeft"></span>`; song.querySelector(".lsn").append(sn, " ", sec); sec.className = "lsec";
    lc.insertAdjacentHTML("beforeend", `<div class="lstrip" id="lcdStrip"><i id="lcdPh"></i></div>`);
  }
  const mmss = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };
  function lcdStrip(s, len) {
    const el = $("lcdStrip"); if (!el) return;
    const key = s ? s.id + "|" + len + "|" + (s.secPos || []).length : "";
    if (lcdStrip.key === key) return; lcdStrip.key = key;
    el.querySelectorAll("b").forEach((x) => x.remove());
    if (!s) return;
    (s.secPos || []).forEach((p) => { const a = s.bars[p.start - 1], z = s.bars[Math.min(s.bars.length - 1, p.start + p.bars - 1)]; if (!a || !z) return;
      el.insertAdjacentHTML("afterbegin", `<b style="left:${a.t / len * 100}%;width:${(z.t - a.t) / len * 100}%;background:${SEC_C[p.type] || "#7d8696"}"></b>`); });
  }
  // the page's lcd() fills the numbers; this adds the lights, the ring, "left · next" and the strip
  const L0 = window.lcd;
  window.lcd = function () {
    L0.apply(this, arguments);
    const s = songs.find((x) => x.id === (playId || selId)); const pb = $("playBtn");
    if (!s) { if ($("lcdLeft")) $("lcdLeft").textContent = ""; lcdStrip(null); if (pb) pb.style.setProperty("--pr", "0"); return; }
    const p0 = s.id === playId ? pos : 0, len = s.len || s.audio || 1;
    const b = s.bars.find((bb, i) => p0 >= bb.t && p0 < (s.bars[i + 1] ? s.bars[i + 1].t : 1e9)) || s.bars[0];
    let k = 0; b.beatT.forEach((bt, i) => { if (p0 >= bt) k = i; });
    // the bar number bold: "37.2.1" (fixed-width digits: nothing moves while playing)
    const bar = $("lcdBar"); if (bar) { const t = bar.textContent.replace(/\s/g, ""), [a, ...rest] = t.split("."); const h = `<b>${a}</b>.${rest.join(".")}`; if (bar.innerHTML !== h) bar.innerHTML = h; }
    // beat lights: one per beat in simple meters, one per group in odd ones (7/8 as 2+2+3: three lights)
    const g = b.grp && b.grp.length > 1 ? b.grp : null, n = g ? g.length : Math.min(16, b.sig[0]);
    let cur = k; if (g) { let at = 0; cur = 0; for (let i = 0; i < g.length; i++) { if (k >= at) cur = i; at += g[i]; } }
    const lights = $("lcdBeats"); if (lights) { if (lights.children.length !== n) lights.innerHTML = "<i></i>".repeat(n); [...lights.children].forEach((x, i) => { x.className = i === cur && (playing || p0 > 0) ? (i === 0 ? "on one" : "on") : ""; }); }
    // under the song: the section in its colour, then "2:35 left · Chorus in 3"
    const secs = s.secPos || [], si = secs.findIndex((p) => b.bar >= p.start && b.bar < p.start + p.bars), nsec = secs[si + 1];
    const sec = $("lcdSec"); if (sec && si >= 0) sec.style.color = SEC_C[secs[si].type] || "";
    const left = Math.max(0, (typeof verLen === "function" && typeof entryVer === "function" ? verLen(s, entryVer(s)) : s.audio) - p0);
    const bars = nsec ? nsec.start - b.bar : 0;
    if ($("lcdLeft")) $("lcdLeft").textContent = `${mmss(left)} left${nsec ? ` · ${nsec.name} in ${bars}` : ""}`;
    lcdStrip(s, len); const ph = $("lcdPh"); if (ph) ph.style.left = Math.min(100, p0 / len * 100) + "%";
    if (pb) pb.style.setProperty("--pr", String(Math.min(100, p0 / len * 100)));
  };

  // ---------------------------------------------------------------- the outputs pill (no more orange banner)
  function buildPill() {
    const chip = $("statusChip"); if (!chip || $("pillTxt")) return;
    chip.classList.add("opill"); chip.insertAdjacentHTML("beforeend", `<span id="pillTxt"></span>`);
    chip.onclick = (e) => { e.stopPropagation(); pillMenu(chip); };
    new MutationObserver(pill).observe($("statusTxt"), { childList: true, characterData: true, subtree: true });
    if (window.SLPage && SLPage.setListen) { const f = SLPage.setListen.bind(SLPage); SLPage.setListen = (st, what) => { f(st, what); pill(); }; }
    pill();
  }
  function pill() {
    const chip = $("statusChip"), t = $("pillTxt"); if (!chip || !t) return;
    const L = typeof LISTEN !== "undefined" ? LISTEN : {}, txt = ($("statusTxt").textContent || "").trim(), none = !txt || /^No audio device/i.test(txt);
    const rate = (txt.match(/(\d+(?:\.\d+)?k)/) || [])[1] || "";
    chip.classList.toggle("pc", !!L.on); chip.classList.toggle("none", !L.on && none);
    t.textContent = L.on ? `This computer${rate ? " · " + rate : ""}` : none ? "No output · choose" : txt;
    chip.title = L.on ? `The show is playing on this computer (${L.current || "its speakers or headphones"}), not on its own outputs${L.missing ? `: ${L.missing} isn't connected` : ""}.\nClick to choose the outputs, or go back to the show outputs.` : none ? "No audio output: click to choose one" : (chip.title || "").replace(/^This computer.*\n?/, "");
  }
  function pillMenu(chip) {
    const r = chip.getBoundingClientRect(), L = typeof LISTEN !== "undefined" ? LISTEN : {}, sle = window.SLE;
    ctxMenu({ clientX: r.right - 240, clientY: r.bottom + 6 }, [
      { cap: "Where the show plays" },
      { label: L.on ? "Back to show outputs" : "Show outputs (the interface)", icon: "check", cur: !L.on, act: () => { if (sle) sle.listen({ on: false }); } },
      { label: "This computer (speakers / headphones)", icon: "audio", cur: !!L.on, act: () => { if (sle) sle.listen({ on: true }); else toast("In the app this plays the show on this computer"); } },
      "-",
      { label: "Audio settings…", icon: "gear", act: () => openSettings("audio") },
    ]);
  }

  // ---------------------------------------------------------------- Customize the look… (a sheet with a live preview)
  const seg = (id, opts, cur) => `<div class="lk-seg" data-k="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  function previewHTML() {
    const tr = ["#6b7cff", "#22c3a6", "#a46bff", "#f5a524", "#22c3a6", "#f5a524", "#ff5fa2", "#f5a524", "#7d8696"];
    const lanes = [["Click", "#ffd60a"], ["Cues", "#64d2ff"], ["TRAX", "#5aa9ff"], ["Studio guitar", "#ff9f43"], ["Bass", "#30d158"]];
    const wave = (c, k) => `<svg viewBox="0 0 300 30" preserveAspectRatio="none"><path fill="${c}" opacity=".85" d="M0 15 ${Array.from({ length: 150 }, (_, i) => { const h = 3 + Math.abs(Math.sin(i * 0.37 + k) * 9 + Math.sin(i * 1.7 + k * 2) * 4); return `L${i * 2} ${15 - h} L${i * 2 + 1} ${15 + h}`; }).join(" ")} L300 15Z"/></svg>`;
    return `<div class="lk-prev"><div class="lk-cap">Live preview</div>
      <div class="lk-tr">${document.querySelector(".transport") ? document.querySelector(".transport").outerHTML.replace(/ id="[^"]*"/g, "") : ""}${document.querySelector(".lcd") ? document.querySelector(".lcd").outerHTML.replace(/ id="[^"]*"/g, "") : ""}</div>
      <div class="lk-song"><b class="lk-title">DEATH AVENUE</b><span class="lk-chip">180 BPM</span><span class="lk-chip">4/4 → 7/8 at 89</span></div>
      <div class="lk-secs">${tr.map((c, i) => `<i style="background:${c}">${["Intro", "Verse 1", "Pre", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus", "Outro"][i]}</i>`).join("")}</div>
      ${lanes.map(([n, c], i) => `<div class="lk-lane" style="--c:${c}"><span>${n}</span><div>${i === 0 ? `<svg viewBox="0 0 300 30" preserveAspectRatio="none">${Array.from({ length: 48 }, (_, k) => `<rect x="${k * 6.25}" y="${k % 4 ? 9 : 3}" width="1.6" height="${k % 4 ? 12 : 24}" fill="${c}"/>`).join("")}</svg>` : i === 1 ? `<em>Intro</em><em>Verse 1</em><em>Chorus</em>` : wave(c, i)}</div></div>`).join("")}</div>`;
  }
  function drawBox() {
    const box = $("lookBox"); if (!box) return;
    const f = fontsNow(), inner = box.querySelector(".lk-set"), sc = inner ? inner.scrollTop : 0;
    box.querySelector(".lk-in").innerHTML = `<div class="lk-set"><h3>Customize the look</h3>
      <label class="lk-l">Theme</label>${seg("theme", [...THEMES, ...LOOK.themes.map((t) => ["saved:" + t.name, t.name])], LOOK.theme)}
      <label class="lk-l">Font pairing</label><div class="lk-pairs">${PAIRS.map((p) => `<button data-pair="${p.id}" class="${LOOK.pair === p.id && !LOOK.ui && !LOOK.title && !LOOK.nums ? "on" : ""}"><b style="font-family:'${p.title}';font-weight:${p.tw}">${p.name}</b><span style="font-family:'${p.nums}';font-variant-numeric:tabular-nums">37.2.1</span></button>`).join("")}</div>
      <label class="lk-l">Interface font</label>${seg("ui", UI_FONTS.map((x) => [x, `<span style="font-family:'${x}'">${x}</span>`]), f.ui)}
      <label class="lk-l">Title font</label>${seg("title", TITLE_FONTS.map((x) => [x, `<span style="font-family:'${x}';font-weight:${SINGLE.has(x) ? 400 : 700}">${x}</span>`]), f.title)}
      <label class="lk-l">Numbers font</label>${seg("nums", NUM_FONTS.map((x) => [x, `<span style="font-family:'${x}';font-variant-numeric:tabular-nums">${x} 37.2.1</span>`]), f.nums)}
      <label class="lk-l">Accent colour</label><div class="lk-acc">${ACCENTS.map(([n, c]) => `<button data-acc="${c}" title="${n}" style="background:${c}" class="${LOOK.accent.toLowerCase() === c ? "on" : ""}"></button>`).join("")}<label class="lk-custom" title="Your own colour"><input type="color" id="lkAcc" value="${LOOK.accent}"><span>Custom</span></label></div>
      <label class="lk-l">Text size · ${LOOK.size}%</label><input type="range" id="lkSize" min="90" max="130" step="5" value="${LOOK.size}">
      <label class="lk-l">Track height · ${TRACKS[LOOK.track][0]} <span class="faint">(songs without their own size)</span></label><input type="range" id="lkTrack" min="0" max="4" step="1" value="${LOOK.track}">
      <label class="lk-l">Transport style</label>${seg("transport", [["console", "Console"], ["hardware", "Hardware"], ["minimal", "Minimal"]], LOOK.transport)}
      <label class="lk-l">Transport text layout</label>${seg("layout", [["even", "Even"], ["hero", "Hero"], ["line", "One line"]], LOOK.layout)}
      <label class="lk-l">Corners</label>${seg("corners", [["square", "Square"], ["rounded", "Rounded"], ["xround", "Extra round"]], LOOK.corners)}
      </div>${previewHTML()}`;
    const ns = box.querySelector(".lk-set"); ns.scrollTop = sc;
    box.querySelectorAll(".lk-seg").forEach((sg) => sg.querySelectorAll("button").forEach((b) => b.onclick = () => {
      const k = sg.dataset.k, v = b.dataset.v;
      if (k === "theme" && v.startsWith("saved:")) { const t = LOOK.themes.find((x) => "saved:" + x.name === v); if (t) set({ ...t.look, themes: LOOK.themes }); return; }
      set({ [k]: v });
    }));
    box.querySelectorAll("[data-pair]").forEach((b) => b.onclick = () => set({ pair: b.dataset.pair, ui: "", title: "", nums: "" }));
    box.querySelectorAll("[data-acc]").forEach((b) => b.onclick = () => set({ accent: b.dataset.acc }));
    $("lkAcc").oninput = (e) => set({ accent: e.target.value });
    $("lkSize").oninput = (e) => set({ size: +e.target.value });
    $("lkTrack").oninput = (e) => set({ track: +e.target.value });
  }
  function openBox() {
    if ($("lookBox")) return;
    const bg = document.createElement("div"); bg.className = "cfbg"; bg.id = "lookBox";
    bg.innerHTML = `<div class="cfbox lk-box" role="dialog" aria-label="Customize the look"><div class="lk-in"></div><div class="lk-foot"><button class="btn line" id="lkReset">Reset to default</button><button class="btn line" id="lkSave">Save as theme…</button><button class="btn pri" id="lkDone">Done</button></div></div>`;
    document.body.appendChild(bg); drawBox();
    $("lkDone").onclick = () => bg.remove();
    bg.addEventListener("pointerdown", (e) => { if (e.target === bg) bg.remove(); });
    $("lkReset").onclick = () => reset();
    $("lkSave").onclick = () => { const r = $("lkSave").getBoundingClientRect(); floatInput(r.left - 40, r.top - 34, 200, 26, "My theme", (n) => { n = (n || "").trim().slice(0, 30); if (!n) return; const look = { ...LOOK }; delete look.themes; const themes = LOOK.themes.filter((t) => t.name !== n).concat([{ name: n, look }]); set({ themes }); toast(`Saved “${n}”: it’s in Customize › Theme`); }); };
  }
  document.addEventListener("keydown", (e) => {
    // ⌥⌘, (Customize the look…) comes through the menus' key dispatcher (menus9.js), once
    if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === "," || e.code === "Comma") && !window.SLMenus) { e.preventDefault(); openBox(); }
    if (e.key === "Escape" && $("lookBox")) { e.stopPropagation(); $("lookBox").remove(); }
  }, true);

  // the app's own copy of the look (another WebView profile, a reinstall): used when this one has none
  if (native() && !localStorage.getItem("setline.look")) ncall("lookGet").then((t) => { try { const o = JSON.parse(t || "null"); if (o) { LOOK = { ...DEF, ...o }; try { localStorage.setItem("setline.look", JSON.stringify(LOOK)); } catch (x) {} apply(); } } catch (x) {} }).catch(() => {});

  window.SLLook = { get: () => ({ ...LOOK }), set, reset, apply, open: openBox, PAIRS, ACCENTS, THEMES, TRACKS, fonts: fontsNow, pill };
  buildTransport(); buildPill(); apply(false);
  try { lcd(); } catch (e) {}
})();
