# 00 — Problem Analysis

## The statement, decoded
| PS phrase | What it really means | Where we satisfy it |
|---|---|---|
| "one customer can consume disproportionate CPU, memory, network or DB capacity" | Isolation must cover **four resources**, not just request count | per-tenant cgroups, DB pool caps, bandwidth buckets (doc 05) |
| "Strong isolation must coexist with efficient utilization" | Static partitioning is a *wrong* answer; the system must be work-conserving (idle capacity is borrowable) | reservations + burst, DRR (doc 03) |
| "enforces quotas and adaptive resource policies" | Static quotas **plus** policies that change at runtime | throttle ladder (doc 06) |
| "measuring tenant-level latency and resource consumption" | Per-tenant p50/p95/p99, CPU-ms, mem, DB-ms, bytes | metrics pipeline (doc 03/04) |
| "Demonstrate under deliberately abusive workload patterns" | A scripted, repeatable attack suite | scenario library (doc 09) |
| "Do not equate a simple API rate limit with full tenant isolation" | A rate limit counts requests; a request can cost 1ms or 10s of CPU. Need *cost-aware* and *resource-level* enforcement | cost-aware DRR + cgroups (doc 05) |

## Expected prototype checklist → our module
tenant identity → `auth` · resource quotas → `policies`+`admission` · rate limiting → `ratelimit` · workload scheduler → `scheduler` (DRR) · usage metrics → `metrics`+`usage` · noisy-neighbor detector → `detector` · adaptive throttling → `throttle` · admin API/dashboard → `admin`+`dashboard`.

## Convergence tracks
- **Cybersecurity**: signed tenant identity, per-tenant policy, cross-tenant access denial, abuse/DoS as a security threat model (doc 05).
- **AI**: overload prediction sidecar, baseline vs ML lead-time comparison (doc 07).
- **Web**: ops dashboard, tenant portal, billing-like showback (doc 08).

## What "good" looks like to a judge
1. Same attack, two runs: OFF → victims collapse; ON → victims flat. Numbers on screen.
2. The abuser is not just blocked: it is *measured, explained, throttled gradually, and recovers* when it behaves.
3. A legitimate traffic spike is **not** punished (false-positive control).
4. Unit-cost honesty: isolation costs X% overhead/utilization; we show it.

## Non-goals
Not a real FaaS security sandbox (no gVisor/Firecracker), not multi-host orchestration, not a billing system of record. Documented in doc 15 as future work.
