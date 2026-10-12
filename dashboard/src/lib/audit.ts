// Audit log view model: merge stream + REST events, filter, CSV, row windowing. Pure (no clock).
import type { StreamEvent } from "./ws-types";

/** Row shape of GET /admin/events (platform events table). */
export interface ApiEvent {
  id: number;
  ts: string;
  tenant_id: string;
  from_level: number;
  to_level: number;
  reason: string;
  evidence?: Record<string, unknown>;
}

export function fromApi(e: ApiEvent): StreamEvent {
  const note = typeof e.evidence?.note === "string" ? ` · ${e.evidence.note}` : "";
  return {
    type: "event",
    ts: e.ts,
    kind: "throttle",
    tenant_id: e.tenant_id,
    from_level: e.from_level as StreamEvent["from_level"],
    to_level: e.to_level as StreamEvent["to_level"],
    message: `${e.tenant_id} moved from L${e.from_level} to L${e.to_level} (${e.reason})${note}`,
    evidence: e.evidence,
  };
}

/** Same decision seen twice (stream + REST) differs in timestamp precision: key on whole seconds. */
const dedupeKey = (e: StreamEvent) => `${Math.floor(Date.parse(e.ts) / 1000)}|${e.tenant_id}|${e.from_level ?? ""}>${e.to_level ?? ""}|${e.kind}`;

/** Union of both sources, newest first, stream copy wins (it carries actions/actor). */
export function mergeEvents(stream: StreamEvent[], polled: StreamEvent[]): StreamEvent[] {
  const seen = new Set<string>();
  const out: StreamEvent[] = [];
  for (const e of [...stream, ...polled]) {
    const k = dedupeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

export type AuditRange = "5m" | "1h" | "all";
export interface AuditFilter {
  q: string;
  kind: "all" | StreamEvent["kind"];
  tenant: string;
  actor: string;
  range: AuditRange;
}
export const DEFAULT_AUDIT_FILTER: AuditFilter = { q: "", kind: "all", tenant: "all", actor: "all", range: "all" };
const RANGE_MS: Record<AuditRange, number> = { "5m": 300_000, "1h": 3_600_000, all: Infinity };

export const actorOf = (e: StreamEvent) => e.actor || "system";

export function newestTs(events: StreamEvent[]): number {
  return events.reduce((m, e) => Math.max(m, Date.parse(e.ts) || 0), 0);
}

export function filterAudit(events: StreamEvent[], f: AuditFilter, anchor: number): StreamEvent[] {
  const q = f.q.trim().toLowerCase();
  return events.filter((e) => {
    if (f.kind !== "all" && e.kind !== f.kind) return false;
    if (f.tenant !== "all" && e.tenant_id !== f.tenant) return false;
    if (f.actor !== "all" && actorOf(e) !== f.actor) return false;
    if (anchor - Date.parse(e.ts) > RANGE_MS[f.range]) return false;
    if (q) {
      const note = typeof e.evidence?.note === "string" ? e.evidence.note : "";
      if (!`${e.message} ${e.tenant_id} ${actorOf(e)} ${e.kind} ${note}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

const CSV_HEAD = ["time", "kind", "tenant", "from_level", "to_level", "actor", "message"];
const cell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(events: StreamEvent[]): string {
  const lines = events.map((e) => [e.ts, e.kind, e.tenant_id, e.from_level, e.to_level, actorOf(e), e.message].map(cell).join(","));
  return [CSV_HEAD.join(","), ...lines].join("\n") + "\n";
}

export interface WindowSlice {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}
/** Rows [start,end) intersecting the viewport (+overscan) given per-row heights. */
export function windowRows(heights: number[], scrollTop: number, viewport: number, overscan = 6): WindowSlice {
  let y = 0;
  let start = 0;
  while (start < heights.length && y + heights[start] < scrollTop) y += heights[start++];
  let end = start;
  let yEnd = y;
  while (end < heights.length && yEnd < scrollTop + viewport) yEnd += heights[end++];
  const s = Math.max(0, start - overscan);
  const e = Math.min(heights.length, end + overscan);
  const sum = (a: number, b: number) => heights.slice(a, b).reduce((x, h) => x + h, 0);
  return { start: s, end: e, padTop: sum(0, s), padBottom: sum(e, heights.length) };
}
