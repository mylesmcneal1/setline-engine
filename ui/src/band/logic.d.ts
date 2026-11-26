// Types for logic.js (plain JavaScript so Node runs its unit tests directly).
export class ClockSync {
  constructor(keep?: number);
  samples: { off: number; rtt: number }[];
  add(c0: number, h: number, c1: number): number;
  readonly ready: boolean;
  offset(): number;
  rtt(): number;
  hostNow(clientNow: number): number;
}
export function predictPos(state: any, hostNow: number): number;
export function barBeatAt(song: any, t: number): { bar: number; beat: number; num: number; den: number; bpm: number; barT: number; barLen: number };
export function hitAt(song: any, t: number): [number, number] | null;
export function sectionAt(song: any, t: number): any;
export function nextSection(song: any, t: number): any;
export function barsUntil(song: any, t: number, tEnd: number): number;
export function changesAhead(song: any, t: number, n?: number): { inBars: number; text: string }[];
export function fieldValue(show: any, songId: string, fieldId: string): string;
export function fieldValueAt(show: any, songId: string, fieldId: string, t: number): string;
export function mergeFields(a: any, b: any): Record<string, any>;
export function untilNextChange(show: any, curIndex: number, pos: number, field: string): null | { value: string; fromValue: string; songId: string; songName: string; index: number; inSec: number | null; after: string | null; progress: number };
export function curfew(show: any, curIndex: number, pos: number, nowMs: number, finishBy: string): { endsAt: number; finishAt: number | null; overSec: number | null; talking: boolean; leftSec: number };
export const WIDGETS: Record<string, { group: string; name: string; w: number; h: number; cmd?: string[] }>;
export function allowed(screen: any, cmd: string, widgetId: string): { ok: boolean; why?: string; widget?: any };
export function preset(kind: string): { land: any[]; port: any[] };
export const PRESETS: [string, string][];
export function clampWidget(w: any): any;
export function fmtTime(sec: number | null | undefined): string;
