# Prompt 13 — Admin API & live stream

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/04, contracts/openapi.yaml, contracts/ws-messages.schema.json.

## Goal
Implement all admin endpoints and the WebSocket hub.

## Build
- Endpoints per doc 04: tenants, live policy edit (validated, audited), pin level, events, isolation toggle (applies scheduler swap + cgroup limit mode + detector enable), scenario run/status (delegates to loadgen via HTTP), runs/results, predictor state.
- WS hub: 1 Hz `snapshot`, immediate `event`, `run_progress`, `run_result`; backpressure (drop oldest snapshot for slow clients); reconnect-safe (initial full snapshot).
- Admin auth + CORS for dashboard origin.

## Acceptance
- Contract tests vs OpenAPI; WS client test receiving snapshot within 1.2 s; slow client doesn't block others.
- Toggle isolation at runtime without restart.

## Do NOT
Expose admin routes without role check; broadcast other tenants' data on tenant-scoped streams.
