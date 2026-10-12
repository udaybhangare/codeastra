# Rules for every prompt (read before starting any prompt)

## A. Keep verification cheap (token budget rules)
The goal is working code with minimal back-and-forth, not exhaustive proof after every step.

**DO**
- Run only the **unit tests of the package(s) you just touched** (e.g. `go test ./internal/scheduler/...`, `pytest predictor/tests/test_baseline.py`).
- Use `go vet` / `tsc --noEmit` on the touched module only if tests pass and you changed types or interfaces.
- Check behaviour with **one short command** (a `curl`, a `go test -run`, a `psql -c`) and print only the lines you need (`| head -20`, `-q`, `--tail`).
- Trust Edit/Write results; do not re-read a file just to confirm an edit succeeded.
- Fix failures from the error message first; don't re-run the whole suite after each tiny fix.

**DO NOT** (unless the prompt is 18, 19 or 20, or the user explicitly asks)
- Take screenshots, open a browser, or use Playwright/Puppeteer/Chrome automation.
- Run a full `build` of every module (`go build ./...`, `npm run build`, `docker compose build`) after each prompt. Build only the module you changed, and only once at the end of the prompt.
- Start the whole docker-compose stack just to "see if it works". Start only the dependency you need (e.g. just `postgres`).
- Run load tests, benchmarks, or scenario A/B runs outside prompts 14, 19 and 20.
- Paste large logs, full test output, or whole files into the conversation. Summarize in ≤ 10 lines.
- Spawn sub-agents for verification.

**Frontend prompts (15–17):** verify with `tsc --noEmit` + lint on touched files and the mock stream's JSON shape. Visual polish is checked by the human, not by screenshots.

## B. Guide a beginner in detail
The user is a newbie. Whenever something must be done **by the human** (outside the code you can write or run), STOP and give a numbered, copy-paste-ready guide:
1. Say clearly at the top: **"ACTION NEEDED FROM YOU"**.
2. Explain *why* it's needed in one sentence.
3. Give exact steps: where to click / which command to run (prefix commands the user must run themselves with `!` in Claude Code), what output to expect, and what to paste back if it fails.
4. Never assume prior knowledge of Docker, AWS, Postgres, Go, Python, Node, SSH, DNS, etc. Define a term the first time you use it.
5. After the human step, tell them exactly how to confirm it worked.

Typical human steps: installing Docker/Go/Node/Python, starting Docker, creating the AWS account resources (EC2, security groups, key pair, Elastic IP, budget alarm), SSH into a server, setting environment variables or `.env` secrets, buying/pointing a domain, running a long demo.

## C. Behaviour
- At the start of a prompt: one short plan (≤ 6 bullets). At the end: a ≤ 10-line summary — what was built, what was run and its result, what the user must do next.
- If a decision isn't covered by `docs/`, pick the simplest option, note it in `docs/DEVIATIONS.md`, and continue; don't stall on questions that have a safe default.
- Be honest: if a check was skipped or failed, say so.
- Stay in scope of this prompt. Do not start the next prompt.

## D. If a prompt's acceptance check conflicts with section A
Section A wins. Where a prompt asks for a benchmark, load test, or multi-container end-to-end run, do a **small version** (a few seconds, a handful of requests) and note "full version deferred to prompt 19". Never skip the unit tests of the code you wrote.

## E. Python and domain
- Python work always happens in a virtual environment (`uv` preferred, else `python -m venv`), located at `predictor/.venv`; never install packages globally. Commit `pyproject.toml` and the lockfile.
- Deployment domain: use a subdomain of `udaybhangare.com` (default `bulkhead.udaybhangare.com`); never modify the apex or existing DNS records. Guide the user through the DNS record step by step (prompt 18).
