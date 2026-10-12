# UI 02 — Motion system (springy & playful)

Libraries: **Motion** (`motion/react`, formerly framer-motion) for UI; **GSAP + ScrollTrigger** for the landing scroll story; **Lenis** for smooth scroll on the landing page only. Recharts animates via its own props; keep durations ≤ 600 ms.

## Spring presets (create `dashboard/src/lib/motion.ts`)
| Name | Config | Use |
|---|---|---|
| `springSoft` | stiffness 120, damping 18, mass 1 | Page/section entrance, cards |
| `springSnappy` | stiffness 400, damping 28 | Buttons, toggles, chips |
| `springBouncy` | stiffness 260, damping 12 | Success pops, badges, ladder change |
| `springSlow` | stiffness 60, damping 16 | Large layout moves, sidebar |
Plus `easeOut` tween for fades (240 ms).

## Interaction patterns
- **Hover:** cards lift 4 px + `--shadow-2` (springSnappy); icons wobble ±6° once. Buttons scale 1.04.
- **Press:** scale 0.96.
- **Magnetic buttons:** primary CTAs (landing, Run scenario) pull toward the cursor within 80 px, max 10 px offset.
- **Focus:** always `--ring`; never remove outlines.
- **Stagger:** lists/grids enter with 40 ms stagger, max 12 items then batch.
- **Number ticker:** KPI/metric values tween between updates (400 ms, easeOut). Never reset to 0 on update.
- **Layout animations:** use `layout` / `layoutId` for reorder (tenant tables), active nav pill, tab underline, selected scenario card.
- **Page transitions:** route change = old content fades up 8 px/out 120 ms, new content enters with `springSoft`; sidebar stays mounted.
- **Live data flashes:** a changed cell/chip gets a 600 ms background pulse of its status tint (not a layout shift).
- **Ladder escalation:** badge does `springBouncy` scale 1→1.25→1 and the door icon rotates to the new state; de-escalation is gentler (springSoft).

## Rules
1. At most one attention-grabbing loop per viewport besides the live hull/data (e.g. a pulsing "LIVE" dot is fine).
2. Animate `transform` and `opacity` only; never width/height/top/left.
3. No layout shift on live updates: reserve space with fixed/tabular numerals and min-widths.
4. Respect `prefers-reduced-motion`: disable parallax, magnetic, stagger and scroll-scrub; keep instant state changes and opacity fades.
5. Updates from the 1 Hz WS stream must never restart animations; interpolate toward the new value.
6. Keep any one tween ≤ 700 ms except landing scroll scrubbing.

## Landing scroll story (GSAP ScrollTrigger)
- Lenis drives scroll; `ScrollTrigger.scrollerProxy`/`lenis.on('scroll', ScrollTrigger.update)`; one master timeline pinned over the story section; hull camera and compartment states are scrubbed by progress (see `03-3d-hull-spec.md`).
- Text blocks fade/slide in on enter, reverse on leave (`toggleActions: "play none none reverse"`).
- Progress rail on the right edge: dots for sections, springBouncy fill.

## Presentation mode
Toggle with key `P` or the top-bar button. Effects: type scale ×1.35, secondary panels collapse, A/B numbers become 120 px display, sidebar auto-hides to icons, hull in Overview enlarges. Transition uses `springSlow` layout animation.
