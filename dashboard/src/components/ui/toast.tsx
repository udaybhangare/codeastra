"use client";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { cn } from "@/lib/utils";
import { springBouncy, springSnappy } from "@/lib/motion";

type ToastTone = "ok" | "warn" | "bad" | "info";
export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}
const DISMISS_MS = 4000;

interface ToastStore {
  items: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (tone, message) => set((s) => ({ items: [...s.items.slice(-3), { id: nextId++, tone, message }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** `const toast = useToast(); toast.ok("Saved")`. */
export function useToast() {
  const push = useToastStore((s) => s.push);
  return {
    ok: (m: string) => push("ok", m),
    warn: (m: string) => push("warn", m),
    error: (m: string) => push("bad", m),
    info: (m: string) => push("info", m),
  };
}

const ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: OctagonAlert, info: Info } as const;
const TINT: Record<ToastTone, string> = {
  ok: "text-ok-ink [&_svg]:text-ok",
  warn: "text-warn-ink [&_svg]:text-warn",
  bad: "text-bad-ink [&_svg]:text-bad",
  info: "text-ultra-600 [&_svg]:text-ultra",
};

function Toast({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const h = setTimeout(() => dismiss(item.id), DISMISS_MS);
    return () => clearTimeout(h);
  }, [item.id, dismiss]);
  const Icon = ICON[item.tone];
  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, y: 24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: springBouncy }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={springSnappy}
      className={cn("pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-full border border-line bg-surface py-3 pr-6 pl-4 text-[15px] font-medium shadow-[var(--shadow-2)]", TINT[item.tone])}
    >
      <Icon className="size-5" aria-hidden />
      <span className="text-ink">{item.message}</span>
      <motion.span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-current opacity-60"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: DISMISS_MS / 1000, ease: "linear" }}
      />
    </motion.div>
  );
}

/** Bottom-centre stack; mount once in the root layout. */
export function ToastViewport() {
  const items = useToastStore((s) => s.items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2">
      <AnimatePresence>
        {items.map((t) => (
          <Toast key={t.id} item={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
