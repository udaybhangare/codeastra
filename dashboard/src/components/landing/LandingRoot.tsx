"use client";
// Landing page root: Lenis smooth scroll + scroll-progress store + fixed hull (docs/ui/04).
// Story sections 2–7: ./story/StoryTimeline (GSAP ScrollTrigger, driven by Lenis).
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";
import { useReducedMotionSafe } from "@/lib/motion";
import { DecorBlobs } from "./DecorBlobs";
import { FloatingNav } from "./FloatingNav";
import { Hero } from "./Hero";
import { HullBackdrop } from "./HullBackdrop";
import { ProgressRail } from "./ProgressRail";
import { scroller } from "./scroll-store";
import { Faq } from "./story/Faq";
import { FeatureGrid } from "./story/FeatureGrid";
import { Footer } from "./story/Footer";
import { HowItWorks } from "./story/HowItWorks";
import { StoryTimeline } from "./story/StoryTimeline";

export function LandingRoot() {
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    if (reduced) return; // native scroll; ScrollTrigger still tracks it
    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    const prev = scroller.scrollTo;
    scroller.scrollTo = (t) => lenis.scrollTo(t as number | string, { duration: 1.2 });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      scroller.scrollTo = prev;
    };
  }, [reduced]);

  return (
    <div className="relative">
      <DecorBlobs />
      <HullBackdrop />
      <FloatingNav />
      <ProgressRail />
      <main id="main">
        <Hero />
        <StoryTimeline />
        {/* Opaque paper band: covers the fixed hull so the post-story sections stay legible. */}
        <div className="relative z-10 bg-paper">
          <HowItWorks />
          <FeatureGrid />
          <Faq />
        </div>
      </main>
      <Footer />
    </div>
  );
}
