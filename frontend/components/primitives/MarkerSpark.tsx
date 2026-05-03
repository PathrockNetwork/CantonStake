"use client";

import { tokens } from "@/lib/tokens";

/**
 * One-shot neon spark overlay. Mounted absolutely inside a relatively
 * positioned parent. Used to flash on marker emission events.
 */
export function MarkerSpark({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        pointerEvents: "none",
        inset: 0,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: tokens.neon,
          animation: "spark 800ms ease-out",
        }}
      />
    </div>
  );
}
