"use client";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { LadderBadge } from "@/components/domain/ladder-badge";
import { LadderStepper } from "@/components/domain/ladder-stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { tenantColor } from "@/lib/colors";
import { describeAction, eventId, parseEvidence, sentence } from "@/lib/evidence";
import { exportEventJson } from "@/lib/export";
import { fmtMs, fmtPct } from "@/lib/format";
import { eventWindow, mean } from "@/lib/incidents";
import { useStream, type HistoryPoint } from "@/lib/store";
import type { Level, StreamEvent } from "@/lib/ws-types";

const MAX_SERIES = 4;
type Row = HistoryPoint & { s: number };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">{title}</h4>
      {children}
    </section>
  );
}

function MetricChip({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-[104px] flex-col rounded-[var(--r-md)] border border-line bg-paper px-3 py-2" title={hint}>
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <span className="num text-[20px] leading-[1.1] font-medium">{value}</span>
    </div>
  );
}

interface MiniProps {
  data: Row[];
  tenants: string[];
  culprit: string;
  yMax: number;
  label: string;
}

function MiniChart({ data, tenants, culprit, yMax, label }: MiniProps) {
  if (data.length < 2) {
    return <div className="grid h-32 place-items-center rounded-[var(--r-md)] bg-paper-2 px-3 text-center text-[13px] text-ink-2">No samples yet for this window.</div>;
  }
  return (
    <div className="h-32 min-w-0" role="img" aria-label={label}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="s" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}s`} tick={{ fontSize: 11, fill: "var(--ink-2)" }} />
          <YAxis width={36} domain={[0, yMax]} tick={{ fontSize: 11, fill: "var(--ink-2)" }} tickFormatter={(v) => `${Math.round(v)}`} />
          <ReferenceLine x={0} stroke="var(--ink)" strokeDasharray="4 3" />
          {tenants.map((t) => (
            <Line key={t} dataKey={t} stroke={tenantColor(t)} dot={false} strokeWidth={t === culprit ? 3 : 1.5} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BeforeAfter({ event, tenants }: { event: StreamEvent; tenants: string[] }) {
  const history = useStream((s) => s.p99History);
  const at = Date.parse(event.ts);
  const { before, after } = useMemo(() => {
    const w = eventWindow(at);
    const pick = (r: [number, number]): Row[] =>
      history.filter((p: HistoryPoint) => p.ts >= r[0] && p.ts <= r[1]).map((p): Row => ({ ...p, s: Math.round((p.ts - at) / 1000) }));
    return { before: pick(w.before), after: pick(w.after) };
  }, [history, at]);
  const yMax = Math.max(50, ...[...before, ...after].flatMap((p) => tenants.map((t) => p[t] ?? 0))) * 1.1;
  const culprit = event.tenant_id;
  const avg = (rows: typeof before, t: string) => mean(rows.map((r) => r[t]).filter((v) => Number.isFinite(v)));
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[13px] font-semibold text-ink-2">Before (−30 s)</div>
          <MiniChart data={before} tenants={tenants} culprit={culprit} yMax={yMax} label="p99 latency in the 30 seconds before the action" />
        </div>
        <div>
          <div className="mb-1 text-[13px] font-semibold text-ink-2">After (+30 s)</div>
          <MiniChart data={after} tenants={tenants} culprit={culprit} yMax={yMax} label="p99 latency in the 30 seconds after the action" />
        </div>
      </div>
      <ul className="flex flex-wrap gap-2">
        {tenants.map((t) => {
          const b = avg(before, t);
          const a = avg(after, t);
          return (
            <li key={t} className="flex items-center gap-2 rounded-full bg-paper-2 px-3 py-1 text-[13px]">
              <span className="size-2.5 rounded-full" style={{ background: tenantColor(t) }} aria-hidden />
              <span className="font-semibold">{t}</span>
              <span className="num">
                {b === undefined ? "–" : fmtMs(b)} → {a === undefined ? "–" : fmtMs(a)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-ink-2">Dashed line = the moment of the action. Thick line = the throttled tenant; thin lines are its neighbours (p99, ms).</p>
    </>
  );
}

export interface DecisionDrawerProps {
  /** Keep passing the last event while closing so the exit animation doesn't flash the empty state. */
  event: StreamEvent | null;
  open: boolean;
  onClose: () => void;
}

/** The "Why?" drawer (docs/ui/05 §2). Single export used by Overview, Incidents and Audit. */
export function DecisionDrawer({ event, open, onClose }: DecisionDrawerProps) {
  const path = usePathname();
  const [copied, setCopied] = useState(false);
  const ev = event ? parseEvidence(event.evidence) : null;
  const lines = (event?.actions ?? []).map(describeAction);
  const victims = ev?.victims.slice(0, MAX_SERIES - 1) ?? [];
  const names = event ? [event.tenant_id, ...victims.map((v) => v.tenant).filter((t) => t !== event.tenant_id)] : [];

  const copy = async () => {
    if (!event) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the export button still works */
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Why did this happen?"
      description={event ? `Decision at ${new Date(event.ts).toISOString().slice(11, 19)} UTC` : undefined}
      className="w-[min(560px,100vw)]"
      footer={
        event ? (
          <>
            <Button variant="ghost" size="sm" icon={copied ? <Check /> : <Copy />} onClick={copy}>
              {copied ? "Copied" : "Copy JSON"}
            </Button>
            <Button variant="secondary" size="sm" icon={<Download />} onClick={() => exportEventJson(event, `bulkhead-decision-${event.tenant_id}-${event.ts}.json`)}>
              Export
            </Button>
          </>
        ) : undefined
      }
    >
      {!event || !ev ? (
        <p className="text-[15px] text-ink-2">
          This event is no longer in memory (the dashboard keeps the latest 200). Check the Audit log for older decisions.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <div className="mb-3 h-2 rounded-full" style={{ background: tenantColor(event.tenant_id) }} aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-[20px] font-semibold">{event.tenant_id}</span>
              {event.from_level !== undefined ? <LadderBadge level={event.from_level as Level} size="sm" /> : null}
              {event.from_level !== undefined && event.to_level !== undefined ? <span aria-hidden>→</span> : null}
              {event.to_level !== undefined ? <LadderBadge level={event.to_level as Level} size="sm" /> : null}
              {event.actor ? <Badge tone="neutral">by {event.actor}</Badge> : null}
              {event.kind === "predict" || ev.predictor !== undefined ? <Badge tone="predict">predicted</Badge> : null}
            </div>
            <h3 className="mt-3 font-display text-[20px] leading-[1.25] font-semibold">{sentence(event)}</h3>
            {ev.note ? <p className="mt-1 text-[15px] text-ink-2">{ev.note}</p> : null}
          </div>

          {event.to_level !== undefined ? (
            <Section title="Ladder">
              <LadderStepper level={event.to_level as Level} />
            </Section>
          ) : null}

          <Section title="Evidence">
            <div className="flex flex-wrap gap-2">
              <MetricChip label="Culprit score" value={ev.score?.toFixed(2) ?? "—"} hint="How strongly this tenant explains the neighbours' slowdown" />
              <MetricChip label="Threshold τ" value={ev.tau?.toFixed(2) ?? "—"} hint="Score needed before the detector acts" />
              {ev.predictor !== undefined ? <MetricChip label="Predicted overload" value={fmtPct(ev.predictor)} /> : null}
              {ev.resources.map((r) => (
                <MetricChip key={r.resource} label={`${r.resource} over quota`} value={`+${fmtPct(r.excess)}`} hint={`${fmtPct(r.share)} used of ${fmtPct(r.entitlement)} entitled · correlation ${r.corr.toFixed(2)}`} />
              ))}
              {Object.entries(ev.thresholds).map(([k, v]) => (
                <MetricChip key={k} label={k} value={String(Math.round(v * 100) / 100)} />
              ))}
            </div>
            {ev.resources.length === 0 && ev.score === undefined ? <p className="text-[15px] text-ink-2">No attribution recorded (manual or recovery step).</p> : null}
          </Section>

          <Section title="Who was hurt">
            {ev.victims.length === 0 ? (
              <p className="text-[15px] text-ink-2">No victims recorded for this step.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {ev.victims.map((v) => (
                  <li key={v.tenant} className="flex items-center gap-3 rounded-[var(--r-md)] bg-paper px-3 py-2 text-[15px]">
                    <span className="size-2.5 rounded-full" style={{ background: tenantColor(v.tenant) }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-semibold">{v.tenant}</span>
                    <span className="num text-[13px] text-ink-2">
                      {fmtMs(v.baseline_p99_ms)} → {fmtMs(v.p99_ms)}
                    </span>
                    <Badge tone="bad">{v.p99_inflation.toFixed(1)}×</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Before / after">
            <BeforeAfter event={event} tenants={names} />
          </Section>

          <Section title="Actions applied">
            {lines.length === 0 ? (
              <p className="text-[15px] text-ink-2">No limits changed in this step.</p>
            ) : (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px]">
                {lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </Section>

          <details className="text-[13px]">
            <summary className="cursor-pointer font-semibold text-ink-2">Raw evidence (for engineers)</summary>
            <pre className="num mt-2 max-h-64 overflow-auto rounded-[var(--r-md)] bg-paper-2 p-3 text-[13px]">{JSON.stringify(event.evidence ?? {}, null, 2)}</pre>
          </details>

          {path !== "/incidents" ? (
            <Link href={`/incidents?e=${encodeURIComponent(eventId(event))}`} className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ultra hover:underline">
              <ExternalLink className="size-4" aria-hidden />
              Open in Incidents
            </Link>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
