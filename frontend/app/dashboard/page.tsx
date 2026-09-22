"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { AccountEmpty, AccountIcon, AccountLink, AccountMetric, AccountPanel, ChainBadge, LifecycleRail, PrivacyPanel, SplitPanel, StatusBadge, WalletNotice } from "@/components/account/AccountUI";
import { fetchPositions, fetchRecentRounds, fetchRewards, type PositionRow } from "@/lib/api";
import { accountChain, accountEvents, shortId, totalPositionUsd, validatorLabel } from "@/lib/account-view";
import { fmt, fmtUsd } from "@/lib/format";
import { usePrices } from "@/lib/prices";
import { liveChains } from "@/lib/chains";
import { useRoundCountdown } from "@/lib/use-round-countdown";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { data: prices } = usePrices();
  const { mm, ss } = useRoundCountdown();
  const positionsQ = useQuery({ queryKey: ["dashboard-positions", address], queryFn: () => fetchPositions(address!), enabled: !!address, refetchInterval: 10_000 });
  const rewardsQ = useQuery({ queryKey: ["dashboard-rewards", address], queryFn: () => fetchRewards(address!), enabled: !!address, refetchInterval: 10_000 });
  const roundsQ = useQuery({ queryKey: ["dashboard-rounds", address], queryFn: () => fetchRecentRounds(address, 8), enabled: !!address, refetchInterval: 10_000 });
  const positions = positionsQ.data ?? [];
  const active = positions.filter(p => !["Released", "Cancelled"].includes(p.argument.status));
  const rewards = rewardsQ.isError ? undefined : rewardsQ.data;
  const hasPositions = isConnected && !!positionsQ.data && !positionsQ.isError;
  const staked = hasPositions ? totalPositionUsd(active, prices) : null;
  const events = accountEvents(positions, roundsQ.data?.rounds ?? []);
  const latest = roundsQ.data?.rounds[0];
  const refresh = () => { void positionsQ.refetch(); void rewardsQ.refetch(); void roundsQ.refetch(); };
  const priceNote = prices?.source.pol === "coingecko" ? "Estimated USD value" : "Indicative USD value";

  return <div className="page-shell account-page">
    <PageMasthead index="01" section="Dashboard" title="Main dashboard." accent="Everything in one place." description="Self-custodial staking on the Canton Network. Follow your positions, native validator yield, and Canton Coin rewards in one place." />
    <WalletNotice connected={isConnected} error={positionsQ.isError || rewardsQ.isError || roundsQ.isError} loading={isConnected && positionsQ.isLoading} onRetry={refresh} />
    <div className="account-metrics">
      <AccountMetric label="Total staked value" value={staked === null ? "—" : fmtUsd(staked, 2)} detail={priceNote} icon="stack" />
      <AccountMetric label="Native yield paid" value={rewards ? `${fmt(rewards.totalUserPayoutPol, 2)} POL` : "—"} detail="Recorded net native payouts" icon="stack" color="#b05cff" />
      <AccountMetric label="Canton Coin rewards" value={rewards ? `${fmt(rewards.totalUserShare, 2)} CC` : "—"} detail="Your recorded beneficiary share" icon="coin" color="#f3c442" />
      <AccountMetric label="Active positions" value={hasPositions ? active.length : "—"} detail="Across your supported chains" icon="cube" color="#38ccf6" />
    </div>
    <div className="account-two-col">
      <AccountPanel title="Staking positions" description="Your active and historical staking positions." icon="stack" action={<Link className="account-button" href="/stake">+ New stake</Link>}>
        <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Chain · validator</th><th>Amount staked</th><th>Status</th><th>Markers</th><th><span className="sr-only">Details</span></th></tr></thead>
          <tbody>{positions.slice(0, 5).map(p => <DashboardRow key={p.contractId} position={p} />)}</tbody></table></div>
        {!positions.length && <AccountEmpty>{!isConnected ? "Connect your wallet to view your staking positions." : positionsQ.isError ? "Positions could not be loaded." : positionsQ.isLoading ? "Loading positions…" : <>Your first position starts here.<AccountLink href="/stake">Start staking</AccountLink></>}</AccountEmpty>}
        {positions.length > 0 && <div className="account-results"><span>Showing {Math.min(positions.length, 5)} of {positions.length} positions</span><AccountLink href="/positions">View all positions</AccountLink></div>}
      </AccountPanel>
      <div className="account-stack">
        <AccountPanel title="Dual-yield rewards" icon="activity" description={`Next scheduled round in ${mm}m ${ss}s`}>
          <div className="account-dual-rewards">
            <div className="account-yield-card"><span aria-hidden="true"><AccountIcon name="stack" /></span><div><small>NATIVE VALIDATOR YIELD</small><strong>{rewards ? `${fmt(rewards.totalUserPayoutPol, 2)} POL` : "—"}</strong><small>Net native rewards recorded for your positions.</small></div></div>
            <div className="account-yield-card account-yield-card--cc"><span aria-hidden="true"><AccountIcon name="coin" /></span><div><small>CANTON COIN REWARDS</small><strong>{rewards ? `${fmt(rewards.totalUserShare, 2)} CC` : "—"}</strong><small>CC attributed through Canton reward rounds.</small></div></div>
          </div><AccountLink href="/rewards">View rewards</AccountLink>
        </AccountPanel>
        <SplitPanel compact />
      </div>
    </div>
    <div className="account-dashboard-bottom">
      <AccountPanel title="Supported chains" icon="link">
        {liveChains().map(chain => <Link className="account-network-card" href="/stake" key={chain.id}><ChainBadge symbol={chain.symbol} label={chain.id === "polygon" ? "Polygon PoS" : chain.name} /><StatusBadge status="Live" /></Link>)}
        <p className="account-muted">More chains coming soon.<br />One staking lifecycle on Canton.</p>
      </AccountPanel>
      <div className="account-stack">
        <AccountPanel title="Staking lifecycle" description="From your request to release." icon="cube"><LifecycleRail /></AccountPanel>
        <PrivacyPanel compact />
      </div>
      <AccountPanel title="Recent activity" icon="activity" action={<AccountLink href="/analytics">View all</AccountLink>}>
        {events.length ? <ol className="account-activity-list">{events.slice(0, 4).map(event => <li key={event.id}><time dateTime={event.time}>{new Date(event.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol> : <AccountEmpty>{isConnected ? "No recorded activity for this account yet." : "Your recorded activity appears here after connecting."}</AccountEmpty>}
      </AccountPanel>
    </div>
    {latest && <AccountPanel title={`Latest reward round · #${latest.roundNumber.toLocaleString()}`} icon="coin" className="account-latest-round" action={<StatusBadge status={latest.status} />}>
      <dl className="account-definition"><div><dt>Completed</dt><dd>{latest.relativeTime}</dd></div><div><dt>CC minted across the round</dt><dd>{fmt(Number(latest.totalCcMinted), 2)} CC</dd></div><div><dt>Your CC attributed before split</dt><dd>{latest.userCcAttributed === null ? "—" : `${fmt(Number(latest.userCcAttributed), 2)} CC`}</dd></div></dl>
    </AccountPanel>}
  </div>;
}

function DashboardRow({ position: p }: { position: PositionRow }) {
  const chain = accountChain(p);
  return <tr><td><ChainBadge symbol={chain.symbol} label={chain.id === "polygon" ? "Polygon PoS" : chain.name} /><small title={p.contractId}>{validatorLabel(p) !== "—" ? validatorLabel(p) : shortId(p.contractId)}</small></td>
    <td className="mono">{fmt(Number(p.argument.amountPol), 2)} {chain.symbol}</td><td><StatusBadge status={p.argument.status} /></td><td className="mono">{p.argument.markersEmitted}</td>
    <td><Link href={`/positions?position=${encodeURIComponent(p.contractId)}`} className="account-text-link" aria-label={`View position ${shortId(p.contractId)}`}>Details →</Link></td></tr>;
}
