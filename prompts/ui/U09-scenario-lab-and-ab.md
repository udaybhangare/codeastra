# U09 — Scenario Lab & A/B compare

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/05 §3, docs/ui/07 (ScenarioCard, RunProgress, AbCompare), `src/lib/scenarios.ts`, `runs.ts`, `lab.ts`, `public/recorded/`, existing `components/lab/*`, `docs/09-simulation-scenarios.md`.

## Goal
Make the Scenario Lab the demo centrepiece: pick, run, watch, compare.

## Build
- `ScenarioPicker` (pop `ScenarioCard`s with custom SVG icons, expand-on-select), sticky `RunPanel` (seed + dice, duration, OFF/ON/A-B, magnetic Run), `RunProgress` (door-style 3-phase stepper), `AbCompare` (shared-axis charts, centre delta column, count-up numbers, winner ribbon, Replay same seed, Load recorded results), confetti once on ON-wins.
- Presentation-mode variant: only numbers + two charts, 120 px display numbers.
- Keep existing run/API logic from `lab.ts`/`runs.ts`; only the UI changes.

## Acceptance
- `tsc --noEmit` + eslint touched files; "Load recorded results" renders A/B without a backend.
- ACTION NEEDED FROM YOU: `pnpm dev`, `/scenarios`; select a card, click "Load recorded results"; confirm A/B reveal animation and big numbers; press `P` for presentation view.

## Do NOT
Run real scenarios/load from the agent (prompt 19 owns that); change scenario definitions.
