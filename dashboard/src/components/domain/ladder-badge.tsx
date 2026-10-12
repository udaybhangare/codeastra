"use client";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { levelTone } from "@/lib/colors";
import { LADDER } from "@/lib/ladder";
import { springBouncy, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Level } from "@/lib/ws-types";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, { box: string; glyph: number; text: string }> = {
  sm: { box: "h-6 gap-1 pl-1.5 pr-2.5", glyph: 14, text: "text-xs" },
  md: { box: "h-7 gap-1.5 pl-2 pr-3", glyph: 16, text: "text-[13px]" },
  lg: { box: "h-9 gap-2 pl-2.5 pr-4", glyph: 20, text: "text-[15px]" },
};

/** Door drawing in a 16×16 box (no wrapper), reusable inside other SVGs. */
export function DoorShape({ level }: { level: Level }) {
  const openness = 1 - level / 5; // 1 open, 0 shut
  const sx = 0.18 + openness * 0.82; // foreshortened leaf width
  return (
    <>
      <rect x="2" y="1.5" width="12" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <g transform={`translate(2.75 0) scale(${sx.toFixed(2)} 1)`}>
        <rect x="0" y="2.5" width="10.5" height="11" rx="1.5" fill="currentColor" opacity={level === 0 ? 0.28 : 0.85} />
      </g>
      {level === 5 ? <path d="M3 8h10" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" /> : null}
    </>
  );
}

/** Door glyph: the leaf swings shut as the level rises (0 wide open → 5 sealed + lock bar). */
export function DoorGlyph({ level, size = 16 }: { level: Level; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <DoorShape level={level} />
    </svg>
  );
}

const HATCH = "repeating-linear-gradient(135deg, rgba(143,15,46,.22) 0 4px, transparent 4px 8px)";

export function LadderBadge({ level, size = "md", className }: { level: Level; size?: Size; className?: string }) {
  const reduced = useReducedMotionSafe();
  const tone = levelTone(level);
  const s = SIZE[size];
  const prev = useRef(level);
  const [bumps, setBumps] = useState(0);

  // Escalation bounce: only when the level went up, never on first paint.
  useEffect(() => {
    if (level > prev.current) setBumps((n) => n + 1);
    prev.current = level;
  }, [level]);

  return (
    <motion.span
      key={bumps}
      initial={bumps > 0 && !reduced ? { scale: 0.7 } : false}
      animate={{ scale: 1 }}
      transition={springBouncy}
      className={cn("inline-flex items-center rounded-full font-semibold whitespace-nowrap", s.box, s.text, className)}
      style={{
        background: level === 5 ? `${HATCH}, ${tone.tint}` : tone.tint,
        color: tone.ink,
        boxShadow: level >= 3 ? `inset 0 0 0 1.5px ${tone.fill}` : undefined,
      }}
      aria-label={`Level ${level}, ${LADDER[level].name}`}
    >
      <DoorGlyph level={level} size={s.glyph} />
      <span className="num">L{level}</span>
      <span>{LADDER[level].name}</span>
    </motion.span>
  );
}
