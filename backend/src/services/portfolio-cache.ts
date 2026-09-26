/**
 * Portfolio cache — per-(chain, address) delegated balance lookup with a
 * Redis 60 s TTL so the frontend's analytics polling doesn't hammer
 * upstream RPCs.
 *
 * Polygon reads the real per-validator ValidatorShare contracts on Ethereum
 * settlement. Other chains read their Canton-recorded lifecycle and the
 * chain/validator mirror. This endpoint accepts one wallet address at a time;
 * callers with multiple wallet families must query each connected address.
 */

import { formatEther, type Address } from "viem";
import IORedis from "ioredis";
import { config } from "../config.js";
import { canton, TEMPLATES } from "../canton.js";
import { prisma } from "../db.js";
import { getUsdPrices, usdPrice } from "./prices.js";
import { normalizeWalletAddress, sameWalletAddress } from "./wallet-address.js";
import { PORTFOLIO_CHAINS, portfolioUsdTotal, recordedDelegations } from "./portfolio-recorded.js";
import {
  listActiveValidatorShares,
  settlementClient,
  validatorShareAbi,
} from "./validator-share.js";
import type { SupportedChain } from "./validator-scoring.js";

// --- Types ---

export type PortfolioChain = SupportedChain;

export interface DelegationRow {
  chain: PortfolioChain;
  validator: string;
  amount: string;          // chain-native units, decimal string
  symbol: string;          // POL / MON / ATOM / SUI
  status: "bonded" | "unbonding" | "released";
  unbondingReadyAt?: number;
}

export interface PortfolioSnapshot {
  address: string;
  fetchedAt: string;
  totalUsd: number | null;
  delegations: DelegationRow[];
  source: Record<PortfolioChain, "live" | "unavailable" | "cache" | "canton">;
  unclassifiedPositions: number;
  /** Which price table valued the rows (mainnet: CoinGecko live or its fixed fallback). */
  priceSource?: "coingecko" | "fixed";
}

// --- Redis ---

const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const PORTFOLIO_PREFIX = "portfolio:";

function cacheKey(chain: PortfolioChain, address: string): string {
  return `${PORTFOLIO_PREFIX}${chain}:${normalizeWalletAddress(address)}`;
}

async function readChainCache(
  chain: PortfolioChain,
  address: string
): Promise<DelegationRow[] | null> {
  try {
    const raw = await redis.get(cacheKey(chain, address));
    return raw ? (JSON.parse(raw) as DelegationRow[]) : null;
  } catch (err) {
    console.warn(`[portfolio-cache] redis read failed ${chain}:`, err);
    return null;
  }
}

async function writeChainCache(
  chain: PortfolioChain,
  address: string,
  rows: DelegationRow[]
): Promise<void> {
  try {
    await redis.set(
      cacheKey(chain, address),
      JSON.stringify(rows),
      "EX",
      config.portfolioCacheTtlSec
    );
  } catch (err) {
    console.warn(`[portfolio-cache] redis write failed ${chain}:`, err);
  }
}

// --- Per-chain fetchers --------------------------------------------------

/**
 * Real Polygon delegations for an address.
 *
 * There is no single contract to query: each validator has its own
 * ValidatorShare, so we ask every active one at once via multicall and keep
 * the non-zero answers. `getTotalStake` returns the stake-token value of the
 * delegator's shares, which already accounts for the exchange rate — shares
 * are NOT 1:1 with POL.
 */
async function fetchPolygon(address: string): Promise<DelegationRow[]> {
  const validators = await listActiveValidatorShares();
  if (validators.length === 0) return [];

  const results = await settlementClient.multicall({
    contracts: validators.map((v) => ({
      address: v.share as Address,
      abi: validatorShareAbi,
      functionName: "getTotalStake" as const,
      args: [address as Address] as const,
    })),
    allowFailure: true,
  });

  const rows: DelegationRow[] = [];
  results.forEach((res, i) => {
    if (res.status !== "success") throw new Error(`Polygon ValidatorShare read failed at index ${i}`);
    const amount = (res.result as readonly bigint[])[0] ?? 0n;
    if (amount === 0n) return;
    const v = validators[i]!;
    rows.push({
      chain: "polygon",
      validator: v.signer,
      amount: formatEther(amount),
      symbol: "POL",
      status: "bonded",
    });
  });
  return rows;
}

async function fetchRecorded(address: string) {
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const matching = active.filter((contract) =>
    sameWalletAddress((contract.argument as { evmAddress?: string }).evmAddress, address));
  const mirrors = await prisma.stakingPosition.findMany({
    where: { contractId: { in: matching.map((contract) => contract.contractId) } },
    select: { contractId: true, chain: true, validatorAddress: true, validatorShare: true },
  });
  return recordedDelegations(matching, mirrors, address, config.networkMode);
}

// --- Public API ----------------------------------------------------------

/**
 * Fetch delegations for a single chain, cached on Redis for
 * portfolioCacheTtlSec for Polygon. Native-chain rows are read from Canton
 * so a cached zero cannot hide a newly settled position.
 */
export async function getChainDelegations(
  chain: PortfolioChain,
  address: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<{ rows: DelegationRow[]; source: "cache" | "live" | "unavailable" | "canton" }> {
  if (chain !== "polygon") {
    const recorded = await fetchRecorded(address);
    return { rows: recorded.rows.filter((row) => row.chain === chain), source: "canton" };
  }
  if (!opts.forceRefresh) {
    const cached = await readChainCache(chain, address);
    if (cached !== null) return { rows: cached, source: "cache" };
  }
  try {
    const rows = await fetchPolygon(address);
    await writeChainCache(chain, address, rows);
    return { rows, source: "live" };
  } catch (error) {
    console.warn("[portfolio-cache] Polygon delegation read unavailable:", error);
    return { rows: [], source: "unavailable" };
  }
}

/**
 * Build a full multi-chain portfolio snapshot for an address.
 */
export async function getPortfolio(
  address: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<PortfolioSnapshot> {
  const [recorded, polygon] = await Promise.all([
    fetchRecorded(address),
    /^0x[0-9a-fA-F]{40}$/.test(address)
      ? getChainDelegations("polygon", address, opts)
      : Promise.resolve({ rows: [] as DelegationRow[], source: "canton" as const }),
  ]);
  // On-chain bonded Polygon stake is authoritative; Canton also tracks its
  // unbonding claims, which are no longer part of getTotalStake().
  const delegations: DelegationRow[] = [
    ...polygon.rows,
    ...recorded.rows.filter((row) => row.chain !== "polygon" || row.status === "unbonding"),
  ];
  const source = Object.fromEntries(PORTFOLIO_CHAINS.map((chain) =>
    [chain, chain === "polygon" ? polygon.source : "canton"],
  )) as PortfolioSnapshot["source"];

  const { prices, source: priceSource } = await getUsdPrices(
    [...new Set(delegations.map((r) => r.symbol))]
  );

  // Faucet assets are not worth their namesake mainnet token's market price.
  // Missing market data or mirror metadata must not become a fake $0 total.
  const totalUsd = polygon.source === "unavailable" ? null : portfolioUsdTotal(
    delegations, prices, config.networkMode, recorded.unclassifiedPositions);

  return {
    address: normalizeWalletAddress(address),
    fetchedAt: new Date().toISOString(),
    totalUsd,
    delegations,
    source,
    unclassifiedPositions: recorded.unclassifiedPositions,
    priceSource,
  };
}

/** Compute the USD value of a single delegation row. */
export function delegationUsd(row: DelegationRow): number | null {
  if (config.networkMode !== "mainnet") return null;
  const price = usdPrice(row.symbol);
  const value = Number(row.amount) * price;
  return price > 0 && Number.isFinite(value) ? value : null;
}
