"use client";
import { create } from "zustand";
import { MockStream } from "./mock-stream";
import { authAuto, ensureAdminToken, streamUrl } from "./api";
import { parseMessage, type Snapshot, type StreamEvent, type RunProgress, type RunResult } from "./ws-types";
import type { RunBundle, SeriesPoint } from "./runs";

export type ConnState = "connecting" | "open" | "reconnecting" | "closed";

// 5 tenants x 10 min @1 Hz = 600 points per tenant; cap at that.
const HISTORY_MAX = 600;
const EVENTS_MAX = 200;

export interface HistoryPoint {
  ts: number; // epoch ms
  [tenantId: string]: number;
}

interface State {
  conn: ConnState;
  source: "mock" | "live";
  latest: Snapshot | null;
  p99History: HistoryPoint[];
  events: StreamEvent[];
  run: RunProgress | null;
  lastResult: RunResult | null;
  /** Finished runs seen on the stream, keyed by run_id, with the p99 series captured while they ran. */
  results: Record<string, RunBundle>;
  activeSeries: { run_id: string; points: SeriesPoint[] } | null;
  tenantIds: string[];
  lastMessageAt: number | null;
  /** auto-auth mode: no valid admin session yet, show the sign-in card */
  needsAuth: boolean;
  connect: () => void;
  /** (re)open after sign-in */
  reconnect: () => void;
  /** presenter fallback: switch to the built-in simulated stream */
  useMock: () => void;
  disconnect: () => void;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "mock";
const BACKOFF_MIN = 500;
const BACKOFF_MAX = 15_000;

let ws: WebSocket | null = null;
let mock: MockStream | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let wanted = false;
let forceMock = false;
let progressAt = 0; // Date.now() of the last run_progress, to interpolate elapsed time between heartbeats

export const useStream = create<State>((set, get) => {
  const handle = (raw: string) => {
    const m = parseMessage(raw);
    if (!m) return;
    const now = Date.now();
    switch (m.type) {
      case "snapshot": {
        const pt: HistoryPoint = { ts: Date.parse(m.ts) || now };
        for (const t of m.tenants) pt[t.tenant_id] = t.p99_ms;
        const hist = get().p99History;
        const next = hist.length >= HISTORY_MAX ? hist.slice(hist.length - HISTORY_MAX + 1) : hist.slice();
        next.push(pt);
        const ids = m.tenants.map((t) => t.tenant_id).sort();
        const prevIds = get().tenantIds;
        const same = ids.length === prevIds.length && ids.every((v, i) => v === prevIds[i]);
        const { run, activeSeries } = get();
        let series = activeSeries;
        if (run && activeSeries && activeSeries.run_id === run.run_id && activeSeries.points.length < 1800) {
          const p: SeriesPoint = { t: run.elapsed_s + (now - progressAt) / 1000, phase: run.phase };
          for (const t of m.tenants) p[t.tenant_id] = t.p99_ms;
          series = { run_id: activeSeries.run_id, points: [...activeSeries.points, p] };
        }
        set({ latest: m, p99History: next, tenantIds: same ? prevIds : ids, lastMessageAt: now, activeSeries: series });
        break;
      }
      case "event":
        set((s) => ({ events: [m, ...s.events].slice(0, EVENTS_MAX), lastMessageAt: now }));
        break;
      case "run_progress": {
        progressAt = now;
        const a = get().activeSeries;
        set({ run: m, lastMessageAt: now, activeSeries: a && a.run_id === m.run_id ? a : { run_id: m.run_id, points: [] } });
        break;
      }
      case "run_result": {
        const a = get().activeSeries;
        const seed = typeof m.summary.seed === "number" ? m.summary.seed : undefined;
        const bundle: RunBundle = {
          run_id: m.run_id,
          scenario: m.scenario,
          isolation: m.isolation,
          seed,
          summary: m.summary,
          series: a && a.run_id === m.run_id ? a.points : [],
        };
        set((s) => ({
          lastResult: m,
          run: null,
          lastMessageAt: now,
          activeSeries: null,
          results: { ...s.results, [m.run_id]: bundle },
        }));
        break;
      }
    }
  };

  const scheduleRetry = () => {
    if (!wanted) return;
    const delay = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** attempt) * (0.75 + Math.random() * 0.5);
    attempt += 1;
    set({ conn: "reconnecting" });
    retryTimer = setTimeout(open, delay);
  };

  const open = () => {
    if (!wanted) return;
    if (WS_URL === "mock" || forceMock) {
      set({ source: "mock", conn: "connecting", needsAuth: false });
      mock = new MockStream(handle, () => set({ conn: "open" }));
      mock.start();
      return;
    }
    set({ source: "live", conn: attempt === 0 ? "connecting" : "reconnecting" });
    if (authAuto) {
      // mint/refresh the admin JWT first; no stored admin key => ask the user to sign in
      void ensureAdminToken().then((ok) => {
        if (!wanted) return;
        if (!ok) set({ needsAuth: true, conn: "closed" });
        else {
          set({ needsAuth: false });
          connectWs();
        }
      });
      return;
    }
    connectWs();
  };

  const connectWs = () => {
    try {
      ws = new WebSocket(streamUrl());
    } catch {
      scheduleRetry();
      return;
    }
    ws.onopen = () => {
      attempt = 0;
      set({ conn: "open" });
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") handle(e.data);
    };
    ws.onclose = () => {
      ws = null;
      scheduleRetry();
    };
    ws.onerror = () => ws?.close();
  };

  return {
    conn: "connecting",
    source: WS_URL === "mock" ? "mock" : "live",
    latest: null,
    p99History: [],
    events: [],
    run: null,
    lastResult: null,
    results: {},
    activeSeries: null,
    tenantIds: [],
    lastMessageAt: null,
    needsAuth: false,
    reconnect: () => {
      if (retryTimer) clearTimeout(retryTimer);
      attempt = 0;
      wanted = true;
      open();
    },
    useMock: () => {
      forceMock = true;
      get().reconnect();
    },
    connect: () => {
      if (wanted) return;
      wanted = true;
      attempt = 0;
      open();
    },
    disconnect: () => {
      wanted = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      mock?.stop();
      mock = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      set({ conn: "closed" });
    },
  };
});
