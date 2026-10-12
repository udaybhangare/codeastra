"use client";
import { CheckCircle2, CircleAlert, Loader2, ShieldCheck, ShieldOff, WifiOff, FlaskConical } from "lucide-react";
import { useStream } from "@/lib/store";
import { LADDER } from "@/lib/ladder";
import type { Level } from "@/lib/ws-types";
import { cn } from "@/lib/utils";

const TONE = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
  info: "border-info/40 bg-info/10 text-info",
} as const;

export function Pill({ tone, className, children }: { tone: keyof typeof TONE; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tone], className)}>
      {children}
    </span>
  );
}

export function IsolationBadge() {
  const iso = useStream((s) => s.latest?.isolation);
  if (!iso) return <Pill tone="info">Isolation: …</Pill>;
  return iso === "on" ? (
    <Pill tone="ok"><ShieldCheck className="size-3.5" aria-hidden />Isolation ON</Pill>
  ) : (
    <Pill tone="bad"><ShieldOff className="size-3.5" aria-hidden />Isolation OFF</Pill>
  );
}

export function ConnectionStatus() {
  const conn = useStream((s) => s.conn);
  const source = useStream((s) => s.source);
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      {source === "mock" && (
        <Pill tone="info"><FlaskConical className="size-3.5" aria-hidden />Mock stream</Pill>
      )}
      {conn === "open" && <Pill tone="ok"><CheckCircle2 className="size-3.5" aria-hidden />Live</Pill>}
      {conn === "connecting" && <Pill tone="warn"><Loader2 className="size-3.5 animate-spin" aria-hidden />Connecting</Pill>}
      {conn === "reconnecting" && <Pill tone="warn"><Loader2 className="size-3.5 animate-spin" aria-hidden />Reconnecting…</Pill>}
      {conn === "closed" && <Pill tone="bad"><WifiOff className="size-3.5" aria-hidden />Disconnected</Pill>}
    </div>
  );
}

export function LadderBadge({ level }: { level: Level }) {
  const l = LADDER[level] ?? LADDER[0];
  const Icon = l.tone === "ok" ? CheckCircle2 : CircleAlert;
  return (
    <Pill tone={l.tone}>
      <Icon className="size-3.5" aria-hidden />
      L{level} {l.name}
    </Pill>
  );
}
