"use client";
// Landing-only state: scroll progress (0..1), the isolation demo switch and the hint chip.
import { create } from "zustand";
import type { Isolation } from "@/lib/ws-types";

/** Story sections with the scroll progress at which each starts (docs/ui/04). */
export const SECTIONS = [
  { id: "hero", label: "Hero", at: 0 },
  { id: "problem", label: "The problem", at: 0.12 },
  { id: "queue", label: "A fair queue", at: 0.3 },
  { id: "walls", label: "Hard walls", at: 0.5 },
  { id: "ladder", label: "Catch it, explain it", at: 0.65 },
  { id: "predictor", label: "See it coming", at: 0.8 },
  { id: "proof", label: "Proof", at: 0.92 },
] as const;

export function sectionAt(progress: number): number {
  let idx = 0;
  SECTIONS.forEach((s, i) => {
    if (progress >= s.at) idx = i;
  });
  return idx;
}

/** After flipping protection back ON the sealed flood lingers this long, then the hull calms. */
const SURGE_MS = 6000;
let surgeTimer: number | undefined;

interface LandingState {
  progress: number;
  isolation: Isolation;
  /** A scripted noisy neighbour is active (isolation OFF: until switched back; ON: 6 s). */
  surge: boolean;
  hinted: boolean;
  setProgress(p: number): void;
  setIsolation(v: Isolation): void;
  markHinted(): void;
}

export const useLanding = create<LandingState>((set) => ({
  progress: 0,
  isolation: "on",
  surge: false,
  hinted: false,
  // Quantised so a 60 Hz scroll does not re-render the 3D scene needlessly.
  setProgress: (p) => set((s) => (Math.abs(s.progress - p) < 0.002 ? s : { progress: p })),
  setIsolation: (v) => {
    window.clearTimeout(surgeTimer);
    if (v === "on") surgeTimer = window.setTimeout(() => set({ surge: false }), SURGE_MS);
    set({ isolation: v, surge: true, hinted: true });
  },
  markHinted: () => set({ hinted: true }),
}));

/** Lenis instance registered by LandingRoot so nav/rail can smooth-scroll. */
export const scroller: { scrollTo: (target: number | string) => void } = {
  scrollTo: (t) => {
    if (typeof t === "string") document.querySelector(t)?.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo({ top: t, behavior: "smooth" });
  },
};

/**
 * Maps landing progress (0..1) to a scrollY. StoryTimeline replaces `toY` once its triggers exist
 * (the hero and the pinned story each own a slice of the page); the default is a linear page fraction.
 */
export const scrollMap: { toY: (progress: number) => number } = {
  toY: (p) => p * (document.documentElement.scrollHeight - window.innerHeight),
};

export function goToProgress(p: number) {
  scroller.scrollTo(scrollMap.toY(p));
}

/** Progress at which the story hands over from the hero to the pinned sections. */
export const STORY_START = SECTIONS[1].at;
