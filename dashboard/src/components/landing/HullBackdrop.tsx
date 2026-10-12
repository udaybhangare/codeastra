"use client";
// Fixed hull canvas behind the landing content (docs/ui/03 `landing` mode).
import { useEffect, useMemo, useState } from "react";
import { Hull } from "@/components/hull/Hull";
import { useReducedMotionSafe } from "@/lib/motion";
import { useLanding } from "./scroll-store";
import { scriptedTenants } from "./scripted";

export function HullBackdrop() {
  const progress = useLanding((s) => s.progress);
  const isolation = useLanding((s) => s.isolation);
  const surge = useLanding((s) => s.surge);
  const markHinted = useLanding((s) => s.markHinted);
  const reduced = useReducedMotionSafe();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [reduced]);

  const tenants = useMemo(() => scriptedTenants(tick, surge, isolation), [tick, surge, isolation]);

  return (
    <Hull
      mode="landing"
      tenants={tenants}
      isolation={isolation}
      scrollProgress={reduced ? undefined : progress}
      reducedMotion={reduced}
      host={{ cpu_util: surge ? 0.78 : 0.42, mem_util: 0.36 }}
      onSelect={markHinted}
      // Desktop: hull on the right, text left. Mobile: sticky half-height canvas on top.
      className="md:left-[38%]! max-md:bottom-auto! max-md:h-[46vh]!"
    />
  );
}
