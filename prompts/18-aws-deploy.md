# Prompt 18 — AWS deployment

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** docs/10, docs/14 (R1, R2, R6).

## Goal
Reproducible deployment to two EC2 hosts plus local fallback.

## Build
- `deploy/compose.prod.yml`, Caddyfile, `.env.example`, image build scripts (multi-stage), `deploy/bootstrap.sh` (docker install, cgroup v2 check), `deploy/seed.sh`, `deploy/smoke.sh`, `deploy/loadgen.service` (or compose on box #2).
- Terraform/CloudFormation **optional**; a documented manual runbook is acceptable (`deploy/RUNBOOK.md`: console steps, SG rules, cost alarm).
- Local profile `make demo-local`.

## Domain step (human action — guide in detail)
The user owns `udaybhangare.com`. Use subdomain `bulkhead.udaybhangare.com`. DNS is at **Spaceship** (already confirmed; see docs/10). First have the user confirm the domain uses Spaceship's default nameservers, then give click-by-click steps for the Spaceship dashboard to add an A record to the Elastic IP, how to verify (`dig +short bulkhead.udaybhangare.com`), and what to do while it propagates. Set `SITE_ADDRESS` in `.env` for Caddy.

## Acceptance
- Fresh box → `bootstrap.sh && compose up` → smoke test passes in < 15 min.
- Dashboard reachable over HTTPS; loadgen on box #2 drives S1 across the network.
- Cost alarm configured; shutdown instructions documented.

## Do NOT
Commit keys; open Postgres/Redis/Docker ports publicly.
