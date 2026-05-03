"use client";

import { useEffect, useState } from "react";

/**
 * 10-minute round countdown ported from
 * handoff/prototype/redesign/components.jsx (`useRoundCountdown`).
 *
 * API:
 *   - remaining: ms until the next round
 *   - progress: 0..1 fraction through the current round
 *   - mm: zero-padded minutes string
 *   - ss: zero-padded seconds string
 *   - roundId: monotonically increasing integer (Math.floor(now / interval))
 *
 * SSR-safe: returns a fresh "10:00" snapshot during SSR / initial render
 * so first paint matches hydration.
 *
 * NOTE: The earlier `useCcRound` hook in `lib/use-cc-round.ts` has a
 * different API (returns `formatted` string, no roundId). It stays
 * intact for the existing CCRoundTicker on /rewards. This hook is for
 * the redesign chrome components.
 */

const DEFAULT_INTERVAL_MS = 600_000; // 10 minutes

type Snapshot = {
  remaining: number;
  progress: number;
  mm: string;
  ss: string;
  roundId: number;
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
    roundId: Math.floor(now / intervalMs),
  };
}

const SSR_FALLBACK: Snapshot = {
  remaining: DEFAULT_INTERVAL_MS,
  progress: 0,
  mm: "10",
  ss: "00",
  roundId: 0,
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
