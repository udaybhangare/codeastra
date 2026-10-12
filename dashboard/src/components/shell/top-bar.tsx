"use client";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useStream } from "@/lib/store";
import { ConnectionStatus } from "@/components/status";
import { IsolationSwitch } from "./isolation-switch";
import { navFor } from "./nav";

function Clock() {
  const ts = useStream((s) => s.latest?.ts);
  // false on the server/first paint, true after hydration: avoids a locale-dependent mismatch.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const label = mounted && ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "--:--:--";
  return (
    <span className="num hidden min-w-[9ch] text-right text-xs text-ink-3 lg:inline" title="Time of last snapshot">
      {label}
    </span>
  );
}

/** Transparent over paper: page title + crumb on the left; isolation, connection, clock on the right. */
export function TopBar() {
  const path = usePathname();
  const item = navFor(path);
  return (
    <header className="sticky top-0 z-10 flex min-h-20 items-center justify-between gap-4 px-6 py-4 min-[1440px]:px-12">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-3">
          <span>Bulkhead</span>
          <span aria-hidden>/</span>
          <span>{item?.crumb ?? "Admin"}</span>
        </div>
        <div className="font-display text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">{item?.label ?? "Admin"}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ConnectionStatus />
        <Clock />
        <IsolationSwitch />
      </div>
    </header>
  );
}
