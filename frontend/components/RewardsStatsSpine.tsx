import { StatCell } from "@/components/StatCell";

type RewardsStatsSpineProps = {
  markersEmitted: number;
  bondedPol: number;
  ccEarned: number;
  rewardEventCount: number;
  protocolFeesPol: number;
  rewardSweepCount: number;
};

export function RewardsStatsSpine({
  markersEmitted,
  bondedPol,
  ccEarned,
  rewardEventCount,
  protocolFeesPol,
  rewardSweepCount,
}: RewardsStatsSpineProps) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCell
        caption="markers emitted"
        value={markersEmitted.toString()}
        subtitle="on-ledger attestations"
      />
      <StatCell
        caption="bonded pol"
        value={bondedPol.toFixed(2)}
        subtitle="generating yield + markers"
        accent="neon"
      />
      <StatCell
        caption="cc earned"
        value={ccEarned.toFixed(4)}
        subtitle={`${rewardEventCount} reward rounds`}
        accent="cc"
      />
      <StatCell
        caption="protocol fees"
        value={protocolFeesPol.toFixed(6)}
        subtitle={`${rewardSweepCount} native sweeps`}
      />
    </section>
  );
}
