import { Card } from "@/components/Card";
import { PlannedChainCard } from "@/components/PlannedChainCard";
import { SectionLabel } from "@/components/SectionLabel";
import { CHAINS, polygonChain } from "@/lib/chains";

export function RewardsCcRoadmap() {
  const polygon = polygonChain();

  return (
    <section>
      <SectionLabel>§ 04 · CC ROADMAP</SectionLabel>
      <Card padding={24} className="mb-4">
        <p className="text-sm leading-relaxed text-ink-300">
          CC rewards today flow only from {polygon.name} markers. Once
          Moonbeam, Monad, Polkadot, and Cosmos chains move from PHASE 2 to
          live status, their bond/unbond markers will route into the same 75/25
          split. The Daml beneficiary list scales without template changes.
        </p>
      </Card>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CHAINS.filter((chain) => chain.phase !== "live").map((chain) => (
          <PlannedChainCard key={chain.id} chain={chain} compact />
        ))}
      </div>
    </section>
  );
}
