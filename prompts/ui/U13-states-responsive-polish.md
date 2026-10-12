# U13 — States, responsive & accessibility polish

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/00 (principles), docs/ui/01 (contrast), docs/ui/07 (EmptyState/ErrorState/Skeleton).

## Goal
Make every screen feel finished: designed loading/empty/error/disconnected states, 1280×720 fit, AA contrast, consistent motion.

## Build
- Audit each route (`/`, `/overview`, `/incidents`, `/scenarios`, `/tenants`, `/predictor`, `/audit`, `/portal`) for: skeleton, empty, error, WS-disconnected banner; add missing ones.
- Fix overflow at 1280×720 and ≤1024 (collapsed sidebar); landing mobile layout per docs/ui/04.
- Contrast check on `--ink-3` usage; focus-visible on all controls; `aria-label`s on icon buttons; status never colour-only.
- Remove leftover legacy components/styles and the throwaway `_tokens`/`_hull` routes **only if** U14 will not need them (otherwise leave for U14).
- Run `pnpm exec tsc --noEmit`, `pnpm exec eslint src`, and **one** `pnpm build`.

## Acceptance
- tsc, eslint, build pass (report counts, not logs).
- ACTION NEEDED FROM YOU: resize the browser to 1280×720 and walk each route; list anything clipped.

## Do NOT
Add features; run Lighthouse/Playwright unless the user asks.
