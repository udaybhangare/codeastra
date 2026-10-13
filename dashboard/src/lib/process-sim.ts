// Illustrative, deterministic model of tenants' processes sharing one host (docs/09 scenarios).
// Not a backend run: a stylised fluid model so the Scenario Lab has something alive to watch.
// Pure: time only advances through step(dtMs); same (scenario, seed, isolation) → same states.
// Relative imports only so `node --test` can load this file.
import type { Isolation, Level, Tier } from "./ws-types.ts";

export type SimRole = "victim" | "burst" | "abuser";
export type EventTone = "ok" | "warn" | "bad";

export interface SimTenant {
  id: string;
  tier: Tier;
  role: SimRole;
  level: Level;
  /** Highest ladder level reached so far (false-positive probe). */
  peakLevel: Level;
  down: boolean;
  /** Offered load incl. retries (req/s). */
  arrivalRps: number;
  servedRps: number;
  rejectedRps: number;
  queue: number;
  p99Ms: number;
  baselineP99Ms: number;
  peakInflation: number;
  cpu: number;
  memMb: number;
  errors: number;
  rejected: number;
  kills: number;
}

export interface SimEvent {
  tS: number;
  tenant: string;
  text: string;
  tone: EventTone;
}

export interface SimState {
  tS: number;
  durationS: number;
  phase: "warm-up" | "attack" | "cool-down";
  done: boolean;
  isolation: Isolation;
  tenants: SimTenant[];
  /** Host utilisation, 0..1+ (cpu, db connections, bandwidth, memory). */
  host: { cpu: number; db: number; bw: number; mem: number };
  events: SimEvent[];
  /** Victim p99 inflation (worst victim, ×baseline) sampled once per second. */
  inflationSeries: number[];
}

export interface SimSummary {
  victimInflation: number;
  victimErrors: number;
  abuserRejected: number;
  falsePositives: number;
  victimKills: number;
  abuserKills: number;
}

export const TICK_MS = 100;
export const DURATION_S = 50;
export const ATTACK_START_S = 8;
export const ATTACK_END_S = 38;
const CAP = { cpu: 60, db: 20, bw: 100 } as const; // units/s, connections, MB/s
const HOST_MEM_MB = 8192;
const WEIGHT: Record<Tier, number> = { free: 1, pro: 1.5, enterprise: 2 };
const LEVEL_CAP_FACTOR: Record<number, number> = { 0: Infinity, 1: 1.5, 2: 0.5, 3: 0.2 };
const FLAG_AFTER_S = [1.5, 3, 6]; // dwell time before L1, L2, L3
const CALM_S = 5;
const OOM_DOWN_S = 4;
const RESTART_S = 3;

interface Cost {
  cpu: number;
  db: number;
  bw: number;
}
interface Def {
  id: string;
  tier: Tier;
  role: SimRole;
  contractRps: number;
  baseMs: number;
  cost: Cost;
  rate: (t: number) => number;
  mem: (t: number) => number;
  memLimitMb: number;
  /** Extra offered req/s per rejected req/s of the previous tick (naive retry loop). */
  retry?: number;
}

const attack = (t: number) => t >= ATTACK_START_S && t < ATTACK_END_S;
const ramp = (t: number) => Math.min(1, Math.max(0, (t - ATTACK_START_S) / (ATTACK_END_S - ATTACK_START_S)));
const flat = (v: number) => () => v;
const c = (cpu: number, db = 0.02, bw = 0.05): Cost => ({ cpu, db, bw });

function victims(opts: { burst?: boolean } = {}): Def[] {
  return [
    { id: "acme-shop", tier: "pro", role: "victim", contractRps: 60, baseMs: 40, cost: c(0.5, 0.02, 0.05), rate: flat(30), mem: flat(900), memLimitMb: 1536 },
    { id: "data-co", tier: "enterprise", role: "victim", contractRps: 30, baseMs: 90, cost: c(1.0, 0.3, 0.2), rate: flat(12), mem: flat(1500), memLimitMb: 2048 },
    {
      id: "bursty-news",
      tier: "free",
      role: "burst",
      contractRps: 150,
      baseMs: 30,
      cost: c(0.2, 0.01, 0.1),
      rate: opts.burst ? (t) => (t >= ATTACK_START_S && t < 28 ? 100 : 10) : flat(10),
      mem: flat(700),
      memLimitMb: 1536,
    },
    { id: "leaky-app", tier: "pro", role: "victim", contractRps: 30, baseMs: 50, cost: c(0.5, 0.02, 0.05), rate: flat(10), mem: (t) => 600 + 8 * t, memLimitMb: 1536 },
  ];
}

function rogue(id: string, over: Partial<Def>): Def {
  return {
    id,
    tier: "free",
    role: "abuser",
    contractRps: 10,
    baseMs: 200,
    cost: c(0.5, 0.02, 0.05),
    rate: (t) => (attack(t) ? 20 : 1),
    mem: flat(300),
    memLimitMb: 1024,
    ...over,
  };
}

const memBomb = (t: number) => (t < ATTACK_START_S ? 300 : 300 + Math.min(1, (t - ATTACK_START_S) / 6) * 4200);

export function scenarioDefs(id: string): Def[] {
  switch (id) {
    case "S2":
      return [...victims(), rogue("rogue-ml", { rate: (t) => (attack(t) ? 2 : 1), mem: memBomb })];
    case "S3":
      return [...victims(), rogue("rogue-ml", { rate: (t) => (attack(t) ? 15 : 1), cost: c(0.1, 1.5, 0.05) })];
    case "S4":
      return [...victims(), rogue("rogue-ml", { rate: (t) => (attack(t) ? 14 : 1), cost: c(2.0), retry: 3 })];
    case "S5":
      return [...victims(), rogue("rogue-ml", { rate: (t) => 1 + 59 * ramp(t), cost: c(1.0) })];
    case "S6":
      return [...victims({ burst: true }), rogue("rogue-ml", { rate: flat(1) })];
    case "S7":
      return [
        ...victims(),
        rogue("rogue-ml", { rate: (t) => (attack(t) ? 20 : 1), cost: c(1.0) }),
        rogue("scraper-x", { rate: (t) => (attack(t) ? 25 : 1), cost: c(1.0) }),
      ];
    case "S8":
      return [...victims(), rogue("rogue-ml", { rate: (t) => (attack(t) ? 14 : 1), cost: c(0.2, 0.02, 12) })];
    case "S1":
    default:
      return [...victims(), rogue("rogue-ml", { rate: (t) => (attack(t) ? 20 : 1), cost: c(2.0) })];
  }
}

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

/** Weighted max-min fair split of `cap` over `wants` (each already limited). */
export function maxMinFair(cap: number, wants: number[], weights: number[]): number[] {
  const out = wants.map(() => 0);
  let left = cap;
  let open = wants.map((_, i) => i);
  while (open.length > 0 && left > 1e-9) {
    const wsum = open.reduce((a, i) => a + weights[i], 0);
    const per = left / wsum;
    const sat = open.filter((i) => wants[i] - out[i] <= per * weights[i] + 1e-9);
    if (sat.length === 0) {
      for (const i of open) out[i] += per * weights[i];
      return out;
    }
    for (const i of sat) {
      left -= wants[i] - out[i];
      out[i] = wants[i];
    }
    open = open.filter((i) => !sat.includes(i));
  }
  return out;
}

interface Internal {
  def: Def;
  t: SimTenant;
  memShift: number;
  downUntil: number;
  flaggedFor: number;
  calmFor: number;
  everFlagged: boolean;
  prevRejected: number;
}

export class ProcessSim {
  private tS = 0;
  private acc = 0;
  private rand: () => number;
  private items: Internal[];
  private events: SimEvent[] = [];
  private series: number[] = [];
  private host = { cpu: 0, db: 0, bw: 0, mem: 0 };
  private phase: SimState["phase"] = "warm-up";

  readonly isolation: Isolation;

  constructor(scenarioId: string, seed: number, isolation: Isolation) {
    this.isolation = isolation;
    this.rand = rng(seed ^ 0x9e3779b9);
    this.items = scenarioDefs(scenarioId).map((def) => ({
      def,
      memShift: 0,
      downUntil: 0,
      flaggedFor: 0,
      calmFor: 0,
      everFlagged: false,
      prevRejected: 0,
      t: {
        id: def.id,
        tier: def.tier,
        role: def.role,
        level: 0,
        peakLevel: 0,
        down: false,
        arrivalRps: 0,
        servedRps: 0,
        rejectedRps: 0,
        queue: 0,
        p99Ms: def.baseMs * 2.2,
        baselineP99Ms: def.baseMs * 2.2,
        peakInflation: 1,
        cpu: 0,
        memMb: def.mem(0),
        errors: 0,
        rejected: 0,
        kills: 0,
      },
    }));
  }

  get done() {
    return this.tS >= DURATION_S - 1e-9;
  }

  /** Advance by dtMs of simulated time (fixed 100 ms ticks, remainder carried). */
  step(dtMs: number) {
    this.acc += dtMs;
    while (this.acc >= TICK_MS && !this.done) {
      this.acc -= TICK_MS;
      this.tick(TICK_MS / 1000);
    }
  }

  snapshot(): SimState {
    return {
      tS: this.tS,
      durationS: DURATION_S,
      phase: this.phase,
      done: this.done,
      isolation: this.isolation,
      tenants: this.items.map((i) => ({ ...i.t })),
      host: { ...this.host },
      events: this.events.slice(-40),
      inflationSeries: this.series.slice(),
    };
  }

  private log(tenant: string, text: string, tone: EventTone) {
    this.events.push({ tS: Math.round(this.tS * 10) / 10, tenant, text, tone });
  }

  private tick(dt: number) {
    const t = (this.tS += dt);
    const on = this.isolation === "on";
    const prevPhase = this.phase;
    this.phase = t < ATTACK_START_S ? "warm-up" : t < ATTACK_END_S ? "attack" : "cool-down";
    if (prevPhase !== this.phase) this.log("host", `Phase: ${this.phase}`, "ok");

    // restarts
    for (const it of this.items) {
      if (it.t.down && t >= it.downUntil) {
        it.t.down = false;
        it.memShift = Math.max(0, t - ATTACK_START_S);
        this.log(it.def.id, "restarted", "ok");
      }
    }

    // offered load
    for (const it of this.items) {
      const jitter = 1 + (this.rand() - 0.5) * 0.12;
      let a = it.def.rate(t) * jitter;
      const quarantined = on && it.t.level >= 3;
      if (it.def.retry && !quarantined) a += it.def.retry * it.prevRejected;
      it.t.arrivalRps = Math.min(a, 150);
    }

    // memory + OOM
    let memSum = 0;
    for (const it of this.items) {
      it.t.memMb = it.t.down ? 0 : Math.round(it.def.mem(t - it.memShift));
      memSum += it.t.memMb;
    }
    if (on) {
      for (const it of this.items) {
        if (!it.t.down && it.t.memMb > it.def.memLimitMb) this.kill(it, RESTART_S, `OOM-killed at its ${it.def.memLimitMb} MB cgroup limit; only this container restarted`);
      }
    } else if (memSum > HOST_MEM_MB) {
      this.log("host", "Host out of memory: the shared worker process was killed, every tenant is down", "bad");
      for (const it of this.items) {
        if (!it.t.down) this.kill(it, OOM_DOWN_S, null);
      }
    }
    this.host.mem = this.items.reduce((a, i) => a + i.t.memMb, 0) / HOST_MEM_MB;

    // isolation ladder (ON only)
    const live = this.items.filter((i) => !i.t.down);
    const n = Math.max(1, live.length);
    if (on) {
      for (const it of live) {
        const a = it.t.arrivalRps;
        const pressure = Math.max(
          (a * it.def.cost.cpu) / (CAP.cpu / n),
          (a * it.def.cost.db) / (CAP.db / n),
          (a * it.def.cost.bw) / (CAP.bw / n),
        );
        const flagged = a > it.def.contractRps && pressure > 1.25;
        if (flagged) {
          it.flaggedFor += dt;
          it.calmFor = 0;
        } else {
          it.calmFor += dt;
          it.flaggedFor = 0;
        }
        const target = it.flaggedFor >= FLAG_AFTER_S[2] ? 3 : it.flaggedFor >= FLAG_AFTER_S[1] ? 2 : it.flaggedFor >= FLAG_AFTER_S[0] ? 1 : 0;
        if (target > it.t.level) {
          it.t.level = target as Level;
          it.t.peakLevel = Math.max(it.t.peakLevel, target) as Level;
          it.everFlagged = true;
          this.log(it.def.id, `escalated to L${target} (${["", "observe", "soft throttle", "hard throttle"][target]})`, target >= 2 ? "bad" : "warn");
        } else if (it.t.level > 0 && it.calmFor >= CALM_S) {
          it.t.level = (it.t.level - 1) as Level;
          it.calmFor = 0;
          this.log(it.def.id, `de-escalated to L${it.t.level}`, "ok");
        }
      }
    }

    // allocation per resource
    const wsum = live.reduce((a, i) => a + WEIGHT[i.t.tier], 0) || 1;
    const rpsCap = new Map<Internal, number>();
    const want = new Map<Internal, number>(); // req/s asked of the pool
    for (const it of live) {
      let cap = Infinity;
      if (on) {
        const f = LEVEL_CAP_FACTOR[it.t.level] ?? Infinity;
        const share = WEIGHT[it.t.tier] / wsum;
        for (const r of ["cpu", "db", "bw"] as const) {
          if (it.def.cost[r] > 0) cap = Math.min(cap, (f * CAP[r] * share) / it.def.cost[r]);
        }
      }
      rpsCap.set(it, cap);
      const offered = it.t.level >= 2 && on ? Math.min(it.t.arrivalRps, cap) : it.t.arrivalRps;
      want.set(it, Math.min(offered + it.t.queue, cap));
    }
    const grantedRps = new Map<Internal, number>();
    for (const it of live) grantedRps.set(it, Infinity);
    for (const r of ["cpu", "db", "bw"] as const) {
      const wants = live.map((i) => (want.get(i) ?? 0) * i.def.cost[r]);
      const total = wants.reduce((a, b) => a + b, 0);
      let alloc: number[];
      if (on) alloc = maxMinFair(CAP[r], wants, live.map((i) => WEIGHT[i.t.tier]));
      else {
        const f = total > CAP[r] ? CAP[r] / total : 1;
        alloc = wants.map((w) => w * f);
      }
      live.forEach((it, k) => {
        if (it.def.cost[r] > 0) grantedRps.set(it, Math.min(grantedRps.get(it) ?? Infinity, alloc[k] / it.def.cost[r]));
      });
      this.host[r] = Math.min(1.5, total / CAP[r]);
    }

    // per-tenant outcome
    let worst = 1;
    for (const it of this.items) {
      const s = it.t;
      if (s.down) {
        s.servedRps = 0;
        s.rejectedRps = s.arrivalRps;
        s.queue = 0;
        s.errors += s.arrivalRps * dt;
        s.cpu = 0;
        it.prevRejected = 0;
        continue;
      }
      const a = s.arrivalRps;
      const cap = rpsCap.get(it) ?? Infinity;
      const served = Math.min(grantedRps.get(it) ?? 0, want.get(it) ?? 0);
      let rejected = on && s.level >= 2 ? Math.max(0, a - cap) : 0;
      const admitted = a - rejected;
      let queue = Math.max(0, s.queue + (admitted - served) * dt);
      const maxQ = 3 * Math.max(a, 5);
      if (queue > maxQ) {
        rejected += (queue - maxQ) / dt;
        queue = maxQ;
      }
      s.servedRps = served;
      s.rejectedRps = rejected;
      s.queue = queue;
      s.rejected += rejected * dt;
      s.cpu = served * it.def.cost.cpu;
      it.prevRejected = rejected;
      const target = it.def.baseMs * 2.2 + (queue / Math.max(served, 0.5)) * 1000;
      s.p99Ms = Math.min(30000, s.p99Ms + (target - s.p99Ms) * 0.4);
      s.peakInflation = Math.max(s.peakInflation, s.p99Ms / s.baselineP99Ms);
      if (s.role !== "abuser") worst = Math.max(worst, s.p99Ms / s.baselineP99Ms);
    }
    if (Math.floor(t) !== Math.floor(t - dt)) this.series.push(Math.round(worst * 10) / 10);
  }

  private kill(it: Internal, downS: number, why: string | null) {
    it.t.down = true;
    it.t.kills += 1;
    it.t.queue = 0;
    it.t.level = 0;
    it.flaggedFor = 0;
    it.downUntil = this.tS + downS;
    if (why) this.log(it.def.id, why, "bad");
  }
}

export function summarize(s: SimState): SimSummary {
  const v = s.tenants.filter((t) => t.role !== "abuser");
  const a = s.tenants.filter((t) => t.role === "abuser");
  const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
  return {
    victimInflation: Math.max(1, ...v.map((t) => t.peakInflation)),
    victimErrors: Math.round(sum(v.map((t) => t.errors))),
    abuserRejected: Math.round(sum(a.map((t) => t.rejected))),
    falsePositives: v.filter((t) => t.peakLevel > 0).length,
    victimKills: sum(v.map((t) => t.kills)),
    abuserKills: sum(a.map((t) => t.kills)),
  };
}
