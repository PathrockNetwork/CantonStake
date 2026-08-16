/**
 * Polygon PoS ValidatorShare resolver + share math (Phase 2 / T2.1, T2.2, T2.3, T2.4).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Polygon PoS staking does NOT settle on the Bor chain (Amoy / Polygon
 * mainnet). `StakeManager`, `StakingInfo` (the event logger) and one
 * `ValidatorShare` contract **per validator** are deployed on Ethereum L1 —
 * Sepolia for Amoy, mainnet for Polygon mainnet. Verified on-chain
 * 2026-08-14 against Sepolia (chainId 11155111):
 *
 *   StakeManager   0x4AE8f648B1Ec892B6cc68C89cc088583964d08bE
 *   StakingInfo    0x5E3111a5d928D24718c1A7897261D0B9087002ed  (== StakeManager.logger())
 *   RootChain      0xbd07D7E1E93c8d4b2a261327F3C28a8EA7167209  (== StakeManager.rootChain())
 *   stake token    0x44499312f493F62f2DFd3C6435Ca3603EbFCeeBa  (POL, == StakeManager.token())
 *
 * The old code carried a single global `config.mockValidatorShare`. That is
 * structurally wrong for real Polygon: the address is per-VALIDATOR, so every
 * call site has to resolve it. This module is that resolver.
 *
 * ON-CHAIN FACTS THIS MODULE ENCODES (all verified, not assumed):
 *
 *  - `StakeManager.validators(validatorId)` returns a struct whose
 *    `contractAddress` field is that validator's ValidatorShare.
 *  - `StakeManager.signerToValidator(signer)` maps the validator's signer
 *    address (what the staking API and our validator-scoring service call the
 *    validator "address") back to its numeric validatorId.
 *  - Share price is NOT 1:1. `ValidatorShare.exchangeRate()` is scaled by a
 *    precision constant that DIFFERS by validator age: the original
 *    "foundation" validators (validatorId < 8) use 100, every later validator
 *    uses 1e29. Confirmed on Sepolia: id 1..7 report exchangeRate 100, id 8+
 *    report 1e29.
 *        shares = amount * precision / exchangeRate()
 *        amount = shares * exchangeRate() / precision
 *  - Delegation is an ERC-20 flow: `buyVoucher` is NOT payable. The delegator
 *    approves the **StakeManager** (not the ValidatorShare) to move the stake
 *    token, then calls `buyVoucher` on the ValidatorShare. Confirmed by
 *    replaying a live Sepolia delegation: the tx contains
 *    `Approval(owner=delegator, spender=StakeManager)` on the POL token.
 *  - Delegation events are emitted by the shared **StakingInfo logger**, not
 *    by the ValidatorShare, and carry `validatorId` as the first indexed
 *    topic. Confirmed by decoding live logger logs.
 *  - Unbonding is checkpoint-based, not wall-clock. `sellVoucher_new` records
 *    `unbonds_new[user][nonce] = (shares, withdrawEpoch)`;
 *    `unstakeClaimTokens_new` requires
 *        withdrawEpoch + StakeManager.withdrawalDelay() <= StakeManager.epoch()
 *    `withdrawalDelay()` reads 80 checkpoints on this deployment. Wall-clock
 *    ETA is therefore derived, not constant — see getCheckpointCadenceSeconds.
 */

import IORedis from "ioredis";
import {
  createPublicClient,
  fallback,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { config } from "../config.js";

// --- Chain + client -------------------------------------------------------

const SETTLEMENT_CHAINS = { [sepolia.id]: sepolia, [mainnet.id]: mainnet } as const;

function settlementChain() {
  const chain =
    SETTLEMENT_CHAINS[config.stakeSettlementChainId as keyof typeof SETTLEMENT_CHAINS];
  if (!chain) {
    throw new Error(
      `Unsupported STAKE_SETTLEMENT_CHAIN_ID=${config.stakeSettlementChainId} (expected ${sepolia.id} or ${mainnet.id})`
    );
  }
  return chain;
}

/** The viem chain definition for the L1 settlement chain. */
export const settlementChainDef = settlementChain();

/**
 * L1 client for everything staking-related. Note this is deliberately NOT the
 * Bor/Amoy client — Bor only carries POL balances and explorer links.
 *
 * Mainnet runs two free endpoints through viem's fallback transport because
 * neither is reliable alone: mevblocker occasionally stalls eth_getLogs past
 * the 10 s timeout, publicnode intermittently rejects even 50-block windows
 * as "archive" (see config.stakeSettlementRpcUrl for the full probe log).
 * A failed or timed-out request on the primary retries on the fallback.
 */
const settlementTransports = [http(config.stakeSettlementRpcUrl)];
if (config.stakeSettlementFallbackRpcUrl) {
  settlementTransports.push(http(config.stakeSettlementFallbackRpcUrl));
}

export const settlementClient: PublicClient = createPublicClient({
  chain: settlementChainDef,
  transport: fallback(settlementTransports),
}) as PublicClient;

export const stakeManagerAddress = config.stakeManagerAddress as Address;
export const stakingLoggerAddress = config.stakingLoggerAddress as Address;

// --- ABIs -----------------------------------------------------------------

export const stakeManagerAbi = parseAbi([
  "function validators(uint256) view returns (uint256 amount, uint256 reward, uint256 activationEpoch, uint256 deactivationEpoch, uint256 jailTime, address signer, address contractAddress, uint8 status, uint256 commissionRate, uint256 lastCommissionUpdate, uint256 delegatorsReward, uint256 delegatedAmount, uint256 initialRewardPerStake)",
  "function signerToValidator(address) view returns (uint256)",
  "function NFTCounter() view returns (uint256)",
  "function currentValidatorSetSize() view returns (uint256)",
  "function epoch() view returns (uint256)",
  "function withdrawalDelay() view returns (uint256)",
  "function token() view returns (address)",
  "function logger() view returns (address)",
  "function rootChain() view returns (address)",
  "function delegationEnabled() view returns (bool)",
]);

export const validatorShareAbi = parseAbi([
  "function validatorId() view returns (uint256)",
  "function exchangeRate() view returns (uint256)",
  "function withdrawExchangeRate() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function minAmount() view returns (uint256)",
  "function getTotalStake(address) view returns (uint256, uint256)",
  "function getLiquidRewards(address) view returns (uint256)",
  "function unbondNonces(address) view returns (uint256)",
  "function unbonds_new(address, uint256) view returns (uint256 shares, uint256 withdrawEpoch)",
  "function buyVoucher(uint256 _amount, uint256 _minSharesToMint) returns (uint256)",
  "function sellVoucher_new(uint256 claimAmount, uint256 maximumSharesToBurn)",
  "function unstakeClaimTokens_new(uint256 unbondNonce)",
  "function withdrawRewards()",
  "function restake() returns (uint256, uint256)",
]);

/**
 * Delegation events, as emitted by the shared StakingInfo logger. `amount` is
 * indexed on all of these (it is the third indexed topic), which is why the
 * event data payload is often empty.
 */
export const stakingLoggerAbi = parseAbi([
  "event ShareMinted(uint256 indexed validatorId, address indexed user, uint256 indexed amount, uint256 tokens)",
  "event ShareBurned(uint256 indexed validatorId, address indexed user, uint256 indexed amount, uint256 tokens)",
  "event ShareBurnedWithId(uint256 indexed validatorId, address indexed user, uint256 indexed amount, uint256 tokens, uint256 nonce)",
  "event DelegatorUnstaked(uint256 indexed validatorId, address indexed user, uint256 amount)",
  "event DelegatorUnstakeWithId(uint256 indexed validatorId, address indexed user, uint256 amount, uint256 nonce)",
  "event DelegatorClaimedRewards(uint256 indexed validatorId, address indexed user, uint256 indexed rewards)",
  "event DelegatorRestaked(uint256 indexed validatorId, address indexed user, uint256 totalStaked)",
]);

export const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const rootChainAbi = parseAbi([
  "function currentHeaderBlock() view returns (uint256)",
  "function headerBlocks(uint256) view returns (bytes32 root, uint256 start, uint256 end, uint256 createdAt, address proposer)",
]);

// --- Redis cache ----------------------------------------------------------

const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
// Chain-scoped: the same key set serves Sepolia and mainnet depending on
// NETWORK_MODE, and a mode flip must never serve the other chain's
// registry/epoch/token (observed 2026-08-16: a mainnet run cached 138
// validators and the testnet backend then served mainnet share contracts).
const PREFIX = `vshare:${config.stakeSettlementChainId}:`;

async function cached<T>(
  key: string,
  ttlSec: number,
  load: () => Promise<T>
): Promise<T> {
  const full = `${PREFIX}${key}`;
  try {
    const raw = await redis.get(full);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[validator-share] redis read failed ${key}:`, err);
  }
  const value = await load();
  try {
    await redis.set(full, JSON.stringify(value), "EX", ttlSec);
  } catch (err) {
    console.warn(`[validator-share] redis write failed ${key}:`, err);
  }
  return value;
}

/** Drop every cached entry. Exposed for the admin refresh route. */
export async function invalidateValidatorShareCache(): Promise<number> {
  const keys = await redis.keys(`${PREFIX}*`);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}

// --- Validator registry ---------------------------------------------------

export interface ValidatorShareEntry {
  validatorId: number;
  /** The validator's signer address — the id our validator-scoring uses. */
  signer: string;
  /** This validator's own ValidatorShare contract. */
  share: string;
  /** StakeManager Status enum: 0 Inactive, 1 Active, 2 Locked, 3 Unstaked. */
  status: number;
  commissionRate: string;
  selfStake: string;
  delegatedAmount: string;
  /** buyVoucher reverts below this. Read live per validator — the real
   * minimum differs between testnet and mainnet deployments. */
  minAmount: string;
}

/**
 * Full validator registry read straight off StakeManager. Cached because it
 * is ~NFTCounter sequential eth_calls and only changes when a validator joins
 * or leaves.
 */
export async function listValidatorShares(): Promise<ValidatorShareEntry[]> {
  return cached("registry", config.validatorShareCacheTtlSec, async () => {
    const count = await settlementClient.readContract({
      address: stakeManagerAddress,
      abi: stakeManagerAbi,
      functionName: "NFTCounter",
    });

    const ids = Array.from({ length: Number(count) - 1 }, (_, i) => BigInt(i + 1));
    const results = await settlementClient.multicall({
      contracts: ids.map((id) => ({
        address: stakeManagerAddress,
        abi: stakeManagerAbi,
        functionName: "validators" as const,
        args: [id] as const,
      })),
      allowFailure: true,
    });

    const base: ValidatorShareEntry[] = [];
    results.forEach((res, i) => {
      if (res.status !== "success") return;
      const v = res.result as readonly unknown[];
      const signer = v[5] as string;
      const share = v[6] as string;
      if (!share || share === ZERO_ADDRESS) return;
      base.push({
        validatorId: Number(ids[i]),
        signer,
        share,
        status: Number(v[7]),
        commissionRate: String(v[8]),
        selfStake: String(v[0]),
        delegatedAmount: String(v[11]),
        minAmount: "0",
      });
    });

    // Per-validator buyVoucher floor. One extra multicall; cached with the
    // registry so this stays one batch per TTL.
    try {
      const minResults = await settlementClient.multicall({
        contracts: base.map((e) => ({
          address: e.share as Address,
          abi: validatorShareAbi,
          functionName: "minAmount" as const,
        })),
        allowFailure: true,
      });
      base.forEach((e, i) => {
        const r = minResults[i];
        if (r && r.status === "success") e.minAmount = String(r.result);
      });
    } catch (err) {
      console.warn("[validator-share] minAmount batch read failed:", err);
    }
    return base;
  });
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Only validators that can actually accept a delegation right now. */
export async function listActiveValidatorShares(): Promise<ValidatorShareEntry[]> {
  const all = await listValidatorShares();
  return all.filter((v) => v.status === 1 && v.signer !== ZERO_ADDRESS);
}

/** validatorId → ValidatorShare address. The P2.1 primitive. */
export async function shareForValidatorId(
  validatorId: number | bigint
): Promise<Address | null> {
  const id = Number(validatorId);
  const registry = await listValidatorShares();
  const hit = registry.find((v) => v.validatorId === id);
  if (hit) return hit.share as Address;

  // Registry may be stale (validator registered after the last cache fill).
  // Fall back to a direct read rather than returning a wrong answer.
  try {
    const v = (await settlementClient.readContract({
      address: stakeManagerAddress,
      abi: stakeManagerAbi,
      functionName: "validators",
      args: [BigInt(id)],
    })) as readonly unknown[];
    const share = v[6] as string;
    return share && share !== ZERO_ADDRESS ? (share as Address) : null;
  } catch (err) {
    console.warn(`[validator-share] validators(${id}) read failed:`, err);
    return null;
  }
}

/**
 * Validator signer address → { validatorId, share }.
 *
 * This is the lookup every app-level call site needs, because the UI and the
 * validator-scoring service both identify a validator by its signer address.
 */
export async function resolveValidatorShare(
  signer: string
): Promise<{ validatorId: number; share: Address } | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(signer)) return null;
  const lower = signer.toLowerCase();

  const registry = await listValidatorShares();
  const hit = registry.find((v) => v.signer.toLowerCase() === lower);
  if (hit) return { validatorId: hit.validatorId, share: hit.share as Address };

  try {
    const id = await settlementClient.readContract({
      address: stakeManagerAddress,
      abi: stakeManagerAbi,
      functionName: "signerToValidator",
      args: [signer as Address],
    });
    if (id === 0n) return null;
    const share = await shareForValidatorId(id);
    return share ? { validatorId: Number(id), share } : null;
  } catch (err) {
    console.warn(`[validator-share] signerToValidator(${signer}) failed:`, err);
    return null;
  }
}

/** signer → ValidatorShare map, lowercased keys. Feeds the frontend env map. */
export async function validatorShareMap(): Promise<Record<string, string>> {
  const active = await listActiveValidatorShares();
  return Object.fromEntries(active.map((v) => [v.signer.toLowerCase(), v.share]));
}

// --- Share math (P2.3) ----------------------------------------------------

/**
 * Polygon's own `_getRatePrecision`: the eight original foundation validators
 * predate the high-precision exchange rate and still use 100.
 */
export function ratePrecision(validatorId: number | bigint): bigint {
  return BigInt(validatorId) < 8n ? 100n : 10n ** 29n;
}

export interface ExchangeRateInfo {
  validatorId: number;
  /** Raw exchangeRate() — scaled by `precision`, NOT by 1e18. */
  rate: bigint;
  /** withdrawExchangeRate(), used by sellVoucher_new. */
  withdrawRate: bigint;
  precision: bigint;
}

export async function getExchangeRate(
  share: Address,
  validatorId?: number
): Promise<ExchangeRateInfo> {
  const id =
    validatorId ??
    Number(
      await settlementClient.readContract({
        address: share,
        abi: validatorShareAbi,
        functionName: "validatorId",
      })
    );
  const [rate, withdrawRate] = await Promise.all([
    settlementClient.readContract({
      address: share,
      abi: validatorShareAbi,
      functionName: "exchangeRate",
    }),
    settlementClient.readContract({
      address: share,
      abi: validatorShareAbi,
      functionName: "withdrawExchangeRate",
    }),
  ]);
  return { validatorId: id, rate, withdrawRate, precision: ratePrecision(id) };
}

/** shares minted for `amount` of stake token — mirrors ValidatorShare._buyShares. */
export function sharesForAmount(
  amount: bigint,
  rate: bigint,
  precision: bigint
): bigint {
  if (rate === 0n) return 0n;
  return (amount * precision) / rate;
}

/** stake-token value of `shares` — mirrors ValidatorShare.getTotalStake. */
export function amountForShares(
  shares: bigint,
  rate: bigint,
  precision: bigint
): bigint {
  return (shares * rate) / precision;
}

/** Apply a slippage tolerance in basis points, rounding against the user. */
export function withSlippage(
  value: bigint,
  bps: number,
  direction: "min" | "max"
): bigint {
  const factor = BigInt(Math.round(bps));
  return direction === "min"
    ? (value * (10_000n - factor)) / 10_000n
    : (value * (10_000n + factor)) / 10_000n;
}

// --- Positions ------------------------------------------------------------

export interface StakeSnapshot {
  /** Stake-token value of the delegator's shares, in wei. */
  amountWei: bigint;
  /** Raw share balance. */
  shares: bigint;
  /** Claimable protocol yield, in wei — NOT a pre-funded balance. */
  liquidRewardsWei: bigint;
}

export async function getStakeSnapshot(
  share: Address,
  delegator: Address
): Promise<StakeSnapshot> {
  const [total, shares, rewards] = await Promise.all([
    settlementClient.readContract({
      address: share,
      abi: validatorShareAbi,
      functionName: "getTotalStake",
      args: [delegator],
    }),
    settlementClient.readContract({
      address: share,
      abi: validatorShareAbi,
      functionName: "balanceOf",
      args: [delegator],
    }),
    settlementClient.readContract({
      address: share,
      abi: validatorShareAbi,
      functionName: "getLiquidRewards",
      args: [delegator],
    }),
  ]);
  return {
    amountWei: (total as readonly bigint[])[0] ?? 0n,
    shares: shares as bigint,
    liquidRewardsWei: rewards as bigint,
  };
}

/** Claimable protocol yield for one (validator, delegator) pair. P2.5. */
export async function getLiquidRewards(
  share: Address,
  delegator: Address
): Promise<bigint> {
  return (await settlementClient.readContract({
    address: share,
    abi: validatorShareAbi,
    functionName: "getLiquidRewards",
    args: [delegator],
  })) as bigint;
}

// --- Unbonding (P2.4) -----------------------------------------------------

export async function getCurrentEpoch(): Promise<bigint> {
  return cached("epoch", 60, async () =>
    settlementClient.readContract({
      address: stakeManagerAddress,
      abi: stakeManagerAbi,
      functionName: "epoch",
    })
  ).then((v) => BigInt(v as string | bigint));
}

export async function getWithdrawalDelayEpochs(): Promise<bigint> {
  return cached("withdrawalDelay", 3600, async () =>
    settlementClient.readContract({
      address: stakeManagerAddress,
      abi: stakeManagerAbi,
      functionName: "withdrawalDelay",
    })
  ).then((v) => BigInt(v as string | bigint));
}

export async function getStakeToken(): Promise<Address> {
  return cached("token", 86_400, async () =>
    settlementClient.readContract({
      address: stakeManagerAddress,
      abi: stakeManagerAbi,
      functionName: "token",
    })
  ) as Promise<Address>;
}

/**
 * Measured seconds-per-checkpoint, sampled from the RootChain's recent
 * header blocks.
 *
 * There is no constant to read here: a "checkpoint" lands whenever Heimdall
 * proposers submit one, so the only truthful wall-clock ETA is an observed
 * cadence. We sample the last CHECKPOINT_SAMPLES header blocks and average
 * the gaps. On Sepolia this currently measures ~1,070 s (~18 min), which
 * makes the 80-checkpoint withdrawal delay land near 24 h — NOT the 21 days
 * quoted for Cosmos-style chains, and not the mock's 60 s either.
 */
const CHECKPOINT_SAMPLES = 12;
const HEADER_BLOCK_STEP = 10_000n;

export async function getCheckpointCadenceSeconds(): Promise<number> {
  return cached("checkpointCadence", 3600, async () => {
    const rootChain = (await settlementClient.readContract({
      address: stakeManagerAddress,
      abi: stakeManagerAbi,
      functionName: "rootChain",
    })) as Address;

    const current = (await settlementClient.readContract({
      address: rootChain,
      abi: rootChainAbi,
      functionName: "currentHeaderBlock",
    })) as bigint;

    const ids: bigint[] = [];
    for (let i = 0n; i < BigInt(CHECKPOINT_SAMPLES); i++) {
      const id = current - i * HEADER_BLOCK_STEP;
      if (id <= 0n) break;
      ids.push(id);
    }

    const results = await settlementClient.multicall({
      contracts: ids.map((id) => ({
        address: rootChain,
        abi: rootChainAbi,
        functionName: "headerBlocks" as const,
        args: [id] as const,
      })),
      allowFailure: true,
    });

    const timestamps = results
      .filter((r) => r.status === "success")
      .map((r) => Number((r.result as readonly bigint[])[3]))
      .filter((t) => t > 0)
      .sort((a, b) => b - a);

    if (timestamps.length < 2) {
      throw new Error("could not sample checkpoint cadence from RootChain");
    }
    const span = timestamps[0]! - timestamps[timestamps.length - 1]!;
    return Math.round(span / (timestamps.length - 1));
  });
}

export interface UnbondInfo {
  nonce: bigint;
  shares: bigint;
  withdrawEpoch: bigint;
  /** Epoch at which unstakeClaimTokens_new stops reverting. */
  claimableAtEpoch: bigint;
  currentEpoch: bigint;
  epochsRemaining: number;
  claimable: boolean;
  /**
   * Whether the on-chain unbond record still exists. It is deleted when the
   * delegator actually calls unstakeClaimTokens_new, so `false` after a
   * non-zero nonce means "the claim already happened".
   */
  exists: boolean;
  /** Derived, not authoritative — see getCheckpointCadenceSeconds. */
  etaSeconds: number;
  /** Unix seconds. Derived from etaSeconds. */
  readyAtEstimate: number;
}

export async function getUnbond(
  share: Address,
  delegator: Address,
  nonce: bigint
): Promise<UnbondInfo> {
  const [record, currentEpoch, delay] = await Promise.all([
    settlementClient.readContract({
      address: share,
      abi: validatorShareAbi,
      functionName: "unbonds_new",
      args: [delegator, nonce],
    }),
    getCurrentEpoch(),
    getWithdrawalDelayEpochs(),
  ]);

  const [shares, withdrawEpoch] = record as readonly [bigint, bigint];
  const claimableAtEpoch = withdrawEpoch + delay;
  const epochsRemaining = Number(
    claimableAtEpoch > currentEpoch ? claimableAtEpoch - currentEpoch : 0n
  );

  let cadence = 0;
  try {
    cadence = await getCheckpointCadenceSeconds();
  } catch (err) {
    console.warn("[validator-share] checkpoint cadence unavailable:", err);
  }
  const etaSeconds = epochsRemaining * cadence;

  return {
    nonce,
    shares,
    withdrawEpoch,
    claimableAtEpoch,
    currentEpoch,
    epochsRemaining,
    claimable: shares > 0n && currentEpoch >= claimableAtEpoch,
    exists: shares > 0n,
    etaSeconds,
    readyAtEstimate: Math.floor(Date.now() / 1000) + etaSeconds,
  };
}

export async function getLatestUnbond(
  share: Address,
  delegator: Address
): Promise<UnbondInfo | null> {
  const nonce = (await settlementClient.readContract({
    address: share,
    abi: validatorShareAbi,
    functionName: "unbondNonces",
    args: [delegator],
  })) as bigint;
  if (nonce === 0n) return null;
  return getUnbond(share, delegator, nonce);
}

// --- Aggregate parameters (served to the frontend) ------------------------

export interface PolygonStakingParams {
  settlementChainId: number;
  stakeManager: string;
  stakingLogger: string;
  stakeToken: string;
  currentEpoch: string;
  withdrawalDelayEpochs: number;
  checkpointCadenceSeconds: number | null;
  /** withdrawalDelayEpochs * cadence — the honest full-unbonding estimate. */
  unbondingEtaSeconds: number | null;
  activeValidatorCount: number;
}

export async function getPolygonStakingParams(): Promise<PolygonStakingParams> {
  const [token, epoch, delay, active] = await Promise.all([
    getStakeToken(),
    getCurrentEpoch(),
    getWithdrawalDelayEpochs(),
    listActiveValidatorShares(),
  ]);

  let cadence: number | null = null;
  try {
    cadence = await getCheckpointCadenceSeconds();
  } catch {
    cadence = null;
  }

  return {
    settlementChainId: config.stakeSettlementChainId,
    stakeManager: stakeManagerAddress,
    stakingLogger: stakingLoggerAddress,
    stakeToken: token,
    currentEpoch: epoch.toString(),
    withdrawalDelayEpochs: Number(delay),
    checkpointCadenceSeconds: cadence,
    unbondingEtaSeconds: cadence === null ? null : Number(delay) * cadence,
    activeValidatorCount: active.length,
  };
}
