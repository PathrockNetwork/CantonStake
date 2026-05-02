import Link from "next/link";
import { StatusDot } from "@/components/StatusDot";
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

function formatTokenAmount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  return value.toFixed(2);
}

function formatReward(value: number) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

function formatCc(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1000 ? 0 : 1,
  }).format(value);
}

function demoAlert(chainName: string) {
  window.alert(`Demo mode: ${chainName} staking goes live in Phase 2`);
}

const rowClass =
  "grid grid-cols-[1.5fr_0.9fr_0.8fr_1fr_0.9fr_1fr] items-center gap-3 border-b border-white/10 px-6 py-5 text-sm last:border-b-0 hover:bg-white/[0.03]";

const actionClass =
  "rounded-xl border border-white/10 bg-ink-900 px-3 py-2 font-sans text-xs font-semibold text-ink-100 transition hover:bg-ink-800";

const mutedActionClass = `${actionClass} text-ink-300`;

export function DashboardPositionRow({
  position,
  singlePosition,
  nativeRewards,
  ccEarned,
}: DashboardPositionRowProps) {
  if (isDemoPosition(position)) {
    const chain = chainById(position.chainId) ?? polygonChain();
    const stakedUsd = position.amountSymbol * position.symbolPriceUsd;

    return (
      <div className={rowClass}>
        <div className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white shadow-[0_0_24px_rgba(0,0,0,0.25)]"
            style={{ backgroundColor: chain.color }}
            aria-hidden="true"
          >
            {chain.symbol.slice(0, 2)}
          </span>
          <div>
            <div className="font-sans text-sm font-semibold text-ink-100">
              {chain.name.replace(" Amoy", "")}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
              <StatusDot status="active" />
              <span>{position.validatorName}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="font-mono text-sm font-semibold tabular text-ink-100">
            {formatTokenAmount(position.amountSymbol)}{" "}
            <span className="text-ink-400">{chain.symbol}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-ink-500">
            {formatUsd(stakedUsd)}
          </div>
        </div>

        <div>
          <div className="font-mono text-sm font-semibold text-neon">
            {position.apy.toFixed(2)}%
          </div>
          <div className="mt-1 font-mono text-xs text-ink-500">
            + {position.ccBonusApy.toFixed(1)}% CC
          </div>
        </div>

        <div>
          <div className="font-mono text-sm font-semibold text-ink-100">
            +{formatReward(position.nativeRewards)}{" "}
            <span className="text-ink-400">{chain.symbol}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-ink-500">native</div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-cc">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-cc text-[7px] font-bold text-ink-950">
              CC
            </span>
            + {formatCc(position.ccEarned)}
          </div>
          <div className="mt-1 font-mono text-xs text-ink-500">
            {formatUsd(position.ccEarned * 0.16)}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => demoAlert(chain.name)}
            className={actionClass}
          >
            + Stake
          </button>
          <button
            type="button"
            onClick={() => demoAlert(chain.name)}
            className={mutedActionClass}
          >
            Unstake
          </button>
        </div>
      </div>
    );
  }

  const polygon = polygonChain();
  const markers = position.argument.markersEmitted;
  const amountPol = Number(position.argument.amountPol);

  return (
    <div className={rowClass}>
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: polygon.color }}
          aria-hidden="true"
        >
          {polygon.symbol.slice(0, 2)}
        </span>
        <div>
          <div className="font-sans text-sm font-semibold text-ink-100">
            {polygon.name.replace(" Amoy", "")}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
            <StatusDot status="active" />
            <span>auto-validator</span>
          </div>
        </div>
      </div>

      <div>
        <div className="font-mono text-sm font-semibold tabular text-ink-100">
          {formatTokenAmount(amountPol)}{" "}
          <span className="text-ink-400">{polygon.symbol}</span>
        </div>
        <div className="mt-1 font-mono text-xs text-ink-500">
          {markers} {markers === 1 ? "marker" : "markers"}
        </div>
      </div>

      <div>
        <div className="font-mono text-sm font-semibold text-neon">
          {polygon.apy.toFixed(2)}%
        </div>
        <div className="mt-1 font-mono text-xs text-ink-500">+ CC</div>
      </div>

      <div>
        <div className="font-mono text-sm font-semibold text-ink-100">
          {singlePosition
            ? `+${nativeRewards.toFixed(6)} ${polygon.symbol}`
            : "see rewards"}
        </div>
        <div className="mt-1 font-mono text-xs text-ink-500">native</div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 font-mono text-sm font-semibold text-cc">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-cc text-[7px] font-bold text-ink-950">
            CC
          </span>
          {singlePosition ? `+ ${ccEarned.toFixed(4)}` : `${markers}`}
        </div>
        <div className="mt-1 font-mono text-xs text-ink-500">
          {singlePosition ? "earned" : "markers"}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/stake" className={actionClass}>
          + Stake
        </Link>
        <button type="button" className={mutedActionClass}>
          Unstake
        </button>
      </div>
    </div>
  );
}
