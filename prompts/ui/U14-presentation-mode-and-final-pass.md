# U14 — Presentation mode & final cohesion pass

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/02 (Presentation mode), docs/13-demo-script-and-pitch.md, docs/ui/05 (Scenario Lab presentation).

## Goal
Make the whole UI demo-ready for judges and ensure visual consistency.

## Build
- Presentation mode across Overview, Incidents, Scenario Lab: big type, hidden config, enlarged hull, 120 px A/B numbers, sidebar auto-collapse, smooth layout transition.
- Align with the 8-step demo script in docs/13: ensure each step has an obvious on-screen target (isolation switch, S1/S2/S6 cards with the documented seeds, Why drawer, portal link).
- Cohesion sweep: spacing/radius/shadow tokens only, duplicate styles removed, consistent copy tone, favicon + page titles + meta.
- Delete `_tokens` and `_hull` demo routes and unused legacy components.
- Update `docs/08-frontend-ux-spec.md` header with a pointer to `docs/ui/`, and add a summary entry to `docs/DEVIATIONS.md`.

## Acceptance
- tsc + eslint + one `pnpm build` pass.
- ACTION NEEDED FROM YOU: rehearse the demo path end to end once (landing → overview → scenarios → drawer → portal) with `P` on; note any rough spot.

## Do NOT
Add new features; change backend or contracts.
