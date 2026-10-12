// Number / duration / cost formatters. Pair with the `.num` class (mono, tabular).
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function fmtInt(n: number): string {
  return Number.isFinite(n) ? nf0.format(n) : "–";
}

export function fmtNum(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(ratio: number, digits = 0): string {
  return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(digits)}%` : "–";
}

/** 1 234 → "1.2k", 3 400 000 → "3.4M". */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return fmtInt(n);
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${n < 0 ? "-" : ""}${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

/** Seconds → "45s", "3m 05s", "1h 02m". */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtUsd(n: number, digits = 2): string {
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : "–";
}
