# U11 — Predictor & Audit log

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/05 §5–6, docs/ui/07 (ForecastChart, LeadTimeBars, FeatureBars), `docs/07-ai-predictor-spec.md`, existing `components/admin/{predictor,audit}.tsx`.

## Goal
Rebuild the two remaining admin pages.

## Build
- Predictor: tenant/Host chip selector, `ForecastChart` (actual vs forecast + band + alert markers + lead-time brackets), `LeadTimeBars` (baseline vs ML), `FeatureBars`, model status chip, offline empty state.
- Audit: filter bar, live-tail toggle with slide-in rows, expandable evidence rows, open-in-Incidents link, export, virtualised rows > 200.

## Acceptance
- `tsc --noEmit` + eslint touched files; both pages render on mock/fixture data and show empty states when data is missing.
- ACTION NEEDED FROM YOU: `/predictor` and `/audit`; confirm charts, filters and expandable rows work.

## Do NOT
Fabricate ML metrics; poll faster than the existing `use-poll` interval.
