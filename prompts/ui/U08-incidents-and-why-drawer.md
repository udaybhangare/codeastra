# U08 — Incidents timeline & "Why?" drawer

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/05 §2, docs/ui/07 (IncidentTimeline, DecisionDrawer), `src/lib/evidence.ts`, `export.ts`, existing `components/incidents/*`.

## Goal
Rebuild the Incidents page and the shared Decision drawer.

## Build
- `IncidentTimeline` (SVG swimlanes, drag-pan + wheel-zoom, door-icon nodes, dwell segments, now-line, predicted hollow nodes, hover cards).
- Filters (tenant, level, kind, time range chips), incidents list grouped by culprit, `DecisionDrawer` (sentence, evidence chips from `evidence.ts`, before/after mini charts, JSON collapsible, actions, actor, copy/export).
- Reuse the drawer from Overview/Audit via a single export; delete legacy `why-drawer.tsx` after replacing imports.

## Acceptance
- `tsc --noEmit` + eslint touched files; drawer opens from Overview, Incidents, Audit.
- ACTION NEEDED FROM YOU: run a mock scenario (or use mock stream), open `/incidents`; confirm timeline pans/zooms, nodes open the drawer with a plain-English sentence and evidence chips.

## Do NOT
Change event schema; add server calls beyond existing `api.ts`.
