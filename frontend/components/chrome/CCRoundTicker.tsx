"use client";

import { IconCoin } from "@/components/icons";
import { tokens } from "@/lib/tokens";
import { useRoundCountdown } from "@/lib/use-round-countdown";

/**
 * Compact 10-minute CC round ticker pill — for the top nav.
 * Ported from handoff/prototype/redesign/components.jsx (`CCRoundTicker`).
 *
 * Distinct from the older /rewards page ticker (frontend/components/CCRoundTicker.tsx
 * with the SVG ring) — this is the smaller horizontal bar variant designed
 * to live inside the nav bar.
 */
export function CCRoundTicker({ compact = false }: { compact?: boolean }) {
  const { mm, ss, progress, roundId } = useRoundCountdown();

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
          CC Round {roundId.toString().slice(-5)}
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
