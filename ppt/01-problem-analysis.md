# 1. Problem Analysis

## The Problem
- Shared multi-tenant infra: **one tenant hogs CPU, memory, network or DB**
- Every other tenant suffers — latency spikes, errors, outages
- Known as the **noisy-neighbor problem**

## Why Current Fixes Fail
- Rate limits count **requests**, not **cost** (one request = 1 ms or 10 s CPU)
- Static quotas **waste idle capacity**
- Static limits can't **adapt** at runtime
- Blunt blocking punishes **legit spikes** (flash crowds)

## Attacks That Beat a Rate Limit
| Attack | Damage |
|---|---|
| 10 req/s of 5 s CPU jobs | CPU saturation |
| 5 req/s allocating 2 GB | Host OOM |
| Few requests holding DB connections | Pool starvation |
| Burst filling shared queue | Head-of-line blocking |
| Retry storm after 429s | Queue overload |
| Large payload flood | Bandwidth exhaustion |

## Core Challenge
- Strong isolation **and** high utilization — together
- Detect *harm*, not *busyness*
- Respond automatically, fast, and explainably

## Who Is Affected
- SaaS / PaaS / FaaS platforms
- Paying tenants with SLAs
- Platform operators (on-call, churn, cost)

## Convergence Tracks
- Cybersecurity — abuse as a threat model
- AI — overload prediction
- Web — ops dashboard + tenant portal
