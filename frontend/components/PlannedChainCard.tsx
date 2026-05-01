import { Card } from "@/components/Card";
import { ChainBadge } from "@/components/ChainBadge";
import type { ChainConfig } from "@/lib/chains";

type PlannedChainCardProps = {
  chain: ChainConfig;
  compact?: boolean;
};

export function PlannedChainCard({ chain, compact = false }: PlannedChainCardProps) {
  return (
    <Card padding={compact ? 16 : 20} className="space-y-4 opacity-50">
      <div className="flex items-center justify-between gap-3">
        <ChainBadge chain={chain} />
        <span
          className={`rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
            chain.phase === "planned"
              ? "border border-amber/30 bg-amber/10 text-amber-bright"
              : "bg-ink-700 text-ink-300"
          }`}
        >
          {chain.phase === "planned" ? "PHASE 2" : "COMING SOON"}
        </span>
      </div>
      <div>
        <div className="font-display text-2xl">{chain.name}</div>
        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-xxs text-ink-400">
          <span>{chain.apyRange} APY</span>
          <span>{chain.unbonding}</span>
          <span>{chain.validators} validators</span>
        </div>
      </div>
      <button
        disabled
        className="w-full cursor-not-allowed bg-ink-700 px-4 py-2 font-mono text-xxs uppercase tracking-wider text-ink-300"
      >
        Coming soon
      </button>
      <p className="text-sm text-ink-400">
        Wiring requires {chain.ledgerApp} app integration + Daml template
        extension.
      </p>
    </Card>
  );
}
