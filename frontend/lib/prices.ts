"use client";

import { useQuery } from "@tanstack/react-query";

export interface PriceSnapshot {
  polUsd: number;
  glmrUsd: number;
  monUsd: number;
  atomUsd: number;
  suiUsd: number;
  polUsd24hChange: number | null;
  ccUsd: number;
  source: { pol: "coingecko" | "fallback"; cc: "env" | "fallback" };
}

// Testnet tokens don't have real market data — use reasonable fixed values
// for USD estimation purposes in the demo.
const TESTNET_PRICES = {
  pol: 0.42,   // Polygon Amoy POL (same as mainnet POL)
  glmr: 0.25,  // Moonbase Alpha DEV (testnet token, not GLMR)
  mon: 0.50,   // Monad Testnet MON (not on CoinGecko)
  atom: 5.00,  // Cosmos theta-testnet THETA (using ATOM proxy)
  sui: 1.50,   // Sui testnet SUI (same as mainnet SUI)
};

const CC_FROM_ENV = (() => {
  const raw = process.env.NEXT_PUBLIC_CC_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const CC_FALLBACK = 0.16;

async function fetchPrices(): Promise<PriceSnapshot> {
  // For testnet demo, return fixed prices — no CoinGecko call needed
  return {
    polUsd: TESTNET_PRICES.pol,
    glmrUsd: TESTNET_PRICES.glmr,
    monUsd: TESTNET_PRICES.mon,
    atomUsd: TESTNET_PRICES.atom,
    suiUsd: TESTNET_PRICES.sui,
    polUsd24hChange: null,
    ccUsd: CC_FROM_ENV ?? CC_FALLBACK,
    source: { pol: "fallback", cc: CC_FROM_ENV !== null ? "env" : "fallback" },
  };
}

export function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    queryFn: fetchPrices,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: {
      polUsd: TESTNET_PRICES.pol,
      glmrUsd: TESTNET_PRICES.glmr,
      monUsd: TESTNET_PRICES.mon,
      atomUsd: TESTNET_PRICES.atom,
      suiUsd: TESTNET_PRICES.sui,
      polUsd24hChange: null,
      ccUsd: CC_FROM_ENV ?? CC_FALLBACK,
      source: {
        pol: "fallback",
        cc: CC_FROM_ENV !== null ? "env" : "fallback",
      },
    },
  });
}
