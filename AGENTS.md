# AGENTS.md — Bulkhead project rules (keep token use low)

Project: multi-tenant isolation & noisy-neighbor defense platform. Plan lives in `docs/`; build steps in `prompts/` (run one at a time, see `prompts/README.md`). Full rules: `prompts/_RULES.md`.

## Verification: cheap only
- Run unit tests of the package you touched; nothing wider.
- One short command per check; trim output (`-q`, `| head -20`). Summarize, don't paste logs.
- Don't re-read files after Edit/Write; trust the result.
- Build only the changed module, once, at the end of a task.
- Start only the dependency you need (e.g. `postgres`), not the full compose stack.
- NO screenshots, browser, Playwright/Puppeteer, load tests, benchmarks, A/B runs, or sub-agents for verification — unless the task is prompt 14, 18, 19 or 20, or the user asks.
- If an acceptance check is heavy, run a tiny version and note "full run deferred to prompt 19".

## Beginner user
The user is a newbie. When the human must do something (install, AWS console, SSH, env/secrets, running a command), stop and write **ACTION NEEDED FROM YOU**: why, numbered copy-paste steps (commands prefixed `!` in Claude Code), expected output, how to confirm. Define terms on first use.

## Behaviour
- Start: ≤6-bullet plan. End: ≤10-line summary (built / ran+result / user's next step).
- Follow `docs/`; unavoidable deviations go in `docs/DEVIATIONS.md`. Pick safe defaults instead of asking.
- Stay in the current prompt's scope; never start the next prompt.
- Injected clock, no `time.Now()` in logic; unit tests for core logic; no secrets in git (`.env.example`).
- Be honest about skipped/failed checks.

## Python: always a virtual environment
- Never `pip install` globally or with `--break-system-packages`. Use `uv` (preferred: `uv venv`, `uv add`, `uv run`) or `python -m venv .venv`; keep it in `predictor/.venv` (gitignored).
- Commit `pyproject.toml` + lockfile (`uv.lock` or `requirements.txt`); run tools via `uv run ...` or `.venv/bin/...`.
- If a package lacks wheels for Python 3.14, pin 3.12 (`uv python install 3.12`, `.python-version`), don't fight the build.

## Domain
Production host: subdomain of `udaybhangare.com` (default `bulkhead.udaybhangare.com`). Caddy gets HTTPS automatically once DNS points to the EC2 Elastic IP. Never touch the apex domain or existing records; guide the user through DNS step by step (docs/10, prompt 18).
