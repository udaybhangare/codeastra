# Bulkhead — Multi-Tenant Isolation & Noisy-Neighbor Defense Platform

> Hackathon track: Cloud Computing & Distributed Systems, Problem #3.
> Status: feature-complete prototype; verified on a single laptop (see Results and Limitations below).

## One-line pitch
A tiny "mini-Lambda" platform where tenants share one host, but a deliberately abusive tenant **cannot** hurt the others — enforced by real cgroup isolation, a fair scheduler, and a closed-loop detector/throttle that explains every decision. Proven live with an **Isolation OFF vs ON** A/B replay of the same workload.

## Reading order (for teammates and judges)
1. `docs/00-problem-analysis.md` — what the PS really asks
2. `docs/02-architecture-hld.md` — the big picture
3. `docs/05-isolation-model.md` — *why this is more than a rate limiter*
4. `docs/13-demo-script-and-pitch.md` — what judges will see
5. `docs/01-judge-faq.md` — every hard question, answered
6. Rest of `docs/` for depth, then `prompts/` to build.

## Layout
- `docs/` — planning & specs (00–15)
- `prompts/` — numbered prompts, executed in order; see `prompts/README.md`
- `contracts/` (frozen API + schemas), `platform/`, `worker/`, `predictor/`, `loadgen/`, `dashboard/`, `deploy/` — scaffolded (prompt 00). Commands: `make dev | test | lint | mock`.

## Locked tech stack
Go (platform, worker, loadgen) · Python FastAPI (predictor) · Postgres · Redis · Docker/cgroups v2 · Next.js + TS + Tailwind + shadcn + Recharts · Caddy · AWS EC2 ×2 · docker-compose.

## Quickstart (local, ~5–10 min first time)
Needs Docker (cgroup v2), Go 1.22+, Python 3 and `uv`.
```bash
make demo        # builds images, starts the stack, seeds tenants, warms workers (idempotent)
make test        # unit tests (Go + predictor)
python3 demo/recorded/load.py   # recorded A/B results, no stack or network needed
```
Dashboard: `https://localhost:8443` (self-signed cert; accept the warning). Run order for a demo: S1 OFF → S1 ON → S6 → S2 (`docs/13`, `docs/slides.md`). Full verification: `make verify-all` (~35 min). AWS deployment: `deploy/RUNBOOK.md`.

## Architecture
Control/data/management planes, request lifecycle and failure behaviour are in `docs/02-architecture-hld.md` (ASCII diagram at the top). Image export is not generated; the ASCII diagram is the source of truth.

## Results (S1 CPU flood, 5 seeds, one laptop, loadgen co-located; details and caveats in `docs/RESULTS.md`)
| Metric (victims) | Isolation OFF | Isolation ON |
|---|---|---|
| p99 inflation vs warm-up (median) | ≈ 19,800× (queue grows for the whole attack) | **0.97×** |
| Throughput ratio | 0.73 | 0.92 |
| Abuser goodput (rps) | 10.8 | 0.07 |
| S6 flash crowd false positives | – | 0 (one seed) |
| Security checks / chaos checks | 21/21 · 12/12 pass | |

## Limitations (honest list)
- Single host; loadgen shares the machine, no EC2/HTTPS run yet.
- Detect ≤ 3 s / mitigate ≤ 8 s is **not demonstrated**: static caps contain the abuser before the ladder escalates (RESULTS §3, §4b).
- Not run: S4, S5, S7, S8; utilization ON vs OFF unmeasured; Jain's index does not discriminate modes.
- Bandwidth isolation is app-layer; ML trained on simulated traces; container escape out of scope (docs/05, docs/15).
- The dashboard ships in mock mode in production (admin sign-in gap, `docs/DEVIATIONS.md`).
