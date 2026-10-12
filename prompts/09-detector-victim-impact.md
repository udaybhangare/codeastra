# Prompt 09 — Noisy-neighbor detector

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/06 (Steps 1–2), docs/03 §3.7.

## Goal
Victim-impact detection and culprit attribution with evidence.

## Build
- `internal/detector`: consumes windows; per-tenant calm baselines (EWMA, frozen during degradation); victim state with N-window persistence; attribution score (excess share × lagged Pearson correlation per resource); output `Finding{culprit, score, victims[], evidence{...}}`.
- Pure functions + a thin runner → easy to unit test with synthetic traces.
- Config thresholds in one struct; all values from doc 06.

## Acceptance
Table-driven tests with synthetic traces:
1. Single abuser, steady victim → culprit correct.
2. Busy-but-harmless tenant, no victim → no finding.
3. Flash crowd within reservation → no finding.
4. Two abusers → both ranked.
5. Victim degraded by its own overload → not a victim.
Report precision/recall on a generated suite (≥ 50 traces).

## Do NOT
Act on findings here; that's the throttle controller.
