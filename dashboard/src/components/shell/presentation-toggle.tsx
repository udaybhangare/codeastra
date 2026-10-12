"use client";
import { Presentation } from "lucide-react";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";

/** Sidebar button for presentation mode (key `P`). Larger type, quieter chrome. */
export function PresentationToggle({ rail = false }: { rail?: boolean }) {
  const on = useUi((s) => s.presentation);
  const toggle = useUi((s) => s.togglePresentation);
  const btn = (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={rail ? "Presentation mode" : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-full px-3.5 text-[15px] font-semibold outline-none transition-colors focus-visible:shadow-[var(--ring)]",
        rail && "justify-center px-0",
        on ? "bg-lime text-lime-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
      )}
    >
      <Presentation className="size-5 shrink-0" aria-hidden />
      {!rail && (
        <>
          <span className="flex-1 text-left">{on ? "Presenting" : "Presentation"}</span>
          <Kbd>P</Kbd>
        </>
      )}
    </button>
  );
  return rail ? <Tooltip content={`Presentation mode (P)${on ? " — on" : ""}`} side="right">{btn}</Tooltip> : btn;
}
