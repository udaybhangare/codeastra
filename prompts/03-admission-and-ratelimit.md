# Prompt 03 — Admission control & rate limiting

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/03 §3.1–3.2, docs/05.

## Goal
Layered admission with reason codes, cost estimation, Redis-backed token buckets.

## Build
- `internal/ratelimit`: token bucket interface; Redis Lua implementation (atomic refill+take) with local-cache fast path; in-memory fallback when Redis is down (log degraded mode).
- `internal/cost`: cost vector/unit formula, per-(tenant,task) EWMA estimator with task priors.
- `internal/admission`: pipeline — rate bucket, cost bucket, concurrency cap, queue-depth cap (queue interface), bandwidth bucket. Returns `Decision{Allow, Reason, RetryAfter}`.
- HTTP mapping: 429 (RATE, COST_QUOTA, BANDWIDTH), 503 (QUEUE_FULL, QUARANTINE), `X-Reason`, `Retry-After`.
- Isolation mode flag: when OFF, admission is pass-through (still measures).

## Acceptance
- Table-driven tests for each layer; concurrency test (1000 goroutines, no over-admission beyond burst).
- Test: 1 expensive task vs 500 cheap tasks both consume proportional cost tokens.

## Do NOT
Block on Redis without timeout (≤5 ms, then local fallback).
