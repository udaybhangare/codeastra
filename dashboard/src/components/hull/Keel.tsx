"use client";
import { useFrame } from "@react-three/fiber";
import { easing } from "maath";
import { useRef } from "react";
import * as THREE from "three";

interface Props {
  width: number;
  y: number;
  cpu: number;
  mem: number;
}

/** Host gauge strip along the keel: top bar = cpu_util, bottom bar = mem_util. */
export function Keel({ width, y, cpu, mem }: Props) {
  const cpuBar = useRef<THREE.Mesh>(null);
  const memBar = useRef<THREE.Mesh>(null);
  const cur = useRef({ cpu, mem });
  const w = width - 0.6;

  useFrame((_, dt) => {
    easing.damp(cur.current, "cpu", cpu, 0.4, dt);
    easing.damp(cur.current, "mem", mem, 0.4, dt);
    for (const [ref, v] of [[cpuBar, cur.current.cpu], [memBar, cur.current.mem]] as const) {
      const m = ref.current;
      if (!m) continue;
      const s = Math.max(0.001, Math.min(1, v)) * w;
      m.scale.x = s;
      m.position.x = -w / 2 + s / 2;
    }
  });

  return (
    <group position={[0, y, 0.2]}>
      {[0.1, -0.1].map((oy) => (
        <mesh key={oy} position={[0, oy, 0]}>
          <boxGeometry args={[w, 0.12, 0.05]} />
          <meshStandardMaterial color="#F2EDE4" roughness={0.9} />
        </mesh>
      ))}
      <mesh ref={cpuBar} position={[-w / 2, 0.1, 0.04]}>
        <boxGeometry args={[1, 0.12, 0.05]} />
        <meshStandardMaterial color="#3B2EFF" roughness={0.6} />
      </mesh>
      <mesh ref={memBar} position={[-w / 2, -0.1, 0.04]}>
        <boxGeometry args={[1, 0.12, 0.05]} />
        <meshStandardMaterial color="#FF6B35" roughness={0.6} />
      </mesh>
    </group>
  );
}
