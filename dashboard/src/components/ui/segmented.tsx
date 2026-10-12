"use client";
import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (v: T) => void;
  options: readonly SegmentedOption<T>[];
  "aria-label"?: string;
  className?: string;
}

/** Radio-group pill selector; the active pill slides between options via a shared layoutId. */
export function Segmented<T extends string>({ value, onValueChange, options, className, ...rest }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={rest["aria-label"]} className={cn("inline-flex rounded-full bg-paper-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "relative h-9 rounded-full px-4 text-[13px] font-semibold outline-none transition-colors focus-visible:shadow-[var(--ring)]",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {active ? (
              <motion.span layoutId={`seg-${id}`} transition={springSnappy} className="absolute inset-0 rounded-full bg-surface shadow-[var(--shadow-1)]" />
            ) : null}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
