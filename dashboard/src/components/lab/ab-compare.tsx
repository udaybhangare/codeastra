"use client";
import { useRef } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Image as ImageIcon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportJson, exportPng } from "@/lib/export";
import { METRICS, metricsOf, rolesOf, type RunBundle } from "@/lib/runs";
import { useUi } from "@/lib/ui";
import { Pill } from "../status";
import { cn } from "@/lib/utils";

const PALETTE = ["var(--info)", "var(--ok)", "var(--warn)", "oklch(0.75 0.12 320)", "oklch(0.8 0.1 200)", "oklch(0.7 0.1 120)"];
const isAbuser = (role?: string) => !!role && /abus|culprit|attack|rogue|noisy/i.test(role);

function tenantKeys(b: RunBundle): string[] {
  const keys = new Set<string>();
  for (const p of b.series) for (const k of Object.keys(p)) if (k !== "t" && k !== "phase") keys.add(k);
  return [...keys].sort();
}

function RunChart({ title, bundle, yMax, tone }: { title: string; bundle: RunBundle; yMax: number; tone: "bad" | "ok" }) {
  const roles = rolesOf(bundle.summary);
  const keys = tenantKeys(bundle);
  const marks: { t: number; phase: string }[] = [];
  let last = "";
  for (const p of bundle.series) {
    if (p.phase !== last) marks.push({ t: p.t, phase: p.phase });
    last = p.phase;
  }
  return (
    <section className="rounded-lg border border-border bg-card p-3" aria-label={`${title} p99 latency`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <Pill tone={tone}>{bundle.isolation === "on" ? "Isolation ON" : "Isolation OFF"}</Pill>
      </div>
      {bundle.series.length < 2 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No time series was captured for this run (dashboard was not connected while it ran). The result table below is still valid.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={bundle.series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${Math.round(v)}s`} tick={{ fontSize: 11 }} />
              <YAxis width={52} domain={[0, Math.ceil(yMax)]} tick={{ fontSize: 11 }} unit=" ms" tickFormatter={(v) => String(Math.round(v))} />
              <Tooltip formatter={(v) => `${Math.round(Number(v))} ms`} labelFormatter={(l) => `t = ${Math.round(Number(l))}s`} />
              {marks.slice(1).map((m) => (
                <ReferenceLine key={m.phase + m.t} x={m.t} stroke="var(--muted-foreground)" strokeDasharray="4 3" label={{ value: m.phase, fontSize: 11, position: "insideTopRight" }} />
              ))}
              {keys.map((k, i) => (
                <Line
                  key={k}
                  dataKey={k}
                  name={k}
                  stroke={isAbuser(roles[k]) ? "var(--bad)" : PALETTE[i % PALETTE.length]}
                  strokeDasharray={isAbuser(roles[k]) ? "5 3" : undefined}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export function AbCompare({ off, on, onReplay, canReplay }: { off: RunBundle; on: RunBundle; onReplay: () => void; canReplay: boolean }) {
  const presentation = useUi((s) => s.presentation);
  const chartsRef = useRef<HTMLDivElement>(null);
  const mOff = metricsOf(off.summary);
  const mOn = metricsOf(on.summary);
  const rows = METRICS.filter((m) => m.key in mOff || m.key in mOn);
  const yMax = Math.max(1, ...[off, on].flatMap((b) => b.series.flatMap((p) => Object.entries(p).filter(([k, v]) => k !== "t" && typeof v === "number").map(([, v]) => v as number))));
  const big = METRICS[0];
  const seed = on.seed ?? off.seed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-medium">
          {off.scenario} — isolation OFF vs ON{seed !== undefined && <span className="ml-2 font-mono text-sm text-muted-foreground">seed {seed}</span>}
        </h2>
        <Button variant="outline" size="sm" onClick={onReplay} disabled={!canReplay} title={canReplay ? undefined : "Needs a live backend"}>
          <RotateCcw aria-hidden />Replay seed
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportJson({ version: 1, scenario: off.scenario, seed, off, on })}>
          <Download aria-hidden />Export JSON
        </Button>
        <Button variant="outline" size="sm" onClick={() => chartsRef.current && exportPng(chartsRef.current, `bulkhead-${off.scenario}.png`)}>
          <ImageIcon aria-hidden />Export PNG
        </Button>
      </div>

      {big.key in mOff && big.key in mOn && (
        <div className={cn("grid grid-cols-2 gap-3", presentation && "gap-6")}>
          {[
            { label: "Without Bulkhead", v: mOff[big.key], tone: "text-bad" },
            { label: "With Bulkhead", v: mOn[big.key], tone: "text-ok" },
          ].map((x) => (
            <div key={x.label} className="rounded-lg border border-border bg-card p-4 text-center">
              <div className="text-sm text-muted-foreground">{x.label}: victim p99 inflation</div>
              <div className={cn("font-mono font-semibold tabular-nums", x.tone, presentation ? "text-8xl" : "text-5xl")}>{big.fmt(x.v)}</div>
            </div>
          ))}
        </div>
      )}

      <div ref={chartsRef} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RunChart title="Isolation OFF" bundle={off} yMax={yMax} tone="bad" />
        <RunChart title="Isolation ON" bundle={on} yMax={yMax} tone="ok" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className={cn("w-full", presentation ? "text-lg" : "text-sm")}>
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Metric</th><th className="px-3 py-2">OFF</th><th className="px-3 py-2">ON</th></tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const a = mOff[m.key];
              const b = mOn[m.key];
              const better = m.better !== "none" && a !== undefined && b !== undefined && a !== b && (m.better === "lower" ? b < a : b > a);
              return (
                <tr key={m.key} className="border-t border-border">
                  <td className="px-3 py-2">{m.label}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{a === undefined ? "—" : m.fmt(a)}</td>
                  <td className={cn("px-3 py-2 font-mono tabular-nums", better && "text-ok")}>{b === undefined ? "—" : m.fmt(b)}{better && <span className="sr-only"> (better)</span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">The run reported no summary metrics.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
