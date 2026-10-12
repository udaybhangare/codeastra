"use client";
// Shared story-panel shell. StoryTimeline finds panels by `data-panel` and animates them in/out.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  id,
  labelledBy,
  children,
  className,
}: {
  id: string;
  labelledBy: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-panel={id}
      aria-labelledby={labelledBy}
      className={cn(
        // Pinned desktop: stacked absolutely by StoryTimeline's stage; stacked mode: cards in flow.
        "pointer-events-none relative flex items-center px-4 md:px-[8vw]",
        "max-md:py-4 [.story-pinned_&]:absolute [.story-pinned_&]:inset-0",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Left-column text card; in stacked mode it gets a surface so text stays legible over the canvas. */
export function Copy({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative w-full max-w-[540px]",
        "[.story-stacked_&]:rounded-3xl [.story-stacked_&]:border [.story-stacked_&]:border-line [.story-stacked_&]:bg-surface/90 [.story-stacked_&]:p-6 [.story-stacked_&]:shadow-[var(--shadow-1)] [.story-stacked_&]:backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="mb-3 inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.02em] text-ultra">
      <span className="num rounded-full bg-ultra-100 px-2 py-0.5">{n}</span>
      {children}
    </p>
  );
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-display text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-[44px] lg:text-[52px]">
      {children}
    </h2>
  );
}
