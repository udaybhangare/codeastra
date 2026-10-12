# U01 — Foundation: dependencies, fonts, tokens, global CSS

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/00, docs/ui/01.

## Goal
Replace the dark theme with the bright "Paper & Ultramarine" foundation. After this prompt every existing page renders on a warm paper canvas with the new fonts (old components may look rough; they get rebuilt later).

## Build
- Add deps with pnpm in `dashboard/`: `motion`, `gsap`, `lenis`, `three`, `@react-three/fiber`, `@react-three/drei`, `maath`. (Do not remove recharts, zustand, lucide-react, @base-ui/react.) Pin versions compatible with React 19.3 / Next 16.4; if an R3F peer-dep conflict appears, use the newest R3F v9 line and note it in DEVIATIONS.
- `src/app/layout.tsx`: load Bricolage Grotesque, Instrument Sans, Geist Mono via `next/font/google` as `--font-display`, `--font-body`, `--font-mono`; remove the `dark` class; set `<body>` to paper background; keep `<AppShell>`.
- `src/app/globals.css`: define every token from docs/ui/01 as CSS variables on `:root`, map into the Tailwind v4 `@theme` block (colours, radii, shadows, fonts); base styles (body font, headings use display font, tabular numerals utility `.num`), focus ring, selection colour (lime), paper-grain overlay (SVG, 3%), reduced-motion media rule, a `data-presentation` type-scale hook (`--type-scale`).
- Remove all `.dark` token blocks and old oklch palette.
- Add a throwaway route `src/app/_tokens/page.tsx` (token swatches, type scale, radii, shadows) so the human can eyeball the system; remove it in U14.

## Acceptance
- `pnpm exec tsc --noEmit` and `pnpm exec eslint src/app` pass.
- No `dark` class or dark colour tokens remain (`grep -rn "dark" src/app/globals.css src/app/layout.tsx` clean).
- ACTION NEEDED FROM YOU: run `! cd dashboard && pnpm dev`, open `/_tokens`; confirm warm paper background, ultramarine/tangerine/lime swatches, three fonts rendering distinctly.

## Do NOT
Build components; touch `src/lib/*`; add a dark mode; keep old colour names.
