"use client";
import { Dialog as D } from "@base-ui/react/dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { springSoft, springSnappy, useReducedMotionSafe } from "@/lib/motion";

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

function Overlay({ open, onOpenChange, title, description, children, footer, className, side }: OverlayProps & { side: "center" | "right" }) {
  const reduced = useReducedMotionSafe();
  const t = reduced ? { duration: 0 } : side === "right" ? springSoft : springSnappy;
  const initial = reduced ? { opacity: 0 } : side === "right" ? { x: "100%", opacity: 1 } : { opacity: 0, scale: 0.92, y: 12 };
  const shown = side === "right" ? { x: 0, opacity: 1 } : { opacity: 1, scale: 1, y: 0 };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <D.Portal keepMounted>
            <D.Backdrop
              render={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />}
              className="fixed inset-0 z-[40] bg-[rgba(20,20,43,.25)] backdrop-blur-[6px]"
            />
            <div className={cn("fixed inset-0 z-[50] flex p-4", side === "right" ? "justify-end p-0" : "items-center justify-center")}>
              <D.Popup
                render={<motion.div initial={initial} animate={shown} exit={initial} transition={t} />}
                className={cn(
                  "flex max-h-full flex-col bg-surface outline-none",
                  side === "right"
                    ? "h-full w-[min(560px,100vw)] rounded-l-[var(--r-xl)] shadow-[var(--shadow-3)]"
                    : "w-[min(520px,100%)] rounded-[var(--r-xl)] shadow-[var(--shadow-3)]",
                  className,
                )}
              >
                <div className="flex items-start justify-between gap-4 p-6 pb-2">
                  <div className="min-w-0">
                    <D.Title className="font-display text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">{title}</D.Title>
                    {description ? <D.Description className="mt-1 text-[15px] text-ink-2">{description}</D.Description> : null}
                  </div>
                  <D.Close
                    aria-label="Close"
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 outline-none transition-colors hover:bg-paper-2 focus-visible:shadow-[var(--ring)]"
                  >
                    <X className="size-5" aria-hidden />
                  </D.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
                {footer ? <div className="flex justify-end gap-2 border-t border-line p-4">{footer}</div> : null}
              </D.Popup>
            </div>
          </D.Portal>
        ) : null}
      </AnimatePresence>
    </D.Root>
  );
}

/** Centred modal, `--r-xl`, spring scale-in. */
export function Dialog(props: OverlayProps) {
  return <Overlay {...props} side="center" />;
}

/** Right-docked drawer, 480–560 px, spring slide. */
export function Drawer(props: OverlayProps) {
  return <Overlay {...props} side="right" />;
}

