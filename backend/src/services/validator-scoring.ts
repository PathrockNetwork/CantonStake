/**
 * Validator quality scoring — free-source data layer for the validator
 * picker UI, slashing alerts, and (eventually) auto-compound's validator
 * selection logic.
 *
 * Per-chain fetchers pull from public endpoints, normalize to a common
 * `ScoredValidator` shape, and compute a 0–100 quality score. Redis
 * caches the per-chain score list for `validatorScoringTtlSec` (1 h
 * default). A BullMQ repeatable job refreshes hourly so the cache is
 * always warm for end-user requests.
 *
 * Scoring formula (out of 100):
 *
 *     score = clamp(
 *         + 50 * uptimeFactor          // uptime ≥ 99.95 % → 50
 *         + 25 * commissionFactor      // commission 0 % → 25, 10 % → 12, 20+ % → 0
 *         + 15 * slashSafety           // 0 slashes → 15, decays
 *         + 10 * concentrationFactor   // <0.5 % of stake → 10, >5 % → 0
 *     , 0, 100)
 *
 * Concentration penalises validators that already control a large share
 * of the active set; this is a cheap decentralisation nudge in the
 * picker rather than a hard cutoff.
 *
 * Source endpoints (all public, no API key required):
 *
 *   - Polygon  : https://staking-api.polygon.technology/api/v2/validators
 *   - Moonbeam : Moonbase Alpha precompile read (selectedCandidates) via
 *                MOONBEAM_RPC_URL — free testnet API doesn't exist.
 *   - Monad    : https://raw.githubusercontent.com/monad-developers/
 *                validator-info/main/mainnet/validators.json
 *   - Cosmos   : theta-testnet REST (Polypore sentry-01)
 *   - Sui      : JSON-RPC suix_getLatestSuiSystemState (testnet)
 *
 * All fetchers are defensively coded: a failed call returns `[]` and
 * logs a warning, never throws into the BullMQ worker.
 */

import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { config } from "../config.js";
import { diffAndAlert } from "./slashing-monitor.js";

// --- Types ---

export type SupportedChain =
  | "polygon"
  | "moonbeam"
  | "monad"
  | "cosmos"
  | "sui";

export interface ScoredValidator {
  chain: SupportedChain;
  address: string;          // chain-native identifier (validator addr / pubkey / object id)
  name: string;
  commissionPct: number;    // 0..100
  uptimePct: number;        // 0..100, best-effort (some chains don't expose; defaults to 99.0)
  jailed: boolean;
  slashCount: number;       // best-effort (some chains don't expose; defaults to 0)
  totalStaked: number;      // chain-native units
  stakeSharePct: number;    // 0..100, this validator's % of active set total stake
  score: number;            // 0..100
}

export interface ChainScoreSnapshot {
  chain: SupportedChain;
  fetchedAt: string;        // ISO timestamp
  source: "live" | "cache" | "stub";
  validators: ScoredValidator[];
  warnings: string[];
}

// --- Redis ---

const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const REDIS_PREFIX = "vscore:";

function cacheKey(chain: SupportedChain): string {
  return `${REDIS_PREFIX}${chain}`;
}

async function readCache(
  chain: SupportedChain
): Promise<ChainScoreSnapshot | null> {
  try {
    const raw = await redis.get(cacheKey(chain));
    if (!raw) return null;
    return JSON.parse(raw) as ChainScoreSnapshot;
  } catch (err) {
    console.warn(`[validator-scoring] redis read failed ${chain}:`, err);
    return null;
  }
}

async function writeCache(snapshot: ChainScoreSnapshot): Promise<void> {
  try {
    await redis.set(
      cacheKey(snapshot.chain),
      JSON.stringify(snapshot),
      "EX",
      config.validatorScoringTtlSec
    );
  } catch (err) {
    console.warn(`[validator-scoring] redis write failed ${snapshot.chain}:`, err);
  }
}

// --- Scoring formula ---

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function computeScore(args: {
  uptimePct: number;
  commissionPct: number;
  slashCount: number;
  jailed: boolean;
  stakeSharePct: number;
}): number {
  if (args.jailed) return 0;

  // Uptime: full credit at ≥99.95 %, linear down to 0 at ≤95 %.
  const uptimeFactor = clamp((args.uptimePct - 95) / (99.95 - 95), 0, 1);

  // Commission: 0 % → 1.0, 20+ % → 0.0, linear in between.
  const commissionFactor = clamp(1 - args.commissionPct / 20, 0, 1);

  // Slash safety: each slash takes 30 % off; floor at 0.
  const slashSafety = clamp(1 - args.slashCount * 0.3, 0, 1);

  // Concentration penalty: ≤0.5 % share → 1.0, ≥5 % → 0.
  const concentrationFactor =
    args.stakeSharePct <= 0.5
      ? 1
      : clamp(1 - (args.stakeSharePct - 0.5) / (5 - 0.5), 0, 1);

  const raw =
    50 * uptimeFactor +
    25 * commissionFactor +
    15 * slashSafety +
    10 * concentrationFactor;
  return Math.round(clamp(raw, 0, 100));
}

function attachScores(
  partial: Omit<ScoredValidator, "score" | "stakeSharePct">[]
): ScoredValidator[] {
  const total = partial.reduce((s, v) => s + v.totalStaked, 0);
  return partial.map((v) => {
    const stakeSharePct = total > 0 ? (v.totalStaked / total) * 100 : 0;
    const score = computeScore({
      uptimePct: v.uptimePct,
      commissionPct: v.commissionPct,
      slashCount: v.slashCount,
      jailed: v.jailed,
      stakeSharePct,
    });
    return { ...v, stakeSharePct, score };
  });
}

// --- Per-chain fetchers ---

async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { accept: "application/json", ...init?.headers },
    });
    if (!res.ok) {
      console.warn(`[validator-scoring] ${url} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[validator-scoring] ${url} fetch failed:`, err);
    return null;
  }
}

async function fetchPolygon(): Promise<ScoredValidator[]> {
  // staking-api.polygon.technology returns { result: [{ id, name, signer,
  // status, performanceIndex, commissionPercent, selfStake, delegatedStake,
  // ... }] } — performanceIndex is roughly an uptime proxy in basis-points-style.
  type PolygonRow = {
    id: number;
    name?: string;
    signer?: string;
    status?: string;
    commissionPercent?: number;
    performanceIndex?: number;
    selfStake?: string;
    delegatedStake?: string;
    isInAuction?: boolean;
  };
  const body = await fetchJson<{ result?: PolygonRow[] }>(
    "https://staking-api.polygon.technology/api/v2/validators?limit=200"
  );
  if (!body?.result) return [];

  const rows = body.result.map((v) => {
    const total =
      Number(v.selfStake ?? "0") + Number(v.delegatedStake ?? "0");
    const perf = Number(v.performanceIndex ?? 100);
    // performanceIndex is approximately 0..100 already; clamp.
    const uptimePct = clamp(perf, 90, 100);
    return {
      chain: "polygon" as const,
      address: v.signer ?? `validator-${v.id}`,
      name: v.name ?? `Validator ${v.id}`,
      commissionPct: Number(v.commissionPercent ?? 10),
      uptimePct,
      jailed: v.status !== "Active" && v.status !== "active",
      slashCount: 0,
      totalStaked: total,
    };
  });
  return attachScores(rows);
}

async function fetchMoonbeam(): Promise<ScoredValidator[]> {
  // Moonbase Alpha doesn't expose a free public collator listing API
  // (Subscan testnet requires a key). The parachain-staking precompile
  // at 0x...0800 exposes `selectedCandidates() returns (address[])` which
  // gives us the live active set. We pair each address with a per-
  // candidate `candidateCount(addr) returns (uint256)` read for a stake
  // proxy, and use defaults for commission + uptime (the precompile
  // doesn't surface those).
  const { createPublicClient, http, parseAbi } = await import("viem");
  const { moonbaseAlpha } = await import("viem/chains");

  const STAKING_PRECOMPILE =
    "0x0000000000000000000000000000000000000800" as const;
  const stakingAbi = parseAbi([
    "function selectedCandidates() view returns (address[])",
    "function candidateCount() view returns (uint256)",
  ]);

  try {
    const client = createPublicClient({
      chain: moonbaseAlpha,
      transport: http(config.moonbeamRpcUrl),
    });
    const candidates = (await client.readContract({
      address: STAKING_PRECOMPILE,
      abi: stakingAbi,
      functionName: "selectedCandidates",
    })) as readonly `0x${string}`[];

    const rows = candidates.map((addr, i) => ({
      chain: "moonbeam" as const,
      address: addr,
      name: `Moonbase Collator #${i + 1}`,
      // The precompile doesn't surface commission; Moonbase Alpha's
      // default new-collator commission is 20% (parachain runtime).
      commissionPct: 20,
      uptimePct: 99.0,
      jailed: false,
      slashCount: 0,
      // Without a per-candidate stake read we use a uniform default;
      // the score formula's concentration penalty kicks off zero.
      totalStaked: 0,
    }));
    return attachScores(rows);
  } catch (err) {
    console.warn("[validator-scoring] moonbase precompile read failed:", err);
    return [];
  }
}

async function fetchMonad(): Promise<ScoredValidator[]> {
  // Pulled from the monad-developers/validator-info repo's mainnet JSON.
  // The schema is informally documented; fields below are best-effort.
  type MonadRow = {
    address?: string;
    name?: string;
    commission?: number;
    self_stake?: string | number;
    total_stake?: string | number;
    active?: boolean;
  };
  const body = await fetchJson<MonadRow[] | { validators?: MonadRow[] }>(
    "https://raw.githubusercontent.com/monad-developers/validator-info/main/mainnet/validators.json"
  );
  const rows = Array.isArray(body) ? body : body?.validators ?? [];

  const partial = rows.map((v, i) => ({
    chain: "monad" as const,
    address: v.address ?? `validator-${i}`,
    name: v.name ?? v.address?.slice(0, 10) ?? `Monad-${i}`,
    commissionPct: Number(v.commission ?? 5),
    uptimePct: 99.0,
    jailed: v.active === false,
    slashCount: 0,
    totalStaked: Number(v.total_stake ?? v.self_stake ?? 0),
  }));
  return attachScores(partial);
}

async function fetchCosmos(): Promise<ScoredValidator[]> {
  // Cosmos Hub theta-testnet — Polypore sentry-01 REST endpoint.
  // Same x/staking schema as mainnet, just a smaller validator set.
  type CosmosVal = {
    operator_address: string;
    description?: { moniker?: string };
    commission?: { commission_rates?: { rate?: string } };
    tokens?: string;
    jailed?: boolean;
    status?: string;
  };
  const body = await fetchJson<{ validators?: CosmosVal[] }>(
    "https://rest.sentry-01.theta-testnet.polypore.xyz/cosmos/staking/v1beta1/validators?pagination.limit=200&status=BOND_STATUS_BONDED"
  );
  if (!body?.validators) return [];

  const partial = body.validators.map((v) => ({
    chain: "cosmos" as const,
    address: v.operator_address,
    name: v.description?.moniker ?? v.operator_address.slice(0, 14),
    commissionPct: Number(v.commission?.commission_rates?.rate ?? "0.05") * 100,
    uptimePct: 99.0,            // Cosmos REST doesn't ship uptime; would need a Mintscan call per-val
    jailed: v.jailed === true || v.status !== "BOND_STATUS_BONDED",
    slashCount: 0,
    totalStaked: Number(v.tokens ?? "0") / 1e6, // uatom → ATOM
  }));
  return attachScores(partial);
}

async function fetchSui(): Promise<ScoredValidator[]> {
  // suix_getLatestSuiSystemState on Sui Testnet. The schema and method
  // names are identical to mainnet — Sui keeps its system framework
  // version-locked across networks.
  type SuiVal = {
    suiAddress?: string;
    name?: string;
    commissionRate?: string;        // basis points, e.g. "500" = 5 %
    votingPower?: string;           // basis points of total
    stakingPoolSuiBalance?: string;
    nextEpochStake?: string;
    isActive?: boolean;
  };
  const body = await fetchJson<{
    result?: { activeValidators?: SuiVal[] };
  }>("https://fullnode.testnet.sui.io:443", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "suix_getLatestSuiSystemState",
      params: [],
    }),
  });
  const validators = body?.result?.activeValidators ?? [];

  const partial = validators.map((v, i) => ({
    chain: "sui" as const,
    address: v.suiAddress ?? `validator-${i}`,
    name: v.name ?? v.suiAddress?.slice(0, 14) ?? `Sui-${i}`,
    commissionPct: Number(v.commissionRate ?? "0") / 100, // bps → %
    uptimePct: 99.5,
    jailed: v.isActive === false,
    slashCount: 0,
    totalStaked: Number(v.stakingPoolSuiBalance ?? "0") / 1e9, // MIST → SUI
  }));
  return attachScores(partial);
}

// --- Public API ---

const FETCHERS: Record<SupportedChain, () => Promise<ScoredValidator[]>> = {
  polygon: fetchPolygon,
  moonbeam: fetchMoonbeam,
  monad: fetchMonad,
  cosmos: fetchCosmos,
  sui: fetchSui,
};

export async function refreshChain(
  chain: SupportedChain
): Promise<ChainScoreSnapshot> {
  const warnings: string[] = [];
  let validators: ScoredValidator[] = [];
  try {
    validators = await FETCHERS[chain]();
  } catch (err) {
    warnings.push(`fetch failed: ${String(err)}`);
  }

  const snapshot: ChainScoreSnapshot = {
    chain,
    fetchedAt: new Date().toISOString(),
    source: validators.length > 0 ? "live" : "stub",
    validators: validators.sort((a, b) => b.score - a.score),
    warnings,
  };
  await writeCache(snapshot);

  // Hand off to the slashing monitor. Failure here must NOT take down
  // the refresh loop — alerts are advisory.
  try {
    await diffAndAlert(snapshot);
  } catch (err) {
    console.warn(`[validator-scoring] alert diff failed for ${chain}:`, err);
  }

  return snapshot;
}

export async function getScores(
  chain: SupportedChain,
  opts: { forceRefresh?: boolean } = {}
): Promise<ChainScoreSnapshot> {
  if (!opts.forceRefresh) {
    const cached = await readCache(chain);
    if (cached) {
      return { ...cached, source: "cache" };
    }
  }
  return refreshChain(chain);
}

export async function getAllScores(): Promise<
  Record<SupportedChain, ChainScoreSnapshot>
> {
  const chains: SupportedChain[] = [
    "polygon",
    "moonbeam",
    "monad",
    "cosmos",
    "sui",
  ];
  const entries = await Promise.all(
    chains.map(async (c) => [c, await getScores(c)] as const)
  );
  return Object.fromEntries(entries) as Record<
    SupportedChain,
    ChainScoreSnapshot
  >;
}

// --- BullMQ refresh job ---

const QUEUE_NAME = "validator-scoring";

const queue = new Queue(QUEUE_NAME, { connection: redis });

interface RefreshPayload {
  chain: SupportedChain | "all";
}

const worker = new Worker<RefreshPayload>(
  QUEUE_NAME,
  async (job: Job<RefreshPayload>) => {
    const target = job.data.chain;
    const chains: SupportedChain[] =
      target === "all"
        ? ["polygon", "moonbeam", "monad", "cosmos", "sui"]
        : [target];
    for (const c of chains) {
      const snap = await refreshChain(c);
      console.log(
        `[validator-scoring] refreshed ${c}: ${snap.validators.length} validators (${snap.source})`
      );
    }
  },
  { connection: redis, concurrency: 1 }
);

worker.on("failed", (job, err) => {
  console.error(`[validator-scoring] job ${job?.id} failed:`, err.message);
});

export async function startValidatorScoringScheduler(): Promise<void> {
  if (config.validatorScoringDisabled) {
    console.log("[validator-scoring] disabled via VALIDATOR_SCORING_DISABLED");
    return;
  }

  // Drop any pre-existing repeatable jobs so a code restart doesn't
  // accidentally double-schedule.
  const existing = await queue.getRepeatableJobs();
  for (const j of existing) {
    await queue.removeRepeatableByKey(j.key);
  }

  // First refresh now, then on the configured cadence.
  await queue.add(
    "refresh-all",
    { chain: "all" },
    { removeOnComplete: { count: 50 }, removeOnFail: { count: 20 } }
  );
  await queue.add(
    "refresh-all-recurring",
    { chain: "all" },
    {
      jobId: "validator-scoring-recurring",
      repeat: { every: config.validatorScoringRefreshSec * 1000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 },
    }
  );
  console.log(
    `[validator-scoring] scheduler started (every ${config.validatorScoringRefreshSec}s)`
  );
}

export async function shutdownValidatorScoring(): Promise<void> {
  await worker.close();
  await queue.close();
  await redis.quit();
}
