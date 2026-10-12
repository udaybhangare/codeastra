# UI 05 — Admin console spec

Persona: platform operator / demo driver. Routes: `/overview`, `/incidents`, `/scenarios`, `/tenants`, `/predictor`, `/audit`. (Today the overview lives at `/`; the landing page takes `/` and the overview moves to `/overview`, see U04/U06.) Data comes from the existing `useStream` store (WS snapshot/event/run messages) and REST clients in `src/lib/api.ts`. Components: `07-component-catalog.md`.

## Shell
- **Floating rounded sidebar** (detached 16 px from edges, `--r-xl`, white, `--shadow-3`): logo; nav items with icon + label (Overview, Incidents, Scenario Lab, Tenants, Predictor, Audit); active item has a ultramarine pill that slides between items (`layoutId`); bottom: Presentation toggle, "Tenant Portal" link, admin identity chip + sign-out. Collapses to icon rail ≤ 1280 px or in presentation mode.
- **Top bar (transparent over paper):** page title (display H2) + breadcrumb crumb, **Isolation badge** (big pill toggle ON/OFF with lime/tangerine states; changing it asks confirm with spring modal and writes an audit event), **ConnectionStatus** (live dot, latency, reconnect state), clock of last snapshot.
- **Page frame:** max-width fluid, 24 px gutters, header row (title, subtitle, actions), content bento grid (12 cols, 24 px gap).
- Page transitions per `02-motion-system.md`.
- Auth: unsigned-in state shows a redesigned `admin-login` card (centred, pop style, hull mini illustration).

## 1. Overview (command center) — hero: the compartment heatmap + mini hull
Bento layout (1280×720 target, no scroll for the essentials):
1. **KPI strip (top, 5 tiles):** Isolation mode, Host CPU/Mem (dual ring), Jain's index, Victim p99 inflation, Active throttles. Number tickers, tiny sparklines (last 60 s), status-coloured corner icon.
2. **Mini 3D hull (top-left, 5 cols):** live from snapshot (`mode="mini"`); hover tooltip; click filters the page to that tenant.
3. **Compartment heatmap (right, 7 cols):** tenants (rows) × resources (CPU, Mem, DB, Queue, Bandwidth) as rounded "water-level" cells filling bottom-up vs entitlement (`ENTITLEMENT` in `ladder.ts`); >100% shows overflow stripe; each row ends with a LadderBadge.
4. **Latency chart (bottom-left, 8 cols):** p99 per tenant, 10-min window, victims thick, culprit dashed with flag marker at throttle events (Recharts, restyled).
5. **Active throttles + live feed (bottom-right, 4 cols):** list of tenants at level ≥ 1 with time-in-level and a "Why?" button; below, the last 5 events auto-scrolling.
Empty state: "All compartments calm" lime illustration. Error/disconnected: banner with reconnect countdown.

## 2. Incidents
- **Hero: horizontal timeline** (pannable/zoomable) of ladder transitions: one swimlane per tenant, door-icon nodes coloured by level, connecting segments sized by dwell time; predicted events shown as ultramarine hollow nodes.
- Filters: tenant, level, kind (throttle/predict/oom/isolation/admin), time range chips.
- Below: incidents list (cards grouped by incident/culprit); selecting opens the **DecisionDrawer** ("Why?"): plain-English sentence on top, evidence key-values as metric chips, before/after mini charts, raw JSON collapsible, actions taken, actor. Escalation/de-escalation shown as animated stepper. Export button (existing `export.ts`).

## 3. Scenario Lab
- **Scenario picker:** carousel/grid of ScenarioCards (S1…S10 from `scenarios.ts`): icon, what it attacks, expected outcome, difficulty/duration chips; selected card expands (layoutId).
- **Run panel (sticky right):** seed input (dice button to randomise), duration, isolation ON/OFF/"A/B both", big magnetic **Run** button; live progress as a hull-door-style stepper (warmup → attack → cooldown) with elapsed timer.
- **A/B Compare (after run, hero):** two-column OFF vs ON; shared-axis p99 charts, a centre "delta" column with huge numbers (inflation ratio, Jain's, detect time, mitigate time, false positives, utilization cost); winner ribbon; "Replay same seed" and "Load recorded results" (existing recorded data in `public/recorded`) buttons. Count-up animation on first reveal; lime confetti once if ON wins.
- Presentation mode: only A/B numbers + two charts, 120 px numbers.

## 4. Tenants & Policies
- Table (rounded rows, sticky header): tenant avatar/colour, tier chip, level badge, rps, p99, cpu share, quota usage bar. Row click → side **PolicyEditor** drawer.
- PolicyEditor: tier preset segmented control, sliders with numeric inputs for quotas (live-edit with debounce), pin-level control (segmented ladder) with required reason field; "Audited" indicator and toast after save; revert chip.
- Create-tenant action only if API supports; otherwise hide.

## 5. Predictor
- **Hero: forecast vs actual** overlay (actual solid, forecast ultramarine dashed band, alert markers), tenant selector chips + Host.
- Baseline vs ML alert **lead-time** comparison (paired horizontal bars with seconds), false-alarm counters.
- Feature-importance bars (rounded, ordered). Model status chip (Holt baseline / ML challenger, up/down).
- Empty: "Predictor sidecar offline — detector falls back to its own baseline" friendly state.

## 6. Audit & Decisions log
- Filter bar (search, kind, tenant, actor, date), live-tail toggle (new rows slide in at top with highlight).
- Rows: time (mono), kind icon, tenant colour dot, sentence, actor chip; expand row for evidence JSON; "Open in Incidents" link; CSV/JSON export.
- Virtualise beyond 200 rows.

## Cross-cutting
- Every screen: designed skeleton, empty, error states (see catalog).
- Min viewport 1280×720; works to 1024 with collapsed sidebar.
- Keyboard: `P` presentation, `[` collapse sidebar, `g` then `o/i/s/t/p/a` to navigate (simple, no command palette).
