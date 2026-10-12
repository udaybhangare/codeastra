# 03 — Low-Level Design

## 3.1 Cost model
Each invocation has a **cost vector** `(cpu_ms, mem_mb_ms, db_ms, bytes)` and a scalar **cost unit** `c = a·cpu_ms + b·db_ms + g·bytes/1024 + m·mem_mb_ms/1000` (weights configurable; default a=1,b=1.5,g=0.1,m=0.2). Pre-execution estimate = per-(tenant,task) EWMA, falling back to task-type prior. Post-execution actuals correct it. This is why a rate limit is insufficient: 1 `cpu-burn` ≈ 500 `echo`.

## 3.2 Admission
Layered, cheapest first:
1. Auth/JWT verify (HMAC, in-memory key cache).
2. **Token bucket** per tenant: rate (req/s) + burst. Redis `EVALSHA` Lua for correctness across replicas; local pre-check to avoid RTT.
3. **Cost bucket**: refill = tenant's cost-units/s allowance (the real quota); debit estimated cost.
4. **Concurrency cap** (in-flight) and **queue depth cap** (bounded queue; drop-tail with reason).
5. **Bandwidth bucket** (bytes/s) on request+response size.
Rejects carry reason codes: `RATE`, `COST_QUOTA`, `CONCURRENCY`, `QUEUE_FULL`, `BANDWIDTH`, `QUARANTINE`.

## 3.3 Scheduler — cost-aware Deficit Round Robin
- Per-tenant FIFO queue `Q_t`, weight `w_t`, deficit counter `D_t`, quantum `Q = base × w_t`.
- Loop: for each active tenant in ring: `D_t += quantum_t`; while head cost ≤ `D_t` and worker slot free: dispatch, `D_t -= cost`. If queue empty, `D_t = 0` (no hoarding).
- Work-conserving: if only one tenant has work, it gets everything (no idle waste). Under contention, shares converge to weights.
- Head-of-line avoidance: cost cap per dispatch slice; oversize jobs need accumulating deficit rather than blocking the ring.
- Quarantine lane: separate low-weight DRR ring with its own worker slot cap.
- Complexity O(1) amortized per dispatch.

## 3.4 Workers
- One long-lived container per tenant: `cpus` (CFS quota), `memory` + `memory-swap` = limit, `pids-limit`, read-only rootfs, no extra caps, dedicated bridge network.
- Worker = small Go HTTP server: `/run` executes task (cpu-burn: busy loop for N ms; mem-alloc: allocate+touch N MB; io-heavy: generate N KB payload; db-query: runs via platform DB proxy; echo).
- Live adjustment: `docker update --cpus --memory` through Docker API (cgroup v2 `cpu.max`, `memory.max`), no restart.
- Health + OOM watch via Docker events.

## 3.5 Shared DB contention
Postgres is real. Platform owns a pooled DB proxy: per-tenant max conns (semaphore), `statement_timeout` per tier, `SET LOCAL application_name=tenant`. `db-query` tasks include `pg_sleep`, large sorts/aggregations to create real contention. DB time measured per tenant.

## 3.6 Metrics pipeline
- Events: `{tenant, task, queue_wait, exec, total, cpu_ms, mem_peak, db_ms, bytes, status, reason}`.
- Aggregator: 1s tumbling windows per tenant; HDR histogram for p50/p95/p99; ring buffer of last 10 min; cumulative counters.
- Container stats (cpu usage, memory) polled from Docker stats every 1s.
- Fanout: detector (in-process channel), WS hub (throttled 1/s snapshots), ledger writer (batched every 5s).

## 3.7 Fairness metrics
- **Jain's index** `J = (Σx_i)² / (n·Σx_i²)` over normalized share `x_i = usage_i / entitlement_i`.
- **Victim p99 inflation** = `p99_now / p99_baseline` for non-offending tenants.
- Utilization = total busy CPU / host CPU.

## 3.8 Config & policy
`policies` table cached; changes propagate via Postgres `LISTEN/NOTIFY` → in-memory swap (atomic pointer). Tiers free/pro/enterprise define reservations (guaranteed share), limits (hard ceiling), weight.

## 3.9 Concurrency/time
Single scheduler goroutine per ring, channels for enqueue; fixed 1s control tick; all time via injectable clock (enables deterministic tests and replay).
