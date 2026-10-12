"use client";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CELL_D, CELL_H, CELL_W, type HullTenant, type Slot } from "@/lib/hull";
import type { Isolation } from "@/lib/ws-types";

interface Props {
  tenants: HullTenant[];
  slots: Slot[];
  isolation: Isolation;
  /** Max instances (60 landing/portal, 40 mini). */
  cap: number;
  /** >0 scales particles up (DRR story section). */
  emphasis?: number;
}

/** Request particles flowing left->right in lanes, one instanced mesh. Rate follows rps. */
export function Particles({ tenants, slots, isolation, cap, emphasis = 0 }: Props) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // lane (tenant index) per instance, proportional to rps; welded tenants get none.
  const lanes = useMemo(() => {
    const w = tenants.map((t) => (isolation === "on" && t.level >= 5 ? 0 : Math.max(0.05, t.rps ?? t.usage * 40)));
    const sum = w.reduce((a, b) => a + b, 0);
    const out: number[] = [];
    if (sum <= 0) return out;
    const counts = w.map((x) => Math.floor((x / sum) * cap));
    let rest = cap - counts.reduce((a, b) => a + b, 0);
    const order = w.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]);
    for (let j = 0; rest > 0 && order.length > 0; j = (j + 1) % order.length) {
      if (order[j][0] > 0) {
        counts[order[j][1]]++;
        rest--;
      }
    }
    counts.forEach((c, i) => {
      for (let n = 0; n < c; n++) out.push(i);
    });
    return out;
  }, [tenants, isolation, cap]);

  useLayoutEffect(() => {
    if (mesh.current) mesh.current.count = cap;
  }, [cap]);

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    for (let k = 0; k < cap; k++) {
      const lane = lanes[k];
      const slot = lane === undefined ? undefined : slots[lane];
      if (!slot) {
        dummy.scale.setScalar(0);
      } else {
        const level = tenants[lane].level;
        const speed = 0.22 + 0.04 * (5 - level);
        const phase = (k * 0.6180339 + t * speed) % 1;
        const x = slot.x - CELL_W / 2 + 0.2 + phase * (CELL_W - 0.4);
        const y = slot.y - CELL_H / 2 + 0.3 + (k % 3) * 0.14;
        dummy.position.set(x, y, CELL_D / 2 + 0.08);
        dummy.scale.setScalar(0.06 * (1 + emphasis * 0.6));
      }
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cap]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#3B2EFF" />
    </instancedMesh>
  );
}
