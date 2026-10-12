"use client";
import { WifiOff } from "lucide-react";
import { useStream } from "@/lib/store";

/** Admin-wide WS-disconnected banner (docs/ui/00 principle 6). Shown on every admin route, not just Overview. */
export function ConnectionBanner() {
  const conn = useStream((s) => s.conn);
  const hasData = useStream((s) => s.latest !== null);
  if (conn !== "reconnecting" && conn !== "closed") return null;
  const tail = hasData ? "Showing the last known data." : "No data received yet.";
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 pb-4 min-[1440px]:px-12">
      <div role="alert" className="flex items-center gap-2 rounded-[var(--r-md)] border border-warn bg-warn-100 px-4 py-2 text-[15px] font-medium text-warn-ink">
        <WifiOff className="size-4 shrink-0" aria-hidden />
        {conn === "closed" ? `Offline. ${tail}` : `Connection lost. ${tail} Reconnecting with backoff…`}
      </div>
    </div>
  );
}
