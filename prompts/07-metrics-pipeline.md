# Prompt 07 — Metrics pipeline

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/03 §3.6–3.7.

## Goal
Per-tenant, per-window metrics with accurate tail latency, plus host stats, fairness metrics, and fan-out.

## Build
- `internal/metrics`: event ingestion channel; 1s tumbling windows per tenant (HDR histograms for latency, queue-wait, exec); counters; 10-min ring buffer; host util from Docker stats + `/proc`.
- Fairness: Jain's index over share/entitlement; victim p99 inflation using frozen baselines (needs "calm baseline" tracker shared with detector).
- Subscribers: `Subscribe(chan Window)` for detector/WS/ledger.
- Prometheus-style `/metrics` (optional, cheap).

## Acceptance
- Unit tests: percentile accuracy vs sorted ground truth ≤1% error; window rollover correctness with fake clock; Jain's index known vectors.
- Load test: 5k events/s with <5% CPU of one core.

## Do NOT
Allocate per event on the hot path unnecessarily; use wall-clock directly.
