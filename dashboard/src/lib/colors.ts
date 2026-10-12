// Tenant identity colour + ladder level → tone (docs/ui/01). No Date/random: pure functions.
import { LADDER } from "./ladder";
import type { Level } from "./ws-types";

export const TENANT_COLORS = ["#3B2EFF", "#FF6B35", "#17A98F", "#B04DFF", "#FF3D9A", "#2E9BFF"] as const;

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable colour for a tenant id (FNV-1a hash into the ordered list, cycling). */
export function tenantColor(tenantId: string): string {
  return TENANT_COLORS[hash(tenantId) % TENANT_COLORS.length];
}

export type Tone = "ok" | "warn" | "bad" | "predict" | "brand" | "neutral" | "lime";

export interface LevelTone {
  tone: "ok" | "warn" | "bad";
  /** Fill colour as a CSS value (deeper tones for levels 2 and 4). */
  fill: string;
  /** Tinted background + readable ink for chips. */
  tint: string;
  ink: string;
  hatched: boolean;
  name: string;
}

const FILL: Record<Level, string> = {
  0: "var(--ok)",
  1: "var(--warn)",
  2: "var(--ladder-soft)",
  3: "var(--bad)",
  4: "var(--ladder-isolate)",
  5: "var(--bad)",
};

export function levelTone(level: Level): LevelTone {
  const { tone, name } = LADDER[level];
  return {
    tone,
    fill: FILL[level],
    tint: `var(--${tone}-100)`,
    ink: `var(--${tone}-ink)`,
    hatched: level === 5,
    name,
  };
}

/** Utilisation ratio → status tone for heatmap tanks (<0.7 ok, 0.7–1 warn, >1 bad). */
export function ratioTone(ratio: number): "ok" | "warn" | "bad" {
  return ratio > 1 ? "bad" : ratio >= 0.7 ? "warn" : "ok";
}

/** Tailwind class bundles per tone (tint bg + ink text + solid dot). */
export const TONE_CLASS: Record<Tone, { chip: string; dot: string }> = {
  ok: { chip: "bg-ok-100 text-ok-ink", dot: "bg-ok" },
  warn: { chip: "bg-warn-100 text-warn-ink", dot: "bg-warn" },
  bad: { chip: "bg-bad-100 text-bad-ink", dot: "bg-bad" },
  predict: { chip: "bg-ultra-100 text-ultra-600", dot: "bg-ultra" },
  brand: { chip: "bg-ultra text-white", dot: "bg-white" },
  neutral: { chip: "bg-paper-2 text-ink-2", dot: "bg-ink-3" },
  lime: { chip: "bg-lime text-lime-ink", dot: "bg-lime-ink" },
};
