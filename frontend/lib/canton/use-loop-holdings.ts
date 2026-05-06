"use client";

import { useEffect, useState } from "react";
import { useCantonWallet } from "./use-canton-wallet";

/**
 * Hook reading the connected Loop wallet's holdings via @fivenorth/loop-sdk.
 * Returns the user's CC balance (when available) and the raw holdings list.
 *
 * The SDK exposes `provider.getHolding()` only after a connect handshake.
 * This hook polls every 30s while connected, and silently no-ops when the
 * mock provider is the active one (no SDK to call).
 */

export interface LoopHolding {
  instrumentAdmin: string;
  instrumentId: string;
  symbol: string;
  decimals: number;
  unlocked: number;
  locked: number;
}

export interface UseLoopHoldingsResult {
  holdings: LoopHolding[];
  ccBalance: number | null;
  source: "loop-sdk" | "unavailable";
  refetch: () => void;
}

interface RawHolding {
  instrument_id?: { admin?: string; id?: string };
  symbol?: string;
  decimals?: number;
  total_unlocked_coin?: string;
  total_locked_coin?: string;
}

interface LoopProviderApi {
  getHolding?: () => Promise<RawHolding[]>;
}

interface LoopSdkRuntime {
  // The SDK keeps the provider on the singleton after connect; type it loosely
  // so the runtime check survives any non-breaking SDK shape changes.
  provider?: LoopProviderApi | null;
}

function parseAmount(raw: string | undefined, decimals: number): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n / Math.pow(10, decimals);
}

export function useLoopHoldings(): UseLoopHoldingsResult {
  const { isConnected } = useCantonWallet();
  const [holdings, setHoldings] = useState<LoopHolding[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isConnected) {
      setHoldings([]);
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    const run = async () => {
      try {
        const mod = (await import("@fivenorth/loop-sdk")) as unknown as {
          loop: LoopSdkRuntime;
        };
        const api = mod.loop.provider;
        if (!api?.getHolding) return;
        const raw = await api.getHolding();
        if (cancelled) return;
        const mapped: LoopHolding[] = (raw ?? []).map((h) => {
          const decimals = h.decimals ?? 6;
          return {
            instrumentAdmin: h.instrument_id?.admin ?? "",
            instrumentId: h.instrument_id?.id ?? "",
            symbol: h.symbol ?? "?",
            decimals,
            unlocked: parseAmount(h.total_unlocked_coin, decimals),
            locked: parseAmount(h.total_locked_coin, decimals),
          };
        });
        setHoldings(mapped);
      } catch {
        // SDK not ready / provider not connected — silent
      }
    };

    void run();
    intervalId = window.setInterval(() => void run(), 30_000);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [isConnected, tick]);

  // Common matchers for "Canton Coin": Amulet from Splice, or anything whose
  // instrument id ends with "CC" / "Amulet".
  const ccHolding = holdings.find((h) => {
    const id = h.instrumentId.toLowerCase();
    const sym = h.symbol.toUpperCase();
    return sym === "CC" || sym === "AMULET" || id === "amulet" || id === "cc";
  });
  const ccBalance = ccHolding ? ccHolding.unlocked + ccHolding.locked : null;

  return {
    holdings,
    ccBalance,
    source: holdings.length > 0 ? "loop-sdk" : "unavailable",
    refetch: () => setTick((t) => t + 1),
  };
}
