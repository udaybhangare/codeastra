"use client";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { doorStates, PHASES, type DoorState } from "@/lib/ab";
import { springSoft } from "@/lib/motion";
import type { LabMode, LabStatus } from "@/lib/lab";
import { useStream } from "@/lib/store";
import { cn } from "@/lib/utils";

/** A bulkhead door: the sliding panel is open (pending), ajar (active) or sealed (done). */
function Door({ state, label }: { state: DoorState; label: string }) {
  const panel = state === "done" ? 30 : state === "active" ? 16 : 4;
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <svg viewBox="0 0 48 44" className="h-11 w-12" aria-hidden>
        <rect x="3" y="3" width="42" height="38" rx="9" fill={state === "done" ? "var(--ok-100)" : "var(--paper-2)"} stroke="var(--ink)" strokeWidth="2.5" />
        <rect x="9" y="9" width="30" height="26" rx="5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
        <motion.rect
          x="9"
          y="9"
          height="26"
          rx="5"
          fill={state === "pending" ? "var(--line)" : state === "active" ? "var(--ultra)" : "var(--ok)"}
          stroke="var(--ink)"
          strokeWidth="2"
          initial={false}
          animate={{ width: panel }}
          transition={springSoft}
        />
        {state === "active" ? <circle cx="36" cy="22" r="2.5" fill="var(--tangerine)" /> : null}
      </svg>
      <span className={cn("flex items-center gap-1 text-[13px] font-semibold capitalize", state === "pending" ? "text-ink-3" : "text-ink")}>
        {state === "done" ? <Check className="size-3.5 text-ok-ink" aria-hidden /> : null}
        {label}
      </span>
    </div>
  );
}

/** Three-phase door stepper (warmup → attack → cooldown) with elapsed/total and an animated fill. */
export function RunProgress({ status, mode }: { status: LabStatus; mode: LabMode }) {
  const run = useStream((s) => s.run);
  const running = status === "running-off" || status === "running-on";
  if (!running) return null;
  const pass = mode === "ab" ? (status === "running-off" ? "Run 1 of 2 · isolation OFF" : "Run 2 of 2 · isolation ON") : `Single run · isolation ${mode.toUpperCase()}`;
  const pct = run && run.total_s > 0 ? Math.min(100, (run.elapsed_s / run.total_s) * 100) : 0;
  const doors = doorStates(run?.phase ?? null);
  return (
    <div role="status" aria-live="polite" className="rounded-[var(--r-md)] border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">{pass}</span>
        <span className="num text-xs font-medium text-ink-2">
          {run ? `${Math.round(run.elapsed_s)} / ${Math.round(run.total_s)} s` : "starting…"}
        </span>
      </div>
      <div className="flex gap-2">
        {PHASES.map((p, i) => (
          <Door key={p} state={doors[i]} label={p} />
        ))}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-2">
        <motion.div className="h-full rounded-full bg-ultra" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
      </div>
    </div>
  );
}
