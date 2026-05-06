"use client";

import { useQuery } from "@tanstack/react-query";
import { IconCoin } from "@/components/icons";
import { fetchRewardHealth } from "@/lib/api";
import { tokens } from "@/lib/tokens";
import { useRoundCountdown } from "@/lib/use-round-countdown";

/**
 * Compact CC round ticker pill — top nav.
 *
 * The countdown is wall-clock based (rounds are fixed 10-minute slots);
 * the round NUMBER is the real one from /api/rewards/health, falling
 * back to the wall-clock derived id when the backend is unreachable.
 */
export function CCRoundTicker({ compact = false }: { compact?: boolean }) {
  const { mm, ss, progress, roundId: fallbackRoundId } = useRoundCountdown();
  const { data: health } = useQuery({
    queryKey: ["round-ticker-health"],
    queryFn: () => fetchRewardHealth(),
    refetchInterval: 30_000,
  });
  const realRoundNumber = health?.lastRound?.roundNumber;
  // The next round is the latest persisted + 1; until the worker has
  // produced any round we fall back to the wall-clock derived id so the
  // pill still animates.
  const roundLabel =
    realRoundNumber !== undefined
      ? (realRoundNumber + 1).toLocaleString()
      : fallbackRoundId.toString().slice(-5);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 12px",
        border: `1px solid ${tokens.hairline}`,
        background: tokens.ink[900],
        height: 36,
        whiteSpace: "nowrap",
      }}
    >
      <IconCoin size={12} />
      <div style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.1 }}>
        <div
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: ".14em",
            color: tokens.ink[400],
            textTransform: "uppercase",
          }}
        >
          CC Round {roundLabel}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: ".14em",
              color: tokens.ink[400],
              textTransform: "uppercase",
            }}
          >
            Next mint
          </span>
          <span
            className="mono tabular"
            style={{ fontSize: 11, color: tokens.cc, fontWeight: 600 }}
          >
            {mm}:{ss}
          </span>
        </div>
      </div>
      <div
        style={{
          width: compact ? 28 : 40,
          height: 3,
          background: tokens.ink[700],
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${progress * 100}%`,
            background: `linear-gradient(90deg,${tokens.cc},${tokens.ccGlow})`,
            transition: "width 1s linear",
          }}
        />
      </div>
    </div>
  );
}
