# Prompt 05 — Cost-aware DRR scheduler & dispatcher

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/03 §3.3, docs/05.

## Goal
Fair, work-conserving scheduling with quarantine lane, wired end-to-end: gateway → admission → scheduler → worker → response.

## Build
- `internal/scheduler`: `Scheduler` interface; `DRR` implementation (per-tenant queues, quantum ∝ weight, deficit reset when idle, oversize-job accumulation, quarantine ring); `FIFO` implementation for Isolation OFF; runtime swap.
- `internal/dispatcher`: bounded worker slots (global + per-tenant concurrency), calls worker `/run`, enforces timeout, returns result + actual cost; updates cost estimator.
- Weight/limit changes applied live from policy snapshot and throttle controller API (`SetWeight`, `SetQuarantine`).
- Wire `POST /v1/invoke/{task}` through the whole path; response headers per doc 04.

## Acceptance
- Property test: with N always-backlogged tenants, long-run cost shares within ±5% of weight ratio; idle tenant doesn't hoard credit; single active tenant gets full capacity.
- Test: abuser filling queue doesn't increase victim queue wait beyond bound (DRR) while FIFO mode does.
- E2E: invoke echo/cpu-burn through real worker.

## Do NOT
Use unbounded queues or global locks on the dispatch path.
