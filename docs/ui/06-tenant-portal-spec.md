# UI 06 — Tenant portal spec (`/portal`)

Persona: tenant developer. Same design system, friendlier tone: softer copy, bigger gauges, fewer jargon words (explain terms in tooltips), more tangerine/lime warmth than the admin console. Data from `src/lib/portal.ts`, `use-poll.ts`, `api.ts` (tenant-scoped REST).

## Shell
Lighter than admin: top pill nav (Overview · Usage · Showback · API keys), tenant name + tier chip, "Switch to Admin" link only if admin session exists. No floating sidebar. Greeting: "Hi, {tenant}. Here's how your compartment is doing."

## Sections (single scrolling page with anchors, bento)
1. **Your compartment hero:** mini hull (`mode="portal"`, `highlightId` = tenant) left; right: big status sentence ("All calm — you're using 34% of your plan" / "You're slowed down a little because…"), level badge, plan tier chip, time to recovery if throttled.
2. **Throttle status banner** (conditional, springBouncy entrance): colour by tone; headline, plain-English cause using `evidence.ts`, "Expected recovery in ~20 s" countdown, "What you can do" bullets (reduce heavy jobs, spread requests, upgrade plan), link to details.
3. **Usage vs quota gauges:** 4 big ring gauges (CPU, Memory, DB connections, Bandwidth) + requests; animated fill, quota tick, burst zone shown as lighter arc, centre mono value.
4. **History:** request rate + latency (p50/p95/p99) area/line charts, 10-min window, range chips (5m/10m/1h if API allows), tooltip with exact numbers.
5. **Showback table:** cost units → demo $ using demo rates; rows by resource (CPU, DB, bandwidth, memory), sparkline per row, total pill with count-up, note "demo rates, not a real invoice".
6. **API keys:** key list (masked, created, last used), **Rotate** (confirm modal, reveal-once new key with copy button and lime "copied" state), safety hint.

## States
Loading skeletons per card; empty history ("No traffic yet — send your first request" + curl snippet with copy); error toasts; throttled and quarantined get distinct, calm (non-punitive) language.

## Motion
Gauges animate from 0 once on view; banner pops in; cards stagger; hull compartment of the tenant gently pulses; reduced motion disables pulses.
