# U04 — Landing page: route move, hero, Lenis, nav

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/04 (sections 1 + global chrome), docs/ui/03, docs/ui/02.

## Goal
`/` becomes the landing page with the interactive 3D hero. The current Overview moves to `/overview`.

## Build
- Routing: create `src/app/overview/page.tsx` rendering the existing `<Overview/>`; make `src/app/page.tsx` the landing. Update `AppShell` (`src/components/app-shell.tsx`) so `/` and `/portal` bypass the admin shell (landing must not mount the admin stream). Temporarily keep the old sidebar's Overview link pointing at `/overview`.
- `src/components/landing/`: `LandingRoot` (Lenis provider, scroll progress store), `FloatingNav`, `Hero` (headline, CTAs with `Magnetic`, `IsolationSwitch` demo toggle, hint chip), `ProgressRail`, `DecorBlobs` (parallax), `HullBackdrop` (fixed canvas, `mode="landing"`, click-to-attack demo).
- Hero uses `Hull` with scripted tenants; isolation switch changes visible behaviour; compartment click triggers a 6 s demo attack.
- Landing metadata/title; `prefers-reduced-motion` handling.

## Acceptance
- `tsc --noEmit` + eslint on `src/components/landing`, `src/app/page.tsx`, `app-shell.tsx` pass.
- `/overview`, `/incidents`… still load behind the admin shell.
- ACTION NEEDED FROM YOU: `pnpm dev`, open `/`; confirm: bright hero, hull follows cursor, toggle OFF makes a flood spread, clicking a compartment floods then seals, smooth inertial scroll, "Launch Console" goes to `/overview`.

## Do NOT
Build sections 2–7 (that is U05); change admin pages' design; start the WS stream on `/`.
