"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DoorShape } from "@/components/domain/ladder-badge";
import { levelTone, tenantColor } from "@/lib/colors";
import { eventId, sentence } from "@/lib/evidence";
import { fmtDuration } from "@/lib/format";
import { LADDER } from "@/lib/ladder";
import { axisTicks, buildLanes, fitView, panView, zoomView, type View } from "@/lib/incidents";
import type { Level, StreamEvent } from "@/lib/ws-types";

const LANE_H = 56;
const AXIS_H = 28;
const LABEL_W = 132;
const NODE_R = 14;
const HATCH_ID = "tl-hatch";
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);

interface Props {
  events: StreamEvent[]; // already filtered
  now: number;
  selectedId: string | null;
  onSelect: (e: StreamEvent) => void;
}

/** Swimlane timeline: drag to pan, wheel to zoom. SVG; the axis only renders ticks inside the view. */
export function IncidentTimeline({ events, now, selectedId, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<{ e: StreamEvent; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  const lanes = useMemo(() => buildLanes(events, now), [events, now]);
  const fit = useMemo(() => fitView(events, now), [events, now]);
  const v = view ?? fit;
  const plotW = Math.max(200, width - LABEL_W);
  const x = (t: number) => ((t - v.start) / v.span) * plotW;
  const h = AXIS_H + lanes.length * LANE_H;
  const maxSpan = Math.max(fit.span * 2, 3_600_000);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Wheel needs a non-passive listener so the page doesn't scroll while zooming.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const focus = Math.min(1, Math.max(0, (ev.clientX - rect.left - LABEL_W) / plotW));
      setView((cur) => zoomView(cur ?? fit, ev.deltaY > 0 ? 1.2 : 1 / 1.2, focus, maxSpan));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plotW, fit, maxSpan]);

  const onPointerDown = (ev: React.PointerEvent) => {
    drag.current = { x: ev.clientX, start: v.start, moved: false };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  };
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = ev.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    setView(panView({ start: d.start, span: v.span }, (-dx / plotW) * v.span));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const ticks = axisTicks(v);
  const nowX = x(now);

  return (
    <div ref={wrap} className="relative select-none overflow-hidden rounded-[var(--r-md)] bg-paper touch-none" style={{ height: h }}>
      <svg width={width} height={h} role="group" aria-label="Incident timeline. Drag to pan, scroll to zoom." className="block">
        <defs>
          <pattern id={HATCH_ID} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="8" fill="var(--bad-ink)" opacity="0.35" />
          </pattern>
          <clipPath id="tl-plot">
            <rect x={LABEL_W} y="0" width={plotW} height={h} />
          </clipPath>
        </defs>

        {/* pan surface */}
        <rect
          x={LABEL_W}
          y="0"
          width={plotW}
          height={h}
          fill="transparent"
          className="cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />

        {/* axis */}
        <g transform={`translate(${LABEL_W} 0)`} clipPath="url(#tl-plot)" pointerEvents="none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={AXIS_H - 6} y2={h} stroke="var(--line)" />
              <text x={x(t) + 4} y={AXIS_H - 10} fontSize="11" fill="var(--ink-2)" className="num">
                {clock(t)}
              </text>
            </g>
          ))}
        </g>

        {lanes.map((lane, i) => {
          const cy = AXIS_H + i * LANE_H + LANE_H / 2;
          const col = tenantColor(lane.tenant);
          return (
            <g key={lane.tenant}>
              <line x1="0" x2={width} y1={cy + LANE_H / 2} y2={cy + LANE_H / 2} stroke="var(--line)" opacity="0.6" />
              <circle cx="14" cy={cy} r="5" fill={col} />
              <text x="26" y={cy + 4} fontSize="13" fontWeight="600" fill="var(--ink)">
                {lane.tenant.length > 14 ? `${lane.tenant.slice(0, 13)}…` : lane.tenant}
              </text>
              <g transform={`translate(${LABEL_W} 0)`} clipPath="url(#tl-plot)">
                {lane.segments.map((s, k) => {
                  const tone = levelTone(s.level);
                  const x1 = x(s.from);
                  const w = Math.max(2, x(s.to) - x1);
                  return (
                    <g key={k} pointerEvents="none">
                      <rect x={x1} y={cy - 5} width={w} height="10" rx="5" fill={tone.fill} opacity={s.level === 0 ? 0.35 : 0.85} />
                      {tone.hatched ? <rect x={x1} y={cy - 5} width={w} height="10" rx="5" fill={`url(#${HATCH_ID})`} /> : null}
                      {w > 56 ? (
                        <text x={x1 + w / 2} y={cy + 20} textAnchor="middle" fontSize="11" fill="var(--ink-2)" className="num">
                          {fmtDuration((s.to - s.from) / 1000)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                {lane.events.map((e) => {
                  const id = eventId(e);
                  const ex = x(Date.parse(e.ts));
                  if (ex < -NODE_R || ex > plotW + NODE_R) return null;
                  const predicted = e.kind === "predict";
                  const level = (e.to_level ?? 0) as Level;
                  const tone = levelTone(level);
                  const selected = selectedId === id;
                  const label = `${lane.tenant}, ${predicted ? "predicted " : ""}${LADDER[level].name} (level ${level}) at ${clock(Date.parse(e.ts))}. Open explanation.`;
                  return (
                    <g
                      key={id}
                      transform={`translate(${ex} ${cy})`}
                      role="button"
                      tabIndex={0}
                      aria-label={label}
                      className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-ultra"
                      onClick={() => !drag.current?.moved && onSelect(e)}
                      onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), onSelect(e))}
                      onPointerEnter={() => setHover({ e, x: LABEL_W + ex, y: cy })}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover({ e, x: LABEL_W + ex, y: cy })}
                      onBlur={() => setHover(null)}
                    >
                      {selected ? <circle r={NODE_R + 5} fill="none" stroke="var(--ink)" strokeWidth="2.5" /> : null}
                      <circle
                        r={NODE_R}
                        fill={predicted ? "var(--surface)" : tone.fill}
                        stroke={predicted ? "var(--ultra)" : "var(--ink)"}
                        strokeWidth={predicted ? 2.5 : 1.5}
                        strokeDasharray={predicted ? "4 3" : undefined}
                      />
                      <g transform="translate(-8 -8)" color={predicted ? "var(--ultra)" : "var(--ink)"}>
                        <DoorShape level={level} />
                      </g>
                    </g>
                  );
                })}
              </g>
            </g>
          );
        })}

        {/* now line */}
        {nowX >= 0 && nowX <= plotW ? (
          <g transform={`translate(${LABEL_W + nowX} 0)`} pointerEvents="none">
            <line y1={AXIS_H - 6} y2={h} stroke="var(--ultra)" strokeWidth="2" />
            <rect x="-17" y="0" width="34" height="16" rx="8" fill="var(--ultra)" />
            <text y="12" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
              now
            </text>
          </g>
        ) : null}
      </svg>

      {hover ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-[70] max-w-[280px] rounded-[var(--r-md)] border border-line bg-surface p-3 text-[13px] shadow-[var(--shadow-2)]"
          style={{ left: Math.min(Math.max(8, hover.x - 120), Math.max(8, width - 288)), top: Math.min(hover.y + 22, h - 8) }}
        >
          <div className="num text-ink-2">
            {clock(Date.parse(hover.e.ts))} · {hover.e.kind}
            {hover.e.kind === "predict" ? " (forecast)" : ""}
          </div>
          <div className="mt-0.5 font-semibold">
            {hover.e.tenant_id}
            {hover.e.from_level !== undefined && hover.e.to_level !== undefined ? ` · L${hover.e.from_level} → L${hover.e.to_level}` : ""}
          </div>
          <div className="mt-1 line-clamp-3 text-ink-2">{sentence(hover.e)}</div>
        </div>
      ) : null}

      <div className="absolute right-3 bottom-2 flex gap-2">
        <button
          type="button"
          onClick={() => setView(null)}
          className="h-8 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold text-ink-2 outline-none hover:text-ink focus-visible:shadow-[var(--ring)]"
        >
          Fit all
        </button>
      </div>
    </div>
  );
}
