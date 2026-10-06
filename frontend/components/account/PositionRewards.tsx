"use client";

import { useId, useRef, useState } from "react";
import type { PositionRow } from "@/lib/api";
import { accountChain, rewardPositionLabel } from "@/lib/account-view";
import { fmt } from "@/lib/format";
import { networkMode } from "@/lib/network";
import { positionList, type ListedPosition } from "@/lib/position-list";
import { I, IconExternal } from "@/components/icons";
import type { useLiquidHoldings } from "./LiquidHoldings";
import { AccountEmpty, AccountLink, AccountPanel, ChainBadge } from "./AccountUI";

export function PositionRewards({ positions, totals, allocationsAvailable, holdings, connected, days, positionsUnavailable, positionsUpdatedAt, walletScope, loopPaymentsDisabled = false, positionsLoading = false }: {
  positions: PositionRow[]; totals: Map<string, number>; allocationsAvailable: boolean;
  holdings: ReturnType<typeof useLiquidHoldings>; connected: boolean; days: number; positionsUnavailable: boolean;
  positionsUpdatedAt?: number;
  walletScope?: string; loopPaymentsDisabled?: boolean; positionsLoading?: boolean;
}) {
  const scope = walletScope ?? holdings.address;
  const [selection, setSelection] = useState({ wallet: scope, chain: "all" });
  const list = useRef<HTMLDivElement>(null);
  const entries = connected ? positionList(positionsUnavailable ? [] : positions,
    networkMode === "testnet" && !holdings.isError ? holdings.state : undefined, holdings.address)
    .sort((a, b) => Number(b.kind === "liquid") - Number(a.kind === "liquid")) : [];
  const networks = [...new Set(entries.map(entry => entry.chainId))].map(id => ({
    id, name: id === "polygon" ? "Polygon" : entries.find(entry => entry.chainId === id)!.chainName.replace(/ Testnet$/, ""),
    symbol: entries.find(entry => entry.chainId === id)!.symbol,
    count: entries.filter(entry => entry.chainId === id).length,
  }));
  const selected = selection.wallet === scope && networks.some(network => network.id === selection.chain) ? selection.chain : "all";
  const visible = entries.filter(entry => selected === "all" || entry.chainId === selected);
  const primary = networks.slice(0, 2), more = networks.slice(2);
  const select = (chain: string) => {
    setSelection({ wallet: scope, chain });
    list.current?.scrollTo({ top: 0 });
  };
  return <AccountPanel title="Position rewards" icon="cube" description={`CC allocations · last ${days} days`} id="position-rewards"
    className="account-position-rewards" action={<AccountLink href="/positions">View all positions</AccountLink>}>
    {entries.length > 0 ? <>
      <div className="account-reward-network-filters" role="group" aria-label="Filter position rewards by network">
        <button type="button" aria-pressed={selected === "all"} onClick={() => select("all")}>All ({entries.length})</button>
        {primary.map(network => <button type="button" key={network.id} aria-pressed={selected === network.id} onClick={() => select(network.id)}><ChainBadge chainId={network.id === "polygon" ? "polygon" : undefined} symbol={network.symbol} label={`${network.name} (${network.count})`} /></button>)}
        {more.length > 0 && <select aria-label="More reward networks" value={more.some(network => network.id === selected) ? selected : ""}
          data-selected={more.some(network => network.id === selected)} onChange={event => select(event.target.value)}>
          <option value="" disabled>+{more.length} more</option>
          {more.map(network => <option key={network.id} value={network.id}>{network.name} ({network.count})</option>)}
        </select>}
      </div>
      <div ref={list} className="account-reward-position-scroll" tabIndex={0} role="region" aria-label="Position rewards list">
        <ul className="account-reward-position-list">{visible.map(entry => <RewardPositionCard key={entry.id} entry={entry}
          allocation={totals.get(entry.id) ?? 0} allocationsAvailable={allocationsAvailable}
          ccDisabled={loopPaymentsDisabled && entry.kind === "validator"}
          updatedAt={entry.kind === "liquid" ? holdings.updatedAt : positionsUpdatedAt} />)}</ul>
      </div>
      <footer className="account-reward-position-footer"><span aria-live="polite">Showing {visible.length} of {entries.length} positions</span><AccountLink href="/positions">Manage positions</AccountLink></footer>
    </> : <AccountEmpty>{!connected ? "Your positions and reward status appear here." : positionsLoading || holdings.isLoading ? "Loading positions…" : positionsUnavailable || holdings.isError ? "Position rewards are temporarily unavailable." : "No active positions to display."}</AccountEmpty>}
    {networkMode === "testnet" && holdings.isError && <p role="status" className="account-amount-warning">Liquid reward status is temporarily unavailable. <button className="account-button" onClick={() => void holdings.refetch()}>Retry liquid holdings</button></p>}
    {positionsUnavailable && <p role="status" className="account-amount-warning">Validator allocations are temporarily unavailable.</p>}
  </AccountPanel>;
}

function RewardPositionCard({ entry, allocation, allocationsAvailable, updatedAt, ccDisabled }: {
  entry: ListedPosition; allocation: number; allocationsAvailable: boolean; updatedAt?: number; ccDisabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const liquid = entry.kind === "liquid";
  const chain = entry.kind === "validator" ? accountChain(entry.position) : undefined;
  const explorer = entry.kind === "liquid" ? `https://amoy.polygonscan.com/token/${entry.state.token}?a=${entry.state.wallet}`
    : entry.position.chainMeta?.evmTxHash ? chain?.explorer?.tx(entry.position.chainMeta.evmTxHash) : undefined;
  const allocationText = liquid || ccDisabled ? "Disabled" : allocationsAvailable && Number.isFinite(allocation) ? `${fmt(allocation, 2)} CC` : "—";
  const status = liquid ? "Holding" : entry.status;
  return <li className="account-reward-position-card" data-staking-type={entry.kind}>
    <div className="account-reward-position-heading">
      <div className="account-reward-position-identity">
        <ChainBadge chainId={chain?.id ?? "polygon"} symbol={entry.symbol} label="" />
        <div><div className="account-reward-position-name"><strong>{entry.chainName}</strong><span className="account-reward-environment mono">{networkMode}</span></div>
          <small>{liquid ? "Liquid staking position" : "Validator staking position"}</small></div>
      </div>
      <span className="account-reward-position-status" data-active={liquid || entry.status === "Bonded"}><i />{status}</span>
      <button type="button" className="account-reward-expand" aria-expanded={expanded} aria-controls={detailsId}
        aria-label={`${expanded ? "Hide" : "Show"} reward details for ${entry.chainName}${entry.kind === "validator" ? ` · ${rewardPositionLabel(entry.position)}` : ""}`}
        onClick={() => setExpanded(!expanded)}><I size={16}><path d="m4 6 4 4 4-4" /></I></button>
    </div>
    <strong className="account-reward-position-amount">{liquid ? entry.amount : fmt(Number(entry.amount), 2)} {entry.symbol}{entry.status === "Bonded" ? " bonded" : ""}</strong>
    <dl className="account-reward-position-stats">
      <div><dt title="Native yield measurement is not available for this position.">Native yield <span aria-hidden="true"><I size={11}><circle cx="8" cy="8" r="6" /><path d="M8 7v4M8 4.5v.5" /></I></span></dt><dd>Not measured</dd></div>
      <div><dt title={liquid ? "CC allocations are disabled for the Amoy liquid staking route." : ccDisabled ? "Loop TestNet claims and beneficiary splits are not configured." : "Recorded beneficiary share; not proof of payment."}>CC allocation <span aria-hidden="true"><I size={11}><circle cx="8" cy="8" r="6" /><path d="M8 7v4M8 4.5v.5" /></I></span></dt><dd>{allocationText}</dd></div>
    </dl>
    <div id={detailsId} hidden={!expanded} className="account-reward-position-details">
      {entry.kind === "validator" && <p>{rewardPositionLabel(entry.position)}</p>}
      <p>{liquid ? "Liquid yield reporting is not available yet. CC allocations are disabled for this Amoy test route."
        : ccDisabled ? "CC claims and per-user beneficiary splits are not configured for this Loop TestNet position."
        : !allocationsAvailable ? "Recorded CC allocations are temporarily unavailable."
        : allocation === 0 ? "No CC allocations recorded in this period." : "CC amounts show recorded beneficiary allocations, not verified payments."}</p>
      {networkMode === "testnet" && <p>Test tokens have no cash value.</p>}
    </div>
    <footer className="account-reward-card-footer">
      <span>{updatedAt && Number.isFinite(updatedAt) ? <time dateTime={new Date(updatedAt).toISOString()} title="Last successful position data refresh">Checked {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : liquid ? "Current holdings" : "Recorded position"}</span>
      <AccountLink href={`/positions?position=${encodeURIComponent(entry.id)}`}>View position</AccountLink>
      {explorer && <a className="account-reward-explorer" href={explorer} target="_blank" rel="noreferrer" aria-label={`View ${entry.chainName} ${liquid ? "holding" : "stake transaction"} on explorer`}><IconExternal size={14} /></a>}
    </footer>
  </li>;
}
