// Pure selectors + a small 60 s ring buffer for the Overview (docs/ui/05 §1). No React, no Date/random.
// Relative imports only so `node --test` can load this file.
import { ENTITLEMENT } from "./ladder.ts";
import type { Isolation, Level, Snapshot, StreamEvent, TenantMetrics } from "./ws-types.ts";

export const SPARK_POINTS = 60;

// ---- resources ------------------------------------------------------------
export type ResourceKey = "cpu" | "mem" | "db" | "queue" | "bw";

export interface Resource {
  key: ResourceKey;
  label: string;
  /** Usage as a share of the tenant's tier entitlement (1 = at quota). */
  ratio: (t: TenantMetrics) => number;
  /** "used / quota" for tooltips and screen readers. */
  raw: (t: TenantMetrics) => string;
}

const mb = (n: number) => `${Math.round(n)} MB`;
const mbps = (n: number) => `${(n / 1e6).toFixed(1)} MB/s`;

export const RESOURCES: Resource[] = [
  {
    key: "cpu",
    label: "CPU",
    ratio: (t) => t.cpu_share / ENTITLEMENT[t.tier].cpu,
    raw: (t) => `${t.cpu_share.toFixed(2)} / ${ENTITLEMENT[t.tier].cpu.toFixed(2)} cores`,
  },
  {
    key: "mem",
    label: "Memory",
    ratio: (t) => t.mem_mb / ENTITLEMENT[t.tier].mem_mb,
    raw: (t) => `${mb(t.mem_mb)} / ${mb(ENTITLEMENT[t.tier].mem_mb)}`,
  },
  {
    key: "db",
    label: "DB",
    ratio: (t) => (t.db_conns ?? 0) / ENTITLEMENT[t.tier].db_conns,
    raw: (t) => `${t.db_conns ?? 0} / ${ENTITLEMENT[t.tier].db_conns} conns`,
  },
  {
    key: "queue",
    label: "Queue",
    ratio: (t) => t.queue_depth / ENTITLEMENT[t.tier].queue,
    raw: (t) => `${t.queue_depth} / ${ENTITLEMENT[t.tier].queue} jobs`,
  },
  {
    key: "bw",
    label: "Bandwidth",
    ratio: (t) => (t.bytes_s ?? 0) / ENTITLEMENT[t.tier].bytes_s,
    raw: (t) => `${mbps(t.bytes_s ?? 0)} / ${mbps(ENTITLEMENT[t.tier].bytes_s)}`,
  },
];

// ---- victim / culprit ------------------------------------------------------
export interface Roles {
  victims: Set<string>;
  culprits: Set<string>;
}

/**
 * Culprit: throttled tenant (level > 0). Victim: unthrottled tenant whose p99 is over 2x its own
 * best value in the window.
 */
export function classifyTenants(history: { [k: string]: number }[], latest: Snapshot | null): Roles {
  const victims = new Set<string>();
  const culprits = new Set<string>();
  if (!latest) return { victims, culprits };
  for (const t of latest.tenants) {
    if (t.level > 0) {
      culprits.add(t.tenant_id);
      continue;
    }
    let min = Infinity;
    for (const p of history) {
      const v = p[t.tenant_id];
      if (v > 0 && v < min) min = v;
    }
    if (min < Infinity && t.p99_ms > min * 2) victims.add(t.tenant_id);
  }
  return { victims, culprits };
}

// ---- KPI ring buffer -------------------------------------------------------
export interface KpiPoint {
  ts: number;
  cpu: number;
  mem: number;
  jain?: number;
  inflation?: number;
  throttles: number;
}

export function kpiPoint(s: Snapshot, ts: number): KpiPoint {
  return {
    ts,
    cpu: s.host.cpu_util,
    mem: s.host.mem_util,
    jain: s.fairness?.jain,
    inflation: s.fairness?.victim_inflation,
    throttles: s.tenants.filter((t) => t.level > 0).length,
  };
}

/** Returns a new buffer capped at `max` points (oldest dropped). */
export function pushCapped<T>(buf: readonly T[], p: T, max = SPARK_POINTS): T[] {
  const next = buf.length >= max ? buf.slice(buf.length - max + 1) : buf.slice();
  next.push(p);
  return next;
}

/** Numeric series for a sparkline; gaps (undefined) are dropped. */
export function series(buf: readonly KpiPoint[], key: "cpu" | "mem" | "jain" | "inflation" | "throttles"): number[] {
  const out: number[] = [];
  for (const p of buf) {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Change vs `lag` points ago (default ~10 s at 1 Hz). Undefined until enough history. */
export function delta(values: readonly number[], lag = 10): number | undefined {
  if (values.length < 2) return undefined;
  const ref = values[Math.max(0, values.length - 1 - lag)];
  return values[values.length - 1] - ref;
}

// ---- time in level ---------------------------------------------------------
export type LevelSince = Record<string, { level: Level; since: number }>;

/** Updates the per-tenant "since" map from a snapshot. Uses the snapshot's own ts as the clock. */
export function trackLevels(prev: LevelSince, s: Snapshot, ts: number): LevelSince {
  let changed = false;
  const next: LevelSince = {};
  for (const t of s.tenants) {
    const p = prev[t.tenant_id];
    if (p && p.level === t.level) next[t.tenant_id] = p;
    else {
      next[t.tenant_id] = { level: t.level, since: ts };
      changed = true;
    }
  }
  if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev;
  return next;
}

/** Latest throttle decision for a tenant, preferring one that landed on its current level. */
export function whyEvent(events: StreamEvent[], tenantId: string, level: Level): StreamEvent | undefined {
  let fallback: StreamEvent | undefined;
  for (const e of events) {
    if (e.tenant_id !== tenantId || e.kind !== "throttle") continue;
    if (e.to_level === level) return e;
    fallback ??= e;
  }
  return fallback;
}

// ---- isolation -------------------------------------------------------------
export function effectiveIsolation(
  stream: Isolation | undefined,
  source: "mock" | "live",
  mockOverride: Isolation | null,
): Isolation | undefined {
  return source === "mock" && mockOverride ? mockOverride : stream;
}

// ---- heatmap ---------------------------------------------------------------
/** Fill height 0..1 for a tank; overflow is drawn separately above 1. */
export const tankFill = (ratio: number) => Math.min(1, Math.max(0, ratio));
export const isOverflow = (ratio: number) => ratio > 1;
