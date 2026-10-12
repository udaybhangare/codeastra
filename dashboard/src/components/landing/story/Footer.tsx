"use client";
import Link from "next/link";

const LINKS = [
  { href: "/overview", label: "Console" },
  { href: "/scenarios", label: "Scenario lab" },
  { href: "/incidents", label: "Incidents" },
  { href: "/audit", label: "Audit" },
  { href: "/portal", label: "Tenant portal" },
] as const;

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-line bg-paper px-6 py-12 text-[14px] text-ink-2">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[34ch]">
          <p className="font-display text-[20px] font-bold text-ink">Bulkhead</p>
          <p className="mt-2 font-semibold text-ink">Rate limits count requests. Bulkhead meters cost.</p>
          <p className="mt-1">Built for a hackathon · Paper &amp; Ultramarine</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="rounded font-medium outline-none hover:text-ultra focus-visible:shadow-[var(--ring)]">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
