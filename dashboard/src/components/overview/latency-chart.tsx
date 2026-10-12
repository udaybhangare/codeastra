"use client";
import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { AXIS_TICK, ChartLegend, ReadHint, Takeaway, TipBox } from "@/components/ui/chart-kit";
import { Skeleton } from "@/components/ui/skeleton";
import { tenantColor } from "@/lib/colors";
import { fmtDuration, fmtMs } from "@/lib/format";
import { classifyTenants } from "@/lib/overview";
import { useStream } from "@/lib/store";

const MAX_POINTS = 240; // stride-downsample the 600-point window; keeps Recharts smooth
const MAX_MARKERS = 8;

type TipProps = {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; value?: unknown; color?: string }[];
  label?: unknown;
};

function Tip({ active, payload, end }: TipProps & { end: number }) {
  if (!active || !payload?.length) return null;
  const ts = Number((payload[0] as { payload?: { ts?: number } }).payload?.ts ?? end);
  const rows = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <TipBox title={end - ts < 2000 ? "now" : `−${fmtDuration((end - ts) / 1000)}`}>
      {rows.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-[13px]">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-3 rounded-full" style={{ background: p.color }} aria-hidden />
            {String(p.dataKey)}
          </span>
          <span className="num font-semibold">{fmtMs(Number(p.value))}</span>
        </div>
      ))}
    </TipBox>
  );
}

export function LatencyChart({ selected }: { selected: string | null }) {
  const hist = useStream((s) => s.p99History);
  const ids = useStream((s) => s.tenantIds);
  const latest = useStream((s) => s.latest);
  const events = useStream((s) => s.events);

  const roles = useMemo(() => classifyTenants(hist, latest), [hist, latest]);
  const data = useMemo(() => {
    const stride = Math.max(1, Math.ceil(hist.length / MAX_POINTS));
    return hist.filter((_, i) => i % stride === 0 || i === hist.length - 1);
  }, [hist]);

  const start = hist[0]?.ts ?? 0;
  const end = hist[hist.length - 1]?.ts ?? 0;
  // Explicit, de-duplicated ticks: recharts' auto ticks repeat a value when the time domain is tiny, which collides React keys.
  const ticks = useMemo(() => {
    const span = end - start;
    if (!(span > 0)) return [end];
    return [...new Set(Array.from({ length: 6 }, (_, i) => Math.round(start + (span * i) / 5)))];
  }, [start, end]);
  const markers = useMemo(
    () =>
      events
        .filter((e) => e.kind === "throttle" && (e.to_level ?? 0) > (e.from_level ?? 0))
        .map((e) => ({ ts: Date.parse(e.ts), tenant: e.tenant_id, level: e.to_level ?? 0 }))
        .filter((m) => m.ts >= start && m.ts <= end && (!selected || m.tenant === selected))
        .slice(0, MAX_MARKERS),
    [events, start, end, selected],
  );

  const now = latest?.tenants ?? [];
  const p99 = (id: string) => now.find((t) => t.tenant_id === id)?.p99_ms;
  const culprit = ids.find((id) => roles.culprits.has(id));
  const victims = ids.filter((id) => roles.victims.has(id));
  const worst = victims.reduce((m, id) => Math.max(m, p99(id) ?? 0), 0);
  const takeaway =
    victims.length && culprit ? (
      <Takeaway tone="bad">
        <b>{culprit}</b> is using more than its share, so <b>{victims.join(", ")}</b> {victims.length > 1 ? "are" : "is"} slowed to {fmtMs(worst)}. Bulkhead is throttling {culprit}.
      </Takeaway>
    ) : culprit ? (
      <Takeaway tone="warn">
        <b>{culprit}</b> is being throttled. Nobody else is noticeably slower yet.
      </Takeaway>
    ) : (
      <Takeaway tone="ok">Everyone is being served at a normal speed. No tenant is crowding out another.</Takeaway>
    );

  return (
    <Card className="col-span-8 min-w-0 pb-5 max-[1023px]:col-span-12" eyebrow="Response time · slowest 1% (p99)" title="Is anyone being slowed down?">
      <div className="flex flex-col gap-3 px-5 pt-3">
        {hist.length < 2 ? (
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <>
            {takeaway}
            <div className="h-[260px]" role="img" aria-label="Slowest-1% response time per tenant over the last 10 minutes">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="lat-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    domain={[start, end]}
                    scale="time"
                    ticks={ticks}
                    tickFormatter={(v: number) => (end - v < 2000 ? "now" : `−${fmtDuration((end - v) / 1000)}`)}
                    stroke="var(--line)"
                    tick={AXIS_TICK}
                    tickLine={false}
                  />
                  <YAxis width={60} stroke="var(--line)" tick={AXIS_TICK} tickFormatter={(v: number) => `${Math.round(v)}ms`} tickLine={false} axisLine={false} />
                  <Tooltip content={(p: TipProps) => <Tip {...p} end={end} />} cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} isAnimationActive={false} />
                  {markers.map((m) => (
                    <ReferenceLine
                      key={`${m.ts}-${m.tenant}`}
                      x={m.ts}
                      stroke={tenantColor(m.tenant)}
                      strokeDasharray="2 3"
                      label={{ value: `throttled → L${m.level}`, position: "top", fill: "var(--ink)", fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600 }}
                    />
                  ))}
                  {selected ? (
                    <Area dataKey={selected} type="monotone" stroke="none" fill="url(#lat-fill)" style={{ color: tenantColor(selected) }} isAnimationActive={false} legendType="none" tooltipType="none" />
                  ) : null}
                  {ids.map((id) => {
                    const victim = roles.victims.has(id);
                    const culpritId = roles.culprits.has(id);
                    const faded = selected ? selected !== id : false;
                    return (
                      <Line
                        key={id}
                        dataKey={id}
                        type="monotone"
                        dot={false}
                        isAnimationActive={false}
                        stroke={tenantColor(id)}
                        strokeWidth={victim || selected === id ? 3.5 : 2.5}
                        strokeLinecap="round"
                        strokeDasharray={culpritId ? "7 5" : undefined}
                        strokeOpacity={faded ? 0.2 : 1}
                      />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ChartLegend
              className="mt-0"
              items={ids.map((id) => ({
                name: id,
                color: tenantColor(id),
                dash: roles.culprits.has(id) ? "5 3" : undefined,
                value: p99(id) !== undefined ? fmtMs(p99(id) as number) : undefined,
                note: roles.victims.has(id) ? "slowed down" : roles.culprits.has(id) ? "throttled" : undefined,
              }))}
            />
            <ReadHint>Lower is better. A thick line is a tenant being slowed; a dashed line is the tenant Bulkhead is throttling. Click a tenant in the grid to focus it.</ReadHint>
          </>
        )}
      </div>
    </Card>
  );
}
