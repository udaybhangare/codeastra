import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One axis-tick style for every chart: 13 px mono, readable ink. */
export const AXIS_TICK = { fill: "var(--ink-2)", fontSize: 13, fontFamily: "var(--font-mono)" } as const;

type Tone = "ok" | "warn" | "bad" | "info";
const TONE: Record<Tone, { box: string; Icon: typeof Info }> = {
  ok: { box: "bg-ok-100 text-ok-ink", Icon: CheckCircle2 },
  warn: { box: "bg-warn-100 text-warn-ink", Icon: AlertTriangle },
  bad: { box: "bg-bad-100 text-bad-ink", Icon: OctagonAlert },
  info: { box: "bg-ultra-50 text-ultra-600", Icon: Info },
};

/** The one-sentence answer to "so what?", shown above a chart before any detail. */
export function Takeaway({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const { box, Icon } = TONE[tone];
  return (
    <p role="status" className={cn("flex items-start gap-2 rounded-[var(--r-md)] px-3 py-2 text-[15px] leading-snug font-medium", box, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export interface LegendEntry {
  name: string;
  color: string;
  dash?: string;
  /** Right-aligned current value, so the legend doubles as a readout. */
  value?: string;
  note?: string;
}

/** Legend that explains line style and shows the latest number next to each name. */
export function ChartLegend({ items, className }: { items: LegendEntry[]; className?: string }) {
  return (
    <ul className={cn("mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]", className)}>
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-2">
          <svg width="20" height="6" aria-hidden>
            <line x1="1" x2="19" y1="3" y2="3" stroke={i.color} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={i.dash} />
          </svg>
          <span className="font-semibold">{i.name}</span>
          {i.value ? <span className="num text-ink-2">{i.value}</span> : null}
          {i.note ? <span className="font-semibold text-ink-2">· {i.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Small "how to read this" line under a chart. */
export function ReadHint({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] text-ink-2">{children}</p>;
}

/** Shared tooltip shell. */
export function TipBox({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 shadow-[var(--shadow-2)]">
      {title ? <div className="num mb-1 text-xs text-ink-3">{title}</div> : null}
      {children}
    </div>
  );
}
