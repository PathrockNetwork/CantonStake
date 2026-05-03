"use client";

import type { CSSProperties } from "react";
import { tokens } from "@/lib/tokens";

export type StatusDotKind =
  | "active"
  | "pending"
  | "error"
  | "idle"
  | "bonded"
  | "unbonding"
  | "released";

const COLORS: Record<StatusDotKind, string> = {
  active: tokens.neon,
  pending: tokens.warning,
  error: tokens.danger,
  idle: tokens.ink[500],
  bonded: tokens.neon,
  unbonding: tokens.warning,
  released: tokens.ink[400],
};

export function StatusDot({
  status = "active",
  size = 6,
  className,
  style,
}: {
  status?: StatusDotKind;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const animate = status === "active" || status === "bonded";
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: COLORS[status],
        animation: animate ? "pulse-dot 2s infinite" : "none",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
