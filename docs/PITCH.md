# Bulkhead — Pitch

> **Rate limits count requests. Bulkhead meters cost.**
> Multi-tenant isolation and noisy-neighbor defense: one customer going wild must not hurt everyone else.

---

## 1. The problem

Shared infrastructure is cheap because many customers (tenants) share the same CPU, memory, database and queues.
That sharing is also the risk:

- One tenant runs a heavy job, leaks memory, hogs DB connections or retries in a storm.
- Every other tenant sees timeouts and errors. Their SLA breaks, and *they* churn, not the abuser.
- The provider usually finds out from angry customers, not from a dashboard.

This is the **noisy-neighbor problem**. It hits SaaS platforms, serverless/FaaS, ML inference services, and shared data platforms.

### Why the obvious fix fails
"Just add a rate limit" does not work, because a request is not a unit of cost:

| Attack | Passes a request-rate limit? | Hurts neighbors? | What actually stops it |
|---|---|---|---|
| 10 req/s of 5-second CPU jobs | Yes | Yes (50 core-seconds per second) | CPU cgroup quota + cost bucket |
| 5 req/s allocating 2 GB each | Yes | Yes (host OOM) | Memory cgroup limit, OOM contained to one tenant |
| A few requests holding DB connections | Yes | Yes (pool starvation) | Per-tenant DB connection cap + `statement_timeout` |
| Burst that fills a shared queue | Partly | Yes (head-of-line blocking) | Per-tenant queues + fair scheduler |
| Retry storm after 429s | Re-enters the limit | Yes | Backoff signals + quarantine lane |

### What the problem statement really asks for

| Problem-statement phrase | What it means | Our answer |
|---|---|---|
| "CPU, memory, network or DB" | Four resources, not just request count | cgroups, DB pool caps, bandwidth buckets |
| "Isolation must coexist with efficient utilization" | Static partitions are the wrong answer; idle capacity must be borrowable | Reservation + burst, work-conserving scheduler |
| "Quotas and adaptive policies" | Policies that change at runtime | Closed-loop throttle ladder |
| "Measure tenant-level latency and consumption" | Per-tenant p50/p95/p99, CPU-ms, memory, DB-ms | 1-second metrics windows, HDR percentiles |
| "Demonstrate under abusive workloads" | A scripted, repeatable attack suite | Deterministic scenario library (S1–S8) |
| "Rate limit ≠ isolation" | Need cost-aware and resource-level enforcement | Cost-aware DRR + kernel limits |

---

## 2. Our solution in one paragraph

Bulkhead is a platform layer that sits in front of tenant workloads. Every tenant gets a signed identity, its own
container with kernel-enforced CPU, memory and PID limits, its own queue, its own DB connection budget and its own
policy. A fair, cost-aware scheduler decides who runs next. A detector watches for **harm, not busyness**:
it finds who is hurting and who is causing it, then a throttle ladder gradually squeezes the culprit, explains
why in plain English, and lets it recover when it behaves.

Three principles:

1. **Punish harm, not busyness.** A legitimate 10× flash crowd is not throttled. A tenant is throttled only when a neighbor is hurt *and* that tenant's excess explains it.
2. **Isolation that wastes nothing.** Reserved share is guaranteed; idle capacity is borrowable; burst is clawed back first when contention appears.
3. **Every automated action ships with its evidence.** No black-box throttling.

---

## 3. How it works (technical)

### Architecture

```
 loadgen (Go)  ──HTTPS──▶  Caddy ─▶ bulkheadd (Go modular monolith)
                                     ├─ gateway/auth     API key → short-lived JWT, tenant from claims only
                                     ├─ admission        quota, token bucket, concurrency + queue caps
                                     ├─ scheduler        cost-aware DRR (deficit round robin)
                                     ├─ dispatcher ───▶  per-tenant worker containers (cgroup v2 limits)
                                     ├─ metrics          1 s windows, HDR percentiles
                                     ├─ detector         victim detection + culprit attribution
                                     ├─ throttle         5-level ladder, AIMD recovery
                                     ├─ usage/showback   cost ledger per tenant
                                     └─ admin API + WebSocket
 predictor (FastAPI, Python)   Postgres (policies, ledger, shared contended DB)   Redis (buckets)
 Next.js dashboard + tenant portal
```

Three planes:

- **Data plane (hot path):** gateway → admission → scheduler → dispatcher → worker → DB. Policies are cached in memory; no blocking Postgres call per request.
- **Control plane:** metrics → detector / predictor → throttle, on a 1-second tick. It *applies* weights, rates and cgroup limits.
- **Management plane:** admin REST + WebSocket, scenario runner, usage ledger, tenant portal API.

### Request lifecycle

1. `POST /invoke/{task}` with a JWT. `tenant_id` and `tier` come from the verified token only, never from the body or headers.
2. **Admission:** token bucket (Redis-backed with a local fast path), concurrency cap, queue-depth cap, bandwidth bucket. Rejections return `429`/`503` with `X-Reason` and `Retry-After`.
3. **Cost estimate:** task type + params, refined by an EWMA of observed cost per task per tenant.
4. **Schedule:** per-tenant queue; DRR dispatches by cost credit, so one expensive tenant cannot starve cheap ones.
5. **Execute:** tenant worker runs under cgroup limits; DB access goes through a per-tenant pool with `statement_timeout`.
6. **Account:** actual cost is written to metrics + ledger and fed back to the estimator.

### Resource-by-resource enforcement

| Resource | Mechanism | Real or simulated |
|---|---|---|
| CPU | cgroup v2 `cpu.max` + `cpu.weight`; DRR cost share | **Real** (kernel) |
| Memory | `memory.max`, swap off, OOM kill scoped to the container | **Real** (kernel) |
| PIDs / fork bombs | `pids.max` | **Real** (kernel) |
| Database | Per-tenant pool semaphore, `statement_timeout`, app name | **Real** (real Postgres) |
| Queue / scheduler | Per-tenant queues, DRR, depth cap, quarantine lane | **Real** |
| Network | Per-tenant bandwidth token bucket | **Simulated at app layer** (stated honestly) |

### The detector: two questions, every second

1. **Who is a victim?** A tenant whose p99 exceeds `k × its own baseline` (k = 2.5) for N consecutive windows *while within its own quota*, so self-inflicted overload does not count.
2. **Who is the culprit?** For each other tenant: `excess = max(0, usage_share − entitlement)` per resource, weighted by the Pearson correlation between that tenant's usage and the victim's latency (lag ≤ 2 s).
   The highest score above a threshold is the culprit, and the output includes the evidence.

A flash crowd has high usage but no victim, so it scores zero. A heavy tenant inside its reservation has excess zero.

### The throttle ladder

| Level | Name | Action |
|---|---|---|
| 0 | Normal | none |
| 1 | Observe | flag + log only |
| 2 | Soft | DRR weight ×0.5, rate ×0.7, burst disabled |
| 3 | Hard | `docker update` CPU quota ×0.4 (floored), DB connections reduced |
| 4 | Quarantine | tiny weight, concurrency 1–2, separate lane |

Recovery is **AIMD**: additive increase per calm tick, multiplicative decrease on re-offense, with hysteresis
and cooldown to prevent flapping. Every transition writes an event with evidence, shown in the dashboard as:

> *"rogue-ml throttled to Hard: used 71% CPU vs 20% entitlement; acme-shop p99 rose 6.2× (r = 0.91)."*

### AI layer

A FastAPI predictor sidecar forecasts `p_overload(t+5..15 s)` per tenant. A baseline statistical model ships by default
and a gradient-boosting challenger can be swapped in. A high forecast lets the ladder act *pre-emptively*
(`reason=PREDICTED`). If the predictor is down, the detector falls back to the in-process baseline.

### Security

- API keys hashed; short-lived JWTs; tenant identity from signed claims only.
- Admin API uses a separate credential and role; admin actions are audit-logged.
- Tampered tokens (`alg:none`, forged signature, changed claims) are rejected.
- Worker containers run non-root with read-only rootfs and PID limits.

### Stack

Go (platform, loadgen, worker) · Python/FastAPI (predictor) · Postgres · Redis · Docker + cgroup v2 · Caddy · Next.js dashboard.

---

## 4. Demonstration

Same attack, same seed, isolation toggled **OFF** then **ON** (≈5 minutes live):

| Step | What the audience sees |
|---|---|
| 1. Platform tour | Five tenants, calm heatmap, JWT claims, one container per tenant |
| 2. **Isolation OFF**, S1 CPU flood | Victim p99 goes from milliseconds to seconds; heatmap turns red |
| 3. **Isolation ON**, same seed | Rogue tenant flagged, ladder animates Observe → Soft → Hard, victims stay flat; open the *Why* drawer for evidence |
| 4. S6 flash crowd | A 10× legitimate spike is **not** throttled (false-positive control) |
| 5. S2 memory bomb | Rogue container is OOM-killed and restarted; others untouched (`docker stats` side panel) |
| 6. Prediction + business view | Forecast ahead of degradation; tenant portal shows throttle explanation and showback |
| 7. Close | A/B result table |

If a live run stalls, the dashboard has a **Load recorded results** button.

### Measured results (from `docs/RESULTS.md`, 2026-10-12, single laptop)

| Metric (S1 CPU flood, 5 seeds) | Isolation OFF | Isolation ON |
|---|---|---|
| Victim p99 inflation (median) | ~19,800× (queue grows unbounded; read as "starved") | **0.97×** |
| Victim throughput retained | 0.73 | **0.92** |
| Abuser goodput | 10.8 rps | **0.07 rps** |
| Victim errors | 0 | 0 |

Other checks:

- **Security:** 21/21 checks pass (tenant cannot reach admin routes, forged tokens rejected).
- **Chaos:** 12/12 pass. Killing a worker, stopping Redis, stopping the predictor and saturating Postgres all left healthy tenants served.
- **Memory bomb (S2):** victims error-free, p99 inflation 1.09×. **DB hog (S3):** 1.04×. **Flash crowd (S6):** 0 false positives.
- **Unit tests:** pass for admission, auth, cost, DB pool, detector, dispatcher, scheduler, throttle, usage and the predictor.

### Honest limits (we say these before the judges ask)

- All numbers come from **one laptop** running platform, tenants *and* load generator together; no multi-host run.
- **Detect ≤ 3 s / mitigate ≤ 8 s is not demonstrated.** In S1 the static caps (cgroup, DRR, queue limits) already contain the abuser, so the victim-impact gate never opens and the ladder stayed at L1. We changed the S1 assertion to *containment*; this was a changed assertion, not a fix.
- S4, S5, S7, S8, live ML challenger and isolation-vs-utilization overhead were **not measured**.
- Network isolation is simulated at the application layer.
- This is not a hardened sandbox (no gVisor / Firecracker); see future work.

---

## 5. Business model

> The docs define tiers and a showback ledger; they do not define pricing. What follows is a **proposed** model
> built on those pieces, not something validated with customers.

### Who pays and why

**Customer:** any company that runs other people's code or serves many customers from shared infrastructure:
SaaS platforms, serverless/FaaS providers, ML-inference and data platforms, internal platform teams.
**Pain:** noisy-neighbor outages cost them SLA credits and churn, and the only alternative is over-provisioning
dedicated capacity per customer, which is expensive.
**Value:** pack more tenants per node safely, and prove to each customer exactly why they were or were not throttled.

### Revenue streams

| Stream | How it works | Why it is defensible |
|---|---|---|
| **1. Platform subscription** (core) | Per-cluster or per-node monthly fee for the control plane (scheduler, detector, ladder, dashboard) | Recurring; value scales with how many tenants a customer packs onto a node |
| **2. Metered usage / showback** | Per-tenant cost units → billing-grade usage data; fee per metered tenant or per million cost units | Customers can re-bill *their* customers; turns a cost center into a revenue feature |
| **3. Tier-based SLO add-ons** | Free / Pro / Enterprise reservations with SLO and error-budget reporting; priced uplift for guaranteed share and dedicated lanes | Maps directly to the existing tier + reservation model |
| **4. Predictive module** | Paid add-on: ML overload forecasting and pre-emptive throttling | Differentiator on top of the open baseline |
| **5. Enterprise / support** | Self-hosted license, SSO, audit export, SLA-backed support | Standard for infrastructure software |

### Billing mechanics (hybrid, illustrative)

Billed to the **server owner** who hosts the container clients: a per-node monthly fee, a monthly **credit** allowance per node
(1 credit = 1 metered cost unit from the usage ledger), and prepaid top-up packs beyond it. Credits running out raises
alerts; clients are never cut off.

| Plan | Price | Included credits | Top-up |
|---|---|---|---|
| Community | Free (1 node, 5 clients) | 100k / month | not sold |
| Team | ₹500 / node / month | 5M / node / month | ₹30 per 1M |
| Enterprise | from ₹3,000 / node / month | 25M / node / month | ₹25 per 1M |

Landing page: `dashboard/src/components/landing/story/Pricing.tsx`; math in `dashboard/src/lib/pricing.ts`.

### Packaging

| Plan | For | Includes |
|---|---|---|
| **Community** | Evaluation, small teams | Core isolation, ladder, dashboard; limited tenants; community support |
| **Team** | Growing SaaS | Unlimited tenants per node, showback, tenant portal, baseline predictor |
| **Enterprise** | Regulated / large platforms | ML predictor, audit export, SSO, stronger sandboxing (gVisor/Firecracker), SLA support |

### Why the economics work

- Customers already pay for the problem twice: over-provisioning and SLA credits. We replace both with higher utilization.
- Pricing is anchored to **tenants protected and nodes managed**, which grows with the customer's own growth.
- Low integration cost: a modular Go binary with documented interfaces (`Scheduler`, `Admitter`, `Detector`, `Throttler`) and a mapping to Kubernetes primitives, so it can run beside existing infra instead of replacing it.

### Go-to-market (suggested)

1. **Wedge:** platform and SRE teams at multi-tenant SaaS and serverless companies who already feel noisy-neighbor incidents.
2. **Proof:** the A/B demo run on the customer's own traffic replay ("same attack, two runs").
3. **Expand:** from one cluster to fleet-wide, then upsell predictive and enterprise sandboxing.

### What we still need to validate

- Real willingness to pay and price points (needs customer interviews).
- Utilization gain from isolation (not yet measured; this is the core ROI number).
- Multi-host behavior, since buyers run fleets, not laptops.

---

## 6. Roadmap

| Horizon | Work |
|---|---|
| **Next** | Make the ladder act on S1 (escalate on culprit excess when victims are already protected); run S4/S5/S7/S8; measure utilization ON vs OFF; separate load-gen host; exercise `statement_timeout` under a slow-query storm |
| **Production mapping** | Pod + namespace per tenant, `ResourceQuota`/`LimitRange`, DRR → Kueue / API Priority & Fairness, `docker update` → in-place pod resize, bandwidth → Cilium / CNI |
| **Stronger isolation** | gVisor / Kata / Firecracker for untrusted code, `io.max` for disk, eBPF accounting, real `tc` egress shaping |
| **Scale-out** | Shard tenants across hosts, global buckets on Redis cluster, placement controller moving noisy tenants to penalty nodes |
| **Smarter control** | Learned controller (bandit/RL) with the ladder as safe fallback; PSI-based cost calibration |
| **Business** | Invoices, budgets and alerts, SLO per tier with error budgets, self-service quota requests |

---

## 7. One-liners

- *"Rate limits count requests; we meter cost."*
- *"We punish harm, not busyness."*
- *"Every automated action ships with its evidence."*
- *"Isolation that wastes nothing: reserved plus burstable."*
