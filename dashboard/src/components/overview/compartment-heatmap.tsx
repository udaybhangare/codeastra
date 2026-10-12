"use client";
import { AlertTriangle, OctagonAlert } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LadderBadge } from "@/components/domain/ladder-badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ratioTone, tenantColor } from "@/lib/colors";
import { isOverflow, RESOURCES, tankFill, type Resource } from "@/lib/overview";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { TenantMetrics } from "@/lib/ws-types";

const FILL = {
  ok: "color-mix(in srgb, var(--ok) 55%, white)",
  warn: "var(--warn)",
  bad: "var(--bad)",
} as const;
const HATCH = "repeating-linear-gradient(135deg, var(--bad) 0 4px, var(--bad-100) 4px 8px)";

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-medium">
      <span className="size-3 rounded-[4px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

function Tank({ t, r, tab, r0, c0 }: { t: TenantMetrics; r: Resource; tab: boolean; r0: number; c0: number }) {
  const ratio = r.ratio(t);
  const tone = ratioTone(ratio);
  const [flash, setFlash] = useState(false);
  const prev = useRef(tone);

  // Flash once when the tank crosses into a different status band.
  useEffect(() => {
    if (prev.current === tone) return;
    prev.current = tone;
    setFlash(true);
    const h = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(h);
  }, [tone]);

  const pct = Math.round(ratio * 100);
  return (
    <div
      role="gridcell"
      tabIndex={tab ? 0 : -1}
      data-r={r0}
      data-c={c0}
      aria-label={`${t.tenant_id} ${r.label}: ${pct}% of entitlement, ${r.raw(t)}`}
      title={`${r.label}: ${r.raw(t)}`}
      className={cn(
        "group relative h-11 min-w-0 overflow-hidden rounded-[var(--r-sm)] bg-paper-2 outline-none transition-shadow focus-visible:shadow-[var(--ring)]",
        flash && "shadow-[var(--ring)]",
      )}
    >
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ height: `${tankFill(ratio) * 100}%`, background: FILL[tone], transition: "height 600ms cubic-bezier(.22,1,.36,1), background-color 300ms" }}
      >
        <svg viewBox="0 0 40 4" preserveAspectRatio="none" className="absolute inset-x-0 -top-[3px] h-[4px] w-full" aria-hidden>
          <path d="M0 4 Q5 0 10 2 T20 2 T30 2 T40 2 V4 Z" fill={FILL[tone]} />
        </svg>
      </div>
      {isOverflow(ratio) ? <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: HATCH }} aria-hidden /> : null}
      {tone === "bad" ? <OctagonAlert className="absolute top-1 right-1 size-3 text-ink" aria-hidden /> : null}
      {tone === "warn" ? <AlertTriangle className="absolute top-1 right-1 size-3 text-ink" aria-hidden /> : null}
      <span
        className={cn(
          "num absolute inset-0 grid place-items-center text-xs font-semibold text-ink transition-opacity",
          "opacity-100",
        )}
      >
        <span className="rounded bg-white/85 px-1.5 text-[13px]">{pct}%</span>
      </span>
    </div>
  );
}

export function CompartmentHeatmap({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const snap = useStream((s) => s.latest);

  const presentation = useUi((s) => s.presentation);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.dataset.r === undefined) return;
    const dr = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const dc = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dr && !dc) return;
    e.preventDefault();
    const next = e.currentTarget.querySelector<HTMLElement>(`[data-r="${Number(el.dataset.r) + dr}"][data-c="${Number(el.dataset.c) + dc}"]`);
    next?.focus();
  };

  return (
    <Card
      className={presentation ? "col-span-5 min-w-0 pb-4 max-[1023px]:col-span-12" : "col-span-7 min-w-0 pb-4 max-[1023px]:col-span-12"}
      eyebrow="Resource use vs. each tenant's quota"
      title="Who is using how much?"
      actions={
        <span className="flex items-center gap-3 text-[13px] text-ink-2">
          <Key color={FILL.ok} label="fine" />
          <Key color={FILL.warn} label="near limit" />
          <Key color={FILL.bad} label="over" />
        </span>
      }
    >
      <div className="px-5 pt-3">
        {!snap ? (
          <Skeleton className="h-[220px] w-full" />
        ) : snap.tenants.length === 0 ? (
          <EmptyState title="No tenants reporting yet" help="Compartments appear as soon as the first tenant sends traffic." className="py-6" />
        ) : (
          <div role="grid" aria-label="Resource use as a share of each tenant's entitlement" onKeyDown={onKey} className="flex flex-col gap-1.5">
            <div role="row" className="grid grid-cols-[minmax(120px,1.3fr)_repeat(5,minmax(0,1fr))_128px] items-end gap-2">
              <span />
              {RESOURCES.map((r) => (
                <span key={r.key} role="columnheader" className="truncate text-center text-[13px] font-semibold text-ink-2">
                  {r.label}
                </span>
              ))}
              <span />
            </div>
            {snap.tenants.map((t, ri) => {
              const dim = selected !== null && selected !== t.tenant_id;
              const active = selected === t.tenant_id;
              return (
                <div
                  key={t.tenant_id}
                  role="row"
                  className={cn(
                    "grid grid-cols-[minmax(120px,1.3fr)_repeat(5,minmax(0,1fr))_128px] items-center gap-2 rounded-[var(--r-md)] px-1 py-0.5 transition-[opacity,background-color] duration-200",
                    dim && "opacity-45",
                    active && "bg-ultra-50",
                  )}
                >
                  <div role="rowheader" className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelect(active ? null : t.tenant_id)}
                      aria-pressed={active}
                      className="flex w-full min-w-0 items-center gap-2 rounded-full py-1 text-left outline-none focus-visible:shadow-[var(--ring)]"
                    >
                      <span className="size-3 shrink-0 rounded-full" style={{ background: tenantColor(t.tenant_id) }} aria-hidden />
                      <span className="truncate text-[15px] font-semibold">{t.tenant_id}</span>
                      <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2 uppercase">{t.tier}</span>
                    </button>
                  </div>
                  {RESOURCES.map((r, ci) => (
                    <Tank key={r.key} t={t} r={r} tab={ri === 0 && ci === 0} r0={ri} c0={ci} />
                  ))}
                  <div className="flex justify-end">
                    <LadderBadge level={t.level} size="sm" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
