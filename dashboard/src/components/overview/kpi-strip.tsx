"use client";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtPct } from "@/lib/format";
import { delta, effectiveIsolation, series } from "@/lib/overview";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { useKpiHistory } from "@/lib/use-kpi-history";
import { KpiTile, KpiTileSkeleton, type KpiTone } from "./kpi-tile";

const hostTone = (u: number, warn: number, bad: number): KpiTone => (u > bad ? "bad" : u > warn ? "warn" : "ok");

export function KpiStrip() {
  const snap = useStream((s) => s.latest);
  const source = useStream((s) => s.source);
  const mockIso = useUi((s) => s.mockIsolation);
  const { points } = useKpiHistory();

  if (!snap) {
    return (
      <div className="col-span-12 grid grid-cols-5 gap-4 max-[1023px]:grid-cols-3" aria-busy>
        {Array.from({ length: 5 }, (_, i) => <KpiTileSkeleton key={i} />)}
      </div>
    );
  }

  const iso = effectiveIsolation(snap.isolation, source, mockIso);
  const { cpu_util, mem_util } = snap.host;
  const jain = snap.fairness?.jain;
  const infl = snap.fairness?.victim_inflation;
  const throttles = snap.tenants.filter((t) => t.level > 0).length;
  const jainSeries = series(points, "jain");
  const inflSeries = series(points, "inflation");
  const thrSeries = series(points, "throttles");
  const hostWorst = Math.max(cpu_util, mem_util);

  return (
    <div className="col-span-12 grid grid-cols-5 gap-4 max-[1023px]:grid-cols-3">
      <KpiTile
        label="Protection"
        definition="Whether per-tenant admission, fair queueing and throttling are enforced. OFF is the shared-everything baseline."
        tone={iso === "on" ? "ok" : iso === "off" ? "bad" : "neutral"}
        variant="badge"
        badge={
          iso === "on" ? (
            <Badge tone="ok" icon={<ShieldCheck aria-hidden />} className="h-9 px-4 text-base">Isolation ON</Badge>
          ) : iso === "off" ? (
            <Badge tone="bad" icon={<ShieldOff aria-hidden />} className="h-9 px-4 text-base">Isolation OFF</Badge>
          ) : (
            <Badge tone="neutral" className="h-9 px-4 text-base">Unknown</Badge>
          )
        }
      />
      <KpiTile
        label="Server load"
        definition="How busy the server is right now. Outer ring is CPU, inner ring is memory."
        tone={hostWorst > 0.85 ? "bad" : hostWorst > 0.65 ? "warn" : "ok"}
        variant="ring"
        ring={{ outer: cpu_util, inner: mem_util, outerLabel: fmtPct(cpu_util), innerLabel: fmtPct(mem_util) }}
      />
      <KpiTile
        label="Fairness (1.00 = ideal)"
        definition="Jain's index of per-tenant throughput vs entitlement. 1.00 = perfectly fair, lower = someone is hogging."
        tone={jain === undefined ? "neutral" : jain < 0.7 ? "bad" : jain < 0.9 ? "warn" : "ok"}
        value={jain}
        digits={2}
        spark={jainSeries}
        delta={delta(jainSeries)}
        deltaGoodWhen="up"
        deltaDigits={2}
      />
      <KpiTile
        label="Slowdown of others"
        definition="How many times slower the worst-hit well-behaved tenant is than normal. 1.0× means no slowdown."
        tone={infl === undefined ? "neutral" : hostTone(infl, 1.5, 3)}
        value={infl}
        digits={1}
        unit="×"
        spark={inflSeries}
        delta={delta(inflSeries)}
        deltaGoodWhen="down"
        deltaDigits={1}
      />
      <KpiTile
        label="Tenants limited"
        definition="Tenants currently above ladder level 0 (Observe or stricter)."
        tone={throttles === 0 ? "ok" : throttles > 1 ? "bad" : "warn"}
        value={throttles}
        spark={thrSeries}
        delta={delta(thrSeries)}
        deltaGoodWhen="down"
        deltaDigits={0}
      />
    </div>
  );
}
