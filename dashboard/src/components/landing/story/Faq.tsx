"use client";
// Post-story section: native <details> accordion (keyboard + screen-reader friendly, no extra deps).
import { ChevronDown } from "lucide-react";

const QA = [
  { q: "How is this different from a rate limiter?", a: "Rate limits count requests. Bulkhead meters cost, so one expensive query is not treated like a cheap one." },
  { q: "Will it throttle a legitimate traffic spike?", a: "In our flash-crowd test, 0 good tenants were limited. Busy is not the same as harmful." },
  { q: "What are the walls made of?", a: "Per-tenant containers with kernel cgroup limits: cpu.max, memory.max, pids.max, plus a DB connection cap. Network isolation is app-layer only." },
  { q: "Can an action be undone?", a: "Yes. Escalation is a ladder, every rung is audited, and operators can lift a limit from the console." },
  { q: "What is a credit?", a: "One metered cost unit from the usage ledger (CPU, memory and DB time rolled together). Each node includes a monthly allowance; extra credits come in prepaid packs." },
  { q: "What happens when credits run out?", a: "We alert you first. Your clients are never cut off; you top up with a pack or enable auto top-up." },
  { q: "Why price per node?", a: "A node is the unit we protect and the unit you already pay your cloud for, so the bill tracks your infrastructure, not your request volume." },
  { q: "Are the numbers real?", a: "They come from docs/RESULTS.md: medians of 5 seeded runs on one laptop. Containment is demonstrated; detection timing is not claimed." },
] as const;

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-[760px] px-6 py-20">
      <p className="text-[13px] font-semibold uppercase tracking-[0.02em] text-ultra">FAQ</p>
      <h2 id="faq-title" className="mt-2 font-display text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-[44px]">
        Fair questions.
      </h2>
      <div className="mt-8 flex flex-col gap-3">
        {QA.map((item) => (
          <details key={item.q} className="group rounded-2xl border border-line bg-surface px-5 py-4 shadow-[var(--shadow-1)] open:border-ink">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-[17px] font-semibold outline-none focus-visible:shadow-[var(--ring)] [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
