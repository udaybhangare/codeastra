"use client";
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStream } from "@/lib/store";
import { ENTITLEMENT, LADDER } from "@/lib/ladder";
import type { TenantMetrics } from "@/lib/ws-types";
import { LadderBadge } from "../status";
import { cn } from "@/lib/utils";
import { whyHref } from "../incidents/incidents";
import Link from "next/link";

const SERIES = ["var(--info)", "var(--ok)", "var(--warn)", "oklch(0.75 0.12 320)", "var(--bad)", "oklch(0.8 0.1 200)", "oklch(0.7 0.1 120)", "oklch(0.7 0.1 50)"];

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />;
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const TONE_TEXT = { ok: "text-ok", warn: "text-warn", bad: "text-bad" } as const;

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-2xl tabular-nums", tone && TONE_TEXT[tone])}>{value}</div>
    </div>
  );
}

const pct = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v * 100)}%`);

function KpiStrip() {
  const snap = useStream((s) => s.latest);
  if (!snap) return <div className="grid grid-cols-5 gap-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[68px]" />)}</div>;
  const throttled = snap.tenants.filter((t) => t.level > 0).length;
  const infl = snap.fairness?.victim_inflation;
  const jain = snap.fairness?.jain;
  return (
    <div className="grid grid-cols-5 gap-3">
      <Kpi label="Host CPU" value={pct(snap.host.cpu_util)} tone={snap.host.cpu_util > 0.85 ? "bad" : snap.host.cpu_util > 0.65 ? "warn" : "ok"} />
      <Kpi label="Host memory" value={pct(snap.host.mem_util)} tone={snap.host.mem_util > 0.85 ? "bad" : snap.host.mem_util > 0.7 ? "warn" : "ok"} />
      <Kpi label="Jain's fairness" value={jain === undefined ? "—" : jain.toFixed(2)} tone={jain === undefined ? undefined : jain < 0.7 ? "bad" : jain < 0.9 ? "warn" : "ok"} />
      <Kpi label="Victim p99 inflation" value={infl === undefined ? "—" : `${infl.toFixed(1)}×`} tone={infl === undefined ? undefined : infl > 3 ? "bad" : infl > 1.5 ? "warn" : "ok"} />
      <Kpi label="Active throttles" value={String(throttled)} tone={throttled ? "bad" : "ok"} />
    </div>
  );
}

const COLS = [
  { key: "CPU", f: (t: TenantMetrics) => t.cpu_share / ENTITLEMENT[t.tier].cpu },
  { key: "Memory", f: (t: TenantMetrics) => t.mem_mb / ENTITLEMENT[t.tier].mem_mb },
  { key: "DB", f: (t: TenantMetrics) => (t.db_conns ?? 0) / ENTITLEMENT[t.tier].db_conns },
  { key: "Queue", f: (t: TenantMetrics) => t.queue_depth / ENTITLEMENT[t.tier].queue },
  { key: "Bandwidth", f: (t: TenantMetrics) => (t.bytes_s ?? 0) / ENTITLEMENT[t.tier].bytes_s },
];

function heat(r: number) {
  if (r >= 1) return "bg-bad/40 text-foreground";
  if (r >= 0.7) return "bg-warn/30 text-foreground";
  return "bg-ok/15 text-muted-foreground";
}

function Heatmap() {
  const snap = useStream((s) => s.latest);
  if (!snap) return <Skeleton className="h-48" />;
  if (snap.tenants.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No tenants reporting yet.</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">Resource use as a share of each tenant&apos;s entitlement</caption>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="w-28 pb-1 font-normal">Tenant</th>
          {COLS.map((c) => <th key={c.key} scope="col" className="pb-1 text-center font-normal">{c.key}</th>)}
        </tr>
      </thead>
      <tbody>
        {snap.tenants.map((t) => (
          <tr key={t.tenant_id}>
            <th scope="row" className="truncate py-0.5 pr-2 text-left font-medium">{t.tenant_id}</th>
            {COLS.map((c) => {
              const r = c.f(t);
              return (
                <td key={c.key} className="p-0.5">
                  <div className={cn("rounded px-1 py-1 text-center font-mono text-xs tabular-nums transition-colors", heat(r))}>
                    {Math.round(r * 100)}%
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LatencyChart() {
  const hist = useStream((s) => s.p99History);
  const ids = useStream((s) => s.tenantIds);
  const latest = useStream((s) => s.latest);

  // A "victim" is an unthrottled tenant whose p99 is well above its own best.
  const { victims, culprits } = useMemo(() => {
    const v = new Set<string>();
    const c = new Set<string>();
    if (!latest) return { victims: v, culprits: c };
    for (const t of latest.tenants) {
      if (t.level > 0) { c.add(t.tenant_id); continue; }
      let min = Infinity;
      for (const p of hist) if (p[t.tenant_id] > 0 && p[t.tenant_id] < min) min = p[t.tenant_id];
      if (min < Infinity && t.p99_ms > min * 2) v.add(t.tenant_id);
    }
    return { victims: v, culprits: c };
  }, [hist, latest]);

  if (hist.length < 2) return <Skeleton className="h-64" />;
  const t0 = hist[0].ts;
  const data = hist.map((p) => ({ ...p, t: Math.round((p.ts - t0) / 1000) }));
  return (
    <>
      <div className="h-64" role="img" aria-label="p99 latency per tenant over the last 10 minutes">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="t" tickFormatter={(v) => `${v}s`} stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis width={44} stroke="var(--muted-foreground)" fontSize={11} unit="ms" />
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
            {ids.map((id, i) => (
              <Line
                key={id}
                dataKey={id}
                dot={false}
                isAnimationActive={false}
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={victims.has(id) || culprits.has(id) ? 2.5 : 1.2}
                strokeDasharray={culprits.has(id) ? "5 3" : undefined}
                strokeOpacity={victims.size && !victims.has(id) && !culprits.has(id) ? 0.45 : 1}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {ids.map((id, i) => (
          <li key={id} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
            {id}
            {victims.has(id) && <span className="text-warn">(victim)</span>}
            {culprits.has(id) && <span className="text-bad">(throttled)</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

function Ladder() {
  const snap = useStream((s) => s.latest);
  if (!snap) return <Skeleton className="h-32" />;
  return (
    <ul className="flex flex-col gap-1.5">
      {snap.tenants.map((t) => (
        <li key={t.tenant_id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{t.tenant_id} <span className="text-xs text-muted-foreground">{t.tier}</span></span>
          <LadderBadge level={t.level} />
        </li>
      ))}
    </ul>
  );
}

function ActiveThrottles() {
  const snap = useStream((s) => s.latest);
  const events = useStream((s) => s.events);
  if (!snap) return <Skeleton className="h-32" />;
  const active = snap.tenants.filter((t) => t.level > 0);
  const recent = events.filter((e) => e.kind === "throttle").slice(0, 4);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {active.length === 0 ? (
        <p className="text-muted-foreground">No active throttles. All tenants within entitlement.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {active.map((t) => (
            <li key={t.tenant_id} className="flex justify-between">
              <span>{t.tenant_id}</span>
              <span className="text-muted-foreground">{LADDER[t.level].name} · {Math.round(t.rejected_rps ?? 0)} rej/s</span>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <ul className="border-t border-border pt-2 text-xs text-muted-foreground">
          {recent.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="flex justify-between gap-2">
              <span className="truncate">{e.message}</span>
              <Link href={whyHref(e)} className="shrink-0 text-info hover:underline">Why?</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Overview() {
  const conn = useStream((s) => s.conn);
  const hasData = useStream((s) => s.latest !== null);
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-3">
      <h1 className="sr-only">Overview</h1>
      {conn === "reconnecting" && hasData && (
        <div role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          Connection lost. Showing last known data; reconnecting…
        </div>
      )}
      <KpiStrip />
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <Card title="p99 latency per tenant"><LatencyChart /></Card>
        <Card title="Resource use vs entitlement"><Heatmap /></Card>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card title="Throttle ladder"><Ladder /></Card>
        <Card title="Active throttles"><ActiveThrottles /></Card>
      </div>
    </div>
  );
}
