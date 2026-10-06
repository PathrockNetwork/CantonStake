// USD prices for portfolio valuation and CC reward sizing. Both network modes
// use live MainNet market prices from CoinGecko (CC = "canton-network"),
// refreshed at most once per CACHE_TTL_MS, so the test deployment shows what
// the same amounts would be worth on MainNet. The fixed table is only the
// offline/cold fallback, and the response says which source served it.
const FIXED_USD_PER: Record<string, number> = {
  POL: 0.45,
  MON: 0.55,
  ATOM: 4.5,
  SUI: 1.2,
  CC: 0.147,
};

// CoinGecko coin ids (MON is "monad", not "mon"; CC is "canton-network").
const COINGECKO_IDS: Record<string, string> = {
  CC: "canton-network",
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
 * Live USD prices, refreshed at most once per CACHE_TTL_MS. Falls back to the
 * last known prices (the fixed table on a cold start) whenever the API
 * errors — a price-provider outage must not take dependent endpoints down.
 */
export async function getUsdPrices(): Promise<{ prices: Record<string, number>; source: PriceSource }> {
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

