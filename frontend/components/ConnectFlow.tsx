"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { Card } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import { useLoopWallet } from "@/lib/loop-wallet";

type ConnectStep = "intro" | "loop" | "loop-passkey" | "evm" | "success";

function connectorLabel(connector: { name: string; uid: string }) {
  const name = connector.name.toLowerCase();
  if (name.includes("walletconnect") || name.includes("wc")) return "Ledger / WalletConnect";
  if (name.includes("meta mask") || name.includes("metamask")) return "MetaMask";
  if (name.includes("injected") || name.includes("browser")) return "Browser Wallet";
  return connector.name;
}

function FeatureCard({ label, sub, mark }: { label: string; sub: string; mark: string }) {
  return (
    <Card padding={14} className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-neon/10 font-mono text-xs text-neon">
        {mark}
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium text-ink-100">{label}</div>
        <div className="font-mono text-xxs text-ink-400">{sub}</div>
      </div>
      <StatusDot status="active" />
    </Card>
  );
}

export function ConnectFlow() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const {
    connect: connectLoop,
    isConnected: loopConnected,
    partyId,
    isConnecting: loopConnecting,
  } = useLoopWallet();
  const [step, setStep] = useState<ConnectStep>("intro");

  useEffect(() => {
    if (loopConnected && partyId && isConnected) setStep("success");
    else if (step === "loop-passkey" && loopConnected && partyId) {
      const id = window.setTimeout(() => setStep("evm"), 1500);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isConnected, loopConnected, partyId, step]);

  function startLoopPasskey() {
    setStep("loop-passkey");
    void connectLoop(undefined, address);
  }

  return (
    <div className="mx-auto flex min-h-[68vh] max-w-lg items-center py-8">
      <div className="w-full">
        <div className="mb-9 flex items-center gap-3">
          <span
            className="grid h-9 w-9 place-items-center bg-neon font-mono text-xs font-bold text-neon-text"
            style={{
              clipPath: "polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%)",
            }}
          >
            CS
          </span>
          <div className="font-display text-2xl italic">CantonStake</div>
        </div>

        {step === "intro" && (
          <div>
            <h1 className="font-display text-5xl leading-none">
              Self-custodial
              <br />
              <span className="text-neon">Canton-native staking.</span>
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-ink-300">
              Stake on Polygon. Earn native APY plus Canton Coin bonus rewards
              delivered every 10 minutes — no claim step.
            </p>
            <div className="mt-8 space-y-2">
              <FeatureCard label="Loop wallet for Canton identity" sub="Passkey login — no seed phrase" mark="LO" />
              <FeatureCard label="EVM wallet for Polygon settlement" sub="MetaMask or WalletConnect signing" mark="EV" />
              <FeatureCard label="75/25 beneficiary split" sub="CC distributed every 10 min" mark="CC" />
            </div>
            <button
              onClick={() => setStep("loop")}
              className="mt-7 w-full bg-neon px-5 py-4 font-mono text-xs font-semibold uppercase tracking-wider text-neon-text hover:bg-neon/90"
            >
              Connect Loop wallet →
            </button>
            <div className="mt-5 text-center font-mono text-xxs uppercase tracking-widest text-ink-500">
              CIP-103 · NON-CUSTODIAL · v0.4.2-beta
            </div>
          </div>
        )}

        {step === "loop" && (
          <Card padding={32} className="text-center">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-neon/10 font-mono text-neon">
              LOOP
            </div>
            <h2 className="font-display text-3xl">Connect Loop</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
              Loop hosts your Canton party so you can receive CC rewards and
              identify across Canton dApps.
            </p>
            <div className="my-6 space-y-2 border border-ink-700 bg-ink-950/40 p-4 text-left font-mono text-xs text-ink-400">
              <InfoRow label="Provider" value="FiveNorth · Loop" />
              <InfoRow label="Standard" value="CIP-103" />
              <InfoRow label="Permissions" value="Read party · Receive CC" />
            </div>
            <button
              onClick={startLoopPasskey}
              disabled={loopConnecting}
              className="w-full bg-neon px-5 py-4 font-mono text-xs font-semibold uppercase tracking-wider text-neon-text hover:bg-neon/90 disabled:opacity-50"
            >
              {loopConnecting ? "Connecting..." : "Continue with passkey"}
            </button>
            <button
              onClick={() => setStep("intro")}
              className="mt-4 font-mono text-xs uppercase tracking-wider text-ink-400 hover:text-ink-100"
            >
              ← Back
            </button>
          </Card>
        )}

        {step === "loop-passkey" && (
          <Card padding={32} className="text-center">
            <div className="mx-auto mb-6 h-20 w-20 animate-spin rounded-full border-4 border-ink-700 border-t-neon" />
            <h2 className="font-display text-3xl">Authenticating with passkey</h2>
            <p className="mt-2 font-mono text-xs text-ink-400">
              Touch ID · loop.fivenorth.io
            </p>
          </Card>
        )}

        {step === "evm" && (
          <Card padding={32}>
            <div className="mb-5 flex items-center gap-2 font-mono text-xs text-neon">
              <StatusDot status="active" />
              Loop connected · {partyId ? `${partyId.slice(0, 16)}...` : "party ready"}
            </div>
            <h2 className="font-display text-3xl">Connect EVM wallet</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-400">
              Approve in your wallet to sign Polygon settlement transactions.
            </p>
            <div className="mt-6 space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => connect({ connector })}
                  disabled={isPending}
                  className="flex w-full items-center justify-between border border-ink-700 bg-ink-900/40 px-4 py-3 text-left hover:bg-ink-800/40 disabled:opacity-50"
                >
                  <span className="text-sm text-ink-100">{connectorLabel(connector)}</span>
                  <span className="font-mono text-xxs uppercase tracking-widest text-ink-400">
                    {connector.name}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {step === "success" && (
          <Card padding={32} className="text-center">
            <svg className="mx-auto mb-5 h-14 w-14 text-neon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2 className="font-display text-3xl">You're set.</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-400">
              Loop identity and EVM settlement wallet are connected.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-7 w-full bg-neon px-5 py-4 font-mono text-xs font-semibold uppercase tracking-wider text-neon-text hover:bg-neon/90"
            >
              Open dashboard
            </button>
          </Card>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="text-ink-100">{value}</span>
    </div>
  );
}
