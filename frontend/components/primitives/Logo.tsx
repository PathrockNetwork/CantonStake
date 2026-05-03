"use client";

import { tokens } from "@/lib/tokens";

/**
 * CantonStake mark — two flat-top hexagons sharing the same center.
 * Outer is stroked, inner is filled. Both neon. Inner pip pulses
 * (animation: pulse-dot 2.4s ease-in-out infinite) when `animated`.
 *
 * Polygon points are pixel-tuned in TOKENS.md §11. Do NOT substitute
 * or restyle — this is the brand mark.
 */
export function Logo({
  size = 28,
  animated = true,
  className,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  // Outer: width 46 (x: 9 → 55), height ~40 (y: 12 → 52)
  const outer = "9,32 19.5,12 44.5,12 55,32 44.5,52 19.5,52";
  // Inner: width 14 (x: 25 → 39), height ~12 (y: 26 → 38)
  const inner = "25,32 28.2,26 35.8,26 39,32 35.8,38 28.2,38";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={{ flexShrink: 0, display: "block" }}
      aria-label="CantonStake"
    >
      <polygon
        points={outer}
        stroke={tokens.neon}
        strokeWidth="2"
        strokeLinejoin="miter"
        fill="none"
      />
      <polygon
        points={inner}
        fill={tokens.neon}
        style={
          animated
            ? {
                animation: "pulse-dot 2.4s ease-in-out infinite",
                transformOrigin: "32px 32px",
              }
            : undefined
        }
      />
    </svg>
  );
}
