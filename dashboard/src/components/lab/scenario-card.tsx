"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check, Clock3, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { springSnappy, springSoft, useReducedMotionSafe } from "@/lib/motion";
import type { ScenarioInfo } from "@/lib/scenarios";
import { cn } from "@/lib/utils";
import { ScenarioIcon } from "./scenario-icons";

export interface ScenarioCardProps {
  scenario: ScenarioInfo;
  selected: boolean;
  seed: number;
  onSelect: () => void;
}

/** Pop card: icon tile, name, attack; the selected card expands to show expected outcome + pass criterion. */
export function ScenarioCard({ scenario: s, selected, seed, onSelect }: ScenarioCardProps) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.button
      type="button"
      layout={!reduced}
      transition={springSoft}
      onClick={onSelect}
      aria-pressed={selected}
      whileHover={reduced ? undefined : { y: -3 }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
      className={cn(
        "relative flex flex-col gap-3 rounded-[var(--r-lg)] border-2 border-ink p-4 text-left outline-none focus-visible:shadow-[var(--ring)]",
        selected ? "bg-ultra-50 shadow-[var(--shadow-pop)]" : "bg-surface shadow-[3px_3px_0_var(--ink)]",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex size-14 shrink-0 items-center justify-center rounded-[var(--r-md)] border-2 border-ink", selected ? "bg-surface" : "bg-paper-2")}>
          <ScenarioIcon id={s.id} className="size-10" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="num text-xs font-medium text-ink-2">{s.id}</div>
          <h3 className="text-[18px] leading-tight">{s.name}</h3>
        </div>
        {selected ? (
          <motion.span
            layoutId="scenario-selected"
            transition={springSnappy}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime text-lime-ink"
          >
            <Check className="size-4" aria-label="Selected" />
          </motion.span>
        ) : null}
      </div>
      <p className="text-[15px] text-ink-2">{s.attack}</p>
      <AnimatePresence initial={false}>
        {selected ? (
          <motion.div
            key="more"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={springSoft}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <p className="text-[15px]">
                <span className="font-semibold">Expected: </span>
                {s.expected}
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge tone="lime" icon={<Target aria-hidden />}>Pass: {s.assertion}</Badge>
                <Badge tone="neutral" icon={<Clock3 aria-hidden />}>seed {seed}</Badge>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.button>
  );
}
