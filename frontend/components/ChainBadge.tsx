import type { ChainConfig } from "@/lib/chains";

type ChainBadgeProps = {
  chain?: Pick<ChainConfig, "symbol" | "color">;
  symbol?: string;
  color?: string;
  className?: string;
};

export function ChainBadge({ chain, symbol, color, className = "" }: ChainBadgeProps) {
  const badgeSymbol = symbol ?? chain?.symbol ?? "";
  const badgeColor = color ?? chain?.color ?? "currentColor";

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="grid h-7 w-7 place-items-center text-[10px] font-bold text-white shadow-[0_0_18px_rgba(255,255,255,0.08)]"
        style={{
          backgroundColor: badgeColor,
          clipPath: "polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%)",
        }}
        aria-hidden="true"
      >
        {badgeSymbol.slice(0, 2)}
      </span>
      <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-200">
        {badgeSymbol}
      </span>
    </span>
  );
}
