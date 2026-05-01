"use client";

import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { fetchRewards, fetchPositions } from "@/lib/api";
import { CCRoundTicker } from "@/components/CCRoundTicker";
import { Card } from "@/components/Card";
import { RoundsTimeline } from "@/components/RoundsTimeline";
import type { RewardEventRow } from "@/lib/api/contracts";

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
        <div className="hairline p-12 text-center text-ink-300 font-mono text-sm">
          connect your wallet to view rewards
        </div>
      )}

      {isConnected && rewards && (
        <>
          {/* slot: A1 Narrator */}

          {/* Headline numbers */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-px bg-ink-700">
            <StatCell
              caption="markers emitted"
              value={rewards.totalMarkersEmitted.toString()}
              subtitle="on-ledger attestations"
            />
            <StatCell
              caption="bonded pol"
              value={rewards.totalBondedPol.toFixed(2)}
              subtitle="generating yield + markers"
              accent
            />
            <StatCell
              caption="cc earned"
              value={(rewards.totalCcEarned ?? rewards.estimatedCcEarned).toFixed(4)}
              subtitle={`${rewards.rewardEventCount ?? 0} reward rounds`}
              accent
            />
            <StatCell
              caption="protocol fees"
              value={(rewards.totalProtocolFeePol ?? 0).toFixed(6)}
              subtitle={`${rewards.rewardSweepCount ?? 0} native sweeps`}
            />
          </section>

          {/* Beneficiary split */}
          <section>
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-6">
              § 01 · beneficiary split
            </div>
            <div className="hairline bg-ink-900/40 p-8">
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

              {/* Actual CC totals */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
                    your share (cc)
                  </div>
                  <div className="font-display text-2xl text-amber-bright">
                    {(rewards.totalUserShare ?? 0).toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
                    treasury share (cc)
                  </div>
                  <div className="font-display text-2xl text-ink-300">
                    {(rewards.totalTreasuryShare ?? 0).toFixed(4)}
                  </div>
                </div>
              </div>

              {/* Visual split bar */}
              <div className="h-8 flex hairline">
                <div
                  className="bg-amber transition-all"
                  style={{ width: `${rewards.userShare * 100}%` }}
                />
                <div
                  className="bg-ink-500 transition-all"
                  style={{ width: `${rewards.appShare * 100}%` }}
                />
              </div>
              <div className="flex justify-between mt-3 font-mono text-xxs uppercase tracking-wider text-ink-400">
                <span>you</span>
                <span>treasury</span>
              </div>
              <p className="text-ink-300 text-sm mt-6 max-w-2xl leading-relaxed">
                The split is defined in the Daml contract itself — not by a
                backend process. Each FeaturedAppActivityMarker carries two
                AppRewardBeneficiary entries whose weights sum to 1.0. Super
                Validator automation handles the coupon conversion trustlessly.
              </p>
            </div>
          </section>

          {/* Native reward fee model */}
          <section>
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-6">
              § 02 · native reward sweep
            </div>
            <div className="hairline bg-ink-900/40 p-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
                    rewards swept (pol)
                  </div>
                  <div className="font-display text-3xl tabular">
                    {(rewards.totalNativeRewardsSweptPol ?? 0).toFixed(6)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
                    user payout (pol)
                  </div>
                  <div className="font-display text-3xl tabular text-amber-bright">
                    {(rewards.totalUserPayoutPol ?? 0).toFixed(6)}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
                    protocol fee (pol)
                  </div>
                  <div className="font-display text-3xl tabular text-ink-300">
                    {(rewards.totalProtocolFeePol ?? 0).toFixed(6)}
                  </div>
                </div>
              </div>
              <p className="text-ink-300 text-sm mt-6 max-w-2xl leading-relaxed">
                Native staking rewards use a 5% protocol-fee model. In this
                demo the sweep is recorded after reading pendingRewards() from
                the Amoy mock; production would execute withdrawRewards() and
                split the payout on-chain.
              </p>
            </div>
          </section>

          {/* Marker breakdown */}
          <section>
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-6">
              § 02 · marker breakdown
            </div>
            <div className="hairline divide-y divide-ink-700">
              <MarkerRow
                event="Bond"
                description="StakingRequest_Accept"
                count={bondMarkers}
                cipRef="CIP-47 · lock/unlock"
                triggered
              />
              <MarkerRow
                event="Unbond"
                description="StakingPosition_ConfirmUnbond"
                count={unbondMarkers}
                cipRef="CIP-47 · transfer"
                triggered={unbondMarkers > 0}
              />
              <MarkerRow
                event="Request"
                description="StakingRequest created"
                count={0}
                cipRef="intermediate · no marker"
                triggered={false}
                excluded
              />
              <MarkerRow
                event="Release"
                description="StakingPosition_Release"
                count={0}
                cipRef="unlock completion · no marker"
                triggered={false}
                excluded
              />
            </div>
          </section>

          <section>
            <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-6">
              § 03 · 10-minute round timeline
            </div>
            <Card padding={0}>
              <RoundsTimeline events={timelineEvents} userCcEta={userCcEta} />
            </Card>
          </section>

          {/* CIP context */}
          <section className="hairline bg-ink-900/40 p-8">
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
          </section>
        </>
      )}
    </div>
  );
}

function StatCell({
  caption,
  value,
  subtitle,
  accent = false,
}: {
  caption: string;
  value: string;
  subtitle: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-ink-950 p-8">
      <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-4">
        {caption}
      </div>
      <div
        className={`font-display text-5xl tabular ${
          accent ? "text-amber-bright" : "text-ink-100"
        }`}
      >
        {value}
      </div>
      <div className="font-mono text-xs text-ink-400 mt-3">{subtitle}</div>
    </div>
  );
}

function MarkerRow({
  event,
  description,
  count,
  cipRef,
  triggered,
  excluded = false,
}: {
  event: string;
  description: string;
  count: number;
  cipRef: string;
  triggered: boolean;
  excluded?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-12 gap-4 items-center px-6 py-5 ${
        excluded ? "opacity-40" : ""
      }`}
    >
      <div className="col-span-3">
        <div className="font-display text-2xl">{event}</div>
        <div className="font-mono text-xxs text-ink-400 mt-1">{description}</div>
      </div>
      <div className="col-span-4 font-mono text-xxs uppercase tracking-wider text-ink-300">
        {cipRef}
      </div>
      <div className="col-span-3">
        {excluded ? (
          <span className="chip chip-dot text-ink-500 border-transparent">
            excluded
          </span>
        ) : triggered ? (
          <span className="chip chip-dot text-amber-bright border-transparent">
            emitted
          </span>
        ) : (
          <span className="chip chip-dot text-ink-400 border-transparent">
            pending
          </span>
        )}
      </div>
      <div className="col-span-2 text-right font-mono tabular text-2xl">
        {excluded ? "—" : count}
      </div>
    </div>
  );
}
