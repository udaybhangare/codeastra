"use client";
import { X } from "lucide-react";
import { useMemo } from "react";
import { Hull } from "@/components/hull/Hull";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { tenantColor } from "@/lib/colors";
import { toHullTenants } from "@/lib/hull";
import { effectiveIsolation } from "@/lib/overview";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";

export function HullCard({ selected, onSelect, onHover }: { selected: string | null; onSelect: (id: string | null) => void; onHover?: (id?: string) => void }) {
  const snap = useStream((s) => s.latest);
  const source = useStream((s) => s.source);
  const presentation = useUi((s) => s.presentation);
  const mockIso = useUi((s) => s.mockIsolation);
  const tenants = useMemo(() => (snap ? toHullTenants(snap) : []), [snap]);
  const iso = effectiveIsolation(snap?.isolation, source, mockIso) ?? "on";

  return (
    <Card
      className={presentation ? "col-span-7 flex min-w-0 flex-col pb-3 max-[1023px]:col-span-12" : "col-span-5 flex min-w-0 flex-col pb-3 max-[1023px]:col-span-12"}
      eyebrow="Tenant map"
      title="Each tenant in its own compartment"
      actions={
        selected ? (
          <button type="button" onClick={() => onSelect(null)} className="rounded-full outline-none focus-visible:shadow-[var(--ring)]" aria-label={`Clear filter ${selected}`}>
            <Badge tone="brand" className="h-8 gap-1.5">
              <span className="size-2 rounded-full" style={{ background: tenantColor(selected) }} aria-hidden />
              {selected}
              <X className="size-3.5" aria-hidden />
            </Badge>
          </button>
        ) : (
          <span className="text-[13px] text-ink-3">Click a compartment to filter</span>
        )
      }
    >
      <div className="flex flex-1 items-center justify-center px-3 pt-1">
        {snap ? (
          <Hull
            mode="mini"
            tenants={tenants}
            isolation={iso}
            highlightId={selected ?? undefined}
            host={snap.host}
            onHover={onHover}
            onSelect={(id) => onSelect(id === selected ? null : id)}
            className={presentation ? "mx-auto h-[300px]!" : "mx-auto h-[196px]!"}
          />
        ) : (
          <Skeleton className="h-[196px] w-full max-w-[420px]" />
        )}
      </div>
    </Card>
  );
}
