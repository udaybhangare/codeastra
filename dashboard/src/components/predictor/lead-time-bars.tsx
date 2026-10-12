"use client";
import { motion } from "motion/react";
import { springSnappy } from "@/lib/motion";
import { fmtNum } from "@/lib/format";
import { MODEL_LABEL, type AlertStats, type ModelId } from "@/lib/predictor";
import { cn } from "@/lib/utils";

const ORDER: ModelId[] = ["baseline", "gbm"];

function Group({ id, stats, active }: { id: ModelId; stats: AlertStats | null; active: boolean }) {
  const leads = stats?.leads.slice(0, 6) ?? [];
  const max = Math.max(30, ...leads.map((l) => l.leadS));
  return (
    <div className={cn("rounded-[var(--r-md)] border p-4", active ? "border-ultra bg-ultra-50" : "border-dashed border-line")}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-display text-[17px] font-semibold">{MODEL_LABEL[id]}</span>
        <span className="text-[13px] font-semibold text-ink-2">{active ? "Active now" : "Not measured this session"}</span>
      </div>
      {!active ? (
        <p className="text-[13px] text-ink-2">Switch the model and replay a scenario to measure it. Offline comparison: <span className="num">predictor/eval.py</span>.</p>
      ) : leads.length === 0 ? (
        <p className="text-[13px] text-ink-2">No forecasted escalation observed yet. Run a scenario to measure lead time.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {leads.map((l) => (
            <li key={l.eventTs} className="flex items-center gap-3">
              <span className="w-20 shrink-0 truncate text-[13px] font-semibold">{l.tenant}</span>
              <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
                <motion.div className="h-full rounded-full bg-ultra" initial={false} animate={{ width: `${(l.leadS / max) * 100}%` }} transition={springSnappy} />
              </div>
              <span className="num w-16 shrink-0 text-right text-[15px] font-medium">
                {l.atLeast ? "≥" : ""}
                {fmtNum(l.leadS, 0)}s
              </span>
            </li>
          ))}
        </ul>
      )}
      {active && stats ? (
        <dl className="num mt-4 grid grid-cols-3 gap-2 text-center text-xs text-ink-2">
          <div className="rounded-[var(--r-sm)] bg-surface p-2"><dt>Alerts</dt><dd className="text-[20px] font-medium text-ink">{stats.alerts}</dd></div>
          <div className="rounded-[var(--r-sm)] bg-surface p-2"><dt>Acted on</dt><dd className="text-[20px] font-medium text-ink">{stats.actedOn}</dd></div>
          <div className="rounded-[var(--r-sm)] bg-surface p-2" title="Alerts with no ladder escalation within 30 s: possible false alarms">
            <dt>No follow-up</dt><dd className="text-[20px] font-medium text-ink">{stats.noFollowUp}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

/** Lead time (forecast crossing → ladder escalation) per model; only the active model has live data. */
export function LeadTimeBars({ active, stats }: { active: ModelId | null; stats: AlertStats }) {
  return (
    <div className="flex flex-col gap-3">
      {ORDER.map((id) => (
        <Group key={id} id={id} active={active === id} stats={active === id ? stats : null} />
      ))}
      {active === null ? <p className="text-[13px] text-ink-2">Model status is unavailable, so lead times cannot be attributed to a model.</p> : null}
    </div>
  );
}
