"use client";
import { motion } from "motion/react";
import { levelTone } from "@/lib/colors";
import { LADDER } from "@/lib/ladder";
import { springSnappy, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Level } from "@/lib/ws-types";
import { DoorGlyph } from "./ladder-badge";

const LEVELS: Level[] = [0, 1, 2, 3, 4, 5];

/** Six connected nodes; the current one pulses. Pass `onSelect` to make it a pin-level control. */
export function LadderStepper({
  level,
  onSelect,
  maxSelectable = 5,
  className,
}: {
  level: Level;
  onSelect?: (l: Level) => void;
  /** Highest level the control may pick (the pin API accepts 0–4). Higher nodes render disabled. */
  maxSelectable?: Level;
  className?: string;
}) {
  const reduced = useReducedMotionSafe();
  return (
    <ol className={cn("flex items-center", className)} aria-label="Throttle ladder">
      {LEVELS.map((l, i) => {
        const tone = levelTone(l);
        const reached = l <= level;
        const current = l === level;
        const node = (
          <motion.span
            animate={current && !reduced ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={current ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : springSnappy}
            className="grid size-8 place-items-center rounded-full border-2"
            style={{
              borderColor: reached ? tone.fill : "var(--line)",
              background: reached ? tone.tint : "var(--surface)",
              color: reached ? tone.ink : "var(--ink-3)",
            }}
          >
            <DoorGlyph level={l} size={14} />
          </motion.span>
        );
        return (
          <li key={l} className="flex items-center" aria-current={current ? "step" : undefined}>
            {i > 0 ? <span className="h-0.5 w-4 rounded-full" style={{ background: reached ? tone.fill : "var(--line)" }} aria-hidden /> : null}
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(l)}
                disabled={l > maxSelectable}
                title={`L${l} ${LADDER[l].name}${l > maxSelectable ? " (not pinnable)" : ""}`}
                className="rounded-full outline-none focus-visible:shadow-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {node}
                <span className="sr-only">{`Level ${l} ${LADDER[l].name}`}</span>
              </button>
            ) : (
              <span title={`L${l} ${LADDER[l].name}`}>
                {node}
                <span className="sr-only">{`Level ${l} ${LADDER[l].name}`}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
