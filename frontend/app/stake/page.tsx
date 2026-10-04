"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useBalance,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  getAccount,
  sendTransaction as sendTransactionCore,
  waitForTransactionReceipt,
} from "@wagmi/core";
import { erc20Abi, formatUnits, parseEther, parseUnits } from "viem";
import { polygonAmoy } from "wagmi/chains";
import { PublicKey } from "@solana/web3.js";
import { Banner } from "@/components/primitives/Banner";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { MarkerSpark } from "@/components/primitives/MarkerSpark";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { emitTrace } from "@/components/trace/useTraceLog";
import {
  createStakingRequest,
  fetchChainStats,
  fetchPositions,
  fetchWatcherStatus,
  fetchCantonReadiness,
} from "@/lib/api";
import {
  liveChains,
  polygonChain,
  polygonNativeChain,
  stakingWalletNetworkName,
  stakeTokenAddress,
  validatorMinAmounts,
  type ChainConfig,
} from "@/lib/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { adapterFor, type Validator } from "@/lib/chains/index";
import { stakeAmountWei } from "@/lib/stake-input";
import { assertEvmWalletBinding } from "@/lib/wallet-binding";
import { evmWalletChainParameters } from "@/lib/evm-wallet-chain";
import { createExclusiveAction } from "@/lib/exclusive-action";
import { successfulEvmSettlementHash } from "@/lib/evm-settlement";
import { shortId } from "@/lib/account-view";
import { useWalletPicker } from "@/components/WalletPickerProvider";
import { AccountEmpty, AccountIcon, AccountPanel, ChainBadge, SplitPanel, StatusBadge } from "@/components/account/AccountUI";
import { fetchStakingParams } from "@/lib/chains/polygon";
import { fmt, fmtUsd } from "@/lib/format";
import { useCantonWallet } from "@/lib/canton";
import { useCosmosWallet } from "@/lib/cosmos/use-cosmos-wallet";
import { cosmosNetworks, isCosmosChainKey, type CosmosChainKey } from "@/lib/cosmos/networks";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { suiNetwork } from "@/lib/sui/network";
import { useAptosWallet } from "@/lib/aptos/use-aptos-wallet";
import { useSolanaWallet } from "@/lib/solana/use-solana-wallet";
import { usePolkadotWallet } from "@/lib/polkadot/use-polkadot-wallet";
import { polkadotApi, polkadotNetwork } from "@/lib/polkadot/network";
import { fetchPolkadotPools } from "@/lib/chains/polkadot";
import { aptosView } from "@/lib/aptos/network";
import { aptosNetwork } from "@/lib/aptos/network";
import { solanaNetwork } from "@/lib/solana/network";
import { usePrices } from "@/lib/prices";
import { isMainnet, networkMode } from "@/lib/network";
import { recordPositionMeta } from "@/lib/position-chain-map";
import { tokens } from "@/lib/tokens";
import { StakeChainPicker } from "@/components/stake/StakeChainPicker";
import { PolygonLiquidStake } from "@/components/stake/PolygonLiquidStake";
import { usesPolygonLiquid } from "@/lib/polygon-liquid";
import { isCantonReadyForStaking } from "@/lib/staking-readiness";

/**
 * StakeFlow — ported from handoff/prototype/redesign/screens.jsx (`StakeFlow`).
 *
 * The five visible stages follow wallet, native receipt and backend state:
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
 *   05 Indexed Bonded position        → backend confirms the settled native tx
 *
 * Stage 4 follows successful native settlement. Stage 5 waits for the
 * exact settled transaction hash on an indexed Bonded Canton position;
 * a timer or a returned reverted receipt cannot advance it.
 *
 * If the wagmi write fails (rejected, wrong network, RPC error), step
 * resets and an error banner replaces the wrong-network banner.
 */
type ChainKind = "CANTON" | "EVM" | "COSMOS" | "SUI" | "MOVE" | "SUBSTRATE" | "SVM";

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
  aptos: "0x1::delegation_pool::add_stake",
  polkadot: "nominationPools.bond()",
  bnb: "StakeHub.delegate()",
  solana: "Stake.createAccount() + delegate()",
};

const CHAIN_CONFIRM_EVENT: Record<ChainConfig["id"], string> = {
  polygon: "ShareMinted",
  monad: "Delegate",
  cosmos: "tx committed",
  celestia: "tx committed",
  osmosis: "tx committed",
  sui: "tx finalized",
  aptos: "AddStake",
  polkadot: "Bonded",
  bnb: "Delegated",
  solana: "delegate",
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
      code: "05 Canton position indexed",
      detail: "Bonded position verified against the settled transaction",
      kind: "CANTON",
      tag: "success",
    },
  ];
}

function buildCtaLabels(chain: ChainConfig): string[] {
  return [
    `Bond {amount} ${chain.symbol}`,
    "Awaiting wallet signature…",
    `Confirming ${chain.name} tx…`,
    "Recording Canton position…",
    "Bonded · Canton position indexed",
  ];
}

type LogEntry = Stage & { t: number };

// Polygon validator staking settles on Sepolia; Amoy POL funds the separate
// liquid-staking test route and cannot be used by this validator form.
const FUNDING_HINTS: Record<ChainConfig["id"], React.ReactNode> = {
  polygon: (
    <>
      Direct validator staking needs test POL and ETH for gas on Sepolia.
      Amoy test POL is a different balance and cannot be used here. ETH:{" "}
      <a href="https://sepoliafaucet.com" target="_blank" rel="noreferrer">sepoliafaucet.com</a>,{" "}
      <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noreferrer">Google faucet</a>.
      For Amoy test POL, use{" "}
      <a href="https://www.alchemy.com/faucets/polygon-amoy" target="_blank" rel="noreferrer">Alchemy Amoy faucet</a>,{" "}
      <a href="https://faucet.quicknode.com/polygon/amoy" target="_blank" rel="noreferrer">QuickNode</a>.
      Amoy POL can be used in the separate{" "}<a href="/stake/liquid">liquid staking test</a>.
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
      Get provider-testnet ATOM from{" "}
      <a href="https://faucet.polypore.xyz" target="_blank" rel="noreferrer">the Polypore faucet</a>.
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
  const [advancedPolygon, setAdvancedPolygon] = useState(false);
  const [liquidBusy, setLiquidBusy] = useState(false);
  useEffect(() => {
    setAdvancedPolygon(new URLSearchParams(window.location.search).get("polygon") === "validator");
  }, []);
  const { address, isConnected, connector, chainId } = useAccount();
  const { switchChainAsync, isPending: switchPending } = useSwitchChain();
  const { partyId, isConnected: loopConnected } = useCantonWallet();
  const { openPicker } = useWalletPicker();

  const cosmosHub = useCosmosWallet("cosmos");
  const celestia = useCosmosWallet("celestia");
  const osmosis = useCosmosWallet("osmosis");
  const sui = useSuiWallet();
  const aptos = useAptosWallet();
  const solana = useSolanaWallet();
  const polkadot = usePolkadotWallet();
  const { data: chainStats, isError: chainStatsError } = useQuery({
    queryKey: ["chain-stats"],
    queryFn: () => fetchChainStats(),
    refetchInterval: 5 * 60_000,
  });

  const chains = liveChains();
  const [selectedChainId, setSelectedChainId] = useState<ChainConfig["id"]>(
    chains[0]?.id ?? "polygon",
  );
  const selectedChain = chains.find((c) => c.id === selectedChainId) ?? chains[0] ?? polygonChain();
  const walletNetworkName = stakingWalletNetworkName(selectedChain);
  // A configured adapter is usable only when the backend enables it too.
  const stakingUiReady = !chainStatsError && chains.some((c) => c.id === selectedChain.id) && selectedChain.hasAdapter !== false &&
    !!chainStats?.chains.some((c) => c.chain === selectedChain.id);
  const adapter = stakingUiReady ? adapterFor(selectedChain.id) : null;
  // Non-null wherever staking flows run (guarded by stakingUiReady checks).
  const chainAdapter = adapter!;
  const isEvmStakingReady = stakingUiReady && !!selectedChain.wagmiChain;
  const isCosmosChain = isCosmosChainKey(selectedChain.id);
  const cosmosWallets = { cosmos: cosmosHub, celestia, osmosis };
  const cosmos = isCosmosChain ? cosmosWallets[selectedChain.id as CosmosChainKey] : cosmosHub;
  const isSuiChain = selectedChain.id === "sui";
  const isAptosChain = selectedChain.id === "aptos";
  const isSolanaChain = selectedChain.id === "solana";
  const isPolkadotChain = selectedChain.id === "polkadot";
  // Wallet guidance must remain available while backend chain stats are loading.
  const wrongNetwork = !!selectedChain.wagmiChain && isConnected && chainId !== selectedChain.wagmiChain.id;
  const aptosWrongNetwork = isAptosChain && aptos.isConnected && (
    aptos.network?.chainId !== aptosNetwork.chainId || aptos.network.name !== aptosNetwork.name
  );
  const suiUnsupportedNetwork = isSuiChain && sui.isConnected && !sui.networkSupported;
  const isWalletReadyForChain =
    (stakingUiReady && !!selectedChain.wagmiChain && isConnected && !wrongNetwork) ||
    (stakingUiReady && isCosmosChain && cosmos.isConnected) ||
    (stakingUiReady && isSuiChain && sui.isConnected && !suiUnsupportedNetwork) ||
    (stakingUiReady && isAptosChain && aptos.isConnected && !aptosWrongNetwork) ||
    (stakingUiReady && isSolanaChain && solana.isConnected) ||
    (stakingUiReady && isPolkadotChain && polkadot.isConnected);
  const polygon = polygonChain();
  const polygonId = polygon.wagmiChain!.id;

  const [amount, setAmount] = useState("1");
  const [validators, setValidators] = useState<Validator[]>([]);
  const [validatorLoadError, setValidatorLoadError] = useState<string | null>(null);
  const [validatorSort, setValidatorSort] = useState("rank");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const runStakeAction = useRef(createExclusiveAction()).current;
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
  const [networkActionError, setNetworkActionError] = useState<string | null>(null);
  const [aptosSwitchPending, setAptosSwitchPending] = useState(false);
  useEffect(() => { setNetworkActionError(null); }, [selectedChain.id, chainId, aptos.network?.chainId, aptos.network?.name]);

  const requestEvmSwitch = async () => {
    if (!selectedChain.wagmiChain) return;
    setNetworkActionError(null);
    const target = selectedChain.wagmiChain;
    try {
      await switchChainAsync({ chainId: target.id });
    } catch (cause) {
      const details = String(cause);
      const code = (cause as { cause?: { code?: number }; code?: number })?.cause?.code ??
        (cause as { code?: number })?.code;
      if (code === 4902 || /4902|unrecognized chain/i.test(details)) {
        try {
          const provider = await (connector as any)?.getProvider?.();
          if (!provider?.request) throw new Error("Wallet cannot add this chain automatically.");
          await provider.request({ method: "wallet_addEthereumChain", params: [evmWalletChainParameters(target)] });
          await switchChainAsync({ chainId: target.id });
          return;
        } catch {
          // Some wallets require the network to be added manually.
        }
      }
      setNetworkActionError(`Switch to ${walletNetworkName} in your wallet, then try again. The wallet may have rejected the request or require adding the network manually.`);
    }
  };

  const requestAptosSwitch = async () => {
    setNetworkActionError(null);
    setAptosSwitchPending(true);
    try {
      await aptos.switchNetwork();
    } catch {
      setNetworkActionError(`Switch to Aptos ${aptosNetwork.name} in your wallet settings, then try again. This wallet may not support automatic switching.`);
    } finally {
      setAptosSwitchPending(false);
    }
  };
  const [validatorName, setValidatorName] = useState<string | null>(null);
  const [validatorAddr, setValidatorAddr] = useState<string | null>(null);
  const stage5PollingStartedRef = useRef(false);
  const [evmSubmission, setEvmSubmission] = useState<{
    chain: ChainConfig["id"];
    chainId: number;
    wallet: string;
  } | null>(null);
  const [nativeSettlement, setNativeSettlement] = useState<{
    chain: CosmosChainKey | "sui" | "aptos" | "solana" | "polkadot";
    wallet: string;
    txHash: string;
  } | null>(null);

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
      case "polkadot": return isMainnet ? prices?.dotUsd ?? 0 : 0;
      case "bnb": return prices?.bnbUsd ?? 0;
      case "solana": return prices?.solUsd ?? 0;
      default: return prices?.polUsd ?? 0;
    }
  })();
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
  const { data: watcherStatus, isError: watcherStatusError } = useQuery({
    queryKey: ["watcher-status"],
    queryFn: fetchWatcherStatus,
    refetchInterval: 60_000,
  });
  const watcherByChain = new Map(
    (watcherStatus ?? []).map((w) => [w.chain as ChainConfig["id"], w]),
  );
  const selectedWatcher = watcherByChain.get(selectedChain.id);
  const selectedChainOffline = watcherStatusError || selectedWatcher?.status !== "ok";
  const backendModeKnown = !watcherStatusError && (watcherStatus?.networkMode === "testnet" || watcherStatus?.networkMode === "mainnet");
  const backendModeMismatch = backendModeKnown && watcherStatus?.networkMode !== networkMode;
  const backendModeUnsafe = !backendModeKnown || backendModeMismatch;
  const cantonReadiness = useQuery({
    queryKey: ["canton-readiness", networkMode],
    queryFn: fetchCantonReadiness,
    refetchInterval: 15_000,
    retry: false,
  });
  const cantonReady = isCantonReadyForStaking(cantonReadiness.data, networkMode, cantonReadiness.isError, selectedChain.id);

  // Per-validator buyVoucher floor for the selected top validator, live from
  // the backend registry (the same fetch that refreshes the ValidatorShare
  // map — see ensureValidatorSharesLive). Mainnet minimums differ from the
  // testnet deployment, so only the live value is truthful.
  const validatorMinWei =
    selectedChain.id === "polygon" && validatorAddr
      ? validatorMinAmounts.get(validatorAddr.toLowerCase()) ?? null
      : null;
  const { data: aptosLockupSecs } = useQuery({
    queryKey: ["aptos-pool-lockup", validatorAddr],
    queryFn: async () => {
      const [secs] = await aptosView("0x1::stake::get_lockup_secs", [validatorAddr!]);
      return BigInt(String(secs));
    },
    enabled: selectedChain.id === "aptos" && !!validatorAddr,
    refetchInterval: 60_000,
  });

  const unbondingLabel = (() => {
    if (selectedChain.id === "aptos" && aptosLockupSecs) {
      return `Current pool lockup until ${new Date(Number(aptosLockupSecs) * 1000).toLocaleString()}; native eligibility governs withdrawal`;
    }
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
  const validatorApr = (validator: Validator): number =>
    isCosmosChain && stats && Number.isFinite(stats.baseYieldPct)
      ? Math.max(0, stats.baseYieldPct * (1 - validator.commission / 100))
      : validator.apr;

  useEffect(() => {
    let cancelled = false;
    setValidatorName(null);
    setValidatorAddr(null);
    setValidators([]);
    setValidatorLoadError(null);
    // An unavailable or walled adapter has no validator rows to load.
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
    sendTransactionAsync,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();
  const {
    isLoading: confirming,
    data: evmReceipt,
  } = useWaitForTransactionReceipt({
    hash,
    chainId: evmSubmission?.chainId,
    query: { enabled: !!hash && !!evmSubmission },
    onReplaced: ({ reason }) => {
      if (reason !== "repriced") {
        setError("The wallet cancelled or replaced the staking call. Review the replacement transaction before retrying.");
        setEvmSubmission(null);
        setStep(0);
        setShowSpark(false);
      }
    },
  });
  const settledEvmHash = successfulEvmSettlementHash(evmReceipt);
  const confirmed = !!evmSubmission && !!settledEvmHash;

  // Advance the visible step when wagmi state advances.
  useEffect(() => {
    if (!evmSubmission || selectedChain.id !== evmSubmission.chain) return;
    if (sendPending && step < 2) advance(2);
  }, [sendPending, step, evmSubmission, selectedChain.id]);

  const currentStepRef = useRef(step);

  // Keep the ref in sync with step
  useEffect(() => {
    currentStepRef.current = step;
  }, [step]);

  useEffect(() => {
    if (!evmSubmission || selectedChain.id !== evmSubmission.chain) return;
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

      // Stage 5 — wait for the exact settled tx to appear on a Bonded
      // Canton position. Marker counters do not increment on the CIP-0104
      // path, and a timer alone cannot prove the chain→Canton transition.
      const settledHash = settledEvmHash;
      if (!settledHash) return;
      let cancelled = false;
      let timeoutId: number | undefined;

      const tick = async () => {
        if (cancelled || currentStepRef.current >= 5) return;
        try {
          const positions = await fetchPositions(evmSubmission.wallet);
          const bonded = positions.some((p) =>
            p.argument.status === "Bonded" &&
            p.chainMeta?.chain === evmSubmission.chain &&
            p.chainMeta.evmTxHash?.toLowerCase() === settledHash.toLowerCase(),
          );
          if (bonded) {
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
  }, [hash, confirming, confirmed, settledEvmHash, evmSubmission, selectedChain.id]);

  useEffect(() => {
    if (evmSubmission && evmReceipt?.status === "reverted") {
      setError("The staking transaction reverted. No bonded position was created; check the transaction before retrying.");
      setStep(0);
      setShowSpark(false);
    }
  }, [evmReceipt, evmSubmission]);

  useEffect(() => {
    if (!nativeSettlement || selectedChain.id !== nativeSettlement.chain) return;
    let cancelled = false;
    let timeoutId: number | undefined;
    const tick = async () => {
      if (cancelled) return;
      try {
        const positions = await fetchPositions(nativeSettlement.wallet);
        const bonded = positions.some((position) =>
          position.argument.status === "Bonded" &&
          position.chainMeta?.chain === nativeSettlement.chain &&
          (nativeSettlement.chain === "sui" || nativeSettlement.chain === "solana"
            ? position.chainMeta.evmTxHash === nativeSettlement.txHash
            : position.chainMeta.evmTxHash?.toLowerCase() === nativeSettlement.txHash.toLowerCase()),
        );
        if (bonded) {
          cancelled = true;
          advance(5);
          setShowSpark(true);
          window.setTimeout(() => setShowSpark(false), 900);
          return;
        }
      } catch {
        // The watcher or API may lag the wallet broadcast; retry below.
      }
      timeoutId = window.setTimeout(tick, 2_000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [nativeSettlement, selectedChain.id]);

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
    if (backendModeUnsafe) {
      setError(backendModeMismatch
        ? `This page is built for ${networkMode}, but the staking backend is on ${watcherStatus?.networkMode}. Open the matching deployment before staking.`
        : "Cannot verify the staking backend's network mode yet. Wait for the connection and try again.");
      return;
    }
    if (!stakingUiReady) {
      setError(
        `${selectedChain.name} is not enabled by this deployment's staking backend.`,
      );
      return;
    }
    if (selectedChainOffline) {
      setError(
        `${selectedChain.name} is not ready — its settlement watcher has not completed a successful scan.`,
      );
      return;
    }
    if (!cantonReady) {
      setError(cantonReadiness.data?.loopStaking?.reason || "Canton is unavailable or its network mode does not match. Staking cannot begin until the ledger connection is ready.");
      return;
    }
    // Recheck immediately before starting a wallet flow, not just at the
    // last background poll or when the review dialog was opened.
    try {
      const readiness = await fetchCantonReadiness();
      if (!isCantonReadyForStaking(readiness, networkMode, false, selectedChain.id)) throw new Error("Canton unavailable for this network");
    } catch {
      setError("Canton readiness could not be confirmed. No staking transaction was submitted; try again when the ledger connection is restored.");
      return;
    }
    if (!partyId) {
      setError("Connect Loop wallet first.");
      return;
    }
    if (amountIssue) {
      setError(amountIssue);
      return;
    }

    // Pick the right wallet flow per chain.
    setEvmSubmission(null);
    if (isCosmosChain) {
      if (!cosmos.isConnected || !cosmos.address) {
        setError(
          `Connect Keplr (or Leap) to stake ${selectedChain.symbol} on ${selectedChain.name}.`,
        );
        return;
      }
      await handleCosmosStake();
      return;
    }
    if (isSuiChain) {
      if (!sui.isConnected || !sui.address) {
        setError(`Connect a Sui wallet to stake SUI on ${networkMode}.`);
        return;
      }
      await handleSuiStake();
      return;
    }
    if (isAptosChain) {
      if (!aptos.isConnected || !aptos.address) {
        setError("Connect an Aptos wallet to stake APT on this network.");
        return;
      }
      await handleAptosStake();
      return;
    }
    if (isSolanaChain) {
      if (!solana.isConnected || !solana.address) {
        setError("Connect a Solana wallet to stake SOL on this network.");
        return;
      }
      await handleSolanaStake();
      return;
    }
    if (isPolkadotChain) {
      if (!polkadot.address) { setError("Connect a Polkadot Asset Hub wallet first."); return; }
      await handlePolkadotStake();
      return;
    }
    if (!isEvmStakingReady) {
      setError(
        `${selectedChain.name} staking isn't wired in this build. Choose an enabled EVM staking network.`,
      );
      return;
    }
    if (!address) {
      setError("Connect an EVM wallet to stake on this chain.");
      return;
    }

    if (stakeAmountWei(amount) === null) { setError("Enter a positive amount with no more than 18 decimal places."); return; }
    if (selectedChain.id === "bnb" && parseEther(amount) < parseEther(String(selectedChain.minStake))) {
      setError(`Minimum stake: ${selectedChain.minStake} ${selectedChain.symbol}.`);
      return;
    }

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
    setNativeSettlement(null);
    resetSend();
    stage5PollingStartedRef.current = false;

    try {
      // Revalidate the reviewed selection before creating a request.
      const eligible = await chainAdapter.getValidators();
      const validator = eligible.find(item => item.address.toLowerCase() === validatorAddr?.toLowerCase());
      if (!validator) {
        throw new Error(
          `No ${selectedChain.name} validator is available for staking.`,
        );
      }

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
              params: [evmWalletChainParameters(wagmiChain)],
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
            `Please switch your wallet to ${walletNetworkName} and try again.`,
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
          assertEvmWalletBinding(getAccount(wagmiConfig), address, targetChainId);
          const approveHash = await sendTransactionCore(wagmiConfig, {
            account: address,
            chainId: targetChainId,
            to: approval.to,
            data: approval.data,
            value: 0n,
            ...(approval.gas ? { gas: approval.gas } : {}),
          });
          const approvalReceipt = await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId: targetChainId });
          if (approvalReceipt.status !== "success") throw new Error("The staking-token approval reverted; no staking request was created.");
          const stillNeedsApproval = await chainAdapter.buildApprovalTx?.({
            validator: validator.address, amount: amountWei, delegator: address,
          });
          if (stillNeedsApproval) throw new Error("The confirmed approval does not cover this stake amount; no staking request was created.");
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

      // All read-only validation, network switching and any ERC-20 approval
      // have succeeded. Create the Canton intent immediately before the
      // staking transaction, so a rejected preflight does not strand a
      // Pending request on the ledger.
      assertEvmWalletBinding(getAccount(wagmiConfig), address, targetChainId);
      advance(1);
      await createStakingRequest({
        evmAddress: address,
        amountPol: amount,
        delegator: partyId,
        chain: selectedChain.id,
        validator: validator.address,
      });
      recordPositionMeta(address, amount, selectedChain.id, validator.address);

      // Bind the send to the reviewed chain and owner even if the wallet
      // changes while the Canton intent is being registered.
      assertEvmWalletBinding(getAccount(wagmiConfig), address, targetChainId);
      // The fixed 30/100 gwei floor is a Bor requirement (Amoy rejects lower
      // priority fees). On the L1 settlement chain it would just overpay, so
      // let the wallet estimate there.
      const isBorChain = targetChainId === polygonAmoy.id;
      setEvmSubmission({ chain: selectedChain.id, chainId: targetChainId, wallet: address });
      await sendTransactionAsync({
        account: address,
        chainId: targetChainId,
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
          `Your wallet is on the wrong network. Switch to ${walletNetworkName} and try again. If your wallet doesn't support switching, use MetaMask or Rabby.`,
        );
      } else {
        setError(msg);
      }
      setStep(0);
    }
  }

  const confirmStake = () => runStakeAction(async () => {
    setReviewOpen(false);
    setPreparing(true);
    try { await handleStake(); }
    finally { setPreparing(false); }
  });

  // Cosmos-family staking flow — register on Canton, sign a MsgDelegate via Keplr,
  // broadcast to the selected chain. The backend watcher decodes the
  // settled MsgDelegate and accepts the StakingRequest on Canton. Stages 2/3
  // are reused: stage 2 = "signing in Keplr", stage 3 = "broadcast
  // confirmed".
  async function handleCosmosStake() {
    if (!partyId || !cosmos.address) return;

    setLog([]);
    setApproving(false);
    setStep(0);
    setShowSpark(false);
    setError(null);
    setNativeSettlement(null);

    try {
      // Validate native precision before creating an irreversible Canton
      // request; floating-point conversion can silently round micro-denoms away.
      const amountUatom = parseUnits(amount, 6);
      if (amountUatom <= 0n) throw new Error(`Enter a positive ${selectedChain.symbol} amount.`);
      const validator = (await chainAdapter.getValidators()).find(item => item.address === validatorAddr);
      if (!validator) throw new Error(`Selected ${selectedChain.name} validator is no longer available. Choose another.`);

      advance(1);
      await createStakingRequest({
        evmAddress: cosmos.address, // bech32; backend validates the selected chain
        amountPol: amount,
        delegator: partyId,
        chain: selectedChain.id,
        validator: validator.address,
      }, cosmos.signOwnership);
      recordPositionMeta(cosmos.address, amount, selectedChain.id, validator.address);

      advance(2);
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

      // Wallet broadcast is not Canton acceptance. The poller advances only
      // when this exact tx is attached to an indexed Bonded position.
      advance(4);
      setNativeSettlement({ chain: selectedChain.id as CosmosChainKey, wallet: cosmos.address, txHash: result.txHash });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(0);
    }
  }

  // Sui staking flow — request_add_stake via @mysten/dapp-kit-react. Same
  // shape as cosmos: register on Canton, sign+execute; the sui watcher
  // accepts from the decoded on-chain event.
  async function handleSuiStake() {
    if (!partyId || !sui.address) return;

    setLog([]);
    setApproving(false);
    setStep(0);
    setShowSpark(false);
    setError(null);
    setNativeSettlement(null);

    try {
      const amountMist = parseUnits(amount, 9);
      if (amountMist <= 0n) throw new Error("Enter a positive SUI amount.");
      const validator = (await chainAdapter.getValidators()).find(item => item.address === validatorAddr);
      if (!validator) throw new Error("Selected Sui validator is no longer available. Choose another.");
      await sui.assertNetwork();

      advance(1);
      await createStakingRequest({
        evmAddress: sui.address, // sui address; backend skips EVM regex for sui
        amountPol: amount,
        delegator: partyId,
        chain: "sui",
        validator: validator.address,
      }, sui.signOwnership);
      recordPositionMeta(sui.address, amount, "sui", validator.address);

      advance(2);
      const result = await sui.delegate({
        validator: validator.address,
        amountMist,
        expectedWallet: sui.address,
      });
      advance(3);

      // The Sui digest is case-sensitive; wait for the same digest in the
      // Canton position's verified on-chain proof.
      advance(4);
      setNativeSettlement({ chain: "sui", wallet: sui.address, txHash: result.digest });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(0);
    }
  }

  async function handleAptosStake() {
    if (!partyId || !aptos.address) return;
    setLog([]);
    setApproving(false);
    setStep(0);
    setShowSpark(false);
    setError(null);
    setNativeSettlement(null);

    try {
      const amountOcta = parseUnits(amount, 8);
      if (amountOcta <= 0n) throw new Error("Enter a positive APT amount.");
      const validator = (await chainAdapter.getValidators()).find(item => item.address.toLowerCase() === validatorAddr?.toLowerCase());
      if (!validator) throw new Error("Selected Aptos delegation pool is no longer active. Choose another.");
      await aptos.assertNetwork();

      advance(1);
      await createStakingRequest({
        evmAddress: aptos.address,
        amountPol: amount,
        delegator: partyId,
        chain: "aptos",
        validator: validator.address,
      }, aptos.signOwnership);
      recordPositionMeta(aptos.address, amount, "aptos", validator.address);

      advance(2);
      const tx = await chainAdapter.buildDelegateTx({ validator: validator.address, amount: amountOcta, delegator: aptos.address });
      const result = await aptos.signAndSubmit(tx, aptos.address);
      advance(3);
      advance(4);
      setNativeSettlement({ chain: "aptos", wallet: aptos.address, txHash: result.hash });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep(0);
    }
  }

  async function handleSolanaStake() {
    if (!partyId || !solana.address) return;
    const walletAddress = solana.address;
    setLog([]);
    setApproving(false);
    setStep(0);
    setShowSpark(false);
    setError(null);
    setNativeSettlement(null);
    try {
      const amountLamports = parseUnits(amount, 9);
      const validator = (await chainAdapter.getValidators()).find((item) => item.address === validatorAddr);
      if (!validator) throw new Error("Selected Solana vote account is no longer active. Choose another.");
      const prepared = await solana.prepareStake(amountLamports);
      const tx = await chainAdapter.buildDelegateTx({ validator: validator.address, amount: amountLamports, delegator: walletAddress });
      if (tx.kind !== "solana" || tx.action !== "stake") throw new Error("Invalid Solana stake transaction plan.");

      advance(1);
      const request = await createStakingRequest({
        evmAddress: walletAddress,
        amountPol: amount,
        delegator: partyId,
        chain: "solana",
        validator: validator.address,
        stakeAccountAddress: prepared.stakeAccount.publicKey.toBase58(),
      }, solana.signOwnership);
      if (!request.stakeRentLamports || BigInt(request.stakeRentLamports) !== prepared.rentLamports ||
          (process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external" && request.stakeAccountAddress !== prepared.stakeAccount.publicKey.toBase58())) {
        throw new Error("Canton request does not match the prepared Solana stake account and rent. No native stake was sent.");
      }
      recordPositionMeta(walletAddress, amount, "solana", validator.address);

      advance(2);
      const result = await solana.stake(validator.address, amountLamports, BigInt(request.stakeRentLamports), prepared.stakeAccount, walletAddress);
      advance(3);
      advance(4);
      setNativeSettlement({ chain: "solana", wallet: walletAddress, txHash: result.signature });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep(0);
    }
  }

  async function handlePolkadotStake() {
    if (!partyId || !polkadot.address) return;
    const walletAddress = polkadot.address;
    setLog([]); setApproving(false); setStep(0); setShowSpark(false); setError(null); setNativeSettlement(null);
    try {
      const amountPlanck = parseUnits(amount, polkadotNetwork.decimals);
      const validator = (await chainAdapter.getValidators()).find((item) => item.address === validatorAddr);
      if (!validator) throw new Error("Selected nomination pool is no longer open. Choose another.");
      const tx = await chainAdapter.buildDelegateTx({ validator: validator.address, amount: amountPlanck, delegator: walletAddress });
      if (tx.kind !== "substrate" || tx.method !== "nominationPools.join") throw new Error("Invalid Polkadot pool-join plan.");
      advance(1);
      await createStakingRequest({ evmAddress: walletAddress, amountPol: amount, delegator: partyId,
        chain: "polkadot", validator: validator.address }, polkadot.signOwnership);
      recordPositionMeta(walletAddress, amount, "polkadot", validator.address);
      advance(2);
      const result = await polkadot.stake(Number(validator.address.slice(5)), amountPlanck, walletAddress);
      advance(3); advance(4);
      setNativeSettlement({ chain: "polkadot", wallet: walletAddress, txHash: result.hash });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause)); setStep(0);
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
  const sortedValidators = [...validators].sort((a, b) => validatorSort === "apr" ? validatorApr(b) - validatorApr(a) : validatorSort === "fee" ? a.commission - b.commission : 0);
  const tokenBalance = useReadContract({ address: stakeTokenAddress, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined,
    chainId: selectedChain.wagmiChain?.id, query: { enabled: !!address && selectedChain.id === "polygon", refetchInterval: 30_000 } });
  const nativeBalance = useBalance({
    address,
    chainId: selectedChain.wagmiChain?.id,
    query: { enabled: !!address && selectedChain.id !== "polygon" && !!selectedChain.wagmiChain, refetchInterval: 30_000 },
  });
  const polygonNativeBalance = useBalance({
    address,
    chainId: polygonNativeChain.id,
    query: { enabled: !!address && selectedChain.id === "polygon", refetchInterval: 30_000 },
  });
  const settlementGasBalance = useBalance({
    address,
    chainId: polygonId,
    query: { enabled: !!address && selectedChain.id === "polygon", refetchInterval: 30_000 },
  });
  const cosmosBalance = useQuery({
    queryKey: ["cosmos-balance", selectedChain.id, cosmos.address],
    queryFn: async () => {
      if (!isCosmosChain || !cosmos.address) return 0n;
      const network = cosmosNetworks[selectedChain.id as CosmosChainKey];
      const { readCosmosBalance } = await import("@/lib/cosmos/staking-queries");
      return readCosmosBalance(network, cosmos.address);
    },
    enabled: isCosmosChain && !!cosmos.address,
    refetchInterval: 30_000,
  });
  const aptosBalance = useQuery({
    queryKey: ["aptos-balance", aptos.address],
    queryFn: async () => {
      if (!aptos.address) return 0n;
      const [amount] = await aptosView("0x1::coin::balance", [aptos.address], ["0x1::aptos_coin::AptosCoin"]);
      return BigInt(String(amount ?? "0"));
    },
    enabled: isAptosChain && !!aptos.address,
    refetchInterval: 30_000,
  });
  const solanaParams = useQuery({
    queryKey: ["solana-stake-params", selectedChain.id],
    queryFn: async () => {
      await solana.assertNetwork();
      const [minimum, rent] = await Promise.all([
        solana.connection.getStakeMinimumDelegation({ commitment: "finalized" }),
        solana.connection.getMinimumBalanceForRentExemption(200),
      ]);
      return { minimumLamports: BigInt(minimum.value), rentLamports: BigInt(rent) };
    },
    enabled: isSolanaChain && solana.isConnected,
    refetchInterval: 60_000,
  });
  const solanaBalance = useQuery({
    queryKey: ["solana-balance", solana.address],
    queryFn: async () => BigInt(await solana.connection.getBalance(new PublicKey(solana.address!), "finalized")),
    enabled: isSolanaChain && !!solana.address,
    refetchInterval: 30_000,
  });
  const polkadotParams = useQuery({
    queryKey: ["polkadot-pool-params", selectedChain.id],
    queryFn: fetchPolkadotPools,
    enabled: isPolkadotChain,
    refetchInterval: 60_000,
  });
  const polkadotBalance = useQuery({
    queryKey: ["polkadot-balance", polkadot.address],
    queryFn: async () => {
      const api = await polkadotApi();
      const account = (await api.query.system.account(polkadot.address!)).toJSON() as { data?: { free?: string | number } };
      return BigInt(String(account.data?.free ?? 0));
    },
    enabled: isPolkadotChain && !!polkadot.address,
    refetchInterval: 30_000,
  });
  const balanceWei = selectedChain.id === "polygon" ? tokenBalance.data : nativeBalance.data?.value;
  const balanceFailed = selectedChain.id === "polygon" ? tokenBalance.isError : nativeBalance.isError;
  const amountWei = stakeAmountWei(amount);
  const cosmosAmount = isCosmosChain && /^\d+(?:\.\d{0,6})?$/.test(amount) ? parseUnits(amount, 6) : null;
  const aptosAmount = isAptosChain && /^\d+(?:\.\d{0,8})?$/.test(amount) ? parseUnits(amount, 8) : null;
  const solanaAmount = isSolanaChain && /^\d+(?:\.\d{0,9})?$/.test(amount) ? parseUnits(amount, 9) : null;
  const polkadotAmount = isPolkadotChain && /^\d+(?:\.\d{0,10})?$/.test(amount) ? parseUnits(amount, polkadotNetwork.decimals) : null;
  const cosmosFeeReserve = isCosmosChain ? BigInt(Math.ceil(200_000 * cosmosNetworks[selectedChain.id as CosmosChainKey].gasPrice)) : 0n;
  const amountIssue = amountWei === null ? "Enter a positive amount (up to 18 decimal places)."
    : (amount.split(".")[1] ?? "").replace(/0+$/, "").length > 10 ? "Canton staking supports at most 10 nonzero decimal places."
    : isCosmosChain && !/^\d+(?:\.\d{0,6})?$/.test(amount) ? `${selectedChain.symbol} supports at most 6 decimal places.`
    : selectedChain.id === "sui" && !/^\d+(?:\.\d{0,9})?$/.test(amount) ? "SUI supports at most 9 decimal places."
    : isAptosChain && !/^\d+(?:\.\d{0,8})?$/.test(amount) ? "APT supports at most 8 decimal places."
    : isSolanaChain && !/^\d+(?:\.\d{0,9})?$/.test(amount) ? "SOL supports at most 9 decimal places."
    : isPolkadotChain && !/^\d+(?:\.\d{0,10})?$/.test(amount) ? `${polkadotNetwork.symbol} supports at most 10 decimal places in Canton staking.`
    : validatorMinWei !== null && amountWei < validatorMinWei ? `Minimum stake: ${formatUnits(validatorMinWei, 18)} ${selectedChain.symbol}.`
    : selectedChain.id === "bnb" && amountWei < parseEther(String(selectedChain.minStake)) ? `Minimum stake: ${selectedChain.minStake} ${selectedChain.symbol}.`
    : isAptosChain && aptosAmount !== null && aptosAmount < parseUnits(String(selectedChain.minStake), 8) ? `Minimum stake: ${selectedChain.minStake} APT (the pool requires at least 10 APT credited after its entry fee).`
    : isSolanaChain && solana.isConnected && solanaParams.isError ? "Solana staking minimum and rent are unavailable."
    : isSolanaChain && solana.isConnected && !solanaParams.data ? "Loading Solana staking minimum and rent…"
    : isSolanaChain && solanaAmount !== null && solanaAmount < (solanaParams.data?.minimumLamports ?? parseUnits(String(selectedChain.minStake), 9)) ? `Minimum stake: ${formatUnits(solanaParams.data?.minimumLamports ?? parseUnits(String(selectedChain.minStake), 9), 9)} SOL.`
    : isCosmosChain && cosmosAmount !== null && cosmosBalance.data !== undefined && cosmosAmount + cosmosFeeReserve > cosmosBalance.data ? `Leave at least ${formatUnits(cosmosFeeReserve, 6)} ${selectedChain.symbol} for network fees.`
    : isAptosChain && aptosAmount !== null && aptosBalance.data !== undefined && aptosAmount + 1_000_000n > aptosBalance.data ? "Leave at least 0.01 APT for network fees."
    : isSolanaChain && solanaAmount !== null && solanaBalance.data !== undefined && solanaParams.data !== undefined && solanaAmount + solanaParams.data.rentLamports + 10_000n > solanaBalance.data ? "Leave enough SOL for stake-account rent and the transaction fee."
    : isPolkadotChain && polkadotParams.isError ? "Polkadot pool minimum is unavailable."
    : isPolkadotChain && !polkadotParams.data ? "Loading Polkadot nomination pools…"
    : isPolkadotChain && polkadotAmount !== null && polkadotAmount < BigInt(polkadotParams.data?.minJoinPlanck ?? "0") ? `Minimum pool join: ${formatUnits(BigInt(polkadotParams.data!.minJoinPlanck), polkadotNetwork.decimals)} ${polkadotNetwork.symbol}.`
    : isPolkadotChain && polkadotAmount !== null && polkadotBalance.data !== undefined && polkadotAmount >= polkadotBalance.data ? `Leave ${polkadotNetwork.symbol} for network fees and the existential deposit.`
    : balanceWei !== undefined && amountWei > balanceWei ? selectedChain.id === "polygon" && !isMainnet
      ? "Amount exceeds your Sepolia test POL balance. Amoy test POL cannot fund this validator stake."
      : "Amount exceeds your wallet balance."
    : selectedChain.id !== "polygon" && !!selectedChain.wagmiChain && balanceWei !== undefined && amountWei === balanceWei ? "Leave some native token for gas." : null;
  const busy = preparing || (step > 0 && step < 5);
  const walletsReady = loopConnected && !!partyId && isWalletReadyForChain;
  const balanceLabel = isCosmosChain
    ? cosmos.address
      ? cosmosBalance.data !== undefined ? `Balance: ${fmt(Number(formatUnits(cosmosBalance.data, 6)), 4)} ${selectedChain.symbol}` : cosmosBalance.isError ? "Balance unavailable" : "Loading balance…"
      : "Connect wallet for balance"
    : isAptosChain
      ? aptos.address
        ? aptosBalance.data !== undefined ? `Balance: ${fmt(Number(formatUnits(aptosBalance.data, 8)), 4)} APT` : aptosBalance.isError ? "Balance unavailable" : "Loading balance…"
        : "Connect wallet for balance"
    : isSolanaChain
      ? solana.address
        ? solanaBalance.data !== undefined ? `Balance: ${fmt(Number(formatUnits(solanaBalance.data, 9)), 4)} SOL` : solanaBalance.isError ? "Balance unavailable" : "Loading balance…"
        : "Connect wallet for balance"
    : isPolkadotChain
      ? polkadot.address
        ? polkadotBalance.data !== undefined ? `Balance: ${fmt(Number(formatUnits(polkadotBalance.data, polkadotNetwork.decimals)), 4)} ${polkadotNetwork.symbol}` : polkadotBalance.isError ? "Balance unavailable" : "Loading balance…"
        : "Connect wallet for balance"
    : isSuiChain
      ? sui.address ? "SUI balance shown in your wallet" : "Connect wallet for balance"
      : address
        ? balanceWei !== undefined ? `Balance: ${fmt(Number(formatUnits(balanceWei, 18)), 4)} ${selectedChain.id === "polygon" ? isMainnet ? "Ethereum POL" : "Sepolia test POL" : selectedChain.symbol}` : balanceFailed ? "Balance unavailable" : "Loading balance…"
        : "Connect wallet for balance";
  const formStage = !validatorAddr ? 2 : amountIssue ? 3 : 4;

  if (usesPolygonLiquid(networkMode, selectedChain.id, advancedPolygon)) return (
    <div className="page-shell account-page">
      <PolygonLiquidStake onDirect={() => setAdvancedPolygon(true)} onBusyChange={setLiquidBusy} networkPicker={
        <StakeChainPicker chains={chains} selectedChainId={selectedChain.id}
          enabledChainIds={chainStats?.chains.map(chain => chain.chain)} watchers={watcherStatus}
          statusUnavailable={chainStatsError || watcherStatusError} busy={liquidBusy} polygonLiquid
          onSelect={chain => { setSelectedChainId(chain.id); setAdvancedPolygon(false); setStep(0); setReviewOpen(false); setError(null); }} />
      } />
    </div>
  );

  return (
    <div className="page-shell account-page">
      <PageMasthead index="02" section="Stake on Canton" title="Stake." accent="Create a self-custodial staking position." description={`Delegate ${selectedChain.symbol} from your connected native wallet. Connect Loop for your Canton identity; CC rewards require a separately enabled rewards workflow.`} />
      {!isMainnet && selectedChain.id === "polygon" && <div className="my-4"><p>Advanced direct delegation: requires Sepolia test POL and Sepolia ETH for gas.</p><button className="account-button" disabled={busy} onClick={() => setAdvancedPolygon(false)}>← Use Amoy POL liquid staking</button></div>}

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
      {networkActionError && <Banner tone="warn" kind="WALLET NETWORK" message={networkActionError} />}
      {!!selectedChain.wagmiChain && !isConnected && (
        <Banner tone="warn" kind="EVM WALLET NOT CONNECTED" message={`Connect an EVM wallet to stake on ${selectedChain.name}.`} action={<Btn size="sm" variant="ghost" onClick={openPicker}>Connect wallet</Btn>} />
      )}
      {wrongNetwork && (
        <Banner
          tone="warn"
          kind="WRONG NETWORK"
          message={`Wallet on chain ${chainId ?? "unknown"}. Switch your EVM wallet to ${walletNetworkName} (chain ${selectedChain.wagmiChain!.id}) to stake here.`}
          action={
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => { void requestEvmSwitch(); }}
              disabled={switchPending}
            >
              Switch to {walletNetworkName}
            </Btn>
          }
        />
      )}
      {isCosmosChain && !cosmos.isConnected && (
        <Banner
          tone="warn"
          kind="KEPLR NOT CONNECTED"
          message={`${selectedChain.name} staking requires Keplr or Leap with ${cosmosNetworks[selectedChain.id as CosmosChainKey].chainId} enabled.`}
          action={<Btn size="sm" variant="ghost" onClick={openPicker}>Connect wallet</Btn>}
        />
      )}
      {isSuiChain && !sui.isConnected && (
        <Banner
          tone="warn"
          kind="SUI WALLET NOT CONNECTED"
          message="Sui staking requires Slush, Suiet, or another Sui wallet extension."
          action={<Btn size="sm" variant="ghost" onClick={openPicker}>Connect wallet</Btn>}
        />
      )}
      {suiUnsupportedNetwork && (
        <Banner tone="warn" kind="SUI NETWORK UNSUPPORTED" message={`This Sui wallet account does not support ${suiNetwork.name}. Switch to ${suiNetwork.name} in your wallet or connect a compatible account.`} action={<Btn size="sm" variant="ghost" onClick={openPicker}>Choose wallet</Btn>} />
      )}
      {isAptosChain && !aptos.isConnected && (
        <Banner tone="warn" kind="APTOS WALLET NOT CONNECTED" message="Aptos staking requires Petra or another Aptos-compatible wallet." action={<Btn size="sm" variant="ghost" onClick={openPicker}>Connect wallet</Btn>} />
      )}
      {aptosWrongNetwork && (
        <Banner tone="warn" kind="WRONG APTOS NETWORK" message={`Wallet on ${aptos.network?.name ?? "unknown"} (chain ${aptos.network?.chainId ?? "unknown"}). Switch to Aptos ${aptosNetwork.name} (chain ${aptosNetwork.chainId}) before staking.`} action={<Btn size="sm" variant="ghost" disabled={aptosSwitchPending} onClick={() => { void requestAptosSwitch(); }}>{aptosSwitchPending ? "Switching…" : `Switch to ${aptosNetwork.name}`}</Btn>} />
      )}
      {isSolanaChain && !solana.isConnected && (
        <Banner tone="warn" kind="SOLANA WALLET NOT CONNECTED" message="Solana staking requires Phantom, Solflare, or another Solana wallet." action={<Btn size="sm" variant="ghost" onClick={openPicker}>Connect wallet</Btn>} />
      )}
      {isSolanaChain && solana.isConnected && (
        <Banner tone="warn" kind="CHECK SOLANA NETWORK" message={`The app uses ${solanaNetwork.name}, but your wallet does not report its active cluster to this app. Switch to ${solanaNetwork.name} in your wallet if needed before signing.`} />
      )}
      {isPolkadotChain && !polkadot.isConnected && (
        <Banner tone="warn" kind="POLKADOT WALLET NOT CONNECTED" message="Polkadot nomination pools run on Asset Hub. Connect Talisman, SubWallet, or Polkadot.js." action={<Btn size="sm" variant="ghost" onClick={openPicker}>Connect wallet</Btn>} />
      )}
      {isPolkadotChain && (
        <Banner tone="warn" kind="NOMINATION POOL" message={isMainnet
          ? "Stake DOT held on Polkadot Asset Hub, not the relay chain. You join a pool, not an individual validator; estimated yield is not pool-specific."
          : "Stake WND held on Westend Asset Hub, not the relay chain. WND is a testnet token with no cash value; pool yield is only an estimate."} />
      )}

      <nav className="stake-stepper account-stake-stepper" aria-label="Staking workflow">
        {[["01", "Select chain", "stake-chain"], ["02", "Choose token", "stake-token"], ["03", isPolkadotChain ? "Pick pool" : "Pick validator", "stake-validator"], ["04", "Enter amount", "stake-amount"], ["05", "Review & sign", "stake-review"]].map(([number, label, target], index) => <a href={`#${target}`} key={number} className={`stake-stepper__item${index <= formStage ? " stake-stepper__item--active" : ""}`} aria-current={index === formStage ? "step" : undefined}><span>{number}</span><div><strong>{label}</strong><small>{index < formStage ? "Ready" : index === formStage ? "Current step" : "Up next"}</small></div></a>)}
      </nav>
      <div className="account-stake-workspace">
        <AccountPanel title="01 · Select chain" icon="link" description="Choose a network and its native staking flow." id="stake-chain">
          <StakeChainPicker chains={chains} selectedChainId={selectedChain.id}
            enabledChainIds={chainStats?.chains.map(chain => chain.chain)} watchers={watcherStatus}
            statusUnavailable={chainStatsError || watcherStatusError} busy={busy} polygonLiquid={!isMainnet && selectedChain.id !== "polygon"}
            onSelect={chain => { setSelectedChainId(chain.id); setAdvancedPolygon(false); setStep(0); setReviewOpen(false); setError(null); }} />
          <p className="account-muted">{selectedChain.type}</p>
          <dl className="account-definition"><div><dt>Settlement</dt><dd>{selectedChain.wagmiChain?.name ?? selectedChain.name}</dd></div><div><dt>Unbond period</dt><dd>{unbondingLabel}</dd></div></dl>
        </AccountPanel>
        <AccountPanel title="02 · Choose token" icon="coin" description="Native token for this staking flow." id="stake-token">
          <div className="account-token-selected"><ChainBadge chainId={selectedChain.id} symbol={selectedChain.symbol} label={selectedChain.symbol} /><StatusBadge status="Selected" /></div>
          <p className="account-muted">Stake {selectedChain.symbol} from your wallet. Native yield follows the selected network; CC rewards depend on the enabled Canton rewards workflow.</p>
          <dl className="account-definition"><div><dt>Token standard</dt><dd>{selectedChain.id === "polygon" ? "ERC-20" : selectedChain.symbol}</dd></div><div><dt>Current price</dt><dd>{fmtUsd(chainPriceUsd, 4)}</dd></div><div><dt>Price source</dt><dd>{prices?.source.pol === "coingecko" ? "Market price" : "Reference price"}</dd></div><div><dt>Staking network</dt><dd>{selectedChain.wagmiChain?.name ?? selectedChain.name}</dd></div></dl>
          {selectedChain.id === "polygon" && <a className="account-button" href={`${isMainnet ? "https://etherscan.io" : "https://sepolia.etherscan.io"}/token/${stakeTokenAddress}`} target="_blank" rel="noreferrer">View token ↗</a>}
        </AccountPanel>
        <AccountPanel title={isPolkadotChain ? "03 · Pick pool" : "03 · Pick validator"} icon="shield" description={isPolkadotChain ? "Select an open Asset Hub nomination pool." : "Select a validator to delegate to."} id="stake-validator">
          <label><span className="sr-only">Sort validators</span><select className="account-field" aria-label="Sort validators" value={validatorSort} onChange={event => setValidatorSort(event.target.value)} disabled={busy}><option value="rank">{isPolkadotChain ? "Largest pools" : "Recommended order"}</option><option value="fee">Lowest commission</option></select></label>
          <div className="account-validator-options" role="group" aria-label="Available validators">{sortedValidators.map((validator) => <button key={validator.address} className="account-validator-option" aria-pressed={validatorAddr === validator.address} disabled={busy} onClick={() => { setValidatorAddr(validator.address); setValidatorName(validator.name); }}>
            <span className="account-validator-avatar" aria-hidden="true">{validator.name.slice(0, 1)}</span><span><strong>{validator.name}</strong><small>{shortId(validator.address)}</small><small>{Number.isFinite(validator.uptime) ? `${validator.uptime.toFixed(1)}% uptime` : isPolkadotChain ? "Nomination pool" : "Validator"}</small></span><span><b>{validatorApr(validator) > 0 ? `${validatorApr(validator).toFixed(1)}%` : "—"}</b><small>Est. APR</small><small>{validator.commission}% fee</small></span><span className="account-validator-check" aria-hidden="true">{validatorAddr === validator.address ? "✓" : "○"}</span>
          </button>)}</div>
          {!validators.length && <AccountEmpty>{validatorLoadError || "Loading available validators…"}</AccountEmpty>}
          <p className="account-muted">{isPolkadotChain ? "Pool commission is live. A dash means pool-specific APR is unavailable; pool size is not a yield recommendation." : "Commission is set by each validator. A dash means measured validator APR is unavailable."}</p>
        </AccountPanel>
        <div className="account-stack">
          <AccountPanel title="04 · Enter amount" icon="wallet" description={`Set the amount of ${selectedChain.symbol} to stake.`} id="stake-amount">
            {selectedChain.id === "polygon" && address && <p className="account-muted account-connected-wallet" title={address}>Connected wallet: {shortId(address)}</p>}
            <div className="account-amount-balance"><span>{balanceLabel}</span><button className="account-button" disabled={busy || tokenBalance.data === undefined || selectedChain.id !== "polygon"} onClick={() => setAmount(formatUnits(tokenBalance.data!, 18))}>Max</button></div>
            {selectedChain.id === "polygon" && address && <p className="account-muted account-network-balances">
              <span>{isMainnet ? "Polygon PoS POL" : "Amoy test POL"}: {polygonNativeBalance.data ? fmt(Number(formatUnits(polygonNativeBalance.data.value, 18)), 4) : polygonNativeBalance.isError ? "unavailable" : "loading…"}</span>
              <span>{isMainnet ? "Ethereum ETH" : "Sepolia ETH"} for gas: {settlementGasBalance.data ? fmt(Number(formatUnits(settlementGasBalance.data.value, 18)), 4) : settlementGasBalance.isError ? "unavailable" : "loading…"}</span>
            </p>}
            <label className="account-stake-amount"><span className="sr-only">Stake amount</span><input aria-label="Stake amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /><span>{selectedChain.symbol}</span></label>
            <p className="account-muted">{isPolkadotChain && !isMainnet ? "WND is a testnet token with no USD value." : `≈ ${Number.isFinite(usdValue) ? fmtUsd(usdValue, 2) : "—"} USD · estimated`}</p>
            {amountIssue && <p role="status" className="account-amount-warning">{amountIssue}</p>}
            {!isMainnet && <details className="account-funding"><summary>Need testnet funds?</summary><p>{FUNDING_HINTS[selectedChain.id]}</p></details>}
          </AccountPanel>
          <AccountPanel title="05 · Review rewards" icon="activity" description="Native yield and Canton allocations." id="stake-review">
            <div className="account-dual-rewards"><div className="account-yield-card"><span aria-hidden="true"><AccountIcon name="stack" /></span><div><small>NATIVE VALIDATOR YIELD</small><strong>{selectedValidator && validatorApr(selectedValidator) > 0 ? `${validatorApr(selectedValidator).toFixed(1)}%` : nativeApy !== null ? `${nativeApy.toFixed(1)}%` : "—"}</strong><small>Estimated APR</small></div></div><div className="account-yield-card account-yield-card--cc"><span aria-hidden="true"><AccountIcon name="coin" /></span><div><small>CANTON COIN REWARDS</small><strong>When enabled</strong><small>Based on actual attribution</small></div></div></div>
          </AccountPanel>
          <SplitPanel compact />
        </div>
      </div>
      <div className="account-stake-bottom">
        <AccountPanel title="Transaction flow preview" icon="activity" description="You sign in your wallet. Native confirmation is recorded on Canton.">
          <div className="account-transaction-flow"><div><AccountIcon name="wallet" /><strong>1. Approve & sign</strong><p>Approve the staking token if needed, then sign the delegation.</p></div><div><AccountIcon name="clock" /><strong>2. Wait for confirmation</strong><p>The native-chain watcher observes the confirmed staking event.</p></div><div><AccountIcon name="cube" /><strong>3. Record on Canton</strong><p>Your position and lifecycle activity are recorded on-ledger.</p></div></div>
        </AccountPanel>
        <div className="account-stake-submit">
          <button
            className="account-button account-button--primary"
            disabled={busy || switchPending || aptosSwitchPending || backendModeUnsafe || selectedChainOffline || !stakingUiReady || !cantonReady || (walletsReady && (!!amountIssue || !validatorAddr))}
            onClick={() => {
              if (wrongNetwork) void requestEvmSwitch();
              else if (aptosWrongNetwork) void requestAptosSwitch();
              else if (!walletsReady) openPicker();
              else setReviewOpen(true);
            }}
          >
            {busy ? ctaLabel : backendModeMismatch ? "Network mode mismatch" : backendModeUnsafe ? "Checking network mode" : !cantonReady ? cantonReadiness.isPending ? "Checking Canton" : "Canton unavailable" : selectedChainOffline ? "Staking watcher unavailable" : wrongNetwork ? `Switch to ${walletNetworkName}` : aptosWrongNetwork ? `Switch to Aptos ${aptosNetwork.name}` : suiUnsupportedNetwork ? `Choose a ${suiNetwork.name} Sui wallet` : !walletsReady ? "Connect wallets to stake" : step === 5 ? "Review another stake →" : "Review & stake →"}
          </button>
          {backendModeMismatch && <p role="alert" className="account-amount-warning">This page is built for {networkMode}, but the staking backend is on {watcherStatus?.networkMode}. Open the matching deployment before staking.</p>}
          {!cantonReady && !cantonReadiness.isPending && <p role="status" className="account-amount-warning">Networks are available to explore, but staking is paused until the Canton ledger connection is ready for {networkMode}.</p>}
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
        <p className="account-muted">{selectedChain.id === "polygon" ? "Your wallet will ask you to approve POL if needed, then sign the staking transaction." : `Your wallet will ask you to sign the ${selectedChain.symbol} staking transaction.`} Network fees are shown by your wallet.</p>
        {isMainnet && <p className="account-amount-warning">Mainnet transaction · real funds</p>}
        <footer><button className="account-button" onClick={() => setReviewOpen(false)}>Back</button><button className="account-button account-button--primary" disabled={!walletsReady || !!amountIssue || !validatorAddr || busy || backendModeUnsafe || selectedChainOffline || !stakingUiReady || !cantonReady} onClick={() => { void confirmStake(); }}>Confirm & open wallet →</button></footer>
      </dialog>
    </div>
  );
}
