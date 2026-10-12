// Tenant policy helpers for the Tenants page: tier presets, diff chips, validation, row merge.
// Pure functions (no clock, no I/O). Mirrors platform/internal/policy/policy.go (Preset, Validate).
import type { Level, Tier, TenantMetrics } from "./ws-types";

export interface PolicyFields {
  weight: number;
  reserve_cpu: number;
  limit_cpu: number;
  limit_mem_mb: number;
  rps: number;
  burst: number;
  cost_per_s: number;
  concurrency: number;
  queue_depth: number;
  db_conns: number;
  bandwidth_bps: number;
}
export type PolicyKey = keyof PolicyFields;
export type PolicyDraft = PolicyFields & { tier: Tier };

const MB = 1 << 20;

/** Same numbers as `policy.Preset` in the Go platform. */
export const TIER_PRESETS: Record<Tier, PolicyFields> = {
  free: { weight: 1, reserve_cpu: 0.1, limit_cpu: 0.5, limit_mem_mb: 256, rps: 10, burst: 20, cost_per_s: 50, concurrency: 4, queue_depth: 50, db_conns: 2, bandwidth_bps: MB },
  pro: { weight: 4, reserve_cpu: 0.5, limit_cpu: 1.5, limit_mem_mb: 1024, rps: 50, burst: 100, cost_per_s: 300, concurrency: 16, queue_depth: 200, db_conns: 8, bandwidth_bps: 8 * MB },
  enterprise: { weight: 10, reserve_cpu: 1, limit_cpu: 3, limit_mem_mb: 2048, rps: 150, burst: 300, cost_per_s: 1000, concurrency: 32, queue_depth: 500, db_conns: 20, bandwidth_bps: 32 * MB },
};

export const TIERS: readonly Tier[] = ["free", "pro", "enterprise"];

export interface FieldDef {
  key: PolicyKey;
  label: string;
  unit: string;
  group: "share" | "rate" | "capacity";
  min: number;
  max: number;
  step: number;
  /** Display value = raw / scale (bandwidth is stored in bytes/s, shown in MB/s). */
  scale: number;
  digits: number;
}

export const FIELD_DEFS: readonly FieldDef[] = [
  { key: "weight", label: "Fair-share weight", unit: "", group: "share", min: 1, max: 20, step: 1, scale: 1, digits: 0 },
  { key: "reserve_cpu", label: "CPU reserved", unit: "cores", group: "share", min: 0, max: 4, step: 0.05, scale: 1, digits: 2 },
  { key: "limit_cpu", label: "CPU limit", unit: "cores", group: "share", min: 0.1, max: 6, step: 0.05, scale: 1, digits: 2 },
  { key: "limit_mem_mb", label: "Memory limit", unit: "MB", group: "share", min: 64, max: 4096, step: 64, scale: 1, digits: 0 },
  { key: "rps", label: "Request rate", unit: "rps", group: "rate", min: 1, max: 300, step: 1, scale: 1, digits: 0 },
  { key: "burst", label: "Burst bucket", unit: "req", group: "rate", min: 1, max: 600, step: 1, scale: 1, digits: 0 },
  { key: "cost_per_s", label: "Cost budget", unit: "units/s", group: "rate", min: 1, max: 2000, step: 10, scale: 1, digits: 0 },
  { key: "bandwidth_bps", label: "Egress cap", unit: "MB/s", group: "rate", min: 1, max: 64, step: 1, scale: MB, digits: 0 },
  { key: "concurrency", label: "Concurrency", unit: "in flight", group: "capacity", min: 1, max: 64, step: 1, scale: 1, digits: 0 },
  { key: "queue_depth", label: "Queue depth", unit: "req", group: "capacity", min: 0, max: 1000, step: 10, scale: 1, digits: 0 },
  { key: "db_conns", label: "DB connections", unit: "conns", group: "capacity", min: 1, max: 40, step: 1, scale: 1, digits: 0 },
];

export const POLICY_KEYS: readonly PolicyKey[] = FIELD_DEFS.map((d) => d.key);

/** Slider upper bound that always contains the current value. */
export function rangeMax(def: FieldDef, raw: number): number {
  return Math.max(def.max, Math.ceil(raw / def.scale / def.step) * def.step);
}

export function pickFields(p: PolicyFields): PolicyFields {
  const out = {} as PolicyFields;
  for (const k of POLICY_KEYS) out[k] = p[k];
  return out;
}

export function presetDraft(tier: Tier): PolicyDraft {
  return { tier, ...TIER_PRESETS[tier] };
}

export function fmtField(def: FieldDef, raw: number): string {
  const v = raw / def.scale;
  const s = def.digits ? v.toFixed(def.digits) : String(Math.round(v));
  return def.unit ? `${s} ${def.unit}` : s;
}

export interface DiffChip {
  key: PolicyKey | "tier";
  label: string;
  from: string;
  to: string;
}

/** Changed fields between two drafts, in catalog order ("CPU limit 0.30 → 0.20 cores"). */
export function diffPolicy(before: PolicyDraft, after: PolicyDraft): DiffChip[] {
  const out: DiffChip[] = [];
  if (before.tier !== after.tier) out.push({ key: "tier", label: "Tier", from: before.tier, to: after.tier });
  for (const d of FIELD_DEFS) {
    if (before[d.key] !== after[d.key]) out.push({ key: d.key, label: d.label, from: fmtField(d, before[d.key]), to: fmtField(d, after[d.key]) });
  }
  return out;
}

/** Only the changed keys; the backend merges omitted fields from the current policy. */
export function policyPatch(before: PolicyDraft, after: PolicyDraft): Partial<PolicyDraft> {
  const out: Partial<PolicyDraft> = {};
  if (before.tier !== after.tier) out.tier = after.tier;
  for (const k of POLICY_KEYS) if (before[k] !== after[k]) out[k] = after[k];
  return out;
}

/** Client-side mirror of `Policy.Validate`; the server stays authoritative. */
export function validatePolicy(p: PolicyDraft): string[] {
  const e: string[] = [];
  if (p.weight <= 0) e.push("Weight must be above 0.");
  if (p.reserve_cpu < 0) e.push("CPU reserved can't be negative.");
  if (p.limit_cpu <= 0) e.push("CPU limit must be above 0.");
  if (p.reserve_cpu > p.limit_cpu) e.push(`CPU reserved (${p.reserve_cpu}) can't exceed the CPU limit (${p.limit_cpu}).`);
  if (p.limit_mem_mb <= 0) e.push("Memory limit must be above 0.");
  if (p.rps <= 0) e.push("Request rate must be above 0.");
  if (p.burst < 1) e.push("Burst must be at least 1.");
  if (p.cost_per_s <= 0) e.push("Cost budget must be above 0.");
  if (p.concurrency < 1) e.push("Concurrency must be at least 1.");
  if (p.queue_depth < 0) e.push("Queue depth can't be negative.");
  if (p.db_conns < 1) e.push("DB connections must be at least 1.");
  if (p.bandwidth_bps <= 0) e.push("Egress cap must be above 0.");
  return e;
}

/** Row shape of GET /admin/tenants (docs/04). */
export interface ApiTenant {
  id: string;
  name?: string;
  tier: Tier;
  status?: string;
  policy: PolicyFields & { tenant_id?: string; tier?: Tier };
}

export interface TenantRow {
  id: string;
  tier: Tier;
  policy: PolicyFields;
  /** "api" = real policy from the backend; "preset" = tier defaults (mock stream, or policy not loaded yet). */
  source: "api" | "preset";
  metrics: TenantMetrics | null;
  level: Level;
}

/** Join backend policies (when live) with the 1 Hz stream metrics. Ids come from the union. */
export function buildRows(api: ApiTenant[] | null, tenants: TenantMetrics[]): TenantRow[] {
  const m = new Map(tenants.map((t) => [t.tenant_id, t]));
  const rows = new Map<string, TenantRow>();
  for (const a of api ?? []) {
    const met = m.get(a.id) ?? null;
    rows.set(a.id, { id: a.id, tier: a.tier, policy: pickFields(a.policy), source: "api", metrics: met, level: (met?.level ?? 0) as Level });
  }
  for (const t of tenants) {
    if (rows.has(t.tenant_id)) continue;
    rows.set(t.tenant_id, { id: t.tenant_id, tier: t.tier, policy: pickFields(TIER_PRESETS[t.tier]), source: "preset", metrics: t, level: t.level });
  }
  return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface Usage {
  ratio: number;
  resource: "rate" | "memory" | "queue";
}

/** Most-used quota right now: request rate, memory or queue, as a fraction of the policy limit. */
export function quotaUsage(row: TenantRow): Usage {
  const t = row.metrics;
  const cands: Usage[] = [
    { ratio: t && row.policy.rps > 0 ? t.rps / row.policy.rps : 0, resource: "rate" },
    { ratio: t && row.policy.limit_mem_mb > 0 ? t.mem_mb / row.policy.limit_mem_mb : 0, resource: "memory" },
    { ratio: t && row.policy.queue_depth > 0 ? t.queue_depth / row.policy.queue_depth : 0, resource: "queue" },
  ];
  return cands.reduce((a, b) => (b.ratio > a.ratio ? b : a));
}

export type SortKey = "tenant" | "tier" | "level" | "rps" | "p99" | "cpu" | "quota";

export function sortRows(rows: TenantRow[], key: SortKey, dir: 1 | -1): TenantRow[] {
  const val = (r: TenantRow): number | string => {
    switch (key) {
      case "tenant": return r.id;
      case "tier": return TIERS.indexOf(r.tier);
      case "level": return r.level;
      case "rps": return r.metrics?.rps ?? 0;
      case "p99": return r.metrics?.p99_ms ?? 0;
      case "cpu": return r.metrics?.cpu_share ?? 0;
      case "quota": return quotaUsage(r).ratio;
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return c !== 0 ? c * dir : a.id.localeCompare(b.id);
  });
}
