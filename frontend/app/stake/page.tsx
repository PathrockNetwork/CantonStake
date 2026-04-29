"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  useBalance,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { polygonAmoy } from "wagmi/chains";
import { parseEther, formatEther } from "viem";
import { mockValidatorShareAbi } from "@/lib/abi";
import { createStakingRequest } from "@/lib/api";
import { useLoopWallet } from "@/lib/loop-wallet";

const VALIDATOR_ADDRESS = process.env
  .NEXT_PUBLIC_MOCK_VALIDATOR_SHARE as `0x${string}`;

export default function StakePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { partyId, isConnected: loopConnected } = useLoopWallet();

  const [amount, setAmount] = useState("1.0");
  const [cantonStage, setCantonStage] = useState<
    "idle" | "creating" | "created" | "error"
  >("idle");
  const [cantonTxId, setCantonTxId] = useState<string | null>(null);
  const [cantonError, setCantonError] = useState<string | null>(null);

  const {
    data: hash,
    error: writeError,
    isPending: writePending,
    writeContract,
  } = useWriteContract();

  const { isLoading: evmConfirming, isSuccess: evmConfirmed } =
    useWaitForTransactionReceipt({ hash });

  const wrongNetwork = isConnected && chainId !== polygonAmoy.id;
  const canStake =
    isConnected &&
    loopConnected &&
    !!partyId &&
    !switchPending &&
    !writePending &&
    !evmConfirming;

  async function onStake() {
    if (!address) return;
    try {
      setCantonStage("creating");
      setCantonError(null);

      if (chainId !== polygonAmoy.id) {
        await switchChainAsync({ chainId: polygonAmoy.id });
      }

      // 1. Create StakingRequest on Canton.
      const { transactionId } = await createStakingRequest({
        evmAddress: address,
        amountPol: amount,
        delegator: partyId!,
      });
      setCantonTxId(transactionId);
      setCantonStage("created");

      // 2. Fire real buyVoucher() on Amoy.
      const amountWei = parseEther(amount);
      writeContract({
        address: VALIDATOR_ADDRESS,
        abi: mockValidatorShareAbi,
        functionName: "buyVoucher",
        args: [amountWei, amountWei],
        value: amountWei,
      });
    } catch (err) {
      setCantonStage("error");
      setCantonError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-12 py-8">
      <header>
        <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright mb-4">
          § 01 · stake
        </p>
        <h1 className="font-display text-5xl mb-3">Delegate POL</h1>
        <p className="text-ink-300 max-w-2xl">
          Your wallet signs the buyVoucher transaction on Polygon Amoy.
          Simultaneously a StakingRequest is created on Canton. When our
          orchestrator observes the ShareMinted event, it transitions the
          position to Bonded and emits a FeaturedAppActivityMarker.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-6">
        {/* Input panel */}
        <div className="col-span-12 md:col-span-7 hairline bg-ink-900/40 p-8 space-y-6">
          <div>
            <label className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-2 block">
              amount
            </label>
            <div className="flex items-baseline gap-3">
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent font-display text-6xl text-ink-100 tabular w-full outline-none border-b border-ink-600 focus:border-amber-bright pb-2"
              />
              <span className="font-mono text-lg text-ink-300">POL</span>
            </div>
            {balance && (
              <div className="font-mono text-xs text-ink-400 mt-3">
                wallet balance · {Number(formatEther(balance.value)).toFixed(4)} POL
                <button
                  onClick={() =>
                    setAmount(
                      (Number(formatEther(balance.value)) * 0.9).toFixed(4)
                    )
                  }
                  className="ml-3 uppercase tracking-wider text-amber-bright hover:text-amber-glow"
                >
                  max
                </button>
              </div>
            )}
          </div>

          <div className="hairline-t pt-6 grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
                estimated apy
              </div>
              <div className="font-display text-2xl">8.00%</div>
              <div className="font-mono text-xxs text-ink-400">native · pol</div>
            </div>
            <div>
              <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
                cc bonus
              </div>
              <div className="font-display text-2xl text-amber-bright">
                ~ marker
              </div>
              <div className="font-mono text-xxs text-ink-400">cip-47 · bond</div>
            </div>
          </div>

          <button
            onClick={onStake}
            disabled={!canStake}
            className="w-full bg-amber hover:bg-amber-bright disabled:bg-ink-700 disabled:text-ink-400 disabled:cursor-not-allowed text-ink-950 font-mono text-sm uppercase tracking-wider font-semibold py-4 transition-colors"
          >
            {!isConnected
              ? "Connect EVM wallet to stake"
              : !loopConnected || !partyId
              ? "Connect Loop wallet for Canton identity"
              : switchPending
              ? "Switching to Amoy..."
              : wrongNetwork
              ? "Stake on Amoy"
              : writePending
              ? "Waiting on wallet signature…"
              : evmConfirming
              ? "Confirming on Amoy…"
              : "Stake now"}
          </button>
        </div>

        {/* Execution trace */}
        <aside className="col-span-12 md:col-span-5 hairline bg-ink-900/40 p-8 space-y-6">
          <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">
            execution trace
          </div>

          <TraceRow
            index="01"
            label="Create StakingRequest (Canton)"
            status={
              cantonStage === "idle"
                ? "pending"
                : cantonStage === "creating"
                ? "running"
                : cantonStage === "created"
                ? "done"
                : "error"
            }
            detail={
              cantonTxId
                ? `tx · ${cantonTxId.slice(0, 16)}…`
                : cantonStage === "error"
                ? cantonError ?? "failed"
                : "waiting"
            }
          />

          <TraceRow
            index="02"
            label="buyVoucher (Polygon Amoy)"
            status={
              !hash
                ? "pending"
                : evmConfirming
                ? "running"
                : evmConfirmed
                ? "done"
                : writeError
                ? "error"
                : "running"
            }
            detail={
              hash
                ? `tx · ${hash.slice(0, 16)}…`
                : writeError
                ? writeError.message.slice(0, 60)
                : "waiting"
            }
          />

          <TraceRow
            index="03"
            label="Orchestrator catches ShareMinted"
            status={evmConfirmed ? "running" : "pending"}
            detail="viem event watcher"
          />

          <TraceRow
            index="04"
            label="StakingRequest_Accept (Daml)"
            status={evmConfirmed ? "running" : "pending"}
            detail="emits FeaturedAppActivityMarker"
            accent
          />

          {evmConfirmed && (
            <div className="hairline-t pt-6">
              <a
                href={`https://amoy.polygonscan.com/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-amber-bright hover:text-amber-glow"
              >
                View on Amoy Polygonscan →
              </a>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function TraceRow({
  index,
  label,
  status,
  detail,
  accent = false,
}: {
  index: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail: string;
  accent?: boolean;
}) {
  const dot = {
    pending: "text-ink-500",
    running: "text-amber-bright animate-pulse",
    done: "text-success",
    error: "text-danger",
  }[status];

  return (
    <div className="flex items-start gap-4">
      <span className="font-mono text-xxs text-ink-400 pt-1">{index}</span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`chip chip-dot ${dot} border-transparent px-0`} />
          <span
            className={`text-sm ${
              accent ? "text-amber-bright font-medium" : "text-ink-100"
            }`}
          >
            {label}
          </span>
        </div>
        <div className="font-mono text-xxs text-ink-400 mt-1 ml-3 break-all">
          {detail}
        </div>
      </div>
    </div>
  );
}
