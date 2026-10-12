# U05 — Landing page: scroll story (GSAP) + results + CTA

> **First read `prompts/_RULES.md`**, `prompts/ui/README.md`.
**Read first:** docs/ui/04 (sections 2–7), docs/ui/03 (camera path), docs/ui/02 (scroll story), `docs/RESULTS.md` (for real numbers), `docs/05-isolation-model.md`.

## Goal
Complete the pinned, scroll-scrubbed story: problem → fair queue → hard walls → detector/ladder → predictor → proof → CTA.

## Build
- `src/components/landing/story/`: `StoryTimeline` (GSAP ScrollTrigger master timeline, integrates with Lenis), one component per section (`Problem`, `FairQueue`, `HardWalls`, `Detector`, `Predictor`, `Proof`), `LadderStepper` usage, `ResultsBento` (numbers from `docs/RESULTS.md`, never invented; tickers on enter), `FinalCta` (pop card, confetti once).
- Finalise `storyKeyframes` in `src/lib/hull.ts`/`components/hull` so camera and compartment states follow the table in docs/ui/03.
- Progress rail wired to sections; text enter/leave animations with reverse.
- Footer.

## Acceptance
- `tsc --noEmit` + eslint on touched files; `ScrollTrigger` instances are killed on unmount (no leaks on route change).
- Results values match `docs/RESULTS.md` (cite file in summary).
- ACTION NEEDED FROM YOU: `pnpm dev`, scroll `/` top to bottom; confirm camera pushes in on the flooding compartment, doors close step by step with the ladder stepper, ghost water appears in the predictor section, results tick up, CTA buttons route correctly; scroll back up reverses cleanly.

## Do NOT
Add new libraries; ship fabricated stats; pin more than one story container.
