"use client";
// §7 Proof + CTA.
import { FinalCta } from "./FinalCta";
import { Eyebrow, H2, Panel } from "./parts";
import { ResultsBento } from "./ResultsBento";

export function Proof({ active }: { active: boolean }) {
  return (
    <Panel id="proof" labelledBy="proof-title" className="max-md:flex-col max-md:items-stretch md:items-center">
      <div className="relative w-full max-w-[700px] [.story-stacked_&]:rounded-3xl [.story-stacked_&]:border [.story-stacked_&]:border-line [.story-stacked_&]:bg-surface/90 [.story-stacked_&]:p-6 [.story-stacked_&]:backdrop-blur-sm">
        <Eyebrow n="06">Proof</Eyebrow>
        <H2 id="proof-title">One bad actor. Everyone else fine.</H2>
        <div className="mt-6">
          <ResultsBento active={active} />
        </div>
      </div>
      <div className="max-md:mt-6 md:ml-8 [.story-pinned_&]:absolute [.story-pinned_&]:bottom-[9vh] [.story-pinned_&]:right-[6vw] [.story-pinned_&]:ml-0">
        <FinalCta active={active} />
      </div>
    </Panel>
  );
}
