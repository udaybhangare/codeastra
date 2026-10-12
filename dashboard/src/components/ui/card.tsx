"use client";
import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { springSnappy, useReducedMotionSafe } from "@/lib/motion";

type Variant = "flat" | "pop" | "tinted" | "glass";
type Tint = "brand" | "ok" | "warn" | "bad" | "predict";

const VARIANT: Record<Variant, string> = {
  flat: "border border-line bg-surface shadow-[var(--shadow-1)]",
  pop: "border-2 border-ink bg-surface shadow-[var(--shadow-pop)]",
  tinted: "border border-line",
  glass: "border border-white/60 bg-white/55 shadow-[var(--shadow-2)] backdrop-blur-xl",
};
const TINT: Record<Tint, string> = {
  brand: "bg-ultra-50",
  predict: "bg-ultra-100",
  ok: "bg-ok-100",
  warn: "bg-warn-100",
  bad: "bg-bad-100",
};

export interface CardProps extends Omit<HTMLMotionProps<"div">, "title" | "children"> {
  variant?: Variant;
  tint?: Tint;
  eyebrow?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  /** Lift 4 px on hover (docs/ui/02). */
  interactive?: boolean;
  children?: ReactNode;
}

export function Card({ variant = "flat", tint = "brand", eyebrow, title, actions, interactive, className, children, ...rest }: CardProps) {
  const reduced = useReducedMotionSafe();
  const hasHeader = eyebrow || title || actions;
  return (
    <motion.div
      className={cn("rounded-[var(--r-lg)]", VARIANT[variant], variant === "tinted" && TINT[tint], className)}
      whileHover={interactive && !reduced ? { y: -4, boxShadow: "var(--shadow-2)" } : undefined}
      transition={springSnappy}
      {...rest}
    >
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {eyebrow ? <div className="text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">{eyebrow}</div> : null}
            {title ? <h3 className="truncate">{title}</h3> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </motion.div>
  );
}
