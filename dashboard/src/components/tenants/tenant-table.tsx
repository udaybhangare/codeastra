"use client";
import { motion } from "motion/react";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { useState } from "react";
import { tenantColor, ratioTone } from "@/lib/colors";
import { fmtMs, fmtNum, fmtPct } from "@/lib/format";
import { springSnappy, useReducedMotionSafe } from "@/lib/motion";
import { quotaUsage, sortRows, type SortKey, type TenantRow } from "@/lib/policy";
import { cn } from "@/lib/utils";
import { LadderBadge } from "../domain/ladder-badge";
import { Badge } from "../ui/badge";

const GRID = "grid grid-cols-[minmax(150px,1.5fr)_110px_150px_80px_90px_70px_minmax(170px,1.5fr)_24px] items-center gap-4 px-5";
const COLS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "tenant", label: "Tenant" },
  { key: "tier", label: "Tier" },
  { key: "level", label: "Throttle level" },
  { key: "rps", label: "Rate", align: "right" },
  { key: "p99", label: "p99", align: "right" },
  { key: "cpu", label: "CPU", align: "right" },
  { key: "quota", label: "Quota used" },
];
const TIER_TONE = { free: "neutral", pro: "brand", enterprise: "lime" } as const;
const RESOURCE = { rate: "rate", memory: "memory", queue: "queue" } as const;
const FILL = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" } as const;

function QuotaBar({ row }: { row: TenantRow }) {
  const { ratio, resource } = quotaUsage(row);
  const tone = ratioTone(ratio);
  return (
    <div className="flex items-center gap-3" title={`Busiest quota: ${RESOURCE[resource]}`}>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
        <motion.div
          className={cn("h-full rounded-full", FILL[tone], ratio > 1 && "bg-[repeating-linear-gradient(135deg,var(--bad)_0_6px,var(--bad-ink)_6px_9px)]")}
          animate={{ width: `${Math.min(ratio, 1) * 100}%` }}
          transition={springSnappy}
        />
      </div>
      <span className="num w-24 shrink-0 text-xs text-ink-2">
        {fmtPct(ratio)} <span className="text-ink-3">{RESOURCE[resource]}</span>
      </span>
    </div>
  );
}

/** Rounded rows, sticky header, animated sort, inline quota bars. Row click opens the PolicyEditor. */
export function TenantTable({ rows, selectedId, onSelect }: { rows: TenantRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "tenant", dir: 1 });
  const reduced = useReducedMotionSafe();
  const sorted = sortRows(rows, sort.key, sort.dir);
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "tenant" || key === "tier" ? 1 : -1 }));

  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)]">
    <div role="table" aria-label="Tenants" className="min-w-[960px] rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-1)]">
      <div role="row" className={cn(GRID, "sticky top-0 z-10 h-12 rounded-t-[var(--r-lg)] border-b border-line bg-surface/95 backdrop-blur")}>
        {COLS.map((c) => {
          const active = sort.key === c.key;
          return (
            <div key={c.key} role="columnheader" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn(c.align === "right" && "text-right")}>
              <button
                type="button"
                onClick={() => toggle(c.key)}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-full px-2 text-[13px] font-semibold tracking-[0.02em] outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)]",
                  active ? "text-ultra-600" : "text-ink-2",
                  c.align === "right" && "-mr-2",
                )}
              >
                {c.label}
                {active ? sort.dir === 1 ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden /> : null}
              </button>
            </div>
          );
        })}
        <span aria-hidden />
      </div>
      <ul className="flex flex-col gap-1 p-2">
        {sorted.map((r) => {
          const m = r.metrics;
          const color = tenantColor(r.id);
          return (
            <motion.li key={r.id} layout={reduced ? false : "position"} transition={springSnappy} role="presentation">
              <motion.button
                type="button"
                role="row"
                onClick={() => onSelect(r.id)}
                aria-label={`Edit policy for ${r.id}`}
                aria-selected={selectedId === r.id}
                whileHover={reduced ? undefined : { y: -2 }}
                transition={springSnappy}
                className={cn(
                  GRID,
                  "h-[60px] w-full rounded-[var(--r-md)] text-left outline-none transition-colors hover:bg-ultra-50 hover:shadow-[var(--shadow-1)] focus-visible:shadow-[var(--ring)]",
                  selectedId === r.id && "bg-ultra-50 ring-2 ring-ultra",
                )}
              >
                <span role="cell" className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[12px] font-display text-[15px] font-bold text-white" style={{ background: color }} aria-hidden>
                    {r.id.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate text-[15px] font-semibold">{r.id}</span>
                </span>
                <span role="cell">
                  <Badge tone={TIER_TONE[r.tier]}>{r.tier}</Badge>
                </span>
                <span role="cell">
                  <LadderBadge level={r.level} size="sm" />
                </span>
                <span role="cell" className="num text-right text-[15px]">{m ? fmtNum(m.rps, 0) : "–"}</span>
                <span role="cell" className="num text-right text-[15px]">{m ? fmtMs(m.p99_ms) : "–"}</span>
                <span role="cell" className="num text-right text-[15px]">{m ? fmtPct(m.cpu_share) : "–"}</span>
                <span role="cell">
                  <QuotaBar row={r} />
                </span>
                <ChevronRight className="size-4 text-ink-3" aria-hidden />
              </motion.button>
            </motion.li>
          );
        })}
      </ul>
    </div>
    </div>
  );
}
