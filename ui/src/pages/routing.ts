// Outputs & MIDI page in the desktop app: real drivers, devices, rates, buffers and output names.
// Track -> output routing stays as designed (the page's own matrix, outputs numbered from 1).
import { SL } from "../bridge";

interface Current {
  driver: string; device: string; rate: number; buffer: number;
  rates: number[]; buffers: number[]; outputs: string[]; activeOutputs: number;
  latencyMs: number; running: boolean;
}
interface Setup { drivers: { name: string; devices: string[] }[]; current: Current | null; error?: string }

declare global { interface Window { SLRouting?: { setOutputs(names: string[]): void; setRows?(rows: unknown[]): void; onChange?: unknown } } }

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const kHz = (r: number) => String(Math.round(r / 100) / 10).replace(/\.0$/, "");
const STD_RATES = [44100, 48000, 88200, 96000];
const STD_BUFFERS = [64, 128, 256, 512]; // as in the design (four fit the panel); the current size is added if different

let state: Setup | null = null;
let rebuildRows: (() => void) | null = null; // track rows depend on how many outputs the device has
let busy = false;

function render(s: Setup) {
  state = s;
  const cur = s.current;
  const drv = s.drivers.find((d) => d.name === cur?.driver) ?? s.drivers[0];

  // Driver + devices of that driver
  const opts = s.drivers.map((d) => `<option value="${esc(d.name)}" ${d === drv ? "selected" : ""}>${esc(d.name)}${d.devices.length ? "" : " (none)"}</option>`).join("");
  const cards = (drv?.devices ?? []).map((name) => {
    const on = cur && cur.driver === drv!.name && cur.device === name;
    return on
      ? `<div class="dev on"><div class="n">${esc(name)} <span class="tag">ACTIVE</span></div><div class="s">${cur!.activeOutputs} out used, 0 in · ${kHz(cur!.rate)} kHz · ${cur!.buffer} samples<br>Output names come from its driver</div></div>`
      : `<div class="dev" data-dev="${esc(name)}"><div class="n">${esc(name)}</div><div class="s">Click to use this device</div></div>`;
  }).join("");
  const err = s.error ? `<p class="hint" style="color:var(--red)">${esc(s.error)}</p>` : "";
  $("devList").innerHTML = `<div class="field" style="margin:0 12px 10px"><label>Driver</label><select id="drvSel">${opts}</select></div>${cards || `<p class="hint">No devices on this driver.</p>`}${err}`;
  ($("drvSel") as HTMLSelectElement).onchange = (e) => apply({ driver: (e.target as HTMLSelectElement).value });
  $("devList").querySelectorAll<HTMLElement>(".dev[data-dev]").forEach((el) => (el.onclick = () => apply({ driver: drv!.name, device: el.dataset.dev })));

  // Sample rate and buffer: what this device offers (common values only, plus the current one)
  const rates = cur ? [...new Set([...STD_RATES.filter((r) => cur.rates.includes(r)), cur.rate])].sort((a, b) => a - b) : [];
  $("rateSeg").innerHTML = rates.map((r) => `<button data-rate="${r}" class="${cur && r === cur.rate ? "on" : ""}">${kHz(r)}</button>`).join("") || `<button disabled>–</button>`;
  $("rateSeg").querySelectorAll<HTMLElement>("button[data-rate]").forEach((b) => (b.onclick = () => apply({ rate: +b.dataset.rate! })));
  const bufs = cur ? [...new Set([...STD_BUFFERS.filter((b) => cur.buffers.includes(b)), cur.buffer])].sort((a, b) => a - b) : [];
  $("bufSeg").innerHTML = bufs.map((b) => `<button data-buf="${b}" class="${cur && b === cur.buffer ? "on" : ""}">${b}</button>`).join("") || `<button disabled>–</button>`;
  $("bufSeg").querySelectorAll<HTMLElement>("button[data-buf]").forEach((b) => (b.onclick = () => apply({ buffer: +b.dataset.buf! })));

  const st = $("engStat").querySelectorAll("div > b");
  if (st.length >= 4) {
    st[0].textContent = cur ? `${cur.latencyMs.toFixed(1)} ms` : "–";
    st[1].textContent = "–";
    st[2].textContent = cur ? `${cur.activeOutputs} / ${cur.outputs.length}` : "0 / 0";
    st[3].textContent = cur ? cur.driver.replace(/^Windows Audio/, "WASAPI") : "–";
    const lab = $("engStat").querySelectorAll("div > span");
    if (lab[3]) lab[3].textContent = "Driver";
  }

  window.SLRouting?.setOutputs(cur?.outputs ?? []);
  rebuildRows?.();
}

async function apply(req: Record<string, unknown>) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = "progress";
  $("devList").style.opacity = ".6";
  try { render(await SL.call<Setup>("setAudioSetup", req)); }
  catch (e) { if (state) render({ ...state, error: String(e) }); }
  finally { busy = false; document.body.style.cursor = ""; $("devList").style.opacity = ""; }
}

// ---------------------------------------------------------------- routing by track name
// The session (kept by the Edit page in sessionStorage while you switch pages) lists every track name
// with how many songs use it. Each name is routed once for the whole show; edits go straight back
// into that session copy, so the Edit page picks them up (and marks the session as changed).
interface KeptTrack { name: string; songs: number; ch: number; overrides: number; colour?: string }
interface Row { n?: string; name?: string; c?: string; st?: boolean; to?: number[]; lv?: number | string; info?: string; sep?: string }

function sessionRows() {
  const raw = sessionStorage.getItem("setline.session");
  if (!raw || !window.SLRouting) return;
  const kept = JSON.parse(raw);
  const o = JSON.parse(kept.text);
  const route: { v: 2; tracks: Record<string, number[]> } = o.routing && o.routing.v === 2 ? o.routing : { v: 2, tracks: {} };
  const tracks: KeptTrack[] = kept.tracks || [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const info = (t: KeptTrack) => {
    const outs = route.tracks[t.name] || [], n = state?.current?.outputs.length ?? 0;
    const missing = n ? outs.filter((o) => o > n) : [];
    return (!outs.length ? `<span style="color:var(--red)" title="Plays nowhere until it's routed">not routed</span> · `
      : missing.length ? `<span style="color:var(--amber)" title="This device has ${n} outputs; the track is silent on the missing ones">output ${missing.join(", ")} not on this device</span> · ` : "")
      + `${plural(t.songs, "song")} · ${t.ch === 2 ? "stereo" : "mono"}`
      + (t.overrides ? ` · <span title="Songs that send this track somewhere else (set in the Edit page inspector)">${plural(t.overrides, "override")}</span>` : "");
  };
  const build = (): Row[] => [
    { sep: "Tracks" },
    ...tracks.map((t) => ({ n: esc(t.name), name: t.name, c: t.colour || "#9aa0aa", st: t.ch === 2, to: [...(route.tracks[t.name] || [])], lv: 0, info: info(t) })),
    { sep: "Buses (optional)" },
    { n: "+ New bus", c: "var(--dim)", st: true, to: [], info: "sum tracks → any outputs", lv: "new" },
  ];
  const ovr = tracks.reduce((a, t) => a + (t.overrides || 0), 0);
  const chip = document.getElementById("ovrChip");
  if (chip) chip.textContent = `Per-song overrides: ${ovr}`;
  const sl = window.SLRouting as any;
  sl.onChange = (rows: Row[]) => {
    for (const r of rows) if (r.name !== undefined) {
      if (r.to && r.to.length) route.tracks[r.name] = [...r.to];
      else delete route.tracks[r.name];
    }
    o.routing = route;
    kept.text = JSON.stringify(o, null, 1);
    try { sessionStorage.setItem("setline.session", JSON.stringify(kept)); } catch {}
    sl.setRows(build()); // "not routed" labels follow
  };
  sl.setRows(build());
  rebuildRows = () => sl.setRows(build());
}

async function main() {
  if (!SL.native) return;
  try { sessionRows(); } catch (e) { console.warn("set.Line: routing rows", e); }
  render(await SL.call<Setup>("getAudioSetup"));
  $("rescanBtn").onclick = async () => render(await SL.call<Setup>("getAudioSetup", { rescan: true }));
  SL.on("audioSetupChanged", (s: Setup) => { if (!busy) render(s); });
  // Output level row: the engine's peak per output (same scale as the Edit page meters).
  const pct = (l: number) => (l <= 0 ? 0 : Math.max(0, Math.min(100, ((20 * Math.log10(l) + 48) / 54) * 100)));
  const held: number[] = [];
  SL.on("meters", (m: { peaks: number[] }) => {
    document.querySelectorAll<HTMLElement>("#mx [data-m]").forEach((b) => {
      const i = +b.dataset.m! - 1, v = Math.max(m.peaks?.[i] || 0, (held[i] || 0) * 0.86);
      held[i] = v < 0.002 ? 0 : v;
      b.style.height = pct(held[i]) + "%";
    });
  });
  SL.on("engineStats", (x: { cpu?: number }) => {
    const b = $("engStat").querySelectorAll("div > b")[1];
    if (b && typeof x.cpu === "number") b.textContent = `${Math.round(x.cpu)}%`;
  });
  // Test hook (--test-script): the same script runs on whichever page is showing (it checks location).
  const info = await SL.call<{ testScript?: string }>("getAppInfo");
  if (info.testScript) {
    try {
      const AsyncFn = Object.getPrototypeOf(async () => {}).constructor;
      const out = await new AsyncFn("SL", "hooks", info.testScript)(SL, { routing: window.SLRouting });
      if (out !== undefined) await SL.call("testDone", { text: JSON.stringify(out, null, 1) });
    } catch (e) { await SL.call("testDone", { text: JSON.stringify({ error: String((e as Error)?.stack || e) }) }); }
  }
}

main().catch((e) => console.error("set.Line routing page:", e));
