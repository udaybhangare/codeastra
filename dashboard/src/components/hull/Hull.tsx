"use client";
// Public entry for the 3D hull (docs/ui/03). Canvas is lazy (ssr:false); poster = loader + fallback.
import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { HullProps } from "@/lib/hull";
import { StaticHullPoster } from "./StaticHullPoster";

export type { HullProps, HullTenant } from "@/lib/hull";

const Scene = dynamic(() => import("./Scene"), { ssr: false, loading: () => <StaticHullPoster /> });

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const SIZE: Record<HullProps["mode"], string> = {
  landing: "fixed inset-0 -z-0",
  mini: "relative h-[240px] w-full max-w-[420px]",
  portal: "relative h-[220px] w-full max-w-[360px]",
};

export function Hull(props: HullProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const poster = <StaticHullPoster tenants={props.tenants} />;
  return (
    <div ref={ref} className={`${SIZE[props.mode]} ${props.className ?? ""}`}>
      <Boundary fallback={poster}>
        <Scene {...props} active={visible} />
      </Boundary>
    </div>
  );
}
