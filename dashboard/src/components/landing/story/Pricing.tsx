"use client";
// Post-story section: hybrid pricing (per-node subscription + included credits + top-up packs) and a small calculator.
// Numbers are illustrative (docs/PITCH.md §5); the math lives in @/lib/pricing.
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ACTIVITY, PLANS, estimate, recommend, type Activity, type PlanId } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const CARDS: { id: PlanId; price: string; unit: string; blurb: string; features: string[]; cta: string; featured?: boolean }[] = [
  {
    id: "community",
    price: "Free",
    unit: "1 node · up to 5 clients",
    blurb: "Evaluate isolation on a single box.",
    features: ["100k credits / month", "Core isolation + throttle ladder", "Operator dashboard", "Community support"],
    cta: "Launch Console",
  },
  {
    id: "team",
    price: "$149",
    unit: "per node / month",
    blurb: "For owners packing many clients per node.",
    features: ["5M credits / node / month", "Unlimited clients per node", "Showback + tenant portal", "Baseline predictor", "Top-up packs at $8 / 1M"],
    cta: "Open Tenant Portal",
    featured: true,
  },
  {
    id: "enterprise",
    price: "from $499",
    unit: "per node / month",
    blurb: "For regulated and large platforms.",
    features: ["25M credits / node / month", "ML overload predictor", "Audit export + SSO", "gVisor / Firecracker sandboxes", "SLA-backed support · packs at $6 / 1M"],
    cta: "Talk to us",
  },
];

const STEPS = [
  { n: "1", t: "Base fee", d: "Pay per node the platform protects, not per request." },
  { n: "2", t: "Credits included", d: "Every node ships with a monthly credit allowance. 1 credit = 1 metered cost unit." },
  { n: "3", t: "Top up", d: "Need more? Prepaid packs. We alert you first and never cut off your clients." },
];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Calculator() {
  const [nodes, setNodes] = useState(4);
  const [clients, setClients] = useState(40);
  const [activity, setActivity] = useState<Activity>("medium");
  const [plan, setPlan] = useState<"auto" | "team" | "enterprise">("auto");

  const e = plan === "auto" ? recommend(nodes, clients, activity) : estimate(plan, nodes, clients, activity);

  return (
    <div className="mt-10 rounded-3xl border-2 border-ink bg-surface p-6 shadow-[6px_6px_0_var(--ink)] sm:p-8">
      <h3 className="font-display text-[24px] font-bold">Estimate your bill</h3>
      <p className="mt-1 text-[14px] text-ink-2">Illustrative numbers, computed in your browser.</p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <label className="block text-[14px] font-semibold">
            Nodes: <span className="num">{nodes}</span>
            <input type="range" min={1} max={50} value={nodes} onChange={(ev) => setNodes(Number(ev.target.value))} className="mt-2 block w-full accent-[var(--ultra)]" />
          </label>
          <label className="block text-[14px] font-semibold">
            Container clients per node: <span className="num">{clients}</span>
            <input type="range" min={5} max={200} step={5} value={clients} onChange={(ev) => setClients(Number(ev.target.value))} className="mt-2 block w-full accent-[var(--ultra)]" />
          </label>
          <fieldset>
            <legend className="text-[14px] font-semibold">Client activity</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(ACTIVITY) as Activity[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={activity === k}
                  onClick={() => setActivity(k)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-[14px] font-medium outline-none focus-visible:shadow-[var(--ring)]",
                    activity === k ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink-2 hover:bg-paper-2",
                  )}
                >
                  {ACTIVITY[k].label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-[14px] font-semibold">Plan</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["auto", "team", "enterprise"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={plan === k}
                  onClick={() => setPlan(k)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-[14px] font-medium capitalize outline-none focus-visible:shadow-[var(--ring)]",
                    plan === k ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink-2 hover:bg-paper-2",
                  )}
                >
                  {k === "auto" ? "Best fit" : k}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="rounded-2xl bg-paper-2 p-5" aria-live="polite">
          <p className="text-[13px] font-semibold uppercase tracking-[0.02em] text-ultra">{PLANS[e.plan].name} plan</p>
          <p className="num mt-1 font-display text-[44px] font-extrabold leading-none">
            {usd(e.total)}
            <span className="ml-1 text-[16px] font-medium text-ink-3">/ month</span>
          </p>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[14px]">
            <dt className="text-ink-2">Base ({nodes} × {usd(PLANS[e.plan].nodeFee)})</dt>
            <dd className="num font-semibold">{usd(e.baseCost)}</dd>
            <dt className="text-ink-2">Credits used / included</dt>
            <dd className="num font-semibold">{compact(e.creditsUsed)} / {compact(e.creditsIncluded)}</dd>
            <dt className="text-ink-2">Top-up packs ({e.overagePacks} × 1M)</dt>
            <dd className="num font-semibold">{usd(e.overageCost)}</dd>
          </dl>
          {!e.fits && (
            <p className="mt-4 text-[13px] text-ink-2">This plan has hard limits that this setup exceeds. Pick Team or Enterprise.</p>
          )}
          {e.plan === "community" && e.fits && <p className="mt-4 text-[13px] text-ink-2">Fits the free Community plan.</p>}
        </div>
      </div>
    </div>
  );
}

export function Pricing() {
  const router = useRouter();
  const go = (id: PlanId) => router.push(id === "team" ? "/portal" : "/overview");

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="mx-auto max-w-[1040px] px-6 py-20">
      <p className="text-[13px] font-semibold uppercase tracking-[0.02em] text-ultra">Pricing for server owners</p>
      <h2 id="pricing-title" className="mt-2 font-display text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-[44px]">
        Pay for nodes protected. Credits cover the usage.
      </h2>
      <p className="mt-3 max-w-[640px] text-[16px] text-ink-2">
        You host the container clients; we keep them from hurting each other. A simple per-node fee, a monthly credit
        allowance, and top-up packs if your clients run hot. <span className="font-semibold">Illustrative pricing.</span>
      </p>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {CARDS.map((c) => (
          <article
            key={c.id}
            className={cn(
              "flex flex-col rounded-3xl border bg-surface p-6 shadow-[var(--shadow-1)]",
              c.featured ? "border-2 border-ink shadow-[6px_6px_0_var(--ink)]" : "border-line",
            )}
          >
            <h3 className="font-display text-[22px] font-bold">{PLANS[c.id].name}</h3>
            <p className="num mt-3 font-display text-[36px] font-extrabold leading-none">{c.price}</p>
            <p className="mt-1 text-[13px] text-ink-3">{c.unit}</p>
            <p className="mt-3 text-[15px] text-ink-2">{c.blurb}</p>
            <ul className="mt-4 flex flex-1 flex-col gap-2 text-[14px]">
              {c.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-ultra" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <Button className="mt-6" variant={c.featured ? "primary" : "secondary"} onClick={() => go(c.id)}>
              {c.cta}
            </Button>
          </article>
        ))}
      </div>

      <ol className="mt-10 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-2xl border border-line bg-paper-2 p-5">
            <span className="num rounded-full bg-ultra-100 px-2 py-0.5 text-[13px] font-semibold text-ultra">{s.n}</span>
            <p className="mt-3 font-display text-[18px] font-bold">{s.t}</p>
            <p className="mt-1 text-[14px] text-ink-2">{s.d}</p>
          </li>
        ))}
      </ol>

      <Calculator />
    </section>
  );
}
