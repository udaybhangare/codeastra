"use client";
import { useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { api, liveApi } from "@/lib/api";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

/**
 * Large labelled pill: Isolation ON / OFF. Changing it asks for confirmation; the backend
 * (`POST /admin/isolation`) records the audit event. On the mock stream the change is local only.
 */
export function IsolationSwitch() {
  const streamIso = useStream((s) => s.latest?.isolation);
  const source = useStream((s) => s.source);
  const mockIso = useUi((s) => s.mockIsolation);
  const setMockIso = useUi((s) => s.setMockIsolation);
  const toast = useToast();
  const [target, setTarget] = useState<"on" | "off" | null>(null);
  const [busy, setBusy] = useState(false);

  const iso = source === "mock" && mockIso ? mockIso : streamIso;
  const on = iso === "on";
  const known = iso !== undefined;

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      if (liveApi && source === "live") await api.setIsolation(target);
      else setMockIso(target);
      toast.ok(`Isolation ${target.toUpperCase()}${source === "mock" ? " (simulated)" : " — recorded in audit log"}`);
      setTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change isolation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={!known}
        onClick={() => setTarget(on ? "off" : "on")}
        aria-label={`Isolation is ${known ? (on ? "on" : "off") : "unknown"}. Change`}
        className={cn(
          "flex h-11 items-center gap-2 rounded-full border-2 border-ink px-4 text-[15px] font-bold outline-none transition-colors focus-visible:shadow-[var(--ring)] disabled:opacity-60",
          !known ? "bg-paper-2 text-ink-2" : on ? "bg-lime text-lime-ink" : "bg-tangerine text-ink",
        )}
      >
        {on || !known ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldOff className="size-5" aria-hidden />}
        <span className="num">{known ? `Isolation ${on ? "ON" : "OFF"}` : "Isolation …"}</span>
      </button>
      <Dialog
        open={target !== null}
        onOpenChange={(o) => !o && !busy && setTarget(null)}
        title={target === "off" ? "Turn isolation OFF?" : "Turn isolation ON?"}
        description={
          target === "off"
            ? "Tenants will share resources with no throttling. A noisy neighbor can now hurt everyone. This is how the 'before' half of the demo is shown."
            : "Per-tenant quotas, the DRR scheduler and the throttle ladder will be enforced again."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant={target === "off" ? "danger" : "primary"} loading={busy} onClick={confirm}>
              Turn {target === "off" ? "OFF" : "ON"}
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-ink-2">This action is written to the audit log.</p>
      </Dialog>
    </>
  );
}
