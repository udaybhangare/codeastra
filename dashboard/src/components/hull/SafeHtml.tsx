"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";

interface Props {
  position: [number, number, number];
  center?: boolean;
  zIndexRange?: [number, number];
  style?: CSSProperties;
  children: ReactNode;
}

const v = new THREE.Vector3();

/**
 * Minimal replacement for drei's <Html> (no transform/occlusion). drei unmounts its inner React root
 * synchronously in an effect cleanup, which React 19 flags ("synchronously unmount a root while React
 * was already rendering"). Here the unmount is deferred to a microtask.
 */
export function SafeHtml({ position, center, zIndexRange = [10, 0], style, children }: Props) {
  const { gl, camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const root = useRef<Root | null>(null);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const el = document.createElement("div");
    elRef.current = el;
    el.style.cssText = "position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;";
    el.style.zIndex = String(zIndexRange[0]);
    parent.appendChild(el);
    const r = createRoot(el);
    root.current = r;
    return () => {
      root.current = null;
      elRef.current = null;
      el.remove();
      queueMicrotask(() => r.unmount());
    };
    // zIndexRange is a constant tuple per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useEffect(() => {
    root.current?.render(
      <div style={{ position: "absolute", transform: center ? "translate3d(-50%,-50%,0)" : "none", ...style }}>{children}</div>,
    );
  });

  useFrame(() => {
    const g = group.current;
    const el = elRef.current;
    if (!g || !el) return;
    g.getWorldPosition(v);
    v.project(camera);
    const behind = v.z > 1;
    el.style.display = behind ? "none" : "block";
    if (!behind) el.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * size.width).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * size.height).toFixed(1)}px,0)`;
  });

  return <group ref={group} position={position} />;
}
