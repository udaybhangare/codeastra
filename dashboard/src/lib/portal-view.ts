// Pure view-model helpers for the tenant portal (docs/ui/06). No React, no Date/random: `now` is always injected.
import { describeAction } from "./evidence.ts";
import type { HullTenant } from "./hull.ts";
import type { Live, Showback, Throttle, UsageResp } from "./portal.ts";
import type { Level, Tier } from "./ws-types.ts";

export const RECOVERY_WINDOW_S = 20;

export type GaugeTone = "ok" | "warn" | "bad";

export interface GaugeSpec {
  id: "cost" | "rps" | "concurrency" | "rejected";
  label: string;
  /** Plain-English help shown in a tooltip (no admin jargon without an explanation). */
  help: string;
  /** Used share of the quota, 0..∞ (1 = at the limit). */
  ratio: number;
  value: string;
  of: string;
}

export const toLevel = (n: number | undefined): Level => (n !== undefined && Number.isInteger(n) && n >= 0 && n <= 5 ? (n as Level) : 0);

export function gaugeTone(ratio: number): GaugeTone {
  return ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "ok";
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");

/** Four gauges from what `/v1/me/usage` and `/v1/me/live` actually expose. */
export function buildGauges(usage: UsageResp | null, live: Live | undefined): GaugeSpec[] {
  const q = usage?.quota;
  if (!usage || !q) return [];
  const t = usage.usage.totals;
  const rps = live?.rps ?? 0;
  const inflight = live?.inflight ?? 0;
  const rejShare = t.requests > 0 ? t.rejected / t.requests : 0;
  return [
    {
      id: "cost",
      label: "Compute budget",
      help: "Cost units add up CPU time, database work and data moved. This is your plan's allowance for the window.",
      ratio: q.cost_used_pct !== undefined ? q.cost_used_pct / 100 : q.cost_allowance ? t.cost_units / q.cost_allowance : 0,
      value: int(t.cost_units),
      of: `of ${int(q.cost_allowance)} units`,
    },
    {
      id: "rps",
      label: "Request rate",
      help: "Requests per second you are sending right now compared with what your plan allows.",
      ratio: q.rps ? rps / q.rps : 0,
      value: String(Math.round(rps * 10) / 10),
      of: `of ${q.rps} req/s`,
    },
    {
      id: "concurrency",
      label: "Parallel jobs",
      help: "How many requests are being worked on at the same moment (concurrency).",
      ratio: q.concurrency ? inflight / q.concurrency : 0,
      value: String(inflight),
      of: `of ${q.concurrency} at once`,
    },
    {
      id: "rejected",
      label: "Turned away",
      help: "Share of your recent requests that were rejected because a limit was reached. Lower is better.",
      ratio: rejShare,
      value: `${Math.round(rejShare * 100)}%`,
      of: `${int(t.rejected)} of ${int(t.requests)}`,
    },
  ];
}

/** Headline "how full is my plan": the worst of cost, rate and concurrency. */
export function planUsedRatio(gauges: GaugeSpec[]): number {
  const g = gauges.filter((x) => x.id !== "rejected");
  return g.length ? Math.max(...g.map((x) => x.ratio)) : 0;
}

/** One compartment for the portal hull; usage is clamped by the hull itself (0..1.2). */
export function toPortalHull(tenant: string, tier: string, level: Level, ratio: number, live: Live | undefined): HullTenant {
  const t: Tier = tier === "pro" || tier === "enterprise" ? tier : "free";
  return { id: tenant, tier: t, level, usage: Math.min(1.2, Math.max(0, ratio)), rps: live?.rps, p99_ms: live?.p99_ms };
}

export interface StatusCopy {
  headline: string;
  sub: string;
  tone: GaugeTone;
}

/** Calm, non-punitive language (docs/ui/06 States). */
export function statusCopy(level: Level, planPct: number): StatusCopy {
  const pct = Math.round(planPct);
  if (level === 0) {
    return {
      headline: `All calm — you're using ${pct}% of your plan`,
      sub: "Everything is running at full speed inside your compartment.",
      tone: pct >= 100 ? "warn" : "ok",
    };
  }
  if (level <= 2) {
    return {
      headline: "You're slowed down a little",
      sub: "Your traffic grew past its fair share, so we are pacing it to keep your neighbours steady.",
      tone: "warn",
    };
  }
  if (level < 5) {
    return {
      headline: "Your compartment is on hold for now",
      sub: "We are holding most of your traffic back for a short while. Nothing is lost on your side; it eases off by itself.",
      tone: "bad",
    };
  }
  return {
    headline: "Your compartment is paused",
    sub: "It is in a protected lane while things settle. Reach out to your admin if this lasts more than a few minutes.",
    tone: "bad",
  };
}

export function whatYouCanDo(level: Level): string[] {
  if (level === 0) return [];
  const tips = ["Pause or space out heavy jobs (big batches, CPU-hungry tasks).", "Spread requests over time instead of sending them all at once."];
  if (level >= 3) tips.push("Retry later with a short back-off; limits relax by themselves.");
  tips.push("Need more room? Upgrading your plan raises every limit.");
  return tips;
}

/** Plain-English causes. Actions may arrive as strings or as {kind,value} objects (evidence.describeAction). */
export function explainCause(t: Throttle | null): { cause: string; actions: string[] } {
  if (!t) return { cause: "", actions: [] };
  const raw = (t.actions ?? []) as unknown[];
  const actions = raw
    .map((a) => (typeof a === "string" ? a : a && typeof a === "object" ? describeAction(a as Record<string, unknown>) : ""))
    .filter(Boolean);
  return { cause: t.explanation?.trim() || "Your usage went past your plan's fair share for a little while.", actions };
}

/**
 * Seconds of recovery left. The backend steps limits down ~20 s after usage is back within quota, so the
 * countdown only runs once `calmSince` (when we first saw usage within quota while throttled) is set.
 */
export function recoveryRemaining(calmSince: number | null, now: number, windowS = RECOVERY_WINDOW_S): number | null {
  if (calmSince === null) return null;
  return Math.max(0, Math.ceil(windowS - (now - calmSince) / 1000));
}

export function secondsSince(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}

export interface ShowRow {
  label: string;
  quantity?: number;
  unit?: string;
  amount: number;
  share: number;
}

export function showbackRows(sb: Showback): ShowRow[] {
  const amounts = sb.lines.map((l) => l.amount ?? l.cost ?? 0);
  const total = amounts.reduce((a, b) => a + b, 0);
  return sb.lines.map((l, i) => ({
    label: l.label ?? l.item ?? "Other",
    quantity: l.quantity,
    unit: l.unit,
    amount: amounts[i],
    share: total > 0 ? amounts[i] / total : 0,
  }));
}

/** Last 4 chars of a key, for the masked display. */
export function maskKey(hint: string | undefined): string {
  return `bk_••••••••${hint ?? "••••"}`;
}

export type RangeId = "5m" | "10m" | "15m";
export const RANGE_S: Record<RangeId, number> = { "5m": 300, "10m": 600, "15m": 900 };

/** Keep points whose timestamp is within `rangeS` of `now`. */
export function withinRange<T extends { t: number }>(rows: T[], now: number, rangeS: number): T[] {
  return rows.filter((r) => r.t >= now - rangeS * 1000);
}

export function sampleCurl(host: string): string {
  return `curl -H "X-API-Key: $BULKHEAD_KEY" ${host}/v1/echo`;
}
