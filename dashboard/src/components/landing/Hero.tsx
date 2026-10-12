"use client";
// Hero section (docs/ui/04 §1): headline, CTAs, isolation switch, hint chip, scroll cue.
import { AnimatePresence, motion } from "motion/react";
import { MousePointerClick } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fadeUp, springSoft, stagger, useReducedMotionSafe } from "@/lib/motion";
import { RESULTS } from "./story/results";
import { scroller, useLanding } from "./scroll-store";

function IsolationSwitch() {
  const isolation = useLanding((s) => s.isolation);
  const setIsolation = useLanding((s) => s.setIsolation);
  const on = isolation === "on";
  return (
    <div className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/70 py-2 pl-5 pr-2 shadow-[var(--shadow-2)] backdrop-blur-md">
      <span className="text-[14px] font-semibold" id="iso-label">
        Protection <span className="num">{on ? "ON" : "OFF"}</span>
      </span>
      <Switch aria-label="Protection" checked={on} onCheckedChange={(v) => setIsolation(v ? "on" : "off")} />
    </div>
  );
}

export function Hero() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const hinted = useLanding((s) => s.hinted);
  const isolation = useLanding((s) => s.isolation);
  const surge = useLanding((s) => s.surge);

  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      className="pointer-events-none relative z-10 flex min-h-screen items-center px-6 pb-24 pt-[44vh] md:px-[8vw] md:pt-24"
    >
      <motion.div variants={stagger} initial={reduced ? "show" : "hidden"} animate="show" className="max-w-[520px]">
        <motion.h1
          id="hero-title"
          variants={fadeUp}
          className="font-display text-[44px] font-extrabold leading-[1.02] tracking-tight sm:text-[60px] lg:text-[72px]"
        >
          One noisy neighbor shouldn&apos;t sink the ship.
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-5 max-w-[46ch] text-[18px] leading-relaxed text-ink-2">
          Bulkhead seals every tenant in its own compartment, so one bad actor can&apos;t drown everyone else.
        </motion.p>
        <motion.div variants={fadeUp} className="pointer-events-auto mt-8 flex flex-wrap items-center gap-3">
          <Button size="lg" magnetic onClick={() => router.push("/overview")}>
            Launch Console
          </Button>
          <Button size="lg" variant="secondary" onClick={() => scroller.scrollTo("#story")}>
            Watch it hold
          </Button>
        </motion.div>
        <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-3">
          <IsolationSwitch />
          <p aria-live="polite" className="pointer-events-none max-w-[26ch] text-[13px] text-ink-2">
            {surge
              ? isolation === "on"
                ? "rogue-ml was sealed. The others stayed calm."
                : "rogue-ml is flooding its neighbours."
              : "Flip it OFF to see what happens without walls."}
          </p>
        </motion.div>
        <motion.dl variants={fadeUp} className="mt-6 grid max-w-[520px] grid-cols-3 gap-2.5">
          {[
            { k: `${RESULTS.inflation.on}×`, v: "Victim slowdown", tone: "text-ok-ink" },
            { k: String(RESULTS.falsePositives), v: "Good tenants limited", tone: "text-ok-ink" },
            { k: `${RESULTS.throughputPct.on}%`, v: "Work kept in attack", tone: "text-ultra" },
          ].map((m) => (
            <div
              key={m.v}
              className="min-w-0 rounded-2xl border border-white/70 bg-white/60 px-3.5 py-3 shadow-[var(--shadow-1)] backdrop-blur-md"
            >
              <dd className={`num text-[24px] font-bold leading-none sm:text-[28px] ${m.tone}`}>{m.k}</dd>
              <dt className="mt-1.5 text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] text-ink-2">{m.v}</dt>
            </div>
          ))}
        </motion.dl>
        <AnimatePresence>
          {!hinted && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              transition={reduced ? { duration: 0 } : { ...springSoft, delay: 0.8 }}
              className="pointer-events-none mt-6 inline-flex items-center gap-2 rounded-full border-2 border-ink bg-lime px-4 py-2 text-[13px] font-semibold text-lime-ink shadow-[3px_3px_0_var(--ink)]"
            >
              <span className="relative flex size-2.5" aria-hidden>
                <span className="absolute inline-flex size-full motion-safe:animate-ping rounded-full bg-lime-ink/40" />
                <span className="relative inline-flex size-2.5 rounded-full bg-lime-ink" />
              </span>
              <MousePointerClick className="size-4" aria-hidden />
              Click a compartment to make it noisy
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </section>
  );
}
