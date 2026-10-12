import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page wrapper: optional header row (subtitle + actions; the title itself lives in the top bar)
 * and a 12-column bento grid, 24 px gap. Children choose spans with `col-span-*`.
 */
export function PageFrame({
  subtitle,
  actions,
  children,
  className,
}: {
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 pb-12 min-[1440px]:px-12">
      {subtitle || actions ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[60ch] text-[15px] text-ink-2">{subtitle}</p>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      ) : null}
      <div className={cn("grid grid-cols-12 gap-6", className)}>{children}</div>
    </div>
  );
}
