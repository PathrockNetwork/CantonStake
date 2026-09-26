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
 *   - Monad    : 0x1000 staking precompile on the selected mode's chain
 *   - Cosmos   : chain-verified CometBFT RPC, selected by mode
 *   - Sui      : GraphQL current epoch active-validator set
 *
 * All fetchers are defensively coded: a failed call returns `[]` and
 * logs a warning, never throws into the BullMQ worker.
 */

import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { formatEther } from "viem";
import { config } from "../config.js";
import { diffAndAlert } from "./slashing-monitor.js";
import { listBnbValidators } from "./bnb-staking.js";
import { listMonadValidators } from "./monad-staking.js";
import { listPolkadotPoolScoreRows } from "./polkadot-pool-scores.js";
import { listCosmosBondedValidators } from "./cosmos-validator-catalog.js";
import { assertAptosChainId, assertSuiChainIdentifier } from "./native-network.js";
import { assertSolanaNetwork } from "./solana-rpc.js";

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
  stakingCredit?: string;   // BNB StakeHub: per-validator credit contract
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
// Testnet and mainnet deployments can share Redis. Never hydrate one mode's
// validator picker from the other mode's cached addresses or IDs.
const REDIS_PREFIX = `vscore:${config.networkMode}:`;

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
  // The StakeManager on this mode's settlement chain is authoritative. The
  // Amoy API is metadata only and must never select a mainnet validator.
  type PolygonRow = {
    id: number;
    name?: string;
    signer?: string;
    performanceIndex?: number;
    uptimePercent?: number;
  };
  const { listValidatorShares } = await import("./validator-share.js");
  const registry = await listValidatorShares();
  const metadata = config.networkMode === "testnet"
    ? await fetchJson<{ result?: PolygonRow[] }>(
        "https://staking-api-amoy.polygon.technology/api/v2/validators?limit=200",
      )
    : null;
  const byId = new Map((metadata?.result ?? []).map((v) => [v.id, v]));

  const rows = registry.filter((v) => v.status === 1 &&
      /^0x[a-fA-F0-9]{40}$/.test(v.signer) &&
      v.signer.toLowerCase() !== "0x0000000000000000000000000000000000000000")
    .map((v) => {
    const api = byId.get(v.validatorId);
    const matchingMetadata = api?.signer?.toLowerCase() === v.signer.toLowerCase() ? api : null;
    const uptimePct = matchingMetadata
      ? clamp(Number(matchingMetadata.uptimePercent ?? matchingMetadata.performanceIndex ?? 99), 0, 100)
      : 99; // neutral placeholder; no uptime is exposed by StakeManager
    const total = Number(formatEther(BigInt(v.selfStake))) +
      Number(formatEther(BigInt(v.delegatedAmount)));
    return {
      chain: "polygon" as const,
      address: v.signer,
      name: matchingMetadata?.name?.trim() || `Polygon Validator #${v.validatorId}`,
      validatorId: v.validatorId,
      validatorShare: v.share,
      commissionPct: Number(v.commissionRate),
      uptimePct,
      jailed: false,
      slashCount: 0,
      totalStaked: total,
    };
  });
  return attachScores(rows);
}

async function fetchMonad(): Promise<ScoredValidator[]> {
  // The transaction ABI takes a uint64 validator ID, not an EVM address.
  // Read the active IDs from the precompile on this deployment's network.
  const rows = await listMonadValidators();
  const partial = rows.map((v) => ({
    chain: "monad" as const,
    address: v.id,
    name: `Monad Validator #${v.id}`,
    commissionPct: v.commissionPct,
    uptimePct: 99.0, // precompile does not expose uptime; score labels must not treat this as measured
    jailed: false, // only the live execution validator set is enumerated
    slashCount: 0,
    totalStaked: v.totalStaked,
  }));
  return attachScores(partial);
}

// --- Cosmos-shape validator fetchers (shared x/staking protobuf schema) ---

async function fetchCosmosChain(
  chain: "cosmos" | "celestia" | "osmosis",
  rpcUrl: string,
  denomDecimals: number
): Promise<ScoredValidator[]> {
  const validators = await listCosmosBondedValidators(chain, rpcUrl);
  const partial = validators.map((v) => ({
    chain,
    address: v.operatorAddress,
    name: v.description?.moniker || v.operatorAddress.slice(0, 14),
    commissionPct: Number(v.commission?.commissionRates?.rate ?? "0.05") * 100,
    uptimePct: 99.0,            // x/staking doesn't ship uptime; would need signing info per validator
    jailed: v.jailed,
    slashCount: 0,
    totalStaked: Number(v.tokens) / 10 ** denomDecimals,
  }));
  return attachScores(partial);
}

function fetchCosmos(): Promise<ScoredValidator[]> {
  // Cosmos Hub provider testnet or mainnet, selected by the shared mode.
  return fetchCosmosChain("cosmos", config.cosmosRpcUrl, 6);
}

function fetchCelestia(): Promise<ScoredValidator[]> {
  return fetchCosmosChain("celestia", config.celestiaRpcUrl, 6);
}

function fetchOsmosis(): Promise<ScoredValidator[]> {
  return fetchCosmosChain("osmosis", config.osmosisRpcUrl, 6);
}

// --- Aptos: only active validators that expose a real delegation pool.
// ValidatorSet addresses alone are NOT valid delegation_pool::add_stake
// targets; the indexer's pool-balance table identifies the native pools. ---

async function fetchAptos(): Promise<ScoredValidator[]> {
  const ledger = await fetchJson<{ chain_id?: number }>(`${config.aptosRestUrl.replace(/\/$/, "")}/v1`);
  assertAptosChainId(ledger?.chain_id);
  const body = await fetchJson<{ data?: { active_validators?: Array<{
    addr?: string;
    voting_power?: string;
  }> } }>(
    `${config.aptosRestUrl.replace(/\/$/, "")}/v1/accounts/0x1/resource/0x1::stake::ValidatorSet`
  );
  const validators = body?.data?.active_validators;
  if (!Array.isArray(validators)) return [];
  const active = new Set(validators.map((v) => v.addr?.toLowerCase()).filter(Boolean));
  const response = await fetch(config.aptosIndexerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: `{ ledger_infos(limit: 1) { chain_id } current_delegated_staking_pool_balances(where: {total_coins: {_gt: "0"}}, order_by: {total_coins: desc}, limit: 500) { staking_pool_address operator_commission_percentage total_coins } }` }),
  });
  if (!response.ok) throw new Error(`Aptos indexer returned ${response.status}`);
  const indexed = await response.json() as { data?: { ledger_infos?: Array<{ chain_id?: number | string }>; current_delegated_staking_pool_balances?: Array<{
    staking_pool_address?: string;
    operator_commission_percentage?: number;
    total_coins?: string;
  }> }; errors?: unknown[] };
  if (indexed.errors?.length) throw new Error(`Aptos indexer query failed: ${JSON.stringify(indexed.errors)}`);
  assertAptosChainId(Number(indexed.data?.ledger_infos?.[0]?.chain_id));
  const pools = indexed.data?.current_delegated_staking_pool_balances ?? [];
  const partial = pools.filter((pool) => !!pool.staking_pool_address && active.has(pool.staking_pool_address.toLowerCase()))
    .map((pool) => ({
    chain: "aptos" as const,
    address: pool.staking_pool_address!,
    name: `Aptos pool ${pool.staking_pool_address!.slice(0, 10)}`,
    commissionPct: Number(pool.operator_commission_percentage ?? 0) / 100,
    uptimePct: 99.0,
    jailed: false,
    slashCount: 0,
    totalStaked: Number(pool.total_coins ?? "0") / 1e8, // octa → APT
  }));
  return attachScores(partial);
}

// --- Solana: getVoteAccounts via the testnet RPC ---

async function fetchSolana(): Promise<ScoredValidator[]> {
  await assertSolanaNetwork();
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

// --- Polkadot Asset Hub nomination pools, not relay-chain validators. ---

async function fetchPolkadot(): Promise<ScoredValidator[]> {
  const rows = await listPolkadotPoolScoreRows();
  return attachScores(rows.map((row) => ({
    chain: "polkadot" as const,
    ...row,
    uptimePct: 99.0, // no pool-specific uptime measurement
    jailed: false, // only open pools
    slashCount: 0, // not measured; never label as verified no-slash history
  })));
}

async function fetchBnb(): Promise<ScoredValidator[]> {
  const validators = await listBnbValidators();
  return attachScores(validators.map((v) => ({
    chain: "bnb" as const,
    address: v.operator,
    name: v.name,
    stakingCredit: v.credit,
    commissionPct: v.commissionPct,
    uptimePct: 99.0, // StakeHub does not expose historical signing uptime.
    jailed: v.jailed,
    slashCount: 0,
    totalStaked: v.totalStaked,
  })));
}

async function fetchSui(): Promise<ScoredValidator[]> {
  type SuiVal = {
    metadata?: { sui_address?: string; name?: string };
    commission_rate?: string;
    staking_pool?: { sui_balance?: string };
  };
  const validators: SuiVal[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const body: {
      data?: { chainIdentifier?: string; epoch?: { validatorSet?: { activeValidators?: {
        nodes?: Array<{ contents?: { json?: SuiVal } }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      } } } };
      errors?: Array<{ message?: string }>;
    } | null = await fetchJson(config.suiGraphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($after: String) { chainIdentifier epoch { validatorSet {
          activeValidators(first: 50, after: $after) {
            nodes { contents { json } } pageInfo { hasNextPage endCursor }
          }
        } } }`,
        variables: { after: cursor },
      }),
    });
    if (body?.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
    assertSuiChainIdentifier(body?.data?.chainIdentifier);
    const connection: {
      nodes?: Array<{ contents?: { json?: SuiVal } }>;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    } | undefined = body?.data?.epoch?.validatorSet?.activeValidators;
    if (!connection?.nodes || !connection.pageInfo) throw new Error("Sui validator GraphQL connection unavailable");
    validators.push(...connection.nodes.flatMap((node: { contents?: { json?: SuiVal } }) =>
      node.contents?.json ? [node.contents.json] : []));
    if (!connection.pageInfo.hasNextPage) break;
    if (!connection.pageInfo.endCursor || connection.pageInfo.endCursor === cursor) throw new Error("Sui validator GraphQL pagination stalled");
    cursor = connection.pageInfo.endCursor;
    if (page === 19) throw new Error("Sui validator GraphQL exceeded 20 pages");
  }

  const partial = validators.filter((v) => !!v.metadata?.sui_address).map((v) => ({
    chain: "sui" as const,
    address: v.metadata!.sui_address!,
    name: v.metadata?.name ?? v.metadata!.sui_address!.slice(0, 14),
    commissionPct: Number(v.commission_rate ?? "0") / 100, // bps → %
    uptimePct: 99.5,
    jailed: false, // connection contains active validators only
    slashCount: 0,
    totalStaked: Number(v.staking_pool?.sui_balance ?? "0") / 1e9, // MIST → SUI
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

  // The wall (ENABLED_CHAINS): a walled chain is never fetched — no RPC
  // calls, no cache writes, no slashing alerts. Callers get an honest
  // empty snapshot so the /api/validators shape stays uniform.
  if (!config.enabledChains.has(chain)) {
    return {
      chain,
      fetchedAt: new Date().toISOString(),
      source: "stub",
      validators: [],
      warnings: [
        `chain is behind the staking wall (enabled: ${[...config.enabledChains].join(", ")})`,
      ],
    };
  }
  let validators: ScoredValidator[] = [];
  try {
    validators = await FETCHERS[chain]();
  } catch (err) {
    warnings.push(`fetch failed: ${String(err)}`);
  }
  if (chain === "polkadot" && validators.length > 0) {
    warnings.push("Pool balances and commissions are live; pool-specific yield, uptime, and slash history are not measured.");
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
    // Walled chains are not scheduled or refreshed; one skip line beats
    // an hourly stub write to the cache.
    const open = chains.filter((c) => config.enabledChains.has(c));
    if (open.length < chains.length) {
      console.log(
        `[validator-scoring] skipping walled chain(s): ${chains.filter((c) => !config.enabledChains.has(c)).join(", ")}`
      );
    }
    for (const c of open) {
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
