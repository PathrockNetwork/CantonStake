"use client";

import { useEffect, useState } from "react";
import { useAccount, useBalance, useChainId, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { polygonAmoy } from "wagmi/chains";
import { formatEther, parseEther, parseGwei } from "viem";
import { mockValidatorShareAbi } from "@/lib/abi";
import { createStakingRequest } from "@/lib/api";
import { useLoopWallet } from "@/lib/loop-wallet";
import { Modal } from "@/components/Modal";
import { TraceRow } from "@/components/TraceRow";

type Step = "amount" | "validator" | "review" | "broadcasting" | "success";
type Validator = { name: string; address: string; apr: number; uptimePct: number; riskScore: number; commission: number };
type StakeFlowModalProps = { open: boolean; onClose: () => void; presetAmount?: string; presetValidator?: string };

const VALIDATOR_ADDRESS = process.env.NEXT_PUBLIC_MOCK_VALIDATOR_SHARE as `0x${string}`;
const STEPS: Step[] = ["amount", "validator", "review", "broadcasting", "success"];
const VALIDATORS: Validator[] = [
  { address: "0x5a10000000000000000000000000000000000001", name: "Stakefish", apr: 7.8, uptimePct: 99.95, riskScore: 1, commission: 5 },
  { address: "0xf190000000000000000000000000000000000002", name: "Figment", apr: 8.2, uptimePct: 99.7, riskScore: 2, commission: 6 },
  { address: "0xe3e000000000000000000000000000000000003", name: "Everstake", apr: 8.5, uptimePct: 99.3, riskScore: 3, commission: 7 },
  { address: "0x0200000000000000000000000000000000000004", name: "P2P", apr: 9.1, uptimePct: 98.8, riskScore: 4, commission: 8 },
  { address: "0x9e1d000000000000000000000000000000000005", name: "YieldMax", apr: 10.4, uptimePct: 97.5, riskScore: 5, commission: 10 },
];

function short(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function presetChoice(address: string): Validator {
  return VALIDATORS.find((item) => item.address.toLowerCase() === address.toLowerCase()) ?? { address, name: "Advisor pick", apr: 8, uptimePct: 99.9, riskScore: 2, commission: 5 };
}

export function StakeFlowModal({ open, onClose, presetAmount, presetValidator }: StakeFlowModalProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { partyId } = useLoopWallet();
  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState(presetAmount ?? "1.0");
  const [validator, setValidator] = useState<Validator | null>(null);
  const [cantonStage, setCantonStage] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [cantonTxId, setCantonTxId] = useState<string | null>(null);
  const [cantonError, setCantonError] = useState<string | null>(null);
  const { data: hash, error: writeError, isPending: writePending, writeContract, reset } = useWriteContract();
  const { isLoading: evmConfirming, isSuccess: evmConfirmed } = useWaitForTransactionReceipt({ hash });
  const amountNumber = Number.parseFloat(amount) || 0;
  const balancePol = balance ? Number(formatEther(balance.value)) : 0;
  const recommendedUptime = Math.max(...VALIDATORS.map((item) => item.uptimePct));
  const stepIndex = STEPS.indexOf(step);

  useEffect(() => {
    if (!open) return;
    setAmount(presetAmount ?? "1.0");
    setValidator(presetValidator ? presetChoice(presetValidator) : null);
    setStep(presetValidator ? "review" : "amount");
    setCantonStage("idle");
    setCantonTxId(null);
    setCantonError(null);
    reset();
  }, [open, presetAmount, presetValidator, reset]);

  useEffect(() => {
    if (open && step === "broadcasting" && evmConfirmed) setStep("success");
  }, [evmConfirmed, open, step]);

  function setBalancePercent(percent: number) {
    if (balancePol > 0) setAmount((balancePol * percent).toFixed(4));
  }

  async function onStake() {
    if (!address) return;
    try {
      setCantonStage("creating");
      setCantonError(null);
      if (chainId !== polygonAmoy.id) await switchChainAsync({ chainId: polygonAmoy.id });
      const { transactionId } = await createStakingRequest({ evmAddress: address, amountPol: amount, delegator: partyId! });
      setCantonTxId(transactionId);
      setCantonStage("created");
      const amountWei = parseEther(amount);
      writeContract({ address: VALIDATOR_ADDRESS, abi: mockValidatorShareAbi, functionName: "buyVoucher", args: [amountWei, amountWei], value: amountWei, maxPriorityFeePerGas: parseGwei("25"), maxFeePerGas: parseGwei("100") });
    } catch (err) {
      setCantonStage("error");
      setCantonError(err instanceof Error ? err.message : String(err));
    }
  }

  const primary = "bg-amber font-mono font-semibold uppercase tracking-wider text-ink-950 hover:bg-amber-bright disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400";
  const ghost = "hairline font-mono uppercase tracking-wider text-ink-300 hover:text-ink-100";

  return (
    <Modal open={open} onClose={onClose} width={620}>
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
        <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">STAKE &middot; STEP {stepIndex + 1} / 5</div>
        <button onClick={onClose} className="px-2 py-1 text-ink-400 hover:text-ink-100" aria-label="Close">×</button>
      </div>
      <div className="h-0.5 bg-ink-700"><div className="h-full bg-amber-bright transition-[width] duration-300" style={{ width: `${((stepIndex + 1) / 5) * 100}%` }} /></div>
      <div className="min-h-[360px] p-6">
        {step === "amount" && (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block font-mono text-xxs uppercase tracking-widest text-ink-400">amount</label>
              <div className="flex items-baseline gap-3">
                <input type="number" step="0.1" min="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full border-b border-ink-600 bg-transparent pb-2 font-display text-6xl tabular text-ink-100 outline-none focus:border-amber-bright" />
                <span className="font-mono text-lg text-ink-300">POL</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-ink-400">
                <span>wallet balance &middot; {balancePol.toFixed(4)} POL</span>
                <button onClick={() => setBalancePercent(0.9)} className="uppercase tracking-wider text-amber-bright hover:text-amber-glow">MAX</button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {([["25%", 0.25], ["50%", 0.5], ["75%", 0.75], ["MAX", 0.9]] as const).map(([label, percent]) => (
                  <button key={label} onClick={() => setBalancePercent(percent)} className="hairline px-3 py-1.5 font-mono text-xxs uppercase tracking-widest text-ink-300 hover:text-amber-bright">{label}</button>
                ))}
              </div>
            </div>
            <div className="border border-amber/30 bg-amber/10 p-4 text-sm text-ink-300">
              <div className="mb-1 font-mono text-xxs uppercase tracking-widest text-amber-bright">estimated annual yield</div>
              <span className="font-mono font-semibold text-amber-bright">+{(amountNumber * 0.08).toFixed(3)} POL</span>
              <span className="mx-2 text-ink-500">&middot;</span>
              <span className="font-mono font-semibold text-amber-bright">+~marker CC</span>
            </div>
            <button onClick={() => setStep("validator")} disabled={amountNumber < 0.01} className={`w-full py-4 text-sm ${primary}`}>Continue</button>
          </div>
        )}

        {step === "validator" && (
          <div className="space-y-4">
            <div className="space-y-2">
              {VALIDATORS.map((item) => (
                <button key={item.address} onClick={() => { setValidator(item); setStep("review"); }} className={`w-full border p-4 text-left transition-colors ${validator?.address === item.address ? "border-amber bg-amber/10" : "border-ink-700 bg-ink-900/40 hover:bg-ink-800/40"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-ink-100">
                        {item.name}
                        {item.uptimePct === recommendedUptime && <span className="chip border-transparent text-amber-bright">RECOMMENDED</span>}
                      </div>
                      <div className="mt-1 font-mono text-xxs text-ink-400">{short(item.address)} &middot; APR {item.apr.toFixed(1)}% &middot; risk {item.riskScore}</div>
                    </div>
                    <div className="text-right font-mono text-xxs text-ink-300"><div>{item.commission}% commission</div><div className="mt-1 text-amber-bright">{item.uptimePct.toFixed(2)}% uptime</div></div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setStep("amount")} className="font-mono text-xs uppercase tracking-wider text-ink-400 hover:text-ink-100">Back</button>
          </div>
        )}

        {step === "review" && validator && (
          <div className="space-y-5">
            <div className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 text-sm">
              {([["Action", "buyVoucher() · delegate"], ["Amount", `${amount || "0"} POL`], ["Validator name", validator.name], ["Validator address", validator.address], ["Network fee", "~$0.04"], ["Unbonding", "21 days"]] as const).map(([label, value]) => (
                <div key={label} className="contents"><div className="text-ink-400">{label}</div><div className="max-w-[320px] break-all text-right font-mono text-ink-100">{value}</div></div>
              ))}
            </div>
            <div className="border border-dashed border-ink-600 p-4 text-sm text-ink-300">
              <div className="font-mono text-xxs uppercase tracking-widest text-amber-bright">DAML CONTRACT</div>
              <div className="mt-2 font-mono text-xs text-ink-100">StakingPosition &middot; ActivityMarker tagged</div>
              <div className="mt-2">Beneficiary split: 75% your Loop wallet / 25% app treasury</div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep("validator")} className={`flex-1 py-3 text-xs ${ghost}`}>Back</button>
              <button onClick={() => { setStep("broadcasting"); void onStake(); }} disabled={writePending || switchPending || evmConfirming || amountNumber < 0.01} className={`flex-[2] py-3 text-xs ${primary}`}>Confirm stake</button>
            </div>
          </div>
        )}

        {step === "broadcasting" && (
          <div className="space-y-6">
            <div className="text-right font-mono text-xxs uppercase tracking-widest text-ink-500">Esc to close</div>
            <TraceRow index="01" label="Create StakingRequest (Canton)" status={cantonStage === "idle" ? "pending" : cantonStage === "creating" ? "running" : cantonStage === "created" ? "done" : "error"} detail={cantonTxId ? `tx · ${cantonTxId.slice(0, 16)}...` : cantonStage === "error" ? cantonError ?? "failed" : "waiting"} />
            <TraceRow index="02" label="buyVoucher (Polygon Amoy)" status={!hash ? "pending" : evmConfirming ? "running" : evmConfirmed ? "done" : writeError ? "error" : "running"} detail={hash ? `tx · ${hash.slice(0, 16)}...` : writeError ? writeError.message.slice(0, 60) : "waiting"} />
            <TraceRow index="03" label="Orchestrator catches ShareMinted" status={evmConfirmed ? "running" : "pending"} detail="viem event watcher" />
            <TraceRow index="04" label="StakingRequest_Accept (Daml)" status={evmConfirmed ? "running" : "pending"} detail="emits FeaturedAppActivityMarker" accent />
            {(cantonStage === "error" || writeError) && <div className="hairline border-danger/40 p-3 font-mono text-xs text-danger">{cantonError ?? writeError?.message}</div>}
          </div>
        )}

        {step === "success" && (
          <div className="space-y-6 py-4 text-center">
            <svg className="mx-auto h-14 w-14 animate-pulse text-success" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div><h2 className="font-display text-3xl">Stake confirmed</h2><p className="mt-2 text-sm text-ink-400">CC rewards start flowing in the next 10-minute round.</p></div>
            <div className="hairline grid grid-cols-[90px_1fr] gap-3 p-4 text-left text-sm"><div className="text-ink-400">Tx hash</div><a href={`https://amoy.polygonscan.com/tx/${hash}`} target="_blank" rel="noreferrer" className="break-all font-mono text-amber-bright hover:text-amber-glow">{hash}</a></div>
            <button onClick={onClose} className={`w-full py-4 text-sm ${primary}`}>Done</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
