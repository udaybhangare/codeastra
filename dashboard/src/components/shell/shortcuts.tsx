"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUi } from "@/lib/ui";
import { NAV } from "./nav";

/** `P` presentation, `[` collapse sidebar, `g` then o/i/s/t/p/a navigate. Ignored while typing. */
export function Shortcuts() {
  const router = useRouter();
  useEffect(() => {
    let gAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      const now = e.timeStamp;
      if (gAt && now - gAt < 1200) {
        gAt = 0;
        const hit = NAV.find((n) => n.key === k);
        if (hit) {
          e.preventDefault();
          router.push(hit.href);
          return;
        }
      }
      if (k === "g") gAt = now;
      else if (k === "p") useUi.getState().togglePresentation();
      else if (k === "[") useUi.getState().toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}
