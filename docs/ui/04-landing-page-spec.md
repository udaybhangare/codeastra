# UI 04 — Landing page spec (`/`)

Interactive 3D story. Paper canvas, hull canvas fixed behind content, Lenis smooth scroll, GSAP ScrollTrigger pins the story. Copy below is the draft; keep it punchy. Tokens: `01`, motion: `02`, hull: `03`.

## Global chrome
- **Top nav (floating pill, centred, glass white):** logo mark (small compartment-ship glyph) + "Bulkhead" · links: Story, Results · buttons: "Tenant Portal" (ghost), "Launch Console" (ultramarine, magnetic).
- **Right-edge progress rail:** 7 dots for sections, active dot springBouncy.
- Footer: tiny line "Rate limits count requests. Bulkhead meters cost." + repo/credits.

## Sections
### 1. Hero (0–12%)
- Left: Display XL headline: **"One noisy neighbor shouldn't sink the ship."** Sub (Body L): "Bulkhead seals every tenant in its own compartment, so one bad actor can't drown everyone else."
- CTAs: **Launch Console** (primary, magnetic), **Watch it hold** (secondary, scrolls to story).
- Right/behind: the hull, calm, parallax with cursor, hover shows tenant name plates.
- **Isolation switch** (big pill toggle under hero, labelled "Protection OFF / ON"): flipping it shows the flood spreading vs held. Defaults ON.
- Hint chip: "Click a compartment to make it noisy" (fades after first use).
- Scroll cue: bouncing chevron.

### 2. The problem (12–30%)
- Headline: "A rate limit counts requests. Not damage."
- Left text + a small inline comparison card: `echo` = 1 cost unit vs 5 s CPU job = 500 cost units, same "1 request".
- Hull: compartment 3 floods; neighbours' water rises (isolation off view).

### 3. A fair queue (30–50%) — DRR
- Headline: "Everyone gets a turn. Heavy jobs pay more."
- Short copy: "Deficit Round Robin hands each tenant credit by weight; idle capacity is never wasted."
- Visual: lanes of particles; a rotating ring dispenses credit. Hover a lane → tooltip with weight.

### 4. Hard walls (50–65%) — cgroups
- Headline: "Real walls in the kernel."
- Chips floating off the hull walls: `cpu.max`, `memory.max`, `pids.max`, `DB conn cap`. Footnote: "Network is app-layer only — we say so."

### 5. Catch it, explain it (65–80%) — detector & ladder
- Headline: "We punish harm, not busyness."
- Interactive **ladder stepper** (6 pills Normal→Quarantine) synced to the door closing; copy updates with the level; a sample "Why?" sentence: *rogue-ml used 71% CPU vs 20% entitlement; acme-shop p99 rose 6.2×.*

### 6. See it coming (80–92%) — predictor
- Headline: "Forecast 10 seconds ahead. Advisory only."
- Ghost water shows ahead; tiny sparkline of forecast vs actual.

### 7. Proof + CTA (92–100%)
- Results bento (3 tiles, numbers tick up on enter; source `docs/RESULTS.md`, read it in the prompt): victim p99 inflation OFF vs ON, false positives, throughput kept. Use numbers from RESULTS.md, never invent.
- Big CTA card (pop style): "See it live" → **Launch Console**; secondary → **Open Tenant Portal**.
- Hull pulls back, all compartments healthy, lime confetti burst once on first arrival.

## Interactions summary
Cursor parallax (hull + decor blobs) · compartment hover tooltips · click-to-attack demo · isolation switch · scroll-scrubbed camera · magnetic CTAs · number tickers · progress rail.

## States
- Loading: static SVG hull poster + shimmer; canvas fades in when ready.
- Reduced motion: no parallax/scrub; sections stack normally with the hull in a fixed calm pose.
- Mobile (<768): hull becomes a sticky half-height canvas on top; text below; no pinning.

## Routes
`/` landing. CTAs link to `/overview` (admin home; created in U06/U07) and `/portal`. If admin auth is required, link goes through the existing admin-login component.
