"use client";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useReducedMotionSafe } from "@/lib/motion";

const PIECES = 36;
const COLORS = ["var(--lime)", "var(--lime)", "var(--ultra)", "var(--tangerine)"];

// Deterministic spread (golden-ratio sequence) so render is pure; no Math.random.
const frac = (n: number) => n - Math.floor(n);

/** One-shot lime confetti burst from the top-centre; unmounts itself after ~2 s. Skipped for reduced motion. */
export function Confetti({ onDone }: { onDone?: () => void }) {
  const reduced = useReducedMotionSafe();
  const [alive, setAlive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setAlive(false);
      onDone?.();
    }, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  if (reduced || !alive) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-screen overflow-hidden">
      {Array.from({ length: PIECES }, (_, i) => {
        const dx = (frac(i * 0.618) - 0.5) * 900;
        const fall = 260 + frac(i * 0.381) * 420;
        const rot = (frac(i * 0.753) - 0.5) * 720;
        return (
          <motion.span
            key={i}
            className="absolute top-24 left-1/2 block h-3 w-2 rounded-[2px] border border-ink/70"
            style={{ background: COLORS[i % COLORS.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: dx, y: [0, -120 - frac(i * 0.29) * 100, fall], opacity: [1, 1, 0], rotate: rot }}
            transition={{ duration: 1.8, ease: "easeOut", times: [0, 0.35, 1] }}
          />
        );
      })}
    </div>
  );
}
