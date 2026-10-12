"use client";
import { Dices, FolderOpen, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { LabMode, LabStatus } from "@/lib/lab";
import type { ScenarioInfo } from "@/lib/scenarios";
import { RunProgress } from "./run-progress";

const MODES = [
  { value: "off", label: "OFF" },
  { value: "on", label: "ON" },
  { value: "ab", label: "A/B" },
] as const;

export interface RunPanelProps {
  scenario: ScenarioInfo;
  seed: number;
  onSeed: (n: number) => void;
  durationS: number;
  onDuration: (n: number) => void;
  mode: LabMode;
  onMode: (m: LabMode) => void;
  status: LabStatus;
  live: boolean;
  onRun: () => void;
  onLoadRecorded: () => void;
  onOpenFile: () => void;
}

/** Sticky right-hand panel: seed + dice, duration, OFF/ON/A-B, magnetic Run, progress. */
export function RunPanel(p: RunPanelProps) {
  const running = p.status === "running-off" || p.status === "running-on";
  return (
    <div className="flex flex-col gap-5 rounded-[var(--r-lg)] border-2 border-ink bg-surface p-5 shadow-[var(--shadow-pop)]">
      <div>
        <div className="num text-xs font-medium text-ink-2">{p.scenario.id}</div>
        <h2 className="text-[22px]">{p.scenario.name}</h2>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">Seed</span>
        <div className="flex items-center gap-2">
          <NumberField className="flex-1" value={p.seed} onValueChange={(v) => p.onSeed(v ?? 0)} min={0} step={1} aria-label="Seed" disabled={running} />
          <Button variant="soft" size="md" aria-label="Randomise seed" disabled={running} onClick={() => p.onSeed(Math.floor(Math.random() * 100000))} icon={<Dices aria-hidden />} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">Duration</span>
        <NumberField value={p.durationS} onValueChange={(v) => p.onDuration(Math.max(0, v ?? 0))} min={0} step={10} unit="s" aria-label="Duration in seconds" disabled={running} />
        <span className="text-xs text-ink-2">0 = the scenario&apos;s default length.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">Isolation</span>
        <Segmented<LabMode> aria-label="Isolation mode" value={p.mode} onValueChange={p.onMode} options={MODES} className="self-start" />
        <span className="text-xs text-ink-2">
          {p.mode === "ab" ? "Same seed twice: OFF, then ON, then compared." : `One run with isolation ${p.mode.toUpperCase()}.`}
        </span>
      </div>

      <Button size="lg" magnetic loading={running} disabled={!p.live} onClick={p.onRun} icon={<Play aria-hidden />} className="w-full">
        {p.mode === "ab" ? "Run A/B" : `Run ${p.mode.toUpperCase()}`}
      </Button>
      {!p.live ? <p className="-mt-3 text-xs text-ink-2">Mock mode has no backend to run on: load a recorded result instead.</p> : null}

      <RunProgress status={p.status} mode={p.mode} />

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden />} onClick={p.onLoadRecorded} disabled={running}>
          Load recorded results
        </Button>
        <Button variant="ghost" size="sm" icon={<FolderOpen aria-hidden />} onClick={p.onOpenFile} disabled={running}>
          Open file…
        </Button>
      </div>
    </div>
  );
}
