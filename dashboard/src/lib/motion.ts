"use client";
// Spring presets + shared variants (docs/ui/02-motion-system.md).
// Springs accept only 2 keyframes: for array values like [0, -5, 0] use a tween transition.
import { useMotionValue, useReducedMotion, useSpring, type Transition, type Variants } from "motion/react";
import { useEffect, useState } from "react";

export const springSoft: Transition = { type: "spring", stiffness: 120, damping: 18, mass: 1 };
export const springSnappy: Transition = { type: "spring", stiffness: 400, damping: 28 };
export const springBouncy: Transition = { type: "spring", stiffness: 260, damping: 12 };
export const springSlow: Transition = { type: "spring", stiffness: 60, damping: 16 };
export const easeOut: Transition = { type: "tween", duration: 0.24, ease: [0.22, 1, 0.36, 1] };

/** Stagger is 40 ms per item, capped at 12 items then batched (docs/ui/02). */
export const STAGGER_S = 0.04;
export const STAGGER_MAX = 12;
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX) * STAGGER_S;
}

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -8, transition: { duration: 0.12 } },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: springBouncy },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.12 } },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER_S, delayChildren: 0.02 } },
};

/** True when the user asked for reduced motion; callers drop parallax/magnetic/stagger. */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}

/** Spring that is instant under reduced motion; use for transitions on layout/transform. */
export function useSafeTransition(t: Transition): Transition {
  return useReducedMotionSafe() ? { duration: 0 } : t;
}

/**
 * Magnetic hook: pulls an element toward the cursor when the pointer is within `radius` px of it,
 * capped at `max` px of offset. Attach `setRef` as the element's ref and spread `style` on a motion element.
 */
export function useMagnetic<T extends HTMLElement = HTMLElement>(opts: { radius?: number; max?: number; disabled?: boolean } = {}) {
  const { radius = 80, max = 10, disabled = false } = opts;
  const reduced = useReducedMotionSafe();
  const off = disabled || reduced;
  const [el, setEl] = useState<T | null>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 400, damping: 28 });
  const y = useSpring(my, { stiffness: 400, damping: 28 });

  useEffect(() => {
    if (off || !el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      // Distance from the element edge, so `radius` is measured outside the button.
      const edgeX = Math.max(Math.abs(dx) - r.width / 2, 0);
      const edgeY = Math.max(Math.abs(dy) - r.height / 2, 0);
      if (Math.hypot(edgeX, edgeY) > radius) {
        mx.set(0);
        my.set(0);
        return;
      }
      const k = max / Math.max(r.width / 2 + radius, 1);
      mx.set(Math.max(-max, Math.min(max, dx * k * 2)));
      my.set(Math.max(-max, Math.min(max, dy * k * 2)));
    };
    const reset = () => {
      mx.set(0);
      my.set(0);
    };
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", reset);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", reset);
      reset();
    };
  }, [el, off, radius, max, mx, my]);

  return { setRef: setEl, style: { x, y } };
}
