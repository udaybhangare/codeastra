"use client";
// Right-edge section rail: 7 dots, active dot springs (docs/ui/04).
import { motion } from "motion/react";
import { springBouncy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SECTIONS, goToProgress, sectionAt, useLanding } from "./scroll-store";

export function ProgressRail() {
  const progress = useLanding((s) => s.progress);
  const active = sectionAt(progress);
  return (
    <nav aria-label="Sections" className="fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-3 md:flex">
      {SECTIONS.map((s, i) => (
        <button
          key={s.id}
          aria-label={s.label}
          aria-current={i === active ? "step" : undefined}
          title={s.label}
          onClick={() => goToProgress(s.at)}
          className="group relative flex size-5 items-center justify-center rounded-full outline-none focus-visible:shadow-[var(--ring)]"
        >
          <motion.span
            animate={{ scale: i === active ? 1.6 : 1 }}
            transition={springBouncy}
            className={cn("size-2.5 rounded-full border-2 border-ultra", i === active ? "bg-ultra" : "bg-surface")}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute right-8 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {s.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
