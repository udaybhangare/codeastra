// Illustrated static hull: Suspense poster and WebGL failure fallback (docs/ui/03).
import type { HullTenant } from "@/lib/hull";

const FILL = ["#17C37B", "#FFC233", "#FFA500", "#F2305C", "#C9163F", "#F2305C"];

export function StaticHullPoster({ tenants }: { tenants?: HullTenant[] }) {
  const n = Math.min(Math.max(tenants?.length ?? 5, 3), 6);
  const cw = 100;
  const gap = 16;
  const w = n * cw + (n - 1) * gap;
  return (
    <svg
      role="img"
      aria-label="Ship hull with sealed tenant compartments"
      viewBox={`${-40} ${-30} ${w + 80} 240`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={`M${-30} -10 H${w + 30} V120 Q${w + 30} 190 ${w - 40} 190 H${-30 + 70} Q${-30} 190 ${-30} 120 Z`}
        fill="#FFFFFF"
        stroke="#E4DED3"
        strokeWidth="2"
      />
      <rect x={-34} y={-18} width={w + 68} height={12} rx={6} fill="#3B2EFF" />
      {Array.from({ length: n }, (_, i) => {
        const t = tenants?.[i];
        const usage = Math.min(1, t?.usage ?? 0.3 + (i % 3) * 0.15);
        const lvl = t?.level ?? 0;
        const x = i * (cw + gap);
        const h = 140 * usage;
        return (
          <g key={t?.id ?? i}>
            <rect x={x} y={10} width={cw} height={150} rx={12} fill="#F2F1FF" stroke="#E4DED3" />
            <rect x={x + 4} y={156 - h} width={cw - 8} height={h} rx={8} fill={FILL[lvl]} opacity={0.85} />
            <rect x={x + cw + 3} y={10} width={6} height={(150 * Math.max(lvl, 0.5)) / 5} fill={FILL[lvl]} />
          </g>
        );
      })}
    </svg>
  );
}
