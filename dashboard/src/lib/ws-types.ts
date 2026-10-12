// Mirrors contracts/ws-messages.schema.json. Keep in sync with the schema.
export type Level = 0 | 1 | 2 | 3 | 4 | 5;
export type Tier = "free" | "pro" | "enterprise";
export type Isolation = "on" | "off";

export interface TenantMetrics {
  tenant_id: string;
  tier: Tier;
  level: Level;
  rps: number;
  ok_rps?: number;
  rejected_rps?: number;
  cost_units_s?: number;
  queue_depth: number;
  inflight?: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  queue_wait_p95_ms?: number;
  cpu_share: number;
  mem_mb: number;
  db_conns?: number;
  bytes_s?: number;
  p_overload?: number;
}

export interface Snapshot {
  type: "snapshot";
  ts: string;
  isolation: Isolation;
  host: { cpu_util: number; mem_util: number; db_conn_util?: number; p_overload?: number };
  fairness?: { jain?: number; victim_inflation?: number };
  tenants: TenantMetrics[];
}

export interface StreamEvent {
  type: "event";
  ts: string;
  kind: "throttle" | "predict" | "oom" | "isolation" | "admin";
  tenant_id: string;
  from_level?: Level;
  to_level?: Level;
  message: string;
  evidence?: Record<string, unknown>;
  actions?: Record<string, unknown>[];
  actor?: string;
}

export interface RunProgress {
  type: "run_progress";
  run_id: string;
  scenario: string;
  isolation?: Isolation;
  phase: "warmup" | "attack" | "cooldown";
  elapsed_s: number;
  total_s: number;
}

export interface RunResult {
  type: "run_result";
  run_id: string;
  scenario: string;
  isolation: Isolation;
  summary: Record<string, unknown>;
}

export type WsMessage = Snapshot | StreamEvent | RunProgress | RunResult;

export function parseMessage(raw: string): WsMessage | null {
  try {
    const m = JSON.parse(raw) as { type?: string };
    switch (m?.type) {
      case "snapshot":
        return Array.isArray((m as Snapshot).tenants) ? (m as Snapshot) : null;
      case "event":
      case "run_progress":
      case "run_result":
        return m as WsMessage;
    }
  } catch {
    /* malformed frame: ignore */
  }
  return null;
}
