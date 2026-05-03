"use client";

import type { CSSProperties, ReactNode } from "react";
import { tokens } from "@/lib/tokens";

export function Card({
  children,
  padding = 20,
  glow = false,
  className,
  style,
}: {
  children: ReactNode;
  padding?: number;
  glow?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        background: tokens.ink[900],
        border: `1px solid ${tokens.hairline}`,
        padding,
        boxShadow: glow
          ? `0 0 0 1px ${tokens.neonDim}, 0 0 24px ${tokens.neonDim}`
          : "none",
        borderRadius: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
