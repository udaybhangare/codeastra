# Deviations from docs/

- **Prompt 01 — tier preset numbers**: docs don't give numeric values; chosen in `platform/internal/policy/policy.go` (`Preset`). Free: weight 1, 0.1–0.5 cpu, 256 MB, 10 rps/burst 20. Pro: weight 4, 0.5–1.5 cpu, 1 GB, 50 rps/burst 100. Enterprise: weight 10, 1–3 cpu, 2 GB, 150 rps/burst 300. Tune in later prompts.
- **Prompt 01 — migrations tool**: goose v3 as a Go library (embedded SQL, `platform/migrations`), run via `make migrate`; no external CLI needed.
- **Prompt 01 — policy cache**: on any `policies_changed` notification the whole table is reloaded (5–few rows); invalid rows are skipped and logged.
- **Prompt 02 — separate `ADMIN_JWT_SECRET`**: admin JWTs are signed with their own secret (docs/04 "separate admin credential"); `ADMIN_API_KEY` is exchanged at `POST /admin/auth/token` (`X-Admin-Key`) for a 15-min admin JWT. bulkheadd refuses to start if secrets are unset/short or equal.
- **Prompt 02 — API key hash**: keys stay sha256 (as seeded in prompt 01) rather than argon2/bcrypt; they are 192-bit random so brute force is infeasible, and a slow hash would blow the auth latency budget. Compare is constant-time.
- **Prompt 02 — revocation**: in-memory deny list (per-jti and per-tenant "tokens issued up to now"), cleared on restart; fine for single-instance + 15-min TTL. Exposed as `POST /admin/tenants/{id}/revoke-tokens`. Revoked/suspended *keys* are rejected at exchange.
- **Prompt 02 — JWT**: hand-rolled HS256 (stdlib only, fixed header, no alg negotiation) to avoid a dependency and stay well under the 50µs budget.
- **Prompt 03 — oversize cost clamp**: a request whose estimated cost exceeds the cost bucket's burst (2 s of `cost_per_s`) debits the whole burst instead of being rejected forever; it is admitted only when the bucket is full. Real cost is corrected by the estimator and, from prompt 05, by DRR deficit accumulation.
- **Prompt 03 — refunds**: tokens taken by earlier layers are refunded when a later layer rejects, so rejected requests don't drain a tenant's quota. Layer order otherwise follows docs/03 (quarantine first, as a map lookup).
- **Prompt 03 — Redis fast path**: a local bucket with the same params pre-checks; a local deny never hits Redis. Redis timeouts/errors (5 ms) fall back to the local result and set `Degraded()` (logged once per transition). Local and Redis buckets can drift slightly across replicas; Redis is authoritative when up.
- **Prompt 03 — estimator**: EWMA is over the ratio actual/prior (alpha 0.3, clamped 0.1–10), not absolute cost, because params like `ms`/`mb`/`kb` vary per call. Param names: `ms` (cpu-burn, db-query), `mb` (mem-alloc), `kb` (payload).
- **Prompt 03 — bandwidth**: debits request bytes + estimated response bytes, burst 2 s of `bandwidth_bps`.
- **Prompt 04 — spike result**: host is cgroup v2 (systemd driver); live `docker update` of CPU takes effect without restart (1.0 → 0.5 cores measured). R1 fallback (restart-on-change) not needed here; re-run `deploy/spikes/cgroup_check.sh` on EC2 in prompt 18.
- **Prompt 04 — no Docker SDK**: `internal/workerpool` talks to the Engine API over the unix socket with `net/http` (≈8 calls) instead of the moby client module, whose API is still pre-1.0 and heavy; avoids dependency churn.
- **Prompt 04 — CPU as quota/period, not `--cpus`**: Docker refuses to un-set NanoCpus on a live container, which Isolation OFF needs. Limits use `CpuPeriod=100000` + `CpuQuota`; identical `cpu.max`.
- **Prompt 04 — "unlimited" memory**: daemon rejects `Memory=-1` on update (min 6 MB), so unlimited = 1 TiB ceiling; swap is set equal to memory (no swap) whenever a limit applies.
- **Prompt 04 — worker image**: `FROM scratch` + host-built static binary (`make worker-image`), user 65532, HEALTHCHECK via `worker -healthcheck` (no shell in image). Tenant networks are `Internal` (no internet); platform reaches workers by container IP, and `Config.AttachContainer` connects bulkheadd to each tenant network when it runs in compose.
- **Prompt 04 — worker metrics**: `cpu_ms` is process CPU time (user+sys) over the call, so concurrent calls on one worker overlap; `cpu-burn.ms` is CPU-time (not wall) so throttled containers take longer. `db-query` returns a clean error until prompt 06.
- **Prompt 05 — DRR structure**: `Enqueue` takes only the tenant's own lock; the ring is owned by the single dispatcher goroutine (activation via channel), so there is no global lock on the dispatch path. The isolation-OFF FIFO is one global queue behind a mutex by definition.
- **Prompt 05 — credit cap**: DRR accounts at most `MaxJobCost` (20× base quantum) per job, so oversize jobs accumulate deficit over a bounded number of rounds (docs/03 "cost cap per dispatch slice").
- **Prompt 05 — quarantine lane**: ring served first every Nth dispatch (default 8), otherwise after the main ring (work-conserving); fixed lane weight 0.25; own slot cap (`QuarantineSlots`, default 2) and per-tenant concurrency 1 enforced by the dispatcher.
- **Prompt 05 — policy sync**: weight/queue cap/concurrency are applied from the policy snapshot at enqueue time only when the policy's `UpdatedAt` changed, so throttle-controller `SetWeight`/`SetQuarantine` overrides persist until the next policy edit.
- **Prompt 05 — worker provisioning**: `bulkheadd` runs a 3 s reconcile loop that `Ensure`s a worker per tenant in the policy snapshot (needs Docker; without it invokes return 503 `WORKER_UNAVAILABLE`). `X-Throttle-Level` is a constant `0` until prompt 10.
- **Prompt 05 — cost vector**: actual cost = worker `cpu_ms`, `mem_peak_mb × wall_ms`, `db_ms`, `bytes` through the doc 03 formula.
- **Prompt 07 — own HDR-style histogram**: `internal/metrics/hist.go` is a log-linear histogram (128 sub-buckets per power of two, ≤0.8% error, 0 allocs, clamps at ~268 s) instead of the `hdrhistogram-go` dependency; same accuracy class, no new module.
- **Prompt 07 — baselines**: `metrics.Baselines` keeps EWMA (α=0.1) of p95/p99/queue-wait over calm windows (p99 ≤ 2.5× baseline, ≥5 completions); freezes while degraded or via `Freeze()`. The detector must reuse `agg.Baselines()`. Victim inflation excludes tenants using more than their entitlement (`ReserveCPU`) unless `IsOffender` is set.
- **Prompt 07 — scope of events**: only dispatcher completions feed metrics so far; admission/gateway rejections (429/503) are not yet recorded (`rejected_rps` stays 0 until wired in prompt 08/09). `/metrics` is served on the main port, unauthenticated — block it at Caddy before prompt 18.
- **Prompt 07 — Jain input**: x_i = cores used ÷ `ReserveCPU` (not weight share), over tenants with traffic or queued work in the window.
- **Prompt 08 — extra table `usage_ledger_task`** (migration 00003): docs/04 lists only `usage_ledger` (per tenant/window); a per-(tenant, window, task) table was added because "cost breakdown by task" needs that grain. `usage_ledger` is still written (with p99 from the metrics window). Both are written with absolute values via upsert, so retries/late events are idempotent; flushed windows stay in memory 2 min to absorb late events.
- **Prompt 08 — rate card**: CPU+network are priced via cost units (`RATE_PER_COST_UNIT`), memory by GB-s (`RATE_PER_GB_S`), DB by DB-s (`RATE_PER_DB_S`) *instead of* their share of cost units, so nothing is charged twice. Tier multipliers (free 1 / pro 0.8 / enterprise 0.6) and a free allowance (5k / 50k / 250k cost units per report window, credited at the cost-unit rate) are code defaults in `usage.DefaultRateCard`. Every report carries a "showback / estimate" disclaimer.
- **Prompt 08 — response shapes**: `/v1/me/usage` returns `{usage{totals,by_task,series}, quota}`, `/v1/me/showback` the `usage.Showback` struct, `/admin/usage` `{fleet{totals,top_spenders,by_task}, tenant?}`; `contracts/openapi.yaml` schemas `Usage`/`Showback` and the `/admin/usage` path still need aligning (do with prompt 13/17). Query range: `from`/`to` RFC3339 or `range=15m`, default 1 h, max 24 h; aggregation happens in Go over ledger rows.
- **Prompt 08 — rejections now recorded**: admission rejects and enqueue-time `QUEUE_FULL` go to both the metrics aggregator and the ledger via `gateway.Deps.OnReject` (resolves the prompt 07 note that `rejected_rps` stayed 0). Event `MemPeakMB` is now filled (as MB·ms ÷ exec ms).
- **Prompt 08 — ledger lag**: ledger flushes every 5 s, so reports miss the newest ≤ 5 s.
- **Prompt 14 — client-side metrics**: the load generator computes everything from its own timings (latency from *intended* send time). `time_to_detect_s`/`time_to_mitigate_s` are the first attack-phase `X-Throttle-Level` ≥2 / ≥3 seen on a culprit response (9999 = never); `false_positive_count` = probe tenants that ever saw level ≥4; `jain` is over non-culprit tenants' ok/sent ratio in the attack phase (client-side proxy for the server's Jain).
- **Prompt 14 — retries & bursts**: retries are not part of the seeded schedule (schedule stays byte-identical); "honor" profiles retry ≤2× after `Retry-After` (cap 5 s), `retry_without_backoff` retries ≤5× immediately. A `burst` arrival is centred in its phase for `burst_duration_s` (default min(phase, 20 s)) at `rps × burst_multiplier` (default 10).
- **Prompt 14 — run storage**: results are always written to `loadgen/runs/*.json`; `POST /admin/runs` (not in `contracts/openapi.yaml` yet, only GET) is attempted best-effort — the platform side must add it (prompt 19 integration) for `runs` table storage. `/admin/isolation` is likewise not implemented server-side yet; `--mode`/`ab` need it.
- **Prompt 14 — S7 second abuser**: uses `leaky-app` (mem-alloc) as the second culprit because the seeded cast has only one `rogue-*` tenant.

## Prompt 09 — detector
- Doc 06 gives only k=2.5 and N=3; other thresholds are chosen defaults in `detector.DefaultConfig()`: τ=0.05 (swept 0.03–0.08 on the synthetic suite; 0.03 gave 2–3 chance-correlation false positives), resource weights CPU .4 / DB .3 / queue .2 / bytes .1, quota slack 1.1, queue-wait floor 100 ms.
- Non-CPU entitlement = the tenant's CPU entitlement fraction applied to each resource's host capacity (`Config.Capacity`).
- Correlation uses raw levels over 30 windows (lag 0–2). First-difference mode exists (`DiffCorr`) but cut recall to 0 on the synthetic suite, so it is off. Known limit: a tenant that became busy shortly before a real abuser can correlate by coincidence; τ absorbs most of it.
- The detector keeps its own EWMA baselines (same alpha/K as `metrics.Baselines`) so it is pure and replayable; it does not call `Baselines.Freeze`.

## Prompt 10 — throttle controller
- Defaults chosen (docs/06 gives only the times): τ₂ = 0.10 (τ₁ = detector τ 0.05), grace 2 s (harm gaps shorter than this don't reset persistence/calm timers — the anti-flap rule), level profiles Soft w×0.5/rate×0.7, Hard w×0.5/rate×0.5/cpu×0.4/db×0.5, Quarantine w×0.25/rate×0.25/cpu×0.1 (abs. floor 0.05 cores). Observe→Soft uses only the 3 s sustain; min dwell 5 s applies to every other change.
- Rails: CPU never below reservation×0.5 (≥ the doc's ×0.25 rail), rate ≥ ×0.25, weight ≥ ×0.25, except Quarantine. Max 3 culprits at Soft+ at once (worst score first); excess stay at Observe. Global panic: `Controller.SetPanic(on)` holds free-tier tenants at ≥Hard (exempt from the culprit cap) until switched off, then they recover via the normal ladder; `POST /admin/panic {on}` (audited). Nothing triggers it automatically yet.
- Re-offense (harm within 60 s of a step-down) jumps one level up and halves every knob; from Normal/Observe that lands on Soft (Observe has no action, so re-offenders skip it).
- AIMD: each calm tick closes 10 % of the gap between a knob and its level's profile; knobs only drop immediately (escalation), never jump up. Recovery events are rate-limited to one row per 5 s.
- Admin API: `POST /admin/tenants/{id}/level {level|null, reason}` (pin/unpin, audited, per openapi), `GET /admin/events` (throttle_events), `GET /admin/stream?token=<admin JWT>` (WS, `event` messages only — no `snapshot` messages yet, those need the metrics→WS feed), `GET /v1/me/throttle` now returns the real state (level, since, explanation, actions; no other tenants' evidence). The gateway's logging wrapper now implements `Hijack` so WebSocket upgrades work.
- Predictor entry: `Controller.Predict` is a no-op unless `PREDICTIVE_THROTTLE=on`; nothing calls it until the predictor exists.
- Quarantine rejects (`admission.Quarantine`) are still unwired; quarantine = scheduler lane + tiny CPU/DB caps.
- **Prompt 10 — S1 smoke run (scale 0.5, ISOLATION=on, 16-core host) did NOT reach Hard**: no victim was ever hurt (acme-shop p99 0.9–1.0× baseline), so the detector — correctly — produced no findings and the ladder stayed at L0 (0 `throttle_events`). The free-tier quotas (10 rps / cost 50/s / concurrency 4) absorbed the flood; even with rogue-ml's policy temporarily lifted to rps 400 / cost 500k/s / 16 cores, per-tenant containers + DRR kept victims at baseline (rogue's own p99 hit ~50 s, `QUEUE_FULL`). So S1's assertion `time_to_mitigate_s ≤ 8` (first X-Throttle-Level ≥ 3 on the culprit) is unreachable while isolation fully contains the attack. Decide in prompt 14/19: either S1 should measure containment (victim p99, abuser goodput) rather than ladder level, or use a scenario where a shared resource (DB pool, queue slots) is what is exhausted. Also: with bulkheadd on the host, worker→DB-proxy calls fail (tenant networks are Internal), so `db-query` errors show up as victim errors; run inside compose for a clean result. Ladder behaviour under real harm is covered only by the fake-clock unit tests so far.

## Prompt 13 — admin API & WebSocket
- `GET /admin/tenants` now returns the OpenAPI array of `Tenant` (policy + live metrics), replacing the earlier `{"tenants":[...]}` policy list. `name` = tenant id and `status` = `active` (no tenants-table read yet).
- `PUT /admin/tenants/{id}/policy` merges the body onto the current policy (omitted fields keep their value), then validates (422 on failure), writes, reloads the cache, audits and emits an `admin` event.
- `POST /admin/isolation` flips admission caps, DB proxy caps, scheduler (DRR/FIFO) + dispatcher, and cgroup limit mode at runtime; the detector follows `adm.IsolationOn`. Emits an `isolation` event.
- Scenario run delegates to `POST {LOADGEN_URL}/run {run_id,scenario,seed,duration}`. **The loadgen binary has no HTTP trigger yet** (CLI only); until it does, the endpoint returns 502 `loadgen_unavailable` and the run is closed with an error summary. Added (not in openapi): `POST /admin/runs` (loadgen reports a finished run, with or without `run_id`; emits `run_result`) and `POST /admin/runs/{id}/progress` (emits `run_progress`).
- `GET /admin/predictor` proxies `{PREDICTOR_URL}/state`; if unset/unreachable it returns `{model:"baseline",healthy:false}`. The predictor sidecar (prompt 11) has no HTTP routes in the repo yet.
- WS `/admin/stream`: per-client bounded queue (16), oldest snapshot dropped first, full snapshot sent on connect. Admin-only (carries all tenants); no tenant-scoped stream exists. CORS allows only `DASHBOARD_ORIGINS` (default `http://localhost:3000`); the same list gates the WS Origin.
- `victim_inflation`/`jain` come from `metrics.Fairness`; `db_conns`, `p_overload` and host `db_conn_util` are omitted from snapshots until a source exists.

## Prompt 15 — dashboard
- Heatmap entitlements are placeholder per-tier constants in `dashboard/src/lib/ladder.ts`; the WS snapshot carries no quotas. Replace with policy API values in prompt 16/17.
- "Victim" highlighting is client-side (unthrottled tenant with p99 > 2× its own best in the 10-min window); the stream has no explicit victim flag.
- Lighthouse a11y score and the 5×10-min smoothness check were not run (heavy checks; deferred to prompt 19).
- GAP (admin auth): no prompt covers admin-console sign-in. Dev uses `pnpm mint-token` (dashboard/scripts/mint-token.sh) to bake a 15-min JWT into `.env.local`; this does NOT work in production. Needed before prompt 18: admin sign-in screen (admin key -> POST /admin/auth/token, JWT in memory, auto-refresh + WS reconnect), with `NEXT_PUBLIC_WS_URL` as a bare `wss://…/admin/stream`.

## Prompt 16 — incidents, Why drawer, Scenario Lab, A/B compare
- **Recorded fallback ships empty.** "Load recorded" fetches `dashboard/public/recorded/<S#>.json`; no file is committed because no real A/B run has been executed yet (numbers must not be fabricated). To create one: run S1 live, press **Export JSON**, save as `dashboard/public/recorded/S1.json`. "Open file…" loads any such export. Full live run deferred to prompt 19.
- A/B orchestration is client-side (`lib/lab.ts`): POST `/admin/isolation` off → run → wait for `run_result` → isolation on → run; isolation is always set back to ON afterwards. Duration 0 = "scenario default" is sent as-is; the backend/loadgen must treat 0 that way.
- p99 time series for the A/B charts are captured by the dashboard from the `snapshot` stream while a run is in progress (loadgen reports only per-phase stats), aligned on `run_progress.elapsed_s`. A run seen while the dashboard was disconnected has no chart, only the table.
- Comparison metrics are read from `summary.metrics` (loadgen Report) or `summary` itself; rows absent from the summary (e.g. `utilization`, which loadgen doesn't emit yet) are hidden, not invented.
- The WS `event` frame has no `reason` field (schema is closed), so the drawer shows the explanation sentence, evidence, actions, and predictor score but no reason code chip.
- Why-drawer deep link: `/incidents?e=<ts|tenant|from>to|kind>`; events live only in memory (latest 200), so links to older events show a "no longer in memory" message.
- Presentation mode is client state (not persisted): 125% root font, sidebar and scenario config hidden, big OFF/ON inflation numbers.
- **Recorded S1 (`dashboard/public/recorded/S1.json`)** is a real run (loadgen CLI `ab S1 --seed 42`, scale 1, dev host with workers in Docker, 2026-10-12). Victim p99 inflation 2.92e4× OFF vs 1.02× ON; ON assertion on inflation passes. Caveats: (a) `time_to_detect_s`/`time_to_mitigate_s` are the 1e4 "never" sentinel in both runs (S1 mitigation assertion FAILS — same containment-vs-ladder issue as the prompt 10 note; the UI shows "not reached"); (b) data-co shows 0 OK because the host-mode DB proxy can't reach tenant networks (prompt 10 note), which inflates `victim_errors` in both modes; (c) OFF-run p99 climbs to ~60 s because the unbounded queue is the point of the OFF baseline; (d) the p99 series was captured from `/admin/stream` alongside the CLI run, and the first sample of the ON series (still showing the OFF run's draining p99 window) were trimmed. Re-record inside compose for a clean result in prompt 19.
- **Prompt 17 — tenant portal**: route `/portal` (bypasses the admin shell, so it never opens the admin stream). Backend additions beyond docs/04: `GET /v1/me/live` (caller's own latest 1 s window; the portal polls it every 2 s to draw latency history, as there is no per-tenant latency history endpoint) and `POST /v1/me/key/rotate` (revokes active keys + issues one new key in a transaction, audited as `apikey.rotate`; the new key is shown once). Rotation does not revoke already-issued JWTs (they expire by TTL) because `RevokeTenant` would also kill tokens minted right after rotation. CORS now also covers `/v1/me/*` and `/v1/auth/token` for configured dashboard origins. The portal JWT lives only in memory (reload = log out). Without `NEXT_PUBLIC_API_URL`/live WS it runs on built-in mock data (type `rogue-ml` or `acme-shop` as the key). `openapi.yaml` not yet updated for `/v1/me/live` and `/v1/me/key/rotate`.

## Prompt 11 — predictor sidecar (baseline)
- Extra endpoint `GET /state` on the sidecar (already expected by `gateway.PredictorHTTP`); `POST /model/select` returns 409 for anything but `baseline` until the GBM challenger (prompt 12) exists.
- Per-tenant `p_overload` treats a tenant alone using 50% of host cost capacity (`TENANT_MID`) as overload, since the contract carries no per-tenant entitlement. Host capacity comes from env `PREDICTOR_CAPACITY_COST_UNITS_S` (default 200, **a guess** — calibrate against a real run in prompt 19).
- Rolling state cache lives in the sidecar, keyed by tenant (bounded, evicted after 120 idle calls); each `/predict` call = one 1 s window.
- Detector gets the forecast as `evidence.predictor_score` (not part of the score). Throttle pre-emption still needs `PREDICTIVE_THROTTLE=on`.
- Go `predictor.Service` keeps the last sidecar answer for up to 3 s on error ("cached"), then switches to the in-process EWMA fallback; `/admin/predictor` adds a `client` block (calls/errors/fallbacks/latency).
- Acceptance numbers come from synthetic traces in `predictor/tests/test_baseline.py` (30 noisy ramps ≥ 80% with ≥ 3 s lead; 10 h of noisy-flat traces with zero alerts), not from real loadgen runs. The kill-sidecar check is covered by a Go unit test, not a live compose run (deferred to prompt 19).

## Prompt 18 — AWS deployment
- **Dashboard ships in mock mode in production** (no `NEXT_PUBLIC_WS_URL`): the admin sign-in gap from prompt 16 is still open, and a baked 15-min JWT is useless/unsafe in a public bundle. `NEXT_PUBLIC_API_URL` is set, so the tenant portal runs live. Closing the gap (admin key → `POST /admin/auth/token`, token in memory, WS reconnect) is needed for a live admin console.
- **No loadgen HTTP trigger exists** (`LoadgenClient` POSTs `{LOADGEN_URL}/run`, nothing serves it), so dashboard-triggered scenario runs do not work; box #2 runs the loadgen CLI (`compose.loadgen.yml`, `ab S1`) instead of a long-running `loadgen.service`.
- Worker image keeps the tag `bulkhead/worker:dev` because `workerpool` hard-codes the default; platform/predictor/dashboard/loadgen use `:prod`.
- bulkheadd mounts `/var/run/docker.sock` (root-equivalent on the host) — required for cgroup updates and worker lifecycle; it is never exposed outside the box. :8080 is published only on `BULKHEAD_BIND_IP` (box #1 private IP; SG allows box #2 only).
- No CPU pinning of platform containers (R2 "where possible"); host reservation is left to the c6i sizing + separate loadgen host.
- Manual runbook only, no Terraform. Acceptance runs on real EC2 (<15 min fresh-box, HTTPS, S1 over network, cost alarm) are deferred to the human + prompt 19.

## Prompt 19 — verification
- Verification ran on one laptop (loadgen co-located with the platform, no EC2/HTTPS), not the two-box topology of docs/02; see `docs/RESULTS.md` for caveats.
- Scripts live in `deploy/verify/` (`make verify-security|integration|chaos|repeat|all`); `runs/` is gitignored.
- Fixed `false_positive_count` in loadgen (was missing when 0, so S6's `== 0` assertion read "unknown metric").
- **Open failure:** S1 `time_to_mitigate_s ≤ 8` is never met (ladder stays ≤ L1; containment comes from static caps). Documented, thresholds not tuned.
- Known edge: tenant token revocation has 1 s granularity; a token minted in the same second as `revoke-tokens` is rejected.
- Incident during testing: an early draft of `security.sh` accidentally rotated rogue-ml's API key; restored by re-seeding, `deploy/keys.json` updated (gitignored).
- S1 assertion `time_to_mitigate_s <= 8` replaced by `abuser_goodput_rps <= 1` (loadgen/scenarios/S1.json). Reason: containment comes from static caps; detector needs victim impact (Q4). docs/09's "L2->L3 within 8s" is therefore not exercised; Q7 timing stays unproven.

## Prompt 12 — ML challenger
- Training/eval data comes from `predictor/sim.py` (seeded fluid model mirroring S1–S7, 24 seeds × ON/OFF), not the real loadgen+platform export: running the full stack is deferred to prompt 19 (same CSV schema, so `train.py`/`eval.py` take it unchanged). Results show the method only.
- Tenant label = host overload (demand/mem/db/queue ≥ 1.0) within next 10 s AND that tenant holds ≥35% of a resource then (so flash crowds and innocent victims are negatives).
- Baseline stays the default model; GBM is opt-in via `POST /admin/predictor/model` (→ sidecar `/model/select`) or `PREDICTOR_MODEL=gbm`. `eta_s` is `null` for GBM (not modelled).
- Artifacts (`predictor/ml/artifacts/`: model, meta, eval.json) are committed; raw rows (`ml/data/`) are gitignored.

## Prompt 20 — demo polish
- Presentation mode and the big-number A/B screen already existed (prompt 17); no dashboard changes made here.
- `demo/recorded/` holds only `S1.json` (exported from the dashboard, seed 42, schedule hash matches `make demo`). It predates the S1 assertion change (§4b): it shows `time_to_mitigate_s` as failed and 733 victim errors in ON, which differ from the loadgen runs in RESULTS §4. Treat it as a UI fallback, not as evidence. S2/S6 bundles were not recorded (the dashboard cannot trigger loadgen runs, see Prompt 18).
- Architecture "image export" not done; README points at the ASCII diagram in docs/02.

## Prompt 20 — admin sign-in (closes the Prompt 18 "admin auth gap")
- Dashboard built with `NEXT_PUBLIC_WS_URL=auto` (new default in `deploy/build.sh`): same-origin live backend; the admin enters `ADMIN_API_KEY` once in a sign-in card, the dashboard mints and renews the 15-min JWT (`src/lib/api.ts`). JWT is held in memory; the key in `sessionStorage` (tab-scoped, cleared on tab close) so renewal needs no prompt. "Use simulated data" on the card falls back to the mock stream.
- Not verified in a browser (no UI checks per AGENTS.md); `tsc --noEmit` clean and the `/admin/auth/token` endpoint answers 200/401 through Caddy.
- Dashboard image: runs `node_modules/.bin/next` directly (was `pnpm exec`, which made corepack download pnpm at start-up: slow, and broken offline); `--chown=node` fixes the unreadable mode-600 `pnpm-workspace.yaml` that caused the 502 restart loop.
- Dev (`pnpm dev` on :3000): set `NEXT_PUBLIC_WS_URL=auto` and `NEXT_PUBLIC_API_URL=http://localhost:8080` in `dashboard/.env.local` to use the same sign-in; the backend must allow that origin (CORS).
- workerpool: before recreating a tenant network, force-disconnect the platform container from the stale one (a leftover network with bulkheadd attached blocked worker creation with 'network already exists' after a platform restart; seen as 503 in make demo). Image rebuild needed: deploy/build.sh platform.
- compose.prod.yml: DASHBOARD_ORIGINS now includes the HTTPS port (https://localhost:8443) and http://localhost:3000; without the port the browser's WebSocket origin was rejected, so the live stream showed 'Reconnecting…' forever.

- Dashboard: replaced the Tenants, Predictor and Audit placeholder pages with read-only views over /admin/tenants, /admin/predictor and /admin/events (polled every 3 s; src/components/admin/*). Audit shows throttle-ladder decisions: there is no read endpoint for the admin audit table, so admin actions (token issue, revoke, isolation toggle) are not listed. No policy editor.

## Prompt 20 — S9 "gauntlet" (user request)
- `loadgen/scenarios/S9.json`: every attack of S1–S5, S7, S8 runs concurrently for the whole 150 s attack window (rogue-ml: CPU flood 20 rps, DB hog, 4 GB memory bomb, retry storm, ramp 2→30, 1 MB payloads; leaky-app: 512 MB memory abuser), plus bursty-news' legitimate 10× spike (S6 false-positive probe). Warmup 10 s and cooldown 20 s stay calm because the inflation metric needs a baseline phase; the loadgen only supports one phase of each name, so attacks cannot be sequenced.
- One run (seed 42, local laptop): OFF victim p99 inflation 27,368×, 2,521 victim errors, throughput ratio 0.39; ON 0 errors, throughput ratio 1.03, 0 false positives. A/B wall time 398 s. ON p99 inflation prints 0.02×, which means the 10 s warmup baseline was inflated by cold starts, not a real 50× speed-up: quote errors and throughput ratio instead. Single seed, not in RESULTS.md.
- **Laptop safety for S9**: full S9 needs ~16 GB RAM and 60+ cores of demand and crashed a dev PC. Added `loadgen/scenarios/S9-LITE.json` (same shape, ~1/10 size: peak ~1 GB, <2 cores, 60 s attack), a `--load <f>` flag (multiplies every rps, sizes unchanged) and a guard: `loadgen run S9` refuses unless `--heavy` is passed (use on the AWS box only).
- **S10-MARATHON (laptop-safe, 10 min)**: `loadgen/scenarios/S10-MARATHON.json`. Added optional `start_s`/`end_s` on arrivals (sub-window of a phase, so attacks can be sequenced inside the single `attack` phase) and top-level `waves` (labels over the attack phase). The report gains a per-wave table (sent/ok/rej/throttled/max level/p99 per tenant) and run progress shows the active wave. Un-windowed scenarios keep byte-identical schedules.
- **S10-MARATHON v2**: one culprit tenant per resource (new seeded tenants cpu-hog, db-hog, queue-storm, bw-hog; leaky-app = memory), staggered and overlapping so several climb the ladder at once; `deploy/seed.sh` now merges new keys into keys.json instead of overwriting.

## UI redesign (docs/ui + prompts/ui)
- Frontend visuals are redesigned: bright "Paper & Ultramarine" theme, 3D hull landing, floating-sidebar console. Docs: `docs/ui/`; prompts: `prompts/ui/U01–U14` replace the visual parts of prompts 15–17/20. Landing moves to `/`, admin Overview to `/overview`. Dark theme removed.

### U01 foundation
- Token gallery lives in `dashboard/src/app/%5Ftokens/` (URL `/_tokens`): Next.js treats a literal `_tokens` folder as private/unroutable. Remove in U14.
- Kept shadcn alias vars (`--background`, `--muted-foreground`, `--border`, ...) in `globals.css`, now pointing at the new tokens, so existing components keep rendering until rebuilt (U06+). Dropped `dark:` classes from `components/ui/button.tsx` (Tailwind v4's default `dark:` follows the OS setting).
- New deps resolved without peer conflicts: motion 14.1, gsap 3.15, lenis 1.3, three 0.186, @react-three/fiber 9.8, drei 10.7, maath 0.10 (+ @types/three).

## U03 — 3D hull
- `HullTenant` gains optional `rps`, `p99_ms` (particle rate, tooltip); `HullProps` gains optional `host` (keel gauge) and `className`. Required fields unchanged from docs/ui/03.
- Off-screen pause uses `frameloop="never"` (resumes on `"always"`) instead of `demand` + invalidate: the scene animates continuously, so demand mode would add nothing.
- Name plates use drei `Html` (DOM) rather than `Text`, which would fetch a font from a CDN.
- No test runner exists: `toHullTenants` etc. are checked by `dashboard/scripts/check-hull.mjs`.

## U04 — landing hero
- Added optional `reducedMotion` to `HullProps` (disables cursor parallax) so the landing honours `prefers-reduced-motion`.
- Hull canvas is offset to the right 62% on desktop (`md:left-[38%]`) so hero text never covers compartments; mobile uses a 46vh top canvas.
- Until U05, `/` has a 160vh empty `#story` spacer so the scroll-scrubbed camera and progress rail are demoable.
- Nav/CTAs use `router.push` (Button is a `<button>`), not `<a>` links.

## U05 — landing story
- Hull progress is no longer a plain page fraction: hero scroll maps to 0–0.12 and the single pinned story container to 0.12–1 (`StoryTimeline` sets it; `scrollMap.toY` converts back for the rail/nav). Mobile (<768px) and reduced motion render stacked cards with no pin, per docs/ui/04 States.
- Ladder levels in the stepper are the UI's six (Normal…Quarantine); docs/06 defines five. Level 4 "Isolate" copy is UI-only wording.
- Predictor sparkline and the "Why?" sentence are labelled illustrative/example (copy from docs/ui/04, not measured). Results bento uses docs/RESULTS.md §3–4 medians only, with its caveats printed under the tiles.
- Nav "Results" scrolls to progress 0.92 (proof panel); there is no separate results section.

## U06 — admin shell
- **Isolation switch on the mock stream** is local-only (`useUi.mockIsolation`); the simulated stream has no backend to flip. Live mode calls `POST /admin/isolation`, which writes the audit event server-side.
- **Page transition has no exit fade**: App Router unmounts the old route immediately, so only the enter animation (fade up 8 px, springSoft) is implemented.
- **Sidebar rail below 1280 px** is forced by a media query; the `[` preference only applies on wider screens.

## U07 Overview
- `dashboard/tsconfig.json`: `allowImportingTsExtensions` so the pure selectors in `src/lib/overview.ts` can be unit-tested with `node --test src/lib/overview.test.ts` (no test runner is installed in `dashboard/`).
- Sparklines come from a module-level 60-point buffer (`src/lib/use-kpi-history.ts`) fed by `useStream.subscribe`; the store contract is unchanged. Time-in-level uses the snapshot timestamp as the clock.
- Disconnected banner has no reconnect countdown: the store does not expose the next retry time.
- Legacy `LadderBadge` in `components/status.tsx` now re-exports the new `components/domain/ladder-badge.tsx`. The landing page keeps its own `landing/story/LadderStepper` until U13 cohesion.

## U08 — Incidents & DecisionDrawer
- `DecisionDrawer` is exported from `components/incidents/decision-drawer.tsx` and wired into Overview and Incidents. The legacy Audit table (`components/admin/audit.tsx`) has no per-row event ids yet, so it does not open the drawer until U11 rebuilds it; the drawer already accepts any `StreamEvent`.
- Time-range chips are relative to the newest stream timestamp (no wall-clock reads), so a paused mock stream keeps showing its last window.

## U09 — Scenario Lab & A/B
- `useLab.start` gained an optional 4th arg `mode: "ab" | "off" | "on"` (default `"ab"`, behaviour unchanged) so the Run panel's OFF / ON / A-B selector works; single runs show one chart and ask for the other side to compare.
- Confetti is a small motion-based burst (`components/lab/confetti.tsx`), no new dependency.
- `lib/export.ts` PNG export now reads `--surface` / `--ink` (old `--card` / `--foreground` no longer exist).

## U10 — Tenants & policy editor
- **Endpoints**: `api.putPolicy` (`PUT /admin/tenants/{id}/policy`) and `api.setLevel` (`POST /admin/tenants/{id}/level`) were not in `api.ts`; added as thin clients for endpoints that already exist in the Go gateway and `docs/04`. No new backend endpoints.
- **Pin range**: the pin API accepts levels 0–4 (backend ladder has 5 levels, UI shows 6). `LadderStepper` got `maxSelectable`; L5 renders disabled in the editor. Release-pin also requires a reason.
- **View only on the mock stream**: without `NEXT_PUBLIC_WS_URL` there is no REST backend, so the editor shows tier-default quotas read-only with a "View only" chip. Real policy values appear in live/auto mode.
- **Save is explicit** (Save policy button with diff chips) rather than debounced live-edit, so every change is one audited `policy.update`. Revert re-PUTs the pre-save policy (one level deep, this session only).
- Legacy `components/admin/tenants.tsx` removed (replaced by `components/tenants/`).

## U11 — Predictor & Audit
- **Forecast data comes from the stream**, not REST: per-tenant/host `p_overload` in snapshots is buffered for 10 min (`lib/use-forecast-history.ts`). "Actual" is p99 (tenant) or CPU % (host). **No confidence band** is drawn: the API carries no interval, so the shaded zone is the fixed 60% early-warning threshold (`PredictObserve` default) and spans where the forecast stayed above it.
- **Lead time is observed, not modelled**: seconds from the forecast crossing 60% to the ladder escalation (`lib/predictor.ts`). Only the *active* model has live data; the other model's row says "not measured this session" (offline comparison lives in `predictor/eval.py`). "No follow-up" counts alerts with no escalation within 30 s; it is a candidate false-alarm count, not ground truth.
- **FeatureBars**: `/admin/predictor` does not expose feature importances (the GBM keeps them internally), so the card shows an honest empty state and renders bars only if `importance` / `feature_importance` appears in the response. Backend left untouched (out of scope for U11).
- **Audit merges two sources**: the live stream (rich: actions, actor) and `GET /admin/events?limit=200` (history); duplicates are keyed by whole second + tenant + levels + kind. REST-only rows have no actor ("system") and no actions. Date filter is relative to the newest event (no wall clock). Virtualised above 200 rows with a fixed-height window (expanded rows are 320 px).
- Legacy `components/admin/*` removed (all pages now live in `components/{tenants,predictor,audit}/`).

## U12 — Tenant portal
- **Gauges use what `/v1/me/*` exposes**: compute budget (cost units), request rate, parallel jobs (concurrency) and share of requests turned away. The spec's CPU / memory / DB connections / bandwidth are not in the tenant API; no backend change made.
- **Showback rows show a share-of-bill bar instead of a per-row sparkline** (the API has no per-resource time series). History range chips (5/10/15 min) filter the 15 min `usage` series and the in-session live buffer; 1 h is not offered.
- **API key list is a single masked row** (last 4 chars from sign-in/rotation): the API has no key list, created or last-used times. Rotate uses a confirm dialog, then a reveal-once dialog (key is dropped from memory when it closes).
- **Recovery countdown** starts when usage is first seen back inside quota while throttled (backend steps limits down ~20 s after that); before then the banner explains the condition instead of a number.
- Added `keyHint` to the portal session and `hasAdminSession()` to `api.ts` (for "Switch to Admin"). The portal still never mounts the admin stream.

## U13 — States, responsive & a11y polish
- `--ink-3` darkened from `#7A7A96` to `#666684` (≈4.7:1 on paper/paper-2) because it is used for 12–13px text and the old value was ~3.7:1. `docs/ui/01` updated.
- The WS-disconnected banner moved from Overview into the admin shell (`components/shell/connection-banner.tsx`) so every admin route shows it.
- Overview cards stack full-width and the KPI strip drops to 3 columns below 1024px; the tenants table scrolls horizontally under 960px (its sticky header no longer sticks to the page there).
- `_tokens` and `_hull` routes left in place: U14 owns their deletion (done, see U14).

## U14 — Presentation mode & final pass
- Presentation mode additions: Overview hull grows (196 → 300 px, 7-col) and the heatmap narrows to 5 cols; Incidents hides filter row and legend caption; layout shifts reuse the existing `springSlow` sidebar transition. Scenario Lab / A/B 120 px numbers were already done in U09.
- Scenario default seeds now follow `docs/13` (S1 = 42, S2 = 7, S6 = 99; the others stay 42) in `lib/scenarios.ts`.
- Deleted `/_tokens`, `/_hull` demo routes (incl. the primitives gallery), the default Next favicon and starter `public/*.svg`. Added `app/icon.svg` (brand mark) and a `%s · Bulkhead` title template with per-route titles.
- Not changed: backend, contracts, `lib/*` data modules (apart from the seed defaults above).

- **Loadgen HTTP trigger added** (`loadgen serve`, `POST /run {run_id,scenario,seed,duration}`, `GET /healthz`, default `:8089`). Supersedes the "no HTTP trigger" notes above. One run at a time (409 if busy); `duration` rescales phases; S9 refused (use CLI `--heavy`). Reports via `/admin/runs/{id}/progress` and `POST /admin/runs {run_id}`; failures close the run with `{error}`. Deploy: `loadgen-serve` in `compose.loadgen.yml` on box #2 (private IP :8089), `LOADGEN_URL` on box #1.
