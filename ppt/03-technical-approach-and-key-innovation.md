# 3. Technical Approach & Key Innovation

## Architecture (3 Planes)
```
Client → Gateway/Auth → Admission → Scheduler (DRR) → Dispatcher → Tenant Worker (cgroups) → Postgres
                                         ▲                                  │
Metrics (1s) → Detector / Predictor → Throttle Controller ── applies limits ─┘
```
- **Data plane:** hot request path
- **Control plane:** 1 s detect → throttle loop
- **Management plane:** admin API, dashboard, ledger

## Enforcement per Resource
| Resource | Mechanism | Real? |
|---|---|---|
| CPU | cgroup v2 `cpu.max` / `cpu.weight` | Real |
| Memory | `memory.max`, scoped OOM kill | Real |
| PIDs | `pids.max` | Real |
| DB | Pool cap + `statement_timeout` | Real |
| Queue | Per-tenant queues + DRR | Real |
| Network | Bandwidth token bucket | Simulated |

## Detection Logic
1. **Victim?** p99 > 2.5× baseline for 3 windows
2. **Culprit?** excess-over-entitlement × correlation
3. **Act** only if both hold

## Key Innovations
- **Cost-aware fairness** — DRR on cost units, not request counts
- **Harm-based detection** — victim impact + attribution
- **Reservation + burst** — isolation without waste
- **Explainable control** — evidence JSON per action
- **AI as advisor** — forecast only, deterministic ladder stays in control
- **A/B toggle** — `ISOLATION=on|off` on identical seeded load

## Tech Stack
| Layer | Choice |
|---|---|
| Platform | Go (modular monolith) |
| Predictor | Python FastAPI + LightGBM |
| Isolation | Docker + cgroup v2 |
| Data | Postgres 16, Redis 7 |
| Frontend | Next.js, Tailwind, Recharts |
| Edge / Host | Caddy, AWS EC2, docker-compose |

## AI Predictor
- Baseline: Holt smoothing + z-score (explainable, default)
- Challenger: gradient-boosted trees, split by scenario
- Metric: **lead time** before victim degradation
- Fallback: reactive detection if predictor down
