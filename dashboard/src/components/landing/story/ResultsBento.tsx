"use client";
// Three result tiles; numbers tick up when the proof section becomes active. Values: ./results.ts.
import { NumberTicker } from "@/components/ui/number-ticker";
import { RESULTS } from "./results";

function Tile({ title, children, note }: { title: string; children: React.ReactNode; note: string }) {
  return (
    <div className="pointer-events-auto rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-1)]">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      <div className="mt-3">{children}</div>
      <p className="mt-3 text-[13px] leading-snug text-ink-2">{note}</p>
    </div>
  );
}

/** Two bars on one scale: with Bulkhead (green) vs without (red). Width is share of `max`. */
function Pair({ on, off, max, active, unit, lowerIsBetter }: { on: number; off: number; max: number; active: boolean; unit: string; lowerIsBetter?: boolean }) {
  const w = (v: number) => `${active ? Math.max(3, Math.min(100, (v / max) * 100)) : 0}%`;
  const row = (label: string, v: number, bar: string, ink: string) => (
    <div className="flex items-center gap-3">
      <span className="w-[72px] shrink-0 text-[13px] font-semibold text-ink-2">{label}</span>
      <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
        <div className={`h-full rounded-full ${bar}`} style={{ width: w(v), transition: "width 900ms cubic-bezier(.22,1,.36,1)" }} />
      </div>
      <span className={`num w-[76px] shrink-0 text-right text-[15px] font-semibold ${ink}`}>
        {v.toLocaleString("en-US")}
        {unit}
      </span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2" role="img" aria-label={`With Bulkhead ${on}${unit}, without ${off}${unit}${lowerIsBetter ? ", lower is better" : ""}`}>
      {row("With", on, "bg-ok", "text-ok-ink")}
      {row("Without", off, "bg-bad", "text-bad-ink")}
    </div>
  );
}

export function ResultsBento({ active }: { active: boolean }) {
  const r = RESULTS;
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile title="How much slower did innocent tenants get?" note="Median of 5 runs. Lower is better; 1× means no slowdown.">
          <p className="num text-[40px] leading-none font-semibold text-ok-ink">
            <NumberTicker value={active ? r.inflation.on : 0} digits={2} />×
          </p>
          <p className="num mt-1 mb-3 text-[14px] text-bad-ink">
            vs <NumberTicker value={active ? r.inflation.off : 0} />× without Bulkhead
          </p>
        </Tile>
        <Tile title="Good tenants wrongly limited" note="Flash-crowd test: lots of traffic, none of it harmful.">
          <p className="num text-[40px] leading-none font-semibold">
            <NumberTicker value={active ? r.falsePositives : 0} />
          </p>
          <p className="mt-1 text-[14px] text-ink-2">Busy is not the same as harmful.</p>
        </Tile>
        <Tile title="How much work innocent tenants kept doing" note="Throughput during an attack vs normal. Higher is better.">
          <Pair on={r.throughputPct.on} off={r.throughputPct.off} max={100} active={active} unit="%" />
        </Tile>
      </div>
      <p className="mt-3 max-w-[60ch] text-[13px] leading-snug text-ink-2">
        One laptop, load generator on the same host. Containment is demonstrated; detect/mitigate timing is not. Source:{" "}
        <code className="num">{r.source}</code>.
      </p>
    </div>
  );
}
