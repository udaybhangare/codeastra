"use client";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { springSoft, useReducedMotionSafe } from "@/lib/motion";

/**
 * Route change: new content fades up 8 px with springSoft (docs/ui/02). The sidebar stays mounted.
 * Keyed by pathname; exit animation is omitted because App Router unmounts the old tree immediately.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      key={path}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.12 } : springSoft}
    >
      {children}
    </motion.div>
  );
}
