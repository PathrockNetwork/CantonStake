"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { BeneficiarySplit } from "@/components/BeneficiarySplit";
import { Card } from "@/components/Card";
import { CCRoundTicker } from "@/components/CCRoundTicker";
import { MetricBlock } from "@/components/MetricBlock";
import { RewardsCcRoadmap } from "@/components/RewardsCcRoadmap";
import { RewardsMarkerRow } from "@/components/RewardsMarkerRow";
import { RewardsPoolEconomics } from "@/components/RewardsPoolEconomics";
import { RewardsStatsSpine } from "@/components/RewardsStatsSpine";
import { RoundsTimeline } from "@/components/RoundsTimeline";
import { SectionLabel } from "@/components/SectionLabel";
import { fetchPositions, fetchRewards } from "@/lib/api";
import type { RewardEventRow } from "@/lib/api/contracts";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_FAKE_POSITIONS === "true";

export default function RewardsPage() {
  const { address, isConnected } = useAccount();

  const { data: rewards } = useQuery({
    queryKey: ["rewards", address],
    queryFn: () => (address ? fetchRewards(address) : null),
    enabled: !!address,
    refetchInterval: 10000,
  });

  const { data: positions } = useQuery({
    queryKey: ["positions-for-rewards", address],
    queryFn: () => (address ? fetchPositions(address) : []),
    enabled: !!address,
    refetchInterval: 10000,
  });

  const bondMarkers =
    positions?.filter((p) => p.argument.markersEmitted >= 1).length ?? 0;
  const unbondMarkers =
    positions?.filter((p) => p.argument.markersEmitted >= 2).length ?? 0;
  const rewardEventCount = rewards?.rewardEventCount ?? 0;
  const userCcEta =
    (rewards?.totalUserShare ?? 0) / Math.max(1, rewards?.rewardEventCount ?? 1);
  const timelineEvents: RewardEventRow[] =
    rewards && rewardEventCount > 0
      ? [
          {
            round: rewardEventCount,
            ts: new Date().toISOString(),
            ccUser: (rewards.totalUserShare ?? 0) / rewardEventCount,
            ccTreasury: (rewards.totalTreasuryShare ?? 0) / rewardEventCount,
            txns: Math.max(1, rewards.totalMarkersEmitted),
          },
        ]
      : [];

  return (
    <div className="space-y-12 py-8">
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright mb-4">
            § 03 · rewards
          </p>
          {DEMO_MODE && (
            <span className="mb-4 inline-flex rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 font-mono text-xxs uppercase tracking-widest text-amber-bright">
              DEMO MODE
            </span>
          )}
          <h1 className="font-display text-5xl mb-3">Activity attribution</h1>
          <p className="text-ink-300 max-w-2xl">
            Every FeaturedAppActivityMarker your positions emit is converted
            into an AppRewardCoupon in the next 10-minute round. Your share of
            the featured pool is proportional to the network-wide marker count.
          </p>
        </div>
        <CCRoundTicker />
      </header>

      {!isConnected && (
        <Card padding={32} className="text-center text-ink-300 font-mono text-sm">
          connect your wallet to view rewards
        </Card>
      )}

      {isConnected && rewards && (
        <>
          <RewardsPoolEconomics markersEmitted={rewards.totalMarkersEmitted} />

          {/* slot: A1 Narrator */}

          <RewardsStatsSpine
            markersEmitted={rewards.totalMarkersEmitted}
            bondedPol={rewards.totalBondedPol}
            ccEarned={rewards.totalCcEarned ?? rewards.estimatedCcEarned}
            rewardEventCount={rewards.rewardEventCount ?? 0}
            protocolFeesPol={rewards.totalProtocolFeePol ?? 0}
            rewardSweepCount={rewards.rewardSweepCount ?? 0}
          />

          <section>
            <SectionLabel>§ 01 · beneficiary split</SectionLabel>
            <Card padding={32}>
              <div className="flex items-end gap-4 mb-6">
                <div className="font-display text-6xl">
                  {(rewards.userShare * 100).toFixed(0)}
                  <span className="text-ink-400">/</span>
                  {(rewards.appShare * 100).toFixed(0)}
                </div>
                <div className="font-mono text-xs text-ink-400 pb-4">
                  delegator / app treasury
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <MetricBlock
                  label="your share (cc)"
                  value={(rewards.totalUserShare ?? 0).toFixed(4)}
                  accent
                />
                <MetricBlock
                  label="treasury share (cc)"
                  value={(rewards.totalTreasuryShare ?? 0).toFixed(4)}
                />
              </div>

              <BeneficiarySplit
                userPct={rewards.userShare}
                treasuryPct={rewards.appShare}
                showCopy={false}
              />
              <p className="text-ink-300 text-sm mt-6 max-w-2xl leading-relaxed">
                The split is defined in the Daml contract itself — not by a
                backend process. Each FeaturedAppActivityMarker carries two
                AppRewardBeneficiary entries whose weights sum to 1.0. Super
                Validator automation handles the coupon conversion trustlessly.
              </p>
            </Card>
          </section>

          <section>
            <SectionLabel>§ 02 · native reward sweep</SectionLabel>
            <Card padding={32}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <MetricBlock
                  label="rewards swept (pol)"
                  value={(rewards.totalNativeRewardsSweptPol ?? 0).toFixed(6)}
                />
                <MetricBlock
                  label="user payout (pol)"
                  value={(rewards.totalUserPayoutPol ?? 0).toFixed(6)}
                  accent
                />
                <MetricBlock
                  label="protocol fee (pol)"
                  value={(rewards.totalProtocolFeePol ?? 0).toFixed(6)}
                />
              </div>
              <p className="text-ink-300 text-sm mt-6 max-w-2xl leading-relaxed">
                Native staking rewards use a 5% protocol-fee model. In this
                demo the sweep is recorded after reading pendingRewards() from
                the Amoy mock; production would execute withdrawRewards() and
                split the payout on-chain.
              </p>
            </Card>
          </section>

          <section>
            <SectionLabel>§ 02 · marker breakdown</SectionLabel>
            <Card padding={0} className="divide-y divide-ink-700">
              <RewardsMarkerRow
                event="Bond"
                description="StakingRequest_Accept"
                count={bondMarkers}
                cipRef="CIP-47 · lock/unlock"
                triggered
              />
              <RewardsMarkerRow
                event="Unbond"
                description="StakingPosition_ConfirmUnbond"
                count={unbondMarkers}
                cipRef="CIP-47 · transfer"
                triggered={unbondMarkers > 0}
              />
              <RewardsMarkerRow
                event="Request"
                description="StakingRequest created"
                count={0}
                cipRef="intermediate · no marker"
                triggered={false}
                excluded
              />
              <RewardsMarkerRow
                event="Release"
                description="StakingPosition_Release"
                count={0}
                cipRef="unlock completion · no marker"
                triggered={false}
                excluded
              />
            </Card>
          </section>

          <section>
            <SectionLabel>§ 03 · 10-minute round timeline</SectionLabel>
            <Card padding={0}>
              <RoundsTimeline events={timelineEvents} userCcEta={userCcEta} />
            </Card>
          </section>

          <Card padding={32}>
            <div className="font-mono text-xxs uppercase tracking-widest text-amber-bright mb-3">
              cip-47 compliance note
            </div>
            <p className="text-ink-300 text-sm leading-relaxed max-w-3xl">
              Per the Featured Application Activity Markers specification,
              markers are created only for economically meaningful events —
              lock, unlock, transfer, mint, burn. CantonStake follows this
              strictly: bond and unbond emit markers; propose steps and the
              final release do not. This avoids fair-usage violations while
              still capturing the full value of real staking activity.
            </p>
          </Card>

          <RewardsCcRoadmap />
        </>
      )}
    </div>
  );
}
