"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  AnalyticsAllocationCard,
  AnalyticsProjectionCard,
  formatUsd,
  type AllocationRow,
} from "@/components/AnalyticsCards";
import { AreaSparkline } from "@/components/AreaSparkline";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { fetchPositions, fetchRewards, type PositionRow } from "@/lib/api";
import { chainById, polygonChain, type ChainConfig } from "@/lib/chains";
import { DEMO_AGGREGATES, DEMO_POSITIONS } from "@/lib/demo-positions";
import { makeActivitySeries } from "@/lib/series";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_FAKE_POSITIONS === "true";
const POL_PRICE_USD = 0.42;
const CC_PRICE_USD = 0.16;
const CC_BONUS_APY = 2.4;

function activeRows(positions: PositionRow[]) {
  return positions.filter(
    (position) =>
      position.argument.status !== "Released" &&
      position.argument.status !== "Cancelled"
  );
}

function withPercents(rows: Array<{ chain: ChainConfig; usd: number }>): AllocationRow[] {
  const total = rows.reduce((sum, row) => sum + row.usd, 0) || 1;
  return rows.map((row) => ({
    ...row,
    percent: (row.usd / total) * 100,
  }));
}

function demoAllocation() {
  const byChain = new Map<string, { chain: ChainConfig; usd: number }>();
  for (const position of DEMO_POSITIONS) {
    const chain = chainById(position.chainId);
    if (!chain) continue;
    const current = byChain.get(chain.id) ?? { chain, usd: 0 };
    current.usd += position.amountSymbol * position.symbolPriceUsd;
    byChain.set(chain.id, current);
  }
  return withPercents([...byChain.values()]);
}

function realAllocation(positions: PositionRow[]) {
  const polygon = polygonChain();
  const usd = positions.reduce(
    (sum, position) => sum + Number(position.argument.amountPol) * POL_PRICE_USD,
    0
  );
  return usd > 0 ? withPercents([{ chain: polygon, usd }]) : [];
}

export default function AnalyticsPage() {
  const { address } = useAccount();
  const positionsQuery = useQuery({
    queryKey: ["analytics-positions", address],
    queryFn: () => fetchPositions(address!),
    enabled: !DEMO_MODE && !!address,
    refetchInterval: 10000,
  });
  const rewardsQuery = useQuery({
    queryKey: ["analytics-rewards", address],
    queryFn: () => fetchRewards(address!),
    enabled: !DEMO_MODE && !!address,
    refetchInterval: 10000,
  });

  const realPositions = activeRows(positionsQuery.data ?? []);
  const allocation = DEMO_MODE ? demoAllocation() : realAllocation(realPositions);
  const stakedUsd = DEMO_MODE
    ? DEMO_AGGREGATES.totalStakedUsd
    : allocation.reduce((sum, row) => sum + row.usd, 0);
  const blendedApy = DEMO_MODE
    ? DEMO_AGGREGATES.totalEffectiveApy
    : polygonChain().apy + CC_BONUS_APY;
  const nativeProjection = DEMO_MODE
    ? stakedUsd * (DEMO_AGGREGATES.blendedApy / 100)
    : stakedUsd * (polygonChain().apy / 100);
  const ccProjection = DEMO_MODE
    ? stakedUsd * (DEMO_AGGREGATES.ccBonusApy / 100)
    : stakedUsd * (CC_BONUS_APY / 100);
  const projection = nativeProjection + ccProjection;
  const rewards = rewardsQuery.data;
  const ccPerRound =
    !DEMO_MODE && rewards
      ? (rewards.totalUserShare ?? 0) / Math.max(1, rewards.rewardEventCount ?? 0)
      : 0;
  const earnings30 = DEMO_MODE
    ? DEMO_AGGREGATES.ccEarned24h * CC_PRICE_USD * 30 +
      DEMO_AGGREGATES.nativeRewardsUsd
    : ccPerRound * 144 * 30 * CC_PRICE_USD;
  const earningsSeries = makeActivitySeries(earnings30 / 30, 30);
  const loading =
    !DEMO_MODE &&
    !!address &&
    (positionsQuery.isLoading || rewardsQuery.isLoading);
  const error = positionsQuery.isError || rewardsQuery.isError;
  const empty = !DEMO_MODE && (!address || (!loading && allocation.length === 0));

  return (
    <div className="space-y-8 py-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright">
              PORTFOLIO ANALYTICS
            </p>
            {DEMO_MODE && (
              <span className="rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 font-mono text-xxs uppercase tracking-widest text-amber-bright">
                DEMO MODE
              </span>
            )}
          </div>
          <h1 className="font-display text-5xl">Allocation, yield, projections</h1>
        </div>
      </header>

      {loading && (
        <Card padding={32} className="text-center font-mono text-sm text-ink-400">
          loading analytics...
        </Card>
      )}

      {error && (
        <Card padding={32} className="text-center font-mono text-sm text-danger">
          analytics data unavailable
        </Card>
      )}

      {empty && (
        <EmptyState
          title={address ? "No allocation yet" : "Connect a wallet"}
          body={
            address
              ? "Stake on a live chain to see allocation and yield projections."
              : "Connect an EVM wallet to view real portfolio analytics."
          }
        />
      )}

      {!loading && !error && !empty && (
        <>
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <AnalyticsAllocationCard allocation={allocation} />
            <AnalyticsProjectionCard
              projection={projection}
              blendedApy={blendedApy}
              nativeProjection={nativeProjection}
              ccProjection={ccProjection}
            />
          </section>

          <Card padding={24} className="space-y-6">
            <div>
              <div className="mb-2 font-mono text-xxs uppercase tracking-widest text-ink-400">
                EARNINGS - 30 DAY
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="font-display text-4xl tabular">
                  {formatUsd(earnings30)}
                </div>
                <span className="rounded-full border border-neon/30 bg-neon/10 px-2 py-1 font-mono text-xxs uppercase tracking-widest text-neon">
                  {DEMO_MODE ? "+18.4%" : "live estimate"}
                </span>
              </div>
            </div>
            <AreaSparkline
              data={earningsSeries}
              height={140}
              color="currentColor"
              className="text-neon"
            />
          </Card>
        </>
      )}
    </div>
  );
}
