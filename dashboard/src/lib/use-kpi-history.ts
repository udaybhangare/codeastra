"use client";
// Module-level 60 s KPI buffer + per-tenant level-since map, fed from the store (no REST polling).
// Lives outside React so navigating between admin pages does not reset the sparklines.
import { useMemo } from "react";
import { useStream } from "./store";
import { kpiPoint, pushCapped, trackLevels, type KpiPoint, type LevelSince } from "./overview";

let buffer: KpiPoint[] = [];
let since: LevelSince = {};
let wired = false;

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const feed = (s: ReturnType<typeof useStream.getState>) => {
    const snap = s.latest;
    if (!snap) return;
    const ts = Date.parse(snap.ts) || 0;
    buffer = pushCapped(buffer, kpiPoint(snap, ts));
    since = trackLevels(since, snap, ts);
  };
  useStream.subscribe((s, prev) => {
    if (s.latest !== prev.latest) feed(s);
  });
  feed(useStream.getState());
}
wire();

export function useKpiHistory(): { points: KpiPoint[]; since: LevelSince } {
  const latest = useStream((s) => s.latest);
  // Re-read the module buffers whenever a new snapshot lands (the subscriber above ran first).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ points: buffer, since }), [latest]);
}
