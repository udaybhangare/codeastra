// Pure helpers for the Incidents page (docs/ui/05 §2). No Date.now(): callers pass the clock anchor.
import { eventId } from "./evidence.ts";
import type { Level, StreamEvent } from "./ws-types.ts";

export type KindFilter = "all" | StreamEvent["kind"];
export type RangeFilter = "1m" | "5m" | "all";
/** Minimum level entered (events without a level always pass). */
export type MinLevel = 0 | 1 | 3 | 5;

export interface IncidentFilter {
  tenant: string; // "all" or tenant id
  minLevel: MinLevel;
  kind: KindFilter;
  range: RangeFilter;
}

export const DEFAULT_FILTER: IncidentFilter = { tenant: "all", minLevel: 0, kind: "all", range: "all" };

const RANGE_MS: Record<RangeFilter, number> = { "1m": 60_000, "5m": 300_000, all: Infinity };

const tsOf = (e: StreamEvent) => Date.parse(e.ts);

/** Events worth showing on the incidents page, newest first. `anchor` = latest known ts (ms). */
export function filterEvents(events: StreamEvent[], f: IncidentFilter, anchor: number): StreamEvent[] {
  const since = anchor - RANGE_MS[f.range];
  return events
    .filter((e) => {
      if (f.tenant !== "all" && e.tenant_id !== f.tenant) return false;
      if (f.kind !== "all" && e.kind !== f.kind) return false;
      if (e.to_level !== undefined && e.to_level < f.minLevel) return false;
      if (f.range !== "all" && tsOf(e) < since) return false;
      return true;
    })
    .sort((a, b) => tsOf(b) - tsOf(a));
}

export interface Segment {
  from: number;
  to: number;
  level: Level;
}
export interface Lane {
  tenant: string;
  events: StreamEvent[]; // ascending
  /** Dwell segments: each step's level held until the next step (or `now`). Predicted events don't change level. */
  segments: Segment[];
}

/** One swimlane per tenant, tenants sorted by id. */
export function buildLanes(events: StreamEvent[], now: number): Lane[] {
  const by = new Map<string, StreamEvent[]>();
  for (const e of events) by.set(e.tenant_id, [...(by.get(e.tenant_id) ?? []), e]);
  return [...by.keys()].sort().map((tenant) => {
    const evs = (by.get(tenant) as StreamEvent[]).sort((a, b) => tsOf(a) - tsOf(b));
    const real = evs.filter((e) => e.kind !== "predict" && e.to_level !== undefined);
    const segments = real.map((e, i) => ({
      from: tsOf(e),
      to: i + 1 < real.length ? tsOf(real[i + 1]) : Math.max(now, tsOf(e)),
      level: e.to_level as Level,
    }));
    return { tenant, events: evs, segments };
  });
}

export interface Incident {
  culprit: string;
  events: StreamEvent[]; // newest first
  peak: Level;
  /** Still above L0 after its latest real step. */
  active: boolean;
  lastTs: number;
}

/** Group steps by culprit tenant; incidents are ordered by most recent activity. */
export function groupIncidents(events: StreamEvent[]): Incident[] {
  const by = new Map<string, StreamEvent[]>();
  for (const e of events) by.set(e.tenant_id, [...(by.get(e.tenant_id) ?? []), e]);
  const out: Incident[] = [];
  for (const [culprit, evs] of by) {
    const sorted = [...evs].sort((a, b) => tsOf(b) - tsOf(a));
    const levels = sorted.filter((e) => e.kind !== "predict" && e.to_level !== undefined);
    const peak = levels.reduce<Level>((m, e) => ((e.to_level as Level) > m ? (e.to_level as Level) : m), 0);
    out.push({ culprit, events: sorted, peak, active: (levels[0]?.to_level ?? 0) > 0, lastTs: tsOf(sorted[0]) });
  }
  return out.sort((a, b) => b.lastTs - a.lastTs);
}

export interface View {
  start: number;
  span: number;
}

const MIN_SPAN = 5_000;

/** Default view: all events with 8 % padding, at least one minute wide, right edge at `now`. */
export function fitView(events: StreamEvent[], now: number): View {
  if (events.length === 0) return { start: now - 60_000, span: 60_000 };
  const ts = events.map(tsOf);
  const lo = Math.min(...ts);
  const hi = Math.max(now, ...ts);
  const span = Math.max(60_000, (hi - lo) * 1.16);
  return { start: hi + span * 0.04 - span, span };
}

export function panView(v: View, dxMs: number): View {
  return { start: v.start + dxMs, span: v.span };
}

/** Zoom keeping the time under the cursor fixed. `focus` is 0..1 across the plot; factor <1 zooms in. */
export function zoomView(v: View, factor: number, focus: number, maxSpan: number): View {
  const span = Math.min(maxSpan, Math.max(MIN_SPAN, v.span * factor));
  const at = v.start + v.span * focus;
  return { start: at - span * focus, span };
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].map((s) => s * 1000);

/** Tick timestamps for the visible window only (so the axis never grows with history). */
export function axisTicks(v: View, target = 6): number[] {
  const step = STEPS.find((s) => v.span / s <= target) ?? STEPS[STEPS.length - 1];
  const first = Math.ceil(v.start / step) * step;
  const out: number[] = [];
  for (let t = first; t <= v.start + v.span; t += step) out.push(t);
  return out;
}

export interface Window {
  before: [number, number];
  after: [number, number];
}
/** ±30 s around an event for the before/after mini charts. */
export function eventWindow(ts: number, ms = 30_000): Window {
  return { before: [ts - ms, ts], after: [ts, ts + ms] };
}

export function mean(xs: number[]): number | undefined {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

export { eventId };
