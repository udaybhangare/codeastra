// Custom 2-colour line icons per scenario (ink stroke + one accent fill), 48×48.
import type { ReactNode } from "react";

const S = { stroke: "var(--ink)", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<string, ReactNode> = {
  // CPU flood: chip with rising flame ticks
  S1: (
    <>
      <rect x="12" y="12" width="24" height="24" rx="5" fill="var(--tangerine-100)" {...S} />
      <rect x="19" y="19" width="10" height="10" rx="2" fill="var(--tangerine)" {...S} />
      <path d="M18 6v6M24 6v6M30 6v6M18 36v6M24 36v6M30 36v6M6 18h6M6 30h6M36 18h6M36 30h6" {...S} />
    </>
  ),
  // Memory bomb: RAM stick + fuse spark
  S2: (
    <>
      <rect x="6" y="20" width="36" height="16" rx="4" fill="var(--ultra-100)" {...S} />
      <path d="M12 36v4M20 36v4M28 36v4M36 36v4M14 26h4M22 26h4M30 26h4" {...S} />
      <path d="M24 20v-6l5-5" {...S} />
      <circle cx="32" cy="8" r="3" fill="var(--tangerine)" stroke="var(--ink)" strokeWidth="2" />
    </>
  ),
  // DB connection hog: cylinder with clamp
  S3: (
    <>
      <path d="M10 12v22c0 3 6.5 6 14 6s14-3 14-6V12" fill="var(--ultra-100)" {...S} />
      <ellipse cx="24" cy="12" rx="14" ry="6" fill="var(--surface)" {...S} />
      <path d="M10 23c0 3 6.5 6 14 6s14-3 14-6" {...S} />
      <rect x="19" y="3" width="10" height="6" rx="2" fill="var(--tangerine)" stroke="var(--ink)" strokeWidth="2" />
    </>
  ),
  // Retry storm: looping arrows
  S4: (
    <>
      <path d="M38 20a14 14 0 0 0-25-6M10 28a14 14 0 0 0 25 6" {...S} />
      <path d="M13 6v8h8M35 42v-8h-8" {...S} />
      <circle cx="24" cy="24" r="4" fill="var(--tangerine)" stroke="var(--ink)" strokeWidth="2" />
    </>
  ),
  // Slow ramp: staircase line
  S5: (
    <>
      <path d="M6 40h36" {...S} />
      <path d="M8 36l8-4 6 2 8-10 10-10" {...S} />
      <path d="M8 40V36M16 40V32M22 40V34M30 40V24M40 40V14" stroke="var(--ultra)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="40" cy="14" r="3.5" fill="var(--tangerine)" stroke="var(--ink)" strokeWidth="2" />
    </>
  ),
  // Legit flash crowd: crowd of dots under a spike
  S6: (
    <>
      <path d="M6 38c6 0 8-24 18-24s12 24 18 24" fill="var(--ok-100)" {...S} />
      <circle cx="16" cy="38" r="3" fill="var(--lime)" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="24" cy="38" r="3" fill="var(--lime)" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="32" cy="38" r="3" fill="var(--lime)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M24 6v4" {...S} />
    </>
  ),
  // Multi-abuser: two spikes
  S7: (
    <>
      <path d="M6 40l8-30 8 30M26 40l8-24 8 24" fill="var(--bad-100)" {...S} />
      <path d="M4 40h40" {...S} />
      <circle cx="14" cy="10" r="3" fill="var(--tangerine)" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="34" cy="16" r="3" fill="var(--tangerine)" stroke="var(--ink)" strokeWidth="2" />
    </>
  ),
  // Bandwidth flood: pipe with fat packets
  S8: (
    <>
      <rect x="4" y="16" width="40" height="16" rx="8" fill="var(--ultra-50)" {...S} />
      <rect x="10" y="20" width="12" height="8" rx="3" fill="var(--tangerine)" stroke="var(--ink)" strokeWidth="2" />
      <rect x="28" y="20" width="10" height="8" rx="3" fill="var(--lime)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M8 8h8M32 40h8" {...S} />
    </>
  ),
};

export function ScenarioIcon({ id, className }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <g fill="none">{ICONS[id] ?? <circle cx="24" cy="24" r="14" fill="var(--paper-2)" {...S} />}</g>
    </svg>
  );
}
