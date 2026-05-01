"use client";

import { ChainBadge } from "@/components/ChainBadge";
import { CHAINS, type ChainConfig } from "@/lib/chains";

type StakeChainStepProps = {
  onSelect: (chain: ChainConfig) => void;
};

export function StakeChainStep({ onSelect }: StakeChainStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-3xl">Choose staking chain</h2>
        <p className="mt-2 text-sm text-ink-400">
          Live chains can stake now. Phase 2 chains stay visible but disabled.
        </p>
      </div>
      <div className="space-y-2">
        {CHAINS.map((chain) => {
          const live = chain.phase === "live";
          return (
            <button
              key={chain.id}
              type="button"
              disabled={!live}
              title={!live ? `Awaiting ${chain.ledgerApp} integration` : undefined}
              onClick={() => live && onSelect(chain)}
              className={`flex w-full items-center gap-4 border p-4 text-left transition-colors ${
                live
                  ? "border-ink-700 bg-ink-900/40 hover:border-ink-500 hover:bg-ink-800/40"
                  : "cursor-not-allowed border-ink-700 bg-ink-900/30 opacity-50"
              }`}
            >
              <ChainBadge chain={chain} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink-100">
                  {chain.name}
                  <span className="ml-2 font-mono text-xxs text-ink-500">
                    · {chain.symbol}
                  </span>
                </div>
                <div className="mt-1 font-mono text-xxs text-ink-400">
                  {chain.type} · {chain.unbonding} unbonding · Ledger{" "}
                  {chain.ledgerApp} app
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm font-semibold text-neon">
                  {chain.apyRange}
                </div>
                <div className="font-mono text-xxs text-ink-400">+ 2.4% CC</div>
              </div>
              {!live && (
                <span
                  className={`rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
                    chain.phase === "planned"
                      ? "bg-amber/10 text-amber-bright"
                      : "bg-ink-700 text-ink-300"
                  }`}
                >
                  {chain.phase === "planned" ? "PHASE 2" : "COMING SOON"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
