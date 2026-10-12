"use client";
import { motion, useInView } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { useRef } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { gaugeTone, type GaugeSpec, type GaugeTone } from "@/lib/portal-view";
import { springSoft, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";

const R = 78;
const SPAN = 1.25; // full circle = 125% of quota: the last fifth is the "burst" zone past the tick
const FILL: Record<GaugeTone, string> = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)" };
const CAPTION: Record<GaugeTone, string> = { ok: "Comfortable", warn: "Getting close", bad: "At the limit" };
const ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: OctagonAlert } as const;
const INK: Record<GaugeTone, string> = { ok: "text-ok-ink", warn: "text-warn-ink", bad: "text-bad-ink" };

/** Ring gauge: track paper-2, value arc in status colour, quota tick, lighter burst arc, mono centre value. Fills once on view. */
export function UsageGauge({ spec, className }: { spec: GaugeSpec; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.4 });
  const reduced = useReducedMotionSafe();
  const isRej = spec.id === "rejected";
  const tone = gaugeTone(isRej ? spec.ratio * 2 : spec.ratio);
  const frac = isRej ? Math.min(spec.ratio * 2, 1) : Math.min(spec.ratio / SPAN, 1);
  const tick = 1 / SPAN; // quota marker position
  const Icon = ICON[tone];
  const target = seen || reduced ? frac : 0;
  const pct = Math.round(spec.ratio * 100);

  // Points on the ring (0 = 12 o'clock, clockwise) for the tick.
  const a = tick * 2 * Math.PI - Math.PI / 2;
  const tx = (r: number) => 100 + r * Math.cos(a);
  const ty = (r: number) => 100 + r * Math.sin(a);

  return (
    <div
      ref={ref}
      className={cn("flex flex-col items-center gap-2", className)}
      role="meter"
      aria-label={spec.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, pct)}
      aria-valuetext={`${spec.value} ${spec.of}`}
    >
      <div className="relative aspect-square w-full max-w-[220px]">
        <svg viewBox="0 0 200 200" className="size-full" aria-hidden>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--paper-2)" strokeWidth="16" />
          {!isRej && (
            // Burst zone: lighter arc from the quota tick to the end of the ring.
            <circle
              cx="100" cy="100" r={R} fill="none" stroke={FILL[tone]} strokeOpacity={0.22} strokeWidth="16" pathLength={1}
              strokeDasharray={`${1 - tick} 1`} strokeDashoffset={-tick} transform="rotate(-90 100 100)"
            />
          )}
          <motion.circle
            cx="100" cy="100" r={R} fill="none" stroke={FILL[tone]} strokeWidth="16" strokeLinecap="round" pathLength={1}
            strokeDasharray="1 1" transform="rotate(-90 100 100)"
            initial={{ strokeDashoffset: 1 - 0.0001 }}
            animate={{ strokeDashoffset: 1 - Math.max(target, 0.0001) }}
            transition={reduced ? { duration: 0 } : springSoft}
          />
          {!isRej && <line x1={tx(R - 14)} y1={ty(R - 14)} x2={tx(R + 14)} y2={ty(R + 14)} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="num text-[32px] leading-none font-semibold tracking-[-0.02em]">{spec.value}</span>
          <span className="num mt-1 text-xs text-ink-2">{spec.of}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[15px] font-semibold">{spec.label}</span>
        <Tooltip content={<span className="block max-w-[240px] whitespace-normal">{spec.help}</span>}>
          <button type="button" aria-label={`What is ${spec.label}?`} className="inline-flex size-6 items-center justify-center rounded-full text-ink-3 outline-none hover:text-ink focus-visible:shadow-[var(--ring)]">
            <Info className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </div>
      <span className={cn("inline-flex items-center gap-1 text-[13px] font-semibold", INK[tone])}>
        <Icon className="size-4" aria-hidden />
        {isRej && spec.ratio === 0 ? "None turned away" : CAPTION[tone]}
      </span>
    </div>
  );
}
