"use client";
import { Tooltip as T } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/** Wrap the app (or a page) once so tooltips share open delay. */
export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner side={side} sideOffset={8} className="z-[70]">
          <T.Popup className="num origin-[var(--transform-origin)] rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-xs text-ink shadow-[var(--shadow-2)] transition-[opacity,transform] duration-150 data-[starting-style]:scale-90 data-[starting-style]:opacity-0 data-[ending-style]:scale-90 data-[ending-style]:opacity-0">
            {content}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  );
}
