"use client";
import { useFrame } from "@react-three/fiber";
import { easing } from "maath";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { WATER_BAD, WATER_OK, WATER_WARN, waterBlend } from "@/lib/hull";

interface Props {
  usage: number;
  pOverload?: number;
  width: number;
  height: number;
  depth: number;
}

/** Water volume anchored to the compartment floor, plus the blue predicted ghost level. */
export function Water({ usage, pOverload, width, height, depth }: Props) {
  const water = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const cur = useRef({ u: usage, p: pOverload ?? 0 });
  const colors = useMemo(() => ({ ok: new THREE.Color(WATER_OK), warn: new THREE.Color(WATER_WARN), bad: new THREE.Color(WATER_BAD) }), []);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const inner = height - 0.2;
  const floor = -height / 2 + 0.1;

  useFrame((state, dt) => {
    const c = cur.current;
    easing.damp(c, "u", usage, 0.35, dt);
    easing.damp(c, "p", pOverload ?? 0, 0.5, dt);
    const m = water.current;
    if (m) {
      const level = Math.max(0.001, Math.min(c.u, 1.2));
      const over = Math.max(0, c.u - 1);
      const h = level * inner * 0.92;
      m.scale.y = h;
      m.position.y = floor + h / 2;
      m.rotation.z = over > 0 ? Math.sin(state.clock.elapsedTime * 7) * 0.025 * Math.min(1, over * 5) : 0;
      const { warn, bad } = waterBlend(c.u);
      mat.current?.color.copy(colors.ok).lerp(colors.warn, warn).lerp(colors.bad, bad);
    }
    const g = ghost.current;
    if (g) {
      const show = c.p > 0.02;
      g.visible = show;
      if (show) {
        const h = Math.min(1, c.p) * inner * 0.92;
        g.scale.y = Math.max(0.001, h);
        g.position.y = floor + h / 2;
      }
    }
  });

  return (
    <group position={[0, 0, 0]}>
      <mesh ref={water} scale={[1, 0.001, 1]}>
        <boxGeometry args={[width - 0.2, 1, depth - 0.2]} />
        <meshStandardMaterial ref={mat} color={WATER_OK} roughness={0.35} transparent opacity={0.9} />
      </mesh>
      <mesh ref={ghost} visible={false}>
        <boxGeometry args={[width - 0.16, 1, depth - 0.16]} />
        <meshStandardMaterial color="#3B2EFF" transparent opacity={0.28} depthWrite={false} roughness={0.5} />
      </mesh>
    </group>
  );
}
