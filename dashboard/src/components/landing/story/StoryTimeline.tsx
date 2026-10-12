"use client";
// The landing story: ONE pinned container (desktop) scrubbed by a master GSAP timeline, or stacked
// cards (mobile / reduced motion). Owns the hull's scroll progress:
//   hero scroll          -> 0 .. STORY_START
//   pinned story scroll  -> STORY_START .. 1
// Lenis feeds ScrollTrigger from LandingRoot. Every trigger is created inside a gsap.context and
// reverted on unmount (no leaks across route changes).
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { sampleStory } from "@/components/hull/story";
import { useReducedMotionSafe } from "@/lib/motion";
import type { Level } from "@/lib/ws-types";
import { SECTIONS, STORY_START, scrollMap, sectionAt, useLanding } from "../scroll-store";
import { Detector } from "./Detector";
import { FairQueue } from "./FairQueue";
import { HardWalls } from "./HardWalls";
import { Predictor } from "./Predictor";
import { Problem } from "./Problem";
import { Proof } from "./Proof";

const VIEWPORTS_OF_SCROLL = 7;
/** Cross-fade window, in global progress units, that ends exactly at a section's start. */
const FADE = 0.03;

const mq = "(min-width: 768px)";
const subscribeDesktop = (cb: () => void) => {
  const m = window.matchMedia(mq);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

export function StoryTimeline() {
  const reduced = useReducedMotionSafe();
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(mq).matches,
    () => false,
  );
  const pinned = desktop && !reduced;

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const setProgress = useLanding((s) => s.setProgress);
  const progress = useLanding((s) => s.progress);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const el = root.current;
    if (!el) return;
    let heroST: ScrollTrigger | undefined;
    let storyST: ScrollTrigger | undefined;

    const ctx = gsap.context(() => {
      const hero = document.querySelector<HTMLElement>("#hero");
      if (hero) {
        heroST = ScrollTrigger.create({
          trigger: hero,
          start: "top top",
          end: "bottom top",
          onUpdate: (self) => setProgress(self.progress * STORY_START),
        });
      }
      const panels = gsap.utils.toArray<HTMLElement>("[data-panel]", el);
      const span = 1 - STORY_START;
      const toPos = (at: number) => at - STORY_START;

      if (pinned && stage.current) {
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: stage.current,
            start: "top top",
            end: () => `+=${window.innerHeight * VIEWPORTS_OF_SCROLL}`,
            pin: true,
            scrub: 0.6,
            invalidateOnRefresh: true,
            onUpdate: (self) => setProgress(STORY_START + self.progress * span),
          },
        });
        storyST = tl.scrollTrigger;
        panels.forEach((panel, i) => {
          const at = SECTIONS[i + 1].at;
          const end = i + 2 < SECTIONS.length ? SECTIONS[i + 2].at : 1;
          if (i === 0) gsap.set(panel, { autoAlpha: 1, y: 0 });
          else {
            gsap.set(panel, { autoAlpha: 0, y: 40 });
            tl.to(panel, { autoAlpha: 1, y: 0, duration: FADE }, toPos(at - FADE));
          }
          if (i < panels.length - 1) tl.to(panel, { autoAlpha: 0, y: -40, duration: FADE }, toPos(end - FADE));
        });
        tl.set({}, {}, span); // total duration == 1 - STORY_START
      } else {
        // Stacked: no pin. Cards reveal once with toggleActions; hull progress follows the column.
        storyST = ScrollTrigger.create({
          trigger: el,
          start: "top bottom",
          end: "bottom bottom",
          onUpdate: (self) => setProgress(STORY_START + self.progress * span),
        });
        if (!reduced) {
          panels.forEach((panel) => {
            gsap.from(panel, {
              autoAlpha: 0,
              y: 32,
              duration: 0.5,
              ease: "power3.out",
              scrollTrigger: { trigger: panel, start: "top 85%", toggleActions: "play none none reverse" },
            });
          });
        }
      }

      scrollMap.toY = (p: number) => {
        if (p <= STORY_START && heroST) return heroST.start + (p / STORY_START) * (heroST.end - heroST.start);
        if (storyST) return storyST.start + ((p - STORY_START) / span) * (storyST.end - storyST.start);
        return p * (document.documentElement.scrollHeight - window.innerHeight);
      };
    }, el);

    ScrollTrigger.refresh();
    return () => {
      ctx.revert();
      scrollMap.toY = (p) => p * (document.documentElement.scrollHeight - window.innerHeight);
    };
  }, [pinned, reduced, setProgress]);

  const section = sectionAt(progress);
  const level = useMemo(() => Math.max(0, Math.min(5, Math.round(sampleStory(progress).door))) as Level, [progress]);
  const proofActive = section >= 6;

  return (
    <div id="story" ref={root} className={pinned ? "story-pinned" : "story-stacked"}>
      <div ref={stage} className={pinned ? "relative z-10 h-screen overflow-hidden" : "relative z-10 flex flex-col gap-6 py-10"}>
        <Problem />
        <FairQueue />
        <HardWalls active={section >= 3} />
        <Detector level={level} />
        <Predictor />
        <Proof active={proofActive} />
      </div>
    </div>
  );
}
