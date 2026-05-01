import { Card } from "@/components/Card";
import { ChainBadge } from "@/components/ChainBadge";
import { CHAINS } from "@/lib/chains";

export function MultiChainRoadmap() {
  return (
    <section>
      <div className="mb-4 font-mono text-xxs uppercase tracking-widest text-ink-400">
        § 02 · MULTI-CHAIN ROADMAP
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CHAINS.filter((chain) => chain.phase !== "live").map((chain) => (
          <Card key={chain.id} padding={20} className="space-y-4 opacity-50">
            <div className="flex items-center justify-between gap-3">
              <ChainBadge chain={chain} />
              <span
                className={`rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
                  chain.phase === "planned"
                    ? "bg-amber/10 text-amber-bright"
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
        ))}
      </div>
    </section>
  );
}
