"use client";
import { useMemo } from "react";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { ALERT_P, type ChartRow, type LeadItem, type Span } from "@/lib/predictor";
import { AXIS_TICK, TipBox } from "@/components/ui/chart-kit";
import { fmtDuration, fmtMs, fmtNum } from "@/lib/format";

const TICK = AXIS_TICK;

export interface ForecastChartProps {
  rows: ChartRow[];
  /** Colour of the actual line (tenant identity colour, ink for the host). */
  color: string;
  host: boolean;
  spans: Span[];
  leads: LeadItem[];
  /** Escalation markers for this tenant (all tenants' for host). */
  markers: { ts: number; label: string }[];
}

function Tip({ active, payload, end, host }: TooltipContentProps<ValueType, NameType> & { end: number; host: boolean }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ChartRow;
  return (
    <TipBox title={end - row.ts < 2000 ? "now" : `−${fmtDuration((end - row.ts) / 1000)}`}>
      <div className="num text-[13px]">
        <div>
          {host ? "CPU" : "p99"} <b>{host ? `${fmtNum(row.actual, 0)}%` : fmtMs(row.actual)}</b>
        </div>
        <div className="text-ultra-600">
          overload risk <b>{row.forecast === undefined ? "–" : `${Math.round(row.forecast * 100)}%`}</b>
        </div>
      </div>
    </TipBox>
  );
}

/** Actual (solid) vs forecast p_overload (ultramarine dashed), alert zone, escalation markers, lead brackets. */
export function ForecastChart({ rows, color, host, spans, leads, markers }: ForecastChartProps) {
  const start = rows[0]?.ts ?? 0;
  const end = rows[rows.length - 1]?.ts ?? 0;
  const ticks = useMemo(() => {
    const span = end - start;
    if (span < 4000) return [start, end];
    return Array.from(new Set([0, 1, 2, 3, 4].map((i) => Math.round(start + (span * i) / 4))));
  }, [start, end]);
  const bracketTs = new Set(leads.map((l) => l.eventTs));
  return (
    <div className="h-[380px] w-full" role="img" aria-label={`Actual ${host ? "CPU" : "p99 latency"} against the predictor's overload forecast`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[start, end]}
            ticks={ticks}
            tickFormatter={(v: number) => (end - v < 2000 ? "now" : `−${fmtDuration((end - v) / 1000)}`)}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--line)" }}
          />
          <YAxis yAxisId="a" width={64} tick={TICK} label={{ value: host ? "Actual CPU" : "Actual p99", angle: -90, position: "insideLeft", offset: 14, fill: "var(--ink-2)", fontSize: 13 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (host ? `${Math.round(v)}%` : `${Math.round(v)}ms`)} />
          <YAxis yAxisId="p" orientation="right" width={64} label={{ value: "Overload risk", angle: 90, position: "insideRight", offset: 14, fill: "var(--ultra-600)", fontSize: 13 }} domain={[0, 1]} ticks={[0, ALERT_P, 1]} tick={{ ...TICK, fill: "var(--ultra)" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
          <ReferenceArea yAxisId="p" y1={ALERT_P} y2={1} fill="var(--ultra-100)" fillOpacity={0.55} ifOverflow="hidden" />
          {spans.map((s) => (
            <ReferenceArea key={s.from} yAxisId="p" x1={s.from} x2={s.to} y1={0} y2={1} fill="var(--ultra)" fillOpacity={0.08} ifOverflow="hidden" />
          ))}
          {leads.map((l) => (
            <ReferenceArea
              key={l.eventTs}
              yAxisId="p"
              x1={Math.max(start, l.eventTs - l.leadS * 1000)}
              x2={l.eventTs}
              y1={0.02}
              y2={0.1}
              fill="var(--ultra)"
              fillOpacity={0.9}
              ifOverflow="hidden"
              label={{ value: `${l.atLeast ? "≥" : ""}${fmtNum(l.leadS, 0)}s lead`, position: "insideTopLeft", fill: "var(--ultra-600)", fontSize: 12, fontFamily: "var(--font-mono)" }}
            />
          ))}
          {markers.map((m) => (
            <ReferenceLine
              key={`${m.ts}${m.label}`}
              yAxisId="p"
              x={m.ts}
              stroke="var(--ink)"
              strokeDasharray={bracketTs.has(m.ts) ? undefined : "4 3"}
              label={{ value: m.label, position: "top", fill: "var(--ink)", fontSize: 12, fontFamily: "var(--font-mono)" }}
            />
          ))}
          <Line yAxisId="a" dataKey="actual" stroke={color} strokeWidth={3.5} strokeLinecap="round" dot={false} isAnimationActive={false} />
          <Line yAxisId="p" dataKey="forecast" stroke="var(--ultra)" strokeWidth={3} strokeDasharray="7 5" strokeLinecap="round" dot={false} connectNulls={false} isAnimationActive={false} />
          <Tooltip content={(p) => <Tip {...p} end={end} host={host} />} cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
