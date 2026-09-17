import { config } from "../config.js";

// USD reference prices for portfolio valuation (routes/portfolio.ts,
// services/portfolio-snapshots.ts). Split by network mode:
//
//   - testnet: the fixed table below is the price (labelled "indicative"
//     in the UI). No market calls.
//   - mainnet: live CoinGecko prices, refreshed at most once per
//     CACHE_TTL_MS, with the fixed table as the offline/cold fallback.
//     The response carries which source served the numbers.
//
// CC has no market price in either mode — the Canton ledger stays
// LocalNet/DevNet in both (docs/NETWORK_MODES.md), so the fixed reference
// value applies everywhere.
const FIXED_USD_PER: Record<string, number> = {
  POL: 0.45,
  MON: 0.55,
  ATOM: 4.5,
  SUI: 1.2,
  CC: 0.147,
};

// CoinGecko coin ids for staked tokens (all resolved against the live API
// on 2026-09-17 — MON is "monad", not "mon"). Symbols without an entry
// (CC, and any testnet-only token like WND/tBNB) keep the fixed value.
const COINGECKO_IDS: Record<string, string> = {
  POL: "polygon-ecosystem-token",
  MON: "monad",
  ATOM: "cosmos",
  TIA: "celestia",
  OSMO: "osmosis",
  APT: "aptos",
  DOT: "polkadot",
  BNB: "binancecoin",
  SOL: "solana",
  SUI: "sui",
};

export type PriceSource = "coingecko" | "fixed";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { prices: Record<string, number>; source: PriceSource; at: number } | null =
  null;
let inflight: Promise<{ prices: Record<string, number>; source: PriceSource }> | null =
  null;

function lastKnownPrices(): {
  prices: Record<string, number>;
  source: PriceSource;
} {
  return {
    prices: { ...FIXED_USD_PER, ...(cache?.prices ?? {}) },
    source: cache?.source ?? "fixed",
  };
}

async function fetchCoinGecko(): Promise<Record<string, number> | null> {
  const ids = [...new Set(Object.values(COINGECKO_IDS))].join(",");
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, { usd?: number }>;
    const prices: Record<string, number> = {};
    for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
      const usd = body[id]?.usd;
      if (typeof usd === "number" && usd > 0) prices[symbol] = usd;
    }
    return Object.keys(prices).length > 0 ? prices : null;
  } catch {
    return null;
  }
}

/**
 * USD prices for the requested symbols. Testnet always returns the fixed
 * reference table. Mainnet refreshes from CoinGecko at most once per
 * CACHE_TTL_MS and falls back to the last known prices (the fixed table on
 * a cold start) whenever the API errors — a price-provider outage must not
 * take the portfolio endpoints down with it.
 */
export async function getUsdPrices(
  symbols: string[],
): Promise<{ prices: Record<string, number>; source: PriceSource }> {
  if (config.networkMode !== "mainnet") return lastKnownPrices();

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return lastKnownPrices();
  if (!inflight) {
    inflight = fetchCoinGecko()
      .then((fresh) => {
        cache = fresh
          ? { prices: fresh, source: "coingecko", at: Date.now() }
          : { prices: cache?.prices ?? {}, source: "fixed", at: Date.now() };
        return lastKnownPrices();
      })
      .finally(() => {
        inflight = null;
      });
  }
  const { prices, source } = await inflight;
  return { prices, source };
}

/** Sync view for callers without an async context: last known prices. */
export function usdPrice(symbol: string): number {
  return lastKnownPrices().prices[symbol] ?? 0;
}
