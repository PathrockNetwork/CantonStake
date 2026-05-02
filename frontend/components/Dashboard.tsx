"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Card } from "@/components/Card";
import { CCRoundTicker } from "@/components/CCRoundTicker";
import { DashboardPositionRow } from "@/components/DashboardPositionRow";
import { DashboardSummaryCards } from "@/components/DashboardSummaryCards";
import { MultiChainRoadmap } from "@/components/MultiChainRoadmap";
import { StatusDot } from "@/components/StatusDot";
import { fetchPositions, fetchRewards, type PositionRow } from "@/lib/api";
import { polygonChain } from "@/lib/chains";
import {
  DEMO_AGGREGATES,
  DEMO_POSITIONS,
  type DemoPositionRow,
} from "@/lib/demo-positions";
import { useLoopWallet } from "@/lib/loop-wallet";

const POL_PRICE_USD = 0.42;
const CC_PRICE_USD = 0.16;
const CC_BONUS_APY = 2.4;
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_FAKE_POSITIONS === "true";

function short(value: string, head = 6, tail = 4) {
  if (!value) return "unknown";
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
      <div className="hairline rounded-xl p-8 font-mono text-sm text-danger">
        dashboard data unavailable
      </div>
    );
  }
  if (!DEMO_MODE && (!positionsQuery.data || !rewardsQuery.data)) {
    return (
      <div className="hairline rounded-xl p-8 font-mono text-sm text-ink-400">
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
    ((rewards?.totalUserPayoutPol ?? 0) /
      Math.max(1, rewards?.rewardSweepCount ?? 0)) *
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
  const totalEffectiveApy = DEMO_MODE
    ? DEMO_AGGREGATES.totalEffectiveApy
    : blendedApy;
  const ccBonusApy = DEMO_MODE ? DEMO_AGGREGATES.ccBonusApy : CC_BONUS_APY;
  const chainCount = DEMO_MODE
    ? new Set(DEMO_POSITIONS.map((position) => position.chainId)).size
    : positions.length > 0
      ? 1
      : 0;
  const singlePosition = positions.length === 1;
  const displayParty = DEMO_MODE ? "cs::1220ab9f::loop" : partyId;
  const displayAddress = DEMO_MODE ? "0x7c3a9d0d4ee91d" : address ?? "";
  const ccPriceUsd = DEMO_MODE ? DEMO_AGGREGATES.ccPriceUsd : CC_PRICE_USD;
  const nativeEarningsLabel = DEMO_MODE
    ? `${formatUsd(nativeUsdPerDay)} native`
    : `${nativePerDay.toFixed(6)} ${polygon.symbol}`;

  return (
    <div className="space-y-7 py-7">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-400">
            <StatusDot status="active" size={8} />
            <span>
              FEATURED APP - NETWORK SHARE{" "}
              {(DEMO_MODE ? DEMO_AGGREGATES.networkSharePct : 2.41).toFixed(2)}%
            </span>
            {DEMO_MODE && (
              <span className="rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 text-xxs text-amber-bright">
                DEMO MODE
              </span>
            )}
          </div>
          <h1 className="font-sans text-4xl font-semibold tracking-tight text-ink-100 md:text-5xl">
            {positions.length > 0 ? "Good morning." : "Welcome."}
          </h1>
          <div className="mt-2 font-mono text-xs text-ink-500">
            Loop party {displayParty ? short(displayParty, 16, 6) : "unknown"} -
            Ledger {short(displayAddress, 6, 5)}
          </div>
        </div>
        <CCRoundTicker />
      </section>

      <DashboardSummaryCards
        stakedUsd={stakedUsd}
        positionsCount={positions.length}
        sparklineBase={DEMO_MODE ? stakedUsd : rewards?.totalBondedPol ?? 0}
        cc={cc}
        ccPriceUsd={ccPriceUsd}
        ccPerDay={ccPerDay}
        nativeUsdPerDay={nativeUsdPerDay}
        nativeEarningsLabel={nativeEarningsLabel}
        blendedApy={blendedApy}
        ccBonusApy={ccBonusApy}
        totalEffectiveApy={totalEffectiveApy}
      />

      <Card padding={0} className="overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <div className="font-sans text-xl font-semibold text-ink-100">
              Active Positions
            </div>
            <div className="mt-1 text-sm text-ink-500">
              Across {chainCount} {chainCount === 1 ? "chain" : "chains"}
            </div>
          </div>
          <Link
            href="/stake"
            className="rounded-xl bg-neon px-4 py-2.5 font-sans text-sm font-semibold text-neon-text transition hover:bg-neon/90"
          >
            + Stake new
          </Link>
        </div>

        {positions.length === 0 ? (
          <div className="border-t border-white/10 p-10 text-center">
            <h2 className="font-sans text-2xl font-semibold text-ink-100">
              No active stakes yet
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-ink-400">
              Start staking {polygon.symbol} to earn native APY plus CC bonus
              rewards every 10 minutes.
            </p>
            <Link
              href="/stake"
              className="mt-6 inline-flex rounded-xl bg-neon px-5 py-3 font-sans text-sm font-semibold text-neon-text transition hover:bg-neon/90"
            >
              Start staking
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[1.5fr_0.9fr_0.8fr_1fr_0.9fr_1fr] gap-3 border-y border-white/10 px-6 py-3 font-mono text-xxs uppercase tracking-[0.18em] text-ink-500">
                <div>Chain - Validator</div>
                <div>Staked</div>
                <div>APY</div>
                <div>Native Rewards</div>
                <div>CC Earned</div>
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
