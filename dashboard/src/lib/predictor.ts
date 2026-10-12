// Predictor view model: forecast history, alert spans, observed lead time. Pure functions (no clock).
// Everything is derived from what the stream actually carried; nothing is estimated or invented.
import type { Snapshot, StreamEvent } from "./ws-types";

/** Default `PredictObserve` threshold of the throttle ladder (platform/internal/throttle/config.go). */
export const ALERT_P = 0.6;
/** An alert counts as "acted on" if the tenant escalated within this window after it began. */
export const FOLLOW_UP_MS = 30_000;
const MIN_SPAN_MS = 3_000;
export const BUFFER_MAX = 600;

export interface ForecastPoint {
  ts: number;
  host: { p?: number; cpu: number };
  t: Record<string, { p?: number; p99: number }>;
}

export function forecastPoint(s: Snapshot, ts: number): ForecastPoint {
  const t: ForecastPoint["t"] = {};
  for (const x of s.tenants) t[x.tenant_id] = { p: x.p_overload, p99: x.p99_ms };
  return { ts, host: { p: s.host.p_overload, cpu: s.host.cpu_util }, t };
}

export function pushForecast(buf: ForecastPoint[], p: ForecastPoint, max = BUFFER_MAX): ForecastPoint[] {
  if (buf.length && buf[buf.length - 1].ts === p.ts) return buf;
  const next = buf.length >= max ? buf.slice(buf.length - max + 1) : buf.slice();
  next.push(p);
  return next;
}

export type Target = "host" | string;

export interface ChartRow {
  ts: number;
  /** Tenant: p99 ms. Host: CPU utilisation in %. */
  actual: number;
  /** p_overload 0..1, undefined when the stream did not carry it. */
  forecast?: number;
}

export function seriesFor(buf: ForecastPoint[], target: Target): ChartRow[] {
  const out: ChartRow[] = [];
  for (const p of buf) {
    if (target === "host") out.push({ ts: p.ts, actual: p.host.cpu * 100, forecast: p.host.p });
    else if (p.t[target]) out.push({ ts: p.ts, actual: p.t[target].p99, forecast: p.t[target].p });
  }
  return out;
}

export interface Span {
  from: number;
  to: number;
}

/** Contiguous stretches where the forecast was at/above `thr` for at least `minMs`. */
export function alertSpans(rows: ChartRow[], thr = ALERT_P, minMs = MIN_SPAN_MS): Span[] {
  const out: Span[] = [];
  let start: number | null = null;
  let last = 0;
  const close = () => {
    if (start !== null && last - start >= minMs) out.push({ from: start, to: last });
    start = null;
  };
  for (const r of rows) {
    if (r.forecast !== undefined && r.forecast >= thr) {
      if (start === null) start = r.ts;
      last = r.ts;
    } else close();
  }
  close();
  return out;
}

export interface LeadItem {
  tenant: string;
  /** Seconds between the forecast crossing the threshold and the ladder escalating. */
  leadS: number;
  /** The alert was already active when the buffer began, so the true lead is at least this long. */
  atLeast: boolean;
  eventTs: number;
  from: number;
  to: number;
}

export interface AlertStats {
  leads: LeadItem[];
  /** Alerts with a forecast ≥ threshold. */
  alerts: number;
  /** Alerts followed by an escalation of the same tenant within FOLLOW_UP_MS. */
  actedOn: number;
  /** Alerts with no escalation in that window (candidate false alarms; may still be true near-misses). */
  noFollowUp: number;
  /** Escalations from Normal with no preceding alert. */
  unwarned: number;
}

const isEscalation = (e: StreamEvent) => e.kind === "throttle" && e.from_level !== undefined && e.to_level !== undefined && e.to_level > e.from_level;

export function analyzeAlerts(buf: ForecastPoint[], events: StreamEvent[], tenants: string[], thr = ALERT_P): AlertStats {
  const leads: LeadItem[] = [];
  let alerts = 0;
  let actedOn = 0;
  let unwarned = 0;
  const first = buf.length ? buf[0].ts : 0;
  for (const tenant of tenants) {
    const spans = alertSpans(seriesFor(buf, tenant), thr);
    const esc = events.filter((e) => e.tenant_id === tenant && isEscalation(e)).map((e) => ({ e, ts: Date.parse(e.ts) })).filter((x) => Number.isFinite(x.ts));
    alerts += spans.length;
    for (const s of spans) if (esc.some((x) => x.ts >= s.from && x.ts <= s.to + FOLLOW_UP_MS)) actedOn++;
    for (const { e, ts } of esc) {
      if (e.from_level !== 0) continue;
      const span = spans.find((s) => s.from <= ts && ts <= s.to + FOLLOW_UP_MS);
      if (!span) {
        unwarned++;
        continue;
      }
      leads.push({ tenant, leadS: Math.max(0, (ts - span.from) / 1000), atLeast: span.from <= first, eventTs: ts, from: e.from_level ?? 0, to: e.to_level ?? 0 });
    }
  }
  leads.sort((a, b) => b.eventTs - a.eventTs);
  return { leads, alerts, actedOn, noFollowUp: alerts - actedOn, unwarned };
}

export type ModelId = "baseline" | "gbm";
export const MODEL_LABEL: Record<ModelId, string> = { baseline: "Holt baseline", gbm: "ML challenger" };
export function modelId(raw: string | undefined): ModelId | null {
  return raw === "baseline" || raw === "gbm" ? raw : null;
}

/** Sorted, normalised feature importances; empty when the API did not provide any. */
export function featureBars(raw: unknown): { name: string; value: number }[] {
  if (!raw || typeof raw !== "object") return [];
  const rows = Object.entries(raw as Record<string, unknown>)
    .filter((kv): kv is [string, number] => typeof kv[1] === "number" && Number.isFinite(kv[1]) && kv[1] > 0)
    .map(([name, value]) => ({ name, value }));
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return rows.map((r) => ({ name: r.name, value: r.value / max })).sort((a, b) => b.value - a.value);
}
