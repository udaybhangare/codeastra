// Throwaway token gallery (docs/ui/01). Removed in U14.
import { PrimitivesGallery } from "./primitives-gallery";
const core = [
  ["paper", "#FAF7F2"], ["paper-2", "#F2EDE4"], ["surface", "#FFFFFF"], ["ink", "#14142B"],
  ["ink-2", "#4A4A68"], ["ink-3", "#7A7A96"], ["line", "#E4DED3"], ["ultra", "#3B2EFF"],
  ["ultra-600", "#2A1FD6"], ["ultra-100", "#E6E4FF"], ["ultra-50", "#F2F1FF"], ["tangerine", "#FF6B35"],
  ["tangerine-100", "#FFE6DB"], ["lime", "#C8F169"], ["lime-ink", "#2E4A00"],
];
const status = [
  ["ok", "#17C37B"], ["ok-100", "#DDF7EA"], ["warn", "#FFC233"], ["warn-100", "#FFF2CC"],
  ["bad", "#F2305C"], ["bad-100", "#FFE0E7"], ["ladder-soft", "#FFA500"], ["ladder-isolate", "#C9163F"],
];
const tenants = ["#3B2EFF", "#FF6B35", "#17A98F", "#B04DFF", "#FF3D9A", "#2E9BFF"];
const radii = [["sm", 12], ["md", 16], ["lg", 24], ["xl", 32], ["pill", 999]] as const;
const shadows = ["shadow-1", "shadow-2", "shadow-3"] as const;

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="h-16" style={{ background: `var(--${name})` }} />
      <div className="p-3">
        <div className="text-[13px] font-semibold">--{name}</div>
        <div className="num text-xs text-ink-2">{hex}</div>
      </div>
    </div>
  );
}

export default function TokensPage() {
  return (
    <main className="mx-auto max-w-[1440px] space-y-12 p-6 lg:p-12">
      <header>
        <p className="num text-xs text-ink-2">/_tokens · throwaway · U01–U02</p>
        <h1 className="font-display text-[56px] leading-none font-bold tracking-tight">Paper &amp; Ultramarine</h1>
      </header>

      <section className="space-y-4">
        <h2>Core colour</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          {core.map(([n, h]) => <Swatch key={n} name={n} hex={h} />)}
        </div>
        <h3>Status</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {status.map(([n, h]) => <Swatch key={n} name={n} hex={h} />)}
        </div>
        <h3>Tenant identity</h3>
        <div className="flex gap-3">
          {tenants.map((c, i) => (
            <div key={c} className="flex flex-col items-center gap-1">
              <div className="size-12 rounded-full" style={{ background: c }} />
              <span className="num text-xs">{i + 1}</span>
            </div>
          ))}
        </div>
        <h3>Gradients (decor only)</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="bg-grad-hero card h-32" />
          <div className="bg-grad-ultra card h-32" />
        </div>
      </section>

      <section className="space-y-4">
        <h2>Typography</h2>
        <div className="card space-y-4 p-6">
          <div className="font-display font-extrabold tracking-[-0.03em]" style={{ fontSize: "clamp(56px, 8vw, 128px)", lineHeight: 0.95 }}>
            Display XL
          </div>
          <div className="font-display text-[56px] leading-none font-bold tracking-[-0.02em]">Display L — Bricolage</div>
          <h1>H1 — Contain the noisy neighbor</h1>
          <h2>H2 — Compartment sealed</h2>
          <h3>H3 — Throttle ladder</h3>
          <p className="text-lg">Body L — Instrument Sans for every label, paragraph and button.</p>
          <p>Body — The other tenants stayed fine; p95 latency never left the green band.</p>
          <p className="text-[13px] font-semibold tracking-[0.02em] uppercase">Label — victim impact</p>
          <div className="num text-[44px] leading-none font-semibold tracking-[-0.02em]">1,284.6 rps</div>
          <div className="num text-xl font-medium">p95 212 ms · 0.4% err</div>
          <div className="num text-xs font-medium">mono small · 2026-10-12T10:04:11Z</div>
        </div>
      </section>

      <section className="space-y-4">
        <h2>Radii &amp; shadows</h2>
        <div className="flex flex-wrap gap-4">
          {radii.map(([n, r]) => (
            <div key={n} className="flex h-20 w-28 items-center justify-center border border-line bg-surface text-sm" style={{ borderRadius: r }}>
              r-{n} <span className="num ml-1 text-xs text-ink-2">{r}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          {shadows.map((s) => (
            <div key={s} className="flex h-24 w-40 items-center justify-center rounded-lg border border-line bg-surface text-sm" style={{ boxShadow: `var(--${s})` }}>
              {s}
            </div>
          ))}
          <div className="card-pop flex h-24 w-40 items-center justify-center text-sm font-semibold">pop card</div>
          <button className="h-11 rounded-full bg-ultra px-6 text-sm font-semibold text-white focus-visible:shadow-[var(--ring)]">
            Focus ring (Tab)
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2>Status pairs (icon/label + colour)</h2>
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <span className="rounded-full bg-ok-100 px-3 py-1 text-ok-ink">● Healthy</span>
          <span className="rounded-full bg-warn-100 px-3 py-1 text-warn-ink">▲ Contended</span>
          <span className="rounded-full bg-bad-100 px-3 py-1 text-bad-ink">■ Throttled</span>
          <span className="rounded-full bg-ultra-100 px-3 py-1 text-ultra-600">◆ Predicted</span>
          <span className="rounded-full bg-lime px-3 py-1 text-lime-ink">Selected</span>
          <span className="hatched rounded-full bg-bad-100 px-3 py-1 text-bad-ink">Quarantine</span>
        </div>
      </section>

      <PrimitivesGallery />
    </main>
  );
}
