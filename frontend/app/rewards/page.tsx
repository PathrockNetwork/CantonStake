"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { AccountEmpty, AccountPagination, AccountLink, AccountMetric, AccountPanel, CadencePanel, MiniChart, SplitPanel, StatusBadge, WalletNotice } from "@/components/account/AccountUI";
import { Narrator } from "@/components/diagrams/Narrator";
import { fetchPositions, fetchRecentRounds, fetchRewardHistory, fetchRewards, type RewardHistoryEvent } from "@/lib/api";
import { accountChain, shortId } from "@/lib/account-view";
import { fmt, fmtUsd } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { useRoundCountdown } from "@/lib/use-round-countdown";

export default function RewardsPage() {
  const { address, isConnected } = useAccount();
  const { data: prices } = usePrices();
  const { mm, ss } = useRoundCountdown();
  const [page, setPage] = useState(0);
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState("all");
  const [positionId, setPositionId] = useState("all");
  const rewardsQ = useQuery({ queryKey: ["rewards", address], queryFn: () => fetchRewards(address!), enabled: !!address, refetchInterval: 10_000 });
  const roundsQ = useQuery({ queryKey: ["rewards-rounds", address], queryFn: () => fetchRecentRounds(address, 10), enabled: !!address, refetchInterval: 10_000 });
  const historyQ = useQuery({ queryKey: ["reward-history", address, days], queryFn: () => fetchRewardHistory(address!, days), enabled: !!address, refetchInterval: 30_000 });
  const positionsQ = useQuery({ queryKey: ["positions", address], queryFn: () => fetchPositions(address!), enabled: !!address, refetchInterval: 10_000 });
  const rewards = rewardsQ.isError ? undefined : rewardsQ.data;
  const history = historyQ.isError ? [] : historyQ.data?.events ?? [];
  const native = history.filter(event => event.kind === "native"), cc = history.filter(event => event.kind === "cc");
  const filtered = history.filter(event => (kind === "all" || event.kind === kind) && (positionId === "all" || event.positionId === positionId));
  const bonded = (positionsQ.data ?? []).filter(position => position.argument.status === "Bonded");
  const totals = new Map<string, number>();
  for (const event of cc) totals.set(event.positionId, (totals.get(event.positionId) ?? 0) + Number(event.amount));
  const empty = !isConnected ? "Connect your wallet to view your reward history." : historyQ.isError ? "Reward history is temporarily unavailable." : historyQ.isLoading ? "Loading reward history…" : "No recorded rewards in this period.";
  const refresh = () => { void rewardsQ.refetch(); void historyQ.refetch(); void roundsQ.refetch(); void positionsQ.refetch(); };
  return <div className="page-shell account-page">
    <PageMasthead index="04" section="Rewards" title="Rewards." accent="Track real activity." description="Earn native validator yield and Canton Coin rewards. Two types of rewards, one unified experience on Canton." note="Real activity. Native yield. Canton rewards. A more open financial future." />
    <WalletNotice connected={isConnected} error={rewardsQ.isError || historyQ.isError} loading={isConnected && rewardsQ.isLoading} onRetry={refresh} />
    <div className="account-metrics">
      <AccountMetric label="Native yield paid" value={rewards ? `${fmt(rewards.totalUserPayoutPol, 2)} POL` : "—"} detail="Net recorded payouts" icon="stack" color="#b25cff" series={native.slice(0, 8).reverse().map(e => Number(e.amount))} />
      <AccountMetric label="Canton Coin rewards" value={rewards ? `${fmt(rewards.totalUserShare, 2)} CC` : "—"} detail="Your beneficiary share" icon="coin" color="#f3c442" series={cc.slice(0, 8).reverse().map(e => Number(e.amount))} />
      <AccountMetric label="Next CC round" value={`${mm}m ${ss}s`} detail="Estimated 10-minute cadence" icon="clock" color="#3cacff" />
      <AccountMetric label="Reward events" value={rewards ? rewards.rewardEventCount + rewards.rewardSweepCount : "—"} detail="Native payouts + CC attributions" icon="activity" color="#b25cff" />
    </div>
    <div className="account-two-col account-rewards-layout">
      <div className="account-stack">
        <div className="account-reward-streams">
          <RewardStream title="Native validator yield" description="Native staking rewards from your validators." unit="POL" total={rewards?.totalUserPayoutPol} color="#b25cff" events={native} empty={empty} footnote="Recorded net payouts after the native protocol fee." />
          <RewardStream title="Canton Coin (CC) rewards" description="Your recorded Canton beneficiary allocations." unit="CC" total={rewards?.totalUserShare} color="#f3c442" events={cc} empty={empty} footnote="Amounts shown are your share after the beneficiary split." />
        </div>
        <AccountPanel title="Reward history" icon="activity" description="Native payouts and CC allocations recorded for your positions." id="reward-history">
          <div className="account-filters">
            <label><span className="sr-only">Reward type</span><select className="account-field" value={kind} onChange={e => { setKind(e.target.value); setPage(0); }} aria-label="Reward type"><option value="all">All types</option><option value="native">Native yield</option><option value="cc">Canton Coin</option></select></label>
            <label><span className="sr-only">Reward position</span><select className="account-field" value={positionId} onChange={e => { setPositionId(e.target.value); setPage(0); }} aria-label="Reward position"><option value="all">All positions</option>{[...new Set([...(positionsQ.data ?? []).map(p => p.contractId), ...history.map(e => e.positionId)])].map(id => <option key={id} value={id}>{shortId(id)}</option>)}</select></label>
            <label><span className="sr-only">Reward period</span><select className="account-field" value={days} onChange={e => { setDays(Number(e.target.value)); setPage(0); }} aria-label="Reward period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
          </div>
          <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Time</th><th>Type · position</th><th>Amount</th><th>Est. USD</th><th>Round</th><th>Status</th></tr></thead><tbody>{filtered.slice(page * 8, (page + 1) * 8).map(event => <tr key={event.id}>
            <td><time dateTime={event.time}>{new Date(event.time).toLocaleDateString()}<small>{new Date(event.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></time></td>
            <td>{event.kind === "cc" ? "CC attribution" : "Native payout"}<small title={event.positionId}>{shortId(event.positionId)}</small></td>
            <td className="mono" style={{ color: event.kind === "cc" ? "#f3c442" : "#c78aff" }}>{fmt(Number(event.amount), 4)} {event.symbol}</td>
            <td>{prices ? fmtUsd(Number(event.amount) * (event.kind === "cc" ? prices.ccUsd : prices.polUsd)) : "—"}</td>
            <td>{event.roundNumber !== null ? `#${event.roundNumber.toLocaleString()}` : "—"}</td><td><StatusBadge status={event.status} /></td>
          </tr>)}</tbody></table></div>
          {!filtered.length && <AccountEmpty>{history.length ? "No rewards match these filters." : empty}</AccountEmpty>}
          <AccountPagination page={page} count={filtered.length} onChange={setPage} />
        <div className="account-results"><span>{filtered.length} recorded events{historyQ.data?.hasMore ? " · latest 250; narrow the period for more detail" : ""}</span><small>USD values use current indicative prices.</small></div>
        </AccountPanel>
      </div>
      <div className="account-stack">
        <SplitPanel />
        <CadencePanel />
        <AccountPanel title="Position allocations" icon="cube" description={`Recorded CC allocations · last ${days} days`}>
          {bonded.length ? <ul className="account-allocation-list">{bonded.map(position => <li key={position.contractId}><div><strong>{shortId(position.contractId)}</strong><small>{fmt(Number(position.argument.amountPol), 2)} {accountChain(position).symbol} bonded</small></div><span className="mono">{historyQ.data && !historyQ.isError ? `${fmt(totals.get(position.contractId) ?? 0, 2)} CC` : "—"}</span></li>)}</ul> : <AccountEmpty>{isConnected ? "No bonded positions to display." : "Your bonded positions appear here."}</AccountEmpty>}
          <AccountLink href="/positions">View positions</AccountLink>
        </AccountPanel>
      </div>
    </div>
    <div className="account-rewards-footer">
      <AccountPanel title="How CC is calculated" icon="coin" description="Your reward follows the round attribution and on-ledger beneficiary configuration.">
        <p className="account-formula">Round mint <span>×</span> app share <span>×</span> position weight <span>×</span> beneficiary share <span>=</span> your CC</p>
        <p className="account-muted">CC is allocated across eligible bonded positions using the round’s recorded attribution. The beneficiary configuration sends 75% to the delegator and 25% to the app treasury.</p>
        {address && <Narrator address={address} />}
      </AccountPanel>
      <AccountPanel title="Recent rounds" icon="clock" description="Round totals and your pre-split attribution.">
        <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Round</th><th>Status</th><th>Round mint</th><th>Your attribution</th></tr></thead><tbody>{(roundsQ.data?.rounds ?? []).slice(0, 5).map(round => <tr key={round.roundNumber}><td>#{round.roundNumber.toLocaleString()}</td><td><StatusBadge status={round.status} /></td><td>{fmt(Number(round.totalCcMinted), 2)} CC</td><td>{round.userCcAttributed === null ? "—" : `${fmt(Number(round.userCcAttributed), 2)} CC`}</td></tr>)}</tbody></table></div>
        {!roundsQ.data?.rounds.length && <AccountEmpty>{!isConnected ? "Connect your wallet to see attributed rounds." : roundsQ.isError ? "Round history is unavailable." : "No completed rounds yet."}</AccountEmpty>}
      </AccountPanel>
    </div>
  </div>;
}

function RewardStream({ title, description, unit, total, color, events, empty, footnote }: { title: string; description: string; unit: string; total?: number; color: string; events: RewardHistoryEvent[]; empty: string; footnote: string }) {
  return <AccountPanel title={title} icon={unit === "CC" ? "coin" : "stack"} description={description} className="account-reward-stream">
    <div className="account-reward-total"><span className="account-muted">Total recorded</span><strong>{total === undefined ? "—" : `${fmt(total, 2)} ${unit}`}</strong><p className="account-muted">{footnote}</p></div>
    <div className="account-chart-caption"><span>Recorded payouts ({unit})</span><span>{events.length} events</span></div>
    {events.length ? <MiniChart values={[...events].reverse().map(event => Number(event.amount))} color={color} bars={unit === "CC"} label={`${title}, chronological recorded amounts in ${unit}`} /> : <div className="account-chart-empty">{empty}</div>}
    <div className="account-chart-caption"><span>Recent {unit === "CC" ? "allocations" : "payouts"}</span><AccountLink href="#reward-history">View history</AccountLink></div>
    <ul className="account-stream-events">{events.slice(0, 3).map(event => <li key={event.id}><time dateTime={event.time}>{new Date(event.time).toLocaleDateString()}</time><span style={{ color }}>{fmt(Number(event.amount), 4)} {unit}</span></li>)}</ul>
  </AccountPanel>;
}
