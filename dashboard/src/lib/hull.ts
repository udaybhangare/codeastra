// Pure helpers for the 3D hull (docs/ui/03). No React, no Date/random: unit-testable.
import { ENTITLEMENT } from "./ladder";
import type { Isolation, Level, Snapshot, Tier } from "./ws-types";

export type HullTenant = {
  id: string;
  tier: Tier;
  level: Level;
  /** 0..1.2 (above 1 = overflow). */
  usage: number;
  pOverload?: number;
  label?: string;
  /** Optional extras used for particle rate and the hover tooltip. */
  rps?: number;
  p99_ms?: number;
};

export type HullMode = "landing" | "mini" | "portal";

export type HullProps = {
  tenants: HullTenant[];
  isolation: Isolation;
  mode: HullMode;
  highlightId?: string;
  onHover?(id?: string): void;
  onSelect?(id: string): void;
  /** Landing only, 0..1 drives camera + scripted states. */
  scrollProgress?: number;
  /** Optional host gauge for the keel. */
  host?: { cpu_util: number; mem_util: number };
  className?: string;
};

export const USAGE_MAX = 1.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Usage = max over cpu/mem/db/queue/bytes relative to the tier entitlement. */
export function toHullTenants(snapshot: Snapshot): HullTenant[] {
  return snapshot.tenants.map((t) => {
    const e = ENTITLEMENT[t.tier] ?? ENTITLEMENT.free;
    const ratios = [
      t.cpu_share / e.cpu,
      t.mem_mb / e.mem_mb,
      (t.db_conns ?? 0) / e.db_conns,
      t.queue_depth / e.queue,
      (t.bytes_s ?? 0) / e.bytes_s,
    ];
    return {
      id: t.tenant_id,
      tier: t.tier,
      level: t.level,
      usage: clamp(Math.max(...ratios), 0, USAGE_MAX),
      pOverload: t.p_overload,
      rps: t.rps,
      p99_ms: t.p99_ms,
    };
  });
}

// ---- layout (scene units) ------------------------------------------------
export const CELL_W = 1.7;
export const CELL_H = 2.2;
export const CELL_D = 0.9;
export const GAP = 0.3;

export interface Slot {
  x: number;
  y: number;
  col: number;
  row: number;
}
export interface Layout {
  cols: number;
  rows: number;
  slots: Slot[];
  /** Overall extent of the compartments (without hull margins). */
  width: number;
  height: number;
}

/** Single row up to 6 compartments, 2-row grid above. Centred on the origin. */
export function layoutSlots(n: number): Layout {
  const count = Math.max(0, n);
  const rows = count > 6 ? 2 : 1;
  const cols = Math.max(1, Math.ceil(count / rows));
  const width = cols * CELL_W + (cols - 1) * GAP;
  const height = rows * CELL_H + (rows - 1) * GAP;
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    slots.push({
      col,
      row,
      x: -width / 2 + CELL_W / 2 + col * (CELL_W + GAP),
      y: height / 2 - CELL_H / 2 - row * (CELL_H + GAP),
    });
  }
  return { cols, rows, slots, width, height };
}

// ---- isolation behaviour -------------------------------------------------
/** Level used to close the doors: with isolation OFF doors never close. */
export function doorLevel(isolation: Isolation, level: Level): Level {
  return isolation === "off" ? 0 : level;
}

const LEAK_THRESHOLD = 0.8;
const LEAK_FACTOR = 0.75;

/**
 * Water level actually drawn per tenant. Isolation ON: own usage only.
 * OFF: a flooded neighbour (same row) leaks through the open door (visual only).
 */
export function displayUsage(tenants: HullTenant[], isolation: Isolation, cols: number): number[] {
  const base = tenants.map((t) => clamp(t.usage, 0, USAGE_MAX));
  if (isolation === "on") return base;
  return base.map((u, i) => {
    let inflow = 0;
    if (i % cols !== 0) inflow = Math.max(inflow, base[i - 1] - LEAK_THRESHOLD);
    if ((i + 1) % cols !== 0 && i + 1 < base.length) inflow = Math.max(inflow, base[i + 1] - LEAK_THRESHOLD);
    return clamp(u + Math.max(0, inflow) * LEAK_FACTOR, 0, USAGE_MAX);
  });
}

// ---- colours (WebGL cannot read CSS vars; mirrors docs/ui/01) -------------
export const WATER_OK = "#17C37B";
export const WATER_WARN = "#FFC233";
export const WATER_BAD = "#F2305C";
export const LEVEL_HEX: Record<Level, string> = {
  0: "#17C37B",
  1: "#FFC233",
  2: "#FFA500",
  3: "#F2305C",
  4: "#C9163F",
  5: "#F2305C",
};

/** Usage -> water tone: ok below .6, warn to .9, bad above. Returns blend weights. */
export function waterBlend(usage: number): { warn: number; bad: number } {
  return {
    warn: clamp((usage - 0.55) / 0.2, 0, 1),
    bad: clamp((usage - 0.85) / 0.2, 0, 1),
  };
}
