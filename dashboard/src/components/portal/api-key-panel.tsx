"use client";
import { Check, Copy, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { portalApi, usePortal } from "@/lib/portal";
import { maskKey } from "@/lib/portal-view";

/** Masked key, rotate-with-confirm, and a reveal-once dialog: the new key is held only until that dialog closes. */
export function ApiKeyPanel({ token, keyHint }: { token: string; keyHint?: string }) {
  const toast = useToast();
  const setKeyHint = usePortal((s) => s.setKeyHint);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rotated, setRotated] = useState(false);

  async function rotate() {
    setBusy(true);
    try {
      const { api_key } = await portalApi.rotate(token);
      setConfirm(false);
      setFresh(api_key);
      setCopied(false);
      setRotated(true);
      setKeyHint(api_key.slice(-4));
    } catch (x) {
      toast.error(x instanceof Error ? x.message : "Rotation failed. Your current key still works.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      toast.ok("Key copied to your clipboard.");
    } catch {
      toast.error("Couldn't copy automatically. Select the key and copy it by hand.");
    }
  }

  return (
    <Card id="api-keys" className="scroll-mt-24 pb-5" eyebrow="API keys" title="Your key">
      <div className="space-y-4 px-5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] bg-paper-2 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[var(--r-sm)] bg-ultra-100 text-ultra"><KeyRound className="size-5" aria-hidden /></span>
            <div className="min-w-0">
              <div className="num truncate text-[15px] font-medium" aria-label="Masked API key">{maskKey(keyHint)}</div>
              <div className="text-[13px] text-ink-2">{rotated ? "Rotated just now" : "Active · created and last-used times are not shown in the portal yet"}</div>
            </div>
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw />} onClick={() => setConfirm(true)}>Rotate key</Button>
        </div>
        <p className="flex items-start gap-2 text-[13px] text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok-ink" aria-hidden />
          Keep keys out of source control and browser code. Rotating gives you a new key and switches the old one off straight away.
        </p>
      </div>

      <Dialog
        open={confirm}
        onOpenChange={(o) => !busy && setConfirm(o)}
        title="Rotate your API key?"
        description="Your current key stops working immediately. Anything still using it will get “not recognised” errors until you update it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={rotate}>Yes, rotate it</Button>
          </>
        }
      />

      <Dialog
        open={fresh !== null}
        onOpenChange={(o) => {
          if (!o) setFresh(null); // reveal-once: closing forgets the key
        }}
        title="Here's your new key"
        description="This is the only time it is shown. Copy it now and store it somewhere safe."
        footer={<Button variant="primary" onClick={() => setFresh(null)}>{copied ? "Done" : "I've saved it"}</Button>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <code role="status" className="num min-w-0 flex-1 rounded-[var(--r-md)] bg-paper-2 px-3 py-3 text-[15px] break-all select-all">{fresh}</code>
          <Button variant={copied ? "lime" : "primary"} icon={copied ? <Check /> : <Copy />} onClick={copy}>
            {copied ? "Copied" : "Copy key"}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
