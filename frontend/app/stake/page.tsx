"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther } from "viem";
import { IconArrowRight } from "@/components/icons";
import { Banner } from "@/components/primitives/Banner";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { MarkerSpark } from "@/components/primitives/MarkerSpark";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { emitTrace } from "@/components/trace/useTraceLog";
import { createStakingRequest } from "@/lib/api";
import { polygonChain } from "@/lib/chains";
import { adapterFor } from "@/lib/chains/index";
import { fmt, fmtUsd } from "@/lib/format";
import { useLoopWallet } from "@/lib/loop-wallet";
import { tokens } from "@/lib/tokens";

/**
 * StakeFlow — ported from handoff/prototype/redesign/screens.jsx (`StakeFlow`).
 *
 * The prototype runs a pure simulation. This port drives the same five
 * visible stages off REAL wagmi + backend state:
 *
 *   01 StakingRequest_Create          → backend createStakingRequest()
 *   02 MockValidatorShare.buyVoucher  → wagmi writeContract(...)
 *   03 ShareMinted                    → useWaitForTransactionReceipt()
 *   04 StakingRequest_Accept          → orchestrator (fires after evm confirms)
 *   05 FeaturedAppActivityMarker      → animation only; no on-chain signal
 *                                       to listen for at this layer
 *
 * Stages 4 and 5 are visual simulations bolted on top of the real
 * confirmation event — the actual Daml accept + marker emission happen
 * server-side in the orchestrator and aren't observable from the browser.
 *
 * If the wagmi write fails (rejected, wrong network, RPC error), step
 * resets and an error banner replaces the wrong-network banner.
 */
const STAGES = [
  {
    code: "01 StakingRequest_Create",
    detail: "Canton request created · partyId=...",
    kind: "CANTON" as const,
    tag: "info" as const,
  },
  {
    code: "02 MockValidatorShare.buyVoucher()",
    detail: "Polygon delegation submitted",
    kind: "POLYGON" as const,
    tag: "idle" as const,
  },
  {
    code: "03 ShareMinted",
    detail: "Validator share received",
    kind: "POLYGON" as const,
    tag: "idle" as const,
  },
  {
    code: "04 StakingRequest_Accept",
    detail: "Canton position bonded · status=Bonded",
    kind: "CANTON" as const,
    tag: "info" as const,
  },
  {
    code: "05 FeaturedAppActivityMarker",
    detail: "Bond marker emitted · weight=0.21 USD · split=75/25",
    kind: "MARKER" as const,
    tag: "success" as const,
  },
];

const CTA_LABELS = [
  "Bond {amount} POL",
  "Awaiting wallet signature…",
  "Confirming Polygon tx…",
  "Emitting Canton marker…",
  "Bonded · marker emitted",
];

type LogEntry = {
  code: string;
  detail: string;
  t: number;
  kind: "CANTON" | "POLYGON" | "MARKER";
};

export default function StakePage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { partyId, isConnected: loopConnected } = useLoopWallet();
  const polygon = polygonChain();
  const adapter = adapterFor(polygon.id);
  const polygonId = polygon.wagmiChain!.id;
  const wrongNetwork = isConnected && chainId !== polygonId;

  const [amount, setAmount] = useState("0.50");
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showSpark, setShowSpark] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: hash,
    isPending: sendPending,
    sendTransaction,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();
  const {
    isLoading: confirming,
    isSuccess: confirmed,
  } = useWaitForTransactionReceipt({ hash });

  // Promote simulation step when wagmi state advances
  useEffect(() => {
    if (sendPending && step < 2) advance(2);
  }, [sendPending, step]);

  useEffect(() => {
    if (hash && !confirming && !confirmed && step < 2) advance(2);
    if (confirming && step < 3) advance(3);
    if (confirmed && step < 4) {
      advance(4);
      // Stage 5 — visual marker emission. Server-side orchestrator
      // emits the actual marker; we don't have a browser-observable
      // signal so this is a fixed delay.
      const id = window.setTimeout(() => {
        advance(5);
        setShowSpark(true);
        window.setTimeout(() => setShowSpark(false), 900);
      }, 900);
      return () => window.clearTimeout(id);
    }
  }, [hash, confirming, confirmed, step]);

  useEffect(() => {
    if (sendError) {
      setError(sendError.message);
      setStep(0);
      setShowSpark(false);
    }
  }, [sendError]);

  function advance(target: 1 | 2 | 3 | 4 | 5) {
    const idx = target - 1;
    const stage = STAGES[idx];
    setLog((prev) => [...prev, { ...stage, t: Date.now() }]);
    setStep(target);
    emitTrace(stage);
  }

  async function handleStake() {
    if (step > 0 && step < 5) return;
    if (!address || !partyId) {
      setError("Connect both Loop and EVM wallets to stake.");
      return;
    }

    // Reset visuals
    setLog([]);
    setStep(0);
    setShowSpark(false);
    setError(null);
    resetSend();

    try {
      // Stage 01 — Canton request created (real backend call)
      advance(1);
      await createStakingRequest({
        evmAddress: address,
        amountPol: amount,
        delegator: partyId,
      });

      // Switch network if needed
      if (chainId !== polygonId) {
        await switchChainAsync({ chainId: polygonId });
      }

      // Stage 02 — wagmi write (advance happens in effect when isPending flips)
      const [validator] = await adapter.getValidators();
      if (!validator) {
        throw new Error("No Polygon validator is available for staking.");
      }

      const amountWei = parseEther(amount);
      const tx = await adapter.buildDelegateTx({
        validator: validator.address,
        amount: amountWei,
        delegator: address,
      });
      if (tx.kind !== "evm") {
        throw new Error(`Unexpected Polygon tx kind: ${tx.kind}`);
      }

      sendTransaction({
        chainId: polygonId,
        to: tx.to,
        data: tx.data,
        value: tx.value ?? 0n,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(0);
    }
  }

  const ctaLabel =
    step === 0
      ? CTA_LABELS[0].replace("{amount}", amount)
      : CTA_LABELS[step] ?? CTA_LABELS[0];
  const expectedCC = (parseFloat(amount || "0") * 0.42 * 1.2).toFixed(2);
  const usdValue = parseFloat(amount || "0") * 0.42;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 22px 80px" }}>
      <SectionLabel>§ STAKE</SectionLabel>
      <h1
        className="display"
        style={{ fontSize: 42, margin: "4px 0 14px", color: tokens.ink[100] }}
      >
        Delegate POL.
      </h1>
      <p
        className="mono"
        style={{
          fontSize: 11.5,
          color: tokens.ink[400],
          letterSpacing: ".04em",
          marginBottom: 18,
          maxWidth: 680,
        }}
      >
        Sign the staking transaction from your own wallet. CantonStake records
        the lifecycle and emits a Canton activity marker after bonding. Custody
        never leaves your wallet.
      </p>

      {error && (
        <Banner
          tone="error"
          kind="POLYGON TX FAILED"
          message={error}
          action={
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(0);
              }}
            >
              Try again
            </Btn>
          }
        />
      )}
      {!error && wrongNetwork && (
        <Banner
          tone="warn"
          kind="WRONG NETWORK"
          message={`Wallet on chain ${chainId}. Switch your EVM wallet to Polygon Amoy to use this demo validator.`}
          action={
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => switchChainAsync({ chainId: polygonId })}
              disabled={switchPending}
            >
              Switch to Polygon Amoy
            </Btn>
          }
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr",
          gap: 24,
        }}
      >
        {/* Form */}
        <Card padding={0}>
          <div
            style={{
              padding: "18px 22px",
              borderBottom: `1px solid ${tokens.hairline}`,
            }}
          >
            <SectionLabel>Staking form</SectionLabel>
          </div>
          <div
            style={{
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div>
              <SectionLabel style={{ marginBottom: 8 }}>Network</SectionLabel>
              <div
                style={{
                  padding: "12px 14px",
                  border: `1px solid ${tokens.hairline}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div className="mono" style={{ fontSize: 13, color: tokens.ink[100] }}>
                    {polygon.name}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: tokens.ink[400] }}>
                    Testnet · Chain id {polygonId} · {polygon.symbol}
                  </div>
                </div>
                <Chip color={tokens.amberBright}>DEMO</Chip>
              </div>
            </div>

            <div>
              <SectionLabel style={{ marginBottom: 8 }}>Validator</SectionLabel>
              <div
                style={{
                  padding: "12px 14px",
                  border: `1px solid ${tokens.hairline}`,
                }}
              >
                <div className="mono" style={{ fontSize: 13, color: tokens.ink[100] }}>
                  MockValidatorShare
                </div>
                <div className="mono" style={{ fontSize: 10, color: tokens.ink[400] }}>
                  {polygon.validatorContract
                    ? `${polygon.validatorContract.slice(0, 10)}...${polygon.validatorContract.slice(-6)}`
                    : "0x..."}
                  {" · Demo contract matching the production ValidatorShare interface"}
                </div>
              </div>
            </div>

            <div>
              <SectionLabel style={{ marginBottom: 8 }}>Amount</SectionLabel>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  padding: "12px 14px",
                  border: `1px solid ${tokens.hairline}`,
                  gap: 8,
                }}
              >
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="display tabular"
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: tokens.ink[100],
                    fontSize: 36,
                    width: "100%",
                  }}
                  inputMode="decimal"
                  disabled={step > 0 && step < 5}
                />
                <span className="mono" style={{ fontSize: 13, color: tokens.ink[400] }}>
                  {polygon.symbol}
                </span>
              </div>
              <div
                className="mono"
                style={{ fontSize: 10, color: tokens.ink[400], marginTop: 6 }}
              >
                Estimated value: {fmtUsd(usdValue)}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                paddingTop: 6,
              }}
            >
              <div>
                <SectionLabel>Native APY</SectionLabel>
                <div
                  className="display tabular"
                  style={{ fontSize: 24, color: tokens.ink[100] }}
                >
                  7.0%
                </div>
              </div>
              <div>
                <SectionLabel>CC bonus</SectionLabel>
                <div
                  className="display tabular"
                  style={{ fontSize: 24, color: tokens.cc }}
                >
                  2.4%
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "12px 14px",
                border: `1px solid ${tokens.hairline}`,
                background: "rgba(255,255,255,.015)",
              }}
            >
              <SectionLabel style={{ marginBottom: 8 }}>
                Transaction summary
              </SectionLabel>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "6px 16px",
                  fontSize: 11,
                }}
              >
                <span className="mono" style={{ color: tokens.ink[300] }}>
                  You stake
                </span>
                <span className="mono tabular" style={{ color: tokens.ink[100] }}>
                  {amount} {polygon.symbol}
                </span>
                <span className="mono" style={{ color: tokens.ink[300] }}>
                  Network
                </span>
                <span className="mono" style={{ color: tokens.ink[100] }}>
                  {polygon.name}
                </span>
                <span className="mono" style={{ color: tokens.ink[300] }}>
                  Validator
                </span>
                <span className="mono" style={{ color: tokens.ink[100] }}>
                  MockValidatorShare
                </span>
                <span className="mono" style={{ color: tokens.ink[300] }}>
                  Custody
                </span>
                <span className="mono" style={{ color: tokens.ink[100] }}>
                  Your wallet
                </span>
                <span className="mono" style={{ color: tokens.ink[300] }}>
                  Canton action
                </span>
                <span className="mono" style={{ color: tokens.neon }}>
                  Bond marker emitted
                </span>
                <span className="mono" style={{ color: tokens.ink[300] }}>
                  CC split
                </span>
                <span className="mono" style={{ color: tokens.ink[200] }}>
                  75% user · 25% treasury
                </span>
                <span className="mono" style={{ color: tokens.ink[300] }}>
                  Expected CC · next round
                </span>
                <span className="mono tabular" style={{ color: tokens.cc }}>
                  ~{expectedCC} CC
                </span>
              </div>
            </div>

            <Btn
              onClick={handleStake}
              full
              size="lg"
              iconRight={
                step === 0 || step === 5 ? <IconArrowRight /> : undefined
              }
              disabled={
                (step > 0 && step < 5) ||
                !isConnected ||
                !loopConnected ||
                !partyId
              }
            >
              {!isConnected || !loopConnected || !partyId
                ? "Connect both wallets to stake"
                : ctaLabel}
            </Btn>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: tokens.ink[500],
                textAlign: "center",
                letterSpacing: ".04em",
              }}
            >
              Your wallet signs · CantonStake observes · The ledger remembers
            </div>
          </div>
        </Card>

        {/* Live trace terminal */}
        <Card padding={0} style={{ position: "relative", overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: `1px solid ${tokens.hairline}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", gap: 5 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: tokens.danger,
                    opacity: 0.6,
                  }}
                />
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: tokens.warning,
                    opacity: 0.6,
                  }}
                />
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: tokens.success,
                    opacity: 0.6,
                  }}
                />
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  color: tokens.ink[400],
                  letterSpacing: ".08em",
                }}
              >
                cantonstake://trace/live
              </span>
            </div>
            <Chip
              color={
                step > 0 && step < 5
                  ? tokens.warning
                  : step === 5
                  ? tokens.neon
                  : tokens.ink[400]
              }
              dot={step > 0}
            >
              {step === 0 ? "IDLE" : step < 5 ? "RUNNING" : "OK"}
            </Chip>
          </div>
          <div
            style={{
              padding: "18px 18px 24px",
              background: "#08080a",
              minHeight: 380,
              fontFamily: "JetBrains Mono, ui-monospace, monospace",
              fontSize: 11.5,
              lineHeight: 1.7,
              color: tokens.ink[300],
              position: "relative",
            }}
          >
            <div style={{ color: tokens.ink[500] }}>
              $ cantonstake bond --network polygon-amoy --amount {amount} POL
            </div>
            <div style={{ color: tokens.ink[500], marginBottom: 10 }}>
              $ awaiting wallet signature…
            </div>
            {log.map((l, i) => (
              <div
                key={`${l.code}-${l.t}`}
                style={{ animation: "fade-up 240ms ease", marginBottom: 6 }}
              >
                <span
                  style={{ color: i === 4 ? tokens.neon : tokens.amberBright }}
                >
                  ▸
                </span>
                <span
                  style={{
                    color: i === 4 ? tokens.neon : tokens.ink[100],
                    marginLeft: 8,
                  }}
                >
                  {l.code}
                </span>
                <div
                  style={{
                    color: tokens.ink[400],
                    marginLeft: 18,
                    fontSize: 10.5,
                  }}
                >
                  {l.detail}
                </div>
              </div>
            ))}
            {step > 0 && step < 5 && (
              <div style={{ color: tokens.ink[500] }}>
                ▸{" "}
                <span
                  style={{
                    display: "inline-block",
                    width: 7,
                    height: 13,
                    background: tokens.neon,
                    verticalAlign: "middle",
                    animation: "blink-caret 1s steps(1) infinite",
                  }}
                />
              </div>
            )}
            {step === 5 && (
              <div
                style={{
                  marginTop: 18,
                  padding: "14px 16px",
                  border: `1px solid ${tokens.neonDim}`,
                  background: `linear-gradient(180deg, ${tokens.neonDim}, transparent)`,
                  position: "relative",
                }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: tokens.neon,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                  }}
                >
                  ● Marker emitted
                </div>
                <div
                  className="display"
                  style={{ fontSize: 22, color: tokens.ink[100], marginTop: 4 }}
                >
                  Bond · {fmt(parseFloat(amount || "0") * 0.42, 2)} USD
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: tokens.ink[400],
                    marginTop: 4,
                    lineHeight: 1.6,
                  }}
                >
                  Beneficiary split: 75% user · 25% treasury
                  <br />
                  Next CC round closes soon — reward arrives on-ledger.
                </div>
                <MarkerSpark active={showSpark} />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
