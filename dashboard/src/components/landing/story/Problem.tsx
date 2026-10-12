"use client";
// §2 The problem: a rate limit counts requests, not damage.
import { Copy, Eyebrow, H2, Panel } from "./parts";

export function Problem() {
  return (
    <Panel id="problem" labelledBy="problem-title">
      <Copy>
        <Eyebrow n="01">The problem</Eyebrow>
        <H2 id="problem-title">A rate limit counts requests. Not damage.</H2>
        <p className="mt-4 text-[18px] leading-relaxed text-ink-2">
          One tenant&apos;s heavy job looks like any other request, so it sails through and floods the compartments next to it.
        </p>
        <div className="pointer-events-auto mt-6 grid grid-cols-2 gap-3" role="group" aria-label="Same request count, very different cost">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-1)]">
            <p className="text-[13px] font-semibold text-ink-2">
              <code className="num">echo</code> · 1 request
            </p>
            <p className="num mt-2 text-[28px] font-semibold leading-none">1</p>
            <p className="mt-1 text-[13px] text-ink-2">cost unit</p>
          </div>
          <div className="rounded-2xl border-2 border-ink bg-tangerine-100 p-4 shadow-[4px_4px_0_var(--ink)]">
            <p className="text-[13px] font-semibold">
              <code className="num">cpu-burn</code> · 1 request
            </p>
            <p className="num mt-2 text-[28px] font-semibold leading-none">≈500</p>
            <p className="mt-1 text-[13px] text-ink-2">cost units (docs/03)</p>
          </div>
        </div>
      </Copy>
    </Panel>
  );
}
