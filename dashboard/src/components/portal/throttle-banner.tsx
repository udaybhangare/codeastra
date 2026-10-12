"use client";
import { AnimatePresence, motion } from "motion/react";
import { HeartHandshake, Hourglass } from "lucide-react";
import { LadderBadge } from "@/components/domain/ladder-badge";
import { fmtDuration } from "@/lib/format";
import { springBouncy, useReducedMotionSafe } from "@/lib/motion";
import { explainCause, recoveryRemaining, secondsSince, whatYouCanDo } from "@/lib/portal-view";
import type { Throttle } from "@/lib/portal";
import { cn } from "@/lib/utils";
import type { Level } from "@/lib/ws-types";

/** Appears (springBouncy) only while the tenant is throttled; calm, plain-English, never punitive. */
export function ThrottleBanner({ throttle, level, calmSince, now, onDetails }: { throttle: Throttle | null; level: Level; calmSince: number | null; now: number; onDetails?: () => void }) {
  const reduced = useReducedMotionSafe();
  const { cause, actions } = explainCause(throttle);
  const left = recoveryRemaining(calmSince, now);
  const since = secondsSince(throttle?.since, now);
  const bad = level >= 3;
  return (
    <AnimatePresence initial={false}>
      {level > 0 && (
        <motion.section
          key="banner"
          role={bad ? "alert" : "status"}
          aria-labelledby="throttle-h"
          initial={reduced ? false : { opacity: 0, scale: 0.9, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
          transition={springBouncy}
          className={cn("rounded-[var(--r-lg)] border p-5 sm:p-6", bad ? "border-bad bg-bad-100" : "border-warn bg-warn-100")}
        >
          <div className="flex flex-wrap items-center gap-3">
            <LadderBadge level={level} size="lg" />
            <h2 id="throttle-h" className="text-[20px]">
              {bad ? "We're giving your compartment a breather" : "We're pacing your traffic"}
              {since !== null && <span className="num ml-2 text-[15px] font-medium text-ink-2">for {fmtDuration(since)}</span>}
            </h2>
          </div>
          <div className="mt-4 grid gap-5 md:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="text-[15px]"><span className="font-semibold">Why: </span>{cause}</p>
              {actions.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[15px] text-ink-2">
                  {actions.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}
              <p className="mt-3 flex items-center gap-2 text-[15px] font-semibold">
                <Hourglass className="size-4 shrink-0" aria-hidden />
                {left === null ? (
                  <span>Recovery starts once your usage is back inside your plan, then takes about 20 s.</span>
                ) : left > 0 ? (
                  <span>Expected recovery in ~<span className="num">{left}</span> s</span>
                ) : (
                  <span>Limits should ease off any moment now.</span>
                )}
              </p>
            </div>
            <div className="rounded-[var(--r-md)] bg-surface/70 p-4">
              <h3 className="flex items-center gap-2 text-[15px]"><HeartHandshake className="size-4 text-ultra" aria-hidden />What you can do</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-ink-2">
                {whatYouCanDo(level).map((t) => <li key={t}>{t}</li>)}
              </ul>
              {onDetails && (
                <button type="button" onClick={onDetails} className="mt-3 rounded-full text-[13px] font-semibold text-ultra underline underline-offset-4 outline-none focus-visible:shadow-[var(--ring)]">
                  See your usage details
                </button>
              )}
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
