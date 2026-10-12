# 05 — Isolation Model (the heart of the answer)

## Rate limit ≠ isolation: the argument
| Attack | Passes a request-rate limit? | Hurts neighbors? | What actually stops it |
|---|---|---|---|
| 10 req/s of 5s CPU jobs | Yes | Yes — 50 cores-seconds/s | cpu cgroup quota + cost bucket |
| 5 req/s allocating 2GB each | Yes | Yes — host OOM | memory cgroup limit, OOM contained to tenant |
| Few requests holding DB connections open | Yes | Yes — pool starvation | per-tenant DB conn cap + statement_timeout |
| Burst that fills shared queue | Partially | Yes — head-of-line blocking | per-tenant queues + DRR + depth cap |
| Large payload flood | Yes | Yes — bandwidth | bandwidth bucket |
| Retry storm after 429s | Re-enters limit | Yes | backoff signals, quarantine lane, circuit |

## Resource-by-resource enforcement
| Resource | Mechanism | Layer | Real or simulated |
|---|---|---|---|
| CPU | cgroup v2 `cpu.max` + `cpu.weight`; DRR cost share | kernel + scheduler | **Real** |
| Memory | cgroup `memory.max`, swap off, OOM kill scoped to container | kernel | **Real** |
| PIDs/fork bombs | `pids.max` | kernel | **Real** |
| DB | per-tenant pool semaphore, statement_timeout, app name | platform | **Real** (real Postgres) |
| Queue/scheduler | per-tenant queues, DRR, depth cap, quarantine lane | platform | **Real** |
| Network | per-tenant bandwidth token bucket (+ optional `tc` stretch) | platform | **Simulated at app layer** (stated honestly) |

## Guarantees we claim (and test)
1. **Containment:** a tenant cannot use more than its hard limit on CPU/memory regardless of request count.
2. **Minimum share:** under contention each tenant receives ≥ its reserved weight share.
3. **Work conservation:** idle capacity is usable by anyone (no waste), bounded by hard limits.
4. **Blast radius:** OOM/crash/hang is confined to one tenant container.
5. **Bounded harm time:** victim degradation is detected and mitigated within a target of ≤ ~5–10 s.

## Threat model
- *In scope:* noisy (accidentally or deliberately abusive) tenants consuming shared resources; retry storms; slow-ramp abuse; one tenant probing another's data via API.
- *Security controls:* API-key hashing (argon2/bcrypt), short-lived JWT, tenant_id taken **only** from verified claims (never from request body), per-tenant namespaces for worker containers and DB application name, admin API separate credential/role, audit log of admin actions.
- *Out of scope (documented):* kernel escapes, side-channel (cache/Spectre), noisy disk I/O at hypervisor level — mitigated in production by gVisor/Firecracker and dedicated tenancy (doc 15).

## Isolation vs utilization
Static partitions waste capacity. Bulkhead: *reservation + burst*. A tenant may exceed its reservation up to its hard limit when capacity is idle; when contention appears (victim impact detected), burst is clawed back first. We report utilization with and without isolation so the cost is honest.

## OFF mode semantics (for the A/B)
Single global FIFO, no per-tenant caps, containers unlimited, detector disabled. Same workload seed replayed.
