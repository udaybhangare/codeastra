# Prompt 12 — ML challenger (STRETCH — only after integration freeze)

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/07 (ML section), docs/09.

## Goal
Train and serve a GBM overload predictor and compare against baseline by lead time.

## Build
- Data export: loadgen + platform emit per-second feature rows with labels (overload within 10 s) across scenarios S1–S7 and ≥ 20 seeds, ON and OFF modes. Store as parquet/CSV.
- `predictor/train.py`: split by scenario+seed (no row leakage), LightGBM/HistGB, calibrate probabilities, save artifact + metadata (feature list, version).
- Serve via `/predict` with `model=gbm`; feature flag in admin API.
- `predictor/eval.py`: PR-AUC, lead time per scenario, false alarms/hour; output JSON for dashboard chart.

## Acceptance
- Eval report exists; ML vs baseline lead-time table; if ML doesn't beat baseline, say so and keep baseline default.

## Do NOT
Leak labels via future features; claim production accuracy.
