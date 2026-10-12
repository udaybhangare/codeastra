"use client";
import { HelpCircle } from "lucide-react";
import { LadderBadge } from "@/components/domain/ladder-badge";
import { Button } from "@/components/ui/button";
import { tenantColor } from "@/lib/colors";
import { fmtDuration } from "@/lib/format";
import { whyEvent, type LevelSince } from "@/lib/overview";
import { useStream } from "@/lib/store";
import type { StreamEvent } from "@/lib/ws-types";

/** Lime "all calm" illustration: three sealed doors, water low. */
function CalmArt() {
  return (
    <svg viewBox="0 0 96 40" className="h-10 w-24" aria-hidden>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${6 + i * 30} 4)`}>
          <rect width="24" height="32" rx="7" fill="var(--surface)" stroke="var(--lime-ink)" strokeWidth="2" />
          <rect x="2" y="20" width="20" height="10" rx="4" fill="var(--lime)" />
        </g>
      ))}
    </svg>
  );
}

export function ActiveThrottles({
  selected,
  since,
  onWhy,
}: {
  selected: string | null;
  since: LevelSince;
  onWhy: (e: StreamEvent) => void;
}) {
  const snap = useStream((s) => s.latest);
  const events = useStream((s) => s.events);
  if (!snap) return <div className="skeleton h-16 rounded-[var(--r-md)]" aria-hidden />;

  const now = Date.parse(snap.ts) || 0;
  const active = snap.tenants.filter((t) => t.level > 0 && (!selected || t.tenant_id === selected));

  if (active.length === 0) {
    return (
      <div className="flex items-center gap-4 rounded-[var(--r-md)] bg-lime/40 px-4 py-3 text-lime-ink">
        <CalmArt />
        <div>
          <p className="font-display text-lg leading-tight font-semibold">All compartments calm</p>
          <p className="text-[13px]">{selected ? `${selected} is within its entitlement.` : "Every tenant is within its entitlement."}</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="flex max-h-[104px] flex-col gap-1.5 overflow-y-auto pr-1">
      {active.map((t) => {
        const ev = whyEvent(events, t.tenant_id, t.level);
        const s = since[t.tenant_id];
        return (
          <li key={t.tenant_id} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: tenantColor(t.tenant_id) }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.tenant_id}</span>
            <LadderBadge level={t.level} size="sm" />
            <span className="num w-14 shrink-0 text-right text-xs text-ink-2" title="Time at this level">
              {s ? fmtDuration(Math.max(0, (now - s.since) / 1000)) : "–"}
            </span>
            <Button
              variant="soft"
              size="sm"
              className="h-8! px-3!"
              disabled={!ev}
              onClick={() => ev && onWhy(ev)}
              title={ev ? "Why was this tenant throttled?" : "No decision event received yet"}
              icon={<HelpCircle aria-hidden />}
            >
              Why?
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
