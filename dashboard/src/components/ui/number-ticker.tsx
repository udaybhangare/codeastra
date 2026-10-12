"use client";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotionSafe } from "@/lib/motion";

export interface NumberTickerProps {
  value: number;
  /** Fraction digits (default 0). Ignored when `format` is given. */
  digits?: number;
  format?: (n: number) => string;
  className?: string;
}

/** Tweens between values (400 ms easeOut). Starts at `value`, never resets to 0 on update. */
export function NumberTicker({ value, digits = 0, format, className }: NumberTickerProps) {
  const reduced = useReducedMotionSafe();
  const mv = useMotionValue(value);
  const first = useRef(true);
  const text = useTransform(mv, (n) => (format ? format(n) : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })));

  useEffect(() => {
    if (first.current || reduced) {
      first.current = false;
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.4, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, reduced, mv]);

  return <motion.span className={cn("num inline-block tabular-nums", className)}>{text}</motion.span>;
}
