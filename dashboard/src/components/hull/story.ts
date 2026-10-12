// Landing scroll script (docs/ui/03 "Landing camera path"). Stubbed keyframes; final tuning in U05.
import type { Level } from "@/lib/ws-types";
import type { HullTenant } from "@/lib/hull";

export interface StoryState {
  /** Camera zoom multiplier (1 = fit whole hull). */
  zoom: number;
  /** 0..1 weight of focusing the story compartment. */
  focus: number;
  /** 0..1 flood of the story compartment. */
  flood: number;
  /** 0..5 door level for the story compartment. */
  door: number;
  /** >0.5 forces isolation OFF (the problem section). */
  isolationOff: number;
  /** Quantum ring + highlighted lanes (DRR section). */
  ring: number;
  /** Kernel wall labels (cgroups section). */
  labels: number;
  /** Predictor ghost water. */
  ghost: number;
}

export const STORY_INDEX = 2;

const calm: StoryState = { zoom: 1, focus: 0, flood: 0, door: 0, isolationOff: 0, ring: 0, labels: 0, ghost: 0 };
const k = (at: number, s: Partial<StoryState>): { at: number; s: StoryState } => ({ at, s: { ...calm, ...s } });

export const storyKeyframes = [
  k(0, {}),
  k(0.12, {}),
  k(0.2, { zoom: 1.7, focus: 1, flood: 1, isolationOff: 1 }),
  k(0.3, { zoom: 1.7, focus: 1, flood: 1, isolationOff: 1 }),
  k(0.38, { zoom: 1.1, ring: 1 }),
  k(0.5, { zoom: 1.1, ring: 1 }),
  k(0.56, { zoom: 1.7, focus: 1, labels: 1, flood: 0.5 }),
  k(0.65, { zoom: 1.7, focus: 1, labels: 1, flood: 0.5 }),
  k(0.7, { zoom: 1.6, focus: 1, flood: 1, door: 1 }),
  k(0.8, { zoom: 1.6, focus: 1, flood: 1, door: 5 }),
  k(0.86, { zoom: 1.2, focus: 0.6, ghost: 1 }),
  k(0.92, { zoom: 1.2, focus: 0.6, ghost: 1 }),
  k(1, {}),
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Linear interpolation between neighbouring keyframes. Pure. */
export function sampleStory(progress: number): StoryState {
  const p = Math.min(1, Math.max(0, progress));
  let hi = storyKeyframes.findIndex((f) => f.at >= p);
  if (hi <= 0) return { ...storyKeyframes[0].s };
  if (hi < 0) hi = storyKeyframes.length - 1;
  const a = storyKeyframes[hi - 1];
  const b = storyKeyframes[hi];
  const t = b.at === a.at ? 1 : (p - a.at) / (b.at - a.at);
  const out = { ...calm };
  for (const key of Object.keys(calm) as (keyof StoryState)[]) out[key] = lerp(a.s[key], b.s[key], t);
  return out;
}

/** Apply the scripted state onto a (fake) tenant array. Pure. */
export function applyStory(tenants: HullTenant[], s: StoryState): HullTenant[] {
  if (tenants.length === 0) return tenants;
  const idx = Math.min(STORY_INDEX, tenants.length - 1);
  return tenants.map((t, i) => {
    if (i !== idx) return t;
    let usage = lerp(t.usage, 1.15, s.flood);
    if (s.ghost > 0) usage = Math.max(usage, 0.5);
    return {
      ...t,
      usage,
      level: Math.max(t.level, Math.round(s.door)) as Level,
      pOverload: s.ghost > 0 ? 0.88 * s.ghost : t.pOverload,
    };
  });
}
