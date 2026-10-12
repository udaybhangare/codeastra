# Prompt 08 — Usage ledger & showback

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/03 §3.1, docs/04, docs/08 (tenant portal).

## Goal
Billing-like usage metering.

## Build
- `internal/usage`: batch-write window aggregates to `usage_ledger` every 5s; idempotent upserts.
- Rate card config (demo $ per cost unit, per GB-s, per DB-s; tier multipliers, free allowance).
- Queries: usage by tenant/time range, cost breakdown by resource and task, "top spenders".
- Endpoints `/v1/me/usage`, `/v1/me/showback`, `/admin/usage`.

## Acceptance
- Sum of ledger cost units equals sum of per-request `X-Cost-Units` within 1% in a test run.
- Showback totals reproduce from raw rows.

## Do NOT
Claim this is a financial system of record (label "showback / estimate").
