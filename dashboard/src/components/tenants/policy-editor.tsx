"use client";
import { Eye, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import { tenantColor } from "@/lib/colors";
import { LADDER } from "@/lib/ladder";
import {
  diffPolicy,
  FIELD_DEFS,
  fmtField,
  presetDraft,
  rangeMax,
  validatePolicy,
  type FieldDef,
  type PolicyDraft,
  type TenantRow,
} from "@/lib/policy";
import type { Level, Tier } from "@/lib/ws-types";
import { LadderBadge } from "../domain/ladder-badge";
import { LadderStepper } from "../domain/ladder-stepper";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Drawer } from "../ui/dialog";
import { Input, NumberField } from "../ui/input";
import { Segmented } from "../ui/segmented";
import { Slider } from "../ui/slider";

const TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
] as const;
const GROUPS = [
  { id: "share", title: "Compute share" },
  { id: "rate", title: "Rate & budget" },
  { id: "capacity", title: "Capacity" },
] as const;
/** The pin API accepts levels 0–4 (docs/04); level 5 is automatic only. */
const MAX_PIN: Level = 4;

function toDraft(row: TenantRow): PolicyDraft {
  return { tier: row.tier, ...row.policy };
}

function Field({ def, value, onChange, disabled }: { def: FieldDef; value: number; onChange: (raw: number) => void; disabled: boolean }) {
  const shown = value / def.scale;
  const toRaw = (v: number) => (def.scale === 1 ? Number(v.toFixed(def.digits)) : Math.round(v * def.scale));
  return (
    <div className="rounded-[var(--r-md)] border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold tracking-[0.02em]">{def.label}</span>
        <NumberField
          value={shown}
          onValueChange={(v) => v !== null && onChange(toRaw(v))}
          min={def.min}
          step={def.step}
          unit={def.unit}
          disabled={disabled}
          aria-label={def.label}
          className="w-[190px]"
        />
      </div>
      <Slider
        value={Math.min(shown, rangeMax(def, value) / def.scale)}
        onValueChange={(v) => onChange(toRaw(v))}
        min={def.min}
        max={rangeMax(def, value) / def.scale}
        step={def.step}
        format={(v) => fmtField(def, toRaw(v))}
        disabled={disabled}
        aria-label={`${def.label} slider`}
      />
    </div>
  );
}

export interface PolicyEditorProps {
  row: TenantRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False on the mock stream: everything renders read-only with a "View only" chip. */
  editable: boolean;
  onSave: (row: TenantRow, before: PolicyDraft, after: PolicyDraft) => Promise<void>;
  onPin: (row: TenantRow, level: Level | null, reason: string) => Promise<void>;
  /** Previous policy of this tenant from the last save, if any. */
  canRevert: boolean;
  onRevert: (row: TenantRow) => Promise<void>;
}

export function PolicyEditor({ row, open, onOpenChange, editable, onSave, onPin, canRevert, onRevert }: PolicyEditorProps) {
  const serverKey = row ? `${row.id}|${JSON.stringify(toDraft(row))}` : "";
  const [seen, setSeen] = useState(serverKey);
  const [draft, setDraft] = useState<PolicyDraft | null>(row ? toDraft(row) : null);
  const [pin, setPin] = useState<Level>(row?.level ?? 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"save" | "pin" | "release" | "revert" | null>(null);

  // Reset the form whenever the server-side policy (or the tenant) changes: derived state, no effect.
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(row ? toDraft(row) : null);
    if (!row || !seen.startsWith(`${row.id}|`)) {
      setPin(row?.level ?? 0);
      setReason("");
    }
  }
  if (!row || !draft) return null;

  const base = toDraft(row);
  const diff = diffPolicy(base, draft);
  const errors = validatePolicy(draft);
  const locked = !editable || busy !== null;
  const reasonOk = reason.trim().length >= 3;
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-3">
          <span className="size-4 rounded-full" style={{ background: tenantColor(row.id) }} aria-hidden />
          {row.id}
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-2">
          <LadderBadge level={row.level} size="sm" />
          {editable ? (
            <Badge tone="brand" icon={<ShieldCheck />}>Audited</Badge>
          ) : (
            <Badge tone="neutral" icon={<Eye />} title="No backend connected: showing tier defaults. Connect the live stream to edit.">
              View only
            </Badge>
          )}
          {row.source === "preset" ? <Badge tone="neutral">Tier defaults</Badge> : null}
        </span>
      }
      footer={
        <>
          {canRevert ? (
            <Button variant="ghost" icon={<Undo2 />} disabled={locked} loading={busy === "revert"} onClick={() => run("revert", () => onRevert(row))}>
              Revert last save
            </Button>
          ) : null}
          <Button variant="ghost" icon={<RotateCcw />} disabled={diff.length === 0 || busy !== null} onClick={() => setDraft(base)}>
            Reset
          </Button>
          <Button
            disabled={locked || diff.length === 0 || errors.length > 0}
            loading={busy === "save"}
            onClick={() => run("save", () => onSave(row, base, draft))}
          >
            Save policy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <section aria-label="Tier preset" className="flex flex-col gap-2">
          <h3>Tier preset</h3>
          <Segmented
            aria-label="Tier preset"
            value={draft.tier}
            options={TIER_OPTIONS}
            onValueChange={(t: Tier) => !locked && setDraft(presetDraft(t))}
            className={locked ? "pointer-events-none opacity-60" : undefined}
          />
          <p className="text-[13px] text-ink-2">Picking a tier loads its default quotas; fine-tune them below before saving.</p>
        </section>

        <section aria-label="Pending changes" aria-live="polite" className="flex min-h-7 flex-wrap gap-2">
          {diff.length === 0 ? (
            <span className="text-[13px] text-ink-3">No pending changes.</span>
          ) : (
            diff.map((c) => (
              <Badge key={c.key} tone="brand" className="num">
                {c.label} {c.from} → {c.to}
              </Badge>
            ))
          )}
        </section>
        {errors.length > 0 ? (
          <ul role="alert" className="rounded-[var(--r-md)] bg-bad-100 p-3 text-[13px] font-medium text-bad-ink">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        {GROUPS.map((g) => (
          <section key={g.id} aria-label={g.title} className="flex flex-col gap-3">
            <h3>{g.title}</h3>
            {FIELD_DEFS.filter((d) => d.group === g.id).map((d) => (
              <Field key={d.key} def={d} value={draft[d.key]} disabled={locked} onChange={(raw) => setDraft((p) => (p ? { ...p, [d.key]: raw } : p))} />
            ))}
          </section>
        ))}

        <section aria-label="Pin throttle level" className="flex flex-col gap-3 rounded-[var(--r-lg)] bg-paper-2 p-4">
          <div>
            <h3>Pin throttle level</h3>
            <p className="mt-1 text-[13px] text-ink-2">Holds this tenant at a level regardless of the detector until released. Recorded in the audit log with your reason.</p>
          </div>
          <LadderStepper level={pin} maxSelectable={MAX_PIN} onSelect={(l) => !locked && setPin(l)} />
          <p className="num text-[13px] text-ink-2" aria-live="polite">
            Now L{row.level} {LADDER[row.level].name}
            {pin !== row.level ? ` → pin L${pin} ${LADDER[pin].name}` : ""}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold tracking-[0.02em]">Reason (required)</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer asked us to hold during migration" disabled={locked} maxLength={200} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={locked || !reasonOk}
              loading={busy === "pin"}
              onClick={() => run("pin", async () => { await onPin(row, pin, reason.trim()); setReason(""); })}
            >
              Pin to L{pin}
            </Button>
            <Button
              variant="ghost"
              disabled={locked || !reasonOk}
              loading={busy === "release"}
              onClick={() => run("release", async () => { await onPin(row, null, reason.trim()); setReason(""); })}
            >
              Release pin
            </Button>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
