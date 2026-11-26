// 8a: renders the main views of the built UI (ui/dist) in headless Chrome at 1280x800 (the band's 2015 MacBook) and
// 1440x900, and fails when something in the top bar or the right panel overflows, wraps or runs off an edge.
// No dependencies: Chrome's DevTools protocol over Node's built-in WebSocket.
//   node tests/ui-layout.mjs [--shots <dir>] [--only <view>]     (CHROME=<path> to pick the browser)
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, extname, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "../ui/dist");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
if (!existsSync(join(root, "1-arrange.html"))) { console.error("ui/dist not built (cd ui && npm run build)"); process.exit(2); }

const chrome = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
].find((p) => existsSync(p));
if (!chrome) { console.log("UI LAYOUT SKIPPED (no Chrome found)"); process.exit(0); }

// ---- a static server for ui/dist
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  let p, body; try { p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)); body = await readFile(p); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/1-arrange.html`;

// ---- Chrome
const prof = await mkdtemp(join(tmpdir(), "sl-ui-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${prof}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
let port = 0;
for (let i = 0; i < 100 && !port; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = +(await readFile(join(prof, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch {} }
if (!port) { console.error("Chrome didn't start"); proc.kill(); process.exit(2); }
const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const waiters = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) for (const w of [...waiters]) if (w.ev === d.method) { waiters.splice(waiters.indexOf(w), 1); w.fn(d.params); } };
const cdp = (method, params = {}) => new Promise((r, j) => { const id = ++seq; pending.set(id, (d) => d.error ? j(new Error(method + ": " + d.error.message)) : r(d.result)); ws.send(JSON.stringify({ id, method, params })); });
const once = (ev) => new Promise((fn) => waiters.push({ ev, fn }));
const evaluate = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
await cdp("Page.enable"); await cdp("Runtime.enable");

// ---- what to look at
const wait = (ms) => `await new Promise(r=>setTimeout(r,${ms}));`;
const tab = (t) => `document.querySelector('.tabs a[data-tab="${t}"]').click(); ${wait(300)}`;
// 8b: the Ableton import preview with Live click / cue tracks (data shaped like the real EIA project)
const ABLE_DATA = {"project":"EIA 2026-2027","live":"Ableton Live 12.4.3","mode":"ableset","path":"x.als","ignored":["Return track TRAX"],"missing":[],"warnings":[],"cuePads":[{"track":"Qs","note":68,"name":"intro","word":"Intro","file":{"found":true,"name":"Audio 2.wav","start":0,"end":35568}},{"track":"Qs","note":69,"name":"verse 1","word":"Verse 1","file":{"found":true,"name":"Audio 2.wav"}},{"track":"Qs","note":92,"name":"one","word":"One","file":{"found":true,"name":"21-Audio 0002.wav"}}],"converted":[{"track":"CLICK","role":"click"},{"track":"Qs","role":"cues"}],"songs":[{"name":"MERCY","seconds":200,"startBeat":0,"endBeat":400,"total":100,"tmap":[{"bar":1,"bpm":167,"sig":[4,4]}],"secs":[{"name":"INTRO","type":"intro","start":1,"bars":14,"end":"continue"},{"name":"VERSE 1","type":"verse","start":15,"bars":86,"end":"continue"}],"tracks":[{"name":"Backtrack","kind":"audio","col":"#5aa9ff","gainDb":0,"file":{"found":true,"name":"MDWY Backtrack.wav","path":"x.wav","bytes":50000000},"clips":[{"start":0,"end":199,"off":0,"gain":0,"fi":0,"fo":0}],"bus":"TRAX"},{"name":"33-hof sb SNARE BOMB","kind":"audio","col":"#ff6b6b","gainDb":-4,"file":{"found":true,"name":"hof BACK TRACK.wav","path":"y.wav","bytes":50000000},"clips":[],"bus":"TRAX"}],"audioTracks":2,"midiTracks":0,"clicks":[{"name":"CLICK","source":"CLICK","regions":[{"bar":1,"bars":99}],"notes":[{"bar":1,"st":0,"acc":true}],"accent":"note"},{"name":"DRUM CLICK","source":"DRUM CLICK","regions":[{"bar":1,"bars":99}],"notes":[],"accent":"note"}],"cues":[{"bar":1,"beat":1,"note":68,"word":"Intro","track":"Qs"},{"bar":2,"beat":1,"note":92,"word":"One","track":"Qs"}],"warnings":[]},{"name":"PROXIMA","seconds":200,"startBeat":0,"endBeat":400,"total":100,"tmap":[{"bar":1,"bpm":167,"sig":[4,4]}],"secs":[],"tracks":[{"name":"Backtrack","kind":"audio","col":"#5aa9ff","gainDb":0,"file":{"found":true,"name":"MDWY Backtrack.wav","path":"x.wav","bytes":50000000},"clips":[{"start":0,"end":199,"off":0,"gain":0,"fi":0,"fo":0}],"bus":"TRAX"},{"name":"33-hof sb SNARE BOMB","kind":"audio","col":"#ff6b6b","gainDb":-4,"file":{"found":true,"name":"hof BACK TRACK.wav","path":"y.wav","bytes":50000000},"clips":[],"bus":"TRAX"}],"audioTracks":2,"midiTracks":0,"clicks":[{"name":"CLICK","source":"CLICK","regions":[{"bar":1,"bars":99}],"notes":[{"bar":1,"st":0,"acc":true}],"accent":"note"},{"name":"DRUM CLICK","source":"DRUM CLICK","regions":[{"bar":1,"bars":99}],"notes":[],"accent":"note"}],"cues":[{"bar":1,"beat":1,"note":68,"word":"Intro","track":"Qs"},{"bar":2,"beat":1,"note":92,"word":"One","track":"Qs"}],"warnings":[]},{"name":"DEATH AVENUE","seconds":200,"startBeat":0,"endBeat":400,"total":100,"tmap":[{"bar":1,"bpm":167,"sig":[4,4]}],"secs":[],"tracks":[{"name":"Backtrack","kind":"audio","col":"#5aa9ff","gainDb":0,"file":{"found":true,"name":"MDWY Backtrack.wav","path":"x.wav","bytes":50000000},"clips":[{"start":0,"end":199,"off":0,"gain":0,"fi":0,"fo":0}],"bus":"TRAX"},{"name":"33-hof sb SNARE BOMB","kind":"audio","col":"#ff6b6b","gainDb":-4,"file":{"found":true,"name":"hof BACK TRACK.wav","path":"y.wav","bytes":50000000},"clips":[],"bus":"TRAX"}],"audioTracks":2,"midiTracks":0,"clicks":[{"name":"CLICK","source":"CLICK","regions":[{"bar":1,"bars":99}],"notes":[{"bar":1,"st":0,"acc":true}],"accent":"note"},{"name":"DRUM CLICK","source":"DRUM CLICK","regions":[{"bar":1,"bars":99}],"notes":[],"accent":"note"}],"cues":[{"bar":1,"beat":1,"note":68,"word":"Intro","track":"Qs"},{"bar":2,"beat":1,"note":92,"word":"One","track":"Qs"}],"warnings":[]}]};
const views = [
  { name: "show", setup: `${tab("show")}` },
  { name: "perform", setup: `${tab("perform")}` },
  { name: "band", setup: `${tab("band")}` },
  ...["audio", "out", "midi", "controls", "rig", "voices", "band", "general", "look", "diag"].map((k) => ({ name: "settings-" + k, setup: `${tab("show")} openSettings('${k}'); ${wait(250)}`, panel: "#sbody" })),
  { name: "section-panel", setup: `${tab("show")} { const s=SLPage.songs.find(x=>x.secs&&x.secs.length>1); selectSec(s.id,s.secs[1].id); } ${wait(300)}` },
  { name: "cue-panel", setup: `${tab("show")} { const s=SLPage.songs.find(x=>x.tracks.some(t=>SLPage.ROLE[t]==="cues")); openCuePanel(s); } ${wait(300)}` },
  { name: "ableton-preview", setup: `${tab("show")} SLAble.box(${JSON.stringify(ABLE_DATA)},{mode:"auto",dups:[null,null,null],remode:async()=>null,locate:async()=>null}); ${wait(200)} document.querySelector("#abPads").click(); ${wait(150)} document.querySelector('[data-open="0"]').click(); ${wait(150)}`, panel: ".ablebox" },
  { name: "quad-cortex", setup: `${tab("show")} { const s=SLPage.songs.find(x=>x.name==='Glasshouse'), t='Guitar rig', M=SLMod; s.midiCfg[t].dev='qc'; delete s.midiCfg[t].qcMode; if('qc'==='qc') s.midiCfg[t].qcMode='1'; const b=s.secs.map(x=>x.start); s.midi[t]=[{...M.presetEvent('qc',129,5,{bar:1,beat:1}),id:'p1'},{...M.sceneEvent('qc',{},3,{bar:1}),id:'s1'},{...M.sceneEvent('qc',{},0,{bar:b[1]||9}),id:'s2'},{...M.sceneEvent('qc',{},2,{bar:b[3]||25}),id:'s3'},{...M.stompEvent(4,{bar:(b[3]||25)+2}),id:'f1'},{...M.sceneEvent('qc',{},7,{bar:b[4]||41}),id:'s4'},{...M.sceneEvent('qc',{},0,{bar:b[5]||45}),id:'s5'}]; MODP.qc[129]={name:'Glasshouse Rig',scenes:['Clean','Crunch','Lead','Ambient','Rhythm DT','Solo boost','Breakdown','Swell'].map(n=>({name:n})),fields:{}}; refresh(); openTrack(s,t); } ${wait(300)} { const g=SLPage.songs.find(x=>x.name==='Glasshouse'); const el=document.querySelector('.lh[data-song="'+g.id+'"][data-track="Guitar rig"]'); const sc=document.getElementById('scroller'); if(el&&sc) sc.scrollTop+=el.getBoundingClientRect().top-sc.getBoundingClientRect().top-260; } ${wait(200)}` },
  { name: "axe-fx", setup: `${tab("show")} { const s=SLPage.songs.find(x=>x.name==='Glasshouse'), t='Guitar rig', M=SLMod; s.midiCfg[t].dev='axe'; delete s.midiCfg[t].qcMode; if('axe'==='qc') s.midiCfg[t].qcMode='1'; const b=s.secs.map(x=>x.start); s.midi[t]=[{...M.presetEvent('axe',414,0,{bar:1,beat:1}),id:'p1'},{...M.sceneEvent('axe',{},3,{bar:1}),id:'s1'},{...M.sceneEvent('axe',{},0,{bar:b[1]||9}),id:'s2'},{...M.sceneEvent('axe',{},2,{bar:b[3]||25}),id:'s3'},{...M.stompEvent(4,{bar:(b[3]||25)+2}),id:'f1'},{...M.sceneEvent('axe',{},7,{bar:b[4]||41}),id:'s4'},{...M.sceneEvent('axe',{},0,{bar:b[5]||45}),id:'s5'}]; MODP.axe[414]={name:'Seneca Lead',scenes:['Clean','Crunch','Lead','Ambient','Rhythm DT','Solo boost','Breakdown','Swell'].map(n=>({name:n})),fields:{}}; refresh(); openTrack(s,t); } ${wait(300)} { const g=SLPage.songs.find(x=>x.name==='Glasshouse'); const el=document.querySelector('.lh[data-song="'+g.id+'"][data-track="Guitar rig"]'); const sc=document.getElementById('scroller'); if(el&&sc) sc.scrollTop+=el.getBoundingClientRect().top-sc.getBoundingClientRect().top-260; } ${wait(200)}` },
  { name: "print-setlist", setup: `${tab("show")} SLPrint.box(); ${wait(200)}`, dialog: true },
  { name: "update", setup: `${tab("show")} { const u=SLUpd.state(); u.info={current:"0.1.52",previous:"0.1.51",daily:true}; u.rel={current:"0.1.52",latest:"0.1.60",newer:true,title:"set.Line 0.1.60",notes:["set.Line 0.1.60 (beta), built from abc1234.","Changes since the previous latest:","- 8d: live-safety extras (abc1234)","- 8c: modeler-native MIDI tracks (def5678)","Mac: run setline-update."].join(String.fromCharCode(10))}; SLUpd.box(); } ${wait(200)}`, dialog: true },
  { name: "setlist-menu", setup: `${tab("show")} setlistMenu({clientX:16,clientY:110}); ${wait(150)}`, menu: true },
  { name: "song-menu", setup: `${tab("show")} songMenu({clientX:120,clientY:200}, SLPage.songs[0].id); ${wait(150)}`, menu: true },
  { name: "about", setup: `${tab("show")} aboutBox({version:'0.1.60',os:'macOS 12.7'}); ${wait(200)}`, dialog: true },
];

// The checks, in the page: the top bar never wraps or runs off; the right panel (or the settings body) never
// overflows sideways; a menu shows every item's text on one line.
const CHECK = `
  const W=innerWidth, out=[];
  const name=(e)=>e.id?'#'+e.id:(e.className&&typeof e.className==='string'?e.tagName.toLowerCase()+'.'+e.className.split(' ')[0]:e.tagName.toLowerCase());
  const vis=(e)=>{ const r=e.getBoundingClientRect(), cs=getComputedStyle(e); return r.width>0&&r.height>0&&r.left<innerWidth-1&&r.right>1&&cs.visibility!=='hidden'&&cs.display!=='none'; };
  const lines=(e)=>{ const tops=new Set(), w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT); let n; while((n=w.nextNode())){ if(!n.textContent.trim()||!n.parentElement||getComputedStyle(n.parentElement).display==='none') continue; const rg=document.createRange(); rg.selectNodeContents(n); for(const r of rg.getClientRects()) if(r.width>1) tops.add(Math.round(r.top/6)); } return tops.size; };
  const top=document.querySelector('header.top');
  if(top&&vis(top)){
    if(top.scrollWidth>top.clientWidth+1) out.push('top bar overflows ('+top.scrollWidth+' > '+top.clientWidth+')');
    top.querySelectorAll('button,a,select,.lcd>div,.setpick').forEach(e=>{ if(!vis(e)) return; const r=e.getBoundingClientRect();
      if(r.right>W+1) out.push('top bar: '+name(e)+' runs off the edge ('+Math.round(r.right)+')');
      if(e.children.length===0||e.matches('.setpick,button.btn,.fbtn,a')){ if(lines(e)>1&&e.textContent.trim()) out.push('top bar: '+name(e)+' wraps ("'+e.textContent.trim().slice(0,30)+'")'); }
      if(e.scrollWidth>e.clientWidth+2&&!e.matches('.setpick,.lcd>div')) out.push('top bar: '+name(e)+' clips its text'); });
  }
  const panelSel=window.__panel||'aside.insp';
  document.querySelectorAll(panelSel).forEach(p=>{ if(!vis(p)) return; const pr=p.getBoundingClientRect();
    if(p.scrollWidth>p.clientWidth+1) out.push(panelSel+' overflows sideways ('+p.scrollWidth+' > '+p.clientWidth+')');
    p.querySelectorAll('button,label,select,input,.seg,.segm').forEach(e=>{ if(!vis(e)) return; const r=e.getBoundingClientRect(); if(r.right>pr.right+1&&r.left<pr.right) out.push(panelSel+': '+name(e)+' runs past the edge ("'+(e.textContent||'').trim().slice(0,24)+'")'); });
    p.querySelectorAll('button').forEach(e=>{ if(vis(e)&&getComputedStyle(e).flexDirection!=='column'&&e.textContent.trim().length>2&&lines(e)>1) out.push(panelSel+': button wraps ("'+e.textContent.trim().slice(0,30)+'")'); }); });
  document.querySelectorAll('.xm.ctx .it').forEach(it=>{ const s=it.querySelector(':scope>span'); if(!s||!s.textContent.trim()) out.push('menu item without text'); else if(lines(s)>1) out.push('menu item wraps ("'+s.textContent.slice(0,30)+'")'); });
  document.querySelectorAll('.cfbg button, .modal button, dialog button').forEach(e=>{ if(vis(e)&&lines(e)>1) out.push('dialog button wraps ("'+e.textContent.trim().slice(0,30)+'")'); });
  return out;`;

let fails = 0;
if (shots) await mkdir(shots, { recursive: true });
for (const [w, h] of [[1280, 800], [1440, 900]]) {
  for (const v of views) {
    if (only && v.name !== only) continue;
    await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const loaded = once("Page.loadEventFired");
    await cdp("Page.navigate", { url: base + "?layout=" + Date.now() });
    await loaded;
    await evaluate(wait(600));
    let problems;
    try {
      await evaluate(v.setup);
      problems = await evaluate(`window.__panel=${JSON.stringify(v.panel || "aside.insp")}; ${CHECK}`);
    } catch (e) { problems = ["error: " + e.message.split("\n")[0]]; }
    const uniq = [...new Set(problems)];
    console.log(`${uniq.length ? "FAIL" : "ok  "} ${w}x${h} ${v.name}${uniq.length ? "\n      " + uniq.slice(0, 8).join("\n      ") : ""}`);
    if (uniq.length) fails++;
    if (shots) { const s = await cdp("Page.captureScreenshot", { format: "png" }); await writeFile(join(shots, `${v.name}-${w}.png`), Buffer.from(s.data, "base64")); }
  }
}
ws.close(); proc.kill(); server.close();
await rm(prof, { recursive: true, force: true }).catch(() => {});
console.log(fails ? `UI LAYOUT FAILED (${fails})` : "UI LAYOUT OK");
process.exit(fails ? 1 : 0);
