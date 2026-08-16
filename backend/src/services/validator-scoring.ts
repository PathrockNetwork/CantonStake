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
 *   - Polygon  : https://staking-api-amoy.polygon.technology/api/v2/validators
 *                (Amoy, i.e. the testnet whose StakeManager we actually stake
 *                against — the mainnet host lists a completely different
 *                validator set whose signers do not exist on our StakeManager)
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
  | "monad"
  | "cosmos"
  | "celestia"
  | "osmosis"
  | "sui"
  | "aptos"
  | "polkadot"
  | "bnb"
  | "solana";

export interface ScoredValidator {
  chain: SupportedChain;
  address: string;          // chain-native identifier (validator addr / pubkey / object id)
  name: string;
  // Polygon only: the numeric validatorId the StakeManager keys on, and that
  // validator's own ValidatorShare contract. Polygon deploys one
  // ValidatorShare per validator, so the staking contract address is a
  // property of the validator, not of the deployment. Undefined on every
  // other chain.
  validatorId?: number;
  validatorShare?: string;
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
  // staking-api-amoy.polygon.technology returns { result: [{ id, name, signer,
  // status, performanceIndex, commissionPercent, selfStake, delegatedStake,
  // contractAddress, uptimePercent, ... }] } — performanceIndex is roughly an
  // uptime proxy in basis-points-style.
  //
  // `contractAddress` is the validator's ValidatorShare. We take the on-chain
  // StakeManager registry as authoritative and only fall back to the API's
  // value if the resolver can't reach L1 — the API is a convenience, the
  // StakeManager is the source of truth.
  type PolygonRow = {
    id: number;
    name?: string;
    signer?: string;
    status?: string;
    commissionPercent?: number;
    performanceIndex?: number;
    uptimePercent?: number;
    contractAddress?: string;
    selfStake?: string;
    delegatedStake?: string;
    isInAuction?: boolean;
  };
  const body = await fetchJson<{ result?: PolygonRow[] }>(
    "https://staking-api-amoy.polygon.technology/api/v2/validators?limit=200"
  );
  if (!body?.result) return [];

  // On-chain registry: validatorId → ValidatorShare. Best-effort; a failure
  // here degrades to the API-reported contractAddress rather than dropping
  // the validator list entirely.
  let onChain = new Map<number, { signer: string; share: string }>();
  try {
    const { listValidatorShares } = await import("./validator-share.js");
    const registry = await listValidatorShares();
    onChain = new Map(
      registry.map((v) => [v.validatorId, { signer: v.signer, share: v.share }])
    );
  } catch (err) {
    console.warn("[validator-scoring] StakeManager registry unavailable:", err);
  }

  const rows = body.result.map((v) => {
    const total =
      Number(v.selfStake ?? "0") + Number(v.delegatedStake ?? "0");
    const perf = Number(v.performanceIndex ?? 100);
    // performanceIndex is approximately 0..100 already; clamp.
    const uptimePct = clamp(Number(v.uptimePercent ?? perf), 90, 100);
    const chainEntry = onChain.get(v.id);
    return {
      chain: "polygon" as const,
      address: chainEntry?.signer ?? v.signer ?? `validator-${v.id}`,
      name: v.name?.trim() || `Validator ${v.id}`,
      validatorId: v.id,
      validatorShare: chainEntry?.share ?? v.contractAddress,
      commissionPct: Number(v.commissionPercent ?? 10),
      uptimePct,
      jailed: v.status !== "Active" && v.status !== "active",
      slashCount: 0,
      totalStaked: total,
    };
  });
  // A validator with no ValidatorShare cannot be delegated to, so it must not
  // be offered in the picker.
  return attachScores(rows.filter((r) => Boolean(r.validatorShare)));
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

// --- Cosmos-shape validator fetchers (shared x/staking REST schema) ---

async function fetchCosmosChain(
  chain: SupportedChain,
  restBase: string,
  denomDecimals: number
): Promise<ScoredValidator[]> {
  type CosmosVal = {
    operator_address: string;
    description?: { moniker?: string };
    commission?: { commission_rates?: { rate?: string } };
    tokens?: string;
    jailed?: boolean;
    status?: string;
  };
  const body = await fetchJson<{ validators?: CosmosVal[] }>(
    `${restBase.replace(/\/$/, "")}/cosmos/staking/v1beta1/validators?pagination.limit=200&status=BOND_STATUS_BONDED`
  );
  if (!body?.validators) return [];

  const partial = body.validators.map((v) => ({
    chain,
    address: v.operator_address,
    name: v.description?.moniker ?? v.operator_address.slice(0, 14),
    commissionPct: Number(v.commission?.commission_rates?.rate ?? "0.05") * 100,
    uptimePct: 99.0,            // Cosmos REST doesn't ship uptime; would need a Mintscan call per-val
    jailed: v.jailed === true || v.status !== "BOND_STATUS_BONDED",
    slashCount: 0,
    totalStaked: Number(v.tokens ?? "0") / 10 ** denomDecimals,
  }));
  return attachScores(partial);
}

function fetchCosmos(): Promise<ScoredValidator[]> {
  // Cosmos Hub theta-testnet — Polypore sentry-01 REST endpoint.
  // Same x/staking schema as mainnet, just a smaller validator set.
  return fetchCosmosChain("cosmos", config.cosmosRestUrl, 6);
}

function fetchCelestia(): Promise<ScoredValidator[]> {
  // Celestia mocha testnet — POPS public LCD (verified 2026-08-16).
  return fetchCosmosChain("celestia", config.celestiaRestUrl, 6);
}

function fetchOsmosis(): Promise<ScoredValidator[]> {
  // Osmosis testnet — official LCD (verified 2026-08-16).
  return fetchCosmosChain("osmosis", config.osmosisRestUrl, 6);
}

// --- Aptos: the stake::ValidatorSet resource on 0x1 (the REST
// /v1/validators endpoint is not served by these fullnodes) ---

async function fetchAptos(): Promise<ScoredValidator[]> {
  const body = await fetchJson<{ data?: { active_validators?: Array<{
    addr?: string;
    voting_power?: string;
  }> } }>(
    `${config.aptosRestUrl.replace(/\/$/, "")}/v1/accounts/0x1/resource/0x1::stake::ValidatorSet`
  );
  const validators = body?.data?.active_validators;
  if (!Array.isArray(validators)) return [];

  const partial = validators.map((v) => ({
    chain: "aptos" as const,
    address: v.addr ?? "unknown",
    // Aptos pools are commission-free for delegators by protocol design;
    // names aren't in this resource.
    name: `Aptos pool ${v.addr?.slice(0, 10) ?? "?"}`,
    commissionPct: 0,
    uptimePct: 99.0,
    jailed: false,
    slashCount: 0,
    totalStaked: Number(v.voting_power ?? "0") / 1e8, // octa → APT
  }));
  return attachScores(partial);
}

// --- Solana: getVoteAccounts via the testnet RPC ---

async function fetchSolana(): Promise<ScoredValidator[]> {
  const body = await fetchJson<{
    result?: {
      current?: Array<{
        votePubkey: string;
        commission: number;
        lastVote: number;
        activatedStake: string;
      }>;
    };
  }>(config.solanaRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getVoteAccounts",
      params: [],
    }),
  });
  const current = body?.result?.current;
  if (!Array.isArray(current)) return [];

  const partial = current.map((v) => ({
    chain: "solana" as const,
    address: v.votePubkey,
    name: `Vote ${v.votePubkey.slice(0, 8)}…`,
    commissionPct: v.commission,   // percent on Solana, not bps
    uptimePct: 99.0,
    jailed: false,
    slashCount: 0,
    totalStaked: Number(v.activatedStake ?? "0") / 1e9, // lamports → SOL
  }));
  return attachScores(partial);
}

// --- Polkadot + BNB: no free per-validator listing endpoint verified yet.
// Honest stubs — the chain stats UI shows source:"stub" for these until a
// real fetcher lands (see docs/CHAIN_EXPANSION_RESEARCH.md §4). ---

async function fetchPolkadot(): Promise<ScoredValidator[]> {
  return [];
}

async function fetchBnb(): Promise<ScoredValidator[]> {
  return [];
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
  monad: fetchMonad,
  cosmos: fetchCosmos,
  celestia: fetchCelestia,
  osmosis: fetchOsmosis,
  sui: fetchSui,
  aptos: fetchAptos,
  polkadot: fetchPolkadot,
  bnb: fetchBnb,
  solana: fetchSolana,
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
    "monad",
    "cosmos",
    "celestia",
    "osmosis",
    "sui",
    "aptos",
    "polkadot",
    "bnb",
    "solana",
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
        ? ["polygon", "monad", "cosmos", "celestia", "osmosis", "sui", "aptos", "polkadot", "bnb", "solana"]
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
