"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Card } from "@/components/Card";
import { CCRoundTicker } from "@/components/CCRoundTicker";
import { DashboardPositionRow } from "@/components/DashboardPositionRow";
import { MultiChainRoadmap } from "@/components/MultiChainRoadmap";
import { Sparkline } from "@/components/Sparkline";
import { StatCell } from "@/components/StatCell";
import { StatusDot } from "@/components/StatusDot";
import { fetchPositions, fetchRewards, type PositionRow } from "@/lib/api";
import { polygonChain } from "@/lib/chains";
import {
  DEMO_AGGREGATES,
  DEMO_POSITIONS,
  type DemoPositionRow,
} from "@/lib/demo-positions";
import { useLoopWallet } from "@/lib/loop-wallet";
import { makeActivitySeries } from "@/lib/series";

const POL_PRICE_USD = 0.42;
const CC_PRICE_USD = 0.16;
const CC_BONUS_APY = 2.4;
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_FAKE_POSITIONS === "true";

function short(value: string, head = 6, tail = 4) {
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function activeRows(positions: PositionRow[]) {
  return positions.filter(
    (position) =>
      position.argument.status !== "Released" &&
      position.argument.status !== "Cancelled"
  );
}

export function Dashboard() {
  const { address } = useAccount();
  const { partyId, ccBalance } = useLoopWallet();
  const polygon = polygonChain();

  const positionsQuery = useQuery({
    queryKey: ["dashboard-positions", address],
    queryFn: () => fetchPositions(address!),
    enabled: !DEMO_MODE && !!address,
    refetchInterval: 10000,
  });
  const rewardsQuery = useQuery({
    queryKey: ["dashboard-rewards", address],
    queryFn: () => fetchRewards(address!),
    enabled: !DEMO_MODE && !!address,
    refetchInterval: 10000,
  });

  if (!DEMO_MODE && !address) return null;
  if (!DEMO_MODE && (positionsQuery.isError || rewardsQuery.isError)) {
    return (
      <div className="hairline p-8 font-mono text-sm text-danger">
        dashboard data unavailable
      </div>
    );
  }
  if (!DEMO_MODE && (!positionsQuery.data || !rewardsQuery.data)) {
    return (
      <div className="hairline p-8 font-mono text-sm text-ink-400">
        loading dashboard...
      </div>
    );
  }

  const realPositions = activeRows(positionsQuery.data ?? []);
  const positions: Array<PositionRow | DemoPositionRow> = DEMO_MODE
    ? DEMO_POSITIONS
    : realPositions;
  const rewards = rewardsQuery.data;
  const cc = DEMO_MODE
    ? DEMO_AGGREGATES.ccBalance
    : ccBalance ?? rewards?.totalUserShare ?? 0;
  const rewardEvents = Math.max(1, rewards?.rewardEventCount ?? 0);
  const ccPerDay = DEMO_MODE
    ? DEMO_AGGREGATES.ccEarned24h
    : ((rewards?.totalUserShare ?? 0) / rewardEvents) * 144;
  const nativePerDay =
    ((rewards?.totalUserPayoutPol ?? 0) / Math.max(1, rewards?.rewardSweepCount ?? 0)) *
    144;
  const nativeUsdPerDay = DEMO_MODE
    ? DEMO_AGGREGATES.nativeUsd24h
    : nativePerDay * POL_PRICE_USD;
  const stakedUsd = DEMO_MODE
    ? DEMO_AGGREGATES.totalStakedUsd
    : (rewards?.totalBondedPol ?? 0) * POL_PRICE_USD;
  const blendedApy = DEMO_MODE
    ? DEMO_AGGREGATES.blendedApy
    : polygon.apy + CC_BONUS_APY;
  const chainCount = DEMO_MODE
    ? new Set(DEMO_POSITIONS.map((position) => position.chainId)).size
    : positions.length > 0 ? 1 : 0;
  const singlePosition = positions.length === 1;
  const displayParty = DEMO_MODE ? "cs::1220ab9f::loop" : partyId;
  const displayAddress = DEMO_MODE ? "0x7c3a9d0d4ee91d" : address!;
  const ccPriceUsd = DEMO_MODE ? DEMO_AGGREGATES.ccPriceUsd : CC_PRICE_USD;
  const blendedSubtitle = DEMO_MODE
    ? `+ ${DEMO_AGGREGATES.ccBonusApy.toFixed(1)}% CC - Total effective: ${DEMO_AGGREGATES.totalEffectiveApy.toFixed(1)}%`
    : `${polygon.apy.toFixed(1)}% + ${CC_BONUS_APY.toFixed(1)}% CC = ${blendedApy.toFixed(1)}%`;
  const nativeEarningsLabel = DEMO_MODE
    ? `${formatUsd(nativeUsdPerDay)} native`
    : `${nativePerDay.toFixed(6)} ${polygon.symbol}`;

  return (
    <div className="space-y-10 py-8">
      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 font-mono text-xxs uppercase tracking-widest text-ink-400">
            <StatusDot status="active" />
            {DEMO_MODE && (
              <span className="rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 text-amber-bright">
                DEMO MODE
              </span>
            )}
            <span>FEATURED APP · NETWORK SHARE 2.41%</span>
          </div>
          <h1 className="font-display text-4xl">
            {positions.length > 0 ? "Good morning." : "Welcome."}
          </h1>
          <div className="mt-2 font-mono text-xs text-ink-400">
            Loop party {displayParty ? short(displayParty, 12, 6) : "unknown"} - EVM{" "}
            {short(displayAddress)}
          </div>
        </div>
        <CCRoundTicker />
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding={22} className="space-y-4">
          <StatLabel>Total Staked</StatLabel>
          <div className="font-display text-4xl tabular">{formatUsd(stakedUsd)}</div>
          <div className="flex items-center gap-3 text-neon">
            <Sparkline data={makeActivitySeries(DEMO_MODE ? stakedUsd : rewards?.totalBondedPol ?? 0)} />
            <span className="rounded-full border border-neon/30 bg-neon/10 px-2 py-1 font-mono text-xxs uppercase tracking-wider text-neon">
              + {positions.length} pos
            </span>
          </div>
          <div className="font-mono text-xxs uppercase tracking-widest text-ink-500">
            recent activity
          </div>
        </Card>

        <Card padding={22} glow={cc > 0} className="space-y-3">
          <StatLabel>Canton Coin Balance</StatLabel>
          <div className="font-display text-4xl tabular text-cc">
            {cc.toFixed(cc > 1000 ? 0 : 2)}
            <span className="ml-2 font-mono text-sm text-ink-400">CC</span>
          </div>
          <div className="font-mono text-xs text-ink-400">
            ≈ {formatUsd(cc * ccPriceUsd)} - CC/USD ${ccPriceUsd}
          </div>
        </Card>

        <Card padding={22} className="space-y-3">
          <StatLabel>24h Earnings</StatLabel>
          <div className="font-display text-4xl tabular">
            {formatUsd(ccPerDay * ccPriceUsd + nativeUsdPerDay)}
          </div>
          <div className="flex flex-wrap gap-3 font-mono text-xxs text-ink-400">
            <span className="text-cc">● {ccPerDay.toFixed(3)} CC</span>
            <span className="text-neon">
              ● {nativeEarningsLabel}
            </span>
          </div>
        </Card>

        <StatCell
          caption="Blended APY"
          value={`${blendedApy.toFixed(1)}%`}
          subtitle={blendedSubtitle}
          accent="neon"
          padding={22}
        />
      </section>

      <Card padding={0} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
          <div>
            <div className="font-display text-xl">Active Positions</div>
            <div className="font-mono text-xs text-ink-400">
              Across {chainCount} {chainCount === 1 ? "chain" : "chains"}
            </div>
          </div>
          <Link
            href="/stake"
            className="bg-neon px-4 py-2 font-mono text-xxs font-semibold uppercase tracking-wider text-neon-text hover:bg-neon/90"
          >
            + Stake new
          </Link>
        </div>

        {positions.length === 0 ? (
          <div className="p-10 text-center">
            <h2 className="font-display text-2xl">No active stakes yet</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-ink-400">
              Start staking {polygon.symbol} to earn native APY plus CC bonus
              rewards every 10 minutes.
            </p>
            <Link
              href="/stake"
              className="mt-6 inline-flex bg-neon px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-neon-text hover:bg-neon/90"
            >
              Start staking
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1fr_0.9fr_1fr] gap-3 border-b border-ink-700 px-5 py-3 font-mono text-xxs uppercase tracking-widest text-ink-400">
                <div>Chain · Validator</div>
                <div>Staked</div>
                <div>APY</div>
                <div>Native rewards</div>
                <div>CC earned</div>
                <div className="text-right">Actions</div>
              </div>
              {positions.map((position) => (
                <DashboardPositionRow
                  key={position.contractId}
                  position={position}
                  singlePosition={singlePosition}
                  nativeRewards={rewards?.totalUserPayoutPol ?? 0}
                  ccEarned={rewards?.totalUserShare ?? 0}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      {!DEMO_MODE && <MultiChainRoadmap />}
    </div>
  );
}

function StatLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">
      {children}
    </div>
  );
}
