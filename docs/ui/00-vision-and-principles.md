# UI 00 — Vision & principles ("Paper & Ultramarine")

Supersedes the look-and-feel parts of `docs/08-frontend-ux-spec.md`. Screens, personas and data contracts there still apply; **everything visual is redesigned from scratch**. Do not reuse the old dark theme, colours or component styling.

## One-sentence vision
A bright, tactile, poster-like control room where every tenant is a sealed **compartment** of a ship, and a judge can *see* the noisy neighbor get contained.

## Audience & goal
- Primary: hackathon judges watching a 3–5 min demo (`docs/13`). Wow factor + a story understood in 30 s without narration.
- Secondary: operators (dense but beautiful console) and tenant developers (friendly portal).

## The one metaphor: the Hull
| Product concept | Visual metaphor |
|---|---|
| Host machine | Ship hull (cutaway, side view) |
| Tenant | Sealed compartment (own colour tint, name plate) |
| Noisy neighbor | Compartment "floods": rising tangerine→raspberry water, vibration |
| Throttle ladder (Normal→Quarantine) | Bulkhead door closing in steps (open, ajar, half, sealed, locked, welded) |
| Burst / idle capacity | Water level that may rise to the hard-limit line |
| Blast radius | Flood stays inside one compartment |
| Predictor | Blue ghost water level ahead of the real one |
Use the metaphor in 3D (landing, Overview mini hull, portal hero) and echo it in 2D (compartment heatmap cells, ladder door icons). Never force it where it hurts clarity (tables, forms).

## Principles
1. **Bright, never dark.** Warm paper canvas, white cards, one bold ultramarine, tangerine/lime pops. No black backgrounds, no dark mode.
2. **Playful but precise.** Springy motion and big radii, yet numbers are mono, aligned and readable.
3. **Story first.** Each screen has one hero element (the thing a judge's eye lands on) and supporting detail beneath.
4. **Everything is alive.** Data animates from the WebSocket; no manual refresh; numbers tick, bars glide, cells breathe.
5. **Every automated action is one click from its explanation** (Why drawer).
6. **Honest state.** Loading, empty, error, disconnected states are designed, never blank.
7. **Unique components.** No stock shadcn look. Every component follows `07-component-catalog.md`.
8. **Colour is never the only signal:** status always pairs colour with an icon/shape/label (colour-blind safe).

## Do / Don't
- DO use the status colours only for status (healthy/contended/throttled/predicted). Ultramarine = brand + interactive + "predicted" tints.
- DO keep contrast AA on paper/white (ink `#14142B`, never grey-on-grey below 4.5:1).
- DON'T use gradients on data marks (charts), only on hero/decor surfaces.
- DON'T use drop shadows heavier than tokens in `01-design-tokens.md`.
- DON'T put more than one looping animation in the viewport besides the hull and live data.
- DON'T hardcode tenant names; tenants come from the stream.

## Scope boundaries
Keep the data layer: `dashboard/src/lib/{store,api,ws-types,mock-stream,scenarios,runs,ladder,evidence,export,portal,use-poll,lab,ui}.ts`. Extend only when a doc here needs a new derived selector. Routes stay: `/` (landing), `/overview`-equivalent admin home, `/incidents`, `/scenarios`, `/tenants`, `/predictor`, `/audit`, `/portal`.

## Success test (human, by eye)
A first-time viewer, with sound off, can say within 30 s: "one tenant went bad, its compartment sealed, the others stayed fine."
