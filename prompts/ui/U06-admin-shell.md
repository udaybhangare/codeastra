# U06 — Admin shell: floating sidebar, top bar, presentation mode

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/05 (Shell, Cross-cutting), docs/ui/02 (page transitions, presentation), docs/ui/07 (shell components), current `src/components/app-shell.tsx`, `status.tsx`, `admin-login.tsx`, `src/lib/ui.ts`.

## Goal
Rebuild the admin chrome in the new system; pages inside may still be old.

## Build
- `FloatingSidebar` (layoutId active pill, collapse to rail, presentation auto-collapse), `TopBar` (title/crumb, `IsolationSwitch` with confirm dialog + audit write via existing api, `ConnectionStatus`, last-snapshot clock), `PageFrame` (header, actions, 12-col bento grid), page transition wrapper, `PresentationToggle` + `P`/`[`/`g` shortcuts, `data-presentation` attribute on `<html>`.
- Redesigned `AdminLogin` (pop card, error shake, helper steps).
- Rewrite `app-shell.tsx` and `status.tsx` accordingly (keep exports used elsewhere, or update imports).
- Extend `useUi` with `sidebarCollapsed` and keep `presentation`.

## Acceptance
- `tsc --noEmit` + eslint on shell files pass; no import breaks in `src/app/*`.
- ACTION NEEDED FROM YOU: `pnpm dev`, open `/overview`; confirm floating sidebar with sliding pill, route transitions, isolation switch asks to confirm, connection pill shows state, `P` toggles larger type, login card looks right (sign out first to see it).

## Do NOT
Redesign page contents (U07–U11); introduce a command palette (not chosen).
