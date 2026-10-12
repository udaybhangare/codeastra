"use client";
// §3 A fair queue (DRR). The hull shows the particle lanes + quantum ring; this is the copy.
import { Copy, Eyebrow, H2, Panel } from "./parts";

export function FairQueue() {
  return (
    <Panel id="queue" labelledBy="queue-title">
      <Copy>
        <Eyebrow n="02">A fair queue</Eyebrow>
        <H2 id="queue-title">Everyone gets a turn. Heavy jobs pay more.</H2>
        <p className="mt-4 text-[18px] leading-relaxed text-ink-2">
          Deficit Round Robin hands each tenant credit by weight, and a job spends credit by what it costs. Idle capacity is never
          wasted: a lone tenant gets everything.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2 text-[13px] font-semibold">
          {["Credit by weight", "Cost-aware", "Work-conserving"].map((t) => (
            <li key={t} className="rounded-full bg-ultra-100 px-3 py-1.5 text-ultra-600">
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] text-ink-2">Watch the ring on the hull hand out credit lane by lane.</p>
      </Copy>
    </Panel>
  );
}
