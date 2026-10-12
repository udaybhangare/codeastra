# Prompt 19 — Test & chaos verification

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/01 (Q20), docs/09, docs/14.

## Goal
Evidence that claims in the FAQ are true.

## Build
- Consolidated `make test`: unit (DRR, buckets, ladder, detector, cost), integration (compose-based S1/S2/S3/S6 with assertions), security tests (cross-tenant access, token tampering, admin role).
- Chaos script: kill a tenant worker mid-load; stop Redis; stop predictor; slow Postgres (pg_sleep storm); verify degradation modes from docs/02.
- Repeatability: run S1 A/B 5× and report median + spread; write `docs/RESULTS.md` with real numbers, hardware, caveats.

## Acceptance
- All assertions pass or failures are documented honestly in `docs/RESULTS.md`.
- A table mapping each FAQ claim → test/evidence.

## Do NOT
Tune thresholds to one seed only; hide flaky results.
