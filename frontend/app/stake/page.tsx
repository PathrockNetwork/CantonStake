"use client";

import { useState } from "react";
import { useAccount, useBalance, useChainId, useSwitchChain } from "wagmi";
import { formatEther } from "viem";
import { Card } from "@/components/Card";
import { StakeFlowModal } from "@/components/StakeFlowModal";
import { TraceRow } from "@/components/TraceRow";
import { polygonChain } from "@/lib/chains";
import { useLoopWallet } from "@/lib/loop-wallet";

export default function StakePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { isPending: switchPending } = useSwitchChain();
  const { partyId, isConnected: loopConnected } = useLoopWallet();
  const [open, setOpen] = useState(false);
  const activeChain = polygonChain();
  const activeWagmiChain = activeChain.wagmiChain!;
  const wrongNetwork = isConnected && chainId !== activeWagmiChain.id;
  const canStake = isConnected && loopConnected && !!partyId && !switchPending;
  const evmDetail = address
    ? `${address.slice(0, 6)}...${address.slice(-4)} - ${
        balance ? Number(formatEther(balance.value)).toFixed(4) : "0.0000"
      } ${activeChain.symbol}`
    : "connect wallet";

  function openFlow() {
    if (canStake) setOpen(true);
  }

  return (
    <div className="space-y-12 py-8">
      <header>
        <p className="font-mono text-xxs uppercase tracking-widest text-amber-bright mb-4">
          § 01 · stake
        </p>
        <h1 className="font-display text-5xl mb-3">
          Delegate {activeChain.symbol}
        </h1>
        <p className="text-ink-300 max-w-2xl">
          Your wallet signs the buyVoucher transaction on {activeChain.name}.
          Simultaneously a StakingRequest is created on Canton. When our
          orchestrator observes the ShareMinted event, it transitions the
          position to Bonded and emits a FeaturedAppActivityMarker.
        </p>
      </header>

      {/* slot: A2 AdvisorBox */}

      <div className="max-w-3xl space-y-6">
        <button
          onClick={openFlow}
          disabled={!canStake}
          className="w-full bg-amber px-8 py-6 font-mono text-sm font-semibold uppercase tracking-wider text-ink-950 transition-colors hover:bg-amber-bright disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
        >
          Open stake flow
        </button>

        <Card padding={24} className="space-y-6">
          <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">
            connection readiness
          </div>
          <TraceRow
            index="01"
            label="EVM wallet"
            status={isConnected ? "done" : "pending"}
            detail={evmDetail}
          />
          <TraceRow
            index="02"
            label="Loop wallet"
            status={loopConnected && partyId ? "done" : "pending"}
            detail={
              partyId
                ? `party - ${partyId.slice(0, 24)}...`
                : "connect Loop identity"
            }
          />
          <TraceRow
            index="03"
            label={activeChain.name}
            status={
              !isConnected
                ? "pending"
                : wrongNetwork || switchPending
                ? "running"
                : "done"
            }
            detail={
              switchPending
                ? "switching"
                : wrongNetwork
                ? "will switch during confirmation"
                : "ready"
            }
            accent
          />
        </Card>
      </div>

      <StakeFlowModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
