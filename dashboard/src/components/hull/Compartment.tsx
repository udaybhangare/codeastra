"use client";
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { easing } from "maath";
import { Lock } from "lucide-react";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { tenantColor } from "@/lib/colors";
import { CELL_D, CELL_H, CELL_W, LEVEL_HEX, doorLevel, type HullTenant, type Slot } from "@/lib/hull";
import { LADDER } from "@/lib/ladder";
import type { Isolation } from "@/lib/ws-types";
import { Door } from "./Door";
import { SafeHtml } from "./SafeHtml";
import { Water } from "./Water";

interface Props {
  tenant: HullTenant;
  slot: Slot;
  usage: number;
  isolation: Isolation;
  hovered: boolean;
  highlighted: boolean;
  showWallLabels: boolean;
  onHover(id?: string): void;
  onSelect(id: string): void;
}

const WALL_LABELS = ["cpu.max", "memory.max", "pids.max"];

export function Compartment({ tenant, slot, usage, isolation, hovered, highlighted, showWallLabels, onHover, onSelect }: Props) {
  const group = useRef<THREE.Group>(null);
  const cur = useRef({ lift: 0 });
  const dl = doorLevel(isolation, tenant.level);
  const accent = tenantColor(tenant.id);
  const backColor = useMemo(() => new THREE.Color(accent).lerp(new THREE.Color("#FFFFFF"), 0.88), [accent]);
  const sealed = isolation === "on" && tenant.level >= 5;
  const flooded = usage > 1;

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    easing.damp(cur.current, "lift", hovered ? 0.15 : 0, 0.18, dt);
    const shake = flooded && !sealed ? Math.sin(state.clock.elapsedTime * 38) * 0.012 : 0;
    g.position.set(slot.x + shake, slot.y + cur.current.lift, 0);
  });

  const lvl = LADDER[tenant.level];

  return (
    <group ref={group} position={[slot.x, slot.y, 0]}>
      {/* back panel tinted with the tenant colour */}
      <RoundedBox args={[CELL_W, CELL_H, 0.1]} radius={0.12} smoothness={3} position={[0, 0, -CELL_D / 2]}>
        <meshStandardMaterial color={backColor} roughness={0.8} />
      </RoundedBox>

      <Water usage={usage} pOverload={tenant.pOverload} width={CELL_W} height={CELL_H} depth={CELL_D} />

      {/* glass front: pointer target + rim when hovered/highlighted */}
      <mesh
        position={[0, 0, CELL_D / 2]}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
          onHover(tenant.id);
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          onHover(undefined);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(tenant.id);
        }}
      >
        <boxGeometry args={[CELL_W, CELL_H, 0.04]} />
        <meshStandardMaterial
          color={hovered || highlighted ? "#E6E4FF" : "#FFFFFF"}
          emissive={hovered || highlighted ? "#3B2EFF" : "#000000"}
          emissiveIntensity={hovered || highlighted ? 0.18 : 0}
          transparent
          opacity={hovered || highlighted ? 0.3 : 0.14}
          roughness={0.2}
          depthWrite={false}
        />
      </mesh>

      <Door side={-1} level={dl} cellW={CELL_W} cellH={CELL_H} depth={CELL_D} />
      <Door side={1} level={dl} cellW={CELL_W} cellH={CELL_H} depth={CELL_D} />

      {/* name plate */}
      <SafeHtml position={[0, -CELL_H / 2 - 0.02, CELL_D / 2]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div
          className="flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-white px-2.5 py-1 text-[11px] font-semibold text-ink shadow-sm"
          style={{ borderColor: accent }}
        >
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: accent }} />
          {tenant.label ?? tenant.id}
          <span className="num rounded-full px-1.5 text-[10px]" style={{ background: LEVEL_HEX[tenant.level], color: tenant.level === 1 ? "#14142B" : "#fff" }}>
            L{tenant.level}
          </span>
        </div>
      </SafeHtml>

      {sealed && (
        <SafeHtml position={[0, 0.2, CELL_D / 2 + 0.1]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-ink text-white" title="Quarantined">
            <Lock size={18} aria-label="Quarantined" />
          </div>
        </SafeHtml>
      )}

      {showWallLabels &&
        WALL_LABELS.map((l, i) => (
          <SafeHtml key={l} position={[0, CELL_H / 2 - 0.45 - i * 0.4, CELL_D / 2 + 0.1]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <span className="num whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-white">{l}</span>
          </SafeHtml>
        ))}

      {hovered && (
        <SafeHtml position={[0, CELL_H / 2 + 0.2, CELL_D / 2]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
          <div className="card min-w-[150px] p-3 text-left text-xs">
            <div className="text-[13px] font-semibold">{tenant.label ?? tenant.id}</div>
            <div className="text-ink-2">Tier: {tenant.tier}</div>
            <div className="text-ink-2">
              Level: <span className="num">{tenant.level}</span> {lvl.name}
            </div>
            <div className="text-ink-2">
              p99: <span className="num">{tenant.p99_ms !== undefined ? `${Math.round(tenant.p99_ms)} ms` : "n/a"}</span>
            </div>
          </div>
        </SafeHtml>
      )}
    </group>
  );
}
