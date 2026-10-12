"use client";
import { useFrame } from "@react-three/fiber";
import { easing } from "maath";
import { useRef } from "react";
import * as THREE from "three";
import { LEVEL_HEX } from "@/lib/hull";
import type { Level } from "@/lib/ws-types";

interface Props {
  side: -1 | 1;
  level: Level;
  cellW: number;
  cellH: number;
  depth: number;
}

const LINTEL = 0.12;

/** Bulkhead door sliding down from the top edge in 5 steps (0 open lintel .. 5 welded + hatch). */
export function Door({ side, level, cellW, cellH, depth }: Props) {
  const body = useRef<THREE.Mesh>(null);
  const hatch = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const cur = useRef({ h: LINTEL });
  const target = LINTEL + (level / 5) * (cellH - LINTEL);
  const color = LEVEL_HEX[level];

  useFrame((_, dt) => {
    easing.damp(cur.current, "h", target, 0.28, dt);
    const h = cur.current.h;
    if (body.current) {
      body.current.scale.y = h;
      body.current.position.y = cellH / 2 - h / 2;
    }
    if (hatch.current) {
      hatch.current.visible = level === 5 && h > cellH * 0.9;
    }
    mat.current?.color.set(color);
  });

  return (
    <group position={[side * (cellW / 2 + 0.07), 0, 0]}>
      <mesh ref={body}>
        <boxGeometry args={[0.1, 1, depth + 0.1]} />
        <meshStandardMaterial ref={mat} color={color} roughness={0.7} />
      </mesh>
      {/* hatch stripes for the welded state */}
      <group ref={hatch} visible={false} position={[side * 0.056, 0, depth / 2 + 0.06]}>
        {[-0.7, 0, 0.7].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.04, 0.9, 0.02]} />
            <meshBasicMaterial color="#14142B" />
          </mesh>
        ))}
      </group>
    </group>
  );
}
