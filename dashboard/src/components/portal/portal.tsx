"use client";
import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { KeyRound, LogOut, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/status";
import { LADDER } from "@/lib/ladder";
import { portalApi, portalMock, usePortal, type Live, type Showback, type Throttle, type UsageResp } from "@/lib/portal";
import type { Level } from "@/lib/ws-types";
import { cn } from "@/lib/utils";

const POLL_MS = 2000;

export function Portal() {
  const session = usePortal((s) => s.session);
  return (
    <div className="mx-auto min-h-full max-w-5xl p-4">
      {session ? <Dashboard token={session.token} tenant={session.tenant} tier={session.tier} /> : <Login />}
    </div>
  );
}

function Login() {
  const login = usePortal((s) => s.login);
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(key.trim());
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-24 flex max-w-sm flex-col gap-3 rounded-lg border border-border p-6">
      <h1 className="text-lg font-semibold">Bulkhead tenant portal</h1>
      <p className="text-sm text-muted-foreground">
        Sign in with your API key to see your usage, throttle status and costs.
        {portalMock && " (Demo mode: type a tenant name such as rogue-ml or acme-shop.)"}
      </p>
      <label htmlFor="key" className="text-sm font-medium">API key</label>
      <input
        id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <Button type="submit" disabled={busy || !key.trim()}>{busy ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}

function Dashboard({ token, tenant, tier }: { token: string; tenant: string; tier: string }) {
  const logout = usePortal((s) => s.logout);
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [throttle, setThrottle] = useState<Throttle | null>(null);
  const [showback, setShowback] = useState<Showback | null>(null);
  const [live, setLive] = useState<(Live & { t: number })[]>([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [l, th] = await Promise.all([portalApi.live(token), portalApi.throttle(token)]);
      setLive((h) => [...h, { ...l, t: Date.now() }].slice(-90));
      setThrottle(th);
      setErr("");
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not refresh.");
    }
  }, [token]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    const load = () => {
      portalApi.usage(token).then(setUsage).catch(() => {});
      portalApi.showback(token).then(setShowback).catch(() => {});
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [token]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{tenant}</h1>
          <p className="text-xs text-muted-foreground">Plan: {tier}</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}><LogOut className="size-4" aria-hidden />Sign out</Button>
      </header>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <ThrottleBanner t={throttle} now={live.at(-1)?.t ?? 0} />
      <div className="grid gap-4 md:grid-cols-2">
        <UsageGauges usage={usage} live={live.at(-1)} />
        <LatencyChart data={live} />
      </div>
      <ShowbackPanel sb={showback} />
      <KeyPanel token={token} />
    </div>
  );
}

function ThrottleBanner({ t, now }: { t: Throttle | null; now: number }) {
  if (!t) return <div className="h-16 animate-pulse rounded-lg border border-border" aria-label="Loading throttle status" />;
  const lvl = LADDER[(t.level as Level) in LADDER ? (t.level as Level) : 0];
  if (t.level === 0)
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
        <ShieldCheck className="size-4" aria-hidden />Your service is running normally. No throttling applied.
      </div>
    );
  const since = t.since ? Math.max(0, Math.round((now - Date.parse(t.since)) / 1000)) : null;
  return (
    <div role="alert" className={cn("rounded-lg border p-3 text-sm", lvl.tone === "bad" ? "border-bad/40 bg-bad/10" : "border-warn/40 bg-warn/10")}>
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4" aria-hidden />
        You are at <Pill tone={lvl.tone}>{lvl.name}</Pill> throttle{since !== null && ` for ${since}s`}
      </div>
      <p className="mt-2"><span className="font-medium">Why: </span>{t.explanation || "Your usage exceeded your plan's fair share."}</p>
      {!!t.actions?.length && <p className="mt-1 text-muted-foreground">Applied: {t.actions.join(", ")}</p>}
      <p className="mt-1 text-muted-foreground">
        Expected recovery: limits step down automatically about 20 s after your usage returns within quota.
      </p>
    </div>
  );
}

function Gauge({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const p = Math.max(0, Math.min(100, pct));
  const tone = pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok";
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground">{detail}</span></div>
      <div role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-2 rounded bg-muted">
        <div className={cn("h-2 rounded", tone)} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function UsageGauges({ usage, live }: { usage: UsageResp | null; live?: Live }) {
  const q = usage?.quota;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-labelledby="usage-h">
      <h2 id="usage-h" className="font-medium">Usage vs quota (last 15 min)</h2>
      {!usage || !q ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Gauge label="Cost units" pct={q.cost_used_pct ?? 0} detail={`${Math.round(usage.usage.totals.cost_units)} / ${Math.round(q.cost_allowance)}`} />
          <Gauge label="Request rate" pct={q.rps ? ((live?.rps ?? 0) / q.rps) * 100 : 0} detail={`${live?.rps ?? 0} / ${q.rps} rps`} />
          <Gauge label="Concurrency" pct={q.concurrency ? ((live?.inflight ?? 0) / q.concurrency) * 100 : 0} detail={`${live?.inflight ?? 0} / ${q.concurrency}`} />
          <p className="text-xs text-muted-foreground">
            {usage.usage.totals.requests} requests, {usage.usage.totals.rejected} rejected.
          </p>
        </>
      )}
    </section>
  );
}

function LatencyChart({ data }: { data: (Live & { t: number })[] }) {
  return (
    <section className="rounded-lg border border-border p-4" aria-labelledby="lat-h">
      <h2 id="lat-h" className="font-medium">Latency (ms) and requests</h2>
      <div className="mt-2 h-48">
        {data.length < 2 ? (
          <p className="text-sm text-muted-foreground">Collecting data…</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis width={40} tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={(t) => new Date(t as number).toLocaleTimeString()} />
              <Line dataKey="p50_ms" name="p50" stroke="var(--ok)" dot={false} isAnimationActive={false} />
              <Line dataKey="p99_ms" name="p99" stroke="var(--bad)" dot={false} isAnimationActive={false} />
              <Line dataKey="rps" name="req/s" stroke="var(--info)" dot={false} strokeDasharray="4 3" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Green p50 · red p99 · dashed blue requests per second</p>
    </section>
  );
}

function ShowbackPanel({ sb }: { sb: Showback | null }) {
  if (!sb) return <section className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Loading showback…</section>;
  const money = (n: number) => `${sb.currency} ${n.toFixed(2)}`;
  return (
    <section className="rounded-lg border border-border p-4" aria-labelledby="sb-h">
      <h2 id="sb-h" className="font-medium">Showback (last hour)</h2>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">Item</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {sb.lines.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1">{l.label ?? l.item}</td>
                <td className="text-right">{money(l.amount ?? l.cost ?? 0)}</td>
              </tr>
            ))}
            <tr className="border-t border-border"><td className="py-1">Free allowance credit</td><td className="text-right">-{money(sb.free_allowance_credit)}</td></tr>
            <tr className="border-t border-border font-medium"><td className="py-1">Total</td><td className="text-right">{money(sb.total)}</td></tr>
          </tbody>
        </table>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sb.by_task}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="task" tick={{ fontSize: 11 }} />
              <YAxis width={44} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="cost_units" name="cost units" fill="var(--info)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{sb.disclaimer}</p>
    </section>
  );
}

function KeyPanel({ token }: { token: string }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  async function rotate() {
    if (!confirm("Rotate your API key? The current key stops working immediately.")) return;
    try {
      setKey((await portalApi.rotate(token)).api_key);
      setErr("");
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Rotation failed.");
    }
  }
  return (
    <section className="rounded-lg border border-border p-4" aria-labelledby="key-h">
      <h2 id="key-h" className="font-medium">API key</h2>
      <p className="mt-1 text-sm text-muted-foreground">Rotating issues a new key and revokes the old one at once. The new key is shown only once.</p>
      <Button className="mt-2" variant="outline" size="sm" onClick={rotate}><KeyRound className="size-4" aria-hidden />Rotate key</Button>
      {key && (
        <p role="status" className="mt-2 break-all rounded-md bg-muted p-2 font-mono text-xs">
          New key (copy it now): {key}
        </p>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-bad">{err}</p>}
    </section>
  );
}
