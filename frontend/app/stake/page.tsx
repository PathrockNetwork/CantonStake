"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useReadContract,
  useChainId,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  sendTransaction as sendTransactionCore,
  waitForTransactionReceipt,
} from "@wagmi/core";
import { erc20Abi, formatUnits, parseEther } from "viem";
import { polygonAmoy } from "wagmi/chains";
import { IconArrowRight } from "@/components/icons";
import { Banner } from "@/components/primitives/Banner";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { MarkerSpark } from "@/components/primitives/MarkerSpark";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { emitTrace } from "@/components/trace/useTraceLog";
import {
  createStakingRequest,
  fetchChainStats,
  fetchPositions,
  fetchWatcherStatus,
} from "@/lib/api";
import {
  liveChains,
  polygonChain,
  stakeTokenAddress,
  validatorMinAmounts,
  type ChainConfig,
} from "@/lib/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { adapterFor, type Validator } from "@/lib/chains/index";
import { stakeAmountWei } from "@/lib/stake-input";
import { shortId } from "@/lib/account-view";
import { useWalletPicker } from "@/components/WalletPickerProvider";
import { AccountEmpty, AccountIcon, AccountPanel, ChainBadge, SplitPanel, StatusBadge } from "@/components/account/AccountUI";
import { fetchStakingParams } from "@/lib/chains/polygon";
import { fmt, fmtUsd } from "@/lib/format";
import { useCantonWallet } from "@/lib/canton";
import { useCosmosWallet, cosmosChainId } from "@/lib/cosmos/use-cosmos-wallet";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { usePrices } from "@/lib/prices";
import { isMainnet } from "@/lib/network";
import { recordPositionMeta } from "@/lib/position-chain-map";
import { tokens } from "@/lib/tokens";

/**
 * StakeFlow — ported from handoff/prototype/redesign/screens.jsx (`StakeFlow`).
 *
 * The prototype runs a pure simulation. This port drives the same five
 * visible stages off REAL wagmi + backend state:
 *
 *   01 StakingRequest_Create          → backend createStakingRequest()
 *   01a/01b ERC20.approve             → Polygon only. buyVoucher is NOT
 *                                       payable on the real contract; the
 *                                       StakeManager pulls the tokens with
 *                                       transferFrom, so the allowance is a
 *                                       separately-signed tx. It gets its own
 *                                       trace lines because it is a second
 *                                       wallet prompt, not part of stage 02.
 *   02 ValidatorShare.buyVoucher      → wagmi sendTransaction(...)
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
type ChainKind = "CANTON" | "EVM" | "COSMOS" | "SUI" | "MOVE" | "SUBSTRATE" | "SVM" | "MARKER";

interface Stage {
  code: string;
  detail: string;
  kind: ChainKind;
  tag: "info" | "idle" | "success";
}

// The per-chain method labels render in the trace terminal so the user
// sees what they're actually calling on whichever chain they picked.
const CHAIN_STAKE_METHOD: Record<ChainConfig["id"], string> = {
  polygon: "ValidatorShare.buyVoucher()",  // preceded by POL approve()
  monad: "Staking.delegate(uint64)",
  cosmos: "MsgDelegate",
  celestia: "MsgDelegate",
  osmosis: "MsgDelegate",
  sui: "0x3::sui_system::request_add_stake",
  aptos: "0x1::stake::add_stake",
  polkadot: "nominationPools.bond()",
  bnb: "StakeHub.delegate()",
  solana: "Stake.delegate()",
};

const CHAIN_CONFIRM_EVENT: Record<ChainConfig["id"], string> = {
  polygon: "ShareMinted",
  monad: "Delegate",
  cosmos: "tx committed",
  celestia: "tx committed",
  osmosis: "tx committed",
  sui: "tx finalized",
  aptos: "AddStakeEvent",
  polkadot: "Bonded",
  bnb: "Delegated",
  solana: "delegateStake",
};

const CHAIN_KIND: Record<ChainConfig["id"], ChainKind> = {
  polygon: "EVM",
  monad: "EVM",
  cosmos: "COSMOS",
  celestia: "COSMOS",
  osmosis: "COSMOS",
  sui: "SUI",
  aptos: "MOVE",
  polkadot: "SUBSTRATE",
  bnb: "EVM",
  solana: "SVM",
};

function buildStages(chain: ChainConfig): Stage[] {
  const k = CHAIN_KIND[chain.id];
  return [
    {
      code: "01 StakingRequest_Create",
      detail: "Canton request created · partyId=...",
      kind: "CANTON",
      tag: "info",
    },
    {
      code: `02 ${CHAIN_STAKE_METHOD[chain.id]}`,
      detail: `${chain.name} delegation submitted`,
      kind: k,
      tag: "idle",
    },
    {
      code: `03 ${CHAIN_CONFIRM_EVENT[chain.id]}`,
      detail: `${chain.symbol} delegation confirmed on ${chain.name}`,
      kind: k,
      tag: "idle",
    },
    {
      code: "04 StakingRequest_Accept",
      detail: "Canton position bonded · status=Bonded",
      kind: "CANTON",
      tag: "info",
    },
    {
      code: "05 FeaturedAppActivityMarker",
      detail: "Bond marker emitted · split=75/25",
      kind: "MARKER",
      tag: "success",
    },
  ];
}

function buildCtaLabels(chain: ChainConfig): string[] {
  return [
    `Bond {amount} ${chain.symbol}`,
    "Awaiting wallet signature…",
    `Confirming ${chain.name} tx…`,
    "Emitting Canton marker…",
    "Bonded · marker emitted",
  ];
}

type LogEntry = Stage & { t: number };

// Where to get testnet funds per chain. Polygon is special: staking
// settles on Ethereum Sepolia, so the wallet needs Sepolia ETH (gas) and
// the testnet POL ERC-20 there — Amoy-side POL alone is not stakeable.
const FUNDING_HINTS: Record<ChainConfig["id"], React.ReactNode> = {
  polygon: (
    <>
      Staking settles on Ethereum Sepolia — you need Sepolia ETH for gas +
      testnet POL there. ETH:{" "}
      <a href="https://sepoliafaucet.com" target="_blank" rel="noreferrer">sepoliafaucet.com</a>,{" "}
      <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noreferrer">Google faucet</a>.
      POL:{" "}
      <a href="https://www.alchemy.com/faucets/polygon-amoy" target="_blank" rel="noreferrer">Alchemy Amoy faucet</a>,{" "}
      <a href="https://faucet.quicknode.com/polygon/amoy" target="_blank" rel="noreferrer">QuickNode</a>{" "}
      (claim, then check the POL balance shows on Sepolia).
    </>
  ),
  monad: (
    <>
      Get Monad testnet MON from{" "}
      <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer">the Monad faucet</a>.
    </>
  ),
  cosmos: (
    <>
      Get theta-testnet ATOM from{" "}
      <a href="https://faucet.theta-testnet.polypore.xyz" target="_blank" rel="noreferrer">the Polypore faucet</a>.
    </>
  ),
  sui: (
    <>
      Get Sui testnet SUI from{" "}
      <a href="https://faucet.sui.io" target="_blank" rel="noreferrer">the Sui faucet</a>.
    </>
  ),
  celestia: (
    <>
      Get mocha testnet TIA from{" "}
      <a href="https://faucet.celenium.io" target="_blank" rel="noreferrer">the Celenium faucet</a>.
    </>
  ),
  osmosis: (
    <>
      Get Osmosis testnet OSMO from{" "}
      <a href="https://faucet.testnet.osmosis.zone" target="_blank" rel="noreferrer">the Osmosis faucet</a>.
    </>
  ),
  aptos: (
    <>
      Get Aptos testnet APT from{" "}
      <a href="https://aptos.dev/network/faucet" target="_blank" rel="noreferrer">the Aptos faucet</a>.
    </>
  ),
  polkadot: (
    <>
      Westend WND comes from the{" "}
      <a href="https://wiki.polkadot.com/docs/en/maintain-networks#westend-test-network" target="_blank" rel="noreferrer">Westend faucet (Matrix bot)</a>.
    </>
  ),
  bnb: (
    <>
      Get Chapel testnet tBNB from{" "}
      <a href="https://testnet.bnbchain.org/faucet-smart" target="_blank" rel="noreferrer">the BNB faucet</a>.
    </>
  ),
  solana: (
    <>
      Get Solana testnet SOL from{" "}
      <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">the Solana faucet</a>.
    </>
  ),
};

export default function StakePage() {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { partyId, isConnected: loopConnected } = useCantonWallet();
  const { openPicker } = useWalletPicker();

  const cosmos = useCosmosWallet();
  const sui = useSuiWallet();

  const chains = liveChains();
  const [selectedChainId, setSelectedChainId] = useState<ChainConfig["id"]>(
    "polygon",
  );
  const selectedChain = chains.find((c) => c.id === selectedChainId) ?? polygonChain();
  // Adapter-less chains (newly added networks) have a live settlement
  // watcher but no in-app staking flow yet — the CTA must say so instead
  // of dead-ending in a wallet prompt that can never finish.
  const stakingUiReady = selectedChain.hasAdapter !== false;
  const adapter = stakingUiReady ? adapterFor(selectedChain.id) : null;
  // Non-null wherever staking flows run (guarded by stakingUiReady checks).
  const chainAdapter = adapter!;
  const isEvmStakingReady = stakingUiReady && !!selectedChain.wagmiChain;
  const isCosmosChain = selectedChain.id === "cosmos";
  const isSuiChain = selectedChain.id === "sui";
  const isWalletReadyForChain =
    (stakingUiReady && !!selectedChain.wagmiChain && isConnected) ||
    (isCosmosChain && cosmos.isConnected) ||
    (isSuiChain && sui.isConnected);
  const polygon = polygonChain();
  const polygonId = polygon.wagmiChain!.id;
  const wrongNetwork =
    isEvmStakingReady && isConnected && chainId !== selectedChain.wagmiChain!.id;

  const [amount, setAmount] = useState("1");
  const [validators, setValidators] = useState<Validator[]>([]);
  const [validatorLoadError, setValidatorLoadError] = useState<string | null>(null);
  const [validatorSort, setValidatorSort] = useState("rank");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const reviewRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = reviewRef.current;
    if (reviewOpen && dialog && !dialog.open) dialog.showModal();
    else dialog?.close();
  }, [reviewOpen]);
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  // True while the ERC-20 allowance tx is in flight. It sits between stages
  // 01 and 02 and needs its own wallet signature, so the CTA has to say so.
  const [approving, setApproving] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showSpark, setShowSpark] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validatorName, setValidatorName] = useState<string | null>(null);
  const [validatorAddr, setValidatorAddr] = useState<string | null>(null);
  const stage5PollingStartedRef = useRef(false);

  // Live prices + chain stats so the form's APY/CC numbers and USD
  // estimates aren't hardcoded.
  const { data: prices } = usePrices();

  // Map chain ID to its USD price
  const chainPriceUsd = (() => {
    switch (selectedChain.id) {
      case "polygon": return prices?.polUsd ?? 0;
      case "monad": return prices?.monUsd ?? 0;
      case "cosmos": return prices?.atomUsd ?? 0;
      case "celestia": return prices?.tiaUsd ?? 0;
      case "osmosis": return prices?.osmoUsd ?? 0;
      case "sui": return prices?.suiUsd ?? 0;
      case "aptos": return prices?.aptUsd ?? 0;
      case "polkadot": return prices?.dotUsd ?? 0;
      case "bnb": return prices?.bnbUsd ?? 0;
      case "solana": return prices?.solUsd ?? 0;
      default: return prices?.polUsd ?? 0;
    }
  })();
  const { data: chainStats } = useQuery({
    queryKey: ["chain-stats"],
    queryFn: () => fetchChainStats(),
    refetchInterval: 5 * 60_000,
  });
  // Live Polygon unbonding parameters. The withdrawal delay is a checkpoint
  // COUNT, not a duration — the wall-clock figure is measured from the real
  // checkpoint cadence, so it is fetched rather than hardcoded.
  const { data: polygonParams } = useQuery({
    queryKey: ["polygon-staking-params"],
    queryFn: () => fetchStakingParams(),
    enabled: selectedChain.id === "polygon",
    refetchInterval: 5 * 60_000,
  });
  // Backend watcher reachability per chain. A chain whose watcher can't
  // reach its RPC settles nothing — staking there would strand the Canton
  // request in Pending forever, so those chains render disabled.
  const { data: watcherStatus } = useQuery({
    queryKey: ["watcher-status"],
    queryFn: fetchWatcherStatus,
    refetchInterval: 60_000,
  });
  const watcherByChain = new Map(
    (watcherStatus ?? []).map((w) => [w.chain as ChainConfig["id"], w]),
  );
  const selectedWatcher = watcherByChain.get(selectedChain.id);
  const selectedChainOffline = selectedWatcher?.status === "unreachable";

  // Per-validator buyVoucher floor for the selected top validator, live from
  // the backend registry (the same fetch that refreshes the ValidatorShare
  // map — see ensureValidatorSharesLive). Mainnet minimums differ from the
  // testnet deployment, so only the live value is truthful.
  const validatorMinWei =
    selectedChain.id === "polygon" && validatorAddr
      ? validatorMinAmounts.get(validatorAddr.toLowerCase()) ?? null
      : null;

  const unbondingLabel = (() => {
    if (selectedChain.id !== "polygon") return selectedChain.unbonding;
    const eta = polygonParams?.unbondingEtaSeconds;
    if (!polygonParams) return selectedChain.unbonding;
    const checkpoints = `${polygonParams.withdrawalDelayEpochs} checkpoints`;
    if (!eta) return checkpoints;
    const hours = eta / 3600;
    const human =
      hours >= 48 ? `~${Math.round(hours / 24)}d` : `~${Math.round(hours)}h`;
    return `${checkpoints} (${human})`;
  })();

  const stats = chainStats?.chains.find((c) => c.chain === selectedChain.id);
  const nativeApy = stats?.apyPctEstimate ?? null;

  useEffect(() => {
    let cancelled = false;
    setValidatorName(null);
    setValidatorAddr(null);
    setValidators([]);
    setValidatorLoadError(null);
    // Watcher-only chains (hasAdapter: false) have no validator rows to
    // load — chainAdapter is the `!`-asserted null there, so guard before
    // the call instead of crashing the page (TypeError on getValidators).
    if (!adapter) return;
    void adapter.getValidators().then((vs) => {
      if (!cancelled) { setValidators(vs); if (!vs.length) setValidatorLoadError("No eligible validators are currently available."); }
      const top = vs[0];
      if (!cancelled && top) {
        setValidatorName(top.name);
        setValidatorAddr(top.address);
      }
    }).catch(() => { if (!cancelled) setValidatorLoadError("Validators could not be loaded. Refresh to try again."); });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

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

  // Snapshot the user's current marker count BEFORE staking so the
  // post-stake poller can detect the increment.
  const [markerBaseline, setMarkerBaseline] = useState<number | null>(null);
  const currentStepRef = useRef(step);

  // Keep the ref in sync with step
  useEffect(() => {
    currentStepRef.current = step;
  }, [step]);

  useEffect(() => {
    const currentStep = currentStepRef.current;
    if (hash && !confirming && !confirmed && currentStep < 2) advance(2);
    if (confirming && currentStep < 3) advance(3);
    if (confirmed && currentStep < 4 && !stage5PollingStartedRef.current) {
      stage5PollingStartedRef.current = true;
      advance(4);

      // Non-Polygon chains: the backend's per-chain watchers decode the
      // settled on-chain staking event and transition the Daml
      // StakingRequest from Pending → Bonded. Nothing to do here — the
      // stage-5 poller below waits for that to land.

      // Stage 5 — wait for the orchestrator to emit a real marker.
      // Only recorded marker activity completes this stage. A delayed
      // watcher must never turn a confirmed native transaction into a
      // claimed Canton confirmation merely because a timer elapsed.
      if (!address) return;
      let cancelled = false;
      let timeoutId: number | undefined;

      const tick = async () => {
        if (cancelled || currentStepRef.current >= 5) return;
        try {
          const positions = await fetchPositions(address);
          const total = positions.reduce(
            (s, p) => s + (p.argument.markersEmitted ?? 0),
            0,
          );
          const baseline = markerBaseline ?? 0;
          if (total > baseline) {
            cancelled = true;
            advance(5);
            setShowSpark(true);
            window.setTimeout(() => setShowSpark(false), 900);
            return;
          }
        } catch {
          // network blip — keep polling
        }
        timeoutId = window.setTimeout(tick, 2_000);
      };
      void tick();

      return () => {
        cancelled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      };
    }
  }, [hash, confirming, confirmed, address, markerBaseline]);

  useEffect(() => {
    if (sendError) {
      setError(sendError.message);
      setStep(0);
      setShowSpark(false);
    }
  }, [sendError]);

  // Stages are rebuilt per render against the selected chain so the
  // user sees the right method names + chain tags in the trace terminal.
  const stages = buildStages(selectedChain);
  const ctaLabels = buildCtaLabels(selectedChain);

  function advance(target: 1 | 2 | 3 | 4 | 5) {
    const idx = target - 1;
    const stage = stages[idx]!;
    setLog((prev) => [...prev, { ...stage, t: Date.now() }]);
    setStep(target);
    emitTrace(stage);
  }

  /**
   * Append a trace line that is not one of the five numbered stages.
   *
   * The ERC-20 approval is a real, separately-signed transaction, so hiding
   * it under the buyVoucher stage means the user sees two wallet prompts
   * against one label and cannot tell which is which. It gets its own trace
   * line without disturbing the stage state machine.
   */
  function logAux(stage: Stage) {
    setLog((prev) => [...prev, { ...stage, t: Date.now() }]);
    emitTrace(stage);
  }

  async function handleStake() {
    if (step > 0 && step < 5) return;
    if (!stakingUiReady) {
      setError(
        `${selectedChain.name}: settlement watcher is live, but the in-app staking flow lands next. Positions on this chain currently settle from native wallets.`,
      );
      return;
    }
    if (selectedChainOffline) {
      setError(
        `${selectedChain.name} is offline — the settlement watcher cannot reach this chain right now.`,
      );
      return;
    }
    if (!partyId) {
      setError("Connect Loop wallet first.");
      return;
    }

    // Pick the right wallet flow per chain.
    if (isCosmosChain) {
      if (!cosmos.isConnected || !cosmos.address) {
        setError(
          "Connect Keplr (or Leap) to stake ATOM on theta-testnet.",
        );
        return;
      }
      void handleCosmosStake();
      return;
    }
    if (isSuiChain) {
      if (!sui.isConnected || !sui.address) {
        setError("Connect a Sui wallet to stake SUI on testnet.");
        return;
      }
      void handleSuiStake();
      return;
    }
    if (!isEvmStakingReady) {
      setError(
        `${selectedChain.name} staking isn't wired in this build. Pick Polygon or Monad Testnet.`,
      );
      return;
    }
    if (!address) {
      setError("Connect an EVM wallet to stake on this chain.");
      return;
    }

    if (stakeAmountWei(amount) === null) { setError("Enter a positive amount with no more than 18 decimal places."); return; }

    // buyVoucher reverts below the validator's on-chain minAmount. Failing
    // fast here gives a readable message instead of a reverted wallet tx.
    if (validatorMinWei !== null && parseEther(amount || "0") < validatorMinWei) {
      setError(
        `Below this validator's minimum stake of ${String(Number(formatUnits(validatorMinWei, 18)))} ${selectedChain.symbol}.`,
      );
      return;
    }

    // Reset visuals
    setLog([]);
    setApproving(false);
    setStep(0);
    setShowSpark(false);
    setError(null);
    resetSend();
    stage5PollingStartedRef.current = false;

    // Snapshot baseline marker count so the post-stake poller can detect
    // the increment caused by THIS stake.
    try {
      const existing = await fetchPositions(address);
      const baseline = existing.reduce(
        (s, p) => s + (p.argument.markersEmitted ?? 0),
        0,
      );
      setMarkerBaseline(baseline);
    } catch {
      setMarkerBaseline(0);
    }

    try {
      // Revalidate the reviewed selection before creating a request.
      const eligible = await chainAdapter.getValidators();
      const validator = eligible.find(item => item.address.toLowerCase() === validatorAddr?.toLowerCase());
      if (!validator) {
        throw new Error(
          `No ${selectedChain.name} validator is available for staking.`,
        );
      }

      // Stage 01 — Canton request created (real backend call)
      advance(1);
      await createStakingRequest({
        evmAddress: address,
        amountPol: amount,
        delegator: partyId,
        chain: selectedChain.id,
        validator: validator.address,
      });
      recordPositionMeta(address, amount, selectedChain.id, validator.address);

      // Switch network if needed
      const wagmiChain = selectedChain.wagmiChain;
      if (!wagmiChain) {
        throw new Error(`${selectedChain.name} is not configured for wallet switching.`);
      }
      const targetChainId = wagmiChain.id;
      if (chainId !== targetChainId) {
        // First try to add the network to MetaMask (this won't fail if already added)
        const rpcUrls = wagmiChain.rpcUrls.default.http;
        try {
          const provider = await (connector as any)?.getProvider?.();
          if (provider?.request && rpcUrls?.[0]) {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: `0x${targetChainId.toString(16)}`,
                chainName: selectedChain.name,
                nativeCurrency: {
                  name: selectedChain.symbol,
                  symbol: selectedChain.symbol,
                  decimals: 18,
                },
                rpcUrls: [rpcUrls[0]],
                blockExplorerUrls: selectedChain.explorer
                  ? [selectedChain.explorer.tx('')]
                  : undefined,
              }],
            });
          }
        } catch {
          // Network add failed - might already exist, continue
        }

        // Now switch to the network
        try {
          await switchChainAsync({ chainId: targetChainId });
          // Wait a moment for the switch to take effect
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (switchError) {
          throw new Error(
            `Please switch your wallet to ${selectedChain.name} and try again.`,
          );
        }
      }

      const amountWei = parseEther(amount);

      // Polygon's stake token is an ERC-20 and `buyVoucher` is NOT payable:
      // the StakeManager pulls the tokens with transferFrom. So an approval
      // has to confirm before the delegation is even built. This is sent
      // through the core action rather than the hook so it doesn't overwrite
      // the hook's `hash` — the trace UI tracks the delegation tx, not this.
      const approval = await chainAdapter.buildApprovalTx?.({
        validator: validator.address,
        amount: amountWei,
        delegator: address,
      });
      if (approval) {
        if (approval.kind !== "evm") {
          throw new Error(`Unexpected approval tx kind: ${approval.kind}`);
        }
        setApproving(true);
        logAux({
          code: "01a ERC20.approve()",
          detail: `Approving ${amount} ${selectedChain.symbol} to the StakeManager · wallet prompt 1 of 2`,
          kind: "EVM",
          tag: "idle",
        });
        try {
          const approveHash = await sendTransactionCore(wagmiConfig, {
            to: approval.to,
            data: approval.data,
            value: 0n,
            ...(approval.gas ? { gas: approval.gas } : {}),
          });
          await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
          logAux({
            code: "01b Approval",
            detail: `Allowance confirmed · ${approveHash.slice(0, 10)}…`,
            kind: "EVM",
            tag: "info",
          });
        } finally {
          setApproving(false);
        }
      }

      const tx = await chainAdapter.buildDelegateTx({
        validator: validator.address,
        amount: amountWei,
        delegator: address,
      });
      if (tx.kind !== "evm") {
        throw new Error(
          `Unexpected ${selectedChain.name} tx kind: ${tx.kind}`,
        );
      }

      // Don't pass chainId - let it use the current chain after switch.
      // The fixed 30/100 gwei floor is a Bor requirement (Amoy rejects lower
      // priority fees). On the L1 settlement chain it would just overpay, so
      // let the wallet estimate there.
      const isBorChain = targetChainId === polygonAmoy.id;
      sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ?? 0n,
        gas: tx.gas,
        ...(isBorChain
          ? {
              maxPriorityFeePerGas: 30_000_000_000n, // 30 gwei
              maxFeePerGas: 100_000_000_000n, // 100 gwei
            }
          : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("WALLET_CHAIN_MISMATCH:")) {
        setError(msg.replace("WALLET_CHAIN_MISMATCH: ", ""));
      } else if (msg.includes("does not match the target chain")) {
        setError(
          `Your wallet is on the wrong network. Switch to ${selectedChain.name} and try again. If your wallet doesn't support switching, use MetaMask or Rabby.`,
        );
      } else {
        setError(msg);
      }
      setStep(0);
    }
  }

  // Cosmos staking flow — register on Canton, sign a MsgDelegate via Keplr,
  // broadcast to theta-testnet. The backend's cosmos watcher decodes the
  // settled MsgDelegate and accepts the StakingRequest on Canton; we just
  // wait for the broadcast to confirm. The EVM-tx-confirmation stages 2/3
  // are reused: stage 2 = "signing in Keplr", stage 3 = "broadcast
  // confirmed".
  async function handleCosmosStake() {
    if (!partyId || !cosmos.address) return;

    setLog([]);
    setApproving(false);
    setStep(0);
    setShowSpark(false);
    setError(null);

    try {
      const [validator] = await chainAdapter.getValidators();
      if (!validator) throw new Error("No Cosmos validator available.");

      advance(1);
      await createStakingRequest({
        evmAddress: cosmos.address, // bech32; backend skips EVM regex for cosmos
        amountPol: amount,
        delegator: partyId,
        chain: "cosmos",
        validator: validator.address,
      });
      recordPositionMeta(cosmos.address, amount, "cosmos", validator.address);

      advance(2);
      // amount is in ATOM; convert to uatom (1e6).
      const amountUatom = BigInt(
        Math.floor(parseFloat(amount || "0") * 1_000_000),
      );
      const tx = await chainAdapter.buildDelegateTx({
        validator: validator.address,
        amount: amountUatom,
        delegator: cosmos.address,
      });
      if (tx.kind !== "cosmos") {
        throw new Error(`Unexpected Cosmos tx kind: ${tx.kind}`);
      }

      const result = await cosmos.signAndBroadcast({
        typeUrl: tx.typeUrl,
        value: tx.value,
      });
      advance(3);

      // The cosmos watcher accepts the StakingRequest once it decodes this
      // settled MsgDelegate — no client-side accept call exists (or is
      // needed) anymore.
      advance(4);
      advance(5);
      setShowSpark(true);
      window.setTimeout(() => setShowSpark(false), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(0);
    }
  }

  // Sui staking flow — request_add_stake via @mysten/dapp-kit. Same
  // shape as cosmos: register on Canton, sign+execute; the sui watcher
  // accepts from the decoded on-chain event.
  async function handleSuiStake() {
    if (!partyId || !sui.address) return;

    setLog([]);
    setApproving(false);
    setStep(0);
    setShowSpark(false);
    setError(null);

    try {
      const [validator] = await chainAdapter.getValidators();
      if (!validator) throw new Error("No Sui validator available.");

      advance(1);
      await createStakingRequest({
        evmAddress: sui.address, // sui address; backend skips EVM regex for sui
        amountPol: amount,
        delegator: partyId,
        chain: "sui",
        validator: validator.address,
      });
      recordPositionMeta(sui.address, amount, "sui", validator.address);

      advance(2);
      const amountMist = BigInt(
        Math.floor(parseFloat(amount || "0") * 1_000_000_000),
      );
      const result = await sui.delegate({
        validator: validator.address,
        amountMist,
      });
      advance(3);

      // The sui watcher accepts the StakingRequest from the decoded
      // StakeRequest event — no client-side accept call exists anymore.
      advance(4);
      advance(5);
      setShowSpark(true);
      window.setTimeout(() => setShowSpark(false), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(0);
    }
  }

  const ctaLabel = approving
    ? `Approving ${selectedChain.symbol}… (1 of 2)`
    : step === 0
      ? ctaLabels[0]!.replace("{amount}", amount)
      : ctaLabels[step] ?? ctaLabels[0]!;
  const amountNum = parseFloat(amount || "0");
  const usdValue = amountNum * chainPriceUsd;
  const selectedValidator = validators.find(validator => validator.address === validatorAddr);
  const sortedValidators = [...validators].sort((a, b) => validatorSort === "apr" ? b.apr - a.apr : validatorSort === "fee" ? a.commission - b.commission : 0);
  const balance = useReadContract({ address: stakeTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined,
    chainId: selectedChain.wagmiChain?.id, query: { enabled: !!address && selectedChain.id === "polygon", refetchInterval: 30_000 } });
  const amountWei = stakeAmountWei(amount);
  const amountIssue = amountWei === null ? "Enter a positive amount (up to 18 decimal places)."
    : validatorMinWei !== null && amountWei < validatorMinWei ? `Minimum stake: ${formatUnits(validatorMinWei, 18)} ${selectedChain.symbol}.`
    : balance.data !== undefined && amountWei > balance.data ? "Amount exceeds your token balance." : null;
  const busy = preparing || (step > 0 && step < 5);
  const walletsReady = loopConnected && !!partyId && isWalletReadyForChain;
  const formStage = !validatorAddr ? 2 : amountIssue ? 3 : 4;

  return (
    <div className="page-shell account-page">
      <PageMasthead index="02" section="Stake on Canton" title="Stake." accent="Create a self-custodial staking position." description={`Delegate ${selectedChain.symbol} from your own wallet, earn native rewards and Canton Coin rewards, with the lifecycle recorded on Canton.`} />

      {isMainnet && (
        <Banner
          tone="error"
          kind="MAINNET — REAL FUNDS"
          message="This deployment follows mainnet networks. Every stake, unstake and gas payment moves real value. There are no faucets and no undo."
        />
      )}

      {error && (
        <Banner
          tone="error"
          kind={`${selectedChain.name.toUpperCase()} TX FAILED`}
          message={error}
          action={
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setError(null);
                setStep(0);
                stage5PollingStartedRef.current = false;
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
          message={`Wallet on chain ${chainId}. Switch your EVM wallet to ${selectedChain.name} to stake here.`}
          action={
            <Btn
              size="sm"
              variant="ghost"
              onClick={() =>
                switchChainAsync({
                  chainId: selectedChain.wagmiChain!.id,
                })
              }
              disabled={switchPending}
            >
              Switch to {selectedChain.name}
            </Btn>
          }
        />
      )}
      {!error && isCosmosChain && !cosmos.isConnected && (
        <Banner
          tone="warn"
          kind="KEPLR NOT CONNECTED"
          message="Cosmos staking requires Keplr (or Leap). Click the chip in the top-right to connect."
        />
      )}
      {!error && isSuiChain && !sui.isConnected && (
        <Banner
          tone="warn"
          kind="SUI WALLET NOT CONNECTED"
          message="Sui staking requires Slush, Suiet, or any Sui wallet extension. Click the chip in the top-right to connect."
        />
      )}
      {(isCosmosChain || isSuiChain) && (
        <Banner
          tone="warn"
          kind="COMING SOON"
          message={`${selectedChain.name} staking is coming soon. We're currently finalizing the integration. Stay tuned!`}
        />
      )}

      <nav className="stake-stepper account-stake-stepper" aria-label="Staking workflow">
        {[["01", "Select chain", "stake-chain"], ["02", "Choose token", "stake-token"], ["03", "Pick validator", "stake-validator"], ["04", "Enter amount", "stake-amount"], ["05", "Review & sign", "stake-review"]].map(([number, label, target], index) => <a href={`#${target}`} key={number} className={`stake-stepper__item${index <= formStage ? " stake-stepper__item--active" : ""}`} aria-current={index === formStage ? "step" : undefined}><span>{number}</span><div><strong>{label}</strong><small>{index < formStage ? "Ready" : index === formStage ? "Current step" : "Up next"}</small></div></a>)}
      </nav>
      <div className="account-stake-workspace">
        <AccountPanel title="01 · Select chain" icon="link" description="Choose a supported chain." id="stake-chain">
          <div className="account-chain-options">{chains.map(chain => <button key={chain.id} className="account-chain-option" aria-pressed={selectedChain.id === chain.id} disabled={busy || watcherByChain.get(chain.id)?.status === "unreachable" || chain.hasAdapter === false} onClick={() => { setSelectedChainId(chain.id); setStep(0); setReviewOpen(false); }}><ChainBadge symbol={chain.symbol} label={chain.id === "polygon" ? "Polygon PoS" : chain.name} /><StatusBadge status={watcherByChain.get(chain.id)?.status === "unreachable" ? "Offline" : "Supported"} /></button>)}</div>
          <p className="account-muted">{selectedChain.type}</p><p className="account-muted">More chains coming soon.</p>
          <dl className="account-definition"><div><dt>Settlement</dt><dd>{selectedChain.wagmiChain?.name ?? selectedChain.name}</dd></div><div><dt>Unbond period</dt><dd>{unbondingLabel}</dd></div></dl>
        </AccountPanel>
        <AccountPanel title="02 · Choose token" icon="coin" description="Native token for this staking flow." id="stake-token">
          <div className="account-token-selected"><ChainBadge symbol={selectedChain.symbol} label={selectedChain.symbol} /><StatusBadge status="Selected" /></div>
          <p className="account-muted">Stake {selectedChain.symbol} from your wallet to earn native validator yield and Canton Coin rewards.</p>
          <dl className="account-definition"><div><dt>Token standard</dt><dd>{selectedChain.id === "polygon" ? "ERC-20" : selectedChain.symbol}</dd></div><div><dt>Current price</dt><dd>{fmtUsd(chainPriceUsd, 4)}</dd></div><div><dt>Price source</dt><dd>{prices?.source.pol === "coingecko" ? "Market price" : "Reference price"}</dd></div><div><dt>Staking network</dt><dd>{selectedChain.wagmiChain?.name ?? selectedChain.name}</dd></div></dl>
          {selectedChain.id === "polygon" && <a className="account-button" href={`${isMainnet ? "https://etherscan.io" : "https://sepolia.etherscan.io"}/token/${stakeTokenAddress}`} target="_blank" rel="noreferrer">View token ↗</a>}
        </AccountPanel>
        <AccountPanel title="03 · Pick validator" icon="shield" description="Select a validator to delegate to." id="stake-validator">
          <label><span className="sr-only">Sort validators</span><select className="account-field" aria-label="Sort validators" value={validatorSort} onChange={event => setValidatorSort(event.target.value)} disabled={busy}><option value="rank">Recommended order</option><option value="fee">Lowest commission</option></select></label>
          <div className="account-validator-options" role="group" aria-label="Available validators">{sortedValidators.map((validator, i) => <button key={validator.address} className="account-validator-option" aria-pressed={validatorAddr === validator.address} disabled={busy} onClick={() => { setValidatorAddr(validator.address); setValidatorName(validator.name); }}>
            <span className="account-validator-avatar" aria-hidden="true">{validator.name.slice(0, 1)}</span><span><strong>{validator.name}</strong><small>{shortId(validator.address)}</small><small>{Number.isFinite(validator.uptime) ? `${validator.uptime.toFixed(1)}% uptime` : "Validator"}</small></span><span><b>{validator.apr > 0 ? `${validator.apr.toFixed(1)}%` : "—"}</b><small>Est. APR</small><small>{validator.commission}% fee</small></span><span className="account-validator-check" aria-hidden="true">{validatorAddr === validator.address ? "✓" : "○"}</span>
          </button>)}</div>
          {!validators.length && <AccountEmpty>{validatorLoadError || "Loading available validators…"}</AccountEmpty>}
          <p className="account-muted">Commission is set by each validator. A dash means measured validator APR is unavailable.</p>
        </AccountPanel>
        <div className="account-stack">
          <AccountPanel title="04 · Enter amount" icon="wallet" description={`Set the amount of ${selectedChain.symbol} to stake.`} id="stake-amount">
            <div className="account-amount-balance"><span>{address ? balance.data !== undefined ? `Balance: ${fmt(Number(formatUnits(balance.data, 18)), 4)} POL` : balance.isError ? "Balance unavailable" : "Loading balance…" : "Connect wallet for balance"}</span><button className="account-button" disabled={busy || balance.data === undefined || selectedChain.id !== "polygon"} onClick={() => setAmount(formatUnits(balance.data!, 18))}>Max</button></div>
            <label className="account-stake-amount"><span className="sr-only">Stake amount</span><input aria-label="Stake amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /><span>{selectedChain.symbol}</span></label>
            <p className="account-muted">≈ {Number.isFinite(usdValue) ? fmtUsd(usdValue, 2) : "—"} USD · estimated</p>
            {amountIssue && <p role="status" className="account-amount-warning">{amountIssue}</p>}
            {!isMainnet && <details className="account-funding"><summary>Need testnet funds?</summary><p>{FUNDING_HINTS[selectedChain.id]}</p></details>}
          </AccountPanel>
          <AccountPanel title="05 · Review rewards" icon="activity" description="Native yield and Canton allocations." id="stake-review">
            <div className="account-dual-rewards"><div className="account-yield-card"><span aria-hidden="true"><AccountIcon name="stack" /></span><div><small>NATIVE VALIDATOR YIELD</small><strong>{selectedValidator?.apr ? `${selectedValidator.apr.toFixed(1)}%` : nativeApy !== null ? `${nativeApy.toFixed(1)}%` : "—"}</strong><small>Estimated APR</small></div></div><div className="account-yield-card account-yield-card--cc"><span aria-hidden="true"><AccountIcon name="coin" /></span><div><small>CANTON COIN REWARDS</small><strong>Per round</strong><small>Based on actual attribution</small></div></div></div>
          </AccountPanel>
          <SplitPanel compact />
        </div>
      </div>
      <div className="account-stake-bottom">
        <AccountPanel title="Transaction flow preview" icon="activity" description="You sign in your wallet. Native confirmation is recorded on Canton.">
          <div className="account-transaction-flow"><div><AccountIcon name="wallet" /><strong>1. Approve & sign</strong><p>Approve the staking token if needed, then sign the delegation.</p></div><div><AccountIcon name="clock" /><strong>2. Wait for confirmation</strong><p>The native-chain watcher observes the confirmed staking event.</p></div><div><AccountIcon name="cube" /><strong>3. Record on Canton</strong><p>Your position and lifecycle activity are recorded on-ledger.</p></div></div>
        </AccountPanel>
        <div className="account-stake-submit">
          <button className="account-button account-button--primary" disabled={busy || selectedChainOffline || !stakingUiReady || (walletsReady && (!!amountIssue || !validatorAddr))} onClick={() => { if (!walletsReady) openPicker(); else setReviewOpen(true); }}>{busy ? ctaLabel : selectedChainOffline ? "Staking watcher unavailable" : !walletsReady ? "Connect wallets to stake" : step === 5 ? "Review another stake →" : "Review & stake →"}</button>
          <p className="account-muted">Your wallet signs. You retain custody.</p>
          {hash && selectedChain.explorer && <a className="account-text-link" href={selectedChain.explorer.tx(hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}
        </div>
      </div>
      <details className="account-stake-trace" open={step > 0 || !!error}><summary>Transaction activity {step > 0 ? `· ${ctaLabel}` : ""}</summary>
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
              $ cantonstake bond --network {selectedChain.id} --amount {amount}{" "}
              {selectedChain.symbol}
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
                  Bond · {fmt(amountNum * chainPriceUsd, 2)} USD
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
      </details>
      <dialog ref={reviewRef} className="account-stake-review" onCancel={() => setReviewOpen(false)} onClose={() => setReviewOpen(false)} aria-labelledby="stake-review-heading">
        <header><h2 id="stake-review-heading">Review your stake</h2><button className="account-button" aria-label="Close stake review" onClick={() => setReviewOpen(false)}>×</button></header>
        <dl className="account-definition"><div><dt>Amount</dt><dd>{amount} {selectedChain.symbol}</dd></div><div><dt>Estimated value</dt><dd>{fmtUsd(usdValue, 2)}</dd></div><div><dt>Settlement network</dt><dd>{selectedChain.wagmiChain?.name ?? selectedChain.name}</dd></div><div><dt>Validator</dt><dd>{validatorName}<small className="mono">{validatorAddr}</small></dd></div><div><dt>Unbond period</dt><dd>{unbondingLabel}</dd></div><div><dt>CC beneficiary split</dt><dd>75% delegator / 25% treasury</dd></div></dl>
        <p className="account-muted">Your wallet will ask you to approve POL if needed, then sign the staking transaction. Network fees are shown by your wallet.</p>
        {isMainnet && <p className="account-amount-warning">Mainnet transaction · real funds</p>}
        <footer><button className="account-button" onClick={() => setReviewOpen(false)}>Back</button><button className="account-button account-button--primary" disabled={!walletsReady || !!amountIssue || !validatorAddr || busy || selectedChainOffline} onClick={() => { setReviewOpen(false); setPreparing(true); void handleStake().finally(() => setPreparing(false)); }}>Confirm & open wallet →</button></footer>
      </dialog>
    </div>
  );
}
