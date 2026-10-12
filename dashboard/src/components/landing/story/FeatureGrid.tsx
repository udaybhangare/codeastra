"use client";
// Post-story section: every console surface, one card each, linking to its route.
import { ArrowUpRight, BarChart3, FlaskConical, LayoutDashboard, ScrollText, Siren, Users } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";

const FEATURES = [
  { href: "/overview", icon: LayoutDashboard, title: "Live overview", body: "Every tenant's health, throttles and a live feed on one screen." },
  { href: "/incidents", icon: Siren, title: "Incidents", body: "Each detection with a plain-language reason and a decision timeline." },
  { href: "/predictor", icon: BarChart3, title: "Predictor", body: "Forecasts a tenant heading for trouble before the wall is hit." },
  { href: "/scenarios", icon: FlaskConical, title: "Scenario lab", body: "Replay a noisy neighbor with protection ON and OFF, side by side." },
  { href: "/audit", icon: ScrollText, title: "Audit log", body: "Every automated action recorded, exportable, never silent." },
  { href: "/portal", icon: Users, title: "Tenant portal", body: "Tenants see their own usage and why they were limited." },
] as const;

export function FeatureGrid() {
  return (
    <section id="features" aria-labelledby="features-title" className="mx-auto max-w-[1100px] px-6 py-20 md:px-[8vw]">
      <p className="text-[13px] font-semibold uppercase tracking-[0.02em] text-ultra">The console</p>
      <h2 id="features-title" className="mt-2 font-display text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-[44px]">
        Everything you need to run it.
      </h2>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <li key={f.href}>
            <Link href={f.href} className="group block h-full rounded-[var(--r-lg)] outline-none focus-visible:shadow-[var(--ring)]">
              <Card interactive className="h-full p-6">
                <div className="flex items-start justify-between">
                  <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-ultra-100 text-ultra">
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <ArrowUpRight className="size-5 text-ink-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </div>
                <h3 className="mt-4 font-display text-[20px] font-bold">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{f.body}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
