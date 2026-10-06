"use client";

import { useQuery } from "@tanstack/react-query";

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
  source: { pol: "coingecko" | "fallback"; cc: "env" | "coingecko" | "fallback" };
}

// Offline fallbacks only. Both deployments value assets at live MainNet
// market prices, so the test deployment shows realistic amounts.
// CoinGecko MainNet prices as of 2026-10-06; shown only before the first
// fetch or when it fails, and labelled "fallback".
const TESTNET_PRICES = {
  pol: 0.107, mon: 0.0288, atom: 1.8, tia: 0.478, osmo: 0.0354,
  sui: 1.18, apt: 0.831, dot: 1.21, bnb: 780, sol: 120,
};

const CC_FROM_ENV = (() => {
  const raw = process.env.NEXT_PUBLIC_CC_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const CC_FALLBACK = 0.1286;

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
  // Live MainNet market prices from CoinGecko's public simple-price API
  // (CORS-enabled, no key) in both modes. Any failure falls back and is labelled.
  try {
    const ids = "polygon-ecosystem-token,cosmos,celestia,osmosis,sui,aptos,polkadot,binancecoin,solana,monad,canton-network";
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const d = (await res.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >;
    const g = (id: string) => {
      const value = d[id]?.usd;
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
    };
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
      ccUsd: CC_FROM_ENV ?? g("canton-network") ?? CC_FALLBACK,
      source: { pol: g("polygon-ecosystem-token") !== undefined ? "coingecko" : "fallback",
        cc: CC_FROM_ENV !== null ? "env" : g("canton-network") !== undefined ? "coingecko" : "fallback" },
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
