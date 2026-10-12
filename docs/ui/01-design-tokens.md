# UI 01 — Design tokens

Single source of truth. Implement as CSS variables on `:root` in `dashboard/src/app/globals.css` and map them into the Tailwind v4 `@theme` block. No dark mode: do not add a `.dark` variant.

## Colour
### Core
| Token | Hex | Use |
|---|---|---|
| `--paper` | `#FAF7F2` | App canvas |
| `--paper-2` | `#F2EDE4` | Recessed areas, table zebra, inputs |
| `--surface` | `#FFFFFF` | Cards, panels |
| `--ink` | `#14142B` | Primary text |
| `--ink-2` | `#4A4A68` | Secondary text (AA on paper) |
| `--ink-3` | `#7A7A96` | Hints, axis labels (large/ancillary only) |
| `--line` | `#E4DED3` | Borders, dividers |
| `--ultra` | `#3B2EFF` | Brand, primary buttons, links, focus, "predicted" |
| `--ultra-600` | `#2A1FD6` | Pressed/hover-darker |
| `--ultra-100` | `#E6E4FF` | Tinted backgrounds |
| `--ultra-50` | `#F2F1FF` | Subtle tint |
| `--tangerine` | `#FF6B35` | Secondary accent, warm highlights, hero decor |
| `--tangerine-100` | `#FFE6DB` | Tint |
| `--lime` | `#C8F169` | Highlight chips, "good news" pops, selection marker |
| `--lime-ink` | `#2E4A00` | Text on lime |

### Status (semantic; always with icon/label)
| Token | Hex | Tint | Meaning |
|---|---|---|---|
| `--ok` | `#17C37B` | `--ok-100 #DDF7EA` | Healthy / Normal |
| `--warn` | `#FFC233` | `--warn-100 #FFF2CC` | Contended / Observe / Soft |
| `--bad` | `#F2305C` | `--bad-100 #FFE0E7` | Throttled / Hard / Quarantine |
| `--predict` | `var(--ultra)` | `--ultra-100` | Predicted / forecast |
Text on `--ok/--warn/--bad` fills uses `--ink`; text on tints uses the dark variants `--ok-ink #07623A`, `--warn-ink #6B4A00`, `--bad-ink #8F0F2E`.

### Ladder level → tone (from `src/lib/ladder.ts`, levels 0–5)
0 Normal `--ok`; 1 Observe `--warn`; 2 Soft `--warn` (deeper `#FFA500`); 3 Hard `--bad`; 4 Isolate `--bad` (deeper `#C9163F`); 5 Quarantine `--bad` + hatched pattern.

### Tenant identity colours (categorical, for lines/compartments)
Assigned by stable hash of `tenant_id` to this ordered list (min 6, cycle after): `#3B2EFF`, `#FF6B35`, `#17A98F`, `#B04DFF`, `#FF3D9A`, `#2E9BFF`. Victim highlight uses a thicker stroke, not a new colour.

### Gradients (decor only)
- `--grad-hero`: radial blobs of `--ultra-100`, `--tangerine-100`, `--lime` at 40% over `--paper`.
- `--grad-ultra`: `linear-gradient(135deg, #3B2EFF 0%, #6F5BFF 100%)` for primary CTA hover/hero chips.

## Typography
Fonts (via `next/font/google`): **Bricolage Grotesque** (display), **Instrument Sans** (body/UI), **Geist Mono** (all numbers/metrics/code). CSS vars `--font-display`, `--font-body`, `--font-mono`.

| Role | Font | Size/Line | Weight | Tracking |
|---|---|---|---|---|
| Display XL (landing hero) | Display | clamp(56px, 8vw, 128px)/0.95 | 800 | -0.03em |
| Display L | Display | 56/1.0 | 700 | -0.02em |
| H1 | Display | 40/1.1 | 700 | -0.02em |
| H2 | Display | 28/1.15 | 700 | -0.01em |
| H3 | Display | 20/1.25 | 600 | 0 |
| Body L | Body | 18/1.5 | 400 | 0 |
| Body | Body | 15/1.5 | 400 | 0 |
| Label | Body | 13/1.3 | 600 | 0.02em (uppercase optional) |
| Metric XL (KPI) | Mono | 44/1 | 600 | -0.02em, tabular-nums |
| Metric | Mono | 20/1.1 | 500 | tabular-nums |
| Mono small | Mono | 12/1.3 | 500 | tabular-nums |
Presentation mode multiplies the scale by 1.35 (via `--type-scale` on `<html data-presentation>`).

## Spacing, radii, sizing
- Spacing scale (px): 4, 8, 12, 16, 20, 24, 32, 48, 64, 96. Page gutters: 24 (laptop), 48 (≥1440).
- Radii: `--r-sm 12`, `--r-md 16`, `--r-lg 24`, `--r-xl 32`, `--r-pill 999`. Cards `--r-lg`; inputs/buttons pill or `--r-md`; modals/drawers `--r-xl`.
- Min target 44×44 for interactive controls (pill buttons height 44, compact 36).
- Max content width: 1440; admin canvas fluid, designed for 1280×720 up.

## Elevation (soft, warm)
| Token | Value |
|---|---|
| `--shadow-1` | `0 1px 0 rgba(20,20,43,.04), 0 2px 8px rgba(20,20,43,.05)` |
| `--shadow-2` | `0 2px 0 rgba(20,20,43,.04), 0 10px 30px rgba(20,20,43,.08)` |
| `--shadow-3` | `0 20px 60px rgba(59,46,255,.18)` (floating sidebar, drawers) |
| `--ring` | `0 0 0 3px rgba(59,46,255,.35)` focus ring |
Cards also get a 1px `--line` border. A "pop" card variant has a 2px ink border + offset block shadow `6px 6px 0 var(--ink)` used sparingly (hero CTA cards, scenario cards).

## Z-index
base 0 · sticky 10 · sidebar 20 · drawer 40 · modal 50 · toast 60 · tooltip 70 · 3D canvas behind content: -1 (landing uses explicit layering).

## Motion tokens (details in `02-motion-system.md`)
`--ease-out: cubic-bezier(.22,1,.36,1)`, `--dur-fast 150ms`, `--dur 240ms`, `--dur-slow 480ms`. Spring presets live in `src/lib/motion.ts` (created in U02).

## Texture
Subtle paper grain overlay (SVG noise, 3% opacity) on `--paper` canvas only. Optional on hero. Never on data surfaces.
