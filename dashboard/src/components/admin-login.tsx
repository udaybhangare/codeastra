"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { adminSignIn } from "@/lib/api";
import { useStream } from "@/lib/store";

// Shown only in auto-auth mode (NEXT_PUBLIC_WS_URL=auto) when there is no admin session yet.
export function AdminLogin() {
  const needsAuth = useStream((s) => s.needsAuth);
  const reconnect = useStream((s) => s.reconnect);
  const useMock = useStream((s) => s.useMock);
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Admin sign-in" className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-5 shadow-lg">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5" aria-hidden /> Admin sign-in
        </div>
        <p className="text-sm text-muted-foreground">
          Enter the admin key (<code>ADMIN_API_KEY</code> in <code>deploy/.env</code>). The dashboard fetches and renews the 15-minute token for you.
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="admin key"
          aria-label="Admin key"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        {err && <div role="alert" className="text-sm text-bad">{err}</div>}
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={useMock} className="text-sm text-muted-foreground underline underline-offset-2">
            Use simulated data
          </button>
          <button type="submit" disabled={busy || !key.trim()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
