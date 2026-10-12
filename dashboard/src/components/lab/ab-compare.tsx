"use client";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Download, Equal, Image as ImageIcon, RotateCcw, ShieldCheck, ShieldOff, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AXIS_TICK, ChartLegend, ReadHint } from "@/components/ui/chart-kit";
import { Button } from "@/components/ui/button";
import { bigRatio, changeLabel, deltaRows, phaseMarks, sharedYMax, verdict } from "@/lib/ab";
import { tenantColor } from "@/lib/colors";
import { exportJson, exportPng } from "@/lib/export";
import { fadeUp, popIn, stagger, useReducedMotionSafe } from "@/lib/motion";
import { metricsOf, rolesOf, type RunBundle } from "@/lib/runs";
import { SCENARIOS } from "@/lib/scenarios";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Confetti } from "./confetti";

const isAbuser = (role?: string) => !!role && /abus|culprit|attack|rogue|noisy/i.test(role);

function tenantKeys(b: RunBundle): string[] {
  const keys = new Set<string>();
  for (const p of b.series) for (const k of Object.keys(p)) if (k !== "t" && k !== "phase") keys.add(k);
  return [...keys].sort();
}

/** Counts 0 → value once on first reveal (runaway "not reached" sentinels are shown as-is). */
function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduced = useReducedMotionSafe();
  const skip = reduced || value >= 9999;
  const mv = useMotionValue(skip ? value : 0);
  const text = useTransform(mv, (n) => format(n));
  useEffect(() => {
    if (skip) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, skip, mv]);
  return <motion.span className={cn("num inline-block tabular-nums", className)}>{text}</motion.span>;
}

function Hero({ label, value, side, big }: { label: string; value?: number; side: "on" | "off"; big: boolean }) {
  const ok = side === "on";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border-2 border-ink p-5 text-center",
        ok ? "bg-ok-100 shadow-[var(--shadow-pop)]" : "bg-bad-100",
      )}
    >
      <div className={cn("flex items-center gap-1.5 text-[13px] font-semibold tracking-[0.02em] uppercase", ok ? "text-ok-ink" : "text-bad-ink")}>
        {ok ? <ShieldCheck className="size-4" aria-hidden /> : <ShieldOff className="size-4" aria-hidden />}
        {label}
      </div>
      <div className={cn("num leading-none font-semibold text-ink", big ? "text-[clamp(64px,9vw,120px)]" : "text-[56px]")}>
        {value === undefined ? "—" : <CountUp value={value} format={bigRatio} />}
      </div>
      <div className={cn("text-ink-2", big ? "text-xl" : "text-[13px]")}>victim p99 latency vs. baseline</div>
    </div>
  );
}

function RunChart({ bundle, yMax, roles }: { bundle: RunBundle; yMax: number; roles: Record<string, string> }) {
  const keys = tenantKeys(bundle);
  const on = bundle.isolation === "on";
  return (
    <section className="flex flex-col rounded-[var(--r-lg)] border border-line bg-surface p-4 shadow-[var(--shadow-1)]" aria-label={`Isolation ${on ? "ON" : "OFF"} p99 latency`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[18px]">{on ? "With Bulkhead: how slow did victims get?" : "Without Bulkhead: how slow did victims get?"}</h3>
        <Badge tone={on ? "ok" : "bad"} icon={on ? <ShieldCheck aria-hidden /> : <ShieldOff aria-hidden />}>
          {on ? "ON" : "OFF"}
        </Badge>
      </div>
      {bundle.series.length < 2 ? (
        <p className="py-16 text-center text-[15px] text-ink-2">
          No time series was captured for this run (the dashboard was not connected while it ran). The numbers are still valid.
        </p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={bundle.series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${Math.round(v)}s`} tick={AXIS_TICK} stroke="var(--line)" />
              <YAxis width={64} domain={[0, Math.ceil(yMax)]} tick={AXIS_TICK} tickFormatter={(v) => `${Math.round(v)}`} unit=" ms" stroke="var(--line)" />
              <Tooltip
                formatter={(v) => `${Math.round(Number(v))} ms`}
                labelFormatter={(l) => `t = ${Math.round(Number(l))} s`}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 13 }}
              />
              {phaseMarks(bundle.series).slice(1).map((m) => (
                <ReferenceLine key={m.phase + m.t} x={m.t} stroke="var(--ink-3)" strokeDasharray="4 3" label={{ value: m.phase, fontSize: 11, fill: "var(--ink-2)", position: "insideTopRight" }} />
              ))}
              {keys.map((k) => {
                const abuser = isAbuser(roles[k]);
                return (
                  <Line
                    key={k}
                    dataKey={k}
                    name={k}
                    stroke={abuser ? "var(--bad)" : tenantColor(k)}
                    strokeDasharray={abuser ? "6 3" : undefined}
                    strokeWidth={abuser ? 3 : 3}
                    dot={false}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <ChartLegend
        items={keys.map((k) => ({
          name: k,
          color: isAbuser(roles[k]) ? "var(--bad)" : tenantColor(k),
          dash: isAbuser(roles[k]) ? "5 3" : undefined,
          note: isAbuser(roles[k]) ? "noisy tenant" : undefined,
        }))}
      />
      <ReadHint>Lower is better. Time runs left to right in seconds; both charts share the same height so you can compare them directly.</ReadHint>
    </section>
  );
}

export interface AbCompareProps {
  off?: RunBundle;
  on?: RunBundle;
  onReplay: () => void;
  canReplay: boolean;
}

export function AbCompare({ off, on, onReplay, canReplay }: AbCompareProps) {
  const presentation = useUi((s) => s.presentation);
  const chartsRef = useRef<HTMLDivElement>(null);
  const mOff = off ? metricsOf(off.summary) : {};
  const mOn = on ? metricsOf(on.summary) : {};
  const both = !!off && !!on;
  const rows = deltaRows(mOff, mOn);
  const v = both ? verdict(mOff, mOn) : null;
  const seed = on?.seed ?? off?.seed;
  const scenarioId = (off ?? on)?.scenario ?? "";
  const info = SCENARIOS.find((s) => s.id === scenarioId);
  const yMax = sharedYMax([off, on].filter((b): b is RunBundle => !!b));
  const roles = { ...(off ? rolesOf(off.summary) : {}), ...(on ? rolesOf(on.summary) : {}) };
  const [celebrate, setCelebrate] = useState(v?.winner === "on");
  const headKey = "victim_p99_inflation";

  return (
    <motion.div className="flex flex-col gap-5" variants={stagger} initial="hidden" animate="show">
      {celebrate ? <Confetti onDone={() => setCelebrate(false)} /> : null}

      {!presentation && (
        <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-[28px]">
            {scenarioId}
            {info ? ` · ${info.name}` : ""}
            {seed !== undefined && <span className="num ml-3 text-sm font-medium text-ink-2">seed {seed}</span>}
          </h2>
          <Button variant="secondary" size="sm" icon={<RotateCcw aria-hidden />} onClick={onReplay} disabled={!canReplay} title={canReplay ? undefined : "Needs a live backend"}>
            Replay same seed
          </Button>
          {both && (
            <Button variant="ghost" size="sm" icon={<Download aria-hidden />} onClick={() => exportJson({ version: 1, scenario: scenarioId, seed, off, on })}>
              Export JSON
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<ImageIcon aria-hidden />} onClick={() => chartsRef.current && exportPng(chartsRef.current, `bulkhead-${scenarioId}.png`)}>
            Export PNG
          </Button>
        </motion.div>
      )}

      {v && (
        <motion.div
          variants={popIn}
          role="status"
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-full border-2 border-ink px-5 py-3",
            v.winner === "on" ? "bg-lime text-lime-ink" : v.winner === "off" ? "bg-warn-100 text-warn-ink" : "bg-paper-2 text-ink-2",
          )}
        >
          <Trophy className="size-5 shrink-0" aria-hidden />
          <span className={cn("font-semibold", presentation ? "text-2xl" : "text-[17px]")}>
            {v.winner === "on" ? "Isolation ON wins" : v.winner === "off" ? "Isolation ON did not improve this run" : "Too close to call"}
          </span>
          <span className="num text-[13px]">
            {v.onWins} metric{v.onWins === 1 ? "" : "s"} better with ON · {v.offWins} better with OFF
          </span>
        </motion.div>
      )}

      <motion.div variants={fadeUp} className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", presentation && "gap-8")}>
        <Hero label="Without Bulkhead" value={mOff[headKey]} side="off" big={presentation} />
        <Hero label="With Bulkhead" value={mOn[headKey]} side="on" big={presentation} />
      </motion.div>

      <motion.div
        variants={fadeUp}
        ref={chartsRef}
        className={cn("grid grid-cols-1 gap-4", presentation ? "lg:grid-cols-2" : "xl:grid-cols-[1fr_300px_1fr]")}
      >
        {off ? <RunChart bundle={off} yMax={yMax} roles={roles} /> : <Placeholder text="Run isolation OFF to fill this side." />}

        {!presentation && (
          <section aria-label="Metric deltas" className="order-last flex flex-col gap-1 rounded-[var(--r-lg)] border border-line bg-paper-2 p-3 xl:order-none">
            <h3 className="px-2 pt-1 pb-2 text-[18px]">Delta</h3>
            {rows.length === 0 && <p className="px-2 py-4 text-[15px] text-ink-2">The run reported no summary metrics.</p>}
            {rows.map((r) => {
              const ch = changeLabel(r.def, r.off, r.on);
              const up = r.on !== undefined && r.off !== undefined && r.on > r.off;
              const Icon = r.better === "same" || ch === null ? Equal : up ? ArrowUpRight : ArrowDownRight;
              const tone = r.better === "on" ? "ok" : r.better === "off" ? "bad" : "neutral";
              return (
                <div key={r.def.key} className="flex items-center gap-2 rounded-[var(--r-md)] bg-surface px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-ink-2">{r.def.label}</div>
                    <div className="num text-[15px] font-medium">
                      {r.off === undefined ? "—" : r.def.fmt(r.off)} <span className="text-ink-3">→</span> {r.on === undefined ? "—" : r.def.fmt(r.on)}
                    </div>
                  </div>
                  {both && (
                    <Badge tone={tone} icon={<Icon aria-hidden />} className="num h-6 px-2 text-xs">
                      {ch ?? "same"}
                      {r.better === "on" ? <span className="sr-only"> (better with ON)</span> : r.better === "off" ? <span className="sr-only"> (worse with ON)</span> : null}
                    </Badge>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {on ? <RunChart bundle={on} yMax={yMax} roles={roles} /> : <Placeholder text="Run isolation ON to fill this side." />}
      </motion.div>
    </motion.div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-[var(--r-lg)] border border-dashed border-line bg-surface p-6 text-center text-[15px] text-ink-2">
      {text}
    </div>
  );
}
