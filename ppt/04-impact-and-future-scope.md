# 4. Impact & Future Scope

## Impact
- **Victims stay flat** under attack (p99 ≤ 1.5× baseline)
- **Time to detect** ≤ ~3 s, **mitigate** ≤ ~8 s
- **Blast radius** limited to the offending tenant
- **Capacity not wasted** — utilization reported ON vs OFF
- **Fair by metric** — Jain's index ≥ 0.8 under multi-abuser

## Who Benefits
| Stakeholder | Gain |
|---|---|
| Tenants | Predictable latency, SLA safety |
| Operators | Auto-mitigation, fewer pages |
| Business | Lower churn, usage showback |
| Security | Abuse / DoS containment |

## Future Scope
### Stronger Isolation
- gVisor / Kata / Firecracker for untrusted code
- eBPF accounting, `tc` egress shaping, `io.max` for disk

### Scale Out
- Multi-host sharding, Redis cluster buckets
- Placement controller → "penalty" nodes
- Kubernetes mapping (ResourceQuota, Kueue, APF)

### Smarter Control
- RL / bandit controller with ladder as safe fallback
- Per-tenant adaptive baselines
- PSI (`/proc/pressure`) cost calibration

### Business
- Real metering → invoices, budgets, alerts
- Per-tier SLOs, error-budget accounting
- Self-service quota requests
