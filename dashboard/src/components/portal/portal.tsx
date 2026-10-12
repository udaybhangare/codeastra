"use client";
// Tenant portal (docs/ui/06). Isolated from the admin stream: it only calls /v1/me/* with the tenant's own token.
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, LogOut, ShieldHalf } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { hasAdminSession } from "@/lib/api";
import { portalApi, portalMock, usePortal, type Showback, type Throttle, type UsageResp } from "@/lib/portal";
import { buildGauges, planUsedRatio, recoveryRemaining, toLevel } from "@/lib/portal-view";
import { fadeUp, springBouncy, stagger, useReducedMotionSafe } from "@/lib/motion";
import { ApiKeyPanel } from "./api-key-panel";
import { CompartmentHero } from "./compartment-hero";
import { HistoryCharts, type LivePoint } from "./history-charts";
import { ShowbackTable } from "./showback-table";
import { ThrottleBanner } from "./throttle-banner";
import { UsageGauge } from "./usage-gauge";

const POLL_MS = 2000;
const LIVE_KEEP = 460; // ≈ 15 min at 2 s

export function Portal() {
  const session = usePortal((s) => s.session);
  return (
    <div className="min-h-full bg-paper">
      {session ? <Dashboard token={session.token} tenant={session.tenant} tier={session.tier} keyHint={session.keyHint} /> : <Login />}
    </div>
  );
}

function Login() {
  const login = usePortal((s) => s.login);
  const reduced = useReducedMotionSafe();
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(key.trim());
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Login failed.");
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bg-grad-hero grid min-h-screen place-items-center p-4">
      <motion.form
        key={shake}
        onSubmit={submit}
        initial={reduced ? false : { opacity: 0, scale: 0.92, y: 12 }}
        animate={shake > 0 && !reduced ? { opacity: 1, scale: 1, y: 0, x: [0, -10, 10, -8, 8, -4, 0] } : { opacity: 1, scale: 1, y: 0 }}
        transition={springBouncy}
        className="w-full max-w-md space-y-4 rounded-[var(--r-xl)] border-2 border-ink bg-surface p-7 shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-[16px] bg-ultra text-white"><ShieldHalf className="size-6" aria-hidden /></span>
          <div>
            <h1 className="font-display text-[28px] leading-[1.1] font-bold tracking-[-0.01em]">Welcome back</h1>
            <p className="text-[13px] font-semibold text-ink-3">Bulkhead tenant portal</p>
          </div>
        </div>
        <p className="text-[15px] text-ink-2">
          Sign in with your API key to see how your compartment is doing: usage, slow-downs and costs.
          {portalMock && " Demo mode: type a tenant name such as rogue-ml (throttled) or acme-shop (calm)."}
        </p>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold tracking-[0.02em]">API key</span>
          <span className="flex items-center gap-2 rounded-[var(--r-md)] border border-line bg-paper-2 px-3 focus-within:shadow-[var(--ring)]">
            <KeyRound className="size-4 shrink-0 text-ink-3" aria-hidden />
            <input
              type="password" autoFocus autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste your API key"
              aria-invalid={err ? true : undefined}
              className="num h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3"
            />
          </span>
        </label>
        {err && <div role="alert" className="rounded-[var(--r-md)] bg-bad-100 px-3 py-2 text-[13px] font-semibold text-bad-ink">{err}</div>}
        <Button type="submit" loading={busy} disabled={!key.trim()} className="w-full">Sign in</Button>
      </motion.form>
    </div>
  );
}

const NAV = [
  { href: "#overview", label: "Overview" },
  { href: "#usage", label: "Usage" },
  { href: "#showback", label: "Showback" },
  { href: "#api-keys", label: "API keys" },
] as const;

function TopNav({ tenant, tier }: { tenant: string; tier: string }) {
  const logout = usePortal((s) => s.logout);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setAdmin(hasAdminSession()), 0); // sessionStorage: read after mount, not in render
    return () => clearTimeout(h);
  }, []);
  return (
    <header className="sticky top-3 z-[10] mx-auto mt-3 flex w-[min(1200px,calc(100%-24px))] flex-wrap items-center gap-2 rounded-[var(--r-xl)] border border-line bg-surface/90 px-3 py-2 shadow-[var(--shadow-2)] backdrop-blur-xl">
      <span className="font-display flex items-center gap-2 px-2 text-[20px] font-bold tracking-[-0.01em]">
        <span className="grid size-8 place-items-center rounded-[10px] bg-ultra text-white"><ShieldHalf className="size-4" aria-hidden /></span>
        Bulkhead
      </span>
      <nav aria-label="Portal sections" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-2 sm:w-auto">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className="inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold text-ink-2 outline-none hover:bg-paper-2 hover:text-ink focus-visible:shadow-[var(--ring)]">
            {n.label}
          </a>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden max-w-[160px] truncate text-[13px] font-semibold sm:inline">{tenant}</span>
        <Badge tone="lime">{tier}</Badge>
        {admin && (
          <Link href="/overview" className="inline-flex h-9 items-center rounded-full bg-ultra-100 px-4 text-[13px] font-semibold text-ultra-600 outline-none hover:bg-ultra-100/70 focus-visible:shadow-[var(--ring)]">
            Switch to Admin
          </Link>
        )}
        <Button variant="ghost" size="sm" icon={<LogOut />} onClick={logout}>Sign out</Button>
      </div>
    </header>
  );
}

function Dashboard({ token, tenant, tier, keyHint }: { token: string; tenant: string; tier: string; keyHint?: string }) {
  const reduced = useReducedMotionSafe();
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [throttle, setThrottle] = useState<Throttle | null>(null);
  const [showback, setShowback] = useState<Showback | null>(null);
  const [live, setLive] = useState<LivePoint[]>([]);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(0);
  const [calmSince, setCalmSince] = useState<number | null>(null);
  const usageRef = useRef<UsageResp | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [l, th] = await Promise.all([portalApi.live(token), portalApi.throttle(token)]);
      const t = Date.now();
      setLive((h) => [...h, { ...l, t }].slice(-LIVE_KEEP));
      setThrottle(th);
      setNow(t);
      setErr("");
      // Recovery clock starts when we first see usage back inside the plan while throttled.
      const ratio = planUsedRatio(buildGauges(usageRef.current, l));
      setCalmSince((p) => (toLevel(th.level) > 0 && ratio < 1 ? (p ?? t) : null));
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

  // 1 s ticker so the recovery countdown moves between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadSlow = useCallback(() => {
    portalApi.usage(token).then((u) => { usageRef.current = u; setUsage(u); }).catch(() => {});
    portalApi.showback(token).then(setShowback).catch(() => {});
  }, [token]);
  useEffect(() => {
    const first = setTimeout(loadSlow, 0);
    const id = setInterval(loadSlow, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [loadSlow]);

  const latest = live.at(-1);
  const level = toLevel(throttle?.level);
  const gauges = useMemo(() => buildGauges(usage, latest), [usage, latest]);
  const ratio = planUsedRatio(gauges);
  const ready = throttle !== null && usage !== null;
  const left = now === 0 ? null : recoveryRemaining(calmSince, now);

  return (
    <>
      <TopNav tenant={tenant} tier={tier} />
      <motion.main
        id="main"
        variants={stagger}
        initial={reduced ? false : "hidden"}
        animate="show"
        className="mx-auto flex w-[min(1200px,calc(100%-24px))] flex-col gap-6 py-8"
      >
        <motion.div variants={fadeUp}>
          <h1 className="font-display text-[28px] leading-[1.15] font-bold tracking-[-0.01em] sm:text-[40px] sm:leading-[1.1] sm:tracking-[-0.02em]">Hi, {tenant}.</h1>
          <p className="mt-1 text-[18px] text-ink-2">Here&apos;s how your compartment is doing.</p>
        </motion.div>

        {err && <ErrorState message={err} onRetry={() => void refresh()} />}

        <motion.div variants={fadeUp}>
          <CompartmentHero tenant={tenant} tier={tier} level={level} planRatio={ratio} live={latest} ready={ready} recoverySeconds={left} />
        </motion.div>

        <ThrottleBanner throttle={throttle} level={level} calmSince={calmSince} now={now} onDetails={() => document.getElementById("usage")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" })} />

        <motion.section variants={fadeUp} id="usage" aria-labelledby="usage-h" className="scroll-mt-24">
          <Card className="p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="usage-h" className="text-[28px]">Usage vs your plan</h2>
              <p className="text-[13px] text-ink-2">Dark tick = your plan limit · lighter arc = short bursts beyond it</p>
            </div>
            {gauges.length === 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="mx-auto aspect-square w-full max-w-[220px] rounded-full" />)}
              </div>
            ) : (
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                {gauges.map((g) => <UsageGauge key={g.id} spec={g} />)}
              </div>
            )}
          </Card>
        </motion.section>

        <motion.div variants={fadeUp}><HistoryCharts usage={usage} live={live} now={now} /></motion.div>
        <motion.div variants={fadeUp}><ShowbackTable sb={showback} /></motion.div>
        <motion.div variants={fadeUp}><ApiKeyPanel token={token} keyHint={keyHint} /></motion.div>
      </motion.main>
    </>
  );
}
