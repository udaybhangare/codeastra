# 06 — Noisy-Neighbor Detector & Adaptive Throttle

## Principle
Do not punish "busy". Punish **causing harm**. Detection = (1) someone is hurt, (2) someone's consumption explains it.

## Step 1 — Victim detection (every 1s)
For each tenant `t` maintain baseline `b_t` = EWMA of p95 latency & queue-wait over calm windows (frozen while degraded). Tenant is a **victim** if, for ≥ N consecutive windows (default 3):
`p99_t > k·b_t` (k=2.5) **or** queue_wait_t > threshold **and** t is within its own quota (so self-inflicted overload isn't a "victim").

## Step 2 — Culprit attribution
For each candidate `c` ≠ victim:
- `excess_c = max(0, share_c − entitlement_c)` where share = usage / host capacity per resource (CPU, DB, queue slots, bytes), entitlement = reservation weight share.
- `corr_c` = Pearson correlation over the last 30 windows between `c`'s resource usage and victim latency (lagged ≤ 2s).
- `score_c = Σ_resource wr · excess_c,r · max(0, corr_c,r)`.
Culprit = argmax `score_c` above threshold τ. Output includes **evidence**: resources, shares, correlation, victim list, p99 inflation.
- Legit flash crowd: high usage but no victim → no score. Within-reservation heavy tenants → excess 0.

## Step 3 — Throttle ladder (per culprit, state machine)
| Level | Name | Action | Enter when | Exit when |
|---|---|---|---|---|
| 0 | Normal | none | — | — |
| 1 | Observe | flag + log, no action | score > τ₁ once | score < τ₁ for 5s |
| 2 | Soft | DRR weight × 0.5, rate bucket × 0.7, burst disabled | score > τ₂ sustained 3s | calm 10s |
| 3 | Hard | `docker update` cgroup cpu quota × 0.4 (floor = reservation×0.5), DB conns ↓ | harm persists 5s at L2 | calm 15s |
| 4 | Quarantine | move to quarantine lane, tiny weight, concurrency 1–2 | harm persists 8s at L3 or OOM/limit-breach loops | calm 30s |

## Recovery (AIMD)
Additive increase of limits per calm tick (+10% of gap), multiplicative decrease when re-offending (×0.5). Hysteresis: min dwell time 5s per level; cooldown to prevent flapping. Re-offense within 60s skips directly one level up.

## Predictive path
Predictor sidecar returns `p_overload(t+5..15s)` per tenant and resource. A high-probability forecast can **pre-emptively** enter Level 1→2 earlier ("predictive throttle"), recorded as `reason=PREDICTED`. Disabled → pure reactive.

## Explainability
Every transition writes `throttle_events` with: from/to level, reason, evidence JSON (victims, p99 before/now, culprit shares, correlation, thresholds crossed, predictor score), the exact actions applied. Dashboard shows a plain-English sentence: *"rogue-ml throttled to Hard: used 71% CPU vs 20% entitlement; acme-shop p99 rose 6.2× (r=0.91)."*

## Safety rails
- Never throttle below minimum (reservation×0.25) except Quarantine.
- Max simultaneous culprits limited; global "panic" action = shed free-tier first.
- Manual override via admin API (pin/unpin level), all audited.
