"use client";
// Floating glass pill nav (docs/ui/04 global chrome).
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { springSoft } from "@/lib/motion";
import { goToProgress, scroller } from "./scroll-store";

function Mark() {
  // Tiny compartment-ship glyph: hull outline with three bulkheads.
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <path d="M2 6h22v8c0 5-4 8-8 8h-6c-4 0-8-3-8-8V6z" fill="var(--ultra)" />
      <path d="M9.5 6v15M16.5 6v15" stroke="#fff" strokeWidth="1.6" />
      <rect x="3.5" y="12" width="5" height="5" rx="1" fill="var(--lime)" />
    </svg>
  );
}

export function FloatingNav() {
  const router = useRouter();
  return (
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
      className="pointer-events-none fixed inset-x-0 top-4 z-30 flex justify-center px-3"
    >
      <nav
        aria-label="Landing"
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-white/70 py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-3)] backdrop-blur-xl sm:gap-2"
      >
        <span className="flex items-center gap-2 pr-2 font-display text-[17px] font-bold">
          <Mark />
          <span className="hidden sm:inline">Bulkhead</span>
        </span>
        <button
          onClick={() => scroller.scrollTo("#story")}
          className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-ink-2 outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)] sm:block"
        >
          Story
        </button>
        <button
          onClick={() => goToProgress(0.92)}
          className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-ink-2 outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)] sm:block"
        >
          Results
        </button>
        <button
          onClick={() => scroller.scrollTo("#features")}
          className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-ink-2 outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)] md:block"
        >
          Features
        </button>
        <button
          onClick={() => scroller.scrollTo("#faq")}
          className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-ink-2 outline-none hover:bg-paper-2 focus-visible:shadow-[var(--ring)] md:block"
        >
          FAQ
        </button>
        <Button variant="ghost" size="sm" onClick={() => router.push("/portal")}>
          Tenant Portal
        </Button>
        <Button size="sm" magnetic onClick={() => router.push("/overview")}>
          Launch Console
        </Button>
      </nav>
    </motion.header>
  );
}
