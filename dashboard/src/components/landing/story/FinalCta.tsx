"use client";
// Pop-style CTA card with a one-shot lime confetti burst on first arrival.
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { springSoft, useReducedMotionSafe } from "@/lib/motion";

const COLORS = ["var(--lime)", "var(--ultra)", "var(--tangerine)", "var(--lime)"];
const PIECES = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  const d = 110 + (i % 5) * 28;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7 - 40, r: (i * 47) % 360, c: COLORS[i % COLORS.length] };
});

export function FinalCta({ active }: { active: boolean }) {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const fired = useRef(false);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!active || fired.current || reduced) return;
    fired.current = true;
    const on = window.setTimeout(() => setBurst(true), 0);
    const off = window.setTimeout(() => setBurst(false), 1800);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, [active, reduced]);

  return (
    <motion.div
      animate={{ y: active && !reduced ? 0 : 12, opacity: 1 }}
      transition={springSoft}
      className="pointer-events-auto relative w-full max-w-[380px] rounded-3xl border-2 border-ink bg-surface p-6 shadow-[6px_6px_0_var(--ink)]"
    >
      <h3 className="font-display text-[26px] font-bold leading-tight">See it live.</h3>
      <p className="mt-2 text-[15px] text-ink-2">Run a noisy neighbor yourself and watch the compartment seal.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button size="lg" magnetic onClick={() => router.push("/overview")}>
          Launch Console
        </Button>
        <Button size="lg" variant="secondary" onClick={() => router.push("/portal")}>
          Open Tenant Portal
        </Button>
      </div>
      <AnimatePresence>
        {burst && (
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 size-0">
            {PIECES.map((p, i) => (
              <motion.span
                key={i}
                initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
                animate={{ x: p.x, y: p.y + 70, opacity: 0, rotate: p.r, scale: 0.8 }}
                transition={{ duration: 1.2 + (i % 4) * 0.12, ease: [0.22, 1, 0.36, 1] }}
                className="absolute block h-3 w-2 rounded-[2px]"
                style={{ background: p.c }}
              />
            ))}
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
