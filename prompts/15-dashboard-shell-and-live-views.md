# Prompt 15 — Dashboard shell & live views

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/08, contracts/ws-messages.schema.json.

## Goal
Admin console shell + live Overview, built against the mock stream first, then the real backend.

## Build
- Next.js app router layout: sidebar (Overview, Incidents, Scenario Lab, Tenants, Predictor, Audit), top bar with isolation mode badge + connection status.
- WS client store (zustand), reconnect with backoff, typed messages from contracts.
- Overview: KPI strip, tenant×resource heatmap, per-tenant p99 line chart (victims highlighted), ladder badges, active throttles list.
- Design system: dark theme, colour language from docs/08, skeletons/empty/error states, responsive down to laptop projector 1280×720.

## Acceptance
- Runs against mock stream with no backend; switching `NEXT_PUBLIC_WS_URL` to real works.
- Lighthouse a11y ≥ 90; no layout shift on updates; renders 5 tenants × 10 min history smoothly.

## Do NOT
Poll REST for live data; hardcode tenant names.
