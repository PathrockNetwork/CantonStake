import { StatCell } from "@/components/StatCell";

type RewardsPoolEconomicsProps = {
  markersEmitted: number;
};

export function RewardsPoolEconomics({ markersEmitted }: RewardsPoolEconomicsProps) {
  return (
    <section>
      <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-4">
        § 02 · POOL ECONOMICS
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCell
          caption="Pool share"
          value="28%"
          subtitle="of 516M CC mint pool · demo estimate"
        />
        <StatCell
          caption="Mint multiplier"
          value="100×"
          subtitle="vs unfeatured apps"
          accent="amber"
        />
        <StatCell
          caption="Markers emitted"
          value={markersEmitted.toString()}
          subtitle="on-ledger attestations"
        />
        <StatCell caption="CC / USD" value="$0.16" subtitle="demo price · 4 mkts" />
      </div>
    </section>
  );
}
