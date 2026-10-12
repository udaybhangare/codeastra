# UI redesign prompts (U01–U14) — "Paper & Ultramarine"

Run **one at a time, in order**, from the repo root. These replace the visual layer of prompts 15–17 and 20 (UI parts). The data layer (`dashboard/src/lib/*`) and backend stay.

**Start every session with:** "Read prompts/_RULES.md, docs/ui/00-vision-and-principles.md, docs/ui/01-design-tokens.md, and the docs listed in the prompt. Then execute prompts/ui/UXX-....md."

## Order & dependencies
| # | File | Builds | Needs |
|---|---|---|---|
| U01 | U01-foundation-tokens-fonts | deps, fonts, tokens, global CSS | — |
| U02 | U02-motion-kit-and-primitives | motion presets, primitives | U01 |
| U03 | U03-hull-3d-core | R3F hull component + selector | U01, U02 |
| U04 | U04-landing-hero-and-scroll-shell | `/` hero, Lenis, nav, route move | U03 |
| U05 | U05-landing-story-sections | GSAP story, results, CTA | U04 |
| U06 | U06-admin-shell | floating sidebar, top bar, presentation mode | U02 |
| U07 | U07-overview | KPI, heatmap, chart, mini hull | U03, U06 |
| U08 | U08-incidents-and-why-drawer | timeline, drawer | U06 |
| U09 | U09-scenario-lab-and-ab | picker, run, A/B | U06 |
| U10 | U10-tenants-and-policy-editor | table, editor | U06 |
| U11 | U11-predictor-and-audit | forecast, audit log | U06 |
| U12 | U12-tenant-portal | portal | U03, U02 |
| U13 | U13-states-responsive-polish | empty/loading/error, 1280×720, a11y | U07–U12 |
| U14 | U14-presentation-mode-and-final-pass | demo mode, cohesion | all |

Parallel option: after U02, U03 (3D) and U06 (shell) are independent.

## Rules specific to UI prompts
- Follow `prompts/_RULES.md` (cheap verification: `tsc --noEmit`, `eslint` on touched files, one `next build` at the end of U13/U14 only). No screenshots/Playwright by the agent.
- **Visual checks are done by the human.** End each prompt with an **ACTION NEEDED FROM YOU** block: `! cd dashboard && pnpm dev`, open `http://localhost:3000/<route>`, and a 3–5 item "what you should see" checklist.
- Use `pnpm` (repo has `pnpm-lock.yaml`). Keep `NEXT_PUBLIC_WS_URL` unset to run on the mock stream.
- Keep data modules in `dashboard/src/lib/` intact; add new ones only as listed in `docs/ui/07-component-catalog.md`.
- No dark mode, no old theme colours, no stock shadcn look. Old components not yet replaced may remain until their prompt rewrites them; delete a legacy component only in the prompt that replaces it.
- Log unavoidable deviations in `docs/DEVIATIONS.md`.
- Stay in scope; never start the next prompt.
