# U07 — Overview (command center)

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/05 §1, docs/ui/07 (KpiTile, CompartmentHeatmap, LatencyChart, LadderBadge), docs/ui/03 (mini mode), `src/lib/store.ts`, `ladder.ts`, existing `components/overview/overview.tsx`.

## Goal
Rewrite the Overview as a bento command center with a live mini hull.

## Build
- Replace `components/overview/*` with: `KpiStrip` + `KpiTile` (ticker, sparkline, ring variant), `HullCard` (mini hull from `toHullTenants`, click filters tenant), `CompartmentHeatmap` (water-fill cells vs `ENTITLEMENT`, row `LadderBadge`), `LatencyChart` (Recharts restyled, victim thick/culprit dashed/event door markers), `ActiveThrottles`, `LiveFeed`.
- `LadderBadge` and `LadderStepper` in `components/domain/`.
- Skeleton/empty/disconnected states; pulse on change; no layout shift.
- "Why?" buttons open the existing drawer for now (replaced in U08).

## Acceptance
- `tsc --noEmit` + eslint on touched files; renders on the mock stream with no backend; 5 tenants × 10 min history without jank (check history window in store).
- ACTION NEEDED FROM YOU: `pnpm dev`, open `/overview` (mock stream); confirm heatmap cells fill/glow, KPI numbers tick, hull compartments follow tenants, ladder badges bounce on escalation, fits 1280×720 without scrolling the essentials.

## Do NOT
Poll REST for live data; hardcode tenant names; change the store contract.
