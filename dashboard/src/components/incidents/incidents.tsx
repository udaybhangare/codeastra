"use client";
import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { useStream } from "@/lib/store";
import { LADDER } from "@/lib/ladder";
import { eventId, sentence } from "@/lib/evidence";
import { LadderBadge } from "../status";
import { WhyDrawer } from "./why-drawer";
import { cn } from "@/lib/utils";
import type { StreamEvent } from "@/lib/ws-types";

const TONE_BG = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" } as const;
const clock = (ts: string) => new Date(ts).toISOString().slice(11, 19);

export function whyHref(e: StreamEvent) {
  return `/incidents?e=${encodeURIComponent(eventId(e))}`;
}

function Timeline({ events, selected }: { events: StreamEvent[]; selected: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const lanes = useMemo(() => [...new Set(events.map((e) => e.tenant_id))].sort(), [events]);
  const times = events.map((e) => Date.parse(e.ts));
  const min = Math.min(...times);
  const span = Math.max(60_000, Math.max(...times) - min);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-2">
        {lanes.map((tenant) => (
          <div key={tenant} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-sm">{tenant}</div>
            <div className="relative h-8 flex-1 rounded bg-muted/50">
              {events
                .filter((e) => e.tenant_id === tenant)
                .map((e) => {
                  const left = ((Date.parse(e.ts) - min) / span) * 100;
                  const id = eventId(e);
                  const tone = LADDER[e.to_level ?? 0]?.tone ?? "warn";
                  return (
                    <button
                      key={id}
                      onClick={() => router.push(`${path}?e=${encodeURIComponent(id)}`)}
                      style={{ left: `calc(${left}% - 12px)` }}
                      title={`${clock(e.ts)} · ${sentence(e)}`}
                      aria-label={`${tenant} to level ${e.to_level ?? "?"} at ${clock(e.ts)}. Open explanation.`}
                      className={cn(
                        "absolute top-1 flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-background ring-offset-2 ring-offset-card hover:scale-110 focus-visible:ring-2",
                        TONE_BG[tone],
                        selected === id && "ring-2 ring-foreground",
                      )}
                    >
                      {e.to_level ?? "·"}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Time runs left → right ({clock(new Date(min).toISOString())} – {clock(new Date(min + span).toISOString())}). Number = ladder level entered.
      </p>
    </div>
  );
}

export function Incidents() {
  const all = useStream((s) => s.events);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const events = useMemo(() => all.filter((e) => e.kind === "throttle" || e.kind === "predict" || e.kind === "oom"), [all]);
  const selectedId = params.get("e");
  const selected = selectedId ? (all.find((e) => eventId(e) === selectedId) ?? null) : null;
  const close = () => router.replace(path);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
      <h1 className="text-lg font-medium">Incidents</h1>
      {events.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No throttle decisions yet. When a tenant starts hurting its neighbours, every automated action appears here with an explanation.
        </div>
      ) : (
        <>
          <Timeline events={events} selected={selectedId} />
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Change</th><th className="px-3 py-2">What happened</th><th className="px-3 py-2"><span className="sr-only">Explain</span></th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={eventId(e)} className={cn("border-t border-border", selectedId === eventId(e) && "bg-muted/40")}>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">{clock(e.ts)}</td>
                    <td className="px-3 py-2">{e.tenant_id}</td>
                    <td className="px-3 py-2">{e.to_level !== undefined ? <LadderBadge level={e.to_level} /> : e.kind}</td>
                    <td className="px-3 py-2">{sentence(e)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={whyHref(e)} className="inline-flex items-center gap-1 text-info hover:underline">
                        <HelpCircle className="size-3.5" aria-hidden />Why?
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {selectedId && <WhyDrawer event={selected} onClose={close} />}
    </div>
  );
}
