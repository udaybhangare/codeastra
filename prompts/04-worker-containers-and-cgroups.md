# Prompt 04 — Tenant worker containers & cgroup control

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/03 §3.4, docs/05, docs/14 R1/R7.

## Goal
Per-tenant worker image + lifecycle manager with live cgroup adjustment.

## Build
- `worker/`: Go HTTP server. `POST /run {task, params}` for `echo, cpu-burn(ms), mem-alloc(mb, hold_ms), io-heavy(kb), db-query(kind)` — db-query calls back to platform DB proxy endpoint (stub until prompt 06). Reports `cpu_ms` (process CPU time), peak mem. Non-root, tiny image (distroless/alpine).
- `internal/workerpool`: Docker SDK — create/start per-tenant container from policy (`cpus`, `memory`, `memory-swap`, `pids-limit`, read-only rootfs, drop caps, dedicated network), health check, restart on exit, OOM detection from events, `Update(tenant, cpus, mem)` live.
- `Isolation OFF` → containers created without limits.
- **Spike script first** (`deploy/spikes/cgroup_check.sh`): verify cgroup v2 and that `docker update --cpus` takes effect live under `cpu-burn`; document result in docs/DEVIATIONS.md if not.

## Acceptance
- Integration test: cpu-burn in a 0.5-cpu container measures ≈0.5 core; mem-alloc beyond limit → container OOM-killed, restarted, other tenant's container untouched; `Update` halves CPU live.

## Do NOT
Mount docker socket into tenant workers; run privileged workers.
