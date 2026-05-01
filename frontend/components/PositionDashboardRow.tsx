"use client";

import Link from "next/link";
import { useState } from "react";
import { parseEther } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ChainBadge } from "@/components/ChainBadge";
import { StatusTimeline } from "@/components/StatusTimeline";
import { mockValidatorShareAbi } from "@/lib/abi";
import { sweepNativeRewards, type PositionRow } from "@/lib/api";
import { polygonChain } from "@/lib/chains";

const VALIDATOR_ADDRESS = polygonChain().validatorContract;
const POL_PRICE_USD = 0.42;

function relativeTime(ts?: string) {
  if (!ts) return "—";
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type PositionDashboardRowProps = {
  position: PositionRow;
  onActed: () => void;
  statusStyles: Record<string, string>;
};

export function PositionDashboardRow({
  position,
  onActed,
  statusStyles,
}: PositionDashboardRowProps) {
  const { argument: a } = position;
  const polygon = polygonChain();
  const [sweepPending, setSweepPending] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } =
    useWaitForTransactionReceipt({ hash });

  if (confirmed) onActed();

  function onUnbond() {
    if (!VALIDATOR_ADDRESS) return;
    const wei = parseEther(a.amountPol);
    writeContract({
      address: VALIDATOR_ADDRESS,
      abi: mockValidatorShareAbi,
      functionName: "sellVoucher_new",
      args: [wei, wei],
    });
  }

  async function onSweep() {
    setSweepPending(true);
    try {
      await sweepNativeRewards(position.contractId);
    } catch (err) {
      console.error("[positions] sweep failed", err);
    } finally {
      setSweepPending(false);
    }
  }

  const canUnbond = a.status === "Bonded" && !isPending && !confirming;
  const amount = Number(a.amountPol);

  return (
    <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_0.9fr_1.1fr_1.3fr] items-center gap-3 border-b border-ink-700 px-5 py-4 text-sm last:border-b-0 hover:bg-ink-800/30">
      <div>
        <ChainBadge chain={polygon} />
        <div className="mt-2 flex items-center gap-2 font-mono text-xxs">
          <span className={`chip chip-dot ${statusStyles[a.status]} border-transparent`}>
            {a.status.toLowerCase()}
          </span>
          <span className="text-ink-500">auto-validator</span>
        </div>
      </div>
      <div>
        <div className="font-mono text-lg tabular text-ink-100">
          {amount.toFixed(4)} {polygon.symbol}
        </div>
        <div className="mt-1 font-mono text-xxs text-ink-400">
          {(amount * POL_PRICE_USD).toLocaleString(undefined, {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          })}
        </div>
      </div>
      <div>
        <div className="font-mono text-2xl tabular text-cc">{a.markersEmitted}</div>
        <span className="hairline mt-1 inline-flex px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-400">
          marker
        </span>
      </div>
      <div className="font-mono text-xs text-ink-300">{relativeTime(a.bondedAt)}</div>
      <StatusTimeline status={a.status} />
      <div className="flex justify-end gap-2">
        <Link href="/stake" className="font-mono text-xxs uppercase tracking-wider hairline px-3 py-1.5 hover:bg-ink-800">
          + Stake
        </Link>
        {a.status === "Bonded" && (
          <>
            <button
              onClick={onSweep}
              disabled={sweepPending}
              className="font-mono text-xxs uppercase tracking-wider hairline px-3 py-1.5 hover:bg-ink-800 disabled:opacity-50"
            >
              {sweepPending ? "..." : "Sweep"}
            </button>
            <button
              onClick={onUnbond}
              disabled={!canUnbond}
              className="font-mono text-xxs uppercase tracking-wider hairline px-3 py-1.5 hover:bg-ink-800 disabled:opacity-50"
            >
              {isPending || confirming ? "…" : "Unbond"}
            </button>
          </>
        )}
        {a.status === "Unbonding" && (
          <span className="font-mono text-xxs text-ink-400">auto-releases</span>
        )}
      </div>
    </div>
  );
}
