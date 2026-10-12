# 13 — Demo Script & Pitch (≈5 min)

## Narrative arc
1. **Problem (30s):** "Shared infra. One tenant goes wild, everyone suffers. Rate limits don't fix it because requests aren't equal."
2. **Platform tour (45s):** dashboard overview; five tenants; heatmap calm; show tenant identity (JWT claims) and per-tenant containers.
3. **Without protection (60s):** toggle **Isolation OFF**, run S1 CPU Flood seed 42. acme-shop p99 goes from ~40ms to seconds; Jain's index drops; heatmap red.
4. **With protection (90s):** toggle **ON**, same seed. Heatmap flags rogue-ml; ladder animates Observe→Soft→Hard; victims stay flat; open the **Why drawer**: evidence + plain English.
5. **Not just punishing (30s):** run S6 Flash Crowd: bursty-news spikes 10× and is **not** throttled — false-positive control.
6. **Memory bomb (20s):** S2: rogue container OOM-killed, restarts; others unaffected (real cgroups, `docker stats` side panel).
7. **Prediction + business view (40s):** predictor forecast 6s ahead of degradation; tenant portal showback and throttle explanation.
8. **Close (15s):** A/B result table + "what this costs us in utilization: X%".

## Presenter cheat-sheet
- Seeds: S1=42, S2=7, S6=99. Pre-warm containers 2 min before.
- If live run stalls: click **Load recorded results**.
- Keep terminal with `docker stats` ready (judges love kernel proof).

## Roles during demo
Driver (clicks), Narrator (talks), Wingman (watches AWS/logs, has video fallback).

## Slides (max 6)
Problem · Why rate-limits fail (table from doc 05) · Architecture (diagram doc 02) · Closed-loop control (ladder) · Results (A/B numbers) · Limits & next steps.

## One-liners for judges
"Rate limits count requests; we meter *cost*." · "We punish harm, not busyness." · "Every automated action ships with its evidence." · "Isolation that wastes nothing: reserved + burstable."
