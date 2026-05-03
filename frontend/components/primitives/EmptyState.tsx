"use client";

import type { ReactNode } from "react";
import { tokens } from "@/lib/tokens";

export type EmptyStateTone = "neutral" | "warn" | "error" | "cc";

const TONE_ACCENT: Record<EmptyStateTone, string> = {
  neutral: tokens.neon,
  warn: tokens.warning,
  error: tokens.danger,
  cc: tokens.cc,
};

export function EmptyState({
  title,
  subtitle,
  icon,
  action,
  tone = "neutral",
}: {
  title: ReactNode;
  subtitle: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: EmptyStateTone;
}) {
  const accent = TONE_ACCENT[tone];
  return (
    <div
      style={{
        padding: "48px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        border: `1px dashed ${tokens.hairline}`,
        background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.02))",
        borderRadius: 0,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          display: "grid",
          placeItems: "center",
          border: `1px solid ${accent}`,
          color: accent,
        }}
      >
        {icon ?? (
          <span
            className="display"
            style={{ fontSize: 30, fontStyle: "italic" }}
          >
            ∅
          </span>
        )}
      </div>
      <div className="display" style={{ fontSize: 24, color: tokens.ink[100], marginTop: 4 }}>
        {title}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: tokens.ink[400],
          maxWidth: 420,
          textAlign: "center",
          lineHeight: 1.6,
          letterSpacing: ".02em",
        }}
      >
        {subtitle}
      </div>
      {action}
    </div>
  );
}
