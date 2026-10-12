# U12 — Tenant portal

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/06, docs/ui/07 (UsageGauge, ThrottleBanner, ShowbackTable, ApiKeyPanel), docs/ui/03 (portal mode), `src/lib/portal.ts`, `use-poll.ts`, `evidence.ts`, existing `components/portal/portal.tsx`.

## Goal
Rebuild the portal in the same system with a friendlier tone and a "your compartment" mini hull.

## Build
- Top pill nav, greeting, `CompartmentHero` (portal-mode hull + status sentence + plan chip), `ThrottleBanner` (plain-English cause from `evidence.ts`, recovery countdown, what-you-can-do), 4–5 `UsageGauge`s, history charts (`LatencyChart` reuse), `ShowbackTable` (demo rates note), `ApiKeyPanel` (rotate confirm, reveal-once, copy).
- Keep the portal isolated from the admin stream (it must not mount the admin WS).

## Acceptance
- `tsc --noEmit` + eslint touched files.
- ACTION NEEDED FROM YOU: `/portal`; confirm gauges animate once, banner appears when throttled (mock), key rotate shows new key once with copy confirmation.

## Do NOT
Show other tenants' data; use admin jargon without tooltips.
