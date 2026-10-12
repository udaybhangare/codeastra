"use client";
// Soft paper-toned blobs with cursor parallax (docs/ui/04). Decor only: aria-hidden.
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { useReducedMotionSafe } from "@/lib/motion";

const BLOBS = [
  { cls: "left-[-8%] top-[8%] size-[420px] bg-ultra-100", depth: 26 },
  { cls: "right-[-6%] top-[40%] size-[360px] bg-tangerine-100", depth: -34 },
  { cls: "left-[30%] bottom-[-14%] size-[320px] bg-lime/40", depth: 18 },
];

type Spring = ReturnType<typeof useSpring>;

function Blob({ cls, depth, x, y }: { cls: string; depth: number; x: Spring; y: Spring }) {
  const bx = useTransform(x, (n) => n * depth);
  const by = useTransform(y, (n) => n * depth);
  return <motion.div className={`absolute rounded-full blur-3xl ${cls}`} style={{ x: bx, y: by }} />;
}

export function DecorBlobs() {
  const reduced = useReducedMotionSafe();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 60, damping: 20 });
  const y = useSpring(my, { stiffness: 60, damping: 20 });

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5);
      my.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced, mx, my]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {BLOBS.map((b) => (
        <Blob key={b.cls} {...b} x={x} y={y} />
      ))}
    </div>
  );
}
