# 02 — High-Level Architecture

## Topology
```
 EC2 #2 (loadgen)                    EC2 #1 (platform, docker-compose)
 ┌───────────────┐   HTTPS   ┌──────────────────────────────────────────────────────┐
 │ loadgen (Go)  │──────────▶│ Caddy ─▶ bulkheadd (Go monolith, modular)            │
 │ scenarios,    │           │           ├─ gateway/auth (API key → JWT)             │
 │ seeds         │           │           ├─ admission (quota, token bucket, caps)    │
 └───────────────┘           │           ├─ scheduler (cost-aware DRR)               │
                             │           ├─ dispatcher ──▶ tenant worker containers  │
 Browser ───────────────────▶│           │        (cgroup cpu/mem/pids limits)       │
 (Next.js dashboard)  WS/REST│           ├─ metrics (1s windows, HDR percentiles)    │
                             │           ├─ detector (victim-impact attribution)     │
                             │           ├─ throttle controller (ladder, AIMD)       │
                             │           ├─ usage/showback ledger                    │
                             │           └─ admin API + WebSocket stream             │
                             │  predictor (FastAPI)   Postgres (policies+ledger+shared│
                             │  Redis (buckets)       contended DB)   dashboard       │
                             └──────────────────────────────────────────────────────┘
```

## Planes
- **Data plane (hot path):** gateway → admission → scheduler → dispatcher → worker → (DB). Latency-critical, no blocking calls to Postgres on the hot path (policies cached in memory, refreshed on change).
- **Control plane:** metrics → detector/predictor → throttle → *applies* weights, rates, cgroup limits. Runs on a 1s tick, decoupled from requests.
- **Management plane:** admin REST + WS, scenario runner, usage ledger, tenant portal API.

## Why a modular monolith
24h and 3–4 people: one Go binary with strict package boundaries and interfaces (`Scheduler`, `Admitter`, `Detector`, `Throttler`) avoids network contracts between internal pieces. Boundaries are documented so each can be split out (doc 15). Only the predictor is a separate process (Python ML libs), and workers are separate containers (the isolation unit).

## Request lifecycle
1. `POST /invoke/{task}` with `Authorization: Bearer <JWT>` (or `X-API-Key` once to mint a JWT).
2. Auth resolves `tenant_id`, `tier`; policy snapshot looked up in memory.
3. Admission: token bucket (Redis-backed, local fast path), concurrency cap, queue depth cap, bandwidth bucket. Reject with `429`/`503` + `X-Reason` header + `Retry-After`.
4. Cost estimator assigns estimated cost units from task type + params (EWMA of observed cost per task per tenant).
5. Enqueue into the tenant's queue; DRR dispatches when credit available and worker has capacity.
6. Dispatcher calls tenant worker `POST /run`; worker executes task under cgroup limits, may use shared DB via platform-provided pooled connection (conn cap per tenant, `statement_timeout`).
7. Response returns; actual cost recorded → metrics + ledger; estimator updated.

## Isolation modes (A/B)
`ISOLATION=on|off` runtime toggle. OFF = single global FIFO, no per-tenant caps, unlimited cgroups, detector idle. Same code path otherwise, so comparison is fair.

## Failure behavior
Worker OOM-killed → only that tenant's container restarts; others unaffected; event logged. Predictor down → detector falls back to in-process baseline. Redis down → local token buckets (degraded, logged). Postgres slow → per-tenant DB timeouts protect others.

## Ports/containers (compose)
`caddy`, `bulkheadd`, `predictor`, `postgres`, `redis`, `dashboard`, `worker-<tenant>` (spawned dynamically), `loadgen` on second box.
