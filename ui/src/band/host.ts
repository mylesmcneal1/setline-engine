// set.Line band screens (6g), the host side, in the desktop page: answers the screens (band.html) through the band
// server (app-gui/BandServer.h). A screen says hello (and its join PIN, if one is set), picks or is given a screen
// layout, then gets the setlist ("show", when it changes) and the live state (15 times a second, stamped by the app
// with its clock and the engine's transport). Its buttons send commands; each is checked against that screen's layout
// (logic.allowed) and then run exactly like the keyboard actions. Nothing here touches the audio: a screen that
// disappears is just a client less.
import * as logic from "./logic.js";
import qrcode from "qrcode-generator";
import type { SetLineBridge } from "../bridge";

export function qrSVG(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
(window as any).SLBand = { ...logic, qrSVG };

interface Client { screen: string | null; address: string; ok: boolean; device: string }
type Page = () => any;

export function startBandHost(SL: SetLineBridge, page: Page) {
  const clients = new Map<number, Client>();
  let showText = "", lastCur: string | null | undefined = undefined;
  const send = (to: number, o: unknown) => SL.call("bandSend", { text: JSON.stringify(o), to }).catch(() => {});
  const bcast = (o: unknown) => SL.call("bandSend", { text: JSON.stringify(o) }).catch(() => {});
  const B = () => page().band;
  const screenList = () => B().data.screens.map((x: any) => ({ id: x.id, name: x.name, col: x.col, device: x.device }));
  const devices = () => [...clients.entries()].map(([id, c]) => ({ id, address: c.address, screen: c.screen, device: c.device, ok: c.ok }));
  const online = () => {
    const m: Record<string, number> = {};
    for (const c of clients.values()) if (c.screen) m[c.screen] = (m[c.screen] || 0) + 1;
    B().online(m, devices());
  };
  // 7d: a paired backup's band server: the screens keep its address and switch to it if this computer goes away
  let alt: string[] = [];
  const welcome = (id: number) => {
    const c = clients.get(id)!;
    send(id, { t: "welcome", screens: screenList(), screen: c.screen ? B().screen(c.screen) : null, show: B().show(), network: B().data.network || "" });
    if (alt.length) send(id, { t: "alt", hosts: alt });
  };
  setInterval(async () => {
    try {
      const ri = await SL.call<any>("rigInfo"), bi = await SL.call<any>("bandInfo");
      const next = ri && ri.role === "primary" && ri.paired && bi && bi.running ? [`${ri.peer}:${bi.port}`] : [];
      if (JSON.stringify(next) !== JSON.stringify(alt)) { alt = next; if (clients.size) bcast({ t: "alt", hosts: alt }); }
    } catch {}
  }, 3000);

  SL.on("bandClient", (e: { client: number; connected: boolean; address: string }) => {
    if (e.connected) clients.set(e.client, { screen: null, address: e.address, ok: false, device: "" });
    else clients.delete(e.client);
    online();
  });
  SL.on("bandMessage", (e: { client: number; text: string }) => handle(e.client, e.text));

  function handle(id: number, text: string) {
    let m: any;
    try { m = JSON.parse(text); } catch { return; }
    const c = clients.get(id);
    if (!c) return;
    const pin = B().data.pin || "";
    if (m.t === "hello") {
      if (pin && String(m.pin || "") !== pin) { send(id, { t: "needPin", wrong: !!m.pin }); return; }
      c.ok = true; c.device = String(m.device || "").slice(0, 60);
      c.screen = m.screen && B().screen(m.screen) ? m.screen : null;
      welcome(id); online();
      return;
    }
    if (!c.ok) { send(id, { t: "needPin" }); return; }
    if (m.t === "pick") {
      let sid = m.screen;
      if (m.newName) sid = B().addScreen(String(m.newName).slice(0, 40), m.preset || "blank").id;
      if (!B().screen(sid)) return;
      c.screen = sid;
      send(id, { t: "layout", screen: B().screen(sid) });
      if (m.newName) bcast({ t: "screens", screens: screenList() });
      online();
      return;
    }
    const scr = c.screen ? B().screen(c.screen) : null;
    if (m.t === "status") {
      if (!scr || ![...(scr.land || []), ...(scr.port || [])].some((w: any) => w.type === "status")) return;
      B().status(scr.name, String(m.label || "").slice(0, 40), !!m.on);
      bcast({ t: "status", from: scr.name, screen: scr.id, label: m.label, on: !!m.on });
      return;
    }
    if (m.t === "cmd") {
      const a = logic.allowed(scr, m.cmd, m.w);
      if (!a.ok) {
        send(id, { t: "ack", w: m.w, ok: false, why: a.why });
        SL.call("logLine", { text: `Band: refused “${m.cmd}” from ${scr ? scr.name : "a device with no screen"} (${a.why})` }).catch(() => {});
        return;
      }
      let r: any;
      try { r = run(m.cmd, a.widget, m.arg) || { ok: true }; } catch (e) { r = { ok: false, why: String(e) }; }
      send(id, { t: "ack", w: m.w, ok: r.ok !== false, why: r.why || "" });
    }
  }

  function run(cmd: string, w: any, arg: any) {
    const P = page(), act = P.actions(), cfg = w.cfg || {};
    switch (cmd) {
      case "play": if (!P.playing) act.run("playStop"); return { ok: true };
      case "stop": if (P.playing) act.run("playStop"); return { ok: true };
      case "nextSong": act.run("nextSong"); return { ok: true };
      case "prevSong": act.run("prevSong"); return { ok: true };
      case "exitLoop": return { ok: act.run("exitLoop") };
      case "flipVersion": act.run("nextVersion"); return { ok: true };
      case "soundcheck": return cfg.song ? B().soundcheck(cfg.song, cfg.ver) : { ok: false, why: "No song chosen for this button (Band page)" };
      case "vamp": return B().vamp();
      case "jump": B().jump(+arg); return { ok: true };
      case "cancelJump": B().cancelJump(); return { ok: true };
      case "syncMidi": B().syncMidi(); return { ok: true };
      case "midi": {
        const { msgs } = B().syncLines(cfg.text || "", cfg.ch || 1);
        if (!cfg.port || !msgs.length) return { ok: false, why: "This button has no MIDI messages (Band page)" };
        SL.call("sendMidiNow", { port: cfg.port, msgs }).catch(() => {});
        return { ok: true };
      }
    }
    return { ok: false, why: "unknown command" };
  }

  // the live state, 15 times a second (only while a screen is connected); statuses clear when the song changes
  setInterval(() => {
    if (!clients.size) return;
    const live = B().live();
    if (lastCur !== undefined && live.cur !== lastCur) { B().clearStatus(); bcast({ t: "status", clear: true }); }
    lastCur = live.cur;
    SL.call("bandSend", { state: true, text: JSON.stringify(live) }).catch(() => {});
  }, 66);
  // the setlist, when anything in it changes
  setInterval(() => {
    const s = JSON.stringify(B().show());
    if (s === showText) return;
    showText = s;
    if (clients.size) SL.call("bandSend", { text: s }).catch(() => {});
  }, 1000);

  return {
    // a layout was edited (Band page): every device showing that screen redraws at once
    layoutChanged() {
      for (const [id, c] of clients) if (c.screen) send(id, { t: "layout", screen: B().screen(c.screen) });
      bcast({ t: "screens", screens: screenList(), network: B().data.network || "" });
      showText = "";
    },
    // the host gives a device another screen
    assign(client: number, screen: string | null) {
      const c = clients.get(client);
      if (!c) return;
      c.screen = screen && B().screen(screen) ? screen : null;
      send(client, { t: "assign", screen: c.screen ? B().screen(c.screen) : null, screens: screenList() });
      online();
    },
    devices,
    clientCount: () => clients.size,
    // tests: what a device would be told / how a command from a screen would be answered
    handle,
  };
}
