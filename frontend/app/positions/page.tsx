"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContract, useSendTransaction, useSwitchChain } from "wagmi";
import { getAccount, waitForTransactionReceipt } from "@wagmi/core";
import { BaseError, UserRejectedRequestError, parseAbi, parseEther, parseUnits } from "viem";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import {
  fetchPositions,
  fetchRewards,
  fetchWatcherStatus,
  sweepNativeRewards,
  type PositionRow,
} from "@/lib/api";
import { liveChains } from "@/lib/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { adapterFor } from "@/lib/chains/index";
import { fetchStakingParams } from "@/lib/chains/polygon";
import { monadStakingContract } from "@/lib/chains/monad";
import { fmt, fmtUsd } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { accountChain, liquidUsd, positionUsd, shortId, totalPositionUsd, validatorLabel } from "@/lib/account-view";
import { AccountEmpty, AccountLink, AccountMetric, AccountPanel, ChainBadge, LifecycleRail, StatusBadge, WalletNotice } from "@/components/account/AccountUI";
import { lookupPositionMeta } from "@/lib/position-chain-map";
import { useCosmosWallet } from "@/lib/cosmos/use-cosmos-wallet";
import { isCosmosChainKey, type CosmosChainKey } from "@/lib/cosmos/networks";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { useAptosWallet } from "@/lib/aptos/use-aptos-wallet";
import { aptosPendingWithdrawal, aptosView } from "@/lib/aptos/network";
import { useSolanaWallet } from "@/lib/solana/use-solana-wallet";
import { usePolkadotWallet } from "@/lib/polkadot/use-polkadot-wallet";
import { polkadotApi, polkadotNetwork } from "@/lib/polkadot/network";
import { PublicKey } from "@solana/web3.js";
import { readSolanaStakeActivation } from "@/lib/solana/stake-activation";
import { tokens } from "@/lib/tokens";
import { networkMode } from "@/lib/network";
import { assertEvmWalletBinding } from "@/lib/wallet-binding";
import { createExclusiveAction } from "@/lib/exclusive-action";
import { successfulEvmSettlementHash } from "@/lib/evm-settlement";
import { LiquidHoldings, useLiquidHoldings } from "@/components/account/LiquidHoldings";
import { LidoHoldings } from "@/components/account/LidoHoldings";
import { filterPositionList, positionList } from "@/lib/position-list";
import { LoopPendingRequests } from "@/components/account/LoopPendingRequests";
import { LoopUnbondRecovery } from "@/components/account/LoopUnbondRecovery";
import { approveLoopPositionUnbond } from "@/lib/canton/loop-staking-flow";

/**
 * Positions — staking lifecycle view with Unbond and Claim actions.
 *
 * Each position moves through: Pending → Bonded → Unbonding → Released
 *
 * Actions available:
 * - Bonded: Sweep (claim native rewards), Unbond (start unstaking)
 * - Unbonding: Claim (withdraw after unbonding period expires)
 * - Released: No actions (lifecycle complete)
 */

type Lifecycle = "bonded" | "unbonding" | "released" | "cancelled" | "pending";

const monadEpochAbi = parseAbi([
  "function getEpoch() view returns (uint64 epoch, bool inEpochDelayPeriod)",
]);

const STATUS_TO_LIFECYCLE: Record<string, Lifecycle> = {
  Bonded: "bonded",
  Unbonding: "unbonding",
  Released: "released",
  Cancelled: "cancelled",
  Pending: "pending",
};

function lifecycleColor(l: Lifecycle): string {
  switch (l) {
    case "bonded":
      return tokens.neon;
    case "unbonding":
      return tokens.warning;
    case "released":
      return tokens.ink[300];
    case "cancelled":
      return tokens.ink[500];
    case "pending":
      return tokens.warning;
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function shortContract(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 12)}...${id.slice(-4)}`;
}

function positionChain(p: PositionRow) {
  return accountChain(p);
}

export default function PositionsPage() {
  const { address } = useAccount();
  const cosmos = useCosmosWallet("cosmos");
  const celestia = useCosmosWallet("celestia");
  const osmosis = useCosmosWallet("osmosis");
  const cosmosWallets = { cosmos, celestia, osmosis };
  const sui = useSuiWallet();
  const aptos = useAptosWallet();
  const solana = useSolanaWallet();
  const polkadot = usePolkadotWallet();
  const { switchChainAsync } = useSwitchChain();
  const { data: prices } = usePrices();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [chainFilter, setChainFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [order, setOrder] = useState("newest");
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const walletAddresses = [...new Set([address, cosmos.address, celestia.address, osmosis.address, sui.address, aptos.address, solana.address, polkadot.address].filter((value): value is string => !!value))];
  const anyWalletConnected = walletAddresses.length > 0;
  const positionsQ = useQuery({
    queryKey: ["positions", ...walletAddresses],
    queryFn: async () => {
      const batches = await Promise.all(walletAddresses.map(fetchPositions));
      return [...new Map(batches.flat().map(position => [position.contractId, position])).values()];
    },
    enabled: anyWalletConnected,
    refetchInterval: 5000,
  });
  const rewardsQ = useQuery({ queryKey: ["rewards", address], queryFn: () => fetchRewards(address!), enabled: !!address, refetchInterval: 10_000 });
  const { data: watcherStatus } = useQuery({
    queryKey: ["watcher-status"], queryFn: fetchWatcherStatus, refetchInterval: 60_000,
  });
  const backendMode = watcherStatus?.networkMode;
  const actionModeError = backendMode === networkMode ? null
    : backendMode === "testnet" || backendMode === "mainnet"
      ? `This page is built for ${networkMode}, but the staking backend is on ${backendMode}. Open the matching deployment before signing.`
      : "Cannot verify the staking backend's network mode yet. Wait for the connection before signing.";
  const positions = positionsQ.data ?? [];
  const liquid = useLiquidHoldings();
  const listed = positionList(positions, liquid.state, liquid.address);
  useEffect(() => { setSelectedId(undefined); }, [address, cosmos.address, celestia.address, osmosis.address, sui.address, aptos.address, solana.address, polkadot.address]);
  useEffect(() => {
    if (selectedId === null || !listed.length) return;
    if (selectedId !== undefined && listed.some(p => p.id === selectedId)) return;
    const requested = new URLSearchParams(window.location.search).get("position");
    setSelectedId(listed.find(p => p.id === requested)?.id ?? listed[0].id);
  }, [listed, selectedId]);
  const selected = listed.find(position => position.id === selectedId);
  const focused = selected?.kind === "validator" ? selected.position : undefined;
  const bonded = positions.filter(p => p.argument.status === "Bonded");
  const unbonding = positions.filter(p => p.argument.status === "Unbonding");
  const haveData = anyWalletConnected && !!positionsQ.data && !positionsQ.isError;
  const activeValue = haveData ? totalPositionUsd(bonded, prices) : null;
  const exitingValue = haveData ? totalPositionUsd(unbonding, prices) : null;
  const visible = filterPositionList(listed, { status, chain: chainFilter, kind: kindFilter, search, order });
  const refresh = () => { void positionsQ.refetch(); void rewardsQ.refetch(); void liquid.refetch(); };
  return <div className="page-shell account-page">
    <PageMasthead index="03" section="Positions" title="Positions." accent="Your stake, your control." description={networkMode === "testnet" ? "Monitor your liquid staking holdings and validator positions. Manage exits and follow recorded activity on Canton." : "Monitor and manage your staking positions. View bonded, unbonding, and released positions and follow their lifecycle on Canton."} />
    <WalletNotice connected={anyWalletConnected} error={positionsQ.isError || (!!address && rewardsQ.isError)} loading={anyWalletConnected && positionsQ.isLoading} onRetry={refresh} />
    <div className="account-metrics">
      <AccountMetric label="Active validator stake" value={activeValue === null ? "—" : fmtUsd(activeValue, 2)} detail="Estimated value of bonded validator positions" icon="stack" />
      <AccountMetric label="Total unbonding" value={exitingValue === null ? "—" : fmtUsd(exitingValue, 2)} detail="Estimated value awaiting release" icon="clock" color="#bb6aff" />
      <AccountMetric label="Bonded validator positions" value={haveData ? bonded.length : "—"} detail="Positions eligible for native yield" icon="cube" color="#34c6f6" />
      <AccountMetric label="Total CC earned" value={rewardsQ.data && !rewardsQ.isError ? `${fmt(rewardsQ.data.totalUserShare, 2)} CC` : "—"} detail="Your recorded beneficiary share" icon="coin" color="#f3c442" />
    </div>
    <LidoHoldings />
    <div className={`account-two-col account-positions-layout${selected ? "" : " account-positions-layout--empty"}`}>
      <AccountPanel title="Your staking positions" description="Search your positions and select one to view its details." icon="stack" action={<Link href="/stake" className="account-button">+ New stake</Link>}>
        {networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external" && <LoopPendingRequests />}
        <div className="account-filters">
          <label className="account-search"><span className="sr-only">Search positions</span><input className="account-field" aria-label="Search positions" placeholder="Search validator, chain, or position…" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <label><span className="sr-only">Position chain</span><select className="account-field" aria-label="Position chain" value={chainFilter} onChange={e => setChainFilter(e.target.value)}><option value="all">All chains</option>{[...new Map([...liveChains(), ...positions.map(accountChain)].map(chain => [chain.id, chain])).values()].map(chain => <option key={chain.id} value={chain.id}>{chain.id === "polygon" ? "Polygon PoS" : chain.name}</option>)}</select></label>
          {networkMode === "testnet" && <label><span className="sr-only">Staking type</span><select className="account-field" aria-label="Staking type" value={kindFilter} onChange={e => setKindFilter(e.target.value)}><option value="all">All staking types</option><option value="validator">Validator staking</option><option value="liquid">Liquid staking</option></select></label>}
          <label><span className="sr-only">Position status</span><select className="account-field" aria-label="Position status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All states</option>{[...(networkMode === "testnet" ? ["Active"] : []), "Pending", "Bonded", "Unbonding", "Released", "Cancelled"].map(state => <option key={state}>{state}</option>)}</select></label>
          <label><span className="sr-only">Position sort order</span><select className="account-field" aria-label="Position sort order" value={order} onChange={e => setOrder(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount">Largest amount</option></select></label>
        </div>
        {liquid.isError && <p role="status" className="account-amount-warning">Amoy liquid positions are temporarily unavailable. <button className="account-button" onClick={() => void liquid.refetch()}>Retry liquid holdings</button></p>}
        <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Chain · route</th><th>Staking type</th><th>Amount</th><th>Est. USD</th><th>Status</th><th>Details</th></tr></thead><tbody>
          {visible.map(entry => <tr key={entry.id} data-selected={entry.id === selectedId}><td><ChainBadge symbol={entry.symbol} chainId={entry.kind === "liquid" ? "polygon" : undefined} label={entry.chainName} /><small>{entry.route}</small></td><td><span className={`account-status mono ${entry.kind === "liquid" ? "account-status--liquid" : "account-status--neutral"}`}>{entry.kind === "liquid" ? "Liquid staking" : "Validator staking"}</span></td><td className="mono" title={`${entry.amount} ${entry.symbol}`}>{fmt(Number(entry.amount), entry.kind === "liquid" ? 8 : 2)} {entry.symbol}</td><td>{(() => { const usd = entry.kind === "liquid" ? liquidUsd(entry.state, prices) : positionUsd(entry.position, prices); return usd === null ? "—" : fmtUsd(usd, 2); })()}</td><td><StatusBadge status={entry.status} /></td><td><button className="account-button" aria-pressed={entry.id === selectedId} aria-label={entry.kind === "liquid" ? "View liquid staking position" : `View position ${shortId(entry.id)}`} onClick={() => setSelectedId(entry.id)}>View →</button></td></tr>)}
        </tbody></table></div>
        {!visible.length && <AccountEmpty>{!anyWalletConnected ? "Connect your wallet to view and manage your positions." : positionsQ.isLoading || liquid.isLoading ? "Loading positions…" : positionsQ.isError || liquid.isError ? "Positions are temporarily unavailable." : listed.length ? "No positions match your filters." : <>No positions yet.<AccountLink href="/stake">Explore staking routes</AccountLink></>}</AccountEmpty>}
        <div className="account-results"><span>Showing {visible.length} of {listed.length} positions</span><small>USD values are indicative.</small></div>
      </AccountPanel>
      <div className="account-stack account-position-details">
        <AccountPanel title="Position details" icon="cube" action={selected && <button className="account-button" aria-label="Close position details" onClick={() => setSelectedId(null)}>×</button>}>
          {selected?.kind === "liquid" ? <LiquidHoldings holdings={liquid} /> : focused ? <>
            <div className="account-position-heading"><ChainBadge symbol={accountChain(focused).symbol} label={accountChain(focused).id === "polygon" ? "Polygon PoS" : accountChain(focused).name} /><StatusBadge status={focused.argument.status} /></div>
            <div className="account-position-amount"><strong>{fmt(Number(focused.argument.amountPol), 2)} {accountChain(focused).symbol}</strong><span className="account-muted">{positionUsd(focused, prices) === null ? "—" : `${fmtUsd(positionUsd(focused, prices)!, 2)} estimated value`}</span></div>
            <div className="account-position-lifecycle"><h3>Staking lifecycle</h3><LifecycleRail status={focused.argument.status} /></div>
            <dl className="account-definition"><div><dt>Position ID</dt><dd className="mono" title={focused.contractId}>{shortId(focused.contractId, 14)}</dd></div><div><dt>Validator</dt><dd title={focused.chainMeta?.validatorAddress ?? ""}>{validatorLabel(focused)}</dd></div><div><dt>Bonded</dt><dd>{focused.argument.bondedAt ? new Date(focused.argument.bondedAt).toLocaleString() : "Awaiting bond"}</dd></div><div><dt>Activity markers</dt><dd>{focused.argument.markersEmitted}</dd></div><div><dt>CC beneficiary split</dt><dd>{networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external" ? "Not configured for this Loop position" : "75% delegator / 25% treasury"}</dd></div></dl>
            <div className="account-position-actions"><PositionActions key={focused.contractId} p={focused} cosmosWallets={cosmosWallets} sui={sui} aptos={aptos} solana={solana} polkadot={polkadot} switchChainAsync={switchChainAsync} modeError={actionModeError} /><AccountLink href="/rewards">View rewards</AccountLink></div>
            <details className="account-position-proof"><summary>View recorded lifecycle</summary><Timeline p={focused} /></details>
          </> : <><AccountEmpty>{listed.length ? "Select a position to inspect its details and available actions." : "Your selected position and its actions will appear here."}</AccountEmpty><LifecycleRail /></>}
        </AccountPanel>
      </div>
    </div>
  </div>;
}

function PositionActions({
  p,
  cosmosWallets,
  sui,
  aptos,
  solana,
  polkadot,
  switchChainAsync,
  modeError,
}: {
  p: PositionRow;
  cosmosWallets: Record<CosmosChainKey, ReturnType<typeof useCosmosWallet>>;
  sui: ReturnType<typeof useSuiWallet>;
  aptos: ReturnType<typeof useAptosWallet>;
  solana: ReturnType<typeof useSolanaWallet>;
  polkadot: ReturnType<typeof usePolkadotWallet>;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  modeError: string | null;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"sweep" | "unbond" | "claim" | "recover" | null>(null);
  const runPositionAction = useRef(createExclusiveAction()).current;

  const { address } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();

  const lifecycle = STATUS_TO_LIFECYCLE[p.argument.status] ?? "pending";
  const chain = positionChain(p);

  // Get position metadata (chain + validator)
  const meta = lookupPositionMeta(p.argument.evmAddress, p.argument.amountPol);
  const chainId = chain.id;
  const externalLoop = networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external";
  const isCosmos = isCosmosChainKey(chainId);
  const cosmos = isCosmos ? cosmosWallets[chainId] : cosmosWallets.cosmos;
  const validator = p.chainMeta?.validatorAddress ?? meta?.validator;

  // Determine available actions
  const canSweep = lifecycle === "bonded" && chain.id === "polygon";
  // Cosmos's watcher verifies MsgUndelegate and releases automatically on
  // the EndBlock completion event. Sui's immediate exit still needs a
  // transaction watcher before its action can safely be enabled here.
  const lifecycleWatcherReady = ["polygon", "monad", "bnb", "cosmos", "celestia", "osmosis", "aptos"].includes(chain.id) ||
    (chain.id === "solana" && !!p.chainMeta?.validatorShare) ||
    (chain.id === "polkadot" && !!p.chainMeta?.validatorShare) ||
    (chain.id === "sui" && !!p.chainMeta?.suiStakedObjectId);
  const canUnbond = lifecycle === "bonded" && !!validator && lifecycleWatcherReady;

  // Polygon's claim gate is checkpoint-based, not wall-clock:
  // `unstakeClaimTokens_new` only succeeds once
  // `unbondWithdrawEpoch + withdrawalDelay() <= epoch()`. The Daml
  // `unbondingReadyAt` is only a projection of that using the measured
  // cadence, so gating the button on it enables Claim while the adapter
  // still throws UNBONDING_PERIOD. Ask the chain for the real epoch.
  const isPolygon = chain.id === "polygon";
  const { data: stakingParams } = useQuery({
    queryKey: ["polygon-staking-params"],
    queryFn: fetchStakingParams,
    enabled: isPolygon && lifecycle === "unbonding",
    staleTime: 60_000,
  });
  const { data: monadEpoch } = useReadContract({
    address: monadStakingContract,
    abi: monadEpochAbi,
    functionName: "getEpoch",
    chainId: chain.wagmiChain?.id,
    query: { enabled: chain.id === "monad" && lifecycle === "unbonding", refetchInterval: 10_000 },
  });
  const { data: aptosPending, isError: aptosPendingError } = useQuery({
    queryKey: ["aptos-pending-withdrawal", validator, p.argument.evmAddress],
    queryFn: async () => {
      return aptosPendingWithdrawal(await aptosView("0x1::delegation_pool::get_pending_withdrawal", [validator!, p.argument.evmAddress]));
    },
    enabled: chain.id === "aptos" && lifecycle === "unbonding" && !!validator,
    refetchInterval: 15_000,
  });
  const solanaStakeAccount = chain.id === "solana" ? p.chainMeta?.validatorShare : null;
  const { data: solanaActivation, isError: solanaActivationError } = useQuery({
    queryKey: ["solana-stake-activation", solanaStakeAccount],
    queryFn: () => readSolanaStakeActivation(new PublicKey(solanaStakeAccount!)),
    enabled: chain.id === "solana" && lifecycle === "unbonding" && !!solanaStakeAccount,
    refetchInterval: 15_000,
  });
  const { data: polkadotExit, isError: polkadotExitError } = useQuery({
    queryKey: ["polkadot-exit", p.argument.evmAddress, p.chainMeta?.validatorShare],
    queryFn: async () => {
      const api = await polkadotApi();
      const member = (await api.query.nominationPools.poolMembers(p.argument.evmAddress)).toJSON() as
        { poolId?: number; points?: string | number; unbondingEras?: Record<string, unknown> } | null;
      const poolId = Number(p.chainMeta!.validatorShare!.slice(5));
      if (!member || member.poolId !== poolId || BigInt(String(member.points ?? 0)) !== 0n) {
        return { ready: false, reason: "Polkadot pool position is not fully unbonded." };
      }
      const eraValue = (await api.query.staking.currentEra()).toJSON();
      const era = eraValue === null ? -1 : Number(eraValue);
      const eras = Object.keys(member.unbondingEras ?? {}).map(Number);
      return era >= 0 && eras.length > 0 && eras.every((item) => Number.isSafeInteger(item) && item <= era)
        ? { ready: true, reason: null }
        : { ready: false, reason: "Waiting for Polkadot Asset Hub unbonding eras." };
    },
    enabled: chain.id === "polkadot" && lifecycle === "unbonding" && !!p.chainMeta?.validatorShare,
    refetchInterval: 15_000,
  });

  const claimGate: { ready: boolean; reason: string | null } = (() => {
    if (lifecycle !== "unbonding") return { ready: false, reason: null };
    if (!lifecycleWatcherReady) return { ready: false, reason: "Native exit tracking is not available for this chain yet." };
    if (isCosmos) return { ready: false, reason: `${chain.symbol} releases automatically when the unbonding period ends.` };
    if (chain.id === "aptos") {
      if (aptosPendingError) return { ready: false, reason: "Aptos withdrawal status is unavailable." };
      if (!aptosPending) return { ready: false, reason: "checking Aptos lockup…" };
      return aptosPending.ready && aptosPending.amount > 0n
        ? { ready: true, reason: null }
        : { ready: false, reason: "Aptos lockup has not ended." };
    }
    if (chain.id === "solana") {
      if (!solanaStakeAccount) return { ready: false, reason: "Solana stake-account binding is unavailable." };
      if (solanaActivationError) return { ready: false, reason: "Solana stake activation is unavailable." };
      if (!solanaActivation) return { ready: false, reason: "Checking Solana cooldown…" };
      return solanaActivation.state === "inactive"
        ? { ready: true, reason: null }
        : { ready: false, reason: `Solana stake is ${solanaActivation.state}; wait for cooldown.` };
    }
    if (chain.id === "polkadot") {
      if (polkadotExitError) return { ready: false, reason: "Polkadot exit status is unavailable." };
      return polkadotExit ?? { ready: false, reason: "Checking Polkadot unbonding eras…" };
    }

    if (chain.id === "monad") {
      const activationEpoch = p.chainMeta?.unbondWithdrawEpoch;
      if (!activationEpoch || !monadEpoch) return { ready: false, reason: "checking Monad epoch…" };
      const readyEpoch = BigInt(activationEpoch) + 1n;
      return monadEpoch[0] >= readyEpoch
        ? { ready: true, reason: null }
        : { ready: false, reason: `${readyEpoch - monadEpoch[0]} more Monad epoch(s)` };
    }

    // BNB stores a Unix-second ETA in Daml. It enables the wallet
    // action only; the backend still requires a settled claim/withdraw event
    // before changing the Canton position to Released.
    if (!isPolygon) {
      const ts = p.argument.unbondingReadyAt;
      const parsed = ts && /^\d+$/.test(ts)
        ? new Date(Number(ts) * (Number(ts) < 1_000_000_000_000 ? 1000 : 1))
        : ts ? new Date(ts) : null;
      return {
        ready: chain.hasAdapter !== false && !!parsed && Number.isFinite(parsed.getTime()) && parsed <= new Date(),
        reason: null,
      };
    }

    const withdrawEpoch = p.chainMeta?.unbondWithdrawEpoch;
    if (!stakingParams || !withdrawEpoch) {
      // Never optimistically enable: without the real epoch we cannot prove
      // claimability, and guessing is what produced the failing button.
      return { ready: false, reason: "checking checkpoint progress…" };
    }

    const claimableAt =
      BigInt(withdrawEpoch) + BigInt(stakingParams.withdrawalDelayEpochs);
    const current = BigInt(stakingParams.currentEpoch);
    if (current >= claimableAt) return { ready: true, reason: null };

    const remaining = Number(claimableAt - current);
    const eta = stakingParams.checkpointCadenceSeconds
      ? ` (~${Math.round(
          (remaining * stakingParams.checkpointCadenceSeconds) / 3600,
        )}h)`
      : "";
    return {
      ready: false,
      reason: `${remaining} more checkpoint${remaining === 1 ? "" : "s"}${eta}`,
    };
  })();

  const canClaim = claimGate.ready;
  const hasActions = canSweep || canUnbond || canClaim;
  const actionUnavailable = lifecycle === "bonded" && !lifecycleWatcherReady
    ? chain.id === "sui"
      ? "This Sui stake has no verified receipt ID; unstake tracking is unavailable."
      : "Native exit tracking is not available for this chain yet."
    : null;

  // Sweep mutation (claim native rewards)
  const sweepMut = useMutation({
    mutationFn: () => {
      if (modeError) throw new Error(modeError);
      return sweepNativeRewards(p.contractId);
    },
    onSuccess: (res) => {
      const native =
        res &&
        typeof res === "object" &&
        "sweep" in res &&
        res.sweep &&
        typeof res.sweep === "object" &&
        "userPayoutPol" in res.sweep
          ? (res.sweep as { userPayoutPol: number }).userPayoutPol
          : null;
      setOkMsg(
        native !== null
          ? `swept ${native.toFixed(4)} ${chain.symbol}`
          : "sweep recorded",
      );
      setError(null);
      void qc.invalidateQueries({ queryKey: ["positions"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-rewards"] });
      setTimeout(() => setOkMsg(null), 3000);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : String(err)),
  });

  // Unbond handler
  const handleUnbond = () => runPositionAction(async () => {
    if (modeError) { setError(modeError); return; }
    if (!validator) return;
    if (!lifecycleWatcherReady) {
      setError("Native exit tracking is not available for this chain yet.");
      return;
    }
    setError(null);
    setOkMsg(null);
    setPendingAction("unbond");

    try {
      const adapter = adapterFor(chainId);
      const amountWei = parseEther(p.argument.amountPol);

      // Check chain type
      const isSui = chainId === "sui";
      const isEvm = !!chain.wagmiChain;
      if (externalLoop && !["polygon", "monad", "bnb", "solana", "aptos", "polkadot"].includes(chainId) && !isCosmos && !isSui) {
        throw new Error("Loop/native unbond ownership verification is not enabled for this network yet.");
      }

      if (isCosmos) {
        if (!cosmos.isConnected || !cosmos.address || cosmos.address.toLowerCase() !== p.argument.evmAddress.toLowerCase()) {
          setError("Connect Keplr wallet first");
          return;
        }
        const nativeGuardKey = `cantonstake:loop-testnet:native-unbond:${p.argument.delegator}:${p.contractId}`;
        if (externalLoop && localStorage.getItem(nativeGuardKey)) {
          throw new Error("A native unbond was already attempted for this position. Check its recorded receipt before retrying; no second transaction was sent.");
        }
        const tx = await adapter.buildUndelegateTx({
          validator,
          amount: parseUnits(p.argument.amountPol, 6),
          delegator: cosmos.address,
        });
        if (tx.kind !== "cosmos") {
          throw new Error("Unexpected tx kind");
        }
        if (externalLoop) await approveLoopPositionUnbond({ contractId: p.contractId, delegator: p.argument.delegator,
          evmAddress: p.argument.evmAddress, amount: p.argument.amountPol, chain: chainId, validator });
        const result = await cosmos.signAndBroadcast({
          typeUrl: tx.typeUrl,
          value: tx.value,
        }, {
          expectedWallet: p.argument.evmAddress,
          ...(externalLoop ? { onBeforeBroadcast: (hash: string) => {
            if (localStorage.getItem(nativeGuardKey)) throw new Error("A native unbond attempt appeared during signing; reconcile it before sending another.");
            localStorage.setItem(nativeGuardKey, hash);
          } } : {}),
        });
        setOkMsg(`Unbonding... tx: ${result.txHash.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        // Refresh positions after a delay
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (chainId === "aptos") {
        if (!aptos.isConnected || !aptos.address || aptos.address.toLowerCase() !== p.argument.evmAddress.toLowerCase()) {
          throw new Error("Connect the Aptos wallet that owns this position.");
        }
        const tx = await adapter.buildUndelegateTx({
          validator,
          amount: parseUnits(p.argument.amountPol, 8),
          delegator: aptos.address,
        });
        const nativeGuardKey = `cantonstake:loop-testnet:native-unbond:${p.argument.delegator}:${p.contractId}`;
        if (externalLoop && localStorage.getItem(nativeGuardKey)) throw new Error("An Aptos unlock was already attempted. Check its saved hash before sending another transaction.");
        if (externalLoop) await approveLoopPositionUnbond({ contractId: p.contractId, delegator: p.argument.delegator,
          evmAddress: p.argument.evmAddress, amount: p.argument.amountPol, chain: chainId, validator });
        const result = await aptos.signAndSubmit(tx, p.argument.evmAddress, externalLoop ? {
          onBeforeBroadcast: hash => {
            if (localStorage.getItem(nativeGuardKey)) throw new Error("Another Aptos unlock attempt is already recorded.");
            localStorage.setItem(nativeGuardKey, hash);
          },
        } : undefined);
        setOkMsg(`Aptos unlock settled; awaiting Canton indexing… ${result.hash.slice(0, 10)}…`);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (chainId === "solana") {
        if (!solana.isConnected || !solana.address || solana.address !== p.argument.evmAddress) {
          throw new Error("Connect the Solana wallet that owns this position.");
        }
        const stakeAccount = p.chainMeta?.validatorShare;
        if (!stakeAccount) throw new Error("This Solana position has no verified stake-account address.");
        const tx = await adapter.buildUndelegateTx({ validator: stakeAccount, amount: parseUnits(p.argument.amountPol, 9), delegator: solana.address });
        if (tx.kind !== "solana" || tx.action !== "deactivate") throw new Error("Invalid Solana deactivate plan.");
        const nativeGuardKey = `cantonstake:loop-testnet:native-unbond:${p.argument.delegator}:${p.contractId}`;
        if (externalLoop && localStorage.getItem(nativeGuardKey)) throw new Error("A Solana deactivation was already attempted. Check its saved signature before sending another transaction.");
        if (externalLoop) await approveLoopPositionUnbond({ contractId: p.contractId, delegator: p.argument.delegator,
          evmAddress: p.argument.evmAddress, amount: p.argument.amountPol, chain: chainId, validator, validatorShare: stakeAccount });
        const result = await solana.deactivate(stakeAccount, externalLoop ? {
          expectedWallet: p.argument.evmAddress,
          onBeforeBroadcast: signature => {
            if (localStorage.getItem(nativeGuardKey)) throw new Error("Another Solana deactivation attempt is already recorded.");
            localStorage.setItem(nativeGuardKey, signature);
          },
        } : undefined);
        setOkMsg(`SOL deactivation finalized; awaiting Canton indexing… ${result.signature.slice(0, 10)}…`);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (chainId === "polkadot") {
        if (!polkadot.address || polkadot.address !== p.argument.evmAddress) throw new Error("Connect the Polkadot wallet that owns this pool position.");
        const pool = p.chainMeta?.validatorShare;
        if (!pool || !/^pool:[1-9]\d*$/.test(pool)) throw new Error("This Polkadot position has no verified pool ID.");
        const tx = await adapter.buildUndelegateTx({ validator: pool,
          amount: parseUnits(p.argument.amountPol, polkadotNetwork.decimals), delegator: polkadot.address });
        if (tx.kind !== "substrate" || tx.method !== "nominationPools.unbond") throw new Error("Invalid Polkadot unbond plan.");
        const nativeGuardKey = `cantonstake:loop-testnet:native-unbond:${p.argument.delegator}:${p.contractId}`;
        if (externalLoop && localStorage.getItem(nativeGuardKey)) throw new Error("A Polkadot unbond was already attempted. Reconcile its saved hash before sending another extrinsic.");
        if (externalLoop) await approveLoopPositionUnbond({ contractId: p.contractId, delegator: p.argument.delegator,
          evmAddress: p.argument.evmAddress, amount: p.argument.amountPol, chain: chainId, validator, validatorShare: pool });
        const result = await polkadot.unbond(Number(pool.slice(5)), externalLoop ? {
          expectedWallet: p.argument.evmAddress,
          onBeforeBroadcast: hash => {
            if (localStorage.getItem(nativeGuardKey)) throw new Error("Another Polkadot unbond attempt is already recorded.");
            localStorage.setItem(nativeGuardKey, hash);
          },
        } : undefined);
        if (externalLoop) localStorage.setItem(`cantonstake:loop-testnet:native-unbond-block:${p.argument.delegator}:${p.contractId}`, result.blockHash);
        setOkMsg(`Polkadot unbond finalized; awaiting Canton indexing… ${result.hash.slice(0, 10)}…`);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isSui) {
        if (!sui.isConnected || !sui.address || sui.address.toLowerCase() !== p.argument.evmAddress.toLowerCase()) {
          setError("Connect Sui wallet first");
          return;
        }
        const stakedSuiId = p.chainMeta?.suiStakedObjectId;
        if (!stakedSuiId) throw new Error("This Sui stake has no verified receipt object ID.");
        const nativeGuardKey = `cantonstake:loop-testnet:native-unbond:${p.argument.delegator}:${p.contractId}`;
        if (externalLoop && localStorage.getItem(nativeGuardKey)) throw new Error("A Sui unstake was already attempted. Check its saved digest before sending another transaction.");
        if (externalLoop) await approveLoopPositionUnbond({ contractId: p.contractId, delegator: p.argument.delegator,
          evmAddress: p.argument.evmAddress, amount: p.argument.amountPol, chain: chainId, validator,
          suiStakedObjectId: stakedSuiId });
        const result = await sui.undelegate({ stakedSuiId, expectedWallet: p.argument.evmAddress,
          ...(externalLoop ? { onBeforeBroadcast: (digest: string) => {
            if (localStorage.getItem(nativeGuardKey)) throw new Error("A Sui unstake attempt appeared during signing; reconcile it before broadcasting.");
            localStorage.setItem(nativeGuardKey, digest);
          } } : {}) });
        setOkMsg(`Unstake settled; awaiting Canton indexing… ${result.digest.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isEvm) {
        if (!address || address.toLowerCase() !== p.argument.evmAddress.toLowerCase()) {
          throw new Error(`Connect the EVM wallet that owns this ${chain.name} position.`);
        }
        // Switch to the correct chain first
        const wagmiChain = chain.wagmiChain;
        const nativeGuardKey = `cantonstake:loop-testnet:native-unbond:${p.argument.delegator}:${p.contractId}`;
        if (externalLoop && localStorage.getItem(nativeGuardKey)) {
          throw new Error(`A native unbond was already attempted for this position (${localStorage.getItem(nativeGuardKey)}). Reconcile it before retrying; no second transaction was sent.`);
        }
        if (wagmiChain) {
          await switchChainAsync({ chainId: wagmiChain.id });
        }

        const tx = await adapter.buildUndelegateTx({
          validator,
          amount: amountWei,
          delegator: address,
        });
        if (tx.kind !== "evm") {
          throw new Error("Unexpected tx kind");
        }

        assertEvmWalletBinding(getAccount(wagmiConfig), p.argument.evmAddress, wagmiChain!.id);
        if (externalLoop) {
          await approveLoopPositionUnbond({ contractId: p.contractId, delegator: p.argument.delegator,
            evmAddress: p.argument.evmAddress, amount: p.argument.amountPol, chain: chainId, validator });
          // Both wallet popups may change the active EVM account/network.
          assertEvmWalletBinding(getAccount(wagmiConfig), p.argument.evmAddress, wagmiChain!.id);
        }
        if (externalLoop) localStorage.setItem(nativeGuardKey, "submission-uncertain");
        let hash: `0x${string}`;
        try {
          hash = await sendTransactionAsync({
            account: address,
            chainId: wagmiChain!.id,
            to: tx.to,
            data: tx.data,
            value: tx.value ?? 0n,
            gas: tx.gas,
          });
        } catch (error) {
          // A definite user rejection is safe to retry; unknown RPC failures
          // may occur after broadcast and retain the retry-suppression marker.
          if (externalLoop && error instanceof BaseError &&
              error.walk(cause => cause instanceof UserRejectedRequestError) instanceof UserRejectedRequestError) {
            localStorage.removeItem(nativeGuardKey);
          }
          throw error;
        }
        if (externalLoop) localStorage.setItem(nativeGuardKey, hash);
        let replacementReason: "repriced" | "replaced" | "cancelled" | undefined;
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: wagmiChain!.id,
          onReplaced: ({ reason }) => { replacementReason = reason; } });
        if (receipt.status !== "success") {
          if (externalLoop) localStorage.removeItem(nativeGuardKey);
          throw new Error("The unbond transaction reverted.");
        }
        if (!successfulEvmSettlementHash(receipt, replacementReason)) throw new Error("The wallet cancelled or replaced the unbond call. Review the replacement before retrying.");
        if (externalLoop) localStorage.setItem(nativeGuardKey, receipt.transactionHash);
        setOkMsg("Unbond settled; awaiting Canton indexing…");
        void qc.invalidateQueries({ queryKey: ["positions"] });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  });

  // Claim handler
  const handleClaim = () => runPositionAction(async () => {
    if (modeError) { setError(modeError); return; }
    if (!validator) return;
    if (!lifecycleWatcherReady) {
      setError("Native exit tracking is not available for this chain yet.");
      return;
    }
    setError(null);
    setOkMsg(null);
    setPendingAction("claim");

    try {
      const adapter = adapterFor(chainId);
      const isEvm = !!chain.wagmiChain;

      if (isCosmos) {
        throw new Error(`${chain.name} returns principal automatically; no claim transaction is needed.`);
      } else if (chainId === "aptos") {
        if (!aptos.isConnected || !aptos.address || aptos.address.toLowerCase() !== p.argument.evmAddress.toLowerCase()) {
          throw new Error("Connect the Aptos wallet that owns this position.");
        }
        const tx = await adapter.buildClaimTx({ validator, delegator: aptos.address });
        const result = await aptos.signAndSubmit(tx, p.argument.evmAddress);
        setOkMsg(`APT withdrawal settled; awaiting Canton indexing… ${result.hash.slice(0, 10)}…`);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (chainId === "solana") {
        if (!solana.isConnected || !solana.address || solana.address !== p.argument.evmAddress) {
          throw new Error("Connect the Solana wallet that owns this position.");
        }
        const stakeAccount = p.chainMeta?.validatorShare;
        if (!stakeAccount) throw new Error("This Solana position has no verified stake-account address.");
        const tx = await adapter.buildClaimTx({ validator: stakeAccount, delegator: solana.address });
        if (tx.kind !== "solana" || tx.action !== "withdraw") throw new Error("Invalid Solana withdrawal plan.");
        const result = await solana.withdraw(stakeAccount);
        setOkMsg(`SOL withdrawal finalized; awaiting Canton indexing… ${result.signature.slice(0, 10)}…`);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (chainId === "polkadot") {
        if (!polkadot.address || polkadot.address !== p.argument.evmAddress) throw new Error("Connect the Polkadot wallet that owns this pool position.");
        const pool = p.chainMeta?.validatorShare;
        if (!pool || !/^pool:[1-9]\d*$/.test(pool)) throw new Error("This Polkadot position has no verified pool ID.");
        const tx = await adapter.buildClaimTx({ validator: pool, delegator: polkadot.address });
        if (tx.kind !== "substrate" || tx.method !== "nominationPools.withdrawUnbonded") throw new Error("Invalid Polkadot withdrawal plan.");
        const result = await polkadot.withdraw(Number(pool.slice(5)));
        setOkMsg(`Polkadot withdrawal finalized; awaiting Canton indexing… ${result.hash.slice(0, 10)}…`);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (chainId === "sui") {
        throw new Error("Sui returns principal in the unstake transaction; no separate claim exists.");
      } else if (isEvm) {
        if (!address || address.toLowerCase() !== p.argument.evmAddress.toLowerCase()) {
          throw new Error(`Connect the EVM wallet that owns this ${chain.name} position.`);
        }
        const wagmiChain = chain.wagmiChain;
        if (wagmiChain) {
          await switchChainAsync({ chainId: wagmiChain.id });
        }

        const tx = await adapter.buildClaimTx({
          validator,
          delegator: address,
        });
        if (tx.kind !== "evm") {
          throw new Error("Unexpected tx kind");
        }

        assertEvmWalletBinding(getAccount(wagmiConfig), p.argument.evmAddress, wagmiChain!.id);
        const hash = await sendTransactionAsync({
          account: address,
          chainId: wagmiChain!.id,
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          gas: tx.gas,
        });
        let replacementReason: "repriced" | "replaced" | "cancelled" | undefined;
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: wagmiChain!.id,
          onReplaced: ({ reason }) => { replacementReason = reason; } });
        if (receipt.status !== "success") throw new Error("The claim transaction reverted.");
        if (!successfulEvmSettlementHash(receipt, replacementReason)) throw new Error("The wallet cancelled or replaced the claim call. Review the replacement before retrying.");
        setOkMsg("Claim settled; awaiting Canton indexing…");
        void qc.invalidateQueries({ queryKey: ["positions"] });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  });

  const handleSweep = () => runPositionAction(async () => {
    setPendingAction("sweep");
    try { await sweepMut.mutateAsync(); }
    catch { /* mutation onError supplies the user-facing error */ }
    finally { setPendingAction(null); }
  });
  const isPending = sweepMut.isPending || pendingAction !== null;

  return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {hasActions ? (
          <div style={{ display: "flex", gap: 4 }}>
            {canSweep && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => { void handleSweep(); }}
                disabled={isPending || !!modeError}
              >
                {pendingAction === "sweep" ? "Sweeping…" : "Sweep"}
              </Btn>
            )}
            {canUnbond && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleUnbond}
                disabled={isPending || !!modeError}
                style={{ color: tokens.warning }}
              >
                {pendingAction === "unbond" ? "Unbonding…" : chain.id === "aptos" ? "Unbond all" : "Unbond"}
              </Btn>
            )}
            {canClaim && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleClaim}
                disabled={isPending || !!modeError}
                style={{ color: tokens.neon }}
              >
                {pendingAction === "claim" ? "Claiming…" : "Claim"}
              </Btn>
            )}
          </div>
        ) : claimGate.reason || actionUnavailable ? (
          // Unbonding but not yet claimable. Show the real remaining
          // checkpoint count rather than an enabled button that reverts.
          <span
            className="mono"
            style={{ fontSize: 10, color: tokens.warning }}
            title={claimGate.reason ?? actionUnavailable ?? undefined}
          >
            {claimGate.reason ?? actionUnavailable}
          </span>
        ) : (
          <span
            className="mono"
            style={{ fontSize: 10, color: tokens.ink[500] }}
          >
            —
          </span>
        )}
        {chain.id === "aptos" && canUnbond && (
          <span className="mono" style={{ fontSize: 10, color: tokens.warning }}>
            Exits your entire delegation to this pool, including rewards and any external additions.
          </span>
        )}
        {modeError ? (
          <span role="alert" className="mono" style={{ fontSize: 10, color: tokens.warning }}>{modeError}</span>
        ) : okMsg ? (
          <span
            className="mono"
            style={{ fontSize: 9, color: tokens.neon }}
          >
            {okMsg}
          </span>
        ) : error ? (
          <span
            className="mono"
            style={{ fontSize: 9, color: tokens.danger }}
          >
            {error}
          </span>
        ) : null}
        {externalLoop && (chain.wagmiChain || isCosmos || chainId === "sui" || chainId === "solana" || chainId === "aptos" || chainId === "polkadot") && validator && lifecycle === "bonded" && <LoopUnbondRecovery
          position={{ contractId: p.contractId, delegator: p.argument.delegator, evmAddress: p.argument.evmAddress,
            amount: p.argument.amountPol, chain: chainId, validator, validatorShare: p.chainMeta?.validatorShare,
            suiStakedObjectId: p.chainMeta?.suiStakedObjectId }}
          disabled={isPending || !!modeError} run={runPositionAction}
          onBusy={busy => setPendingAction(busy ? "recover" : null)}
          onResult={(message, failed) => {
            setError(failed ? message : null);
            setOkMsg(failed ? null : message);
            void qc.invalidateQueries({ queryKey: ["positions"] });
          }} />}
      </div>
  );
}

function Timeline({ p }: { p: PositionRow }) {
  const events: Array<{
    id: string;
    label: string;
    detail: string;
    t: string;
    done: boolean;
    kind: "CANTON" | "POLYGON" | "MARKER";
  }> = [
    {
      id: "request",
      label: "Request created",
      detail: "Canton contract created for this staking intent.",
      t: relativeTime(p.argument.bondedAt),
      done: true,
      kind: "CANTON",
    },
    {
      id: "bond",
      label: "Bonded",
      detail: `${positionChain(p).symbol} delegation confirmed on ${positionChain(p).name} · contract ${shortContract(p.contractId)}`,
      t: relativeTime(p.argument.bondedAt),
      done: !!p.argument.bondedAt,
      kind: "POLYGON",
    },
    {
      id: "marker",
      label: "Marker emitted",
      detail: `${p.argument.markersEmitted} Canton activity marker${
        p.argument.markersEmitted === 1 ? "" : "s"
      } recorded for Featured App reward accounting.`,
      t: p.argument.markersEmitted > 0 ? "after bond" : "—",
      done: p.argument.markersEmitted > 0,
      kind: "MARKER",
    },
    {
      id: "unbond",
      label: "Unbonding",
      detail: "Exit started · withdrawal delay applies before release.",
      t: relativeTime(p.argument.unbondingStartedAt),
      done: !!p.argument.unbondingStartedAt,
      kind: "POLYGON",
    },
    {
      id: "release",
      label: "Released",
      detail: "Withdrawal claimed; lifecycle closed.",
      t: relativeTime(p.argument.releasedAt),
      done: !!p.argument.releasedAt,
      kind: "CANTON",
    },
  ];
  const lifecycle = STATUS_TO_LIFECYCLE[p.argument.status] ?? "pending";
  return (
    <Card padding={0}>
      <div
        style={{
          padding: "16px 22px",
          borderBottom: `1px solid ${tokens.hairline}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div>
          <SectionLabel>§ Lifecycle proof · {shortContract(p.contractId)}</SectionLabel>
          <div
            className="display"
            style={{ fontSize: 24, color: tokens.ink[100], marginTop: 2 }}
          >
            Lifecycle timeline.
          </div>
          <div
            className="mono"
            style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 2 }}
          >
            {fmt(parseFloat(p.argument.amountPol), 2)} {positionChain(p).symbol} · {p.argument.status}
          </div>
        </div>
        <Chip color={lifecycleColor(lifecycle)} dot>
          {lifecycle}
        </Chip>
      </div>
      <div style={{ padding: "24px 22px" }}>
        <div style={{ position: "relative", paddingLeft: 24 }}>
          <div
            style={{
              position: "absolute",
              left: 6,
              top: 6,
              bottom: 6,
              width: 1,
              background: tokens.hairline,
            }}
          />
          {events.map((e, i) => {
            const k =
              e.kind === "CANTON"
                ? tokens.neon
                : e.kind === "POLYGON"
                ? tokens.amberBright
                : tokens.cc;
            return (
              <div
                key={e.id}
                style={{
                  position: "relative",
                  marginBottom: i === events.length - 1 ? 0 : 18,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -22,
                    top: 4,
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: e.done ? k : tokens.ink[900],
                    border: `1.5px solid ${k}`,
                    boxShadow: e.done ? "none" : `inset 0 0 0 2px ${tokens.ink[900]}`,
                    animation: e.done ? "none" : "pulse-dot 2s infinite",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 12,
                  }}
                >
                  <div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 9.5,
                        color: k,
                        letterSpacing: ".12em",
                        marginRight: 8,
                      }}
                    >
                      {e.kind}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: tokens.ink[100] }}
                    >
                      {e.label}
                    </span>
                  </div>
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: tokens.ink[400] }}
                  >
                    {e.t}
                  </span>
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 10.5, color: tokens.ink[400], marginTop: 3 }}
                >
                  {e.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
