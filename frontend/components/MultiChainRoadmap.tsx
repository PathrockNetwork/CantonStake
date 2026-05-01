import { PlannedChainCard } from "@/components/PlannedChainCard";
import { CHAINS } from "@/lib/chains";

type MultiChainRoadmapProps = {
  title?: string;
  compact?: boolean;
};

export function MultiChainRoadmap({
  title = "§ 02 · MULTI-CHAIN ROADMAP",
  compact = false,
}: MultiChainRoadmapProps) {
  return (
    <section>
      <div className="mb-4 font-mono text-xxs uppercase tracking-widest text-ink-400">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CHAINS.filter((chain) => chain.phase !== "live").map((chain) => (
          <PlannedChainCard key={chain.id} chain={chain} compact={compact} />
        ))}
      </div>
    </section>
  );
}
