# 15 — Future Work & Production Mapping

## How this maps to Kubernetes
| Bulkhead | Kubernetes |
|---|---|
| tenant worker container + cgroup | Pod with `requests/limits`, namespace per tenant |
| policies table | `ResourceQuota`, `LimitRange`, `PriorityClass` |
| DRR scheduler | Kueue / custom scheduler / API Priority & Fairness (APF) |
| throttle `docker update` | in-place pod resize (VPA in-place), CPU shares |
| bandwidth bucket | CNI bandwidth plugin / Cilium bandwidth manager |

## Stronger isolation
gVisor/Kata/Firecracker for untrusted code; dedicated nodes for enterprise; eBPF for per-tenant syscall/network accounting; `tc`/`fq` qdisc for real egress shaping; `io.max` for disk I/O; CPU pinning/NUMA.

## Distribution
Shard tenants across hosts via consistent hashing; global token buckets via Redis cluster; placement controller moving noisy tenants to "penalty" nodes; multi-region quotas.

## Control improvements
Learned controller (bandit/RL) with the ladder as safe fallback; per-tenant adaptive baselines; cost model calibration from hardware counters (PSI: `/proc/pressure`).

## Business
Real metering → invoices, budgets/alerts, SLO per tier with error-budget accounting, self-service quota requests.
