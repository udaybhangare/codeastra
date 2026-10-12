"use client";
import { Popover as P } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";

export function Popover({ trigger, children, side = "bottom" }: { trigger: ReactElement; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <P.Root>
      <P.Trigger render={trigger} />
      <P.Portal>
        <P.Positioner side={side} sideOffset={8} className="z-[70]">
          <P.Popup className="num origin-[var(--transform-origin)] rounded-[var(--r-md)] border border-line bg-surface p-4 text-[15px] text-ink shadow-[var(--shadow-2)] outline-none transition-[opacity,transform] duration-150 data-[starting-style]:scale-90 data-[starting-style]:opacity-0 data-[ending-style]:scale-90 data-[ending-style]:opacity-0">
            {children}
          </P.Popup>
        </P.Positioner>
      </P.Portal>
    </P.Root>
  );
}
