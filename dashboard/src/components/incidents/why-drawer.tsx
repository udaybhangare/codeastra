"use client";
import { useEffect, useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { X } from "lucide-react";
import { useStream } from "@/lib/store";
import { describeAction, parseEvidence, sentence } from "@/lib/evidence";
import { LadderBadge, Pill } from "../status";
import type { Level, StreamEvent } from "@/lib/ws-types";

const COLORS = ["var(--bad)", "var(--info)", "var(--ok)", "var(--warn)"];
const WINDOW_MS = 30_000;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

function Sparkline({ event, tenants }: { event: StreamEvent; tenants: string[] }) {
  const history = useStream((s) => s.p99History);
  const at = Date.parse(event.ts);
  const data = useMemo(
    () => history.filter((p) => p.ts >= at - WINDOW_MS && p.ts <= at + WINDOW_MS).map((p) => ({ ...p, s: Math.round((p.ts - at) / 1000) })),
    [history, at],
  );
  if (data.length < 2) {
    return <p className="text-sm text-muted-foreground">No metric history in memory around this moment (the page keeps the last 10 minutes).</p>;
  }
  return (
    <div className="h-36" role="img" aria-label={`p99 latency for ${tenants.join(", ")} around the event`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="s" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}s`} tick={{ fontSize: 11 }} />
          <YAxis width={44} tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v)}`} unit=" ms" />
          <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeDasharray="4 3" />
          {tenants.map((t, i) => (
            <Line key={t} dataKey={t} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const th = "px-2 py-1 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-1 font-mono tabular-nums";

export function WhyDrawer({ event, onClose }: { event: StreamEvent | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ev = event ? parseEvidence(event.evidence) : null;
  const lines = (event?.actions ?? []).map(describeAction);
  const names = event && ev ? [event.tenant_id, ...ev.victims.map((v) => v.tenant).slice(0, 3)] : [];

  return (
    <aside role="dialog" aria-modal="false" aria-label="Why this action happened" className="fixed inset-y-0 right-0 z-40 flex w-[min(520px,100vw)] flex-col border-l border-border bg-card shadow-xl">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="font-medium">Why did this happen?</h2>
        <button onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close explanation">
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {!event || !ev ? (
          <p className="text-sm text-muted-foreground">This event is no longer in memory (the dashboard keeps the latest 200). Check the Audit log for older decisions.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{event.tenant_id}</span>
              {event.from_level !== undefined && <LadderBadge level={event.from_level as Level} />}
              <span aria-hidden>→</span>
              {event.to_level !== undefined && <LadderBadge level={event.to_level as Level} />}
              {event.actor && <Pill tone="info">by {event.actor}</Pill>}
              {ev.predictor !== undefined && <Pill tone="info">predicted</Pill>}
            </div>
            <p className="text-base leading-snug">{sentence(event)}</p>
            {ev.note && <p className="text-sm text-muted-foreground">{ev.note}</p>}

            <Section title="Who was hurt">
              {ev.victims.length === 0 ? (
                <p className="text-sm text-muted-foreground">No victims recorded for this step (manual, recovery or predictive action).</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>Tenant</th><th className={th}>p99 now</th><th className={th}>Baseline</th><th className={th}>Inflation</th></tr></thead>
                  <tbody>
                    {ev.victims.map((v) => (
                      <tr key={v.tenant} className="border-t border-border">
                        <td className="px-2 py-1">{v.tenant}</td>
                        <td className={td}>{Math.round(v.p99_ms)} ms</td>
                        <td className={td}>{Math.round(v.baseline_p99_ms)} ms</td>
                        <td className={td}>{v.p99_inflation.toFixed(1)}×</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section title="What explains it">
              {ev.resources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No resource attribution recorded.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr><th className={th}>Resource</th><th className={th}>Used</th><th className={th}>Entitled</th><th className={th}>Over</th><th className={th}>Corr. r</th></tr></thead>
                  <tbody>
                    {ev.resources.map((r) => (
                      <tr key={r.resource} className="border-t border-border">
                        <td className="px-2 py-1">{r.resource}</td>
                        <td className={td}>{pct(r.share)}</td>
                        <td className={td}>{pct(r.entitlement)}</td>
                        <td className={td}>{pct(r.excess)}</td>
                        <td className={td}>{r.corr.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-xs text-muted-foreground">
                Culprit score {ev.score?.toFixed(3) ?? "—"}
                {ev.tau !== undefined && ` (detection threshold ${ev.tau})`}
                {ev.predictor !== undefined && ` · predictor forecast ${ev.predictor.toFixed(2)} chance of overload`}
              </p>
            </Section>

            <Section title="Metric snapshot (p99 around the event)">
              <Sparkline event={event} tenants={names} />
              <p className="text-xs text-muted-foreground">Dashed line = moment of the action. First series is the throttled tenant; others are victims.</p>
            </Section>

            <Section title="Actions applied">
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No limits changed in this step.</p>
              ) : (
                <ul className="list-disc pl-5 text-sm">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              )}
            </Section>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Raw evidence (for engineers)</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2">{JSON.stringify(event.evidence ?? {}, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}
