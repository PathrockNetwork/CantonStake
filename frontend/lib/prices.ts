"use client";

import { useQuery } from "@tanstack/react-query";
import { isMainnet } from "@/lib/network";

// CoinGecko asset id for Monad is not guaranteed to exist; the fetch
// handles its absence gracefully either way.
const MAINNET_MONAD_ID = true;

export interface PriceSnapshot {
  polUsd: number;
  monUsd: number;
  atomUsd: number;
  tiaUsd: number;
  osmoUsd: number;
  suiUsd: number;
  aptUsd: number;
  dotUsd: number;
  bnbUsd: number;
  solUsd: number;
  polUsd24hChange: number | null;
  ccUsd: number;
  source: { pol: "coingecko" | "fallback"; cc: "env" | "fallback" };
}

// Testnet tokens don't have real market data — use reasonable fixed values
// for USD estimation purposes in the demo.
const TESTNET_PRICES = {
  pol: 0.42,   // Polygon Amoy POL (same as mainnet POL)
  mon: 0.50,   // Monad Testnet MON (not on CoinGecko)
  atom: 5.00,  // Cosmos theta-testnet THETA (using ATOM proxy)
  tia: 2.20,   // Celestia testnet TIA (mainnet proxy)
  osmo: 0.20,  // Osmosis testnet OSMO (mainnet proxy)
  sui: 1.50,   // Sui testnet SUI (same as mainnet SUI)
  apt: 4.00,   // Aptos testnet APT (mainnet proxy)
  dot: 3.50,   // Westend WND (using DOT proxy)
  bnb: 550.0,  // Chapel tBNB (using BNB proxy)
  sol: 140.0,  // Solana testnet SOL (mainnet proxy)
};

const CC_FROM_ENV = (() => {
  const raw = process.env.NEXT_PUBLIC_CC_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const CC_FALLBACK = 0.16;

function fallbackSnapshot(): PriceSnapshot {
  return {
    polUsd: TESTNET_PRICES.pol,
    monUsd: TESTNET_PRICES.mon,
    atomUsd: TESTNET_PRICES.atom,
    tiaUsd: TESTNET_PRICES.tia,
    osmoUsd: TESTNET_PRICES.osmo,
    suiUsd: TESTNET_PRICES.sui,
    aptUsd: TESTNET_PRICES.apt,
    dotUsd: TESTNET_PRICES.dot,
    bnbUsd: TESTNET_PRICES.bnb,
    solUsd: TESTNET_PRICES.sol,
    polUsd24hChange: null,
    ccUsd: CC_FROM_ENV ?? CC_FALLBACK,
    source: { pol: "fallback", cc: CC_FROM_ENV !== null ? "env" : "fallback" },
  };
}

async function fetchPrices(): Promise<PriceSnapshot> {
  // Testnet mode: fixed reference prices — no market call needed.
  if (!isMainnet) return fallbackSnapshot();

  // Mainnet mode: real market prices from CoinGecko's public simple-price
  // API (CORS-enabled, no key). Monad keeps its reference price if
  // CoinGecko doesn't list it. Any failure falls back and is labelled.
  try {
    const ids =
      "polygon-ecosystem-token,cosmos,celestia,osmosis,sui,aptos,polkadot,binancecoin,solana"
      + (MAINNET_MONAD_ID ? ",monad" : "");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    );
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const d = (await res.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >;
    const g = (id: string) => d[id]?.usd;
    return {
      polUsd: g("polygon-ecosystem-token") ?? TESTNET_PRICES.pol,
      monUsd: g("monad") ?? TESTNET_PRICES.mon,
      atomUsd: g("cosmos") ?? TESTNET_PRICES.atom,
      tiaUsd: g("celestia") ?? TESTNET_PRICES.tia,
      osmoUsd: g("osmosis") ?? TESTNET_PRICES.osmo,
      suiUsd: g("sui") ?? TESTNET_PRICES.sui,
      aptUsd: g("aptos") ?? TESTNET_PRICES.apt,
      dotUsd: g("polkadot") ?? TESTNET_PRICES.dot,
      bnbUsd: g("binancecoin") ?? TESTNET_PRICES.bnb,
      solUsd: g("solana") ?? TESTNET_PRICES.sol,
      polUsd24hChange:
        d["polygon-ecosystem-token"]?.usd_24h_change ?? null,
      ccUsd: CC_FROM_ENV ?? CC_FALLBACK,
      source: { pol: "coingecko", cc: CC_FROM_ENV !== null ? "env" : "fallback" },
    };
  } catch {
    return fallbackSnapshot();
  }
}

export function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    queryFn: fetchPrices,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: {
      polUsd: TESTNET_PRICES.pol,
      monUsd: TESTNET_PRICES.mon,
      atomUsd: TESTNET_PRICES.atom,
      tiaUsd: TESTNET_PRICES.tia,
      osmoUsd: TESTNET_PRICES.osmo,
      suiUsd: TESTNET_PRICES.sui,
      aptUsd: TESTNET_PRICES.apt,
      dotUsd: TESTNET_PRICES.dot,
      bnbUsd: TESTNET_PRICES.bnb,
      solUsd: TESTNET_PRICES.sol,
      polUsd24hChange: null,
      ccUsd: CC_FROM_ENV ?? CC_FALLBACK,
      source: {
        pol: "fallback",
        cc: CC_FROM_ENV !== null ? "env" : "fallback",
      },
    },
  });
}
