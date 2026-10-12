# 09 — Simulation & Scenario Library

## Tenant cast
| Tenant | Tier | Behavior | Role |
|---|---|---|---|
| acme-shop | pro | steady 30 rps echo + light db-query | primary victim |
| data-co | enterprise | moderate db-query, periodic reports | DB victim / legit heavy |
| bursty-news | free | calm, then legit 10× flash crowd | **false-positive probe** |
| rogue-ml | free | abuser (varies per scenario) | culprit |
| leaky-app | pro | slowly leaking memory | OOM containment |

## Scenarios
| # | Name | Attack | Expected (ON) | Assertion |
|---|---|---|---|---|
| S1 | CPU Flood | rogue-ml 20 rps cpu-burn 2s | L2→L3 within ≤8s, victims p99 ≤ 1.5× baseline | inflation ≤1.5 |
| S2 | Memory Bomb | rogue-ml allocs 4GB | OOM kills only rogue container, restarts | victims 0 errors |
| S3 | DB Connection Hog | slow queries holding conns | rogue capped at its conns, data-co unaffected | data-co p99 ≤2× |
| S4 | Retry Storm | rogue retries every 429 w/o backoff | quarantine lane, queue protected | queue wait bounded |
| S5 | Slow Ramp | rogue ramps over 60s to evade thresholds | caught by victim-impact/predictor | detect before p99 > 2× |
| S6 | Legit Flash Crowd | bursty-news 10× for 20s, within limits | **not quarantined**, served via burst | FP count = 0 |
| S7 | Multi-abuser | 2 abusers simultaneous | both handled, victims protected | Jain ≥ 0.8 |
| S8 | Bandwidth Flood | large payloads | bucket enforced | other tenants' throughput stable |

## Determinism
Seeded PRNG drives arrival times, payload sizes, task mix. Scenario = JSON spec (phases, per-tenant arrival process: poisson/burst/ramp, task mix). Same `(scenario, seed)` → identical request schedule; compare runs by `runs` table.

## A/B protocol
1. Warm-up 20s (all tenants normal) to establish baselines.
2. Phase attack 60s.
3. Cool-down 30s (verify recovery).
Run OFF then ON with identical seed; record metrics per phase.

## Output
`summary jsonb`: per-tenant p50/p95/p99 per phase, inflation, Jain, time-to-detect, time-to-mitigate, FP count, utilization, rejected counts, abuser goodput.

## Load generator
Go binary on EC2 #2; open-loop (arrival-rate driven, avoids coordinated omission), per-tenant API keys, reports its own timings to avoid trusting server-side only.
