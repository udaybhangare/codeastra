"use client";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Brain, Gauge, HelpCircle, ShieldAlert, UserCog, type LucideIcon } from "lucide-react";
import { tenantColor } from "@/lib/colors";
import { eventId } from "@/lib/evidence";
import { springSnappy } from "@/lib/motion";
import { useStream } from "@/lib/store";
import type { StreamEvent } from "@/lib/ws-types";

const ICON: Record<StreamEvent["kind"], LucideIcon> = {
  throttle: Gauge,
  predict: Brain,
  oom: ShieldAlert,
  isolation: ShieldAlert,
  admin: UserCog,
};
const clock = (ts: string) => (ts.length >= 19 ? ts.slice(11, 19) : ts);
const ROWS = 5;
const ROW_H = 28;

export function LiveFeed({ selected, onWhy }: { selected: string | null; onWhy: (e: StreamEvent) => void }) {
  const events = useStream((s) => s.events);
  const rows = events.filter((e) => !selected || e.tenant_id === selected).slice(0, ROWS);

  return (
    <div style={{ minHeight: ROWS * ROW_H }} aria-live="off">
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 py-1 text-[13px] text-ink-3">
          <Activity className="size-4" aria-hidden /> Decisions appear here the moment they happen.
        </p>
      ) : (
        <ul className="flex flex-col">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((e) => {
              const Icon = ICON[e.kind] ?? Activity;
              return (
                <motion.li
                  key={eventId(e)}
                  layout
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={springSnappy}
                  style={{ height: ROW_H }}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <span className="num w-[58px] shrink-0 text-xs text-ink-3">{clock(e.ts)}</span>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: tenantColor(e.tenant_id) }} aria-hidden />
                  <Icon className="size-3.5 shrink-0 text-ink-2" aria-label={e.kind} />
                  <span className="min-w-0 flex-1 truncate" title={e.message}>{e.message}</span>
                  <button
                    type="button"
                    onClick={() => onWhy(e)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-ultra-600 outline-none hover:bg-ultra-100 focus-visible:shadow-[var(--ring)]"
                  >
                    <HelpCircle className="size-3.5" aria-hidden /> Why?
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
