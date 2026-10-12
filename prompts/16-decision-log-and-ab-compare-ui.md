# Prompt 16 — Incident timeline, Why drawer, Scenario Lab, A/B compare

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/08, docs/06 (explainability), docs/09 (A/B protocol).

## Goal
The screens that win the demo.

## Build
- Incidents: timeline of ladder transitions across tenants; click → **Why drawer** (plain-English sentence, evidence table, metric snapshot sparkline, actions applied, predictor score).
- Scenario Lab: cards for S1–S8 with description/expected outcome, seed + duration, Run, live progress via `run_progress`.
- A/B Compare: OFF vs ON side-by-side p99 charts (aligned time), result table (inflation, Jain, detect/mitigate time, FPs, utilization, abuser goodput), "Replay seed", "Load recorded result" fallback, export JSON/PNG.
- Presentation mode toggle.

## Acceptance
- Running S1 live populates both runs and renders the comparison; recorded fallback works offline.
- Every automated action row links to its drawer.

## Do NOT
Show raw JSON as the primary explanation; fabricate numbers in the UI.
