"use client";
// Throwaway demo harness for the 3D hull (docs/ui/03). Removed in U14.
import { useMemo, useState } from "react";
import { Hull } from "@/components/hull/Hull";
import type { HullMode, HullTenant } from "@/lib/hull";
import type { Level, Tier } from "@/lib/ws-types";

const TIERS: Tier[] = ["free", "pro", "enterprise", "pro", "free"];

export default function HullDemo() {
  const [count, setCount] = useState(5);
  const [usage, setUsage] = useState<number[]>([0.3, 0.45, 0.4, 0.35, 0.25, 0.3, 0.4, 0.2, 0.35, 0.3]);
  const [level, setLevel] = useState<Level[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const [isolation, setIsolation] = useState<"on" | "off">("on");
  const [mode, setMode] = useState<HullMode>("mini");
  const [scroll, setScroll] = useState(0);
  const [picked, setPicked] = useState<string | undefined>();

  const tenants: HullTenant[] = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: `tenant-${String.fromCharCode(97 + i)}`,
        tier: TIERS[i % TIERS.length],
        level: level[i],
        usage: usage[i],
        rps: 10 + usage[i] * 80,
        p99_ms: 40 + usage[i] * 400,
        pOverload: usage[i] > 0.6 ? usage[i] : undefined,
      })),
    [count, usage, level],
  );

  const box = mode === "landing" ? "fixed inset-0" : "";
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Hull demo</h1>
      <div className="card mb-6 grid gap-3 p-4 text-sm sm:grid-cols-2">
        <label className="flex items-center gap-2">
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as HullMode)} className="rounded border px-2 py-1">
            <option value="mini">mini</option>
            <option value="portal">portal (highlight tenant-b)</option>
            <option value="landing">landing</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Isolation
          <input type="checkbox" checked={isolation === "on"} onChange={(e) => setIsolation(e.target.checked ? "on" : "off")} />
          {isolation}
        </label>
        <label className="flex items-center gap-2">
          Tenants {count}
          <input type="range" min={3} max={10} value={count} onChange={(e) => setCount(+e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          scrollProgress (landing) {scroll.toFixed(2)}
          <input type="range" min={0} max={1} step={0.01} value={scroll} onChange={(e) => setScroll(+e.target.value)} />
        </label>
        {tenants.map((t, i) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2">
            <span className="w-20 font-semibold">{t.id}</span>
            usage
            <input
              type="range"
              min={0}
              max={1.2}
              step={0.01}
              value={usage[i]}
              onChange={(e) => setUsage((u) => u.map((v, j) => (j === i ? +e.target.value : v)))}
            />
            <span className="num w-10">{usage[i].toFixed(2)}</span>
            level
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={level[i]}
              onChange={(e) => setLevel((l) => l.map((v, j) => (j === i ? (+e.target.value as Level) : v)))}
            />
            <span className="num">{level[i]}</span>
          </div>
        ))}
      </div>
      <p className="mb-2 text-sm text-ink-2">Selected: {picked ?? "none"}</p>
      <div className={box + " " + (mode === "landing" ? "-z-0" : "")}>
        <Hull
          tenants={tenants}
          isolation={isolation}
          mode={mode}
          highlightId={mode === "portal" ? "tenant-b" : undefined}
          scrollProgress={mode === "landing" ? scroll : undefined}
          host={{ cpu_util: 0.5, mem_util: 0.35 }}
          onSelect={setPicked}
        />
      </div>
    </main>
  );
}
