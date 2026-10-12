# 5. Supporting Information

## Demo Scenarios
| # | Scenario | Expected (ON) |
|---|---|---|
| S1 | CPU Flood | Hard throttle ≤ 8 s, victims ≤ 1.5× |
| S2 | Memory Bomb | Only rogue container OOM-killed |
| S3 | DB Connection Hog | Rogue capped, victim ≤ 2× |
| S4 | Retry Storm | Quarantine lane, queue bounded |
| S5 | Slow Ramp | Caught before p99 > 2× |
| S6 | Flash Crowd | **Not** throttled (0 FP) |
| S7 | Multi-abuser | Both handled, Jain ≥ 0.8 |
| S8 | Bandwidth Flood | Others' throughput stable |

## Test Tenants
- acme-shop (victim) · data-co (DB victim) · bursty-news (FP probe)
- rogue-ml (abuser) · leaky-app (memory leak)

## Demo Flow (~5 min)
1. Problem → 2. Tour → 3. OFF (victims collapse) → 4. ON (flat) → 5. Flash crowd → 6. Memory bomb → 7. Prediction + showback → 8. A/B table

## Evaluation Metrics
- Victim p50/p95/p99 inflation
- Time-to-detect / time-to-mitigate
- False-positive count
- Jain's fairness index
- Utilization ON vs OFF
- Predictor lead time

## Security Controls
- Hashed API keys → 15-min JWT
- `tenant_id` only from verified claims
- Separate admin credential + audit log
- Non-root, read-only rootfs, pids limit

## Honest Limitations
- Single host (prototype)
- Bandwidth isolation simulated at app layer
- ML trained on simulated data
- No kernel-escape / side-channel defense

## Reproducibility
- Seeded open-loop load generator
- Same seed → identical schedule
- Fallback: recorded results + video

## Repo Layout
`platform/` · `worker/` · `predictor/` · `loadgen/` · `dashboard/` · `deploy/` · `contracts/` · `docs/`
