import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Paper-2 block with a warm shimmer sweep (`.skeleton` in globals.css). Size it to match the final content. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton rounded-[var(--r-sm)]", className)} {...rest} />;
}
