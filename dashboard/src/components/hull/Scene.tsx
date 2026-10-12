"use client";
import { ContactShadows } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { easing } from "maath";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { CELL_D, displayUsage, layoutSlots, type HullProps, type HullTenant } from "@/lib/hull";
import type { Level } from "@/lib/ws-types";
import { Compartment } from "./Compartment";
import { Keel } from "./Keel";
import { Particles } from "./Particles";
import { STORY_INDEX, applyStory, sampleStory, type StoryState } from "./story";

const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(14));
const TILT = THREE.MathUtils.degToRad(12);
const HULL_PAD_X = 0.7;
const HULL_PAD_TOP = 0.4;
const HULL_PAD_BOTTOM = 0.9;

interface RigProps {
  mode: HullProps["mode"];
  width: number;
  height: number;
  focusX: number;
  focusY: number;
  zoom: number;
  parallax: boolean;
  children: ReactNode;
}

/** Camera fit + damped cursor parallax (±6° yaw, ±3° pitch). */
function Rig({ mode, width, height, focusX, focusY, zoom, parallax, children }: RigProps) {
  const group = useRef<THREE.Group>(null);
  const look = useRef(new THREE.Vector3());
  const camTarget = useRef(new THREE.Vector3());
  const rot = useRef({ x: 0, y: 0 });

  useFrame((state, dt) => {
    const aspect = state.size.width / Math.max(1, state.size.height);
    const fit = Math.max(height / (2 * TAN_HALF_FOV), width / (2 * TAN_HALF_FOV * aspect)) * 1.1;
    const dist = fit / Math.max(0.2, zoom);
    camTarget.current.set(focusX, focusY + dist * Math.sin(TILT), dist * Math.cos(TILT));
    easing.damp3(state.camera.position, camTarget.current, mode === "landing" ? 0.5 : 0.35, dt);
    easing.damp3(look.current, [focusX, focusY, 0], 0.35, dt);
    state.camera.lookAt(look.current);

    const yaw = parallax ? state.pointer.x * THREE.MathUtils.degToRad(6) : 0;
    const pitch = parallax ? -state.pointer.y * THREE.MathUtils.degToRad(3) : 0;
    easing.damp(rot.current, "y", yaw, 0.3, dt);
    easing.damp(rot.current, "x", pitch, 0.3, dt);
    if (group.current) {
      group.current.rotation.y = rot.current.y;
      group.current.rotation.x = rot.current.x;
    }
  });

  return <group ref={group}>{children}</group>;
}

/** Cream hull shell with rounded bottom + ultramarine rail. Two draw calls. */
function HullShell({ width, height }: { width: number; height: number }) {
  const geom = useMemo(() => {
    const w = width + HULL_PAD_X * 2;
    const h = height + HULL_PAD_TOP + HULL_PAD_BOTTOM;
    const r = Math.min(1.1, h * 0.45);
    const s = new THREE.Shape();
    s.moveTo(-w / 2, h / 2);
    s.lineTo(w / 2, h / 2);
    s.lineTo(w / 2, -h / 2 + r);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2 - r, -h / 2);
    s.lineTo(-w / 2 + r, -h / 2);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2, -h / 2 + r);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
  }, [width, height]);
  const cy = (HULL_PAD_TOP - HULL_PAD_BOTTOM) / 2;
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <group position={[0, cy, -CELL_D / 2 - 0.45]}>
      <mesh geometry={geom}>
        <meshStandardMaterial color="#FFFFFF" roughness={0.8} />
      </mesh>
      <mesh position={[0, (height + HULL_PAD_TOP + HULL_PAD_BOTTOM) / 2 - 0.08, 0.34]}>
        <boxGeometry args={[width + HULL_PAD_X * 2 + 0.1, 0.16, 0.2]} />
        <meshStandardMaterial color="#3B2EFF" roughness={0.6} />
      </mesh>
    </group>
  );
}

function QuantumRing({ y, width, amount }: { y: number; width: number; amount: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.z = state.clock.elapsedTime * 1.2;
  });
  return (
    <mesh ref={ref} position={[0, y, CELL_D / 2 + 0.3]} visible={amount > 0.05}>
      <torusGeometry args={[Math.min(1.2, width / 4), 0.04, 8, 48]} />
      <meshBasicMaterial color="#FF6B35" transparent opacity={Math.min(1, amount)} />
    </mesh>
  );
}

const ATTACK_MS = 6000;
const ESCALATE_MS = 1500;

export interface SceneProps extends HullProps {
  /** false pauses the render loop (off-screen). */
  active: boolean;
}

export default function Scene(props: SceneProps) {
  const { tenants, isolation, mode, highlightId, onHover, onSelect, scrollProgress, host, active } = props;
  const [hoverId, setHoverId] = useState<string | undefined>();
  const [attack, setAttack] = useState<{ id: string; stage: 1 | 2 } | undefined>();
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  const story: StoryState | null = mode === "landing" && scrollProgress !== undefined ? sampleStory(scrollProgress) : null;

  // pipeline: props -> click-attack -> scripted story -> displayed water
  let list: HullTenant[] = tenants;
  if (attack) {
    list = list.map((t) => (t.id === attack.id ? { ...t, usage: 1.15, level: (attack.stage === 2 ? 5 : 3) as Level } : t));
  }
  if (story) list = applyStory(list, story);
  const eff = story && story.isolationOff > 0.5 ? "off" : isolation;
  const layout = useMemo(() => layoutSlots(list.length), [list.length]);
  const usage = displayUsage(list, eff, layout.cols);

  const handleHover = (id?: string) => {
    setHoverId(id);
    onHover?.(id);
  };
  const handleSelect = (id: string) => {
    if (mode === "landing") {
      if (attack) return;
      setAttack({ id, stage: 1 });
      timers.current.push(
        window.setTimeout(() => setAttack({ id, stage: 2 }), ESCALATE_MS),
        window.setTimeout(() => setAttack(undefined), ATTACK_MS),
      );
    }
    onSelect?.(id);
  };

  // camera focus
  const focusIdx =
    mode === "portal" && highlightId ? list.findIndex((t) => t.id === highlightId) : story ? Math.min(STORY_INDEX, list.length - 1) : -1;
  const focusSlot = focusIdx >= 0 ? layout.slots[focusIdx] : undefined;
  const fw = story ? story.focus : focusSlot ? 1 : 0;
  const zoom = mode === "portal" && focusSlot ? 1.9 : story ? story.zoom : 1;
  const hullW = layout.width + HULL_PAD_X * 2;
  const hullH = layout.height + HULL_PAD_TOP + HULL_PAD_BOTTOM;
  const cap = mode === "mini" ? 40 : 60;
  const parallax = mode === "landing" || hoverId !== undefined;
  const keelY = -layout.height / 2 - 0.55;

  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active ? "always" : "never"}
      camera={{ fov: 28, position: [0, 3, 18], near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 6, 8]} intensity={1.6} color="#FFE9D2" />
      <directionalLight position={[-6, 2, 4]} intensity={0.7} color="#6F5BFF" />

      <Rig
        mode={mode}
        width={hullW}
        height={hullH}
        focusX={focusSlot ? focusSlot.x * fw : 0}
        focusY={(HULL_PAD_TOP - HULL_PAD_BOTTOM) / 2 + (focusSlot ? (focusSlot.y - (HULL_PAD_TOP - HULL_PAD_BOTTOM) / 2) * fw : 0)}
        zoom={1 + (zoom - 1) * (story ? 1 : fw)}
        parallax={parallax}
      >
        <HullShell width={layout.width} height={layout.height} />
        {list.map((t, i) => (
          <Compartment
            key={t.id}
            tenant={t}
            slot={layout.slots[i]}
            usage={usage[i]}
            isolation={eff}
            hovered={hoverId === t.id}
            highlighted={highlightId === t.id}
            showWallLabels={!!story && story.labels > 0.5 && i === Math.min(STORY_INDEX, list.length - 1)}
            onHover={handleHover}
            onSelect={handleSelect}
          />
        ))}
        <Particles tenants={list} slots={layout.slots} isolation={eff} cap={cap} emphasis={story?.ring ?? 0} />
        {story && <QuantumRing y={0} width={layout.width} amount={story.ring} />}
        <Keel width={layout.width + HULL_PAD_X * 2} y={keelY} cpu={host?.cpu_util ?? 0} mem={host?.mem_util ?? 0} />
        <ContactShadows
          position={[0, -hullH / 2 - 0.4, 0]}
          opacity={0.22}
          scale={hullW + 4}
          blur={2.6}
          far={3}
          frames={1}
          color="#14142B"
        />
      </Rig>
    </Canvas>
  );
}
