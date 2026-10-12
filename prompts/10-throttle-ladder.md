# Prompt 10 — Adaptive throttle controller

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/06 (Step 3, recovery, safety rails), docs/05.

## Goal
Graduated, explainable, self-recovering throttle.

## Build
- `internal/throttle`: per-tenant state machine L0–L4; dwell timers, cooldowns, re-offense escalation, AIMD recovery; safety floors; manual pin/unpin.
- Actuators (interfaces, injected): scheduler weight/quarantine, rate/cost bucket multipliers, workerpool cgroup `Update`, db conn cap.
- Event emission: `throttle_events` rows + WS events with plain-English `explanation` templated from evidence.
- Predictive entry hook (`reason=PREDICTED`) behind flag; no-op until predictor exists.

## Acceptance
- State-machine tests with fake clock: escalation timings, no flapping under noisy score, recovery curve, re-offense.
- Integration: run S1 locally → ladder reaches Hard, victim p99 within 1.5× baseline, abuser recovers after attack stops.

## Do NOT
Throttle below safety floors (except Quarantine); apply actions without logging evidence.
