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
