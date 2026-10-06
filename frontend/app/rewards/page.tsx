"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { AccountEmpty, AccountPagination, AccountMetric, AccountPanel, StatusBadge, WalletNotice } from "@/components/account/AccountUI";
import { fetchAccountRewards } from "@/lib/api";
import { rewardPositionLabel, shortId } from "@/lib/account-view";
import { fmt, fmtUsd } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { useConnectedNativeWallets } from "@/lib/use-connected-native-wallets";
import { useLiquidHoldings } from "@/components/account/LiquidHoldings";
import { PositionRewards } from "@/components/account/PositionRewards";
import { positionList } from "@/lib/position-list";
import { networkMode } from "@/lib/network";
import { nativeRewardGroups, recordedRewardTotal } from "@/lib/native-reward-groups";
import { RewardsOverview } from "@/components/account/RewardsOverview";
import { LoopRewardEntitlements } from "@/components/account/LoopRewardEntitlements";

export default function RewardsPage() {
  const { addresses, scope, isConnected } = useConnectedNativeWallets();
  const { data: prices } = usePrices();
  const [page, setPage] = useState(0);
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState("all");
  const [positionId, setPositionId] = useState("all");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const liquid = useLiquidHoldings();
  const liquidPosition = positionList([], liquid.state, liquid.address).find(entry => entry.kind === "liquid");
  useEffect(() => { setPositionId("all"); setPage(0); }, [scope]);
  const rewardsQ = useQuery({ queryKey: ["account-rewards", networkMode, scope, days, detailsOpen],
    queryFn: ({ signal }) => fetchAccountRewards(addresses, days, detailsOpen, signal),
    enabled: isConnected, refetchInterval: 30_000, retry: false });
  const rewards = isConnected && !rewardsQ.isError ? rewardsQ.data : undefined;
  const historyAvailable = !!rewards?.history;
  const historyFailed = isConnected && (rewardsQ.isError || rewards?.history === null);
  const positionsUnavailable = isConnected && (rewardsQ.isError || rewards?.positions === null);
  const history = rewards?.history?.events ?? [];
  const cc = history.filter(event => event.kind === "cc");
  const ccTotal = historyAvailable ? recordedRewardTotal(cc) : undefined;
  const loopPaymentsDisabled = networkMode === "testnet" &&
    (rewards?.policy.ccPayments === "disabled" || process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external");
  const payoutGroups = isConnected ? nativeRewardGroups(history) : [];
  const singlePayout = payoutGroups.length === 1 ? payoutGroups[0] : undefined;
  const filtered = history.filter(event => (kind === "all" || event.kind === kind) && (positionId === "all" || event.positionId === positionId));
  const bonded = (rewards?.positions ?? []).filter(position => position.argument.status === "Bonded");
  const positionLabels = new Map((rewards?.positions ?? []).map(p => [p.contractId, rewardPositionLabel(p)]));
  const totals = new Map<string, number>();
  for (const event of cc) totals.set(event.positionId, (totals.get(event.positionId) ?? 0) + Number(event.amount));
  const empty = !isConnected ? "Connect your wallet to view your reward history." : historyFailed ? "Reward history is temporarily unavailable." : !historyAvailable ? "Loading reward history…" : "No recorded rewards in this period.";
  const refresh = () => { if (isConnected) void rewardsQ.refetch(); if (liquid.address) void liquid.refetch(); };
  return <div className="page-shell account-page">
    <PageMasthead index="04" section="Rewards" title="Rewards." accent="Track real activity." description="Recorded native payouts and Canton Coin allocations across your connected wallets. Allocations are not proof of CC payment." note="Staked balances and unmeasured yield are not counted as rewards." />
    <WalletNotice connected={isConnected} error={historyFailed || positionsUnavailable} loading={isConnected && rewardsQ.isLoading} onRetry={refresh} />
    <div className={`account-metrics${payoutGroups.length ? "" : " account-rewards-metrics--cc-only"}`}>
      {payoutGroups.length > 0 && <AccountMetric label="Recorded native payouts" value={singlePayout ? singlePayout.total === undefined ? "—" : `${fmt(singlePayout.total, 2)} ${singlePayout.symbol}` : `${payoutGroups.length} assets`} detail={`${rewards?.history?.hasMore ? "Displayed payouts" : "Recorded payouts"} · last ${days} days`} icon="stack" color="#b25cff" />}
      <AccountMetric label="CC allocations" value={ccTotal === undefined ? "—" : `${fmt(ccTotal, 2)} CC`} detail={`${rewards?.history?.hasMore ? "Displayed allocations" : "Recorded allocations"} · last ${days} days`} icon="coin" color="#f3c442" series={cc.slice(0, 8).reverse().map(e => Number(e.amount))} />
      <AccountMetric label="CC payments" value={loopPaymentsDisabled ? "Disabled" : "Unverified"} detail={loopPaymentsDisabled ? "Loop user claims and splits are not configured" : "Allocation records do not verify payment"} icon="clock" color="#3cacff" />
      <AccountMetric label="Recorded events" value={historyAvailable ? history.length : "—"} detail={`${rewards?.history?.hasMore ? "Latest displayed events" : "Payouts + allocations"} · ${addresses.length} connected wallet${addresses.length === 1 ? "" : "s"}`} icon="activity" color="#b25cff" />
    </div>
    <div className="account-two-col account-rewards-layout">
      <div className="account-stack">
        <RewardsOverview history={history} connected={isConnected} available={historyAvailable} loading={isConnected && rewardsQ.isLoading} failed={historyFailed} partial={rewards?.history?.hasMore ?? false} days={days} />
        <AccountPanel title="Reward history" icon="activity" description="Native payouts and CC allocations recorded for your positions." id="reward-history">
          <div className="account-filters">
            <label><span className="sr-only">Reward type</span><select className="account-field" value={kind} onChange={e => { setKind(e.target.value); setPage(0); }} aria-label="Reward type"><option value="all">All types</option><option value="native">Native yield</option><option value="cc">Canton Coin</option></select></label>
            <label><span className="sr-only">Reward position</span><select className="account-field" value={positionId} onChange={e => { setPositionId(e.target.value); setPage(0); }} aria-label="Reward position"><option value="all">All positions</option>{liquidPosition && <option value={liquidPosition.id}>Polygon Amoy · Liquid staking</option>}{[...new Set([...positionLabels.keys(), ...history.map(e => e.positionId)])].map(id => <option key={id} value={id}>{positionLabels.get(id) ?? shortId(id)}</option>)}</select></label>
            <label><span className="sr-only">Reward period</span><select className="account-field" value={days} onChange={e => { setDays(Number(e.target.value)); setPage(0); }} aria-label="Reward period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
          </div>
          <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Time</th><th>Type · position</th><th>Amount</th><th>Est. USD</th><th>Round</th><th>Status</th></tr></thead><tbody>{filtered.slice(page * 8, (page + 1) * 8).map(event => <tr key={event.id}>
            <td><time dateTime={event.time}>{new Date(event.time).toLocaleDateString()}<small>{new Date(event.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></time></td>
            <td>{event.kind === "cc" ? "CC attribution" : "Native payout"}<small title={event.positionId}>{positionLabels.get(event.positionId) ?? shortId(event.positionId)}</small></td>
            <td className="mono" style={{ color: event.kind === "cc" ? "#f3c442" : "#c78aff" }}>{fmt(Number(event.amount), 4)} {event.symbol}</td>
            <td>{prices && (event.kind === "cc" || event.symbol === "POL") ? fmtUsd(Number(event.amount) * (event.kind === "cc" ? prices.ccUsd : prices.polUsd)) : "—"}</td>
            <td>{event.roundNumber !== null ? `#${event.roundNumber.toLocaleString()}` : "—"}</td><td><StatusBadge status={event.status} /></td>
          </tr>)}</tbody></table></div>
          {!filtered.length && <AccountEmpty>{positionId === liquidPosition?.id ? "No recorded liquid rewards. CC allocations are disabled and liquid yield reporting is not available yet." : history.length ? "No rewards match these filters." : empty}</AccountEmpty>}
          <AccountPagination page={page} count={filtered.length} onChange={setPage} />
        <div className="account-results"><span>{historyAvailable ? `${filtered.length} recorded events` : "Events unavailable"}{rewards?.history?.hasMore ? " · latest 250; narrow the period for more detail" : ""}</span><small>{networkMode === "testnet" ? "Test tokens have no cash value; USD shows what the same amounts would be worth at MainNet market prices." : "USD values use current indicative prices when available."}</small></div>
        </AccountPanel>
      </div>
      <div className="account-stack">
        <PositionRewards positions={bonded} totals={totals} allocationsAvailable={historyAvailable} holdings={liquid} connected={isConnected} days={days} positionsUnavailable={positionsUnavailable} positionsUpdatedAt={rewardsQ.dataUpdatedAt} walletScope={scope} loopPaymentsDisabled={loopPaymentsDisabled} positionsLoading={isConnected && rewardsQ.isLoading} />
      </div>
    </div>
    <details className="account-reward-details" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>How rewards work <span>Payment status and recorded rounds</span></summary>
      {detailsOpen && <div className="account-rewards-footer">
      <AccountPanel title="CC allocation versus payment" icon="coin" description="Recorded activity is separate from claimed rewards and wallet transfers.">
        <p className="account-muted">{loopPaymentsDisabled ? "CC claims, per-user beneficiary splits and payments are not yet configured for Loop TestNet positions. Existing legacy allocation records remain visible; they are not verified wallet payouts." : "History shows recorded beneficiary allocations. A recorded allocation or round total alone does not prove a reward was claimed or transferred to your wallet."}</p>
        <p className="account-muted">Native yield is only included after a payout has been recorded. Liquid holdings and unmeasured yield are excluded. No wallet balance or position amount is counted as earned CC.</p>
        <LoopRewardEntitlements />
      </AccountPanel>
      <AccountPanel title="Recorded rounds" icon="clock" description="Deployment round records and pre-split attribution for your connected wallets; not proof of settlement.">
        <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Round</th><th>Status</th><th>Recorded round total</th><th>Your attribution</th></tr></thead><tbody>{(rewards?.rounds ?? []).slice(0, 5).map(round => <tr key={round.roundNumber}><td>#{round.roundNumber.toLocaleString()}</td><td><StatusBadge status={round.status} /></td><td>{fmt(Number(round.totalCcMinted), 2)} CC</td><td>{round.userCcAttributed === null ? "—" : `${fmt(Number(round.userCcAttributed), 2)} CC`}</td></tr>)}</tbody></table></div>
        {!rewards?.rounds?.length && <AccountEmpty>{!isConnected ? "Connect your wallet to see attributed rounds." : rewardsQ.isError || rewards?.rounds === null ? "Round history is unavailable." : !rewards?.rounds ? "Loading recorded rounds…" : "No completed rounds yet."}</AccountEmpty>}
      </AccountPanel>
    </div>}
    </details>
  </div>;
}
