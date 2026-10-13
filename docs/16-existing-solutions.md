# 16 — Existing Solutions (and where Bulkhead fits)

Problem statement (PS 3): a multi-tenant service that enforces **quotas and adaptive resource policies**, measures
**per-tenant latency and consumption**, and is demonstrated under **abusive workloads**. A plain API rate limit is
explicitly *not* accepted as isolation.

This doc surveys what already exists, what each one solves, what it leaves open, and how our prototype
(`docs/02`, `05`, `06`, `07`) relates. Claims about third-party tools are from general knowledge of their public
docs; verify versions/details before quoting in a pitch.

## 1. The problem split into layers
| Layer | Question | Typical existing answer |
|---|---|---|
| L1 Identity | Who is this request? | API keys, JWT/OIDC, mTLS |
| L2 Admission | Should it be let in now? | Rate limits, concurrency caps, quotas |
| L3 Scheduling | In what order / share is it served? | Fair queuing, priority classes, weighted shares |
| L4 Enforcement | Can it exceed its share of CPU/mem/IO? | cgroups, VMs, sandboxes, DB pool limits |
| L5 Detection | Who is hurting whom, right now? | Dashboards + alerts + a human |
| L6 Adaptation | Reduce the culprit automatically | Autoscaling, manual runbooks, some throttle rules |
| L7 Showback | Who used what, what does it cost? | Cost tools, metering pipelines |

Most existing tools cover one or two layers well. The PS asks for L1–L7 working together.

## 2. Existing solutions by category

### 2.1 API gateways / rate limiters (L1, L2)
| Tool | What it does | Gap vs. PS |
|---|---|---|
| Kong, Tyk, AWS API Gateway, Apigee | Per-key rate limits, quotas, usage plans, auth | Counts **requests**, not cost. 10 req/s of 5 s CPU jobs passes. No view of CPU/mem/DB. |
| Envoy / Istio local & global rate limit | Token-bucket per descriptor (tenant header) | Same: request-shaped. Needs external ratelimit service for global limits. |
| NGINX `limit_req` / `limit_conn`, Caddy rate-limit plugin | Simple per-IP/key limits | No tenant semantics, no feedback from victim latency. |
| Redis + Lua token bucket (DIY) | Atomic distributed buckets | A building block (we use it), not isolation. |

### 2.2 Kernel and container isolation (L4)
| Tool | What it does | Gap vs. PS |
|---|---|---|
| Linux cgroups v2 (`cpu.max`, `memory.max`, `pids.max`, `io.max`) | Hard kernel limits per group | Static unless something adjusts them; knows nothing about tenants or victims. |
| Docker / containerd resource flags | cgroup wrapper, live `docker update` | Same; no policy, no detection. |
| Kubernetes ResourceQuota, LimitRange, QoS classes, PriorityClass | Namespace quotas, requests/limits, eviction order | Admission-time and scheduling-time; reacts slowly to runtime interference; CPU limits cause throttling, not fairness. Heavy for a 24 h prototype. |
| Kubernetes Vertical/Horizontal Pod Autoscaler | Scale by utilization | Optimizes capacity, not fairness; a noisy tenant just triggers more spend. |
| Firecracker, gVisor, Kata Containers | Strong sandboxing (microVM / user-space kernel) | Security isolation, not resource-fairness policy. Cost and setup too high for 24 h. |
| Linux `tc`, eBPF (Cilium bandwidth manager) | Per-pod bandwidth shaping | Real network limits; we only simulate at app layer. |

### 2.3 Fair scheduling research and primitives (L3)
| Technique | Idea | Gap vs. PS |
|---|---|---|
| Weighted fair queuing / DRR (Deficit Round Robin) | Per-flow queues served by weight | Algorithms, not a product; we implement a cost-aware DRR. |
| Dominant Resource Fairness (Mesos, YARN, K8s schedulers) | Fair multi-resource shares | Batch cluster scheduling; not request-level, not adaptive to victims. |
| Hadoop YARN / Spark fair scheduler, Slurm fair-share | Queue-level quotas | Batch workloads, minutes-scale, no latency SLO feedback. |
| Google Borg / Omega papers, Linux CFS bandwidth | Prod/non-prod priority, quotas | Design inspiration; not reusable software. |

### 2.4 Database-level multi-tenancy (L4)
| Tool | What it does | Gap vs. PS |
|---|---|---|
| Postgres roles + `statement_timeout`, `CONNECTION LIMIT` | Per-role connection and time caps | Manual config per tenant; no cross-layer view. |
| PgBouncer / Pgpool pool-per-user | Pool partitioning | Pool only; no CPU/mem/queue coordination. |
| Postgres Row-Level Security | **Data** isolation | Orthogonal: confidentiality, not performance. |
| Vitess, CockroachDB, Aurora Limitless | Sharded/serverless multi-tenant DB | Infra-level; per-tenant fairness largely vendor-managed. |

### 2.5 Observability and anomaly detection (L5)
| Tool | What it does | Gap vs. PS |
|---|---|---|
| Prometheus + Grafana, Datadog, New Relic | Per-label metrics, dashboards, alert rules | Shows *that* p99 rose; attribution to a culprit and automatic action are manual. |
| Datadog Watchdog, AWS DevOps Guru, Dynatrace Davis | ML anomaly/root-cause hints | Black-box SaaS; not tied to an enforcement loop you control. |
| OpenTelemetry tracing | Per-request tenant attribute | Data source, not a decision engine. |

### 2.6 Managed SaaS multi-tenant patterns (L1–L4, productized)
| Product | Mechanism | Gap vs. PS |
|---|---|---|
| AWS Lambda reserved/provisioned concurrency, per-account throttles | Per-function concurrency caps | Cloud-vendor internal; opaque, per-function not per-tenant-with-detector. |
| Cloudflare Workers, Fly.io, Heroku dynos | Per-app isolates/containers | Isolation by deployment unit; no adaptive cross-tenant policy exposed. |
| AWS SaaS Factory / "tenant throttling" guidance, Azure Noisy Neighbor pattern docs | Reference architectures | Guidance, not runnable software. |
| Snowflake warehouses, BigQuery slots/reservations | Compute reservations per workload | Pay-for-isolation; static reservations, no automatic culprit detection. |

### 2.7 Chaos / load tools (for the "abusive workload" demo)
| Tool | Use | Gap |
|---|---|---|
| k6, wrk, Locust, Vegeta | Generate load | Single-scenario; no seeded multi-tenant scenario library with assertions. |
| Chaos Mesh, Litmus, Gremlin | Fault injection | Infra faults, not tenant-abuse patterns. |

## 3. Summary matrix
`●` strong, `◐` partial, `○` absent.

| Capability | Gateways | K8s quotas | cgroups/Docker | Observability | Cloud-managed | **Bulkhead** |
|---|---|---|---|---|---|---|
| Tenant identity (L1) | ● | ◐ (namespace) | ○ | ◐ | ● | ● API key → JWT |
| Request rate limit (L2) | ● | ○ | ○ | ○ | ● | ● token bucket (Redis) |
| Cost-aware admission (L2) | ○ | ○ | ○ | ○ | ◐ | ● EWMA cost units |
| Per-tenant fair scheduling (L3) | ○ | ◐ | ○ | ○ | ◐ | ● cost-aware DRR |
| Hard CPU/mem/PID limits (L4) | ○ | ● | ● | ○ | ● | ● cgroup v2 per tenant |
| DB connection/time caps (L4) | ○ | ○ | ○ | ○ | ◐ | ● pool semaphore + timeout |
| Network bandwidth limit (L4) | ◐ | ◐ | ◐ (`tc`) | ○ | ● | ◐ app-layer, simulated |
| Per-tenant latency/usage metrics (L5) | ◐ | ○ | ○ | ● | ◐ | ● 1 s HDR windows |
| Victim→culprit attribution (L5) | ○ | ○ | ○ | ◐ (manual) | ○ | ● excess × correlation + evidence |
| Automatic adaptive throttle (L6) | ○ | ○ | ○ | ○ | ◐ | ● 4-level ladder, AIMD recovery |
| Overload prediction (L6) | ○ | ◐ (HPA) | ○ | ◐ | ◐ | ● Holt baseline + GBM challenger |
| Showback / billing view (L7) | ◐ | ◐ | ○ | ◐ | ● | ● usage ledger + dashboard |
| Isolation ON/OFF A/B demo | ○ | ○ | ○ | ○ | ○ | ● same code path |

## 4. What is genuinely new in our approach
1. **Closed loop in one system.** Identity → admission → scheduling → enforcement → detection → throttle → showback
   share one tenant model, so a decision in the detector changes cgroup limits and DRR weights within seconds.
2. **Harm-based, not usage-based, punishment.** A tenant is throttled only when it is (a) above entitlement and
   (b) correlated with a victim's latency inflation; a legit flash crowd with no victims is left alone (`docs/06`).
3. **Evidence with every action.** Each throttle carries resources, shares, correlation and victim list, which is
   what operators and judges can audit; most off-the-shelf anomaly tools do not expose this.
4. **Predictive lead time.** A forecaster raises the throttle ladder before p99 breaks; baseline is explainable,
   ML is a feature-flagged challenger compared on lead time, not just accuracy.
5. **Honest A/B.** `ISOLATION=on|off` runs the same binary, so improvement is measurable rather than asserted.

## 5. What existing solutions do better (be honest)
- **Kubernetes/cloud schedulers** handle multi-node placement, bin-packing and autoscaling; we are single-host
  and docker-compose.
- **Firecracker/gVisor** give far stronger *security* isolation than containers; we do not claim that.
- **Mature gateways** have richer auth, plugins, and global rate limiting at scale.
- **Commercial observability** has years of anomaly-detection tuning and alert routing.
- **Network isolation** is only simulated at the app layer here; `tc`/eBPF is the real answer (future work, `docs/15`).
- **Evidence strength:** our results in `docs/RESULTS.md` come from one laptop, mostly single runs per scenario, with
  several scenarios (S4, S5, S7, S8) not executed; do not present them as benchmarks.

## 6. One-paragraph positioning (for pitch/FAQ)
> Gateways limit *requests*; Kubernetes quotas limit *allocations*; dashboards show *symptoms*. None of them closes
> the loop from "tenant B's p99 doubled" to "tenant A caused it, here is the evidence, its CPU quota is now 0.4×,
> and it recovers automatically." Bulkhead composes proven primitives (token buckets, DRR, cgroups, DB caps) with a
> victim-attribution detector and a predictor, and proves the effect with an isolation ON/OFF A/B under seeded
> abusive scenarios.

## 7. Sources to cite (verify before use)
- Kubernetes docs: Resource Quotas, Limit Ranges, Pod QoS classes, Pod Priority.
- Linux kernel docs: cgroup v2 (`cpu.max`, `memory.max`, `pids.max`).
- Shreedhar & Varghese, "Efficient Fair Queuing using Deficit Round Robin" (1996).
- Ghodsi et al., "Dominant Resource Fairness" (NSDI 2011).
- Microsoft Azure Architecture Center: "Noisy Neighbor antipattern".
- AWS Well-Architected SaaS Lens: tenant isolation and throttling.
- Envoy docs: local/global rate limiting.
- Gil Tene, "How NOT to Measure Latency" (coordinated omission; why our loadgen is open-loop).
