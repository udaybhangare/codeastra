// Tenant portal client. Talks ONLY to /v1/auth/token and /v1/me/* with the
// tenant's own JWT, which lives in memory (zustand, no persist): a page reload
// logs out by design. It never uses the admin token from NEXT_PUBLIC_WS_URL.
import { create } from "zustand";
import { base, liveApi } from "./api";

export const portalMock = !liveApi && !process.env.NEXT_PUBLIC_API_URL;

export interface Throttle {
  level: number;
  since?: string;
  explanation?: string;
  actions?: string[];
}
export interface Quota { cost_per_s: number; rps: number; concurrency: number; cost_allowance: number; cost_used_pct?: number }
export interface UsageResp {
  tenant_id: string;
  tier: string;
  usage: {
    totals: { requests: number; ok: number; rejected: number; cost_units: number; cpu_ms: number };
    by_task: { task: string; requests: number; cost_units: number }[];
    series: { at: string; requests: number; rejected: number; cost_units: number }[];
  };
  quota?: Quota;
}
export interface Showback {
  currency: string;
  lines: { item?: string; label?: string; quantity?: number; unit?: string; amount?: number; cost?: number }[];
  subtotal: number;
  tier_multiplier: number;
  free_allowance_credit: number;
  total: number;
  disclaimer: string;
  by_task: { task: string; requests: number; cost_units: number }[];
}
export interface Live { rps?: number; rejected_rps?: number; p50_ms?: number; p95_ms?: number; p99_ms?: number; queue_depth?: number; inflight?: number }

interface Session { token: string; tenant: string; tier: string; /** last 4 chars of the API key, for the masked display */ keyHint?: string }
interface PortalState {
  session: Session | null;
  login: (key: string) => Promise<void>;
  logout: () => void;
  setKeyHint: (hint: string) => void;
}

export const usePortal = create<PortalState>((set) => ({
  session: null,
  async login(key) {
    if (portalMock) {
      const tenant = key.replace(/^mock-/, "") || "acme-shop";
      return set({ session: { token: `mock-${tenant}`, tenant, tier: tenant === "acme-shop" ? "pro" : "free", keyHint: key.slice(-4) || "demo" } });
    }
    const res = await fetch(base() + "/v1/auth/token", { method: "POST", headers: { "X-API-Key": key } });
    if (!res.ok) throw new Error(res.status === 401 ? "That API key was not recognised." : `Login failed (${res.status}).`);
    const b = await res.json();
    set({ session: { token: b.token, tenant: b.tenant_id, tier: b.tier, keyHint: key.slice(-4) } });
  },
  logout: () => set({ session: null }),
  setKeyHint: (hint) => set((s) => (s.session ? { session: { ...s.session, keyHint: hint } } : s)),
}));

async function me<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  if (portalMock) return mockMe<T>(path, token);
  const res = await fetch(base() + "/v1/me" + path, { ...init, headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    usePortal.getState().logout(); // expired/revoked token → back to login
    throw new Error("Session expired. Please log in again.");
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export const portalApi = {
  usage: (t: string) => me<UsageResp>("/usage?range=15m", t),
  throttle: (t: string) => me<Throttle>("/throttle", t),
  showback: (t: string) => me<Showback>("/showback?range=1h", t),
  live: (t: string) => me<Live>("/live", t),
  rotate: (t: string) => me<{ api_key: string }>("/key/rotate", t, { method: "POST" }),
};

// ---- mock mode: lets the portal run without a backend (rogue-ml is throttled) ----
function mockMe<T>(path: string, token: string): Promise<T> {
  const tenant = token.replace(/^mock-/, "");
  const rogue = tenant === "rogue-ml";
  const now = Date.now();
  const series = Array.from({ length: 15 }, (_, i) => ({
    at: new Date(now - (14 - i) * 60_000).toISOString(),
    requests: rogue ? 400 + i * 20 : 90 + (i % 4) * 5,
    rejected: rogue ? 120 + i * 8 : 0,
    cost_units: rogue ? 9000 + i * 300 : 1500 + (i % 3) * 100,
  }));
  const by_task = [{ task: "cpu-burn", requests: rogue ? 5000 : 300, cost_units: rogue ? 120000 : 2400 }, { task: "db-query", requests: 800, cost_units: 4000 }];
  const out: Record<string, unknown> = {
    "/usage": { tenant_id: tenant, tier: rogue ? "free" : "pro", usage: { totals: { requests: 1300, ok: rogue ? 900 : 1300, rejected: rogue ? 400 : 0, cost_units: rogue ? 124000 : 6400, cpu_ms: 0 }, by_task, series },
      quota: { cost_per_s: 100, rps: 50, concurrency: 8, cost_allowance: 90000, cost_used_pct: rogue ? 138 : 7 } },
    "/throttle": rogue
      ? { level: 2, since: new Date(now - 40_000).toISOString(), explanation: "Your CPU use ran at 4× your plan's share for 30 s and slowed other tenants. Requests are being rate-limited (Soft throttle).", actions: ["rate-limit to 50% of quota"] }
      : { level: 0 },
    "/showback": { currency: "USD", lines: by_task.map((t) => ({ label: t.task, quantity: t.cost_units, unit: "cost units", amount: t.cost_units * 0.00002 })), subtotal: rogue ? 2.48 : 0.13, tier_multiplier: 1, free_allowance_credit: 0.05, total: rogue ? 2.43 : 0.08, disclaimer: "Demo rates; not a real invoice.", by_task },
    "/live": { rps: rogue ? 52 : 11, rejected_rps: rogue ? 14 : 0, p50_ms: rogue ? 180 : 22, p95_ms: rogue ? 410 : 48, p99_ms: (rogue ? 600 : 70) + Math.round(Math.random() * 20), queue_depth: rogue ? 9 : 0, inflight: rogue ? 8 : 1 },
  };
  if (path.startsWith("/key/rotate")) return Promise.resolve({ api_key: `bk_demo${Math.random().toString(16).slice(2, 14)}` } as T);
  const key = "/" + path.split("?")[0].split("/")[1];
  return Promise.resolve(out[key] as T);
}
