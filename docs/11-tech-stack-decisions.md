# 11 — Tech Stack Decisions (with rejected alternatives)

| Concern | Chosen | Why | Rejected |
|---|---|---|---|
| Platform language | **Go** | goroutines/channels fit schedulers; Docker SDK is Go; single static binary; low-latency GC | Python (hot-path perf), Node (container control weak), Rust (too slow to build in 24h) |
| AI sidecar | **Python FastAPI + sklearn/LightGBM** | ML ecosystem; isolated process | Go ML libs (immature) |
| Isolation unit | **Docker containers + cgroup v2** | real kernel enforcement, live `update` | processes+manual cgroups (more setup), Firecracker/gVisor (not 24h) |
| Shared DB | **Postgres 16** | real contention, LISTEN/NOTIFY for policy push | SQLite (no contention), MySQL |
| Counters | **Redis 7 + Lua** | atomic distributed token buckets | in-proc only (not distributed story) |
| Frontend | **Next.js + TS + Tailwind + shadcn/ui + Recharts** | fast polished UI, typed | Grafana (generic), Vite SPA (fine, but less structure) |
| Realtime | **WebSocket** (native) | 1 Hz snapshots + events | SSE (OK alt), polling |
| Proxy/TLS | **Caddy** | auto-HTTPS, one file | Nginx+certbot |
| Orchestration | **docker-compose** | 24h reality | K8s |
| Auth | **API key → HS256/EdDSA JWT** | simple, demonstrable claims | mTLS (setup cost), OAuth server |
| Percentiles | **HDR histogram** | accurate tails, low memory | naive sorting |
| Load gen | **custom Go open-loop** | seeded determinism, avoids coordinated omission | k6/wrk (no seeded multi-tenant scenarios) |
| Hosting | **AWS EC2 ×2** | privileged Docker, credits available | Fargate, Lambda |

## Library candidates (verify versions at build time)
Go: `chi`, `pgx`, `go-redis`, `docker/docker client`, `golang-jwt`, `HdrHistogram-go`, `gorilla/websocket` or `coder/websocket`, `zerolog`. Python: `fastapi`, `uvicorn`, `numpy`, `scikit-learn`/`lightgbm`, `pydantic`. JS: `next`, `recharts`, `shadcn`, `zustand`, `swr`.

## Repo layout
```
contracts/  platform/(cmd,internal/...)  worker/  predictor/  loadgen/  dashboard/  deploy/  docs/  prompts/
```
