# Prompt 14 — Load generator & scenario runner

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/09, contracts/scenario.schema.json.

## Goal
Deterministic, open-loop multi-tenant load generator with scenario library and A/B harness.

## Build
- `loadgen/`: scenario spec loader; seeded PRNG; arrival processes (poisson, burst, ramp, constant); task mix; per-tenant keys & token refresh; open-loop dispatch (don't wait for responses before next arrival); client-side latency capture; honor/ignore `Retry-After` per profile (retry-storm = ignore).
- Scenarios S1–S8 as JSON in `loadgen/scenarios/`.
- Runner: phases (warm-up/attack/cool-down), emits progress, writes result summary: per-phase per-tenant p50/p95/p99, inflation, error/reject counts. Calls admin API to set isolation mode; `ab` command runs OFF then ON with same seed and stores both in `runs`.
- Assertion engine: scenario `expect` blocks → pass/fail report.

## Acceptance
- Same seed → byte-identical request schedule (test).
- Achieved rate within 2% of target at 500 rps from a single box.
- `loadgen ab S1 --seed 42` prints OFF vs ON table.

## Do NOT
Use closed-loop clients (coordinated omission).
