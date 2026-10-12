import type { StreamEvent } from "./ws-types";

// Defensive readers for throttle-event evidence (platform/internal/throttle.Evidence).
// Every field may be missing; the UI shows "—" rather than guessing.
export interface ResourceEv {
  resource: string;
  share: number;
  entitlement: number;
  excess: number;
  corr: number;
  contribution: number;
}
export interface VictimEv {
  tenant: string;
  p99_ms: number;
  baseline_p99_ms: number;
  p99_inflation: number;
}
export interface ParsedEvidence {
  score?: number;
  tau?: number;
  predictor?: number;
  note?: string;
  thresholds: Record<string, number>;
  resources: ResourceEv[];
  victims: VictimEv[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

export function parseEvidence(raw: StreamEvent["evidence"]): ParsedEvidence {
  const ev = rec(raw);
  const inner = rec(rec(ev.finding).evidence);
  const thresholds: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(ev.thresholds))) {
    const n = num(v);
    if (n !== undefined) thresholds[k] = n;
  }
  return {
    score: num(ev.score),
    tau: num(inner.tau),
    predictor: num(ev.predictor_score),
    note: typeof ev.note === "string" && ev.note ? ev.note : undefined,
    thresholds,
    resources: arr(inner.resources).map((r) => ({
      resource: String(r.resource ?? "?"),
      share: num(r.share) ?? 0,
      entitlement: num(r.entitlement) ?? 0,
      excess: num(r.excess) ?? 0,
      corr: num(r.corr) ?? 0,
      contribution: num(r.contribution) ?? 0,
    })),
    victims: arr(inner.victims).map((v) => ({
      tenant: String(v.tenant ?? "?"),
      p99_ms: num(v.p99_ms) ?? 0,
      baseline_p99_ms: num(v.baseline_p99_ms) ?? 0,
      p99_inflation: num(v.p99_inflation) ?? 0,
    })),
  };
}

// One plain-English line per applied action (kinds from throttle.Action).
export function describeAction(a: Record<string, unknown>): string {
  const kind = String(a.kind ?? "");
  const v = num(a.value);
  const x = v === undefined ? "?" : String(Math.round(v * 100) / 100);
  switch (kind) {
    case "scheduler.weight":
      return `Fair-share scheduler weight set to ×${x}`;
    case "scheduler.quarantine":
      return v ? "Moved to the quarantine lane" : "Released from the quarantine lane";
    case "bucket.rate_mult":
      return `Request rate limit set to ×${x} of quota`;
    case "bucket.burst":
      return v ? "Burst allowance enabled" : "Burst allowance disabled";
    case "cgroup.cpus":
      return `CPU capped at ${x} cores`;
    case "db.conn_cap":
      return `Database connections capped at ${x}`;
    default:
      return kind ? `${kind} = ${x}` : "Unknown action";
  }
}

export const eventId = (e: StreamEvent) => `${e.ts}|${e.tenant_id}|${e.from_level ?? ""}>${e.to_level ?? ""}|${e.kind}`;

export function sentence(e: StreamEvent): string {
  if (e.message) return e.message;
  if (e.from_level !== undefined && e.to_level !== undefined) return `${e.tenant_id} moved from L${e.from_level} to L${e.to_level}.`;
  return `${e.kind} event for ${e.tenant_id}.`;
}
