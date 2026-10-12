# Prompt 17 — Tenant portal

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/08 (Tenant Portal), docs/04 tenant endpoints.

## Goal
A tenant-facing view proving the Web convergence and the "explain to the customer" story.

## Build
- Login by API key → JWT (stored in memory, not localStorage).
- Pages: Usage vs quota gauges; latency/request history; Throttle status banner with "why" + expected recovery; Showback table + chart; API key rotate.
- Strict tenant scoping: portal only calls `/v1/me/*`.

## Acceptance
- Log in as rogue-ml during S1 → see throttle explanation; log in as acme-shop → see none.
- Cannot view another tenant's data (manual + automated test).

## Do NOT
Reuse admin endpoints or admin token in the portal.
