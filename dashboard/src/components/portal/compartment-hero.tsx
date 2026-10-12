"use client";
import { motion } from "motion/react";
import { Hull } from "@/components/hull/Hull";
import { LadderBadge } from "@/components/domain/ladder-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { statusCopy, toPortalHull } from "@/lib/portal-view";
import { tenantColor } from "@/lib/colors";
import { fmtDuration } from "@/lib/format";
import type { Live } from "@/lib/portal";
import { useReducedMotionSafe } from "@/lib/motion";
import type { Level } from "@/lib/ws-types";

const TIER_LABEL: Record<string, string> = { free: "Free plan", pro: "Pro plan", enterprise: "Enterprise plan" };

/** Your own compartment only (never the other tenants), plus one calm sentence about how it is doing. */
export function CompartmentHero({ tenant, tier, level, planRatio, live, ready, recoverySeconds }: { tenant: string; tier: string; level: Level; planRatio: number; live?: Live; ready: boolean; recoverySeconds: number | null }) {
  const reduced = useReducedMotionSafe();
  const copy = statusCopy(level, planRatio * 100);
  const hull = [toPortalHull(tenant, tier, level, planRatio, live)];
  return (
    <Card variant="pop" className="grid items-center gap-6 p-5 sm:p-7 md:grid-cols-[360px_1fr]" id="overview">
      <div className="flex justify-center">
        {ready ? <Hull mode="portal" tenants={hull} isolation="on" highlightId={tenant} reducedMotion={reduced} /> : <Skeleton className="h-[220px] w-full max-w-[360px]" />}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="lime">{TIER_LABEL[tier] ?? `${tier} plan`}</Badge>
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-2">
            <span className="size-3 rounded-full" style={{ background: tenantColor(tenant) }} aria-hidden />
            {tenant}
          </span>
        </div>
        {ready ? (
          <motion.h2
            key={copy.headline}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display mt-3 text-[28px] leading-[1.15] font-bold tracking-[-0.01em] sm:text-[40px] sm:leading-[1.1] sm:tracking-[-0.02em]"
          >
            {copy.headline}
          </motion.h2>
        ) : (
          <Skeleton className="mt-3 h-12 w-full max-w-md" />
        )}
        <p className="mt-2 max-w-[56ch] text-[18px] leading-normal text-ink-2">{copy.sub}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {ready && <LadderBadge level={level} size="lg" />}
          {level > 0 && recoverySeconds !== null && recoverySeconds > 0 && (
            <Badge tone="warn">Back to normal in ~{fmtDuration(recoverySeconds)}</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
