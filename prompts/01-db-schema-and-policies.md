# Prompt 01 — DB schema & policy store

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/04, docs/03 §3.8.

## Goal
Postgres schema, migrations, seed data, and an in-memory policy cache with live reload.

## Build
- Migrations (golang-migrate or goose) for all tables in doc 04, plus `demo` schema tables used by `db-query` tasks (e.g. `demo.events` with ~2M rows via seed, indexes that allow both fast and deliberately slow queries).
- Seed: tenants (acme-shop, data-co, bursty-news, rogue-ml, leaky-app), API keys (print once; store hash), tier presets free/pro/enterprise from doc 03/06.
- `internal/policy`: `Store` interface, Postgres impl, atomic-pointer snapshot cache, `LISTEN/NOTIFY` on `policies` change, validation (reserve ≤ limit etc.).

## Acceptance
- `make migrate && make seed` idempotent.
- Test: update a policy row → cache reflects within 1s; invalid policy rejected.

## Do NOT
Query Postgres on the request hot path.
