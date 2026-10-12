"use client";
import { useRef, useState } from "react";
import { FlaskConical, FolderOpen, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { liveApi } from "@/lib/api";
import { SCENARIOS } from "@/lib/scenarios";
import { useLab } from "@/lib/lab";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { isBundleFile } from "@/lib/runs";
import { Pill } from "../status";
import { AbCompare } from "./ab-compare";
import { cn } from "@/lib/utils";

function Progress() {
  const run = useStream((s) => s.run);
  const status = useLab((s) => s.status);
  if (status !== "running-off" && status !== "running-on") return null;
  const pct = run && run.total_s > 0 ? Math.min(100, (run.elapsed_s / run.total_s) * 100) : 0;
  return (
    <div role="status" className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Run {status === "running-off" ? "1/2: isolation OFF" : "2/2: isolation ON"}
        {run ? ` — ${run.phase} phase, ${Math.round(run.elapsed_s)}s of ${Math.round(run.total_s)}s` : " — starting…"}
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-info transition-[width]" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function ScenarioLab() {
  const presentation = useUi((s) => s.presentation);
  const { status, error, off, on, source, start, load, scenario: active } = useLab();
  const [seeds, setSeeds] = useState<Record<string, string>>({});
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = status === "running-off" || status === "running-on";

  const seedOf = (id: string) => Number(seeds[id] ?? SCENARIOS.find((s) => s.id === id)?.defaultSeed ?? 42) || 0;
  const durOf = (id: string) => Math.max(0, Math.floor(Number(durations[id] ?? 0)) || 0);

  const loadRecorded = async (id: string) => {
    setNotice(null);
    try {
      const res = await fetch(`/recorded/${id}.json`);
      const body = res.ok ? await res.json() : null;
      if (isBundleFile(body)) return load(body);
    } catch {
      /* fall through to notice */
    }
    setNotice(`No recorded result for ${id} yet. Run it once against a live backend, press Export JSON, and save the file as dashboard/public/recorded/${id}.json — or pick a saved file with “Open file…”.`);
  };

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const body = JSON.parse(await f.text());
      if (isBundleFile(body)) {
        setNotice(null);
        return load(body);
      }
    } catch {
      /* fall through */
    }
    setNotice("That file isn't a Bulkhead A/B export (expected the JSON from “Export JSON”).");
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="mr-auto text-lg font-medium">Scenario Lab</h1>
        {!liveApi && <Pill tone="info"><FlaskConical className="size-3.5" aria-hidden />Mock mode: runs need a live backend</Pill>}
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => openFile(e.target.files?.[0])} aria-label="Open recorded result file" />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><FolderOpen aria-hidden />Open file…</Button>
      </div>

      {!presentation && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {SCENARIOS.map((s) => (
            <article key={s.id} className={cn("flex flex-col gap-2 rounded-lg border bg-card p-3", active === s.id && status !== "idle" ? "border-info/60" : "border-border")}>
              <h2 className="font-medium"><span className="mr-2 font-mono text-xs text-muted-foreground">{s.id}</span>{s.name}</h2>
              <p className="text-sm">{s.attack}</p>
              <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Expected: </span>{s.expected}</p>
              <p className="text-xs text-muted-foreground">Pass if: {s.assertion}</p>
              <div className="mt-auto flex flex-wrap items-end gap-2 pt-1">
                <label className="flex flex-col text-xs text-muted-foreground">Seed
                  <input inputMode="numeric" className="h-7 w-20 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground" value={seeds[s.id] ?? String(s.defaultSeed)} onChange={(e) => setSeeds({ ...seeds, [s.id]: e.target.value })} />
                </label>
                <label className="flex flex-col text-xs text-muted-foreground">Duration (s)
                  <input inputMode="numeric" placeholder="default" className="h-7 w-20 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground" value={durations[s.id] ?? ""} onChange={(e) => setDurations({ ...durations, [s.id]: e.target.value })} />
                </label>
                <Button size="sm" disabled={!liveApi || running} onClick={() => { setNotice(null); start(s.id, seedOf(s.id), durOf(s.id)); }}>
                  <Play aria-hidden />Run A/B
                </Button>
                <Button size="sm" variant="ghost" onClick={() => loadRecorded(s.id)}>Load recorded</Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Progress />
      {status === "error" && <div role="alert" className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">Run failed: {error}. Isolation was set back to ON. You can still use “Load recorded”.</div>}
      {notice && <div role="status" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{notice}</div>}
      {status === "running-on" && off && <p className="text-sm text-muted-foreground">OFF run finished; waiting for the ON run to produce the comparison.</p>}

      {off && on ? (
        <AbCompare
          off={off}
          on={on}
          canReplay={liveApi && !running && !!active}
          onReplay={() => active && start(active, on.seed ?? off.seed ?? seedOf(active), 0)}
        />
      ) : (
        status === "idle" && !notice && (
          <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
            Pick a scenario and press <strong>Run A/B</strong>: Bulkhead runs it twice with the same seed (isolation OFF, then ON) and shows both side by side.
            {source === undefined && !liveApi && " Without a backend, use “Load recorded”."}
          </div>
        )
      )}
    </div>
  );
}
