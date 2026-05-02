import { Card } from "@/components/Card";
import { ChainBadge } from "@/components/ChainBadge";
import { DonutChart } from "@/components/DonutChart";
import type { ChainConfig } from "@/lib/chains";

export type AllocationRow = {
  chain: ChainConfig;
  usd: number;
  percent: number;
};

export function formatUsd(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

function ProjectionBar({
  label,
  value,
  widthPct,
  colorClass,
}: {
  label: string;
  value: number;
  widthPct: number;
  colorClass: string;
}) {
  return (
    <div>
      <div className="mb-2 flex justify-between gap-4 text-sm">
        <span className="text-ink-400">{label}</span>
        <span className="font-mono text-ink-200">{formatUsd(value)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-ink-700">
        <div
          className={`h-full ${colorClass}`}
          style={{ width: `${Math.max(0, Math.min(100, widthPct))}%` }}
        />
      </div>
    </div>
  );
}

export function AnalyticsAllocationCard({
  allocation,
}: {
  allocation: AllocationRow[];
}) {
  const total = allocation.reduce((sum, row) => sum + row.usd, 0);

  return (
    <Card padding={24}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="font-display text-2xl">Chain allocation</h2>
        <span className="rounded-full border border-neon/30 bg-neon/10 px-2 py-1 font-mono text-xxs uppercase tracking-widest text-neon">
          {allocation.length} {allocation.length === 1 ? "chain" : "chains"}
        </span>
      </div>
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[auto_1fr]">
        <div className="justify-self-center">
          <DonutChart
            slices={allocation.map((row) => ({
              id: row.chain.id,
              value: row.usd,
              color: row.chain.color,
              label: row.chain.name,
            }))}
            centerLabel={`${allocation.length} ${
              allocation.length === 1 ? "chain" : "chains"
            }`}
            centerSub={formatUsd(total)}
          />
        </div>
        <div className="space-y-4">
          {allocation.map((row) => (
            <div key={row.chain.id} className="space-y-2">
              <div className="flex items-center gap-3">
                <ChainBadge chain={row.chain} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink-100">
                    {row.chain.name}
                  </div>
                  <div className="font-mono text-xxs text-ink-400">
                    {row.percent.toFixed(1)}% - {formatUsd(row.usd)}
                  </div>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full"
                  style={{
                    width: `${row.percent}%`,
                    backgroundColor: row.chain.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function AnalyticsProjectionCard({
  projection,
  blendedApy,
  nativeProjection,
  ccProjection,
}: {
  projection: number;
  blendedApy: number;
  nativeProjection: number;
  ccProjection: number;
}) {
  const projectionTotal = Math.max(1, projection);

  return (
    <Card padding={24} className="space-y-6">
      <div>
        <div className="mb-2 font-mono text-xxs uppercase tracking-widest text-ink-400">
          12-MONTH PROJECTION
        </div>
        <div className="font-display text-5xl tabular text-neon">
          {formatUsd(projection)}
        </div>
        <div className="mt-2 font-mono text-xs text-ink-400">
          at {blendedApy.toFixed(1)}% blended (native + CC)
        </div>
      </div>
      <div className="space-y-5">
        <ProjectionBar
          label="Native rewards"
          value={nativeProjection}
          widthPct={(nativeProjection / projectionTotal) * 100}
          colorClass="bg-neon"
        />
        <ProjectionBar
          label="Canton Coin bonus"
          value={ccProjection}
          widthPct={(ccProjection / projectionTotal) * 100}
          colorClass="bg-cc"
        />
      </div>
    </Card>
  );
}
