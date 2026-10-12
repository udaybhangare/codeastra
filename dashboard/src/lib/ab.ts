// Pure A/B comparison helpers for the Scenario Lab (no React, no clock, no randomness).
import { METRICS, type MetricDef, type RunBundle } from "./runs.ts";

export type Side = "on" | "off";

export interface DeltaRow {
  def: MetricDef;
  off?: number;
  on?: number;
  /** Which side is better for this metric ("same" when equal, "none" when not comparable). */
  better: Side | "same" | "none";
}

/** Metrics present in either run, in catalogue order, with which side wins. */
export function deltaRows(off: Record<string, number>, on: Record<string, number>): DeltaRow[] {
  return METRICS.filter((m) => m.key in off || m.key in on).map((def) => {
    const a = off[def.key];
    const b = on[def.key];
    let better: DeltaRow["better"] = "none";
    if (def.better !== "none" && a !== undefined && b !== undefined) {
      if (a === b) better = "same";
      else better = (def.better === "lower" ? b < a : b > a) ? "on" : "off";
    }
    return { def, off: a, on: b, better };
  });
}

export interface Verdict {
  winner: Side | "tie";
  onWins: number;
  offWins: number;
}

/** Headline = victim p99 inflation when both runs have it; otherwise majority of directional metrics. */
export function verdict(off: Record<string, number>, on: Record<string, number>): Verdict {
  const rows = deltaRows(off, on);
  const onWins = rows.filter((r) => r.better === "on").length;
  const offWins = rows.filter((r) => r.better === "off").length;
  const head = rows.find((r) => r.def.key === "victim_p99_inflation");
  if (head && (head.better === "on" || head.better === "off")) return { winner: head.better, onWins, offWins };
  return { winner: onWins === offWins ? "tie" : onWins > offWins ? "on" : "off", onWins, offWins };
}

/** Big hero number for p99 inflation: keeps 120 px type on screen even for runaway ratios. */
export function bigRatio(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M×`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k×`;
  return `${v.toFixed(2)}×`;
}

/** Plain-language change for the delta column, e.g. "−98%" / "+0.31". Null when there is nothing to say. */
export function changeLabel(def: MetricDef, off?: number, on?: number): string | null {
  if (off === undefined || on === undefined || off === on) return null;
  if (off >= 9999 || on >= 9999) return null;
  if (Math.abs(off) > 1e-9 && def.key !== "jain") {
    const p = Math.round(((on - off) / Math.abs(off)) * 100);
    if (p === 0) return null;
    return `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
  }
  const d = on - off;
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
}

/** Highest numeric sample across both bundles so both charts share one y-axis. */
export function sharedYMax(bundles: RunBundle[]): number {
  let max = 1;
  for (const b of bundles) {
    for (const p of b.series) {
      for (const [k, v] of Object.entries(p)) if (k !== "t" && typeof v === "number" && v > max) max = v;
    }
  }
  return max;
}

/** Phase boundaries (first point of each new phase) for chart reference lines. */
export function phaseMarks(series: RunBundle["series"]): { t: number; phase: string }[] {
  const marks: { t: number; phase: string }[] = [];
  let last = "";
  for (const p of series) {
    if (p.phase !== last) marks.push({ t: p.t, phase: p.phase });
    last = p.phase;
  }
  return marks;
}

export type DoorState = "pending" | "active" | "done";
export const PHASES = ["warmup", "attack", "cooldown"] as const;

/** State of each of the three phase doors given the current phase (null = run not started yet). */
export function doorStates(current: string | null, finished = false): DoorState[] {
  if (finished) return PHASES.map(() => "done");
  const idx = current === null ? -1 : PHASES.indexOf(current as (typeof PHASES)[number]);
  return PHASES.map((_, i) => (i < idx ? "done" : i === idx ? "active" : "pending"));
}
