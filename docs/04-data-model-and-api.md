# 04 — Data Model & API

## Postgres schema (platform DB; separate schema `demo` holds the contended tables)
```
tenants(id, name, tier, status, created_at)
api_keys(id, tenant_id, key_hash, prefix, created_at, revoked_at)
policies(tenant_id PK, tier, weight, reserve_cpu, limit_cpu, limit_mem_mb, rps, burst,
         cost_per_s, concurrency, queue_depth, db_conns, bandwidth_bps, updated_at)
usage_ledger(tenant_id, window_start, req, ok, rejected, cpu_ms, mem_mb_s, db_ms, bytes, cost_units, p99_ms)
throttle_events(id, ts, tenant_id, from_level, to_level, reason, evidence jsonb, actions jsonb, actor)
runs(id, scenario, seed, isolation_mode, started_at, ended_at, summary jsonb)
audit_log(id, ts, actor, action, target, detail jsonb)
```
Redis keys: `tb:{tenant}:rate`, `tb:{tenant}:cost`, `tb:{tenant}:bw`, `inflight:{tenant}`.

## Tenant API (auth: `Authorization: Bearer <JWT>`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/token` (X-API-Key) | mint JWT (15 min) with tenant_id, tier |
| POST | `/v1/invoke/{task}` | run a task; body = params |
| GET | `/v1/me/usage` | own usage vs quota |
| GET | `/v1/me/throttle` | own throttle state + explanation |
| GET | `/v1/me/showback` | billing-like cost breakdown |

Response headers: `X-Tenant`, `X-Queue-Wait-Ms`, `X-Cost-Units`, `X-Throttle-Level`, on reject `X-Reason`, `Retry-After`.

## Admin API (separate admin JWT, role=admin)
| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/tenants`, `/admin/tenants/{id}` | list/detail incl. live metrics |
| PUT | `/admin/tenants/{id}/policy` | change quotas live |
| POST | `/admin/tenants/{id}/level` | pin/unpin throttle level |
| GET | `/admin/events?since=` | decision log |
| POST | `/admin/isolation` `{mode:on|off}` | A/B toggle |
| POST | `/admin/scenarios/{name}/run` `{seed, duration}` | launch scenario |
| GET | `/admin/runs`, `/admin/runs/{id}` | A/B results |
| GET | `/admin/predictor` | predictor state/accuracy |
| WS | `/admin/stream` | 1 Hz snapshot + events |

## WebSocket message types
`snapshot` (per-tenant metrics, host util, fairness), `event` (throttle/predict/oom), `run_progress`, `run_result`.

## Contracts
Defined once in `contracts/` (OpenAPI + JSON schemas) so dashboard, loadgen, and platform teams can work in parallel (prompt 00).
