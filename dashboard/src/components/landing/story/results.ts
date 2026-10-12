// Numbers shown in the proof bento. Source: docs/RESULTS.md (§4 repeatability S1 A/B x5 seeds 101-105,
// medians; §3 S6 flash crowd, one run). Do not edit without re-running the verify scripts.
export const RESULTS = {
  source: "docs/RESULTS.md",
  /** Victim p99 inflation (x), median of 5 seeds. */
  inflation: { off: 19810, on: 0.97 },
  /** S6 flash crowd, isolation ON, one run. */
  falsePositives: 0,
  /** Victim throughput ratio attack/warm-up (%), median of 5 seeds. */
  throughputPct: { off: 73, on: 92 },
} as const;
