import { Card } from "@/components/Card";
import { Sparkline } from "@/components/Sparkline";
import { makeActivitySeries } from "@/lib/series";

type DashboardSummaryCardsProps = {
  stakedUsd: number;
  positionsCount: number;
  sparklineBase: number;
  cc: number;
  ccPriceUsd: number;
  ccPerDay: number;
  nativeUsdPerDay: number;
  nativeEarningsLabel: string;
  blendedApy: number;
  ccBonusApy: number;
  totalEffectiveApy: number;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function DashboardSummaryCards({
  stakedUsd,
  positionsCount,
  sparklineBase,
  cc,
  ccPriceUsd,
  ccPerDay,
  nativeUsdPerDay,
  nativeEarningsLabel,
  blendedApy,
  ccBonusApy,
  totalEffectiveApy,
}: DashboardSummaryCardsProps) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card padding={24} className="min-h-[156px] overflow-hidden">
        <StatLabel>Total Staked</StatLabel>
        <div className="mt-3 font-sans text-4xl font-semibold tracking-tight text-ink-100 tabular">
          {formatUsd(stakedUsd)}
        </div>
        <div className="mt-4 flex items-center gap-3 text-neon">
          <Sparkline
            data={makeActivitySeries(sparklineBase)}
            width={112}
            height={28}
          />
          <span className="rounded-full bg-neon/10 px-2 py-1 font-mono text-xxs font-semibold text-neon">
            + {positionsCount} pos
          </span>
        </div>
      </Card>

      <Card padding={24} glow={cc > 0} className="relative min-h-[156px]">
        <span className="absolute right-5 top-5 grid h-5 w-5 place-items-center rounded-full bg-cc text-[8px] font-bold text-ink-950">
          CC
        </span>
        <StatLabel>Canton Coin Balance</StatLabel>
        <div className="mt-4 font-sans text-4xl font-semibold tracking-tight text-cc tabular">
          {cc.toFixed(cc > 1000 ? 0 : 2)}
          <span className="ml-2 text-lg text-ink-400">CC</span>
        </div>
        <div className="mt-3 font-mono text-xs text-ink-500">
          ~= {formatUsd(cc * ccPriceUsd)} - CC/USD ${ccPriceUsd}
        </div>
      </Card>

      <Card padding={24} className="min-h-[156px]">
        <StatLabel>24h Earnings</StatLabel>
        <div className="mt-3 font-sans text-4xl font-semibold tracking-tight text-ink-100 tabular">
          {formatUsd(ccPerDay * ccPriceUsd + nativeUsdPerDay)}
        </div>
        <div className="mt-5 flex flex-wrap gap-3 font-mono text-xs">
          <span className="text-cc">cc {ccPerDay.toFixed(2)} CC</span>
          <span className="text-neon">native {nativeEarningsLabel}</span>
        </div>
      </Card>

      <Card padding={24} className="min-h-[156px]">
        <StatLabel>Blended APY</StatLabel>
        <div className="mt-3 flex items-end gap-2">
          <span className="font-sans text-4xl font-semibold tracking-tight text-neon tabular">
            {blendedApy.toFixed(1)}
          </span>
          <span className="mb-1 font-sans text-2xl font-semibold text-neon">
            %
          </span>
          <span className="mb-2 font-mono text-sm font-semibold text-ink-200">
            + {ccBonusApy.toFixed(1)}% CC
          </span>
        </div>
        <div className="mt-4 font-mono text-xs text-ink-400">
          Total effective:{" "}
          <span className="font-semibold text-neon">
            {totalEffectiveApy.toFixed(1)}%
          </span>
        </div>
      </Card>
    </section>
  );
}

function StatLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-xxs font-semibold uppercase tracking-[0.18em] text-ink-500">
      {children}
    </div>
  );
}
