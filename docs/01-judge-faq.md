# 01 — Judge FAQ (anticipated questions)

## Concept
**Q1. How is this different from a rate limiter?** A rate limiter counts requests; cost varies 1000×. We enforce on *resources*: kernel cgroups (CPU, memory, PIDs), a cost-aware fair scheduler, DB pool caps, bandwidth buckets. Table in doc 05 shows attacks that pass a rate limit and still hurt neighbors.

**Q2. What counts as "isolation" here and what doesn't?** Strong: CPU, memory, PIDs, queue, DB connections. Application-layer: bandwidth (simulated; `tc` documented as next step). Not covered: kernel exploits, side channels, disk I/O (doc 05 threat model).

**Q3. Is the isolation real or simulated?** Hybrid, by design: real Docker containers with real cgroup v2 limits and real Postgres contention; bandwidth is app-layer. `docker stats` can be shown live.

## Detection & control
**Q4. How do you avoid punishing legitimate spikes?** Detector requires *victim impact* plus attribution by excess-over-entitlement and correlation. Flash-crowd scenario S6 asserts zero throttling; within-reservation tenants have zero excess.

**Q5. What if the abuser ramps slowly to stay under thresholds?** Detection is relative to victim degradation and the tenant's entitlement share, not absolute thresholds; S5 tests it; predictor adds trend-based early warning.

**Q6. Can the controller oscillate?** Hysteresis, min dwell per level, cool-down, AIMD recovery, re-offense escalation. Flapping counted in A/B summary.

**Q7. How fast do you react?** Target detect ≤ 3 windows (≈3s), mitigate ≤ ~8s; measured and shown per run.

**Q8. Why not ML for control?** Unexplainable and risky; ML only forecasts and is advisory. Ladder is deterministic and auditable.

## AI
**Q9. Is the ML real or hype?** Baseline Holt+z-score is the shipped default; the GBM challenger is trained on seeded simulated traces, evaluated on held-out *scenarios*, compared by lead-time. We state it's simulated-data accuracy.

**Q10. What happens if the predictor is down or wrong?** Fallback to reactive detection; predictions never block the hot path; bad predictions only cause earlier Observe/Soft steps, which are reversible.

## Fairness & efficiency
**Q11. Does isolation waste capacity?** Reservation + burst, work-conserving DRR; we publish utilization ON vs OFF.

**Q12. What's your fairness definition?** Weighted max-min via DRR; reported with Jain's index on share/entitlement and victim p99 inflation.

## Security
**Q13. How is tenant identity enforced?** Hashed API keys → short-lived JWT; tenant_id only from verified claims; per-tenant containers/DB app names; cross-tenant access tests; admin API separate role + audit log.

**Q14. Can a tenant escape its container?** Out of scope for noisy-neighbor; production would add gVisor/Firecracker (doc 15). Containers run non-root, no extra caps, read-only rootfs, pids limit.

## Scale & ops
**Q15. Does it scale beyond one host?** Prototype is single-host; designed boundaries: Redis-shared buckets, stateless gateway, placement controller; K8s mapping in doc 15.

**Q16. Is the demo reproducible?** Seeded, open-loop load generator; same seed → same schedule; results stored in `runs`.

**Q17. What if the demo environment fails?** Local compose, recorded video, recorded-results mode.

**Q18. How is usage billed?** Cost units from a documented cost model; showback view with demo $ rates; not a system of record.

**Q19. What are the known limitations?** Single host, simulated bandwidth, simulated-data ML, simple cost model — all listed in docs 05/07/15.

**Q20. What did you test?** Unit tests (DRR fairness, token bucket, ladder state machine, detector on synthetic traces), integration (scenarios S1–S8 assertions), chaos (container kill, Redis down) — prompt 19.
