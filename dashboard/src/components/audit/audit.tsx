"use client";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Download, ExternalLink, Pause, Play, Radar, OctagonAlert, ShieldAlert, ToggleRight, UserCog, FileJson, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { tenantColor, type Tone } from "@/lib/colors";
import { actorOf, DEFAULT_AUDIT_FILTER, filterAudit, fromApi, mergeEvents, newestTs, toCsv, windowRows, type ApiEvent, type AuditFilter, type AuditRange } from "@/lib/audit";
import { describeAction, eventId, parseEvidence, sentence } from "@/lib/evidence";
import { exportCsv, exportEventJson } from "@/lib/export";
import { fmtNum } from "@/lib/format";
import { springSnappy, useReducedMotionSafe } from "@/lib/motion";
import { useStream } from "@/lib/store";
import { usePoll } from "@/lib/use-poll";
import { cn } from "@/lib/utils";
import type { Level, StreamEvent } from "@/lib/ws-types";
import { DecisionDrawer } from "../incidents/decision-drawer";
import { LadderBadge } from "../domain/ladder-badge";
import { PageFrame } from "../shell/page-frame";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { EmptyState, ErrorState } from "../ui/states";

const KINDS: Record<StreamEvent["kind"], { label: string; icon: LucideIcon; tone: Tone }> = {
  throttle: { label: "Throttle", icon: ShieldAlert, tone: "warn" },
  predict: { label: "Forecast", icon: Radar, tone: "predict" },
  oom: { label: "Out of memory", icon: OctagonAlert, tone: "bad" },
  isolation: { label: "Isolation", icon: ToggleRight, tone: "brand" },
  admin: { label: "Admin", icon: UserCog, tone: "neutral" },
};
const RANGES = [
  { value: "5m", label: "5 min" },
  { value: "1h", label: "1 h" },
  { value: "all", label: "All" },
] as const;
const VIRTUALISE_ABOVE = 200;
const ROW_H = 64;
const EXPANDED_H = 320;
const VIEWPORT_H = 640;
const FRESH_MS = 3000;
const GRID = "grid grid-cols-[76px_150px_140px_minmax(0,1fr)_170px_96px_40px] items-center gap-3 px-4";

const time = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleTimeString("en-GB");
};

function Detail({ e }: { e: StreamEvent }) {
  const ev = parseEvidence(e.evidence);
  const actions = (e.actions ?? []).map(describeAction);
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto rounded-[var(--r-md)] bg-paper-2 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {ev.score !== undefined ? <Badge tone="neutral" className="num">score {fmtNum(ev.score, 2)}{ev.tau !== undefined ? ` / τ ${fmtNum(ev.tau, 2)}` : ""}</Badge> : null}
        {ev.predictor !== undefined ? <Badge tone="predict" className="num">forecast {Math.round(ev.predictor * 100)}%</Badge> : null}
        {ev.note ? <span className="text-ink-2">{ev.note}</span> : null}
      </div>
      {actions.length ? (
        <ul className="list-disc pl-5 text-[13px] text-ink-2">
          {actions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      ) : null}
      <pre className="num min-h-0 flex-1 overflow-auto rounded-[var(--r-sm)] bg-surface p-3 text-xs">{JSON.stringify({ evidence: e.evidence ?? null, actions: e.actions ?? [] }, null, 2)}</pre>
    </div>
  );
}

function Row({
  e,
  open,
  fresh,
  onToggle,
  onWhy,
}: {
  e: StreamEvent;
  open: boolean;
  fresh: boolean;
  onToggle: () => void;
  onWhy: () => void;
}) {
  const reduced = useReducedMotionSafe();
  const k = KINDS[e.kind] ?? KINDS.admin;
  const Icon = k.icon;
  return (
    <motion.li
      initial={fresh && !reduced ? { opacity: 0, y: -16, backgroundColor: "var(--lime)" } : false}
      animate={{ opacity: 1, y: 0, backgroundColor: "rgba(200,241,105,0)" }}
      transition={{ ...springSnappy, backgroundColor: { duration: 1.4 } }}
      className="rounded-[var(--r-md)] border-b border-line/60 last:border-0"
      style={{ height: open ? ROW_H + EXPANDED_H : ROW_H }}
    >
      <div className={cn(GRID, "h-16")}>
        <span className="num text-xs text-ink-2">{time(e.ts)}</span>
        <span><Badge tone={k.tone} icon={<Icon />}>{k.label}</Badge></span>
        <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: e.tenant_id ? tenantColor(e.tenant_id) : "var(--line)" }} aria-hidden />
          <span className="truncate">{e.tenant_id || "—"}</span>
        </span>
        <span className="truncate text-[15px]" title={sentence(e)}>{sentence(e)}</span>
        <span className="flex items-center gap-1">
          {e.from_level !== undefined && e.to_level !== undefined ? (
            <>
              <LadderBadge level={e.from_level as Level} size="sm" />
              <span aria-label="to">→</span>
              <LadderBadge level={e.to_level as Level} size="sm" />
            </>
          ) : null}
        </span>
        <span><Badge tone="neutral" className="max-w-full truncate">{actorOf(e)}</Badge></span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Hide evidence" : "Show evidence"}
          onClick={onToggle}
          className="grid size-10 place-items-center rounded-full outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)]"
        >
          <ChevronDown className={cn("size-5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 px-4 pb-3" style={{ height: EXPANDED_H }}>
          <div className="min-h-0 flex-1"><Detail e={e} /></div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={onWhy}>Why drawer</Button>
            <Link
              href={`/incidents?e=${encodeURIComponent(eventId(e))}`}
              className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-ink bg-paper px-4 text-[13px] font-semibold outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)]"
            >
              <ExternalLink className="size-4" aria-hidden /> Open in Incidents
            </Link>
            <Button size="sm" variant="ghost" icon={<FileJson />} onClick={() => exportEventJson(e, `bulkhead-event-${e.tenant_id || "host"}-${Date.parse(e.ts) || 0}.json`)}>
              JSON
            </Button>
          </div>
        </div>
      ) : null}
    </motion.li>
  );
}

export function Audit() {
  const stream = useStream((s) => s.events);
  const { data, error, loading } = usePoll<ApiEvent[]>("/admin/events?limit=200", 3000);
  const [filter, setFilter] = useState<AuditFilter>(DEFAULT_AUDIT_FILTER);
  const [cutoff, setCutoff] = useState<number | null>(null); // null = live tail on
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [why, setWhy] = useState<StreamEvent | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);

  const all = useMemo(() => mergeEvents(stream, (data ?? []).map(fromApi)), [stream, data]);
  const anchor = useMemo(() => newestTs(all), [all]);
  const tenants = useMemo(() => [...new Set(all.map((e) => e.tenant_id).filter(Boolean))].sort(), [all]);
  const actors = useMemo(() => [...new Set(all.map(actorOf))].sort(), [all]);
  const matching = useMemo(() => filterAudit(all, filter, anchor), [all, filter, anchor]);
  const rows = useMemo(() => (cutoff === null ? matching : matching.filter((e) => Date.parse(e.ts) <= cutoff)), [matching, cutoff]);
  const pending = matching.length - rows.length;

  const virtual = rows.length > VIRTUALISE_ABOVE;
  const ids = useMemo(() => rows.map((e) => eventId(e)), [rows]);
  const slice = useMemo(
    () => (virtual ? windowRows(ids.map((id) => (expanded.has(id) ? ROW_H + EXPANDED_H : ROW_H)), scrollTop, VIEWPORT_H) : null),
    [virtual, ids, expanded, scrollTop],
  );
  const shown = slice ? rows.slice(slice.start, slice.end) : rows;
  const set = <K extends keyof AuditFilter>(k: K, v: AuditFilter[K]) => setFilter((f) => ({ ...f, [k]: v }));
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const filtered = JSON.stringify(filter) !== JSON.stringify(DEFAULT_AUDIT_FILTER);
  const opt = (xs: string[], all: string) => [{ value: "all", label: all }, ...xs.map((x) => ({ value: x, label: x }))];

  return (
    <PageFrame
      subtitle="Every automated and manual decision with the evidence behind it. Expand a row for the raw evidence, or open it in Incidents."
      actions={
        <>
          <Button size="sm" variant="secondary" icon={<Download />} disabled={rows.length === 0} onClick={() => exportCsv(toCsv(rows), "bulkhead-audit.csv")}>CSV</Button>
          <Button size="sm" variant="secondary" icon={<FileJson />} disabled={rows.length === 0} onClick={() => exportEventJson(rows, "bulkhead-audit.json")}>JSON</Button>
        </>
      }
    >
      <div className="col-span-12 flex flex-wrap items-end gap-3 rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2">Search</span>
          <Input value={filter.q} onChange={(e) => set("q", e.target.value)} placeholder="tenant, reason, note…" />
        </label>
        <div className="flex w-40 flex-col gap-1">
          <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2">Kind</span>
          <Select aria-label="Kind" value={filter.kind} onValueChange={(v) => set("kind", v as AuditFilter["kind"])} options={[{ value: "all", label: "All kinds" }, ...Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label }))]} />
        </div>
        <div className="flex w-40 flex-col gap-1">
          <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2">Tenant</span>
          <Select aria-label="Tenant" value={filter.tenant} onValueChange={(v) => set("tenant", v)} options={opt(tenants, "All tenants")} />
        </div>
        <div className="flex w-40 flex-col gap-1">
          <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2">Actor</span>
          <Select aria-label="Actor" value={filter.actor} onValueChange={(v) => set("actor", v)} options={opt(actors, "All actors")} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold tracking-[0.02em] text-ink-2">Window</span>
          <Segmented aria-label="Time window" value={filter.range} onValueChange={(v: AuditRange) => set("range", v)} options={RANGES} />
        </div>
        <Button
          variant={cutoff === null ? "soft" : "secondary"}
          icon={cutoff === null ? <Pause /> : <Play />}
          aria-pressed={cutoff === null}
          onClick={() => setCutoff(cutoff === null ? anchor : null)}
        >
          {cutoff === null ? "Live tail on" : `Resume${pending ? ` · ${pending} new` : ""}`}
        </Button>
      </div>

      <div className="col-span-12">
        {error && !data && all.length === 0 ? (
          <ErrorState message={error} />
        ) : loading && all.length === 0 ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-[var(--r-md)]" />)}
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            title="No decisions recorded yet"
            help="Run a scenario and every throttle step will land here with its evidence."
            action={<Link href="/scenarios" className="inline-flex h-11 items-center rounded-full bg-ultra px-5 text-[15px] font-semibold text-white">Open Scenario Lab</Link>}
          />
        ) : rows.length === 0 ? (
          <EmptyState title="No events match these filters" action={filtered ? <Button variant="soft" onClick={() => setFilter(DEFAULT_AUDIT_FILTER)}>Clear filters</Button> : undefined} />
        ) : (
          <div className="rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-1)]">
            <div className={cn(GRID, "h-11 border-b border-line text-[13px] font-semibold tracking-[0.02em] text-ink-2")} aria-hidden>
              <span>Time</span><span>Kind</span><span>Tenant</span><span>What happened</span><span>Change</span><span>Actor</span><span />
            </div>
            <div
              className="overflow-auto p-2"
              style={{ maxHeight: VIEWPORT_H }}
              onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
              tabIndex={0}
              aria-label={`${rows.length} audit events`}
            >
              <div style={slice ? { paddingTop: slice.padTop, paddingBottom: slice.padBottom } : undefined}>
                <AnimatePresence initial={false}>
                  <ul>
                    {shown.map((e) => {
                      const id = eventId(e);
                      return (
                        <Row
                          key={id}
                          e={e}
                          open={expanded.has(id)}
                          fresh={cutoff === null && !virtual && anchor - Date.parse(e.ts) < FRESH_MS}
                          onToggle={() => toggle(id)}
                          onWhy={() => {
                            setWhy(e);
                            setWhyOpen(true);
                          }}
                        />
                      );
                    })}
                  </ul>
                </AnimatePresence>
              </div>
            </div>
            <div className="num border-t border-line px-4 py-2 text-xs text-ink-2">
              {rows.length} shown of {all.length}{virtual ? " · virtualised" : ""}
            </div>
          </div>
        )}
      </div>
      <DecisionDrawer event={why} open={whyOpen} onClose={() => setWhyOpen(false)} />
    </PageFrame>
  );
}
