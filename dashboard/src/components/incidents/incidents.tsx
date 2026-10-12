"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { LadderBadge } from "@/components/domain/ladder-badge";
import { PageFrame } from "@/components/shell/page-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/segmented";
import { tenantColor } from "@/lib/colors";
import { eventId, sentence } from "@/lib/evidence";
import { DEFAULT_FILTER, filterEvents, groupIncidents, type IncidentFilter, type KindFilter, type MinLevel, type RangeFilter } from "@/lib/incidents";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import type { Level, StreamEvent } from "@/lib/ws-types";
import { DecisionDrawer } from "./decision-drawer";
import { IncidentTimeline } from "./incident-timeline";

const clock = (ts: string) => new Date(ts).toISOString().slice(11, 19);
const SOURCE_KINDS: StreamEvent["kind"][] = ["throttle", "predict", "oom", "isolation", "admin"];

export function whyHref(e: StreamEvent) {
  return `/incidents?e=${encodeURIComponent(eventId(e))}`;
}

const LEVEL_OPTS = [
  { value: "0", label: "All levels" },
  { value: "1", label: "L1+" },
  { value: "3", label: "L3+" },
  { value: "5", label: "L5" },
] as const;
const KIND_OPTS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "throttle", label: "Throttle" },
  { value: "predict", label: "Predict" },
  { value: "oom", label: "OOM" },
  { value: "isolation", label: "Isolation" },
  { value: "admin", label: "Admin" },
];
const RANGE_OPTS: { value: RangeFilter; label: string }[] = [
  { value: "1m", label: "Last 1 min" },
  { value: "5m", label: "Last 5 min" },
  { value: "all", label: "All" },
];

export function Incidents() {
  const all = useStream((s) => s.events);
  const tenantIds = useStream((s) => s.tenantIds);
  const latestTs = useStream((s) => s.latest?.ts);
  const presentation = useUi((s) => s.presentation);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const urlId = params.get("e");

  const [filter, setFilter] = useState<IncidentFilter>(DEFAULT_FILTER);
  const [open, setOpen] = useState(urlId !== null);
  const [picked, setPicked] = useState<StreamEvent | null>(null);

  // Deep link: adopt the event named in the URL once it is in the store (derive-during-render, no effect).
  const urlEvent = urlId ? (all.find((e) => eventId(e) === urlId) ?? null) : null;
  if (urlEvent && (!picked || eventId(picked) !== urlId) && open) setPicked(urlEvent);

  const relevant = useMemo(() => all.filter((e) => SOURCE_KINDS.includes(e.kind)), [all]);
  // Clock anchor = newest thing the stream told us about (no wall-clock reads).
  const now = useMemo(() => {
    const snap = latestTs ? Date.parse(latestTs) : 0;
    const ev = relevant.reduce((m, e) => Math.max(m, Date.parse(e.ts)), 0);
    return Math.max(snap, ev);
  }, [latestTs, relevant]);
  const events = useMemo(() => filterEvents(relevant, filter, now), [relevant, filter, now]);
  const incidents = useMemo(() => groupIncidents(events), [events]);
  const tenants = useMemo(() => [...new Set([...tenantIds, ...relevant.map((e) => e.tenant_id)])].sort(), [tenantIds, relevant]);

  const select = (e: StreamEvent) => {
    setPicked(e);
    setOpen(true);
    router.replace(`${path}?e=${encodeURIComponent(eventId(e))}`, { scroll: false });
  };
  const close = () => {
    setOpen(false);
    router.replace(path, { scroll: false });
  };
  const selectedId = open && picked ? eventId(picked) : null;
  const filtered = filter !== DEFAULT_FILTER && (filter.tenant !== "all" || filter.minLevel !== 0 || filter.kind !== "all" || filter.range !== "all");

  return (
    <PageFrame subtitle="Every automated step on the throttle ladder. Pick a node or a card to see why it happened.">
      <h1 className="sr-only">Incidents</h1>

      <div className={presentation ? "hidden" : "col-span-12 flex flex-wrap items-center gap-3"}>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
          Tenant
          <select
            value={filter.tenant}
            onChange={(e) => setFilter({ ...filter, tenant: e.target.value })}
            className="h-9 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink outline-none focus-visible:shadow-[var(--ring)]"
          >
            <option value="all">All tenants</option>
            {tenants.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          aria-label="Minimum ladder level"
          value={String(filter.minLevel) as "0" | "1" | "3" | "5"}
          onValueChange={(v) => setFilter({ ...filter, minLevel: Number(v) as MinLevel })}
          options={LEVEL_OPTS}
        />
        <Segmented aria-label="Event kind" value={filter.kind} onValueChange={(kind) => setFilter({ ...filter, kind })} options={KIND_OPTS} />
        <Segmented aria-label="Time range" value={filter.range} onValueChange={(range) => setFilter({ ...filter, range })} options={RANGE_OPTS} />
        {filtered ? (
          <Button variant="ghost" size="sm" onClick={() => setFilter(DEFAULT_FILTER)}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {relevant.length === 0 ? (
        <div className="col-span-12">
          <EmptyState
            title="No decisions yet"
            help="When a tenant starts hurting its neighbours, every automated action lands here with a plain-English explanation. Run a scenario to see one."
          />
        </div>
      ) : events.length === 0 ? (
        <div className="col-span-12">
          <EmptyState
            title="Nothing matches these filters"
            help="Widen the time range or clear the filters."
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilter(DEFAULT_FILTER)}>
                Clear filters
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <Card className="col-span-12 min-w-0 pb-4" eyebrow="History" title="What Bulkhead did, step by step">
            <div className="px-5 pt-3">
              <IncidentTimeline events={events} now={now} selectedId={selectedId} onSelect={select} />
              <p className={presentation ? "hidden" : "mt-2 text-[13px] text-ink-2"}>
                One lane per tenant. Door icon = ladder level entered; bar = how long it stayed there. Dashed ultramarine node = predicted, not yet applied.
              </p>
            </div>
          </Card>

          <div className="col-span-12 grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
            {incidents.map((inc) => (
              <Card key={inc.culprit} className="min-w-0 pb-3" interactive={false}>
                <div className="flex items-center gap-3 px-5 pt-4">
                  <span className="size-3 rounded-full" style={{ background: tenantColor(inc.culprit) }} aria-hidden />
                  <h3 className="min-w-0 flex-1 truncate">{inc.culprit}</h3>
                  <LadderBadge level={inc.peak as Level} size="sm" />
                  <Badge tone={inc.active ? "bad" : "ok"}>{inc.active ? "Active" : "Recovered"}</Badge>
                </div>
                <ul className="mt-2 flex flex-col px-3">
                  {inc.events.slice(0, 6).map((e) => {
                    const id = eventId(e);
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => select(e)}
                          className={`flex w-full items-center gap-3 rounded-[var(--r-md)] px-2 py-2 text-left outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)] ${selectedId === id ? "bg-ultra-50" : ""}`}
                        >
                          <span className="num w-[62px] shrink-0 text-[13px] text-ink-2">{clock(e.ts)}</span>
                          {e.to_level !== undefined ? <LadderBadge level={e.to_level as Level} size="sm" /> : <Badge>{e.kind}</Badge>}
                          <span className="min-w-0 flex-1 truncate text-[14px]">{sentence(e)}</span>
                          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-ultra">
                            <HelpCircle className="size-4" aria-hidden />
                            Why?
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {inc.events.length > 6 ? <p className="px-5 pt-1 text-[13px] text-ink-2">+{inc.events.length - 6} earlier steps on the timeline</p> : null}
              </Card>
            ))}
          </div>
        </>
      )}

      <DecisionDrawer event={picked} open={open} onClose={close} />
    </PageFrame>
  );
}
