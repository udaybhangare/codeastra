"use client";
import { Slider as S } from "@base-ui/react/slider";
import { cn } from "@/lib/utils";

export interface SliderProps {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Text shown in the value bubble; defaults to the number. */
  format?: (v: number) => string;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function Slider({ value, onValueChange, min = 0, max = 100, step = 1, format, disabled, className, ...rest }: SliderProps) {
  return (
    <S.Root
      value={value}
      onValueChange={(v) => onValueChange(Array.isArray(v) ? v[0] : v)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn("w-full", className)}
    >
      <S.Control className="flex h-11 w-full touch-none items-center select-none">
        <S.Track className="relative h-3 w-full rounded-full bg-paper-2">
          <S.Indicator className="rounded-full bg-ultra" />
          <S.Thumb
            aria-label={rest["aria-label"]}
            className="group relative size-7 rounded-full border-[3px] border-ultra bg-surface shadow-[var(--shadow-1)] outline-none transition-transform focus-visible:shadow-[var(--ring)] data-[dragging]:scale-110"
          >
            <span className="num pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 rounded-[10px] bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 group-data-[dragging]:opacity-100">
              {format ? format(value) : value}
            </span>
          </S.Thumb>
        </S.Track>
      </S.Control>
    </S.Root>
  );
}
