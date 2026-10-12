"use client";
import { Loader2, ShieldCheck, ShieldOff, WifiOff, FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { useStream } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PillTone = "ok" | "warn" | "bad" | "info";
const MAP = { ok: "ok", warn: "warn", bad: "bad", info: "predict" } as const;

/** Legacy status chip (still imported by pre-redesign pages); now a thin wrapper over `Badge`. */
export function Pill({ tone, className, children }: { tone: PillTone; className?: string; children: React.ReactNode }) {
  return <Badge tone={MAP[tone]} className={cn("h-6 px-2.5 text-xs", className)}>{children}</Badge>;
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

/** Seconds since the last stream message; ticks 1 Hz client-side (display only). */
function useAgeSeconds(at: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, []);
  if (at == null || now == null) return null;
  return Math.max(0, Math.round((now - at) / 1000));
}

export function ConnectionStatus() {
  const conn = useStream((s) => s.conn);
  const source = useStream((s) => s.source);
  const last = useStream((s) => s.lastMessageAt);
  const age = useAgeSeconds(last);
  const tip = age == null ? "No messages yet" : `Last message ${age}s ago`;
  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      {source === "mock" && (
        <Badge tone="predict" icon={<FlaskConical aria-hidden />}>Simulated</Badge>
      )}
      <Tooltip content={tip} side="bottom">
        <span className="inline-flex">
          {conn === "open" && (
            <Badge tone="ok">
              <span className="relative -ml-0.5 mr-0.5 inline-flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-ok motion-reduce:animate-none" />
                <span className="relative size-2 rounded-full bg-ok" />
              </span>
              Live · 1.0 Hz
            </Badge>
          )}
          {conn === "connecting" && <Badge tone="warn" icon={<Loader2 className="animate-spin" aria-hidden />}>Connecting…</Badge>}
          {conn === "reconnecting" && <Badge tone="warn" icon={<Loader2 className="animate-spin" aria-hidden />}>Reconnecting…</Badge>}
          {conn === "closed" && <Badge tone="bad" icon={<WifiOff aria-hidden />}>Offline</Badge>}
        </span>
      </Tooltip>
    </div>
  );
}

/** Moved to components/domain (U07); re-exported for pre-redesign imports. */
export { LadderBadge } from "./domain/ladder-badge";
