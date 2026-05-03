"use client";

import type { CSSProperties, ReactNode } from "react";

export function SectionLabel({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`mono ${className ?? ""}`.trim()}
      style={{
        fontSize: 10.5,
        letterSpacing: ".18em",
        textTransform: "uppercase",
        color: "var(--ink-400)",
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
