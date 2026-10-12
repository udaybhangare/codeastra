# UI 07 — Component catalog

Every component is custom (do not ship stock shadcn styling). Build on `@base-ui/react` primitives only for accessibility behaviour (dialog, popover, tooltip, tabs, select) and restyle fully with tokens. All live in `dashboard/src/components/`. Each component: typed props, loading/empty/error variants where applicable, motion per `02`, tokens per `01`.

## Primitives (`components/ui/`)
| Component | Spec |
|---|---|
| `Button` | Variants: `primary` (ultramarine fill, white text, hover `--grad-ultra`, magnetic optional), `secondary` (ink outline, paper fill), `soft` (ultra-100), `lime` (lime fill, lime-ink text), `ghost`, `danger` (bad). Sizes 36/44/56, pill radius, icon slot, loading spinner (three bouncing dots), springSnappy press. |
| `Card` | White, `--r-lg`, 1px line, `--shadow-1`; variants `flat`, `pop` (ink border + offset block shadow), `tinted` (status/brand tint), `glass` (landing). Optional header with title/eyebrow/actions. |
| `Badge`/`Chip` | Pill, 13 px label, optional dot/icon; tones ok/warn/bad/predict/brand/neutral/lime. |
| `Input`, `NumberField`, `Slider`, `Select`, `Segmented`, `Switch` | `--r-md`, paper-2 fill, ultramarine focus ring; Slider with chunky thumb + value bubble; Segmented has sliding pill; Switch is a pill with bouncing knob and ON/OFF text. |
| `Tooltip`, `Popover` | White, `--r-md`, `--shadow-2`, springSnappy scale-in, mono numbers. |
| `Dialog`, `Drawer` | `--r-xl`, scrim `rgba(20,20,43,.25)` blur 6 px, spring slide; drawer docks right, 480–560 px. |
| `Toast` | Bottom-centre stack, pill with tone icon, springBouncy in, auto-dismiss 4 s, progress hairline. |
| `Skeleton` | Paper-2 block with warm shimmer sweep; shapes match final content. |
| `EmptyState` | Small illustration (compartment/door motif, SVG), title, one-line help, primary action. |
| `ErrorState` | Raspberry-tinted card, icon, message, Retry button. |
| `Kbd` | Tiny mono key cap for shortcuts. |

## Domain components
| Component | Used in | Spec |
|---|---|---|
| `KpiTile` | Overview | White card, label (13 px caps), Metric XL mono value with ticker + unit, delta chip (▲▼ with tone), 60-point sparkline, status corner icon; hover reveals definition tooltip. Variants: `ring` (host CPU/mem dual ring), `badge` (isolation). |
| `CompartmentHeatmap` | Overview | Grid rows=tenants, cols=resources. Cell = rounded rect "tank": liquid fill rises from bottom with wave top edge, tint by ratio (<0.7 ok, 0.7–1 warn, >1 bad + overflow stripe); value in mono on hover/always in presentation; row header shows tenant colour dot + tier chip; trailing LadderBadge. Cell flash on change. Keyboard navigable. |
| `LatencyChart` | Overview, Portal, Predictor | Recharts restyled: no chart junk, rounded line caps, 2 px lines (victim 3 px, culprit dashed), ink-3 axis in mono 12 px, event markers as door icons, hover crosshair with a floating card; area fill 8% opacity only on single-series views. |
| `LadderBadge` | everywhere | Pill with a small door glyph whose opening angle reflects level 0–5, name text, tone colours; escalation bounce; level 5 hatched. Sizes sm/md/lg. |
| `LadderStepper` | Landing, Why drawer, PolicyEditor | 6 connected nodes; current node pulses; used as pin-level control (clickable) in PolicyEditor. |
| `DecisionDrawer` | Incidents, Overview, Audit | See `05` §2. Header with tenant colour band + level transition chip (from → to), sentence in Display H3, evidence chips, mini charts, raw JSON collapsible, actions list, actor, copy/export. |
| `IncidentTimeline` | Incidents | Swimlanes per tenant, pan/zoom via drag/wheel, door-icon nodes, dwell segments, now-line, hover cards, predicted hollow nodes. SVG, virtualised time axis. |
| `ScenarioCard` | Scenario Lab | Pop card; big emoji-free icon tile (custom SVG), name, attack summary, expected-outcome line, duration + seed chips, selected state expands. |
| `RunProgress` | Scenario Lab | Three-phase stepper with door metaphor, elapsed/total mono, animated fill; cancellable if API supports. |
| `AbCompare` | Scenario Lab | See `05` §3. Shared-axis charts, delta centre column, count-up numbers, winner ribbon, "Replay same seed". |
| `PolicyEditor` | Tenants | Drawer form; tier presets; sliders; pin level; reason required; diff preview chip row ("CPU 0.30 → 0.20"); save with optimistic toast. |
| `TenantTable` | Tenants | Rounded rows, sticky header, sort with layout animation, inline quota bars, row hover lift. |
| `ForecastChart` | Predictor | Actual vs forecast with confidence band, alert markers, lead-time bracket annotations. |
| `LeadTimeBars` | Predictor | Paired baseline vs ML horizontal bars with seconds labels. |
| `FeatureBars` | Predictor | Ordered rounded bars, ink-3 labels, ultramarine fill. |
| `UsageGauge` | Portal | Ring gauge 220 px: track paper-2, value arc status-coloured, quota tick, burst arc light, centre mono value + % + caption; animate on view. |
| `ThrottleBanner` | Portal | See `06` §2. |
| `ShowbackTable` | Portal | See `06` §5. |
| `ApiKeyPanel` | Portal | See `06` §6. |
| `ConnectionStatus` | Top bar | Pill: live dot (pulsing ok) + "Live · 1.0 Hz", amber "Reconnecting in 3s…", raspberry "Offline"; tooltip with last message age. |
| `IsolationSwitch` | Top bar, Landing | Large labelled pill switch ON/OFF with confirm (admin) or no-confirm (landing demo). |
| `Hull` | Landing, Overview, Portal | See `03`. |
| `FloatingSidebar`, `TopBar`, `PageFrame`, `PresentationToggle` | Shell | See `05` Shell. |
| `AdminLogin` | Auth | Pop card with API-key field, helper steps, error shake. |

## Data/utility modules to add (U-prompts create as needed)
`src/lib/motion.ts` (spring presets), `src/lib/hull.ts` (`toHullTenants`), `src/lib/colors.ts` (tenant colour hash, level tone map), `src/lib/format.ts` (number/duration/cost formatters, mono tabular).
