# 08 — Frontend & UX Spec

Stack: Next.js (App Router) + TS + Tailwind + shadcn/ui + Recharts; data via REST + one WebSocket (`/admin/stream`). Dark theme, ops-console feel. Goal: a judge understands the story in 30 seconds without narration.

## Personas
1. **Platform operator** (Admin Console) — sees fleet health, who is hurting whom, what the system did.
2. **Tenant developer** (Tenant Portal) — sees own usage, why throttled, costs.
3. **Judge/demo driver** — one-click scenarios and A/B.

## Admin Console screens
1. **Overview (command center):** top KPI strip — isolation mode badge, host CPU/mem, Jain's index, victim p99 inflation, active throttles. Below: tenant×resource **heatmap** (CPU, mem, DB, queue, bandwidth) coloured vs entitlement; live p99 line chart per tenant (victims highlighted); ladder-state chips per tenant.
2. **Incident timeline:** horizontal timeline of ladder transitions with annotated evidence; click → "Why?" drawer (plain English + evidence JSON + metric snapshots).
3. **Scenario Lab:** scenario cards (name, what it attacks, expected outcome), seed input, duration, **Run**. Live progress, then **A/B Compare**: OFF vs ON side-by-side p99 charts, inflation ratio, Jain's, detect/mitigate times, false positives, utilization; "Replay with same seed".
4. **Tenants & Policies:** table + editor (quotas live-editable, tier presets), pin-level controls (audited).
5. **Predictor:** forecast vs actual overlay, baseline vs ML alert lead-time chart, feature-importance bars.
6. **Audit & Decisions log:** filterable stream.

## Tenant Portal screens
Usage vs quota gauges; request/latency history; **throttle status banner** with explanation ("You're at Soft throttle because…, expected recovery in ~20s"); showback table (cost units → $ using demo rates); API key management (rotate).

## UX principles
- Everything animates from the live stream; no manual refresh.
- Colour language: green = healthy, amber = contended/observe, red = throttled/quarantined, blue = predicted. Colour-blind safe palette + icons.
- Every automated action is one click from its explanation.
- Empty/loading/error states designed; WS reconnect indicator.
- "Presentation mode": large fonts, hides config, big A/B numbers.

## Component inventory
KpiTile, TenantHeatmap, LatencyChart, LadderBadge, DecisionDrawer, ScenarioCard, AbCompare, PolicyEditor, ForecastChart, UsageGauge, ShowbackTable, ConnectionStatus.
