"use client";

import { useEffect, useState } from "react";
import { useAccount, useBalance, useChainId, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatEther, parseEther, parseGwei } from "viem";
import { mockValidatorShareAbi } from "@/lib/abi";
import { createStakingRequest } from "@/lib/api";
import { chainById, liveChains, polygonChain, type ChainConfig } from "@/lib/chains";
import { useLoopWallet } from "@/lib/loop-wallet";
import { validatorsForChain, type ValidatorRow } from "@/lib/validators";
import { Modal } from "@/components/Modal";
import { StakeChainStep } from "@/components/StakeChainStep";
import { StakeValidatorStep } from "@/components/StakeValidatorStep";
import { TraceRow } from "@/components/TraceRow";

type Step = "chain" | "amount" | "validator" | "review" | "broadcasting" | "success";
type StakeFlowModalProps = {
  open: boolean;
  onClose: () => void;
  presetAmount?: string;
  presetValidator?: string;
  presetChain?: string;
};

const STEPS: Step[] = ["chain", "amount", "validator", "review", "broadcasting", "success"];

function initialChain(presetChain?: string): { chain: ChainConfig | null; step: Step } {
  const live = liveChains();
  const preset = presetChain ? chainById(presetChain) : undefined;
  if (preset?.phase === "live") return { chain: preset, step: "amount" };
  if (presetChain) return { chain: null, step: "chain" };
  if (live.length === 1) return { chain: live[0], step: "amount" };
  return { chain: null, step: "chain" };
}

function presetChoice(address: string, chainId: string): ValidatorRow {
  return (
    validatorsForChain(chainId).find(
      (item) => item.address.toLowerCase() === address.toLowerCase()
    ) ?? {
      address: address as `0x${string}`,
      name: "Advisor pick",
      apr: polygonChain().apy,
      uptime: 99.9,
      commission: 5,
    }
  );
}

export function StakeFlowModal({
  open,
  onClose,
  presetAmount,
  presetValidator,
  presetChain,
}: StakeFlowModalProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { partyId } = useLoopWallet();
  const [step, setStep] = useState<Step>("amount");
  const [chain, setChain] = useState<ChainConfig | null>(polygonChain());
  const [amount, setAmount] = useState(presetAmount ?? "1.0");
  const [validator, setValidator] = useState<ValidatorRow | null>(null);
  const [cantonStage, setCantonStage] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [cantonTxId, setCantonTxId] = useState<string | null>(null);
  const [cantonError, setCantonError] = useState<string | null>(null);
  const { data: hash, error: writeError, isPending: writePending, writeContract, reset } = useWriteContract();
  const { isLoading: evmConfirming, isSuccess: evmConfirmed } = useWaitForTransactionReceipt({ hash });
  const currentChain = chain ?? polygonChain();
  const validators = chain ? validatorsForChain(chain.id) : [];
  const amountNumber = Number.parseFloat(amount) || 0;
  const balanceNative = balance ? Number(formatEther(balance.value)) : 0;
  const stepIndex = STEPS.indexOf(step);
  const canBackToChain = liveChains().length >= 2;
  const primary = "bg-neon font-mono font-semibold uppercase tracking-wider text-neon-text hover:bg-neon/90 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400";
  const ghost = "hairline font-mono uppercase tracking-wider text-ink-300 hover:text-ink-100";

  useEffect(() => {
    if (!open) return;
    const initial = initialChain(presetChain);
    const nextValidator =
      presetValidator && initial.chain
        ? presetChoice(presetValidator, initial.chain.id)
        : null;
    setChain(initial.chain);
    setAmount(presetAmount ?? "1.0");
    setValidator(nextValidator);
    setStep(nextValidator ? "review" : initial.step);
    setCantonStage("idle");
    setCantonTxId(null);
    setCantonError(null);
    reset();
  }, [open, presetAmount, presetChain, presetValidator, reset]);

  useEffect(() => {
    if (open && step === "broadcasting" && evmConfirmed) setStep("success");
  }, [evmConfirmed, open, step]);

  function setBalancePercent(percent: number) {
    if (balanceNative > 0) setAmount((balanceNative * percent).toFixed(4));
  }

  async function onStake() {
    if (!address || !partyId || !chain) return;
    try {
      setCantonStage("creating");
      setCantonError(null);
      if (!chain.wagmiChain || !chain.validatorContract) {
        throw new Error("Selected chain is not wired for live staking yet");
      }
      if (chainId !== chain.wagmiChain.id) {
        await switchChainAsync({ chainId: chain.wagmiChain.id });
      }
      const { transactionId } = await createStakingRequest({
        evmAddress: address,
        amountPol: amount,
        delegator: partyId,
      });
      setCantonTxId(transactionId);
      setCantonStage("created");
      const amountWei = parseEther(amount);
      writeContract({
        address: chain.validatorContract,
        abi: mockValidatorShareAbi,
        functionName: "buyVoucher",
        args: [amountWei, amountWei],
        value: amountWei,
        maxPriorityFeePerGas: parseGwei("25"),
        maxFeePerGas: parseGwei("100"),
      });
    } catch (err) {
      setCantonStage("error");
      setCantonError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={620}>
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
        <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">
          STAKE &middot; STEP {stepIndex + 1} / {STEPS.length}
        </div>
        <button onClick={onClose} className="px-2 py-1 text-ink-400 hover:text-ink-100" aria-label="Close">
          ×
        </button>
      </div>
      <div className="h-0.5 bg-ink-700">
        <div className="h-full bg-neon transition-[width] duration-300" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
      </div>
      <div className="min-h-[360px] p-6">
        {step === "chain" && (
          <StakeChainStep
            onSelect={(nextChain) => {
              setChain(nextChain);
              setValidator(null);
              setStep("amount");
            }}
          />
        )}

        {step === "amount" && (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block font-mono text-xxs uppercase tracking-widest text-ink-400">amount</label>
              <div className="flex items-baseline gap-3">
                <input type="number" step="0.1" min={currentChain.minStake} value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full border-b border-ink-600 bg-transparent pb-2 font-display text-6xl tabular text-ink-100 outline-none focus:border-neon" />
                <span className="font-mono text-lg text-ink-300">{currentChain.symbol}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-ink-400">
                <span>wallet balance &middot; {balanceNative.toFixed(4)} {currentChain.symbol}</span>
                <button onClick={() => setBalancePercent(0.9)} className="uppercase tracking-wider text-neon hover:text-neon/80">MAX</button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {([["25%", 0.25], ["50%", 0.5], ["75%", 0.75], ["MAX", 0.9]] as const).map(([label, percent]) => (
                  <button key={label} onClick={() => setBalancePercent(percent)} className="hairline px-3 py-1.5 font-mono text-xxs uppercase tracking-widest text-ink-300 hover:text-neon">{label}</button>
                ))}
              </div>
            </div>
            <div className="border border-neon/30 bg-neon/10 p-4 text-sm text-ink-300">
              <div className="mb-1 font-mono text-xxs uppercase tracking-widest text-neon">estimated annual yield</div>
              <span className="font-mono font-semibold text-neon">+{(amountNumber * (currentChain.apy / 100)).toFixed(3)} {currentChain.symbol}</span>
              <span className="mx-2 text-ink-500">&middot;</span>
              <span className="font-mono font-semibold text-cc">+~marker CC</span>
            </div>
            <div className="flex gap-3">
              {canBackToChain && <button onClick={() => setStep("chain")} className={`flex-1 py-4 text-xs ${ghost}`}>Back</button>}
              <button onClick={() => setStep("validator")} disabled={amountNumber < currentChain.minStake} className={`${canBackToChain ? "flex-[2]" : "w-full"} py-4 text-sm ${primary}`}>Continue</button>
            </div>
          </div>
        )}

        {step === "validator" && (
          <StakeValidatorStep
            validators={validators}
            selected={validator}
            onBack={() => setStep("amount")}
            onSelect={(nextValidator) => {
              setValidator(nextValidator);
              setStep("review");
            }}
          />
        )}

        {step === "review" && validator && (
          <div className="space-y-5">
            <div className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 text-sm">
              {([["Action", "buyVoucher() · delegate"], ["Amount", `${amount || "0"} ${currentChain.symbol}`], ["Validator name", validator.name], ["Validator address", validator.address], ["Network fee", "~$0.04"], ["Unbonding", currentChain.unbonding]] as const).map(([label, value]) => (
                <div key={label} className="contents"><div className="text-ink-400">{label}</div><div className="max-w-[320px] break-all text-right font-mono text-ink-100">{value}</div></div>
              ))}
            </div>
            <div className="border border-dashed border-ink-600 p-4 text-sm text-ink-300">
              <div className="font-mono text-xxs uppercase tracking-widest text-neon">DAML CONTRACT</div>
              <div className="mt-2 font-mono text-xs text-ink-100">StakingPosition &middot; ActivityMarker tagged</div>
              <div className="mt-2">Beneficiary split: 75% your Loop wallet / 25% app treasury</div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep("validator")} className={`flex-1 py-3 text-xs ${ghost}`}>Back</button>
              <button onClick={() => { setStep("broadcasting"); void onStake(); }} disabled={writePending || switchPending || evmConfirming || amountNumber < currentChain.minStake} className={`flex-[2] py-3 text-xs ${primary}`}>Confirm stake</button>
            </div>
          </div>
        )}

        {step === "broadcasting" && (
          <div className="space-y-6">
            <div className="text-right font-mono text-xxs uppercase tracking-widest text-ink-500">Esc to close</div>
            <TraceRow index="01" label="Create StakingRequest (Canton)" status={cantonStage === "idle" ? "pending" : cantonStage === "creating" ? "running" : cantonStage === "created" ? "done" : "error"} detail={cantonTxId ? `tx · ${cantonTxId.slice(0, 16)}...` : cantonStage === "error" ? cantonError ?? "failed" : "waiting"} />
            <TraceRow index="02" label={`buyVoucher (${currentChain.name})`} status={!hash ? "pending" : evmConfirming ? "running" : evmConfirmed ? "done" : writeError ? "error" : "running"} detail={hash ? `tx · ${hash.slice(0, 16)}...` : writeError ? writeError.message.slice(0, 60) : "waiting"} />
            <TraceRow index="03" label="Orchestrator catches ShareMinted" status={evmConfirmed ? "running" : "pending"} detail="viem event watcher" />
            <TraceRow index="04" label="StakingRequest_Accept (Daml)" status={evmConfirmed ? "running" : "pending"} detail="emits FeaturedAppActivityMarker" accent />
            {(cantonStage === "error" || writeError) && <div className="hairline border-danger/40 p-3 font-mono text-xs text-danger">{cantonError ?? writeError?.message}</div>}
          </div>
        )}

        {step === "success" && (
          <div className="space-y-6 py-4 text-center">
            <svg className="mx-auto h-14 w-14 animate-pulse text-success" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div><h2 className="font-display text-3xl">Stake confirmed</h2><p className="mt-2 text-sm text-ink-400">CC rewards start flowing in the next 10-minute round.</p></div>
            <div className="hairline grid grid-cols-[90px_1fr] gap-3 p-4 text-left text-sm"><div className="text-ink-400">Tx hash</div><a href={currentChain.explorer?.tx(hash ?? "")} target="_blank" rel="noreferrer" className="break-all font-mono text-neon hover:text-neon/80">{hash}</a></div>
            <button onClick={onClose} className={`w-full py-4 text-sm ${primary}`}>Done</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
