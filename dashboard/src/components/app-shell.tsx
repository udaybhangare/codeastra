"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Activity, FlaskConical, History, LayoutDashboard, ScrollText, Users, Brain, Presentation } from "lucide-react";
import { useStream } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { ConnectionStatus, IsolationBadge } from "./status";
import { cn } from "@/lib/utils";
import { AdminLogin } from "./admin-login";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/incidents", label: "Incidents", icon: History },
  { href: "/scenarios", label: "Scenario Lab", icon: FlaskConical },
  { href: "/tenants", label: "Tenants", icon: Users },
  { href: "/predictor", label: "Predictor", icon: Brain },
  { href: "/audit", label: "Audit", icon: ScrollText },
];

// The tenant portal is a separate surface: it must not mount the admin stream
// (which carries every tenant), so /portal bypasses the admin shell entirely.
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path.startsWith("/portal")) return <>{children}</>;
  return <AdminShell>{children}</AdminShell>;
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const connect = useStream((s) => s.connect);
  const disconnect = useStream((s) => s.disconnect);

  const presentation = useUi((s) => s.presentation);
  const toggle = useUi((s) => s.togglePresentation);

  useEffect(() => {
    document.documentElement.style.fontSize = presentation ? "125%" : "";
  }, [presentation]);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-background focus:p-2">
        Skip to content
      </a>
      <aside className={cn("w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar", presentation ? "hidden" : "flex")}>
        <div className="flex h-14 items-center gap-2 px-4 font-semibold">
          <Activity className="size-5 text-info" aria-hidden />
          Bulkhead
        </div>
        <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent",
                  active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border px-4">
          <button
            onClick={toggle}
            aria-pressed={presentation}
            className={cn("flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted", presentation && "bg-muted font-medium")}
          >
            <Presentation className="size-3.5" aria-hidden />
            Presentation
          </button>
          <IsolationBadge />
          <ConnectionStatus />
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto p-4">
          <AdminLogin />
          {children}
        </main>
      </div>
    </div>
  );
}
