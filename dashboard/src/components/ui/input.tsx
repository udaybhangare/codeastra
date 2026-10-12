"use client";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { NumberField as NF } from "@base-ui/react/number-field";
import { Minus, Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const FIELD =
  "h-11 w-full rounded-[var(--r-md)] border border-transparent bg-paper-2 px-4 text-[15px] text-ink outline-none transition-shadow placeholder:text-ink-3 focus-visible:border-ultra focus-visible:bg-surface focus-visible:shadow-[var(--ring)] disabled:opacity-50 aria-invalid:border-bad";

export function Input({ className, ...rest }: ComponentProps<typeof InputPrimitive>) {
  return <InputPrimitive className={cn(FIELD, className)} {...rest} />;
}

export interface NumberFieldProps {
  value: number | null;
  onValueChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function NumberField({ value, onValueChange, min, max, step = 1, unit, disabled, className, ...rest }: NumberFieldProps) {
  const stepBtn =
    "inline-flex size-9 items-center justify-center rounded-full text-ink-2 outline-none transition-colors hover:bg-ultra-100 hover:text-ultra-600 focus-visible:shadow-[var(--ring)] disabled:opacity-40";
  return (
    <NF.Root value={value} onValueChange={onValueChange} min={min} max={max} step={step} disabled={disabled} className={className}>
      <NF.Group className="flex h-11 items-center rounded-[var(--r-md)] bg-paper-2 px-1 focus-within:bg-surface focus-within:shadow-[var(--ring)]">
        <NF.Decrement className={stepBtn} aria-label="Decrease">
          <Minus aria-hidden />
        </NF.Decrement>
        <NF.Input aria-label={rest["aria-label"]} className="num h-full min-w-0 flex-1 bg-transparent text-center text-[15px] font-medium text-ink outline-none" />
        {unit ? <span className="num pr-1 text-xs text-ink-3">{unit}</span> : null}
        <NF.Increment className={stepBtn} aria-label="Increase">
          <Plus aria-hidden />
        </NF.Increment>
      </NF.Group>
    </NF.Root>
  );
}
