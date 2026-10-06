import { networkMode } from "./network";
import { nativeWalletScope, normalizedNativeWallet } from "./native-wallet-addresses";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";

export interface PositionRow {
  contractId: string;
  /** Set by the verified backend ledger router, never browser storage. */
  ledgerOrigin?: "primary" | "legacy";
  argument: {
    delegator: string;
    evmAddress: string;
    amountPol: string;
    status: "Pending" | "Bonded" | "Unbonding" | "Released" | "Cancelled";
    bondedAt?: string;
    unbondingStartedAt?: string;
    /**
     * Cadence-derived ESTIMATE of when the unbond becomes claimable. Never
     * use it as the gate — on Polygon the authoritative condition is
     * checkpoint-based (`chainMeta.unbondWithdrawEpoch + withdrawalDelay
     * <= currentEpoch`), and checkpoints do not arrive on a fixed clock.
     */
    unbondingReadyAt?: string;
    releasedAt?: string;
    markersEmitted: number;
  };
  /**
   * Real per-position chain data from the Postgres mirror. Null for
   * positions created before the per-validator migration, and for chains
   * that stake through a single precompile.
   */
  chainMeta?: {
    chain: string;
    validatorAddress: string | null;
    validatorShare: string | null;
    validatorId: number | null;
    evmTxHash: string | null;
    unbondNonce: string | null;
    unbondWithdrawEpoch: string | null;
    suiStakedObjectId: string | null;
  } | null;
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
  chain?: "polygon" | "monad" | "cosmos" | "celestia" | "osmosis" | "sui" | "aptos" | "polkadot" | "bnb" | "solana";
  validator?: string;
  stakeAccountAddress?: string;
}, signNativeOwnership?: (message: string, expectedWallet: string) => Promise<string>): Promise<{
  ok: boolean;
  transactionId: string | null;
  delegator: string;
  chain?: string;
  stakeRentLamports?: string;
  stakeAccountAddress?: string;
}> {
  if (process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external") {
    const { createLoopStakingRequest } = await import("./canton/loop-staking-flow");
    return createLoopStakingRequest(body, signNativeOwnership);
  }
  const res = await fetch(`${BACKEND_URL}/api/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, clientNetworkMode: networkMode }),
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

export interface WatcherStatus {
  chain: string;
  status: "ok" | "unreachable" | "unknown";
  lastError: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export interface CantonReadiness {
  status: "ready" | "unavailable";
  canton: "reachable" | "unreachable";
  networkMode: "testnet" | "mainnet";
  time: string;
  loopStaking?: { status: "ready" | "blocked"; reason: string | null; supportedChains: string[]; ccPaymentsEnabled: false };
}

export async function fetchCantonReadiness(): Promise<CantonReadiness> {
  const res = await fetch(`${BACKEND_URL}/api/readiness`, { signal: AbortSignal.timeout(5_000) });
  const body = await res.json() as CantonReadiness;
  if (!res.ok && res.status !== 503) throw new Error(`Canton readiness HTTP ${res.status}`);
  if (body?.networkMode !== networkMode) throw new Error("Canton readiness network mode does not match this frontend");
  const ready = res.status === 200 && body.status === "ready" && body.canton === "reachable";
  const unavailable = res.status === 503 && body.status === "unavailable" && body.canton === "unreachable";
  if (!ready && !unavailable) throw new Error("Invalid Canton readiness response");
  return body;
}

/** Per-chain watcher reachability + the deployment's network mode. */
export async function fetchWatcherStatus(): Promise<
  WatcherStatus[] & { networkMode?: string }
> {
  const res = await fetch(`${BACKEND_URL}/api/watchers`);
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as {
    watchers: WatcherStatus[];
    networkMode?: string;
  };
  return Object.assign(json.watchers, { networkMode: json.networkMode });
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
  const res = await fetch(`${BACKEND_URL}/api/rewards/health`, { signal: AbortSignal.timeout(8_000) });
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
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface UserRecord {
  id: string;
  cantonPartyId: string;
  evmAddress: string | null;
  displayName: string | null;
  createdAt: string;
}

export async function fetchUserByEvm(address: string): Promise<UserRecord> {
  const res = await fetch(
    `${BACKEND_URL}/api/users/by-evm/${encodeURIComponent(address)}`,
  );
  if (res.status === 404) throw new Error("user not registered yet");
  if (!res.ok) throw new Error(await res.text());
  const body = (await res.json()) as { user: UserRecord };
  return body.user;
}

export interface AutoCompoundPermit {
  id: string;
  userId: string;
  chain: "polygon" | "monad" | "cosmos" | "celestia" | "osmosis" | "sui" | "aptos" | "polkadot" | "bnb" | "solana";
  validator: string;
  scope: string;
  signature: string | null;
  signaturePayload: string | null;
  expiresAt: string;
  enabled: boolean;
  maxPerRun: string | null;
  createdAt: string;
}

export interface AutoCompoundStatus {
  status: "disabled" | "unavailable" | "ready";
  executionEnabled: boolean;
  supportedChains: string[];
  reason: string | null;
  networkMode: "testnet" | "mainnet";
}

export async function fetchAutoCompoundStatus(): Promise<AutoCompoundStatus> {
  const res = await fetch(`${BACKEND_URL}/api/autocompound/status`);
  if (!res.ok) throw new Error("Auto-compound status is unavailable");
  const status = await res.json() as AutoCompoundStatus;
  if (status.networkMode !== networkMode) throw new Error("Auto-compound backend network does not match this deployment");
  if (!["disabled", "unavailable", "ready"].includes(status.status) ||
      typeof status.executionEnabled !== "boolean" || !Array.isArray(status.supportedChains) ||
      !status.supportedChains.every(chain => typeof chain === "string") ||
      (status.reason !== null && typeof status.reason !== "string") ||
      status.executionEnabled !== (status.status === "ready") ||
      (status.executionEnabled && status.supportedChains.length === 0)) {
    throw new Error("Auto-compound status is invalid");
  }
  return status;
}

export async function listAutoCompoundPermits(
  userId: string,
): Promise<{ permits: AutoCompoundPermit[] }> {
  const res = await fetch(
    `${BACKEND_URL}/api/autocompound/permits?userId=${encodeURIComponent(userId)}`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function disableAutoCompoundPermit(
  id: string,
): Promise<{ permit: AutoCompoundPermit }> {
  const res = await fetch(`${BACKEND_URL}/api/autocompound/permits/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface NotificationChannel {
  id: string;
  userId: string;
  kind: "telegram" | "email" | "discord";
  target: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
}

export async function listNotificationChannels(
  userId: string,
): Promise<{ channels: NotificationChannel[] }> {
  const res = await fetch(
    `${BACKEND_URL}/api/notifications/channels?userId=${encodeURIComponent(userId)}`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function upsertNotificationChannel(body: {
  userId: string;
  kind: "telegram" | "email" | "discord";
  target: string;
  label?: string;
}): Promise<{ channel: NotificationChannel }> {
  const res = await fetch(`${BACKEND_URL}/api/notifications/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function disableNotificationChannel(
  id: string,
): Promise<{ channel: NotificationChannel }> {
  const res = await fetch(
    `${BACKEND_URL}/api/notifications/channels/${id}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendTestNotification(
  userId: string,
): Promise<{ ok: boolean; alertId: string }> {
  const res = await fetch(`${BACKEND_URL}/api/notifications/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ValidatorScore {
  chain: string;
  address: string;
  name: string;
  stakingCredit?: string;
  commissionPct: number;
  uptimePct: number | null;
  jailed: boolean;
  slashCount: number;
  totalStaked: number;
  stakeSharePct: number;
  score: number;
}

export interface ValidatorScoresResponse {
  chain: string;
  fetchedAt: string;
  source: "live" | "cache" | "stub";
  validators: ValidatorScore[];
  warnings: string[];
}

export async function fetchValidatorScores(
  chain: string,
): Promise<ValidatorScoresResponse> {
  const res = await fetch(`${BACKEND_URL}/api/validators/scores/${chain}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchProtocolSummary(): Promise<import("./protocol-summary").ProtocolSummary> {
  const response = await fetch(`${BACKEND_URL}/api/protocol/summary`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Position totals unavailable");
  return response.json();
}

export interface RewardHistoryEvent {
  id: string;
  kind: "native" | "cc";
  time: string;
  amount: string;
  symbol: string;
  positionId: string;
  chain: string;
  roundNumber: number | null;
  transactionId: string | null;
  status: string;
}
export interface RewardHistory { events: RewardHistoryEvent[]; since: string; hasMore: boolean }
export interface AccountRewards {
  networkMode: "mainnet" | "testnet";
  addresses: string[];
  days: number;
  checkedAt: string;
  positions: PositionRow[] | null;
  history: RewardHistory | null;
  rounds?: Array<Pick<RoundSummary, "roundNumber" | "status" | "startedAt" | "completedAt" | "totalCcMinted" | "userCcAttributed">> | null;
  policy: { ccPayments: "disabled" | "unverified"; beneficiarySplit: "not_configured" | "unverified" };
}

export async function fetchAccountRewards(addresses: string[], days: number, includeRounds: boolean, signal?: AbortSignal): Promise<AccountRewards> {
  const scope = nativeWalletScope(addresses);
  if (!scope.length || scope.length > 8) throw new Error("Connect a native wallet to read rewards");
  const res = await fetch(`${BACKEND_URL}/api/account/rewards`, {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses: scope, days, includeRounds, limit: 250, clientNetworkMode: networkMode }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Account rewards unavailable (HTTP ${res.status})`);
  const body = await res.json() as AccountRewards;
  if (body?.networkMode !== networkMode || body.days !== days || !Array.isArray(body.addresses) ||
      JSON.stringify(body.addresses) !== JSON.stringify(scope) || !Number.isFinite(Date.parse(body.checkedAt)) ||
      !["disabled", "unverified"].includes(body.policy?.ccPayments) ||
      !["not_configured", "unverified"].includes(body.policy?.beneficiarySplit)) {
    throw new Error("Reward response does not match this connected wallet scope");
  }
  if (body.positions !== null && (!Array.isArray(body.positions) || body.positions.some(position =>
    !position.contractId || typeof position.argument?.evmAddress !== "string" ||
    !scope.includes(normalizedNativeWallet(position.argument.evmAddress)) || !position.chainMeta?.chain))) {
    throw new Error("Invalid account position response");
  }
  if (body.history !== null && (!Array.isArray(body.history?.events) || typeof body.history.hasMore !== "boolean" ||
      !Number.isFinite(Date.parse(body.history.since)) || body.history.events.some(event =>
        !["native", "cc"].includes(event.kind) || !event.positionId || !event.chain ||
        typeof event.amount !== "string" || !/^\d+(?:\.\d+)?$/.test(event.amount) || !Number.isFinite(Date.parse(event.time))))) {
    throw new Error("Invalid recorded reward history");
  }
  if (includeRounds && body.rounds !== null && !Array.isArray(body.rounds)) throw new Error("Invalid account round history");
  return body;
}

export async function fetchRewardHistory(address: string, days = 30): Promise<RewardHistory> {
  const params = new URLSearchParams({ address, days: String(days), limit: "250" });
  const response = await fetch(`${BACKEND_URL}/api/rewards/history?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Reward history unavailable");
  return response.json();
}
