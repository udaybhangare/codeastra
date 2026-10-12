# Prompt 02 — Tenant identity & gateway

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/04, docs/05 (security controls), docs/02 (lifecycle).

## Goal
HTTP gateway with API-key→JWT exchange, JWT verification middleware, tenant context, admin role.

## Build
- `POST /v1/auth/token`: validate `X-API-Key` (prefix lookup + constant-time hash compare), issue 15-min JWT with `tenant_id, tier, exp, jti`.
- Middleware: verify JWT, put `TenantCtx` in request context; reject missing/expired/revoked; tenant_id **never** read from body/query.
- Admin JWT with `role=admin` from separate secret; audit log writes for admin actions.
- Request ID, structured logging, graceful shutdown, `/healthz`.
- Stub `POST /v1/invoke/{task}` returning echo (to be wired in later prompts).

## Acceptance
- Tests: valid/invalid/expired/revoked key; tenant A token cannot read tenant B's `/v1/me/*`; admin endpoints reject tenant tokens.
- Benchmark: JWT verify path ≤ 50µs/op (note result).

## Do NOT
Store raw API keys; accept tenant identity from headers like `X-Tenant`.
