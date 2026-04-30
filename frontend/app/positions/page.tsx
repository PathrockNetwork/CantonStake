"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseEther } from "viem";
import { mockValidatorShareAbi } from "@/lib/abi";
import { fetchPositions, sweepNativeRewards, type PositionRow } from "@/lib/api";

const VALIDATOR_ADDRESS = process.env
  .NEXT_PUBLIC_MOCK_VALIDATOR_SHARE as `0x${string}`;

const statusStyles: Record<string, string> = {
  Pending: "text-ink-300",
  Bonded: "text-success",
  Unbonding: "text-warning",
  Released: "text-ink-400",
  Cancelled: "text-danger",
};

export default function PositionsPage() {
  const { address, isConnected } = useAccount();

  const {
    data: positions,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["positions", address],
    queryFn: () => (address ? fetchPositions(address) : Promise.resolve([])),
    enabled: !!address,
    refetchInterval: 5000, // Live polling for demo drama
  });

  return (
    <div className="space-y-12 py-8">
      <header>
        <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright mb-4">
          § 02 · positions
        </p>
        <h1 className="font-display text-5xl mb-3">Your delegations</h1>
        <p className="text-ink-300">
          Source of truth is the Canton ledger. Polygon is the settlement layer.
        </p>
      </header>

      {!isConnected && (
        <div className="hairline p-12 text-center text-ink-300 font-mono text-sm">
          connect your wallet to view positions
        </div>
      )}

      {isConnected && isLoading && (
        <div className="hairline p-12 text-center text-ink-400 font-mono text-sm">
          loading positions…
        </div>
      )}

      {isConnected && positions && positions.length === 0 && (
        <div className="hairline p-12 text-center text-ink-400 space-y-3">
          <div className="font-display text-2xl italic">No positions yet</div>
          <div className="font-mono text-xs">
            head to{" "}
            <a
              href="/stake"
              className="text-amber-bright hover:text-amber-glow"
            >
              / stake
            </a>{" "}
            to create your first delegation
          </div>
        </div>
      )}

      {isConnected && positions && positions.length > 0 && (
        <div className="hairline">
          <table className="w-full">
            <thead className="hairline-b">
              <tr className="text-left">
                <th className="font-mono text-xxs uppercase tracking-widest text-ink-400 px-4 py-3">
                  status
                </th>
                <th className="font-mono text-xxs uppercase tracking-widest text-ink-400 px-4 py-3">
                  amount
                </th>
                <th className="font-mono text-xxs uppercase tracking-widest text-ink-400 px-4 py-3">
                  bonded
                </th>
                <th className="font-mono text-xxs uppercase tracking-widest text-ink-400 px-4 py-3">
                  ready at
                </th>
                <th className="font-mono text-xxs uppercase tracking-widest text-ink-400 px-4 py-3">
                  markers
                </th>
                <th className="font-mono text-xxs uppercase tracking-widest text-ink-400 px-4 py-3 text-right">
                  action
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <PositionRowView key={p.contractId} position={p} onActed={refetch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PositionRowView({
  position,
  onActed,
}: {
  position: PositionRow;
  onActed: () => void;
}) {
  const { argument: a } = position;
  const [sweepPending, setSweepPending] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } =
    useWaitForTransactionReceipt({ hash });

  if (confirmed) onActed();

  function onUnbond() {
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

  return (
    <tr className="hairline-b last:border-b-0 hover:bg-ink-900/40 transition-colors">
      <td className="px-4 py-4">
        <span className={`chip chip-dot ${statusStyles[a.status]} border-transparent`}>
          {a.status.toLowerCase()}
        </span>
      </td>
      <td className="px-4 py-4 font-display text-xl tabular">
        {Number(a.amountPol).toFixed(2)}{" "}
        <span className="font-mono text-xs text-ink-400">POL</span>
      </td>
      <td className="px-4 py-4 font-mono text-xs text-ink-300">
        {a.bondedAt ? new Date(a.bondedAt).toLocaleString() : "—"}
      </td>
      <td className="px-4 py-4 font-mono text-xs text-ink-300">
        {a.unbondingReadyAt
          ? new Date(a.unbondingReadyAt).toLocaleString()
          : "—"}
      </td>
      <td className="px-4 py-4 font-mono text-sm tabular text-amber-bright">
        {a.markersEmitted}
      </td>
      <td className="px-4 py-4 text-right">
        {a.status === "Bonded" && (
          <div className="flex justify-end gap-2">
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
          </div>
        )}
        {a.status === "Unbonding" && (
          <span className="font-mono text-xxs text-ink-400">
            auto-releases
          </span>
        )}
      </td>
    </tr>
  );
}
