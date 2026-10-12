"use client";
import { useCallback, useState } from "react";
import { DecisionDrawer } from "@/components/incidents/decision-drawer";
import { Card } from "@/components/ui/card";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { useKpiHistory } from "@/lib/use-kpi-history";
import type { StreamEvent } from "@/lib/ws-types";
import { ActiveThrottles } from "./active-throttles";
import { CompartmentHeatmap } from "./compartment-heatmap";
import { HullCard } from "./hull-card";
import { KpiStrip } from "./kpi-strip";
import { LatencyChart } from "./latency-chart";
import { LiveFeed } from "./live-feed";

/** Bento command center (docs/ui/05 §1). Everything reads the live store; no REST polling. */
export function Overview() {
  const presentation = useUi((s) => s.presentation);
  const { since } = useKpiHistory();
  const [picked, setSelected] = useState<string | null>(null);
  const [why, setWhy] = useState<StreamEvent | null>(null);
  const tenantIds = useStream((s) => s.tenantIds);
  const [whyOpen, setWhyOpen] = useState(false);
  const openWhy = useCallback((e: StreamEvent) => {
    setWhy(e);
    setWhyOpen(true);
  }, []);
  const closeWhy = useCallback(() => setWhyOpen(false), []);

  // A filter on a tenant that left the stream is ignored (derived, no effect).
  const selected = picked && (tenantIds.length === 0 || tenantIds.includes(picked)) ? picked : null;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 pb-8 min-[1440px]:px-12">
      <h1 className="sr-only">Overview</h1>
      <div className="grid grid-cols-12 gap-4">
        <KpiStrip />
        <HullCard selected={selected} onSelect={setSelected} />
        <CompartmentHeatmap selected={selected} onSelect={setSelected} />
        <LatencyChart selected={selected} />
        <Card className="col-span-4 min-w-0 pb-4 max-[1023px]:col-span-12" eyebrow="Right now" title="Who is being limited">
          <div className="flex flex-col gap-3 px-5 pt-3">
            <ActiveThrottles selected={selected} since={since} onWhy={openWhy} />
            {presentation ? null : (
              <div className="border-t border-line pt-2">
                <div className="mb-1 text-[13px] font-semibold tracking-[0.02em] text-ink-2 uppercase">Live feed</div>
                <LiveFeed selected={selected} onWhy={openWhy} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <DecisionDrawer event={why} open={whyOpen} onClose={closeWhy} />
    </div>
  );
}
