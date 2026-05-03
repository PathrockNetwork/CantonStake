"use client";

import type { CSSProperties, ReactNode } from "react";
import { tokens } from "@/lib/tokens";

export function Chip({
  children,
  color = tokens.neon,
  dot = false,
  style,
  className,
}: {
  children: ReactNode;
  color?: string;
  dot?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={`mono ${className ?? ""}`.trim()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        fontSize: 10.5,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: ".08em",
        border: `1px solid ${color}`,
        color,
        borderRadius: 0,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            animation: "pulse-dot 2s infinite",
          }}
        />
      )}
      {children}
    </span>
  );
}
