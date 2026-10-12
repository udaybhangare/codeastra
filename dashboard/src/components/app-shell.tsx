"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { motion } from "motion/react";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { springSlow, springSnappy, useSafeTransition } from "@/lib/motion";
import { AdminLogin } from "./admin-login";
import { ConnectionBanner } from "./shell/connection-banner";
import { FloatingSidebar } from "./shell/floating-sidebar";
import { PageTransition } from "./shell/page-transition";
import { Shortcuts } from "./shell/shortcuts";
import { TopBar } from "./shell/top-bar";

// The landing page (/) and tenant portal are separate surfaces: they must not mount the admin stream
// (which carries every tenant), so they bypass the admin shell entirely.
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/" || path.startsWith("/portal")) return <>{children}</>;
  return <AdminShell>{children}</AdminShell>;
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const connect = useStream((s) => s.connect);
  const disconnect = useStream((s) => s.disconnect);
  const presentation = useUi((s) => s.presentation);
  const pref = useUi((s) => s.sidebarCollapsed);
  const t = useSafeTransition(presentation ? springSlow : springSnappy);

  // Presentation mode scales type via --type-scale on <html data-presentation> (docs/ui/01).
  useEffect(() => {
    const el = document.documentElement;
    if (presentation) el.setAttribute("data-presentation", "");
    else el.removeAttribute("data-presentation");
    return () => el.removeAttribute("data-presentation");
  }, [presentation]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Content clears the floating sidebar (16 px edge + width + 16 px gap). Below 1280 px it is always a rail.
  const rail = presentation || pref;
  return (
    <div className="min-h-full bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-full focus:bg-ultra focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Shortcuts />
      <FloatingSidebar />
      <motion.div
        initial={false}
        animate={{ paddingLeft: rail ? 96 : 264 }}
        transition={t}
        className="max-[1279px]:!pl-[96px]"
      >
        <TopBar />
        <ConnectionBanner />
        <main id="main" tabIndex={-1} className="outline-none">
          <PageTransition>{children}</PageTransition>
        </main>
      </motion.div>
      <AdminLogin />
    </div>
  );
}
