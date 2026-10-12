# UI 03 — 3D Hull spec (React Three Fiber)

Stack: `three`, `@react-three/fiber`, `@react-three/drei`, optionally `@react-three/postprocessing` (only subtle bloom if cheap; skip if it hurts FPS). Code lives in `dashboard/src/components/hull/`. Procedural geometry first (boxes, rounded boxes, cylinders, planes); no external GLTF required.

## Look
Bright, matte "toy-industrial" style: soft clay/paper materials (`MeshStandardMaterial`, roughness .8), warm key light + cool ultramarine fill, soft contact shadows (`ContactShadows`), light paper-coloured background (transparent canvas over the page's `--paper`). No dark scenes.

## Scene anatomy
- **Hull:** side cutaway of a ship, rounded bottom, cream shell `#FFFFFF` with ultramarine trim.
- **Compartments:** N slots in a row (N = number of tenants, default 5, supports 3–10; wraps to a 2-row grid above 6). Each is a rounded box with a glass front, a name plate (drei `Text`/`Html`), a water volume, and a sliding **bulkhead door** between neighbours.
- **Water:** a plane/box scaled on Y = usage ratio (0–1.2; above 1 shows overflow ripples). Colour lerps ok→warn→bad by level; "predicted" ghost water = translucent ultramarine plane at `p_overload`.
- **Door:** slides down in 5 steps by ladder level (0 open … 5 welded with hatch pattern + lock icon).
- **Particles:** small spheres = requests, flowing left→right in lanes per compartment; rate ∝ `rps` (cap 60 instances; use instancing).
- **Dock/waterline & keel:** a "host" gauge strip along the keel showing `host.cpu_util` / `mem_util`.

## State model (props API)
```ts
type HullTenant = { id: string; tier: Tier; level: Level; usage: number /*0..1.2*/; pOverload?: number; label?: string };
type HullProps = {
  tenants: HullTenant[];
  isolation: "on" | "off";       // off => doors never close, flood leaks to neighbours
  mode: "landing" | "mini" | "portal";
  highlightId?: string;          // portal: "your compartment"
  onHover?(id?: string): void;
  onSelect?(id: string): void;
  scrollProgress?: number;       // landing only, 0..1 drives camera + scripted states
};
```
Scripted landing states derive tenants from a fake array; mini/portal derive from `useStream` snapshot via a pure selector `toHullTenants(snapshot)` (add to `src/lib/hull.ts` in U03).

## Isolation ON vs OFF behaviour
- OFF: when one compartment floods, water "leaks" through open doors; neighbours' levels rise (visual only, ratio-driven by `victim_inflation` if present, else scripted).
- ON: door closes by level, neighbours stay calm.

## Camera & interaction
- Orthographic-ish perspective (fov 28) side view, slight 12° tilt. Cursor parallax: camera/hull rotate ±6° yaw, ±3° pitch with damped lerp (`maath`/manual damp). Hovering a compartment: lift +0.15, glow rim, show tooltip card (tenant, tier, level, p99).
- Click (mini/portal): `onSelect`; landing: click toggles a demo "attack" on that compartment for 6 s (it floods, door seals).

## Landing camera path (scrollProgress)
| Progress | Section | Camera / scene |
|---|---|---|
| 0.00–0.12 | Hero | Wide shot, calm, gentle bobbing, parallax active |
| 0.12–0.30 | The problem | Push in on compartment 3; it floods; neighbours' water rises (isolation off) |
| 0.30–0.50 | Fair queue (DRR) | Particle lanes highlight; a rotating "quantum ring" over lanes |
| 0.50–0.65 | Hard walls (cgroups) | Door/walls glow; kernel labels (cpu.max, memory.max, pids.max) pop on walls |
| 0.65–0.80 | The detector + ladder | Door closes step by step 1→5 with level chips |
| 0.80–0.92 | AI predictor | Ghost water appears ahead of real water |
| 0.92–1.00 | Proof / CTA | Pull back to wide calm hull, all healthy, CTA floats forward |
Script lives in one `storyKeyframes` table; interpolate between keyframes by progress.

## Performance budget
- 60 fps on integrated GPU laptop @1280×720; DPR clamped `[1, 1.75]`; ≤ 80 draw calls; particles instanced; no real-time shadows (baked contact shadows); no postprocessing unless FPS ≥ 55.
- Lazy-load canvas with `next/dynamic({ ssr: false })`; show an illustrated static SVG hull as the Suspense/loader poster (this doubles as a failure fallback).
- Pause `frameloop` (use `frameloop="demand"` + invalidate) when canvas is off-screen (IntersectionObserver).
- Mini hull (Overview/Portal): max 40 particles, no parallax unless hovered.

## Variants
| Variant | Size | Camera | Interactions |
|---|---|---|---|
| `landing` | full-viewport, fixed behind content | scripted | parallax, hover, click-attack |
| `mini` | ~420×240 card in Overview | fixed | hover tooltip, click→filter tenant |
| `portal` | ~360×220 hero card | fixed, zoomed on `highlightId` | hover only |
