# Bulkhead — the problem and the solution, in plain words

Bulkhead is a multi-tenant isolation platform. Many customers (tenants) share one machine. The job is to stop one noisy neighbor from eating the machine, while still using idle capacity instead of wasting it.

## The problem

On a shared host, one customer can burn far more than their fair share of:

- **CPU** (heavy compute)
- **Memory** (big allocations that can crash the host)
- **Network** (huge payloads)
- **Database** (holding connections open so everyone else waits)

A normal **API rate limit** only counts requests. That is not isolation. One cheap `echo` and one 5-second CPU job both count as “one request,” but they cost about 500× apart. A tenant can stay under the request cap and still starve neighbors.

What “good” looks like:

1. Same attack, two runs. Protection **off**: victims collapse. Protection **on**: victims stay flat.
2. The abuser is measured, explained, throttled step by step, and allowed back when it behaves.
3. A real traffic spike is not punished.
4. We show the cost of isolation: how much utilization we give up to stay fair.

We are not building a full security sandbox (no Firecracker or gVisor), not a multi-host cluster, and not a real billing system.

## How the solution works

One platform box runs everything in **docker-compose**. A second box only generates load. A browser dashboard watches it live.

```
EC2 #2 (loadgen)  --HTTPS-->  EC2 #1 (platform)
                                  Caddy (HTTPS)
                                    bulkheadd (Go)
                                      auth → admission → scheduler → worker containers
                                      metrics → detector → throttle
                                    predictor (Python)   Postgres   Redis   dashboard
```

Three planes:

- **Data plane** (the hot path): each request is checked and scheduled. No database call on this path. Policies live in memory.
- **Control plane**: every 1 second, metrics decide who is hurting whom and tighten limits.
- **Management plane**: admin API, WebSocket stream, scenario runner, usage ledger, tenant portal.

### 1. Who is calling

The tenant sends an API key once and gets a short-lived **JWT**. The tenant id comes only from that signed token, never from the request body. Tiers are free, pro, and enterprise. Each tier has a reservation (guaranteed share) and a hard limit (ceiling).

### 2. Admission control

Before work is queued, cheap checks run in order:

1. JWT check
2. **Token bucket** for requests per second (Redis, so it stays correct if we add replicas)
3. **Cost bucket** — the real quota, in cost units per second
4. Concurrency cap and queue-depth cap
5. Bandwidth bucket (bytes per second)

Too much traffic gets `429` or `503`, with a reason (`RATE`, `COST_QUOTA`, `CONCURRENCY`, `QUEUE_FULL`, `BANDWIDTH`, `QUARANTINE`) and `Retry-After`.

### 3. Cost analysis

Every call has a cost vector: CPU time, memory, database time, and bytes. Those fold into one **cost unit**:

`cost = 1·cpu_ms + 1.5·db_ms + 0.1·bytes/1024 + 0.2·memory`

Before the job runs we estimate cost from recent history (**EWMA**). After it finishes we record the real cost and update the estimate. That estimate feeds the scheduler, the quota, and the **showback** screen (a billing-style breakdown, demo dollar rates, not a real invoice system).

### 4. Deficit Round Robin (the fair queue)

Each tenant has its own queue. A **Deficit Round Robin (DRR)** scheduler walks the tenants in a ring:

- Each tenant gets credit (a quantum) based on its weight.
- A job is dispatched only if the tenant has enough credit for that job’s cost.
- Empty queues do not hoard credit.
- If only one tenant has work, it can use the idle machine (**work-conserving**). Under contention, shares match the weights.
- A quarantine lane is a second, tiny-weight ring for bad actors.

This is weighted round robin that understands cost, not just “whose turn is it.”

### 5. Real isolation in the kernel

Each tenant gets its own long-lived Docker container, limited with **cgroup v2**:

| Resource | What stops the abuse | Real? |
|---|---|---|
| CPU | `cpu.max` and `cpu.weight`, plus DRR | Yes |
| Memory | `memory.max`; an OOM kill stays inside that container | Yes |
| Fork bombs | `pids.max` | Yes |
| Database | Per-tenant connection cap and `statement_timeout` on real Postgres | Yes |
| Queue | Per-tenant queues, DRR, depth cap, quarantine lane | Yes |
| Network | Bandwidth token bucket | App-layer only (stated honestly) |

Limits can change live with `docker update`. No container restart. If one worker is OOM-killed, only that tenant restarts. **Blast radius** stays at one tenant.

Idle capacity can still be borrowed up to the hard limit (**reservation + burst**). When neighbors start hurting, burst is taken back first.

### 6. Noisy-neighbor detector

We do not punish “busy.” We punish **causing harm**.

Every second:

1. **Victim:** a tenant inside its own quota whose p99 latency jumps well above its calm baseline (default: 2.5× for 3 windows).
2. **Culprit:** whoever is over their entitlement, and whose usage moves together with the victim’s latency (correlation). A legit flash crowd has high usage and no victim, so nobody is throttled.

Fairness on screen: **Jain’s index** (1.0 is perfectly fair) and **victim p99 inflation** (how much worse the good tenants got).

### 7. Adaptive throttle (a ladder, then AIMD)

| Level | Name | What happens |
|---|---|---|
| 0 | Normal | Nothing |
| 1 | Observe | Flag and log only |
| 2 | Soft | DRR weight × 0.5, rate × 0.7, no burst |
| 3 | Hard | CPU quota cut (floor near the reservation), fewer DB connections |
| 4 | Quarantine | Tiny weight, only 1–2 requests in flight |

Recovery uses **AIMD** (additive increase, multiplicative decrease): calm periods add capacity back slowly; re-offending cuts it in half. Minimum dwell time stops the controller from flapping. Every step is stored with evidence, and the dashboard says it in a sentence, for example: *rogue-ml used 71% CPU vs 20% entitlement; acme-shop p99 rose 6.2×.*

### 8. AI predictor (advisory only)

A Python **FastAPI** sidecar forecasts overload about 10 seconds ahead, per tenant and for the host.

- Default model: **Holt** smoothing plus a z-score. No training. Easy to explain.
- Stretch model: **gradient boosting** (LightGBM / sklearn), trained on simulated scenario traces, judged by lead time and false alarms.

A strong forecast can enter Observe or Soft early (`reason=PREDICTED`). The model never blocks the request path. If it is down, the Go detector falls back to its own baseline.

### 9. The dashboard

**Next.js** admin console over REST and a 1 Hz **WebSocket**:

- Heatmap of CPU, memory, DB, queue, and bandwidth versus entitlement
- Live p99 lines and throttle chips
- “Why?” drawer for every automatic action
- Scenario lab with an **A/B** compare: isolation off vs on, same seed
- Tenant portal: usage vs quota, throttle explanation, showback

### 10. Proving it

A Go **load generator** on the second EC2 sends a seeded, open-loop schedule. Same scenario and seed means the same requests, so the A/B is fair.

| Scenario | Attack | With isolation on |
|---|---|---|
| S1 CPU flood | 20 heavy CPU jobs/s | Throttle within ~8s; victims stay near baseline |
| S2 Memory bomb | 4 GB alloc | Only the abuser’s container dies and restarts |
| S3 DB hog | Slow queries holding connections | Neighbors’ DB latency stays bounded |
| S4 Retry storm | Instant retries after 429 | Quarantine; shared queue stays protected |
| S5 Slow ramp | Abuse that creeps up over 60s | Caught by victim impact or the predictor |
| S6 Flash crowd | Legit 10× spike inside quota | **Not** throttled (false-positive check) |
| S7 Two abusers | Two culprits at once | Both handled; Jain’s index stays high |
| S8 Bandwidth flood | Huge payloads | Other tenants’ throughput stays stable |

Toggle `ISOLATION=on|off`. Off is one global FIFO queue, no per-tenant caps, detector idle. Same code otherwise.

## Where it runs (AWS)

About **$10** of a **$100** credit budget. Alarm at $25. Stop the instances after the demo.

| Box | Instance | Why this size |
|---|---|---|
| EC2 #1 `bulkhead-platform` | **c6i.xlarge** (4 vCPU, 8 GB), Ubuntu 24.04, 50 GB gp3 | The whole compose stack. c6i is not burstable, so CPU credits do not distort the demo. |
| EC2 #2 `bulkhead-loadgen` | **t3.medium** | Load only, same VPC and availability zone, so we do not measure our own noise on the platform box. |

EC2, not Fargate or EKS: we need the Docker API and live cgroup updates. Fargate hides cgroups.

Networking:

- Same **VPC**. Security group: 443 and 22 (your IP) on box 1; box 1 port 8080 only from box 2.
- **Elastic IP** on box 1.
- DNS: `A` record `bulkhead` → that Elastic IP (Spaceship, TTL 300). Do not touch the apex domain.
- **Caddy** gets HTTPS from Let’s Encrypt once `bulkhead.udaybhangare.com` points at the box.

One core on the platform host is left for Docker, Postgres, and the OS so the benchmark is not grading our own overhead.

## One-line version

Rate limits count requests. Bulkhead meters **cost**, shares the CPU with **deficit round robin**, enforces hard walls with **cgroups** on **AWS EC2**, and only throttles a tenant when the metrics show it is actually hurting someone else.
