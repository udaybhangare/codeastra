"use client";
// §4 Hard walls (cgroups). Kernel labels also pop on the hull wall (Scene `showWallLabels`).
import { motion } from "motion/react";
import { staggerDelay, useReducedMotionSafe } from "@/lib/motion";
import { Copy, Eyebrow, H2, Panel } from "./parts";

const CHIPS = ["cpu.max", "memory.max", "pids.max", "DB conn cap"];

export function HardWalls({ active }: { active: boolean }) {
  const reduced = useReducedMotionSafe();
  return (
    <Panel id="walls" labelledBy="walls-title">
      <Copy>
        <Eyebrow n="03">Hard walls</Eyebrow>
        <H2 id="walls-title">Real walls in the kernel.</H2>
        <p className="mt-4 text-[18px] leading-relaxed text-ink-2">
          Every tenant runs in its own container with kernel limits. A runaway job hits the wall, not its neighbours.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {CHIPS.map((c, i) => (
            <motion.li
              key={c}
              animate={reduced || !active ? { y: 0 } : { y: [0, -5, 0] }}
              transition={reduced ? { duration: 0 } : { duration: 0.5, ease: "easeOut", delay: staggerDelay(i) }}
              className="num rounded-xl border-2 border-ink bg-surface px-3 py-1.5 text-[13px] font-medium shadow-[3px_3px_0_var(--ink)]"
            >
              {c}
            </motion.li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] text-ink-2">Network is app-layer only — we say so.</p>
      </Copy>
    </Panel>
  );
}
