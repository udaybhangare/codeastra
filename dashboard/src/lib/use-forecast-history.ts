"use client";
// Module-level 10 min forecast buffer fed from the store, so it survives navigation between admin pages.
import { useMemo } from "react";
import { useStream } from "./store";
import { forecastPoint, pushForecast, type ForecastPoint } from "./predictor";

let buffer: ForecastPoint[] = [];
let wired = false;

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const feed = (s: ReturnType<typeof useStream.getState>) => {
    const snap = s.latest;
    if (snap) buffer = pushForecast(buffer, forecastPoint(snap, Date.parse(snap.ts) || 0));
  };
  useStream.subscribe((s, prev) => {
    if (s.latest !== prev.latest) feed(s);
  });
  feed(useStream.getState());
}
wire();

export function useForecastHistory(): ForecastPoint[] {
  const latest = useStream((s) => s.latest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buffer, [latest]);
}
