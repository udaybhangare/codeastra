"use client";
import { create } from "zustand";
import { api } from "./api";
import { useStream } from "./store";
import type { BundleFile, RunBundle } from "./runs";

export type LabStatus = "idle" | "running-off" | "running-on" | "done" | "error";

interface LabState {
  status: LabStatus;
  error?: string;
  scenario?: string;
  seed: number;
  off?: RunBundle;
  on?: RunBundle;
  source?: "live" | "recorded";
  start: (scenario: string, seed: number, durationS: number) => Promise<void>;
  load: (f: BundleFile) => void;
}

const RESULT_TIMEOUT_MS = 10 * 60_000;

function waitForResult(runId: string): Promise<RunBundle> {
  return new Promise((resolve, reject) => {
    const hit = useStream.getState().results[runId];
    if (hit) return resolve(hit);
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`run ${runId} did not report a result in time`));
    }, RESULT_TIMEOUT_MS);
    const unsub = useStream.subscribe((s) => {
      const r = s.results[runId];
      if (r) {
        clearTimeout(timer);
        unsub();
        resolve(r);
      }
    });
  });
}

// A/B protocol (docs/09): same seed, isolation OFF then ON; always leave isolation ON.
export const useLab = create<LabState>((set, get) => ({
  status: "idle",
  seed: 42,
  start: async (scenario, seed, durationS) => {
    const s = get().status;
    if (s === "running-off" || s === "running-on") return;
    set({ status: "running-off", scenario, seed, off: undefined, on: undefined, error: undefined, source: "live" });
    try {
      await api.setIsolation("off");
      const offRun = await api.runScenario(scenario, seed, durationS);
      const off = await waitForResult(offRun.id);
      set({ off: { ...off, seed }, status: "running-on" });
      await api.setIsolation("on");
      const onRun = await api.runScenario(scenario, seed, durationS);
      const on = await waitForResult(onRun.id);
      set({ on: { ...on, seed }, status: "done" });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      try {
        await api.setIsolation("on");
      } catch {
        /* leave the error already recorded */
      }
    }
  },
  load: (f) => set({ status: "done", error: undefined, scenario: f.scenario, seed: f.seed ?? get().seed, off: f.off, on: f.on, source: "recorded" }),
}));
