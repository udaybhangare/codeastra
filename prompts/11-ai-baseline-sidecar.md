# Prompt 11 — Predictor sidecar (baseline)

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/07, contracts/predict.schema.json.

## Goal
FastAPI service with explainable baseline forecasting, plus Go client with timeout/fallback.

## Build
- `predictor/`: `/predict`, `/health`, `/model/select`; Holt smoothing + z-score anomaly → `p_overload`, `eta_s`, `top_factor`.
- Stateless per request with a small rolling state cache keyed by tenant (documented).
- Go side `internal/predictor`: client (150 ms timeout), in-process EWMA fallback, caching of last prediction, metrics for latency/errors.
- Wire into detector (as extra evidence) and throttle predictive hook (flagged).

## Acceptance
- Synthetic ramps: baseline alerts ≥ 3 s before threshold crossing on ≥ 80% of ramps; false alarms on steady/noisy-flat traces < 1/hour-equivalent.
- Kill sidecar → platform continues, fallback logged.

## Do NOT
Put prediction on the request hot path.
