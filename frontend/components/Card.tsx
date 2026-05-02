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
  const roundedClass = className.includes("rounded-") ? "" : "rounded-xl";
  const glowClass = glow
    ? "ring-1 ring-neon/20 shadow-[0_0_42px_rgba(0,255,157,0.10)]"
    : "";

  return (
    <div
      className={`hairline ${roundedClass} bg-ink-900/70 shadow-[0_18px_60px_rgba(0,0,0,0.16)] ${paddingClass} ${glowClass} ${className}`}
      style={padding !== undefined && !paddingClass ? { padding } : undefined}
    >
      {children}
    </div>
  );
}
