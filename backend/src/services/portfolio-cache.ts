/**
 * Portfolio cache — per-(chain, address) delegated balance lookup with a
 * Redis 60 s TTL so the frontend's analytics polling doesn't hammer
 * upstream RPCs.
 *
 * Architecture mirrors `validator-scoring.ts`: the backend owns the
 * per-chain fetchers, Redis caches the snapshot, and a HTTP route
 * (`/api/portfolio/:address`) returns the aggregate to the UI. This is
 * the abstraction Codex's future chain adapters plug into — when a
 * Monad / Cosmos / Sui adapter lands on the frontend, mirror
 * its `getDelegations` shape into a `fetchDelegations<chain>` here and
 * register it in the FETCHERS map.
 *
 * Polygon reads the real per-validator ValidatorShare contracts on the L1
 * settlement chain. Every other chain returns `[]` from a stub fetcher, which
 * is honest in the UI: no fake numbers shown.
 */

import { formatEther, type Address } from "viem";
import IORedis from "ioredis";
import { config } from "../config.js";
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
  totalUsd: number;
  delegations: DelegationRow[];
  source: Record<PortfolioChain, "live" | "stub" | "cache">;
}

// --- Redis ---

const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const PORTFOLIO_PREFIX = "portfolio:";

function cacheKey(chain: PortfolioChain, address: string): string {
  return `${PORTFOLIO_PREFIX}${chain}:${address.toLowerCase()}`;
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
  try {
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
      if (res.status !== "success") return;
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
  } catch (err) {
    console.warn(`[portfolio-cache] polygon fetch failed:`, err);
    return [];
  }
}

// Stubs for chains Codex hasn't wired adapters for yet. When a real
// adapter lands, replace these with the chain's RPC call (or proxy
// through the frontend adapter via a backend mirror).
async function fetchStub(): Promise<DelegationRow[]> {
  return [];
}

const FETCHERS: Record<
  PortfolioChain,
  (address: string) => Promise<DelegationRow[]>
> = {
  polygon: fetchPolygon,
  monad: fetchStub,
  cosmos: fetchStub,
  celestia: fetchStub,
  osmosis: fetchStub,
  sui: fetchStub,
  aptos: fetchStub,
  polkadot: fetchStub,
  bnb: fetchStub,
  solana: fetchStub,
};

// --- Public API ----------------------------------------------------------

/**
 * Fetch delegations for a single chain, cached on Redis for
 * portfolioCacheTtlSec. Returns the rows + which path they came from
 * ("cache" | "live" | "stub").
 */
export async function getChainDelegations(
  chain: PortfolioChain,
  address: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<{ rows: DelegationRow[]; source: "cache" | "live" | "stub" }> {
  if (!opts.forceRefresh) {
    const cached = await readChainCache(chain, address);
    if (cached !== null) return { rows: cached, source: "cache" };
  }
  const rows = await FETCHERS[chain](address);
  await writeChainCache(chain, address, rows);
  return { rows, source: rows.length > 0 ? "live" : "stub" };
}

// Rough USD prices for the visualizer. Production would use a price
// oracle (CoinGecko, Pyth, etc.). These are intentionally hardcoded for
// the hackathon; the UI displays them as "indicative".
const USD_PER: Record<string, number> = {
  POL: 0.45,
  MON: 0.55,
  ATOM: 4.5,
  SUI: 1.2,
  CC: 0.147,
};

/**
 * Build a full multi-chain portfolio snapshot for an address.
 */
export async function getPortfolio(
  address: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<PortfolioSnapshot> {
  const chains: PortfolioChain[] = [
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

  const results = await Promise.all(
    chains.map(async (c) => [c, await getChainDelegations(c, address, opts)] as const)
  );

  const delegations: DelegationRow[] = [];
  const source = {} as Record<PortfolioChain, "live" | "stub" | "cache">;
  let totalUsd = 0;

  for (const [chain, { rows, source: src }] of results) {
    delegations.push(...rows);
    source[chain] = src;
    for (const r of rows) {
      const price = USD_PER[r.symbol] ?? 0;
      totalUsd += Number(r.amount) * price;
    }
  }

  return {
    address: address.toLowerCase(),
    fetchedAt: new Date().toISOString(),
    totalUsd,
    delegations,
    source,
  };
}

/** Compute the USD value of a single delegation row. */
export function delegationUsd(row: DelegationRow): number {
  const price = USD_PER[row.symbol] ?? 0;
  return Number(row.amount) * price;
}
