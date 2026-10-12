"use client";
// Six pills Normal -> Quarantine, synced to the hull door level (docs/ui/04 §5). Colour + number + label.
import { motion } from "motion/react";
import { Check, ChevronsRight, Lock, ShieldAlert } from "lucide-react";
import { LADDER } from "@/lib/ladder";
import { springBouncy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Level } from "@/lib/ws-types";

const TONE = {
  ok: "bg-ok-100 text-ok-ink border-ok",
  warn: "bg-warn-100 text-warn-ink border-warn",
  bad: "bg-bad-100 text-bad-ink border-bad",
} as const;

function Icon({ level }: { level: Level }) {
  if (level === 0) return <Check className="size-3.5" aria-hidden />;
  if (level <= 2) return <ChevronsRight className="size-3.5" aria-hidden />;
  if (level < 5) return <ShieldAlert className="size-3.5" aria-hidden />;
  return <Lock className="size-3.5" aria-hidden />;
}

export function LadderStepper({ level }: { level: Level }) {
  const levels = [0, 1, 2, 3, 4, 5] as Level[];
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Throttle ladder">
      {levels.map((l) => {
        const reached = l <= level;
        const current = l === level;
        const tone = LADDER[l].tone;
        return (
          <motion.li
            key={l}
            aria-current={current ? "step" : undefined}
            animate={{ scale: current ? 1.12 : 1 }}
            transition={springBouncy}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border-2 px-3 text-[13px] font-semibold",
              reached ? TONE[tone] : "border-line bg-paper-2 text-ink-2",
              l === 5 && reached && "bg-[repeating-linear-gradient(135deg,var(--bad-100)_0_6px,#fff_6px_9px)]",
            )}
          >
            <Icon level={l} />
            <span className="num">{l}</span>
            <span>{LADDER[l].name}</span>
          </motion.li>
        );
      })}
    </ol>
  );
}
