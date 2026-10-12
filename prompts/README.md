# Prompts — execution order

Run one at a time, in a fresh Claude Code session (or same session), from the repo root. Each prompt is self-contained: it tells the model which docs to read first, what to build, acceptance checks, and what NOT to do.

**Always begin each session with:** "Read README.md, prompts/_RULES.md, docs/02-architecture-hld.md, and the docs listed in the prompt. Then execute the prompt."

| # | File | Track | Depends on |
|---|---|---|---|
| 00 | 00-repo-scaffold-and-contracts | all | — |
| 01 | 01-db-schema-and-policies | A | 00 |
| 02 | 02-auth-identity-gateway | A | 01 |
| 03 | 03-admission-and-ratelimit | A | 02 |
| 04 | 04-worker-containers-and-cgroups | A | 00 |
| 05 | 05-scheduler-drr | A | 03,04 |
| 06 | 06-db-pool-and-contention | A | 05 |
| 07 | 07-metrics-pipeline | B | 05 |
| 08 | 08-usage-and-showback | B | 07 |
| 09 | 09-detector-victim-impact | B | 07 |
| 10 | 10-throttle-ladder | B | 09,04 |
| 11 | 11-ai-baseline-sidecar | C | 07 |
| 12 | 12-ai-ml-challenger (stretch) | C | 11,14 |
| 13 | 13-admin-api-and-websocket | B | 07,10 |
| 14 | 14-loadgen-and-scenarios | C | 02 |
| 15 | 15-dashboard-shell-and-live-views | D | 00 (mock), 13 |
| 16 | 16-decision-log-and-ab-compare-ui | D | 13,14 |
| 17 | 17-tenant-portal | D | 08,13 |
| 18 | 18-aws-deploy | D | all core |
| 19 | 19-test-and-chaos-verification | all | core |
| 20 | 20-demo-script-polish | D | all |

Parallelizable after 00: tracks A, B(07+), C(14), D(15 with mocks).

## Which order to run them?
**Short answer: numerical order (00 → 20) is safe.** Every prompt only depends on earlier numbers, except one wrinkle: prompt 10 (throttle) wants to be tested with the load generator from prompt 14.

**Recommended order if you are working alone (one person, one session after another):**
`00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 14 → 08 → 09 → 10 → 13 → 15 → 16 → 17 → 11 → 18 → 19 → 12 (stretch, only if time) → 20`

**With 3-4 people, after 00 is merged:**
- Dev A (data plane): 01 → 02 → 03 → 04 → 05 → 06
- Dev B (control plane): 07 → 08 → 09 → 10 → 13  (starts once 05 exists; use fake events until then)
- Dev C (AI + simulation): 14 → 11 → 12
- Dev D (web + demo): 15 (on mock stream) → 16 → 17 → 18 → 20
- Everyone: 19 after integration freeze.

Never skip 00. Run 04's cgroup spike early (it is the riskiest assumption). Run 18 (AWS) only after the local stack works.

## Global rules (apply to every prompt)
- Read `prompts/_RULES.md` first: it limits verification cost and tells the agent to guide a beginner step by step.
- Follow decisions in `docs/`; if you must deviate, write the deviation in `docs/DEVIATIONS.md`.
- Inject a clock interface; no `time.Now()` in logic.
- Every new package gets unit tests for its core logic.
- Never commit secrets; use `.env.example`.
- Keep MVP scope; stretch items are flagged in docs/12.
- End each prompt by running its acceptance checks and reporting results honestly.
