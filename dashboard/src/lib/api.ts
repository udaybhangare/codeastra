// Minimal admin REST client. Base URL and token are derived from the WS URL
// (ws://host/admin/stream?token=JWT) so one env var configures both.
// NEXT_PUBLIC_WS_URL=auto: live backend on the same origin (or NEXT_PUBLIC_API_URL); the admin
// signs in with the admin key in the browser and the 15-min JWT is minted/refreshed automatically.
const WS = process.env.NEXT_PUBLIC_WS_URL ?? "mock";

export const liveApi = WS !== "mock";
export const authAuto = WS === "auto";

// --- admin session (auto mode). The JWT lives in memory; the admin key in sessionStorage (tab-scoped). ---
const KEY_STORE = "bulkhead.admin.key";
let jwt: { token: string; exp: number } | null = null; // exp: epoch ms
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function storedKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}
function jwtExpMs(token: string): number {
  try {
    const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b)).exp * 1000;
  } catch {
    return Date.now() + 10 * 60_000;
  }
}
async function mint(key: string): Promise<void> {
  const res = await fetch(base() + "/admin/auth/token", { method: "POST", headers: { "X-Admin-Key": key } });
  if (res.status === 401 || res.status === 403) throw new Error("Wrong admin key");
  if (!res.ok) throw new Error(`Backend answered ${res.status}`);
  const b = (await res.json()) as { token?: string };
  if (!b.token) throw new Error("No token in response");
  jwt = { token: b.token, exp: jwtExpMs(b.token) };
}
/** True when this tab holds an admin key (used by the portal's "Switch to Admin" link). */
export function hasAdminSession(): boolean {
  return jwt !== null || storedKey() !== null;
}
/** Sign in with the admin key; throws a readable Error on failure. */
export async function adminSignIn(key: string): Promise<void> {
  await mint(key.trim());
  try {
    sessionStorage.setItem(KEY_STORE, key.trim());
  } catch {
    /* private mode: stay signed in for this page load only */
  }
  startRefresh();
}
export function adminSignOut(): void {
  jwt = null;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  try {
    sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* ignore */
  }
}
/** True when a valid token exists or can be minted from the stored key. Call before opening the stream. */
export async function ensureAdminToken(): Promise<boolean> {
  if (jwt && jwt.exp - Date.now() > 60_000) return true;
  const k = storedKey();
  if (!k) return false;
  try {
    await mint(k);
    startRefresh();
    return true;
  } catch {
    adminSignOut();
    return false;
  }
}
function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (jwt && jwt.exp - Date.now() < 3 * 60_000) void ensureAdminToken();
  }, 30_000);
}
function currentToken(): string | null {
  return jwt?.token ?? parsed()?.searchParams.get("token") ?? null;
}
/** WebSocket URL for the admin stream (token is current at call time). */
export function streamUrl(): string {
  if (!authAuto) return WS;
  const o = base() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${o.replace(/^http/, "ws")}/admin/stream?token=${encodeURIComponent(jwt?.token ?? "")}`;
}

function parsed(): URL | null {
  try {
    return new URL(WS);
  } catch {
    return null;
  }
}

export function base(): string {
  const o = process.env.NEXT_PUBLIC_API_URL;
  if (o) return o.replace(/\/$/, "");
  const u = parsed();
  if (!u) return "";
  return `${u.protocol === "wss:" ? "https:" : "http:"}//${u.host}`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  await ensureAdminToken().catch(() => false);
  const token = currentToken();
  const res = await fetch(base() + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const b = await res.json();
      msg = b?.error?.message ?? b?.message ?? b?.error ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${path}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => req<T>(path),
  setIsolation: (mode: "on" | "off") => req<unknown>("/admin/isolation", { method: "POST", body: JSON.stringify({ mode }) }),
  /** PUT /admin/tenants/{id}/policy: omitted fields keep their value; audited server-side. */
  putPolicy: (tenantId: string, patch: Record<string, unknown>) =>
    req<unknown>(`/admin/tenants/${encodeURIComponent(tenantId)}/policy`, { method: "PUT", body: JSON.stringify(patch) }),
  /** POST /admin/tenants/{id}/level: level 0–4 pins, null releases the pin. */
  setLevel: (tenantId: string, level: number | null, reason: string) =>
    req<unknown>(`/admin/tenants/${encodeURIComponent(tenantId)}/level`, { method: "POST", body: JSON.stringify({ level, reason }) }),
  runScenario: (name: string, seed: number, duration: number) =>
    req<{ id: string }>(`/admin/scenarios/${encodeURIComponent(name)}/run`, {
      method: "POST",
      body: JSON.stringify({ seed, duration }),
    }),
};
