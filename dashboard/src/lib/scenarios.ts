// Scenario catalogue, transcribed from docs/09 (names/attacks/expected outcomes).
export interface ScenarioInfo {
  id: string;
  name: string;
  attack: string;
  expected: string;
  assertion: string;
  defaultSeed: number;
}

export const SCENARIOS: ScenarioInfo[] = [
  { id: "S1", name: "CPU Flood", attack: "rogue-ml sends 20 rps of 2 s cpu-burn tasks.", expected: "Throttled to Soft then Hard within ~8 s; victims stay near baseline.", assertion: "Victim p99 ≤ 1.5× baseline", defaultSeed: 42 },
  { id: "S2", name: "Memory Bomb", attack: "rogue-ml allocates 4 GB.", expected: "Only the rogue container is OOM-killed and restarted.", assertion: "Victims see 0 errors", defaultSeed: 42 },
  { id: "S3", name: "DB Connection Hog", attack: "Slow queries hold database connections.", expected: "Rogue is capped at its own connections; data-co is unaffected.", assertion: "data-co p99 ≤ 2×", defaultSeed: 42 },
  { id: "S4", name: "Retry Storm", attack: "rogue-ml retries every 429 without backoff.", expected: "Moved to the quarantine lane; queue stays protected.", assertion: "Queue wait stays bounded", defaultSeed: 42 },
  { id: "S5", name: "Slow Ramp", attack: "Load ramps over 60 s to slip under thresholds.", expected: "Caught by victim-impact detection or the predictor.", assertion: "Detected before p99 > 2×", defaultSeed: 42 },
  { id: "S6", name: "Legit Flash Crowd", attack: "bursty-news legitimately spikes 10× for 20 s, within limits.", expected: "NOT throttled: served via burst allowance.", assertion: "False positives = 0", defaultSeed: 42 },
  { id: "S7", name: "Multi-abuser", attack: "Two abusers attack at once.", expected: "Both handled; victims protected.", assertion: "Jain's index ≥ 0.8", defaultSeed: 42 },
  { id: "S8", name: "Bandwidth Flood", attack: "Very large payloads.", expected: "Byte-rate bucket enforced.", assertion: "Other tenants' throughput stable", defaultSeed: 42 },
];
