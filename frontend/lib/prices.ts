"use client";

import { useQuery } from "@tanstack/react-query";

export interface PriceSnapshot {
  polUsd: number;
  polUsd24hChange: number | null;
  ccUsd: number;
  source: { pol: "coingecko" | "fallback"; cc: "env" | "fallback" };
}

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=polygon-ecosystem-token&vs_currencies=usd&include_24hr_change=true";

const POL_FALLBACK = 0.42;

const CC_FROM_ENV = (() => {
  const raw = process.env.NEXT_PUBLIC_CC_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const CC_FALLBACK = 0.16;

async function fetchPrices(): Promise<PriceSnapshot> {
  let polUsd = POL_FALLBACK;
  let polUsd24hChange: number | null = null;
  let polSource: "coingecko" | "fallback" = "fallback";
  try {
    const res = await fetch(COINGECKO_URL, { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as {
        "polygon-ecosystem-token"?: {
          usd?: number;
          usd_24h_change?: number;
        };
      };
      const row = body["polygon-ecosystem-token"];
      const v = row?.usd;
      if (typeof v === "number" && v > 0) {
        polUsd = v;
        polSource = "coingecko";
      }
      if (typeof row?.usd_24h_change === "number") {
        polUsd24hChange = row.usd_24h_change;
      }
    }
  } catch {
    // network failure → fallback
  }

  return {
    polUsd,
    polUsd24hChange,
    ccUsd: CC_FROM_ENV ?? CC_FALLBACK,
    source: { pol: polSource, cc: CC_FROM_ENV !== null ? "env" : "fallback" },
  };
}

export function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    queryFn: fetchPrices,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: {
      polUsd: POL_FALLBACK,
      polUsd24hChange: null,
      ccUsd: CC_FROM_ENV ?? CC_FALLBACK,
      source: {
        pol: "fallback",
        cc: CC_FROM_ENV !== null ? "env" : "fallback",
      },
    },
  });
}
