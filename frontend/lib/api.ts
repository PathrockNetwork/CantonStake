const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

export interface PositionRow {
  contractId: string;
  argument: {
    delegator: string;
    evmAddress: string;
    amountPol: string;
    status: "Pending" | "Bonded" | "Unbonding" | "Released" | "Cancelled";
    bondedAt?: string;
    unbondingStartedAt?: string;
    unbondingReadyAt?: string;
    releasedAt?: string;
    markersEmitted: number;
  };
}

export interface RequestRow {
  contractId: string;
  argument: {
    delegator: string;
    evmAddress: string;
    amountPol: string;
    requestedAt: string;
  };
}

export interface RewardsSummary {
  address: string;
  totalPositions: number;
  totalBondedPol: number;
  totalMarkersEmitted: number;
  estimatedCcEarned: number;
  totalCcEarned: number;
  totalUserShare: number;
  totalTreasuryShare: number;
  userShare: number;
  appShare: number;
  rewardEventCount: number;
  totalNativeRewardsSweptWei: string;
  totalNativeRewardsSweptPol: number;
  totalProtocolFeeWei: string;
  totalProtocolFeePol: number;
  totalUserPayoutWei: string;
  totalUserPayoutPol: number;
  rewardSweepCount: number;
}

export async function createStakingRequest(body: {
  evmAddress: string;
  amountPol: string;
  delegator: string;
}): Promise<{ ok: boolean; transactionId: string; delegator: string }> {
  const res = await fetch(`${BACKEND_URL}/api/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function upsertUser(body: {
  cantonPartyId: string;
  evmAddress?: string;
  displayName?: string;
}) {
  const res = await fetch(`${BACKEND_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sweepNativeRewards(positionId: string) {
  const res = await fetch(
    `${BACKEND_URL}/api/sweep/${encodeURIComponent(positionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchPositions(address: string): Promise<PositionRow[]> {
  const res = await fetch(`${BACKEND_URL}/api/positions?address=${address}`);
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { positions: PositionRow[] };
  return json.positions;
}

export async function fetchPendingRequests(
  address: string
): Promise<RequestRow[]> {
  const res = await fetch(`${BACKEND_URL}/api/requests?address=${address}`);
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { requests: RequestRow[] };
  return json.requests;
}

export async function fetchRewards(address: string): Promise<RewardsSummary> {
  const res = await fetch(`${BACKEND_URL}/api/rewards/${address}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface RoundSummary {
  roundNumber: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  relativeTime: string;
  totalCcMinted: string;
  totalTxns: number;
  totalMarkers: number;
  userTrafficSharePct: number | null;
  userCcAttributed: string | null;
}

export async function fetchRecentRounds(
  address: string | undefined,
  limit = 10,
): Promise<{ rounds: RoundSummary[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (address) params.set("address", address);
  const res = await fetch(`${BACKEND_URL}/api/rewards/rounds?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface MarkerBucket {
  t: string;
  markers: number;
  cc: number;
}

export interface AnalyticsMarkers {
  since: string;
  hours: number;
  scope: "user" | "global";
  series: MarkerBucket[];
  insight: {
    totalMarkers: number;
    priorTotalMarkers: number;
    deltaPct: number | null;
  };
  breakdown: {
    bondCount: number;
    unbondCount: number;
    bondPct: number;
    unbondPct: number;
  };
}

export interface RewardHealth {
  status: "ok" | "failing" | "idle" | string;
  totalSampled: number;
  completed?: number;
  failed?: number;
  skipped?: number;
  successRatePct: number | null;
  lastRound: {
    roundNumber: number;
    status: string;
    completedAt: string | null;
    totalCcMinted: string;
    totalMarkers: number;
    error: string | null;
  } | null;
}

export interface ChainStat {
  chain: string;
  validatorCount: number;
  totalStaked: number;
  medianCommissionPct: number;
  apyPctEstimate: number;
  baseYieldPct: number;
  source: "live" | "cache" | "stub";
  fetchedAt: string;
}

export async function fetchChainStats(): Promise<{ chains: ChainStat[] }> {
  const res = await fetch(`${BACKEND_URL}/api/chains/stats`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRewardHealth(): Promise<RewardHealth> {
  const res = await fetch(`${BACKEND_URL}/api/rewards/health`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAnalyticsMarkers(
  address: string | undefined,
  hours = 24,
): Promise<AnalyticsMarkers> {
  const params = new URLSearchParams();
  params.set("hours", String(hours));
  if (address) params.set("address", address);
  const res = await fetch(
    `${BACKEND_URL}/api/analytics/markers?${params.toString()}`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface NarratorResponse {
  text: string;
  model: string;
  context: {
    address: string;
    partyId: string | null;
    latestRoundNumber: number | null;
    totalUserCc: number;
    totalTreasuryCc: number;
    rewardEventCount: number;
    recentRoundCc: number;
    recentRoundShare: number | null;
    previousRoundCc: number | null;
    previousRoundNumber: number | null;
    lifetimeUserCc: number;
    crossedTen: boolean;
    crossedHundred: boolean;
    crossedThousand: boolean;
    source: "anthropic" | "rule-based";
  };
}

export async function fetchNarrator(address: string): Promise<NarratorResponse> {
  const res = await fetch(`${BACKEND_URL}/api/narrator/${address}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
