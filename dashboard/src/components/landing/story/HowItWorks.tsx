"use client";
// Post-story section: the three-step loop in plain words. Unpinned, so it never touches the scrub timeline.
import { motion } from "motion/react";
import { Gauge, ScanSearch, ShieldAlert } from "lucide-react";
import { fadeUp, stagger, useReducedMotionSafe } from "@/lib/motion";

const STEPS = [
  { icon: Gauge, title: "Meter the cost", body: "Every request is priced by the CPU, memory and database time it really uses, not just counted." },
  { icon: ScanSearch, title: "Spot the outlier", body: "A detector compares each tenant to its own baseline and to the fleet, then explains why it flagged." },
  { icon: ShieldAlert, title: "Escalate gently", body: "Soft throttle first, then hard limit, then isolate. Each rung is logged and can be undone." },
] as const;

export function HowItWorks() {
  const reduced = useReducedMotionSafe();
  return (
    <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1100px] px-6 py-20 md:px-[8vw]">
      <p className="text-[13px] font-semibold uppercase tracking-[0.02em] text-ultra">How it works</p>
      <h2 id="how-title" className="mt-2 font-display text-[34px] font-extrabold leading-[1.05] tracking-tight sm:text-[44px]">
        Measure, catch, contain.
      </h2>
      <motion.ol
        variants={stagger}
        initial={reduced ? "show" : "hidden"}
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="mt-10 grid gap-4 md:grid-cols-3"
      >
        {STEPS.map((s, i) => (
          <motion.li
            key={s.title}
            variants={fadeUp}
            className="relative rounded-3xl border-2 border-ink bg-surface p-6 shadow-[var(--shadow-pop)]"
          >
            <span className="num absolute -top-3 left-5 rounded-full bg-lime px-2.5 py-0.5 text-[13px] font-bold text-lime-ink">
              {i + 1}
            </span>
            <s.icon className="size-7 text-ultra" aria-hidden />
            <h3 className="mt-4 font-display text-[22px] font-bold">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
          </motion.li>
        ))}
      </motion.ol>
    </section>
  );
}
