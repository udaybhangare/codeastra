"use client";
import { Select as S } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  value: T;
  onValueChange: (v: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function Select<T extends string>({ value, onValueChange, options, placeholder, disabled, className, ...rest }: SelectProps<T>) {
  return (
    <S.Root value={value} onValueChange={(v) => v != null && onValueChange(v as T)} disabled={disabled}>
      <S.Trigger
        aria-label={rest["aria-label"]}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-[var(--r-md)] bg-paper-2 px-4 text-[15px] text-ink outline-none transition-shadow focus-visible:bg-surface focus-visible:shadow-[var(--ring)] disabled:opacity-50",
          className,
        )}
      >
        <S.Value placeholder={placeholder}>{(v: string | null) => options.find((o) => o.value === v)?.label ?? placeholder ?? ""}</S.Value>
        <S.Icon className="text-ink-2">
          <ChevronDown className="size-4" aria-hidden />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Positioner sideOffset={6} className="z-[70]">
          <S.Popup className="min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-[var(--r-md)] border border-line bg-surface p-1 shadow-[var(--shadow-2)] outline-none transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0">
            <S.List>
              {options.map((o) => (
                <S.Item
                  key={o.value}
                  value={o.value}
                  className="flex h-10 cursor-default items-center gap-2 rounded-[var(--r-sm)] px-3 text-[15px] outline-none select-none data-[highlighted]:bg-ultra-50 data-[selected]:font-semibold"
                >
                  <S.ItemIndicator className="text-ultra">
                    <Check className="size-4" aria-hidden />
                  </S.ItemIndicator>
                  <S.ItemText>{o.label}</S.ItemText>
                </S.Item>
              ))}
            </S.List>
          </S.Popup>
        </S.Positioner>
      </S.Portal>
    </S.Root>
  );
}
