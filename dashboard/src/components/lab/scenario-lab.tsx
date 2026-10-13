"use client";
import { useRef, useState } from "react";
import { FlaskConical, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PageFrame } from "@/components/shell/page-frame";
import { liveApi } from "@/lib/api";
import { useLab, type LabMode } from "@/lib/lab";
import { isBundleFile } from "@/lib/runs";
import { SCENARIOS } from "@/lib/scenarios";
import { useUi } from "@/lib/ui";
import { AbCompare } from "./ab-compare";
import { ProcessSimPanel } from "./process-sim";
import { RunPanel } from "./run-panel";
import { ScenarioCard } from "./scenario-card";

export function ScenarioLab() {
  const presentation = useUi((s) => s.presentation);
  const { status, error, off, on, start, load, scenario: active, seed: labSeed } = useLab();
  const [selected, setSelected] = useState(active ?? SCENARIOS[0].id);
  const [seed, setSeed] = useState(labSeed);
  const [durationS, setDurationS] = useState(12);
  const [mode, setMode] = useState<LabMode>("ab");
  const [notice, setNotice] = useState<string | null>(null);
  const [sim, setSim] = useState<{ id: string; n: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = status === "running-off" || status === "running-on";
  const info = SCENARIOS.find((s) => s.id === selected) ?? SCENARIOS[0];
  const hasResult = !!(off || on);

  const select = (id: string) => {
    if (running || id === selected) return;
    setSelected(id);
    setSim(null);
    setSeed(SCENARIOS.find((s) => s.id === id)?.defaultSeed ?? 42);
  };

  const loadRecorded = async () => {
    setNotice(null);
    try {
      const res = await fetch(`/recorded/${selected}.json`);
      const body = res.ok ? await res.json() : null;
      if (isBundleFile(body)) {
        setSeed(body.seed ?? seed);
        return load(body);
      }
    } catch {
      /* fall through to notice */
    }
    setNotice(
      `No recorded result for ${selected} yet. Run it once against a live backend, press Export JSON, and save the file as dashboard/public/recorded/${selected}.json — or pick a saved file with “Open file…”.`,
    );
  };

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const body = JSON.parse(await f.text());
      if (isBundleFile(body)) {
        setNotice(null);
        if (SCENARIOS.some((s) => s.id === body.scenario)) setSelected(body.scenario);
        return load(body);
      }
    } catch {
      /* fall through */
    }
    setNotice("That file isn't a Bulkhead A/B export (expected the JSON from “Export JSON”).");
  };

  const run = () => {
    setNotice(null);
    setSim((s) => ({ id: selected, n: (s?.n ?? 0) + 1 }));
    if (liveApi) start(selected, seed, durationS, mode);
  };

  const focusResult = presentation && hasResult;

  return (
    <PageFrame
      subtitle="Pick an attack, run it with isolation OFF and ON on the same seed, and watch the difference."
      actions={
        <>
          {!liveApi && (
            <Badge tone="predict" icon={<FlaskConical aria-hidden />}>
              Mock mode: runs need a live backend
            </Badge>
          )}
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => openFile(e.target.files?.[0])} aria-label="Open recorded result file" />
          <Button variant="secondary" size="sm" icon={<FolderOpen aria-hidden />} onClick={() => fileRef.current?.click()}>
            Open file…
          </Button>
        </>
      }
      className="items-start"
    >
      {!focusResult && (
        <div className="col-span-12 grid grid-cols-12 items-start gap-6">
          <div className="col-span-12 grid grid-cols-1 items-start gap-4 min-[900px]:col-span-8 min-[900px]:grid-cols-2">
            {SCENARIOS.map((s) => (
              <ScenarioCard key={s.id} scenario={s} selected={s.id === selected} seed={s.id === selected ? seed : s.defaultSeed} onSelect={() => select(s.id)} />
            ))}
          </div>
          <div className="col-span-12 min-[900px]:sticky min-[900px]:top-4 min-[900px]:col-span-4">
            <RunPanel
              scenario={info}
              seed={seed}
              onSeed={setSeed}
              durationS={durationS}
              onDuration={setDurationS}
              mode={mode}
              onMode={setMode}
              status={status}
              live={liveApi}
              onRun={run}
              onLoadRecorded={loadRecorded}
              onOpenFile={() => fileRef.current?.click()}
              onSimulate={() => setSim((s) => ({ id: selected, n: (s?.n ?? 0) + 1 }))}
            />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="col-span-12">
          <ErrorState message={`Run failed: ${error}. Isolation was set back to ON. You can still load a recorded result.`} />
        </div>
      )}
      {notice && (
        <div role="status" className="col-span-12 rounded-[var(--r-md)] border border-warn bg-warn-100 px-4 py-3 text-[15px] text-warn-ink">
          {notice}
        </div>
      )}
      {status === "running-on" && off && mode === "ab" && (
        <p className="col-span-12 text-[15px] text-ink-2">OFF run finished; waiting for the ON run to produce the comparison.</p>
      )}

      {sim && sim.id === selected && !focusResult && (
        <div className="col-span-12">
          <ProcessSimPanel
            key={`${sim.id}-${seed}-${sim.n}`}
            scenarioId={sim.id}
            scenarioName={info.name}
            seed={seed}
            runSeconds={liveApi && durationS > 0 ? durationS * (mode === "ab" ? 2 : 1) : 0}
          />
        </div>
      )}

      <div className="col-span-12">
        {hasResult ? (
          <AbCompare
            key={`${off?.run_id ?? "-"}|${on?.run_id ?? "-"}`}
            off={off}
            on={on}
            canReplay={liveApi && !running && !!active}
            onReplay={() => active && start(active, (on ?? off)?.seed ?? seed, 0, mode)}
          />
        ) : (
          status === "idle" &&
          !notice &&
          !sim && (
            <EmptyState
              title="No comparison yet"
              help={`Pick a scenario and press Run A/B: Bulkhead runs it twice with the same seed (isolation OFF, then ON) and shows both side by side.${liveApi ? "" : " Without a backend, use “Load recorded results”."}`}
            />
          )
        )}
      </div>
    </PageFrame>
  );
}
