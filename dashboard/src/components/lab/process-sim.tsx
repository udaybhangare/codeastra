"use client";
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { levelTone, tenantColor } from "@/lib/colors";
import { DURATION_S, ProcessSim, summarize, type SimState } from "@/lib/process-sim";
import type { Isolation } from "@/lib/ws-types";
import { cn } from "@/lib/utils";

const SLOTS = 24;
const SPEEDS = [
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "4", label: "4×" },
] as const;

/** Worker-pool slots coloured by each tenant's share of the CPU actually granted. */
function slotsFor(s: SimState): (string | null)[] {
  const total = s.tenants.reduce((a, t) => a + t.cpu, 0);
  const slots: (string | null)[] = [];
  if (total > 0) {
    const used = Math.min(1, s.host.cpu) * SLOTS;
    for (const t of s.tenants) {
      const n = Math.round((t.cpu / total) * used);
      for (let i = 0; i < n && slots.length < SLOTS; i++) slots.push(t.id);
    }
  }
  while (slots.length < SLOTS) slots.push(null);
  return slots;
}

function Gauge({ label, value }: { label: string; value: number }) {
  const tone = value > 1 ? "var(--bad)" : value >= 0.7 ? "var(--warn)" : "var(--ok)";
  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex justify-between text-xs text-ink-2">
        <span>{label}</span>
        <span className="num">{Math.round(value * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-paper-2">
        <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${Math.min(100, value * 100)}%`, background: tone }} />
      </div>
    </div>
  );
}

function Pane({ state, title }: { state: SimState; title: string }) {
  const on = state.isolation === "on";
  const slots = useMemo(() => slotsFor(state), [state]);
  const events = state.events.slice(-5).reverse();
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-4 rounded-[var(--r-lg)] border-2 border-ink bg-surface p-4">
      <header className="flex items-center justify-between">
        <h3 className="text-[17px]">{title}</h3>
        <Badge tone={on ? "ok" : "bad"} dot>
          {on ? "Bulkhead ON" : "Shared pool"}
        </Badge>
      </header>

      <div>
        <div className="mb-1.5 text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">Worker pool</div>
        <div className="grid grid-cols-12 gap-1" aria-hidden>
          {slots.map((id, i) => (
            <span key={i} className="h-5 rounded-[4px] transition-colors duration-100" style={{ background: id ? tenantColor(id) : "var(--line)" }} />
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Gauge label="CPU" value={state.host.cpu} />
        <Gauge label="DB conns" value={state.host.db} />
        <Gauge label="Bandwidth" value={state.host.bw} />
        <Gauge label="Memory" value={state.host.mem} />
      </div>

      <ul className="flex flex-col gap-1.5">
        {state.tenants.map((t) => {
          const infl = t.p99Ms / t.baselineP99Ms;
          const lv = levelTone(t.level);
          return (
            <li key={t.id} className={cn("flex items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 text-[14px]", t.role === "abuser" ? "bg-bad-100/60" : "bg-paper-2/60")}>
              <span className="size-3 shrink-0 rounded-full" style={{ background: tenantColor(t.id) }} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{t.id}</span>
              {t.down ? (
                <Badge tone="bad">DOWN</Badge>
              ) : (
                <>
                  {on && t.level > 0 ? (
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: lv.tint, color: lv.ink }}>
                      L{t.level} {lv.name}
                    </span>
                  ) : null}
                  <span className="num w-[76px] text-right text-ink-2">
                    {Math.round(t.servedRps)}/{Math.round(t.arrivalRps)} rps
                  </span>
                  <span className="num w-[54px] text-right text-ink-2">q {Math.round(t.queue)}</span>
                  <span className={cn("num w-[74px] text-right font-semibold", infl > 2 ? "text-bad-ink" : infl > 1.3 ? "text-warn-ink" : "text-ok-ink")}>
                    {t.p99Ms >= 1000 ? `${(t.p99Ms / 1000).toFixed(1)} s` : `${Math.round(t.p99Ms)} ms`}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <ul className="flex min-h-[84px] flex-col gap-1 border-t border-line pt-3 text-[13px]" aria-live="off">
        {events.length === 0 ? <li className="text-ink-2">Nothing notable yet.</li> : null}
        {events.map((e, i) => (
          <li key={`${e.tS}-${i}`} className={cn("truncate", e.tone === "bad" ? "text-bad-ink" : e.tone === "warn" ? "text-warn-ink" : "text-ink-2")}>
            <span className="num">{e.tS.toFixed(1)}s</span> · {e.tenant}: {e.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface ProcessSimPanelProps {
  scenarioId: string;
  scenarioName: string;
  seed: number;
  /** Expected wall-clock length of a paired backend run (0 = none); picks the initial speed. */
  runSeconds?: number;
}

/** Side-by-side live simulation: same seed, isolation OFF vs ON. A stylised model, not a backend run. */
export function ProcessSimPanel({ scenarioId, scenarioName, seed, runSeconds = 0 }: ProcessSimPanelProps) {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<"1" | "2" | "4">(() => {
    if (runSeconds <= 0) return "2";
    const want = DURATION_S / runSeconds;
    return want >= 3 ? "4" : want >= 1.5 ? "2" : "1";
  });
  const make = () => ({ off: new ProcessSim(scenarioId, seed, "off" as Isolation), on: new ProcessSim(scenarioId, seed, "on" as Isolation) });
  const [pair, setPair] = useState(make);
  const [view, setView] = useState(() => ({ off: pair.off.snapshot(), on: pair.on.snapshot() }));
  const restart = () => {
    const next = make();
    setPair(next);
    setView({ off: next.off.snapshot(), on: next.on.snapshot() });
    setPlaying(true);
  };

  // Real-time loop: wall-clock delta from rAF is injected into the pure sim.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const mult = Number(speed);
    const frame = (ts: number) => {
      if (last !== null) {
        const dt = Math.min(100, ts - last) * mult;
        pair.off.step(dt);
        pair.on.step(dt);
        setView({ off: pair.off.snapshot(), on: pair.on.snapshot() });
        if (pair.off.done && pair.on.done) {
          setPlaying(false);
          return;
        }
      }
      last = ts;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, pair]);

  const done = view.off.done && view.on.done;
  const so = summarize(view.off);
  const sn = summarize(view.on);
  const pct = Math.min(100, (view.on.tS / view.on.durationS) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px]">Live simulation · {scenarioName}</h2>
          <p className="text-[14px] text-ink-2">Illustrative model, same seed on both sides. Not a backend run: use A/B for real measurements.</p>
        </div>
        <Segmented<"1" | "2" | "4"> aria-label="Simulation speed" value={speed} onValueChange={setSpeed} options={SPEEDS} />
        <Button variant="secondary" size="sm" icon={playing ? <Pause aria-hidden /> : <Play aria-hidden />} onClick={() => (done ? restart() : setPlaying((p) => !p))}>
          {done ? "Replay" : playing ? "Pause" : "Resume"}
        </Button>
        <Button variant="ghost" size="sm" icon={<RotateCcw aria-hidden />} onClick={restart}>
          Restart
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <span className="num w-[110px] text-sm text-ink-2">
          {view.on.tS.toFixed(1)} / {view.on.durationS}s · {view.on.phase}
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Simulation progress">
          <div className="h-full rounded-full bg-ultra" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
        <Pane state={view.off} title="Isolation OFF" />
        <Pane state={view.on} title="Isolation ON" />
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-[var(--r-lg)] border-2 border-ink bg-paper-2 p-4 min-[700px]:grid-cols-4">
        <Stat label="Worst victim p99" off={`${so.victimInflation.toFixed(1)}×`} on={`${sn.victimInflation.toFixed(1)}×`} />
        <Stat label="Victim errors" off={String(so.victimErrors)} on={String(sn.victimErrors)} />
        <Stat label="Victims OOM-killed" off={String(so.victimKills)} on={String(sn.victimKills)} />
        <Stat label="Wrongly throttled" off="n/a" on={String(sn.falsePositives)} />
      </dl>
    </div>
  );
}

function Stat({ label, off, on }: { label: string; off: string; on: string }) {
  return (
    <div>
      <dt className="text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">{label}</dt>
      <dd className="num mt-1 text-[18px]">
        <span className="text-bad-ink">{off}</span> <span className="text-ink-2">→</span> <span className="text-ok-ink">{on}</span>
      </dd>
    </div>
  );
}
