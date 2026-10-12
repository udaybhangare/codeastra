"use client";
// §5 Catch it, explain it: ladder stepper synced to the hull door + a sample "Why?" sentence.
import { LadderStepper } from "./LadderStepper";
import { LADDER } from "@/lib/ladder";
import type { Level } from "@/lib/ws-types";
import { Copy, Eyebrow, H2, Panel } from "./parts";

// Plain-language effect per level; 1–3 follow docs/06, 4–5 are the UI's isolate/quarantine split.
const EFFECT: Record<Level, string> = {
  0: "Inside its entitlement. Nothing happens.",
  1: "Flagged and logged. No action yet.",
  2: "Fair-queue weight halved, rate bucket trimmed, burst off.",
  3: "Container CPU quota cut and DB connections reduced.",
  4: "Tiny weight and concurrency capped.",
  5: "Moved to the quarantine lane. Sealed.",
};

export function Detector({ level }: { level: Level }) {
  return (
    <Panel id="ladder" labelledBy="ladder-title">
      <Copy>
        <Eyebrow n="04">Catch it, explain it</Eyebrow>
        <H2 id="ladder-title">We punish harm, not busyness.</H2>
        <p className="mt-4 text-[18px] leading-relaxed text-ink-2">
          A tenant is throttled only when it exceeds its entitlement <em>and</em> a neighbour suffers. Every step is logged and
          explained.
        </p>
        <div className="mt-5">
          <LadderStepper level={level} />
        </div>
        <p aria-live="polite" className="mt-3 text-[15px] font-semibold">
          <span className="num">L{level}</span> {LADDER[level].name} — <span className="font-normal text-ink-2">{EFFECT[level]}</span>
        </p>
        <figure className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-1)]">
          <figcaption className="text-[13px] font-semibold uppercase tracking-[0.02em] text-ink-2">Why? · example</figcaption>
          <p className="mt-1 text-[14px] leading-snug">
            <span className="num">rogue-ml</span> used <span className="num">71%</span> CPU vs <span className="num">20%</span>{" "}
            entitlement; <span className="num">acme-shop</span> p99 rose <span className="num">6.2×</span>.
          </p>
        </figure>
      </Copy>
    </Panel>
  );
}
