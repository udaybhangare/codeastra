import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type Tone } from "@/lib/colors";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Coloured dot before the label. */
  dot?: boolean;
  /** Icon (colour is never the only signal: pair status tones with an icon or label). */
  icon?: ReactNode;
}

/** Pill, 13 px label. `Chip` is the same component under its alternate catalog name. */
export function Badge({ tone = "neutral", dot, icon, className, children, ...rest }: BadgeProps) {
  const t = TONE_CLASS[tone];
  return (
    <span
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] leading-none font-semibold tracking-[0.02em] whitespace-nowrap", t.chip, className)}
      {...rest}
    >
      {dot ? <span className={cn("size-2 rounded-full", t.dot)} aria-hidden /> : null}
      {icon ? <span className="inline-flex [&_svg]:size-3.5">{icon}</span> : null}
      {children}
    </span>
  );
}
export const Chip = Badge;
