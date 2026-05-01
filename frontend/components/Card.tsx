import type { ReactNode } from "react";

type CardProps = { children: ReactNode; padding?: number; glow?: boolean; className?: string };

const paddingClasses: Record<number, string> = {
  0: "p-0",
  8: "p-[8px]",
  12: "p-[12px]",
  16: "p-[16px]",
  20: "p-[20px]",
  24: "p-[24px]",
  32: "p-[32px]",
};

export function Card({ children, padding, glow = false, className = "" }: CardProps) {
  const paddingClass = padding === undefined ? "" : paddingClasses[padding] ?? "";
  const glowClass = glow
    ? "ring-1 ring-amber/30 shadow-[0_0_30px_rgba(245,158,11,0.15)]"
    : "";

  return (
    <div
      className={`hairline bg-ink-900/40 ${paddingClass} ${glowClass} ${className}`}
      style={padding !== undefined && !paddingClass ? { padding } : undefined}
    >
      {children}
    </div>
  );
}
