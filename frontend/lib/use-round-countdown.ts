"use client";

import { useEffect, useState } from "react";

/**
 * Estimated 10-minute cadence countdown, not a ledger round identifier.
 *
 * API:
 *   - remaining: ms until the next round
 *   - progress: 0..1 fraction through the current round
 *   - mm: zero-padded minutes string
 *   - ss: zero-padded seconds string
 *
 * SSR-safe: returns a fresh "10:00" snapshot during SSR / initial render
 * so first paint matches hydration.
 *
 * This is the shared countdown for the active chrome components.
 */

const DEFAULT_INTERVAL_MS = 600_000; // 10 minutes

type Snapshot = {
  remaining: number;
  progress: number;
  mm: string;
  ss: string;
};

function snapshot(now: number, intervalMs: number): Snapshot {
  const cycleStart = Math.floor(now / intervalMs) * intervalMs;
  const elapsed = now - cycleStart;
  const remaining = intervalMs - elapsed;
  return {
    remaining,
    progress: Math.min(1, Math.max(0, elapsed / intervalMs)),
    mm: String(Math.floor(remaining / 60_000)).padStart(2, "0"),
    ss: String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, "0"),
  };
}

const SSR_FALLBACK: Snapshot = {
  remaining: DEFAULT_INTERVAL_MS,
  progress: 0,
  mm: "10",
  ss: "00",
};

export function useRoundCountdown(intervalMs: number = DEFAULT_INTERVAL_MS): Snapshot {
  const [s, setS] = useState<Snapshot>(SSR_FALLBACK);

  useEffect(() => {
    setS(snapshot(Date.now(), intervalMs));
    const id = window.setInterval(
      () => setS(snapshot(Date.now(), intervalMs)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return typeof window === "undefined" ? SSR_FALLBACK : s;
}
