import Link from "next/link";
import { ChainBadge } from "@/components/ChainBadge";
import type { PositionRow } from "@/lib/api";
import { chainById, polygonChain } from "@/lib/chains";
import {
  isDemoPosition,
  type DemoPositionRow,
} from "@/lib/demo-positions";

type DashboardPositionRowProps = {
  position: PositionRow | DemoPositionRow;
  singlePosition: boolean;
  nativeRewards: number;
  ccEarned: number;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function demoAlert(chainName: string) {
  window.alert(`Demo mode: ${chainName} staking goes live in Phase 2`);
}

export function DashboardPositionRow({
  position,
  singlePosition,
  nativeRewards,
  ccEarned,
}: DashboardPositionRowProps) {
  if (isDemoPosition(position)) {
    const chain = chainById(position.chainId) ?? polygonChain();
    const markers = position.argument.markersEmitted;
    const stakedUsd = position.amountSymbol * position.symbolPriceUsd;

    return (
      <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1fr_0.9fr_1fr] items-center gap-3 border-b border-ink-700 px-5 py-4 text-sm last:border-b-0 hover:bg-ink-800/30">
        <div>
          <ChainBadge chain={chain} />
          <div className="mt-2 font-mono text-xxs text-ink-400">
            {position.validatorName} &middot; {markers}{" "}
            {markers === 1 ? "marker" : "markers"}
          </div>
        </div>
        <div>
          <div className="font-mono tabular">
            {position.amountSymbol.toLocaleString()} {chain.symbol}
          </div>
          <div className="mt-1 font-mono text-xxs text-ink-500">
            {formatUsd(stakedUsd)}
          </div>
        </div>
        <div>
          <div className="font-mono text-neon">{position.apy.toFixed(1)}%</div>
          <div className="mt-1 font-mono text-xxs text-cc">
            + {position.ccBonusApy.toFixed(1)}% CC
          </div>
        </div>
        <div className="font-mono text-xs text-ink-300">
          + {position.nativeRewards.toFixed(1)} {chain.symbol}
        </div>
        <div className="font-mono text-xs text-cc">
          + {position.ccEarned.toFixed(1)} CC
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => demoAlert(chain.name)}
            className="hairline px-3 py-1.5 font-mono text-xxs uppercase tracking-wider hover:bg-ink-800"
          >
            + Stake
          </button>
          <button
            type="button"
            onClick={() => demoAlert(chain.name)}
            className="hairline px-3 py-1.5 font-mono text-xxs uppercase tracking-wider text-ink-400 hover:bg-ink-800"
          >
            Unstake
          </button>
        </div>
      </div>
    );
  }

  const polygon = polygonChain();
  const markers = position.argument.markersEmitted;

  return (
    <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1fr_0.9fr_1fr] items-center gap-3 border-b border-ink-700 px-5 py-4 text-sm last:border-b-0 hover:bg-ink-800/30">
      <div>
        <ChainBadge chain={polygon} />
        <div className="mt-2 font-mono text-xxs text-ink-400">
          auto-validator · {markers} {markers === 1 ? "marker" : "markers"}
        </div>
      </div>
      <div className="font-mono tabular">
        {Number(position.argument.amountPol).toFixed(4)} {polygon.symbol}
      </div>
      <div className="font-mono text-neon">{polygon.apy.toFixed(1)}%</div>
      <div className="font-mono text-xs text-ink-300">
        {singlePosition
          ? `${nativeRewards.toFixed(6)} ${polygon.symbol}`
          : "see rewards"}
      </div>
      <div className="font-mono text-xs text-cc">
        {singlePosition ? `${ccEarned.toFixed(4)} CC` : `${markers} markers`}
      </div>
      <div className="flex justify-end gap-2">
        <Link
          href="/stake"
          className="hairline px-3 py-1.5 font-mono text-xxs uppercase tracking-wider hover:bg-ink-800"
        >
          + Stake
        </Link>
        <button
          type="button"
          className="hairline px-3 py-1.5 font-mono text-xxs uppercase tracking-wider text-ink-400 hover:bg-ink-800"
        >
          Unstake
        </button>
      </div>
    </div>
  );
}
