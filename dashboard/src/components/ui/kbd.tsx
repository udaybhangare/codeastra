import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn("num inline-flex h-6 min-w-6 items-center justify-center rounded-[8px] border border-line border-b-2 bg-surface px-1.5 text-xs font-medium text-ink-2", className)}
      {...rest}
    />
  );
}
