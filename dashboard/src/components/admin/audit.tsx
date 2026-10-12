"use client";
import { useMemo, useState } from "react";
import { usePoll } from "@/lib/use-poll";
import { LadderBadge } from "../status";
import { ErrorNote, PageFrame, Panel } from "./page-frame";
import type { Level } from "@/lib/ws-types";

interface Ev {
  id: number;
  ts: string;
  tenant_id: string;
  from_level: number;
  to_level: number;
  reason: string;
  evidence?: { note?: string; score?: number };
}

export function Audit() {
  const { data, error, loading } = usePoll<Ev[]>("/admin/events?limit=200", 3000);
  const [tenant, setTenant] = useState("all");
  const [reason, setReason] = useState("all");
  const tenants = useMemo(() => Array.from(new Set((data ?? []).map((e) => e.tenant_id))).sort(), [data]);
  const reasons = useMemo(() => Array.from(new Set((data ?? []).map((e) => e.reason))).sort(), [data]);
  const rows = (data ?? []).filter((e) => (tenant === "all" || e.tenant_id === tenant) && (reason === "all" || e.reason === reason));
  const sel = "rounded-md border border-border bg-background px-2 py-1 text-sm";
  return (
    <PageFrame title="Audit & decisions" subtitle="Every automated throttle-ladder step with its reason. Open Incidents for the full evidence (Why drawer).">
      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        <label className="text-sm">Tenant <select className={sel} value={tenant} onChange={(e) => setTenant(e.target.value)}><option value="all">All</option>{tenants.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="text-sm">Reason <select className={sel} value={reason} onChange={(e) => setReason(e.target.value)}><option value="all">All</option>{reasons.map((t) => <option key={t}>{t}</option>)}</select></label>
        <span className="self-center text-xs text-muted-foreground">{rows.length} of {data?.length ?? 0} shown</span>
      </div>
      <Panel>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>{["Time", "Tenant", "Change", "Reason", "Note", "Score"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="px-2 py-4 text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-muted-foreground">No decisions recorded yet. Run a scenario (S1) to generate some.</td></tr>}
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{new Date(e.ts).toLocaleTimeString()}</td>
                <td className="px-2 py-1.5 font-medium">{e.tenant_id}</td>
                <td className="px-2 py-1.5"><span className="inline-flex items-center gap-1"><LadderBadge level={e.from_level as Level} />→<LadderBadge level={e.to_level as Level} /></span></td>
                <td className="px-2 py-1.5 font-mono text-xs">{e.reason}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{e.evidence?.note ?? ""}</td>
                <td className="px-2 py-1.5 font-mono tabular-nums">{e.evidence?.score !== undefined ? e.evidence.score.toFixed(2) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </PageFrame>
  );
}
