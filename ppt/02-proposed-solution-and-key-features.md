# 2. Proposed Solution & Key Features

## Solution: **Bulkhead**
- Multi-tenant isolation + noisy-neighbor defense platform
- **Closed loop:** Measure → Detect → Throttle → Recover
- Isolation at **resource level**, not just request level

## One-Line Pitch
> "Rate limits count requests; we meter *cost*. We punish harm, not busyness."

## Key Features
| Feature | What it does |
|---|---|
| Tenant identity | API key → short-lived JWT, tenant from claims only |
| Cost-aware admission | Token buckets, concurrency + queue caps |
| Fair scheduler | Cost-aware DRR, per-tenant queues |
| Hard isolation | Per-tenant containers with cgroup CPU / mem / PIDs limits |
| DB protection | Per-tenant connection cap + statement timeout |
| Noisy-neighbor detector | Victim impact + culprit attribution |
| Adaptive throttle | 5-level ladder, AIMD recovery |
| AI predictor | Forecasts overload 5–15 s ahead |
| Explainability | Every action shipped with evidence |
| Dashboard + portal | Live heatmap, "Why" drawer, showback |

## Throttle Ladder
`Normal → Observe → Soft → Hard → Quarantine`

## Guarantees
- Containment — hard limit per tenant
- Minimum share under contention
- Work-conserving — idle capacity is borrowable
- Blast radius = one container
- Harm detected & mitigated in ~5–10 s

## Differentiators
- Not punished: legit flash crowds (0 false positives)
- Abuser recovers when it behaves
- A/B proof: Isolation OFF vs ON, same seed
