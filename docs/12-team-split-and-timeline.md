# 12 — Team Split & 24h Timeline

## Tracks (4 people; with 3, merge C into A/B and D handles UI+demo)
| Track | Owner | Scope | Prompts |
|---|---|---|---|
| **A — Data plane** | Dev 1 | gateway/auth, admission, scheduler, dispatcher, workers, DB pool | 01–06 |
| **B — Control plane** | Dev 2 | metrics, usage, detector, throttle, admin API/WS | 07–10, 13 |
| **C — AI + Sim** | Dev 3 | predictor, loadgen, scenarios, A/B harness, data gen | 11–12, 14 |
| **D — Web + Demo** | Dev 4 | dashboard, tenant portal, deploy, pitch | 15–18, 20 |

Integration point: `contracts/` frozen at **hour 2**. Nobody changes it without a message in the team channel.

## Hour plan
| Hours | Milestone |
|---|---|
| 0–2 | Scaffold, contracts, compose skeleton, DB schema, mock WS stream so D can start |
| 2–6 | A: invoke path e2e with workers; B: metrics windows; C: loadgen v1 + S1; D: dashboard shell with mock data |
| 6–10 | A: DRR + admission; B: detector v1; C: baseline predictor; D: live heatmap + latency charts |
| 10–14 | B: ladder + cgroup updates; A: DB contention; C: S1–S6 scenarios; D: decision drawer, scenario lab |
| 14–18 | **Integration freeze**: OFF/ON A/B working e2e; tenant portal; deploy to AWS |
| 18–21 | ML challenger (if on track), polish, tests/chaos (prompt 19) |
| 21–23 | Demo rehearsals ×3, video recording, FAQ review |
| 23–24 | Buffer. No new features after hour 21. |

## MVP vs stretch
**MVP (must):** invoke path, per-tenant cgroups, DRR, admission, metrics, detector, ladder, dashboard overview + scenario lab + A/B, S1/S2/S6, AWS deploy.
**Should:** S3/S4/S5, decision drawer, baseline predictor, tenant portal, showback.
**Stretch:** ML challenger, S7/S8, predictive throttle, `tc` shaping, policy editor.

## Rules
Daily-style 15-min sync at hours 6, 12, 18. Cut scope rather than slip integration freeze.
