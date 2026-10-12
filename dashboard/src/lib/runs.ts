import type { Isolation } from "./ws-types";

export interface SeriesPoint {
  t: number; // seconds since run start (aligned across OFF/ON)
  phase: string;
  [tenant: string]: number | string;
}

export interface RunBundle {
  run_id: string;
  scenario: string;
  isolation: Isolation;
  seed?: number;
  summary: Record<string, unknown>;
  series: SeriesPoint[];
}

export interface BundleFile {
  version: 1;
  scenario: string;
  seed?: number;
  off: RunBundle;
  on: RunBundle;
}

export function metricsOf(summary: Record<string, unknown>): Record<string, number> {
  const src = summary.metrics && typeof summary.metrics === "object" ? (summary.metrics as Record<string, unknown>) : summary;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

export function rolesOf(summary: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(summary.tenants)) {
    for (const t of summary.tenants as Record<string, unknown>[]) {
      if (typeof t.tenant === "string" && typeof t.role === "string") out[t.tenant] = t.role;
    }
  }
  return out;
}

export interface MetricDef {
  key: string;
  label: string;
  fmt: (v: number) => string;
  better: "lower" | "higher" | "none";
}

const x2 = (v: number) => `${v.toFixed(2)}×`;
// loadgen reports 1e4 when a threshold was never reached
const sec = (v: number) => (v >= 9999 ? "not reached" : `${v.toFixed(1)} s`);
const int = (v: number) => String(Math.round(v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

export const METRICS: MetricDef[] = [
  { key: "victim_p99_inflation", label: "Victim p99 inflation", fmt: x2, better: "lower" },
  { key: "jain", label: "Jain's fairness index", fmt: (v) => v.toFixed(2), better: "higher" },
  { key: "time_to_detect_s", label: "Time to detect", fmt: sec, better: "lower" },
  { key: "time_to_mitigate_s", label: "Time to mitigate", fmt: sec, better: "lower" },
  { key: "false_positive_count", label: "False positives", fmt: int, better: "lower" },
  { key: "victim_errors", label: "Victim errors", fmt: int, better: "lower" },
  { key: "victim_throughput_ratio", label: "Victim throughput vs baseline", fmt: pct, better: "higher" },
  { key: "utilization", label: "Host utilization", fmt: pct, better: "higher" },
  { key: "abuser_goodput_rps", label: "Abuser goodput", fmt: (v) => `${v.toFixed(1)} rps`, better: "none" },
];

export function isBundleFile(v: unknown): v is BundleFile {
  const b = v as BundleFile;
  return !!b && b.version === 1 && !!b.off?.summary && !!b.on?.summary && Array.isArray(b.off.series) && Array.isArray(b.on.series);
}
