# U02 — Motion kit & UI primitives

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/01, docs/ui/02, docs/ui/07 (Primitives table).

## Goal
Build the springy motion foundation and the unique primitive component set every page will use.

## Build
- `src/lib/motion.ts`: spring presets (`springSoft/Snappy/Bouncy/Slow`), shared variants (`fadeUp`, `stagger`, `popIn`), `useReducedMotionSafe()` helper, `Magnetic` wrapper hook.
- `src/lib/format.ts` and `src/lib/colors.ts` (formatters, tenant colour hash, level→tone map using `LADDER` from `ladder.ts`).
- Primitives in `src/components/ui/`: `Button` (all variants, loading, magnetic), `Card` (flat/pop/tinted/glass), `Badge`/`Chip`, `Input`, `NumberField`, `Slider`, `Segmented` (sliding pill), `Switch`, `Select`, `Tooltip`, `Popover`, `Dialog`, `Drawer`, `Toast` + `useToast`, `Skeleton`, `EmptyState`, `ErrorState`, `Kbd`, `NumberTicker`.
- Use `@base-ui/react` only for behaviour/a11y of dialog/popover/tooltip/select; all styling per docs/ui/07.
- Mount `<ToastViewport/>` in layout.
- Extend the throwaway `/_tokens` page into a primitives gallery (every variant/state).

## Acceptance
- `tsc --noEmit` + eslint on `src/components/ui`, `src/lib/motion.ts` pass.
- Each primitive has typed props and a focus-visible ring; interactive targets ≥ 36 px.
- ACTION NEEDED FROM YOU: `pnpm dev`, open `/_tokens`; check buttons spring on press, magnetic CTA follows cursor, segmented pill slides, dialog/drawer spring in, toast bounces, number ticker tweens.

## Do NOT
Restyle old pages yet; add heavy deps beyond U01; use stock shadcn styling.
