"use client";
import { motion } from "motion/react";
import { springSnappy } from "@/lib/motion";
import { fmtPct } from "@/lib/format";

/** Ordered rounded bars, ink-3 labels, ultramarine fill. `bars` values are 0..1 (relative to the largest). */
export function FeatureBars({ bars }: { bars: { name: string; value: number }[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {bars.slice(0, 8).map((b) => (
        <li key={b.name} className="flex items-center gap-3">
          <span className="num w-36 shrink-0 truncate text-xs text-ink-3" title={b.name}>{b.name}</span>
          <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
            <motion.div className="h-full rounded-full bg-ultra" initial={false} animate={{ width: `${b.value * 100}%` }} transition={springSnappy} />
          </div>
          <span className="num w-12 shrink-0 text-right text-xs text-ink-2">{fmtPct(b.value)}</span>
        </li>
      ))}
    </ul>
  );
}
