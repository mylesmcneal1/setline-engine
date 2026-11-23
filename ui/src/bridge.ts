// set.Line native bridge: the only code that talks to the C++ app (JUCE WebBrowserComponent).
// When the page is opened in a normal browser there is no window.__JUCE__, the bridge reports
// native = false and the pages keep their mockup behaviour.

type Listener = (payload: any) => void;

export interface SetLineBridge {
  native: boolean;
  ready: Promise<void>;
  call<T = any>(name: string, arg?: unknown): Promise<T>;
  on(event: string, fn: Listener): () => void;
}

declare global {
  interface Window {
    __JUCE__?: any;
    SL?: SetLineBridge;
  }
}

// Must be read before importing JUCE's helper: it installs a placeholder window.__JUCE__ when missing.
const native = typeof window.__JUCE__ !== "undefined" && !!window.__JUCE__?.backend;

let getNativeFunction: ((name: string) => (...args: unknown[]) => Promise<unknown>) | null = null;
const fnCache = new Map<string, (...args: unknown[]) => Promise<unknown>>();

const ready: Promise<void> = native
  ? import("./juce/index.js").then((m) => { getNativeFunction = m.getNativeFunction; })
  : Promise.resolve();

async function call<T = any>(name: string, arg?: unknown): Promise<T> {
  if (!native) throw new Error(`set.Line: "${name}" needs the desktop app`);
  await ready;
  let f = fnCache.get(name);
  if (!f) { f = getNativeFunction!(name); fnCache.set(name, f); }
  // Every native function takes one JSON string and returns one JSON string.
  const out = await f(arg === undefined ? "" : JSON.stringify(arg));
  return (typeof out === "string" && out.length ? JSON.parse(out) : out) as T;
}

function on(event: string, fn: Listener): () => void {
  if (!native) return () => {};
  const token = window.__JUCE__.backend.addEventListener(event, fn);
  return () => window.__JUCE__.backend.removeEventListener(token);
}

export const SL: SetLineBridge = { native, ready, call, on };
window.SL = SL;
document.documentElement.classList.toggle("sl-native", native);
window.dispatchEvent(new Event("sl-bridge"));
