"use client";
import { usePoll } from "@/lib/use-poll";
import { LadderBadge, Pill } from "../status";
import { ErrorNote, PageFrame, Panel } from "./page-frame";
import type { Level } from "@/lib/ws-types";

interface Row {
  id: string;
  name: string;
  tier: string;
  status: string;
  policy: { weight: number; reserve_cpu: number; limit_cpu: number; limit_mem_mb: number; rps: number; burst: number; concurrency: number; queue_depth: number; db_conns: number };
  metrics?: { p99_ms: number; ok_rps: number; rejected_rps: number; level: number; queue_depth: number; mem_mb: number };
}

export function Tenants() {
  const { data, error, loading } = usePoll<Row[]>("/admin/tenants", 3000);
  return (
    <PageFrame title="Tenants" subtitle="Isolation policy per tenant (read-only) with live load. Policy editing is future work (docs/15).">
      <ErrorNote error={error} />
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                {["Tenant", "Tier", "Status", "Weight", "CPU reserve / limit", "Memory limit", "Rate (rps / burst)", "Concurrency", "Queue", "DB conns", "p99", "OK rps", "Rejected rps", "Ladder"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {loading && <tr><td colSpan={14} className="px-2 py-4 text-muted-foreground">Loading…</td></tr>}
              {data?.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-2 py-1.5 font-sans font-medium">{t.name}</td>
                  <td className="px-2 py-1.5 font-sans"><Pill tone={t.tier === "pro" ? "info" : "warn"}>{t.tier}</Pill></td>
                  <td className="px-2 py-1.5 font-sans">{t.status}</td>
                  <td className="px-2 py-1.5">{t.policy.weight}</td>
                  <td className="px-2 py-1.5">{t.policy.reserve_cpu} / {t.policy.limit_cpu} cores</td>
                  <td className="px-2 py-1.5">{t.policy.limit_mem_mb} MB</td>
                  <td className="px-2 py-1.5">{t.policy.rps} / {t.policy.burst}</td>
                  <td className="px-2 py-1.5">{t.policy.concurrency}</td>
                  <td className="px-2 py-1.5">{t.metrics?.queue_depth ?? 0} / {t.policy.queue_depth}</td>
                  <td className="px-2 py-1.5">{t.policy.db_conns}</td>
                  <td className="px-2 py-1.5">{(t.metrics?.p99_ms ?? 0).toFixed(1)} ms</td>
                  <td className="px-2 py-1.5">{(t.metrics?.ok_rps ?? 0).toFixed(1)}</td>
                  <td className="px-2 py-1.5">{(t.metrics?.rejected_rps ?? 0).toFixed(1)}</td>
                  <td className="px-2 py-1.5 font-sans"><LadderBadge level={(t.metrics?.level ?? 0) as Level} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </PageFrame>
  );
}
