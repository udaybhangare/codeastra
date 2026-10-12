# Bulkhead — Multi-Tenant Isolation & Noisy-Neighbor Defense Platform

> Hackathon track: Cloud Computing & Distributed Systems, Problem #3.
> Status: scaffold + contracts done (prompt 00); business logic starts at prompt 01.

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
