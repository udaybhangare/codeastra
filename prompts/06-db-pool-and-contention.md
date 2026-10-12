# Prompt 06 — Shared DB proxy & contention

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/03 §3.5, docs/09 S3.

## Goal
Make Postgres a genuinely contended, per-tenant-guarded shared resource.

## Build
- `internal/dbpool`: pgx pool with global max; per-tenant semaphore (`db_conns`), acquire timeout → `DB_CONNS` reject reason; `statement_timeout` per tier via `SET LOCAL`; `application_name = tenant`.
- Internal endpoint for workers `POST /internal/db` (authenticated with per-worker secret) executing named query kinds: `point` (fast), `report` (heavy aggregation), `slow` (pg_sleep N), `hog` (holds connection N s).
- Isolation OFF → no per-tenant semaphore, no per-tenant timeout.
- Record `db_ms` and `conn_wait_ms` per tenant.

## Acceptance
- Test: tenant with 2-conn cap running 50 `hog` queries never holds >2 conns; another tenant's `point` query p99 remains < 2× baseline. Same test with OFF shows starvation.

## Do NOT
Let workers connect to Postgres directly.
