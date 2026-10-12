"use client";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { AXIS_TICK, ChartLegend, ReadHint, Takeaway, TipBox } from "@/components/ui/chart-kit";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { fmtDuration, fmtInt, fmtMs } from "@/lib/format";
import type { Live, UsageResp } from "@/lib/portal";
import { RANGE_S, sampleCurl, withinRange, type RangeId } from "@/lib/portal-view";

export type LivePoint = Live & { t: number };

const AXIS = AXIS_TICK;
const RANGES = [
  { value: "5m", label: "5 min" },
  { value: "10m", label: "10 min" },
  { value: "15m", label: "15 min" },
] as const;

type TipProps = { active?: boolean; payload?: readonly { name?: unknown; value?: unknown; color?: string }[]; label?: unknown };
function Tip({ unit, now, ...p }: TipProps & { unit: "ms" | "req"; now: number }) {
  if (!p.active || !p.payload?.length) return null;
  const age = (now - Number(p.label)) / 1000;
  return (
    <TipBox title={age < 3 ? "now" : `−${fmtDuration(age)}`}>
      {p.payload.map((r) => (
        <div key={String(r.name)} className="flex items-center justify-between gap-4 text-[13px]">
          <span className="flex items-center gap-1.5"><span className="h-1 w-3 rounded-full" style={{ background: r.color }} aria-hidden />{String(r.name)}</span>
          <span className="num font-semibold">{unit === "ms" ? fmtMs(Number(r.value)) : `${fmtInt(Number(r.value))} / min`}</span>
        </div>
      ))}
    </TipBox>
  );
}

function Axes({ now, unit }: { now: number; unit: "ms" | "req" }) {
  return (
    <>
      <CartesianGrid stroke="var(--line)" vertical={false} />
      <XAxis
        dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickCount={4} stroke="var(--line)" tick={AXIS} tickLine={false}
        tickFormatter={(v: number) => (now - v < 3000 ? "now" : `−${fmtDuration((now - v) / 1000)}`)}
      />
      <YAxis width={56} stroke="var(--line)" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => (unit === "ms" ? `${Math.round(v)}ms` : fmtInt(v))} />
      <Tooltip content={(p: TipProps) => <Tip {...p} unit={unit} now={now} />} cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} isAnimationActive={false} />
    </>
  );
}

function CurlEmpty() {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const host = typeof window === "undefined" ? "https://your-bulkhead-host" : window.location.origin;
  const snippet = sampleCurl(host);
  return (
    <EmptyState
      title="No traffic yet — send your first request"
      help="Once your app calls Bulkhead, request rates and response times show up here within a few seconds."
      action={
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
          <code className="num max-w-full overflow-x-auto rounded-[var(--r-md)] bg-paper-2 px-3 py-2 text-[13px]">{snippet}</code>
          <Button
            size="sm" variant={done ? "lime" : "secondary"} icon={done ? <Check /> : <Copy />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(snippet);
                setDone(true);
                setTimeout(() => setDone(false), 2000);
              } catch {
                toast.error("Couldn't copy automatically. Select the command and copy it.");
              }
            }}
          >
            {done ? "Copied" : "Copy"}
          </Button>
        </div>
      }
    />
  );
}

/** Requests-per-minute (from /usage series) and response time (from the live poll buffer), same range chips. */
export function HistoryCharts({ usage, live, now }: { usage: UsageResp | null; live: LivePoint[]; now: number }) {
  const [range, setRange] = useState<RangeId>("10m");
  const series = useMemo(
    () => (usage ? usage.usage.series.map((s) => ({ t: Date.parse(s.at), requests: s.requests, rejected: s.rejected })).filter((s) => Number.isFinite(s.t)) : []),
    [usage],
  );
  const reqs = useMemo(() => withinRange(series, now, RANGE_S[range]), [series, now, range]);
  const lat = useMemo(() => withinRange(live, now, RANGE_S[range]), [live, now, range]);
  const requestTotal = reqs.reduce((n, r) => n + r.requests, 0);
  const rejectedTotal = reqs.reduce((n, r) => n + r.rejected, 0);
  const last = lat[lat.length - 1];
  const lastLat = last && last.p50_ms !== undefined && last.p99_ms !== undefined ? { p50_ms: last.p50_ms, p99_ms: last.p99_ms } : null;
  const empty = usage !== null && series.every((s) => s.requests === 0) && live.every((l) => !l.rps);

  return (
    <section id="usage-history" aria-labelledby="hist-h" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="hist-h" className="text-[28px]">How it&apos;s been going</h2>
        <Segmented aria-label="Time range" value={range} onValueChange={setRange} options={RANGES} />
      </div>
      {usage === null ? (
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-[320px]" /><Skeleton className="h-[320px]" /></div>
      ) : empty ? (
        <CurlEmpty />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card eyebrow="Traffic" title="How many requests you send" className="min-w-0 pb-4">
            <div className="flex flex-col gap-3 px-5 pt-3">
              <Takeaway tone={rejectedTotal > 0 ? "warn" : "ok"}>
                {rejectedTotal > 0
                  ? `${fmtInt(rejectedTotal)} of ${fmtInt(requestTotal)} requests were turned away to stay within your plan.`
                  : `All ${fmtInt(requestTotal)} requests in this window were served.`}
              </Takeaway>
              <div className="h-[240px]" role="img" aria-label="Requests and turned-away requests per minute">
                {reqs.length < 2 ? <Skeleton className="h-full w-full" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={reqs} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <Axes now={now} unit="req" />
                      <defs>
                        <linearGradient id="req-fill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="var(--ultra)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--ultra)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area dataKey="requests" name="requests" type="monotone" stroke="none" fill="url(#req-fill)" isAnimationActive={false} legendType="none" tooltipType="none" />
                      <Line dataKey="requests" name="requests" type="monotone" dot={false} isAnimationActive={false} stroke="var(--ultra)" strokeWidth={2.5} strokeLinecap="round" />
                      <Line dataKey="rejected" name="turned away" type="monotone" dot={false} isAnimationActive={false} stroke="var(--bad)" strokeWidth={2} strokeDasharray="6 4" strokeLinecap="round" />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ChartLegend className="mt-0" items={[{ name: "requests", color: "var(--ultra)" }, { name: "turned away", color: "var(--bad)", dash: "5 3" }]} />
              <ReadHint>Higher means more traffic. Red dashes are requests Bulkhead refused because you hit a limit.</ReadHint>
            </div>
          </Card>
          <Card eyebrow="Speed" title="How fast you get answers" className="min-w-0 pb-4">
            <div className="flex flex-col gap-3 px-5 pt-3">
              <Takeaway tone={lastLat && lastLat.p99_ms > 4 * Math.max(lastLat.p50_ms, 1) ? "warn" : "ok"}>
                {lastLat
                  ? `Half of your requests finish in ${fmtMs(lastLat.p50_ms)}; the slowest 1% take ${fmtMs(lastLat.p99_ms)}.`
                  : "Waiting for response-time samples."}
              </Takeaway>
              <div className="h-[240px]" role="img" aria-label="Median, 95th and 99th percentile response time">
                {lat.length < 2 ? <Skeleton className="h-full w-full" /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={lat} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <Axes now={now} unit="ms" />
                      <Line dataKey="p50_ms" name="typical (p50)" type="monotone" dot={false} isAnimationActive={false} stroke="var(--ok)" strokeWidth={2} strokeLinecap="round" />
                      <Line dataKey="p95_ms" name="slow (p95)" type="monotone" dot={false} isAnimationActive={false} stroke="var(--warn)" strokeWidth={2} strokeLinecap="round" />
                      <Line dataKey="p99_ms" name="slowest (p99)" type="monotone" dot={false} isAnimationActive={false} stroke="var(--bad)" strokeWidth={2.5} strokeDasharray="7 5" strokeLinecap="round" />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ChartLegend className="mt-0" items={[{ name: "typical (p50)", color: "var(--ok)" }, { name: "slow (p95)", color: "var(--warn)" }, { name: "slowest (p99)", color: "var(--bad)", dash: "5 3" }]} />
              <ReadHint>Lower is better. If the red line climbs far above green, a few requests are being held up.</ReadHint>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
