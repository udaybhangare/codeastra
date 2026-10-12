"use client";
import { useState } from "react";
import { motion, useAnimationControls } from "motion/react";
import { KeyRound, ShieldHalf } from "lucide-react";
import { adminSignIn } from "@/lib/api";
import { useStream } from "@/lib/store";
import { springBouncy, useReducedMotionSafe } from "@/lib/motion";
import { Button } from "@/components/ui/button";

// Shown only in auto-auth mode (NEXT_PUBLIC_WS_URL=auto) when there is no admin session yet.
export function AdminLogin() {
  const needsAuth = useStream((s) => s.needsAuth);
  const reconnect = useStream((s) => s.reconnect);
  const useMock = useStream((s) => s.useMock);
  const reduced = useReducedMotionSafe();
  const shake = useAnimationControls();
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!needsAuth) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await adminSignIn(key);
      setKey("");
      reconnect();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Sign-in failed");
      if (!reduced) void shake.start({ x: [0, -10, 10, -8, 8, -4, 0], transition: { duration: 0.4 } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Admin sign-in"
      className="fixed inset-0 z-[50] grid place-items-center bg-[rgba(20,20,43,.25)] p-4 backdrop-blur-[6px]"
    >
      <motion.div initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={springBouncy} className="w-full max-w-md">
        <motion.form
          animate={shake}
          onSubmit={submit}
          className="space-y-4 rounded-[var(--r-xl)] border-2 border-ink bg-surface p-7 shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-[16px] bg-ultra text-white">
              <ShieldHalf className="size-6" aria-hidden />
            </span>
            <div>
              <h2 className="font-display text-[28px] leading-[1.1] font-bold tracking-[-0.01em]">Admin sign-in</h2>
              <p className="text-[13px] font-semibold text-ink-3">Bulkhead control room</p>
            </div>
          </div>
          <ol className="list-decimal space-y-1 rounded-[var(--r-md)] bg-paper-2 py-3 pr-4 pl-8 text-[13px] text-ink-2">
            <li>Open <code className="num">deploy/.env</code> and copy the value of <code className="num">ADMIN_API_KEY</code>.</li>
            <li>Paste it below. The dashboard fetches and renews the 15-minute token for you.</li>
          </ol>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold tracking-[0.02em]">Admin key</span>
            <span className="flex items-center gap-2 rounded-[var(--r-md)] border border-line bg-paper-2 px-3 focus-within:shadow-[var(--ring)]">
              <KeyRound className="size-4 shrink-0 text-ink-3" aria-hidden />
              <input
                type="password"
                autoFocus
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="paste admin key"
                aria-invalid={err ? true : undefined}
                className="num h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3"
              />
            </span>
          </label>
          {err && (
            <div role="alert" className="rounded-[var(--r-md)] bg-bad-100 px-3 py-2 text-[13px] font-semibold text-bad-ink">
              {err}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={useMock}>
              Use simulated data
            </Button>
            <Button type="submit" loading={busy} disabled={!key.trim()}>
              Sign in
            </Button>
          </div>
        </motion.form>
      </motion.div>
    </div>
  );
}
