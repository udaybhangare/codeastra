"use client";
import { Eye } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, liveApi } from "@/lib/api";
import { buildRows, policyPatch, type ApiTenant, type PolicyDraft, type TenantRow } from "@/lib/policy";
import { useStream } from "@/lib/store";
import { usePoll } from "@/lib/use-poll";
import type { Level } from "@/lib/ws-types";
import { PageFrame } from "../shell/page-frame";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { EmptyState, ErrorState } from "../ui/states";
import { useToast } from "../ui/toast";
import { PolicyEditor } from "./policy-editor";
import { TenantTable } from "./tenant-table";

interface Override {
  policy: TenantRow["policy"];
  /** true once the PUT succeeded; dropped when the next poll lands. */
  confirmed: boolean;
}

export function Tenants() {
  const toast = useToast();
  const latest = useStream((s) => s.latest);
  const { data, error, loading } = usePoll<ApiTenant[]>("/admin/tenants", 4000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [previous, setPrevious] = useState<Record<string, PolicyDraft>>({});

  // Optimistic overrides live until the poll after their confirmation replaces them.
  const seenData = useRef(data);
  useEffect(() => {
    if (seenData.current === data) return;
    seenData.current = data;
    setOverrides((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !v.confirmed)));
  }, [data]);

  const rows = useMemo(() => {
    const base = buildRows(data, latest?.tenants ?? []);
    return base.map((r) => (overrides[r.id] ? { ...r, policy: overrides[r.id].policy } : r));
  }, [data, latest, overrides]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const setOverride = (id: string, v: Override | null) =>
    setOverrides((o) => {
      const n = { ...o };
      if (v) n[id] = v;
      else delete n[id];
      return n;
    });

  const put = async (row: TenantRow, before: PolicyDraft, after: PolicyDraft, verb: string) => {
    const { tier, ...fields } = after;
    void tier;
    setOverride(row.id, { policy: fields, confirmed: false });
    try {
      await api.putPolicy(row.id, policyPatch(before, after));
      setOverride(row.id, { policy: fields, confirmed: true });
      toast.ok(`${verb} ${row.id} policy · audited`);
    } catch (e) {
      setOverride(row.id, null);
      toast.error(e instanceof Error ? e.message : "Could not save policy");
      throw e;
    }
  };

  const onSave = async (row: TenantRow, before: PolicyDraft, after: PolicyDraft) => {
    await put(row, before, after, "Saved");
    setPrevious((p) => ({ ...p, [row.id]: before }));
  };
  const onRevert = async (row: TenantRow) => {
    const prev = previous[row.id];
    if (!prev) return;
    const cur: PolicyDraft = { tier: row.tier, ...row.policy };
    await put(row, cur, prev, "Reverted");
    setPrevious((p) => {
      const n = { ...p };
      delete n[row.id];
      return n;
    });
  };
  const onPin = async (row: TenantRow, level: Level | null, reason: string) => {
    try {
      await api.setLevel(row.id, level, reason);
      toast.ok(level === null ? `Released ${row.id} · audited` : `Pinned ${row.id} to L${level} · audited`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change level");
    }
  };

  const actions = liveApi ? null : (
    <Badge tone="neutral" icon={<Eye />}>
      View only · simulated stream
    </Badge>
  );

  return (
    <PageFrame
      subtitle="Every tenant's quotas and live load. Click a row to tune its policy or pin its throttle level; changes are audited."
      actions={actions}
    >
      <div className="col-span-12">
        {error && !data ? (
          <ErrorState message={error} />
        ) : rows.length === 0 ? (
          loading ? (
            <div className="flex flex-col gap-2" aria-busy>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[60px] w-full rounded-[var(--r-md)]" />
              ))}
            </div>
          ) : (
            <EmptyState title="No tenants yet" help="Tenants appear here as soon as the stream reports them." />
          )
        ) : (
          <TenantTable
            rows={rows}
            selectedId={open ? selectedId : null}
            onSelect={(id) => {
              setSelectedId(id);
              setOpen(true);
            }}
          />
        )}
      </div>
      <PolicyEditor
        row={selected}
        open={open && selected !== null}
        onOpenChange={setOpen}
        editable={liveApi}
        onSave={onSave}
        onPin={onPin}
        canRevert={selected ? selected.id in previous : false}
        onRevert={onRevert}
      />
    </PageFrame>
  );
}
