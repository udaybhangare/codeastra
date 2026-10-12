import type { Level } from "./ws-types";

// Throttle ladder labels (docs/05). Tone drives colour + icon.
export const LADDER: Record<Level, { name: string; tone: "ok" | "warn" | "bad" }> = {
  0: { name: "Normal", tone: "ok" },
  1: { name: "Observe", tone: "warn" },
  2: { name: "Soft", tone: "warn" },
  3: { name: "Hard", tone: "bad" },
  4: { name: "Isolate", tone: "bad" },
  5: { name: "Quarantine", tone: "bad" },
};

// Placeholder entitlements per tier for heatmap normalisation; the stream does
// not carry quotas yet. Replace with policy API values (see docs/DEVIATIONS.md).
export const ENTITLEMENT = {
  free: { mem_mb: 256, db_conns: 5, queue: 50, bytes_s: 1_000_000, cpu: 0.15 },
  pro: { mem_mb: 512, db_conns: 10, queue: 100, bytes_s: 5_000_000, cpu: 0.3 },
  enterprise: { mem_mb: 1024, db_conns: 20, queue: 200, bytes_s: 20_000_000, cpu: 0.5 },
} as const;
