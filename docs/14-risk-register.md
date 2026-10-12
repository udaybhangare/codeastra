# 14 — Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Fallback |
|---|---|---|---|---|---|
| R1 | Docker cgroup `update` behaves differently on host (cgroup v1/rootless) | M | H | Verify on EC2 hour 1 with spike script | use `cpus` set at create + restart-on-change |
| R2 | Measurement noise (our own services steal CPU) | H | M | loadgen separate host, reserve host core, 3 repeated runs, report medians | show variance honestly |
| R3 | Detector flaps / false positives | M | H | hysteresis, min dwell, victim-impact gating, S6 test | manual pin level |
| R4 | ML challenger eats time | H | L | feature-flagged stretch after hour 18 | baseline only |
| R5 | Integration across 4 tracks late | H | H | contracts frozen hour 2, mock stream, integration freeze hour 14–18 | cut stretch scope |
| R6 | AWS/venue network failure | M | H | local compose profile, video, recorded results | present from laptop |
| R7 | OOM takes down host instead of container | L | H | set `memory.max` + host swap off + reserve headroom, test early (S2) | smaller allocations |
| R8 | A/B not convincing (OFF not bad enough) | M | H | calibrate attack intensity to host size in hour 10; tune cpu-burn duration | scale rps |
| R9 | Scope creep | H | M | MVP list (doc 12), freeze hour 21 | — |
| R10 | Judges challenge "simulated" network isolation | M | M | state it plainly (doc 05), show `tc` as stretch/future | — |
| R11 | Secrets leaked in repo | L | H | `.env` gitignored, rotate demo keys | — |
