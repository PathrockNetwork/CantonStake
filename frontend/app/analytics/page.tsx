"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { AccountEmpty, AccountPagination, AccountMetric, AccountPanel, ChainBadge, MiniChart, PrivacyPanel, StatusBadge } from "@/components/account/AccountUI";
import { fetchAnalyticsMarkers, fetchPositions, fetchProtocolSummary, fetchRecentRounds, fetchRewardHealth, fetchWatcherStatus } from "@/lib/api";
import { accountEvents } from "@/lib/account-view";
import { liveChains } from "@/lib/chains";
import { usePrices } from "@/lib/prices";
import { fmtUsd } from "@/lib/format";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";
export default function AnalyticsPage() {
  const { address } = useAccount();
  const { data: prices } = usePrices();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("all");
  const markersQ = useQuery({ queryKey: ["analytics-markers", address ?? "global", 24], queryFn: () => fetchAnalyticsMarkers(address, 24), refetchInterval: 30_000 });
  const healthQ = useQuery({ queryKey: ["reward-health"], queryFn: fetchRewardHealth, refetchInterval: 30_000 });
  const watchersQ = useQuery({ queryKey: ["watcher-status"], queryFn: fetchWatcherStatus, refetchInterval: 30_000 });
  const protocolQ = useQuery({ queryKey: ["protocol-summary"], queryFn: fetchProtocolSummary, refetchInterval: 30_000 });
  const roundsQ = useQuery({ queryKey: ["activity-rounds", address ?? "global"], queryFn: () => fetchRecentRounds(address, 30), refetchInterval: 30_000 });
  const positionsQ = useQuery({ queryKey: ["positions", address], queryFn: () => fetchPositions(address!), enabled: !!address, refetchInterval: 10_000 });
  const markers = markersQ.isError ? undefined : markersQ.data;
  const health = healthQ.isError ? undefined : healthQ.data;
  const positions = positionsQ.isError ? [] : positionsQ.data ?? [];
  const events = accountEvents(positions, roundsQ.isError ? [] : roundsQ.data?.rounds ?? [], !!address);
  const filtered = events.filter(event => filter === "all" || event.kind === filter);
  const pending = positionsQ.data && !positionsQ.isError ? positions.filter(p => p.argument.status === "Pending").length : null;
  const status = protocolQ.data?.source === "recorded" || protocolQ.isError ? "Unavailable" : protocolQ.data?.source === "ledger" ? "Live" : "Loading";
  const loadError = markersQ.isError || roundsQ.isError || (address && positionsQ.isError);
  const delta = markers?.insight.deltaPct;
  return <div className="page-shell account-page">
    <PageMasthead index="05" section="Activity" title="Activity." accent="Full audit trail. Real transparency." description="Real-time and recorded events across your positions and the Canton Network. Follow native staking activity and reward attribution." />
    {loadError && <div className="account-notice account-notice--error" role="status">Some activity data is unavailable.<button className="account-button" onClick={() => { void markersQ.refetch(); void roundsQ.refetch(); if (address) void positionsQ.refetch(); }}>Retry</button></div>}
    <div className="account-metrics">
      <AccountMetric label="Markers · last 24h" value={markers ? markers.insight.totalMarkers.toLocaleString() : "—"} detail={address ? "Your recorded activity" : "Global recorded activity"} icon="cube" series={markers?.series.map(bucket => bucket.markers)} />
      <AccountMetric label="Pending positions" value={pending ?? "—"} detail={address ? "Awaiting a recorded bond" : "Connect to view your positions"} icon="clock" color="#b95cff" />
      <AccountMetric label="Successful reward rounds" value={health?.completed ?? "—"} detail={health ? `${health.totalSampled} recent attempts sampled` : "Round health unavailable"} icon="coin" color="#f3c442" />
      <AccountMetric label="Latest reward round" value={health?.lastRound ? `#${health.lastRound.roundNumber.toLocaleString()}` : "—"} detail={health?.lastRound?.status ?? "Awaiting round data"} icon="stack" color="#3fc8fa" />
    </div>
    <div className="account-two-col">
      <AccountPanel title="Activity feed" icon="activity" description={address ? "Recorded lifecycle events and reward rounds for your wallet." : "Global reward rounds. Connect your wallet for position activity."}>
        <div className="account-activity-toolbar"><div className="account-tabs" aria-label="Activity filters">{[["all", "All"], ["positions", "Positions"], ["rewards", "Rewards"]].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }}>{label}</button>)}</div>
          {address && <a className="account-button" href={`${BACKEND_URL}/api/tax/csv?address=${encodeURIComponent(address)}&format=koinly`} download>↓ Tax CSV</a>}
        </div>
        <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Time</th><th>Event</th><th>Source</th><th>Status</th><th>Details</th></tr></thead><tbody>{filtered.slice(page * 8, (page + 1) * 8).map(event => <tr key={event.id}>
          <td><time dateTime={event.time}>{new Date(event.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}<small>{new Date(event.time).toLocaleDateString()}</small></time></td><td>{event.title}</td><td>{event.kind === "rewards" ? "Canton" : "Staking position"}</td><td><StatusBadge status={event.status} /></td><td><Link className="account-text-link" href={event.positionId ? `/positions?position=${encodeURIComponent(event.positionId)}` : "/rewards"}>{event.detail}</Link></td>
        </tr>)}</tbody></table></div>
        {!filtered.length && <AccountEmpty>{roundsQ.isLoading ? "Loading recorded activity…" : loadError ? "Activity could not be loaded." : filter === "positions" && !address ? "Connect your wallet to view your position activity." : "No recorded events in this view."}</AccountEmpty>}
        <AccountPagination page={page} count={filtered.length} onChange={setPage} />
        <div className="account-results"><span>{filtered.length} recorded events</span><span>{address ? "Wallet scope" : "Network scope"}</span></div>
      </AccountPanel>
      <div className="account-stack">
        <AccountPanel title="System & watcher health" icon="activity" description="Current watcher reachability and Canton services.">
          <div className="account-health-list">{liveChains().map(chain => { const watcher = watchersQ.isError ? undefined : watchersQ.data?.find(item => item.chain === chain.id || item.chain.startsWith(`${chain.id}-`)); return <div key={chain.id}><ChainBadge symbol={chain.symbol} label={chain.id === "polygon" ? "Polygon PoS" : chain.name} /><div><StatusBadge status={watcher?.status === "ok" ? "Healthy" : watcher?.status === "unreachable" ? "Unreachable" : "Unknown"} /><small>{watcher?.lastSuccessAt ? `Last successful check ${new Date(watcher.lastSuccessAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No successful check reported"}</small></div></div>; })}
            <div><strong>Canton ledger</strong><StatusBadge status={status} /></div>
            <div><strong>Reward worker</strong><StatusBadge status={health?.status === "ok" ? "Healthy" : health?.status ?? "Unknown"} /></div>
          </div>
          <p className="account-muted">{health?.successRatePct == null ? "Reward success rate is not available." : `${health.successRatePct.toFixed(1)}% success across the last ${health.totalSampled} reward attempts.`}</p>
        </AccountPanel>
        <PrivacyPanel />
      </div>
    </div>
    <div className="account-analytics-bottom">
      <AccountPanel title="Marker activity · last 24 hours" icon="activity" description={markers ? `${markers.insight.totalMarkers} markers · ${markers.scope} scope` : "Waiting for recorded marker data."}>
        {markers ? <MiniChart values={markers.series.map(bucket => bucket.markers)} label="Recorded marker count per hour over the last 24 hours" /> : <div className="account-chart-empty">{markersQ.isError ? "Marker history is unavailable." : "Loading marker history…"}</div>}
        <div className="account-chart-caption"><span>24 hours ago</span><span>Now</span></div>
        <p className="account-muted">{typeof delta === "number" ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% compared with the previous 24-hour window.` : "Not enough recorded history for a window-over-window comparison."}</p>
      </AccountPanel>
      <AccountPanel title="Network market data" icon="coin">
        {liveChains().map(chain => <div key={chain.id} className="account-market-row"><ChainBadge symbol={chain.symbol} label={chain.id === "polygon" ? "Polygon PoS" : chain.name} /><div><strong>{prices && chain.id === "polygon" ? fmtUsd(prices.polUsd, 4) : "—"}</strong><small>{prices?.source.pol === "coingecko" ? "Market price" : "Indicative reference price"}</small></div></div>)}
        <dl className="account-definition"><div><dt>Bond markers</dt><dd>{markers?.breakdown.bondCount ?? "—"}</dd></div><div><dt>Unbond markers</dt><dd>{markers?.breakdown.unbondCount ?? "—"}</dd></div></dl>
      </AccountPanel>
    </div>
  </div>;
}
