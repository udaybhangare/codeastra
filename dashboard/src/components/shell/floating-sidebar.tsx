"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronsLeft, ChevronsRight, ExternalLink, LogOut, ShieldHalf, UserRound } from "lucide-react";
import { adminSignOut, authAuto } from "@/lib/api";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { springSlow, springSnappy, useSafeTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { NAV } from "./nav";
import { PresentationToggle } from "./presentation-toggle";

/** True below 1280 px: the sidebar becomes an icon rail (docs/ui/05). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function FloatingSidebar() {
  const path = usePathname();
  const presentation = useUi((s) => s.presentation);
  const pref = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const narrow = useNarrow();
  const rail = pref || presentation || narrow;
  const t = useSafeTransition(presentation ? springSlow : springSnappy);
  const pillT = useSafeTransition(springSnappy);
  const reconnect = useStream((s) => s.reconnect);

  const signOut = () => {
    adminSignOut();
    reconnect();
  };

  return (
    <motion.aside
      aria-label="Sidebar"
      initial={false}
      animate={{ width: rail ? 80 : 248 }}
      transition={t}
      className="fixed top-4 bottom-4 left-4 z-20 flex flex-col overflow-hidden rounded-[var(--r-xl)] border border-line bg-surface shadow-[var(--shadow-3)]"
    >
      <div className={cn("flex h-16 shrink-0 items-center gap-3 px-5", rail && "justify-center px-0")}>
        <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-ultra text-white">
          <ShieldHalf className="size-5" aria-hidden />
        </span>
        {!rail && <span className="font-display text-xl font-bold tracking-[-0.02em]">Bulkhead</span>}
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon, key }) => {
          const active = path === href || path.startsWith(href + "/");
          const link = (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={rail ? label : undefined}
              className={cn(
                "group relative flex h-11 items-center gap-3 rounded-full px-3.5 text-[15px] font-semibold outline-none transition-colors focus-visible:shadow-[var(--ring)]",
                rail && "justify-center px-0",
                active ? "text-white" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  transition={pillT}
                  className="absolute inset-0 rounded-full bg-ultra"
                  aria-hidden
                />
              )}
              <Icon className="relative size-5 shrink-0" aria-hidden />
              {!rail && (
                <>
                  <span className="relative flex-1 truncate">{label}</span>
                  <Kbd className={cn("relative opacity-0 transition-opacity group-hover:opacity-100", active && "border-white/40 bg-transparent text-white/80")}>
                    g{key}
                  </Kbd>
                </>
              )}
            </Link>
          );
          return rail ? (
            <Tooltip key={href} content={label} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-line p-3">
        <PresentationToggle rail={rail} />
        <Link
          href="/portal"
          aria-label={rail ? "Tenant portal" : undefined}
          className={cn(
            "flex h-11 items-center gap-3 rounded-full px-3.5 text-[15px] font-semibold text-ink-2 outline-none transition-colors hover:bg-paper-2 hover:text-ink focus-visible:shadow-[var(--ring)]",
            rail && "justify-center px-0",
          )}
        >
          <ExternalLink className="size-5 shrink-0" aria-hidden />
          {!rail && "Tenant Portal"}
        </Link>
        <div className={cn("flex items-center gap-2 rounded-full bg-paper-2 p-1.5", rail && "flex-col rounded-[var(--r-lg)]")}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lime text-lime-ink">
            <UserRound className="size-4" aria-hidden />
          </span>
          {!rail && <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">Admin</span>}
          {authAuto && (
            <Tooltip content="Sign out" side="right">
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                className="grid size-8 shrink-0 place-items-center rounded-full text-ink-2 outline-none hover:bg-surface focus-visible:shadow-[var(--ring)]"
              >
                <LogOut className="size-4" aria-hidden />
              </button>
            </Tooltip>
          )}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={pref ? "Expand sidebar" : "Collapse sidebar"}
          disabled={presentation || narrow}
          className={cn(
            "flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold text-ink-3 outline-none hover:bg-paper-2 hover:text-ink focus-visible:shadow-[var(--ring)] disabled:opacity-40",
            rail && "justify-center px-0",
          )}
        >
          {rail ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
          {!rail && (
            <>
              Collapse <Kbd className="ml-auto">[</Kbd>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
