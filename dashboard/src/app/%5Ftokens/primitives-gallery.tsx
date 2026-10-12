"use client";
// Throwaway primitives gallery (docs/ui/07). Removed in U14.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, Drawer } from "@/components/ui/dialog";
import { Input, NumberField } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Popover } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { levelTone, tenantColor } from "@/lib/colors";
import { fmtBytes, fmtDuration, fmtMs } from "@/lib/format";
import type { Level } from "@/lib/ws-types";

const TIERS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
] as const;

export function PrimitivesGallery() {
  const toast = useToast();
  const [tier, setTier] = useState<"free" | "pro" | "enterprise">("pro");
  const [cpu, setCpu] = useState(30);
  const [qty, setQty] = useState<number | null>(10);
  const [on, setOn] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [ticker, setTicker] = useState(1284);
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h2>Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button magnetic size="lg">Run scenario (magnetic)</Button>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="lime">Lime</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Compact 36</Button>
          <Button disabled>Disabled</Button>
          <Button
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          >
            Click to load
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2>Cards</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card eyebrow="Flat" title="Compartment A" interactive className="pb-5"><p className="px-5 pt-2 text-ink-2">Hover to lift.</p></Card>
          <Card variant="pop" eyebrow="Pop" title="Scenario S1" className="pb-5"><p className="px-5 pt-2 text-ink-2">Offset block shadow.</p></Card>
          <Card variant="tinted" tint="bad" eyebrow="Tinted" title="Throttled" className="pb-5"><p className="px-5 pt-2 text-bad-ink">Status tint.</p></Card>
          <div className="bg-grad-hero rounded-[var(--r-lg)] p-4">
            <Card variant="glass" eyebrow="Glass" title="Landing" className="pb-5"><p className="px-5 pt-2 text-ink-2">Over hero gradient.</p></Card>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2>Badges, kbd, ladder tones</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="ok" dot>Healthy</Badge>
          <Badge tone="warn" dot>Contended</Badge>
          <Badge tone="bad" dot>Throttled</Badge>
          <Badge tone="predict" dot>Predicted</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="lime">Selected</Badge>
          <Kbd>P</Kbd>
          <Kbd>⌘K</Kbd>
        </div>
        <div className="flex flex-wrap gap-3">
          {([0, 1, 2, 3, 4, 5] as Level[]).map((l) => {
            const t = levelTone(l);
            return (
              <span key={l} className={`num rounded-full px-3 py-1 text-[13px] font-semibold ${t.hatched ? "hatched" : ""}`} style={{ background: t.tint, color: t.ink, boxShadow: `inset 0 0 0 2px ${t.fill}` }}>
                L{l} {t.name}
              </span>
            );
          })}
          {["acme", "globex", "initech", "umbrella"].map((id) => (
            <span key={id} className="inline-flex items-center gap-2 text-sm">
              <span className="size-3 rounded-full" style={{ background: tenantColor(id) }} />
              {id}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2>Form controls</h2>
        <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
          <Input placeholder="Admin API key" aria-label="API key" />
          <NumberField value={qty} onValueChange={setQty} min={0} max={100} unit="conns" aria-label="Connections" />
          <div className="pt-8">
            <Slider value={cpu} onValueChange={setCpu} min={0} max={100} format={(v) => `${v}% CPU`} aria-label="CPU share" />
          </div>
          <Select value={tier} onValueChange={setTier} options={TIERS} aria-label="Tier" />
          <Segmented value={tier} onValueChange={setTier} options={TIERS} aria-label="Tier segmented" />
          <div className="flex items-center gap-3">
            <Switch checked={on} onCheckedChange={setOn} aria-label="Isolation" />
            <span className="text-ink-2">Isolation {on ? "enabled" : "disabled"}</span>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2>Overlays &amp; feedback</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip content={<span>p95 latency <b>212 ms</b></span>}>
            <Button variant="soft">Hover for tooltip</Button>
          </Tooltip>
          <Popover trigger={<Button variant="secondary">Popover</Button>}>
            <div className="num text-sm">{fmtBytes(5_000_000)} · {fmtMs(212)} · {fmtDuration(185)}</div>
          </Popover>
          <Button variant="soft" onClick={() => setDialog(true)}>Open dialog</Button>
          <Button variant="soft" onClick={() => setDrawer(true)}>Open drawer</Button>
          <Button variant="lime" onClick={() => toast.ok("Policy saved")}>Toast ok</Button>
          <Button variant="secondary" onClick={() => toast.warn("Tenant contended")}>Toast warn</Button>
          <Button variant="danger" onClick={() => toast.error("Quarantine applied")}>Toast bad</Button>
        </div>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Pin ladder level?"
          description="This overrides the automatic decision until you unpin."
          footer={<><Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button><Button onClick={() => setDialog(false)}>Pin level</Button></>}
        >
          <p className="text-ink-2">Dialogs spring in; the scrim blurs the page.</p>
        </Dialog>
        <Drawer open={drawer} onOpenChange={setDrawer} title="Why this happened" description="Decision #4821">
          <p className="text-ink-2">Drawer docks right and slides in with springSoft.</p>
        </Drawer>
      </section>

      <section className="space-y-4">
        <h2>Number ticker</h2>
        <div className="flex items-center gap-4">
          <span className="text-[44px] leading-none font-semibold tracking-[-0.02em]"><NumberTicker value={ticker} /></span>
          <Button variant="soft" onClick={() => setTicker((t) => t + 137)}>+137</Button>
          <Button variant="ghost" onClick={() => setTicker((t) => Math.max(0, t - 211))}>−211</Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2>States</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-4 w-3/4" /></div>
          <EmptyState title="No incidents yet" help="Run a scenario and the decisions will appear here." action={<Button size="sm">Run scenario</Button>} />
          <ErrorState message="Couldn't reach the admin API." onRetry={() => toast.info("Retrying…")} />
        </div>
      </section>
    </div>
  );
}
