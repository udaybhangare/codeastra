"use client";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type KpiTone = "ok" | "warn" | "bad" | "neutral";

const TONE_VAR: Record<KpiTone, string> = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--ink-3)" };
const TONE_INK: Record<KpiTone, string> = { ok: "text-ok-ink", warn: "text-warn-ink", bad: "text-bad-ink", neutral: "text-ink-3" };
const TONE_CHIP: Record<KpiTone, string> = { ok: "bg-ok-100 text-ok-ink", warn: "bg-warn-100 text-warn-ink", bad: "bg-bad-100 text-bad-ink", neutral: "bg-paper-2 text-ink-2" };

/** Status corner icon: shape + colour, never colour alone. */
function StatusIcon({ tone }: { tone: KpiTone }) {
  const cls = cn("size-5", TONE_INK[tone]);
  if (tone === "bad") return <OctagonAlert className={cls} aria-label="Needs attention" />;
  if (tone === "warn") return <AlertTriangle className={cls} aria-label="Watch" />;
  if (tone === "ok") return <CheckCircle2 className={cls} aria-label="Healthy" />;
  return null;
}

/** 60-point sparkline, 2 px round caps, no fill (data marks carry no gradients). */
export function Sparkline({ values, tone, className }: { values: number[]; tone: KpiTone; className?: string }) {
  if (values.length < 2) return <div className={cn("h-8", className)} aria-hidden />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const W = 120;
  const H = 32;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 3 - ((v - lo) / span) * (H - 6)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn("h-8 w-full", className)} aria-hidden>
      <polyline points={pts} fill="none" stroke={TONE_VAR[tone]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DeltaChip({ delta, goodWhen, digits = 1, suffix = "" }: { delta: number | undefined; goodWhen: "up" | "down"; digits?: number; suffix?: string }) {
  if (delta === undefined) return <span className="h-6" aria-hidden />;
  const flat = Math.abs(delta) < 0.5 * 10 ** -digits;
  const up = delta > 0;
  const good = flat ? undefined : up === (goodWhen === "up");
  const tone: KpiTone = flat ? "neutral" : good ? "ok" : "bad";
  return (
    <span className={cn("num inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-xs font-semibold", TONE_CHIP[tone])}>
      {flat ? "–" : up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {flat ? "steady" : `${Math.abs(delta).toFixed(digits)}${suffix}`}
    </span>
  );
}

/** Dual ring: outer = first, inner = second (host CPU / memory). */
function DualRing({ outer, inner, tone }: { outer: number; inner: number; tone: KpiTone }) {
  const ring = (r: number, v: number, color: string) => {
    const c = 2 * Math.PI * r;
    return (
      <>
        <circle cx="30" cy="30" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="6" />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${c * Math.min(1, Math.max(0, v))} ${c}`}
          transform="rotate(-90 30 30)"
          style={{ transition: "stroke-dasharray 600ms cubic-bezier(.22,1,.36,1)" }}
        />
      </>
    );
  };
  return (
    <svg viewBox="0 0 60 60" className="size-[60px] shrink-0" aria-hidden>
      {ring(25, outer, TONE_VAR[tone])}
      {ring(15, inner, "var(--ultra)")}
    </svg>
  );
}

export interface KpiTileProps {
  label: string;
  /** Shown in the hover tooltip. */
  definition: string;
  tone: KpiTone;
  /** default / ring (host CPU+mem) / badge (isolation). */
  variant?: "default" | "ring" | "badge";
  value?: number;
  digits?: number;
  unit?: string;
  format?: (n: number) => string;
  spark?: number[];
  delta?: number;
  deltaGoodWhen?: "up" | "down";
  deltaDigits?: number;
  /** Ring variant: [outer, inner] 0..1 plus the printed readouts. */
  ring?: { outer: number; inner: number; outerLabel: string; innerLabel: string };
  /** Badge variant content. */
  badge?: ReactNode;
  className?: string;
}

export function KpiTile({
  label,
  definition,
  tone,
  variant = "default",
  value,
  digits = 0,
  unit,
  format,
  spark,
  delta,
  deltaGoodWhen = "down",
  deltaDigits = 1,
  ring,
  badge,
  className,
}: KpiTileProps) {
  return (
    <Tooltip content={definition} side="bottom">
      <div
        tabIndex={0}
        className={cn(
          "relative flex min-h-[104px] min-w-0 flex-col justify-between gap-1 rounded-[var(--r-lg)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-1)] outline-none focus-visible:shadow-[var(--ring)]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[13px] leading-tight font-semibold tracking-[0.02em] text-ink-2 uppercase">{label}</span>
          <StatusIcon tone={tone} />
        </div>

        {variant === "badge" ? (
          <div className="flex flex-1 items-center">{badge}</div>
        ) : variant === "ring" && ring ? (
          <div className="flex items-center gap-3">
            <DualRing outer={ring.outer} inner={ring.inner} tone={tone} />
            <dl className="num flex flex-col gap-0.5 text-[15px] leading-tight font-semibold">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs font-medium text-ink-2">CPU</dt>
                <dd>{ring.outerLabel}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs font-medium text-ultra-600">MEM</dt>
                <dd>{ring.innerLabel}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-baseline gap-1 font-mono text-[34px] leading-none font-semibold tracking-[-0.02em]">
              {value === undefined ? <span className="text-ink-3">—</span> : <NumberTicker value={value} digits={digits} format={format} />}
              {unit && value !== undefined ? <span className="text-base font-medium text-ink-2">{unit}</span> : null}
            </div>
            <DeltaChip delta={delta} goodWhen={deltaGoodWhen} digits={deltaDigits} />
          </div>
        )}

        {spark ? <Sparkline values={spark} tone={tone} /> : null}
      </div>
    </Tooltip>
  );
}

export function KpiTileSkeleton() {
  return <div className="skeleton min-h-[104px] rounded-[var(--r-lg)]" aria-hidden />;
}
