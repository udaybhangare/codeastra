# Slides, video shot-list, judge cards

Numbers below come from `docs/RESULTS.md` (one laptop, loadgen co-located, S1 seeds 101–105). Quote them with that caveat.

## Deck (6 slides, ~5 min)
| # | Title | Show | Say (one line) |
|---|---|---|---|
| 1 | The problem | 5 tenants on one host, one goes wild; p99 chart exploding | "Shared infra, one bad neighbour, everyone suffers. Rate limits count requests, but a request can cost 1000×." |
| 2 | Why rate limits fail | table from `docs/05` (attack → passes rate limit → who is hurt) | "Cost, memory, DB connections and queue depth are not in a request count." |
| 3 | Architecture | diagram from `docs/02` (data / control / management plane) | "Real containers on cgroup v2, a cost-aware DRR scheduler, a 1 s control loop that explains every action." |
| 4 | Closed loop | ladder Observe → Soft → Hard → Quarantine, with the Why drawer | "We punish harm, not busyness; every automated action ships with its evidence." |
| 5 | Results | A/B big-number screen: victim p99 inflation OFF ≈ 19,800× vs ON ≈ 0.97×; abuser goodput 10.8 → 0.07 rps; S6 false positives 0 | "Same seed, same schedule, isolation OFF vs ON." |
| 6 | Limits & next | single host, simulated bandwidth, simulated-data ML, detect/mitigate timing not demonstrated (RESULTS §3) | "Here is what we did not prove, and the plan (`docs/15`)." |

## 3-minute video shot-list
| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:15 | Title + 5 tenants on Overview, heatmap calm | problem statement |
| 0:15–0:40 | Scenarios → S1 seed 42, Isolation OFF, run | "no protection": victim p99 climbs, heatmap red |
| 0:40–1:30 | Same seed, Isolation ON, Presentation mode | victims flat; ladder animates; open Why drawer |
| 1:30–1:55 | S6 flash crowd | bursty-news spikes 10× and is not throttled |
| 1:55–2:15 | terminal `docker stats` during S2 | real cgroup limits, only the rogue container restarts |
| 2:15–2:40 | Tenant portal: showback + throttle explanation; predictor card | business view |
| 2:40–3:00 | A/B big-number table + limitations slide | one honest limitation, one next step |

Record at 1080p with Presentation mode on; capture S1 OFF and ON takes separately so they can be cut together.

## Judge Q&A cards (print double-sided; full text in `docs/01-judge-faq.md`)
| Card | Question | 20-second answer | Evidence |
|---|---|---|---|
| 1 | vs a rate limiter? (Q1) | We meter resources: cgroups, cost-aware DRR, DB pool caps. | S1 A/B ×5 |
| 2 | Real or simulated? (Q3) | Real containers + cgroup v2 + real Postgres; bandwidth is app-layer. | `docker stats` live |
| 3 | Legit spikes punished? (Q4) | Needs victim impact plus excess over entitlement; S6 asserts zero. | S6: 0 false positives (1 seed) |
| 4 | Oscillation? (Q6) | Hysteresis, min dwell, AIMD recovery. | ladder unit tests; live ladder stayed ≤ L1 in S1 |
| 5 | How fast? (Q7) | Honest: containment is immediate from static caps; detect ≤ 3 s / mitigate ≤ 8 s is **not demonstrated**. | RESULTS §3, §4b |
| 6 | Is the ML real? (Q9/Q10) | Holt+z-score baseline by default; GBM trained on simulated traces; advisory only, fallback verified. | chaos C3 |
| 7 | Wasted capacity? (Q11) | Work-conserving DRR, reservation + burst. **Utilization not measured.** | RESULTS §6 |
| 8 | Tenant identity? (Q13) | Hashed key → short-lived JWT, tenant only from claims, admin role separate. | `security.sh` 21/21 |
| 9 | Beyond one host? (Q15) | Single host today; boundaries and K8s mapping in docs/15. | not tested |
| 10 | Is it reproducible? (Q16) | Seeded open-loop loadgen; same seed → same schedule hash. | hash in every report |
| 11 | Demo fails? (Q17) | Recorded-results mode, works offline. | `demo/recorded/load.py` |
| 12 | What did you test? (Q20) | Unit, 21 security checks, 12 chaos checks, S1/S2/S3/S6 integration. | `docs/RESULTS.md` |

## Presenter checklist
1. `make demo` (≈1 min when the stack is already up). 2. Open dashboard, toggle Presentation. 3. Order: S1 OFF → S1 ON → S6 → S2. 4. Stalled? Scenarios → **Load recorded** or `python3 demo/recorded/load.py` in a terminal.
