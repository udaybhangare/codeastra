"use client";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Compartment-with-door motif, inline SVG. */
function DoorMotif() {
  return (
    <svg viewBox="0 0 96 72" className="h-[72px] w-24" aria-hidden>
      <rect x="4" y="4" width="88" height="64" rx="14" fill="var(--paper-2)" stroke="var(--line)" strokeWidth="2" />
      <rect x="30" y="16" width="36" height="52" rx="8" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5" />
      <path d="M30 16 L46 22 V62 L30 68 Z" fill="var(--ultra-100)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="58" cy="42" r="3" fill="var(--tangerine)" />
    </svg>
  );
}

export function EmptyState({ title, help, action, className }: { title: string; help?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-[var(--r-lg)] border border-dashed border-line bg-surface p-10 text-center", className)}>
      <DoorMotif />
      <h3>{title}</h3>
      {help ? <p className="max-w-[44ch] text-[15px] text-ink-2">{help}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-center gap-4 rounded-[var(--r-lg)] border border-bad bg-bad-100 p-5", className)}>
      <AlertTriangle className="size-6 shrink-0 text-bad-ink" aria-hidden />
      <p className="min-w-0 flex-1 text-[15px] font-medium text-bad-ink">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
