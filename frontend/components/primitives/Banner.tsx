"use client";

import type { ReactNode } from "react";
import { tokens } from "@/lib/tokens";

export type BannerTone = "warn" | "error" | "success";

const TONE_COLOR: Record<BannerTone, string> = {
  warn: tokens.warning,
  error: tokens.danger,
  success: tokens.neon,
};

const TONE_BG: Record<BannerTone, string> = {
  warn: "rgba(245,158,11,0.04)",
  error: "rgba(239,68,68,0.04)",
  success: "rgba(0,255,157,0.04)",
};

export function Banner({
  tone = "warn",
  kind,
  message,
  action,
}: {
  tone?: BannerTone;
  kind: ReactNode;
  message: ReactNode;
  action?: ReactNode;
}) {
  const c = TONE_COLOR[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 16px",
        border: `1px solid ${c}`,
        borderLeft: `3px solid ${c}`,
        background: TONE_BG[tone],
        marginBottom: 18,
        borderRadius: 0,
      }}
      role="alert"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            color: c,
            letterSpacing: ".14em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ● {kind}
        </span>
        <span style={{ fontSize: 12.5, color: tokens.ink[200], lineHeight: 1.5 }}>
          {message}
        </span>
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}
