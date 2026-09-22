"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { parseEther } from "viem";
import { Btn } from "@/components/primitives/Btn";
import { Card } from "@/components/primitives/Card";
import { Chip } from "@/components/primitives/Chip";
import { EmptyState } from "@/components/primitives/EmptyState";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import {
  fetchPositions,
  fetchRewards,
  sweepNativeRewards,
  type PositionRow,
} from "@/lib/api";
import { liveChains, chainById } from "@/lib/chains";
import { adapterFor } from "@/lib/chains/index";
import { fetchStakingParams } from "@/lib/chains/polygon";
import { chainFromAddress } from "@/lib/chains";
import { fmt, fmtUsd } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { accountChain, positionUsd, shortId, totalPositionUsd, validatorLabel } from "@/lib/account-view";
import { AccountEmpty, AccountLink, AccountMetric, AccountPanel, ChainBadge, LifecycleRail, StatusBadge, WalletNotice } from "@/components/account/AccountUI";
import { lookupPositionMeta, lookupPositionChain } from "@/lib/position-chain-map";
import { useCosmosWallet } from "@/lib/cosmos/use-cosmos-wallet";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { tokens } from "@/lib/tokens";

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
  const { address, isConnected } = useAccount();
  const cosmos = useCosmosWallet();
  const sui = useSuiWallet();
  const { switchChainAsync } = useSwitchChain();
  const { data: prices } = usePrices();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [chainFilter, setChainFilter] = useState("all");
  const [order, setOrder] = useState("newest");
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const positionsQ = useQuery({ queryKey: ["positions", address], queryFn: () => fetchPositions(address!), enabled: !!address, refetchInterval: 5000 });
  const rewardsQ = useQuery({ queryKey: ["rewards", address], queryFn: () => fetchRewards(address!), enabled: !!address, refetchInterval: 10_000 });
  const positions = positionsQ.data ?? [];
  useEffect(() => { setSelectedId(undefined); }, [address]);
  useEffect(() => {
    if (selectedId !== undefined || !positions.length) return;
    const requested = new URLSearchParams(window.location.search).get("position");
    setSelectedId(positions.find(p => p.contractId === requested)?.contractId ?? positions[0].contractId);
  }, [positions, selectedId]);
  const focused = positions.find(position => position.contractId === selectedId);
  const bonded = positions.filter(p => p.argument.status === "Bonded");
  const unbonding = positions.filter(p => p.argument.status === "Unbonding");
  const haveData = isConnected && !!positionsQ.data && !positionsQ.isError;
  const activeValue = haveData ? totalPositionUsd(bonded, prices) : null;
  const exitingValue = haveData ? totalPositionUsd(unbonding, prices) : null;
  const visible = positions.filter(p => (status === "all" || p.argument.status === status) && (chainFilter === "all" || accountChain(p).id === chainFilter)
    && [p.contractId, p.chainMeta?.validatorAddress, p.chainMeta?.validatorShare, accountChain(p).name, accountChain(p).symbol].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  visible.sort((a, b) => order === "amount" ? Number(b.argument.amountPol) - Number(a.argument.amountPol) : (order === "oldest" ? 1 : -1) * ((Date.parse(a.argument.bondedAt ?? "") || 0) - (Date.parse(b.argument.bondedAt ?? "") || 0)));
  const refresh = () => { void positionsQ.refetch(); void rewardsQ.refetch(); };
  return <div className="page-shell account-page">
    <PageMasthead index="03" section="Positions" title="Positions." accent="Your stake, your control." description="Monitor and manage your staking positions. View bonded, unbonding, and released positions and follow their lifecycle on Canton." />
    <WalletNotice connected={isConnected} error={positionsQ.isError || rewardsQ.isError} loading={isConnected && positionsQ.isLoading} onRetry={refresh} />
    <div className="account-metrics">
      <AccountMetric label="Total active stake" value={activeValue === null ? "—" : fmtUsd(activeValue, 2)} detail="Estimated value of bonded positions" icon="stack" />
      <AccountMetric label="Total unbonding" value={exitingValue === null ? "—" : fmtUsd(exitingValue, 2)} detail="Estimated value awaiting release" icon="clock" color="#bb6aff" />
      <AccountMetric label="Bonded positions" value={haveData ? bonded.length : "—"} detail="Positions eligible for native yield" icon="cube" color="#34c6f6" />
      <AccountMetric label="Total CC earned" value={rewardsQ.data && !rewardsQ.isError ? `${fmt(rewardsQ.data.totalUserShare, 2)} CC` : "—"} detail="Your recorded beneficiary share" icon="coin" color="#f3c442" />
    </div>
    <div className={`account-two-col account-positions-layout${focused ? "" : " account-positions-layout--empty"}`}>
      <AccountPanel title="Your staking positions" description="Search your positions and select one to view its details." icon="stack" action={<Link href="/stake" className="account-button">+ New stake</Link>}>
        <div className="account-filters">
          <label className="account-search"><span className="sr-only">Search positions</span><input className="account-field" aria-label="Search positions" placeholder="Search validator, chain, or position…" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <label><span className="sr-only">Position chain</span><select className="account-field" aria-label="Position chain" value={chainFilter} onChange={e => setChainFilter(e.target.value)}><option value="all">All chains</option>{[...new Map([...liveChains(), ...positions.map(accountChain)].map(chain => [chain.id, chain])).values()].map(chain => <option key={chain.id} value={chain.id}>{chain.id === "polygon" ? "Polygon PoS" : chain.name}</option>)}</select></label>
          <label><span className="sr-only">Position status</span><select className="account-field" aria-label="Position status" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All states</option>{["Pending", "Bonded", "Unbonding", "Released", "Cancelled"].map(state => <option key={state}>{state}</option>)}</select></label>
          <label><span className="sr-only">Position sort order</span><select className="account-field" aria-label="Position sort order" value={order} onChange={e => setOrder(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount">Largest amount</option></select></label>
        </div>
        <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Chain · validator</th><th>Amount</th><th>Est. USD</th><th>Status</th><th>Details</th></tr></thead><tbody>
          {visible.map(position => <tr key={position.contractId} data-selected={position.contractId === selectedId}><td><ChainBadge symbol={accountChain(position).symbol} label={accountChain(position).id === "polygon" ? "Polygon PoS" : accountChain(position).name} /><small>{validatorLabel(position)}</small></td><td className="mono">{fmt(Number(position.argument.amountPol), 2)} {accountChain(position).symbol}</td><td>{positionUsd(position, prices) === null ? "—" : fmtUsd(positionUsd(position, prices)!, 2)}</td><td><StatusBadge status={position.argument.status} /></td><td><button className="account-button" aria-pressed={position.contractId === selectedId} aria-label={`View position ${shortId(position.contractId)}`} onClick={() => setSelectedId(position.contractId)}>View →</button></td></tr>)}
        </tbody></table></div>
        {!visible.length && <AccountEmpty>{!isConnected ? "Connect your wallet to view and manage your positions." : positionsQ.isLoading ? "Loading positions…" : positionsQ.isError ? "Positions are temporarily unavailable." : positions.length ? "No positions match your filters." : <>No positions yet.<AccountLink href="/stake">Create your first position</AccountLink></>}</AccountEmpty>}
        <div className="account-results"><span>Showing {visible.length} of {positions.length} positions</span><small>USD values are indicative.</small></div>
      </AccountPanel>
      <div className="account-stack account-position-details">
        <AccountPanel title="Position details" icon="cube" action={focused && <button className="account-button" aria-label="Close position details" onClick={() => setSelectedId(null)}>×</button>}>
          {focused ? <>
            <div className="account-position-heading"><ChainBadge symbol={accountChain(focused).symbol} label={accountChain(focused).id === "polygon" ? "Polygon PoS" : accountChain(focused).name} /><StatusBadge status={focused.argument.status} /></div>
            <div className="account-position-amount"><strong>{fmt(Number(focused.argument.amountPol), 2)} {accountChain(focused).symbol}</strong><span className="account-muted">{positionUsd(focused, prices) === null ? "—" : `${fmtUsd(positionUsd(focused, prices)!, 2)} estimated value`}</span></div>
            <div className="account-position-lifecycle"><h3>Staking lifecycle</h3><LifecycleRail status={focused.argument.status} /></div>
            <dl className="account-definition"><div><dt>Position ID</dt><dd className="mono" title={focused.contractId}>{shortId(focused.contractId, 14)}</dd></div><div><dt>Validator</dt><dd title={focused.chainMeta?.validatorAddress ?? ""}>{validatorLabel(focused)}</dd></div><div><dt>Bonded</dt><dd>{focused.argument.bondedAt ? new Date(focused.argument.bondedAt).toLocaleString() : "Awaiting bond"}</dd></div><div><dt>Activity markers</dt><dd>{focused.argument.markersEmitted}</dd></div><div><dt>CC beneficiary split</dt><dd>75% delegator / 25% treasury</dd></div></dl>
            <div className="account-position-actions"><PositionActions key={focused.contractId} p={focused} cosmos={cosmos} sui={sui} switchChainAsync={switchChainAsync} /><AccountLink href="/rewards">View rewards</AccountLink></div>
            <details className="account-position-proof"><summary>View recorded lifecycle</summary><Timeline p={focused} /></details>
          </> : <><AccountEmpty>{positions.length ? "Select a position to inspect its lifecycle and available actions." : "Your selected position and its actions will appear here."}</AccountEmpty><LifecycleRail /></>}
        </AccountPanel>
      </div>
    </div>
  </div>;
}

function PositionActions({
  p,
  cosmos,
  sui,
  switchChainAsync,
}: {
  p: PositionRow;
  cosmos: ReturnType<typeof useCosmosWallet>;
  sui: ReturnType<typeof useSuiWallet>;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const { address } = useAccount();
  const { sendTransaction } = useSendTransaction();
  const { isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash: undefined, // Will be set during unbond/claim
  });

  const lifecycle = STATUS_TO_LIFECYCLE[p.argument.status] ?? "pending";
  const color = lifecycleColor(lifecycle);
  const chain = positionChain(p);

  // Get position metadata (chain + validator)
  const meta = lookupPositionMeta(p.argument.evmAddress, p.argument.amountPol);
  const chainId = chain.id;
  const validator = p.chainMeta?.validatorAddress ?? meta?.validator;

  // Determine available actions
  const canSweep = lifecycle === "bonded";
  const canUnbond = lifecycle === "bonded" && !!validator;

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

  const claimGate: { ready: boolean; reason: string | null } = (() => {
    if (lifecycle !== "unbonding") return { ready: false, reason: null };

    // Non-Polygon chains settle on the timer-based release path, where the
    // recorded timestamp IS the gate.
    if (!isPolygon) {
      const ts = p.argument.unbondingReadyAt;
      return {
        ready: !!ts && new Date(ts) <= new Date(),
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

  // Sweep mutation (claim native rewards)
  const sweepMut = useMutation({
    mutationFn: () => sweepNativeRewards(p.contractId),
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
  const handleUnbond = async () => {
    if (!address || !validator) return;
    setError(null);
    setOkMsg(null);

    try {
      const adapter = adapterFor(chainId);
      const amountWei = parseEther(p.argument.amountPol);

      // Check chain type
      const isCosmos = chainId === "cosmos";
      const isSui = chainId === "sui";
      const isEvm = !!chain.wagmiChain;

      if (isCosmos) {
        if (!cosmos.isConnected || !cosmos.address) {
          setError("Connect Keplr wallet first");
          return;
        }
        const tx = await adapter.buildUndelegateTx({
          validator,
          amount: amountWei,
          delegator: cosmos.address,
        });
        if (tx.kind !== "cosmos") {
          throw new Error("Unexpected tx kind");
        }
        const result = await cosmos.signAndBroadcast({
          typeUrl: tx.typeUrl,
          value: tx.value,
        });
        setOkMsg(`Unbonding... tx: ${result.txHash.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        // Refresh positions after a delay
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isSui) {
        if (!sui.isConnected || !sui.address) {
          setError("Connect Sui wallet first");
          return;
        }
        const result = await sui.undelegate({ validator, amountMist: amountWei });
        setOkMsg(`Unbonding... tx: ${result.digest.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isEvm) {
        // Switch to the correct chain first
        const wagmiChain = chain.wagmiChain;
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

        sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          gas: tx.gas,
        });
        setOkMsg("Confirming unbond...");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Claim handler
  const handleClaim = async () => {
    if (!address || !validator) return;
    setError(null);
    setOkMsg(null);

    try {
      const adapter = adapterFor(chainId);
      const isCosmos = chainId === "cosmos";
      const isSui = chainId === "sui";
      const isEvm = !!chain.wagmiChain;

      if (isCosmos) {
        if (!cosmos.isConnected || !cosmos.address) {
          setError("Connect Keplr wallet first");
          return;
        }
        const tx = await adapter.buildClaimTx({
          validator,
          delegator: cosmos.address,
        });
        if (tx.kind !== "cosmos") {
          throw new Error("Unexpected tx kind");
        }
        const result = await cosmos.signAndBroadcast({
          typeUrl: tx.typeUrl,
          value: tx.value,
        });
        setOkMsg(`Claimed! tx: ${result.txHash.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isSui) {
        if (!sui.isConnected || !sui.address) {
          setError("Connect Sui wallet first");
          return;
        }
        const result = await sui.withdraw({ validator });
        setOkMsg(`Claimed! tx: ${result.digest.slice(0, 10)}...`);
        setTimeout(() => setOkMsg(null), 3000);
        setTimeout(() => qc.invalidateQueries({ queryKey: ["positions"] }), 5000);
      } else if (isEvm) {
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

        sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          gas: tx.gas,
        });
        setOkMsg("Confirming claim...");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isPending = sweepMut.isPending;

  return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {hasActions ? (
          <div style={{ display: "flex", gap: 4 }}>
            {canSweep && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => sweepMut.mutate()}
                disabled={isPending}
              >
                {isPending ? "Sweeping…" : "Sweep"}
              </Btn>
            )}
            {canUnbond && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleUnbond}
                disabled={isPending}
                style={{ color: tokens.warning }}
              >
                Unbond
              </Btn>
            )}
            {canClaim && (
              <Btn
                size="sm"
                variant="ghost"
                onClick={handleClaim}
                disabled={isPending}
                style={{ color: tokens.neon }}
              >
                Claim
              </Btn>
            )}
          </div>
        ) : claimGate.reason ? (
          // Unbonding but not yet claimable. Show the real remaining
          // checkpoint count rather than an enabled button that reverts.
          <span
            className="mono"
            style={{ fontSize: 10, color: tokens.warning }}
            title="Polygon releases unbonds by checkpoint, not by clock time"
          >
            {claimGate.reason}
          </span>
        ) : (
          <span
            className="mono"
            style={{ fontSize: 10, color: tokens.ink[500] }}
          >
            —
          </span>
        )}
        {okMsg ? (
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
            {error.slice(0, 30)}
          </span>
        ) : null}
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
