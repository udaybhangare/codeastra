# U10 — Tenants & policy editor

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/05 §4, docs/ui/07 (TenantTable, PolicyEditor), `docs/04-data-model-and-api.md`, `src/lib/api.ts`, existing `components/admin/tenants.tsx`.

## Goal
Redesign the tenants table and the policy editing experience.

## Build
- `TenantTable` (rounded rows, sticky header, animated sort, inline quota bars, tier chips, level badges), `PolicyEditor` drawer (tier preset segmented control, sliders+numeric, pin-level `LadderStepper` with required reason, diff preview chips, optimistic toast, revert).
- Wire to the policy endpoints that already exist in `api.ts`; if editing endpoints are absent, render the editor read-only with a clear "view only" chip and note it in DEVIATIONS.

## Acceptance
- `tsc --noEmit` + eslint touched files.
- ACTION NEEDED FROM YOU: `/tenants`; click a row; confirm drawer, slider live values, diff chips, toast on save (or view-only chip if API absent).

## Do NOT
Invent API endpoints; skip the audit reason on pin-level.
