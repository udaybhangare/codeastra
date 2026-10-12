import type { Level, Snapshot, StreamEvent, TenantMetrics, Tier } from "./ws-types";

// Deterministic mock of /admin/stream so the dashboard runs with no backend.
// Scenario: tenant "noisy" floods CPU at t=20s; ladder escalates; victims recover.
// Tenant ids are data, not UI constants: the UI renders whatever arrives.
const TENANTS: { id: string; tier: Tier; base: number }[] = [
  { id: "acme", tier: "enterprise", base: 60 },
  { id: "globex", tier: "pro", base: 45 },
  { id: "initech", tier: "pro", base: 50 },
  { id: "umbrella", tier: "free", base: 40 },
  { id: "noisy", tier: "free", base: 30 },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MockStream {
  private t = 0;
  private level: Level = 0;
  private rand = rng(42);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private onMessage: (raw: string) => void,
    private onOpen: () => void,
  ) {}

  start() {
    queueMicrotask(this.onOpen);
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(m: Snapshot | StreamEvent) {
    this.onMessage(JSON.stringify(m));
  }

  private tick() {
    this.t += 1;
    const phase = this.t % 120; // 2-min loop
    const attacking = phase >= 20 && phase < 80;
    const prev = this.level;
    if (attacking) {
      if (phase >= 24 && this.level < 1) this.level = 1;
      if (phase >= 30 && this.level < 2) this.level = 2;
      if (phase >= 40 && this.level < 3) this.level = 3;
    } else if (phase >= 80 && this.level > 0 && phase % 5 === 0) {
      this.level = (this.level - 1) as Level;
    } else if (phase < 20) this.level = 0;

    const ts = new Date(Date.UTC(2026, 0, 1) + this.t * 1000).toISOString();
    if (this.level !== prev) {
      this.emit({
        type: "event",
        ts,
        kind: "throttle",
        tenant_id: "noisy",
        from_level: prev,
        to_level: this.level,
        message: `noisy moved L${prev} → L${this.level}`,
      });
    }

    const pressure = attacking ? 1 - this.level * 0.28 : 0;
    const tenants: TenantMetrics[] = TENANTS.map((tn) => {
      const noisy = tn.id === "noisy";
      const j = () => 0.9 + this.rand() * 0.2;
      const rps = noisy ? (attacking ? 400 / (1 + this.level * 1.5) : tn.base) : tn.base * j();
      const infl = noisy ? 1 + (attacking ? 2 : 0) : 1 + Math.max(0, pressure) * 6;
      const p50 = (12 + this.rand() * 3) * infl;
      const cpu = noisy ? (attacking ? 0.75 - this.level * 0.15 : 0.1) : 0.12 * (1 - Math.max(0, pressure) * 0.3);
      return {
        tenant_id: tn.id,
        tier: tn.tier,
        level: noisy ? this.level : 0,
        rps,
        ok_rps: rps * 0.97,
        rejected_rps: noisy && this.level > 0 ? rps * 0.3 : 0,
        queue_depth: Math.round(noisy ? (attacking ? 200 / (1 + this.level) : 2) : pressure * 20 * this.rand()),
        p50_ms: p50,
        p95_ms: p50 * 2.2,
        p99_ms: p50 * 3.5 * j(),
        cpu_share: Math.min(1, Math.max(0, cpu)),
        mem_mb: 120 + (noisy && attacking ? 600 - this.level * 150 : 0) + this.rand() * 20,
        db_conns: noisy && attacking ? 18 - this.level * 4 : 3,
        bytes_s: rps * 2048,
        p_overload: noisy ? Math.min(1, Math.max(0, pressure)) : 0,
      };
    });

    const cpuUtil = Math.min(1, tenants.reduce((a, x) => a + x.cpu_share, 0) + 0.08);
    this.emit({
      type: "snapshot",
      ts,
      isolation: "on",
      host: { cpu_util: cpuUtil, mem_util: 0.35 + (attacking ? 0.2 : 0), db_conn_util: attacking ? 0.5 : 0.15, p_overload: Math.max(0, pressure) },
      fairness: { jain: 1 - Math.max(0, pressure) * 0.4, victim_inflation: 1 + Math.max(0, pressure) * 5 },
      tenants,
    });
  }
}
