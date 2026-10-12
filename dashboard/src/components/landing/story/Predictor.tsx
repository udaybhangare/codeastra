"use client";
// §6 See it coming: forecast vs actual (illustrative sparkline) while the hull shows ghost water.
import { Copy, Eyebrow, H2, Panel } from "./parts";

// Illustrative series (not measured): actual climbs, forecast leads it by ~10 s.
const ACTUAL = [0.22, 0.24, 0.23, 0.27, 0.3, 0.36, 0.42];
const FORECAST = [0.26, 0.3, 0.36, 0.46, 0.6, 0.76, 0.88];
const W = 240;
const H = 72;
const pts = (xs: number[]) =>
  xs.map((v, i) => `${(i / (xs.length - 1)) * W},${H - 6 - v * (H - 12)}`).join(" ");

export function Predictor() {
  return (
    <Panel id="predictor" labelledBy="predictor-title">
      <Copy>
        <Eyebrow n="05">See it coming</Eyebrow>
        <H2 id="predictor-title">Forecast 10 seconds ahead. Advisory only.</H2>
        <p className="mt-4 text-[18px] leading-relaxed text-ink-2">
          A small predictor draws a ghost water level ahead of the real one. It can nudge the ladder earlier, but the rules stay in
          charge, and Bulkhead works with the predictor switched off.
        </p>
        <figure className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-1)]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full" role="img" aria-label="Forecast rises ahead of actual usage">
            <polyline points={pts(ACTUAL)} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <polyline
              points={pts(FORECAST)}
              fill="none"
              stroke="var(--ultra)"
              strokeWidth="2.5"
              strokeDasharray="2 6"
              strokeLinecap="round"
            />
          </svg>
          <figcaption className="mt-2 flex flex-wrap gap-x-4 text-[13px] text-ink-2">
            <span>
              <span aria-hidden className="mr-1 inline-block h-0.5 w-4 bg-ink align-middle" />
              Actual
            </span>
            <span>
              <span aria-hidden className="mr-1 inline-block w-4 border-t-2 border-dotted border-ultra align-middle" />
              Forecast
            </span>
            <span className="ml-auto">illustrative</span>
          </figcaption>
        </figure>
      </Copy>
    </Panel>
  );
}
