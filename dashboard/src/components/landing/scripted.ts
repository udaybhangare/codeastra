// Scripted tenants for the landing hero (docs/ui/04): fake, deterministic, no stream.
import type { HullTenant } from "@/lib/hull";
import type { Isolation, Level, Tier } from "@/lib/ws-types";

const BASE: { id: string; tier: Tier; usage: number }[] = [
  { id: "acme-shop", tier: "pro", usage: 0.38 },
  { id: "bolt-api", tier: "enterprise", usage: 0.5 },
  { id: "rogue-ml", tier: "free", usage: 0.3 },
  { id: "pixel-cdn", tier: "pro", usage: 0.42 },
  { id: "notes-app", tier: "free", usage: 0.26 },
];
export const NOISY_INDEX = 2;

/** `tick` is a 1 Hz counter: gentle deterministic breathing instead of random noise. */
export function scriptedTenants(tick: number, surge: boolean, isolation: Isolation): HullTenant[] {
  return BASE.map((b, i) => {
    const wobble = 0.05 * Math.sin(tick * 0.9 + i * 1.7);
    let usage = b.usage + wobble;
    let level: Level = 0;
    if (surge && i === NOISY_INDEX) {
      usage = 1.1;
      // Protection OFF: nothing ever closes the door. ON: the ladder seals it.
      level = isolation === "on" ? 3 : 0;
    }
    return { id: b.id, tier: b.tier, level, usage, rps: 10 + usage * 70, p99_ms: 40 + usage * 160 };
  });
}
