"use client";
import { Switch as S } from "@base-ui/react/switch";
import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { springBouncy } from "@/lib/motion";

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/** Pill switch with a bouncing knob and ON/OFF text (text + position, not colour alone). */
export function Switch({ checked, defaultChecked = false, onCheckedChange, disabled, className, ...rest }: SwitchProps) {
  const [inner, setInner] = useState(defaultChecked);
  const on = checked ?? inner;
  return (
    <S.Root
      checked={on}
      onCheckedChange={(v) => {
        setInner(v);
        onCheckedChange?.(v);
      }}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      className={cn(
        "relative inline-flex h-9 w-[76px] shrink-0 items-center rounded-full px-1 outline-none transition-colors focus-visible:shadow-[var(--ring)] disabled:opacity-50",
        on ? "bg-ultra" : "bg-paper-2 border border-line",
        className,
      )}
    >
      <span className={cn("num absolute text-[11px] font-semibold tracking-wide", on ? "left-3 text-white" : "right-3 text-ink-2")}>{on ? "ON" : "OFF"}</span>
      <S.Thumb render={<motion.span layout transition={springBouncy} />} className={cn("z-10 size-7 rounded-full bg-surface shadow-[var(--shadow-1)]", on ? "ml-auto" : "ml-0")} />
    </S.Root>
  );
}
