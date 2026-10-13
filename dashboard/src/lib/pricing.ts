// Illustrative pricing model for the landing page (docs/PITCH.md §5). Not validated with customers.
// 1 credit = 1 metered cost unit from the usage ledger. Pure functions: no clock, no I/O.

export type PlanId = "community" | "team" | "enterprise";

export interface Plan {
  id: PlanId;
  name: string;
  /** USD per node per month. */
  nodeFee: number;
  /** Credits included per node per month. */
  includedPerNode: number;
  /** USD per 1,000,000-credit overage pack. null = overage not sold (plan has a hard cap). */
  packPrice: number | null;
  /** Hard caps (Community only). */
  maxNodes?: number;
  maxClientsPerNode?: number;
}

export const CREDITS_PER_PACK = 1_000_000;

export const PLANS: Record<PlanId, Plan> = {
  community: { id: "community", name: "Community", nodeFee: 0, includedPerNode: 100_000, packPrice: null, maxNodes: 1, maxClientsPerNode: 5 },
  team: { id: "team", name: "Team", nodeFee: 149, includedPerNode: 5_000_000, packPrice: 8 },
  enterprise: { id: "enterprise", name: "Enterprise", nodeFee: 499, includedPerNode: 25_000_000, packPrice: 6 },
};

/** Average metered credits one container client burns per month. */
export const ACTIVITY = {
  light: { label: "Light", creditsPerClient: 5_000 },
  medium: { label: "Medium", creditsPerClient: 25_000 },
  heavy: { label: "Heavy", creditsPerClient: 100_000 },
} as const;
export type Activity = keyof typeof ACTIVITY;

export interface Estimate {
  plan: PlanId;
  /** False when the plan's hard caps (nodes, clients, credits) are exceeded. */
  fits: boolean;
  creditsUsed: number;
  creditsIncluded: number;
  overagePacks: number;
  baseCost: number;
  overageCost: number;
  total: number;
}

export function estimate(plan: PlanId, nodes: number, clientsPerNode: number, activity: Activity): Estimate {
  const p = PLANS[plan];
  const n = Math.max(0, Math.floor(nodes));
  const c = Math.max(0, Math.floor(clientsPerNode));
  const creditsUsed = n * c * ACTIVITY[activity].creditsPerClient;
  const creditsIncluded = n * p.includedPerNode;
  const over = Math.max(0, creditsUsed - creditsIncluded);
  const overagePacks = p.packPrice === null ? 0 : Math.ceil(over / CREDITS_PER_PACK);
  const baseCost = n * p.nodeFee;
  const overageCost = overagePacks * (p.packPrice ?? 0);
  const capped = p.maxNodes !== undefined && (n > p.maxNodes || c > (p.maxClientsPerNode ?? Infinity));
  const fits = !capped && (p.packPrice !== null || over === 0);
  return { plan, fits, creditsUsed, creditsIncluded, overagePacks, baseCost, overageCost, total: baseCost + overageCost };
}

/** Cheapest plan that fits; Team is the fallback so the calculator always shows a number. */
export function recommend(nodes: number, clientsPerNode: number, activity: Activity): Estimate {
  const free = estimate("community", nodes, clientsPerNode, activity);
  if (free.fits) return free;
  return estimate("team", nodes, clientsPerNode, activity);
}
