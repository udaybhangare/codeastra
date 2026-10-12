# U03 — 3D Hull core (React Three Fiber)

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/03, docs/ui/01 (colours), `dashboard/src/lib/ws-types.ts`, `dashboard/src/lib/ladder.ts`.

## Goal
A reusable, performant, interactive `Hull` component with landing / mini / portal modes, driven by props only.

## Build
- `src/components/hull/`: `Hull.tsx` (dynamic, `ssr:false`, Suspense poster), `Scene.tsx`, `Compartment.tsx`, `Door.tsx`, `Water.tsx`, `Particles.tsx` (instanced), `Keel.tsx`, `StaticHullPoster.tsx` (SVG).
- Props API exactly as docs/ui/03 (`HullProps`, `HullTenant`); `isolation` off/on behaviour; hover tooltip (Html), click callbacks, cursor parallax (damped), `scrollProgress` hook-in with a `storyKeyframes` table (stubbed keyframes, final tuning in U05).
- `src/lib/hull.ts`: pure `toHullTenants(snapshot)` (usage = max over cpu_share/mem/db/queue/bytes vs `ENTITLEMENT`, `pOverload` from `p_overload`) with a unit-testable shape.
- Perf: DPR clamp, instancing, frameloop pause off-screen, no shadows.
- Demo harness: `src/app/_hull/page.tsx` with a 5-tenant fake array, level sliders, isolation toggle, mode switcher.

## Acceptance
- `tsc --noEmit` + eslint on `src/components/hull`, `src/lib/hull.ts` pass.
- Quick unit test for `toHullTenants` (vitest/node test only if a runner already exists; otherwise a small pure-function check script noted in the summary).
- ACTION NEEDED FROM YOU: `pnpm dev`, open `/_hull`; confirm: compartments with name plates, water rises with the usage slider, doors close with level 0→5, flood leaks when isolation OFF, hover tooltip, cursor tilt; page stays smooth.

## Do NOT
Wire to the real stream or landing yet; load external GLTF/HDR files; use dark scenes or real-time shadows.
