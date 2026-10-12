"use client";
import { CheckCircle2, CircleOff, Cpu, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { liveApi } from "@/lib/api";
import { tenantColor } from "@/lib/colors";
import { fmtInt, fmtNum } from "@/lib/format";
import { alertSpans, analyzeAlerts, featureBars, MODEL_LABEL, modelId, seriesFor, type Target } from "@/lib/predictor";
import { useStream } from "@/lib/store";
import { useForecastHistory } from "@/lib/use-forecast-history";
import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/utils";
import { ChartLegend, Takeaway } from "../ui/chart-kit";
import { PageFrame } from "../shell/page-frame";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { EmptyState, ErrorState } from "../ui/states";
import { FeatureBars } from "./feature-bars";
import { ForecastChart } from "./forecast-chart";
import { LeadTimeBars } from "./lead-time-bars";

interface PredictorState {
  healthy: boolean;
  model: string;
  requests?: number;
  tenants_cached?: number;
  accuracy?: Record<string, number>;
  /** Optional: only rendered when the predictor API provides it. */
  importance?: Record<string, number>;
  feature_importance?: Record<string, number>;
  client?: { source: string; calls: number; errors: number; fallbacks: number; avg_latency_ms: number; last_latency_ms: number; cached_uses: number };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface px-4 py-3">
      <div className="text-[13px] font-semibold tracking-[0.02em] text-ink-2">{label}</div>
      <div className="num text-[20px] font-medium">{value}</div>
    </div>
  );
}

export function Predictor() {
  const { data: p, error, loading } = usePoll<PredictorState>("/admin/predictor", 3000);
  const buf = useForecastHistory();
  const events = useStream((s) => s.events);
  const tenantIds = useStream((s) => s.tenantIds);
  const [pick, setPick] = useState<Target>("host");
  const target: Target = pick === "host" || tenantIds.includes(pick) ? pick : "host";

  const rows = useMemo(() => seriesFor(buf, target), [buf, target]);
  const stats = useMemo(() => analyzeAlerts(buf, events, tenantIds), [buf, events, tenantIds]);
  const spans = useMemo(() => alertSpans(rows), [rows]);
  const start = rows[0]?.ts ?? 0;
  const leads = target === "host" ? [] : stats.leads.filter((l) => l.tenant === target && l.eventTs >= start);
  const markers = events
    .filter((e) => e.kind === "throttle" && e.to_level !== undefined && e.from_level !== undefined && e.to_level > e.from_level && (target === "host" || e.tenant_id === target))
    .map((e) => ({ ts: Date.parse(e.ts), label: `L${e.from_level}→L${e.to_level}` }))
    .filter((m) => m.ts >= start && Number.isFinite(m.ts));

  const model = modelId(p?.model);
  const c = p?.client;
  const usingFallback = !!c && c.source !== "sidecar" && c.source !== "model";
  const offline = liveApi && !loading && (!!error || (p ? !p.healthy : false));
  const hasForecast = rows.some((r) => r.forecast !== undefined);
  const bars = featureBars(p?.importance ?? p?.feature_importance);
  const latestRisk = [...rows].reverse().find((r) => r.forecast !== undefined)?.forecast;
  const riskPct = latestRisk === undefined ? null : Math.round(latestRisk * 100);
  const color = target === "host" ? "var(--ink)" : tenantColor(target);

  const status = !liveApi ? (
    <Badge tone="neutral" icon={<Server />}>Simulated stream · model status needs the live backend</Badge>
  ) : loading ? null : (
    <>
      <Badge tone={p?.healthy ? "ok" : "bad"} icon={p?.healthy ? <CheckCircle2 /> : <CircleOff />}>{p?.healthy ? "Up" : "Down"}</Badge>
      <Badge tone="predict" icon={<Cpu />}>{model ? MODEL_LABEL[model] : "Model unknown"}</Badge>
      {c ? <Badge tone={usingFallback ? "warn" : "neutral"}>Source: {c.source}</Badge> : null}
    </>
  );

  return (
    <PageFrame
      subtitle="Advisory early warning: forecast overload probability next to what actually happened. It never blocks requests; if it is down, reactive detection takes over."
      actions={status}
    >
      {offline ? (
        <div className="col-span-12">
          <EmptyState
            title="Predictor sidecar offline"
            help="The detector falls back to its own baseline, so protection continues. Live forecasts below come from whatever the stream carries."
          />
        </div>
      ) : null}
      {error && !p && liveApi ? <div className="col-span-12"><ErrorState message={`Could not load predictor status: ${error}`} /></div> : null}
      {usingFallback ? (
        <div className="col-span-12 rounded-[var(--r-md)] bg-warn-100 px-4 py-3 text-[15px] font-medium text-warn-ink">
          Forecasts come from the in-process fallback, not the ML sidecar ({c?.errors ?? 0} sidecar errors of {c?.calls ?? 0} calls). Detection still works; check the predictor container.
        </div>
      ) : null}

      <Card className="col-span-12" eyebrow={`Forecast vs. reality · ${target === "host" ? "whole server" : target}`} title="Is trouble coming?">
        <div className="p-5 pt-3">
          <div role="radiogroup" aria-label="Forecast target" className="mb-4 flex flex-wrap gap-2">
            {(["host", ...tenantIds] as Target[]).map((t) => {
              const on = t === target;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPick(t)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border-2 px-4 text-[13px] font-semibold outline-none focus-visible:shadow-[var(--ring)]",
                    on ? "border-ink bg-ultra-100 text-ultra-600" : "border-line bg-surface text-ink-2 hover:bg-paper-2",
                  )}
                >
                  <span className="size-2.5 rounded-full" style={{ background: t === "host" ? "var(--ink)" : tenantColor(t) }} aria-hidden />
                  {t === "host" ? "Host" : t}
                </button>
              );
            })}
          </div>
          {rows.length < 2 ? (
            <Skeleton className="h-[340px] w-full" />
          ) : (
            <>
              {riskPct === null ? null : (
                <Takeaway tone={riskPct >= 60 ? "bad" : riskPct >= 30 ? "warn" : "ok"} className="mb-3">
                  {riskPct >= 60
                    ? `${riskPct}% chance ${target === "host" ? "the host" : target} gets overloaded soon. Bulkhead is already acting on it.`
                    : riskPct >= 30
                      ? `${riskPct}% chance of overload. Worth watching, no action needed yet.`
                      : `${riskPct}% chance of overload. All clear.`}
                </Takeaway>
              )}
              <ForecastChart rows={rows} color={color} host={target === "host"} spans={spans} leads={leads} markers={markers} />
              <ChartLegend
                items={[
                  { name: `Actual ${target === "host" ? "CPU" : "p99 latency"}`, color },
                  ...(hasForecast ? [{ name: "Predicted overload risk", color: "var(--ultra)", dash: "5 3", note: "right axis" }] : []),
                ]}
              />
              <p className="mt-2 text-[13px] text-ink-2">
                {hasForecast
                  ? "When the dashed line enters the shaded zone (60%+), the predictor is warning that this tenant is about to hurt others. Vertical lines show where Bulkhead stepped in; the bar shows how many seconds early the warning came."
                  : "The stream carries no forecast values right now (predictor idle or offline), so only the actual line is drawn."}
              </p>
            </>
          )}
        </div>
      </Card>

      <Card className="col-span-12 lg:col-span-7" eyebrow="Early warning" title="How many seconds of notice did we get?">
        <div className="p-5 pt-3">
          <LeadTimeBars active={model} stats={stats} />
          {stats.unwarned > 0 ? <p className="mt-3 text-[13px] text-ink-2">{stats.unwarned} escalation(s) happened with no prior forecast alert.</p> : null}
        </div>
      </Card>

      <Card className="col-span-12 lg:col-span-5" eyebrow="Why it thinks so" title="What drives the forecast">
        <div className="p-5 pt-3">
          {bars.length ? (
            <FeatureBars bars={bars} />
          ) : (
            <p className="text-[15px] text-ink-2">The predictor API does not report feature importances yet, so nothing is shown rather than guessing. They will appear here once <span className="num">/admin/predictor</span> includes them.</p>
          )}
        </div>
      </Card>

      {c ? (
        <div className="col-span-12 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Requests served" value={fmtInt(p?.requests ?? 0)} />
          <Stat label="Tenants tracked" value={fmtInt(p?.tenants_cached ?? 0)} />
          <Stat label="Sidecar calls / errors" value={`${fmtInt(c.calls)} / ${fmtInt(c.errors)}`} />
          <Stat label="Fallbacks used" value={fmtInt(c.fallbacks)} />
          <Stat label="Cached answers used" value={fmtInt(c.cached_uses)} />
          <Stat label="Avg latency" value={`${fmtNum(c.avg_latency_ms, 2)} ms`} />
          <Stat label="Last latency" value={`${fmtNum(c.last_latency_ms, 2)} ms`} />
          {p?.accuracy
            ? Object.entries(p.accuracy).map(([k, v]) => <Stat key={k} label={`Accuracy · ${k}`} value={typeof v === "number" ? fmtNum(v, 3) : String(v)} />)
            : null}
        </div>
      ) : null}
    </PageFrame>
  );
}
