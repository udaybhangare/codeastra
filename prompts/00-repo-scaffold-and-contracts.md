# Prompt 00 — Repo scaffold & contracts

> **First read `prompts/_RULES.md`** — token-light verification (no screenshots/Playwright/full builds each step) and beginner-friendly guidance for any step the human must do.

**Read first:** README.md, docs/02, 04, 11, 12.

## Goal
Create the monorepo skeleton and freeze the cross-team contracts so all tracks can work in parallel.

## Build
1. Directories: `contracts/ platform/ worker/ predictor/ loadgen/ dashboard/ deploy/`.
2. Go workspace (`go.work`) with modules `platform`, `worker`, `loadgen`; Python project for `predictor` (pyproject); `dashboard` via Next.js create-app (TS, Tailwind, shadcn init).
3. `contracts/openapi.yaml` for tenant + admin API from doc 04; `contracts/ws-messages.schema.json`; `contracts/scenario.schema.json` (doc 09); `contracts/predict.schema.json` (doc 07).
4. `deploy/compose.dev.yml` with postgres, redis, placeholders for others; `.env.example`; `Makefile` (`make dev`, `make test`, `make lint`).
5. A **mock stream server** (tiny script) emitting realistic `snapshot`/`event` WS messages so the dashboard can be built without the backend.
6. CI-less: just `make test` runs all unit tests.

## Acceptance
- `make dev` starts postgres+redis; `go build ./...` and `npm run build` succeed.
- Contracts validate (use a schema linter) and mock stream connects.

## Do NOT
Implement business logic. Don't pick libraries beyond doc 11.
