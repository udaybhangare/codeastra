"use client";
import { usePoll } from "@/lib/use-poll";
import { Pill } from "../status";
import { ErrorNote, PageFrame, Panel } from "./page-frame";

interface PredictorState {
  healthy: boolean;
  model: string;
  requests: number;
  tenants_cached: number;
  accuracy?: Record<string, number>;
  client?: { source: string; calls: number; errors: number; fallbacks: number; avg_latency_ms: number; last_latency_ms: number; cached_uses: number };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-xl tabular-nums">{value}</div>
    </div>
  );
}

export function Predictor() {
  const { data: p, error, loading } = usePoll<PredictorState>("/admin/predictor", 3000);
  const c = p?.client;
  const usingFallback = !!c && c.source !== "sidecar" && c.source !== "model";
  return (
    <PageFrame title="Predictor" subtitle="Advisory early-warning model. It never blocks requests: if it is down, reactive detection takes over (docs/07).">
      <ErrorNote error={error} />
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {p && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={p.healthy ? "ok" : "bad"}>{p.healthy ? "Healthy" : "Unhealthy"}</Pill>
            <Pill tone="info">Model: {p.model}</Pill>
            <Pill tone={usingFallback ? "warn" : "ok"}>Source: {c?.source ?? "unknown"}</Pill>
          </div>
          {usingFallback && (
            <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              Forecasts are coming from the in-process fallback, not the ML sidecar ({c?.errors ?? 0} sidecar errors of {c?.calls ?? 0} calls). Detection still works; check the predictor container.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Requests served" value={String(p.requests)} />
            <Stat label="Tenants tracked" value={String(p.tenants_cached)} />
            <Stat label="Sidecar calls" value={String(c?.calls ?? 0)} />
            <Stat label="Sidecar errors" value={String(c?.errors ?? 0)} />
            <Stat label="Fallbacks used" value={String(c?.fallbacks ?? 0)} />
            <Stat label="Cached answers used" value={String(c?.cached_uses ?? 0)} />
            <Stat label="Avg latency" value={`${(c?.avg_latency_ms ?? 0).toFixed(2)} ms`} />
            <Stat label="Last latency" value={`${(c?.last_latency_ms ?? 0).toFixed(2)} ms`} />
          </div>
          <Panel title="Accuracy">
            {p.accuracy && Object.keys(p.accuracy).length > 0 ? (
              <dl className="grid grid-cols-2 gap-2 font-mono text-sm md:grid-cols-4">
                {Object.entries(p.accuracy).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd>{typeof v === "number" ? v.toFixed(3) : String(v)}</dd></div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No accuracy data yet. Evaluation uses simulated traces (docs/07, docs/RESULTS §6 Q9).</p>
            )}
          </Panel>
        </>
      )}
    </PageFrame>
  );
}
