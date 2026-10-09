"use client";

import { useId, useState, type CSSProperties } from "react";
import Link from "next/link";
import { networkMode } from "@/lib/network";
import { ChainBadge, StatusBadge } from "@/components/account/AccountUI";
import type { ChainConfig } from "@/lib/chains";
import type { WatcherStatus } from "@/lib/api";

type Props = {
  chains: ChainConfig[];
  selectedChainId: ChainConfig["id"] | "ethereum";
  enabledChainIds?: string[];
  watchers?: WatcherStatus[];
  statusUnavailable?: boolean;
  busy: boolean;
  onSelect: (chain: ChainConfig) => void;
  polygonLiquid?: boolean;
};

export function StakeChainPicker({ chains, selectedChainId, enabledChainIds, watchers, statusUnavailable, busy, onSelect, polygonLiquid = false }: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const ethereumSelected = selectedChainId === "ethereum";
  const selected = chains.find(chain => chain.id === selectedChainId);
  const query = search.trim().toLowerCase();
  const visible = chains.filter(chain => `${chain.name} ${chain.id} ${chain.symbol}`.toLowerCase().includes(query));
  return <div className="account-chain-picker">
    <button type="button" className="account-chain-toggle" aria-expanded={expanded} aria-controls={contentId} disabled={busy} onClick={() => setExpanded(value => !value)}>
      <span>{ethereumSelected ? "Ethereum · Hoodi" : selected?.id === "polygon" ? "Polygon PoS" : selected?.name}<small>{ethereumSelected ? "ETH · Lido pool" : selected?.symbol}{polygonLiquid && selected?.id === "polygon" ? " · Amoy" : ""}</small></span>
      <span>{expanded ? "Close networks ↑" : "Change network ↓"}</span>
    </button>
    <div id={contentId} className={`account-chain-picker__content${expanded ? " is-expanded" : ""}`}>
    <label className="account-chain-search">
      <span className="sr-only">Search networks</span>
      <input className="account-field" type="search" placeholder="Search networks or tokens" value={search}
        onChange={event => setSearch(event.target.value)} disabled={busy} />
    </label>
    <p className="account-muted">{chains.length + (networkMode === "testnet" ? 1 : 0)} {chains[0]?.testnet ? "testnet networks" : "networks"} configured</p>
    <div className="account-chain-options" role="group" aria-label="Staking networks">
      {networkMode === "testnet" && "ethereum eth hoodi lido".includes(query) && (busy
        ? <button className="account-chain-option" disabled><ChainBadge symbol="ETH" label="Ethereum · Hoodi" /><span>Lido pool</span></button>
        : <Link href="/stake/ethereum" aria-current={ethereumSelected ? "page" : undefined} className="account-chain-option" style={{ "--chain-color": "#8da7e8" } as CSSProperties}><ChainBadge symbol="ETH" label="Ethereum · Hoodi" /><span className="account-chain-option__details"><small>ETH</small><StatusBadge status="Lido pool" /></span></Link>)}
      {visible.map(chain => {
        const watcher = watchers?.find(item => item.chain === chain.id);
        const status = polygonLiquid && chain.id === "polygon" ? "Liquid route · Amoy"
          : chain.hasAdapter === false ? "Coming soon"
          : statusUnavailable ? "Status unavailable"
          : !enabledChainIds ? "Checking"
          : !enabledChainIds.includes(chain.id) ? "Not enabled"
          : !watcher || watcher.status === "unknown" ? "Checking watcher"
          : watcher.status !== "ok" ? "Watcher unavailable"
          : "Watcher ready";
        return <button type="button" key={chain.id} className="account-chain-option"
          style={{ "--chain-color": chain.color } as CSSProperties}
          aria-pressed={selectedChainId === chain.id} disabled={busy || chain.hasAdapter === false}
          onClick={() => { onSelect(chain); setExpanded(false); setSearch(""); }}>
          <ChainBadge chainId={chain.id} symbol={chain.symbol} label={chain.id === "polygon" ? "Polygon PoS" : chain.name} />
          <span className="account-chain-option__details"><small>{chain.symbol}</small><StatusBadge status={status} /></span>
        </button>;
      })}
      {!visible.length && !(networkMode === "testnet" && "ethereum eth hoodi lido".includes(query)) && <p className="account-muted" role="status">No networks match your search.</p>}
    </div>
    <p className="account-muted">{networkMode === "testnet" ? "Ethereum uses Lido on Hoodi. Polygon offers Amoy liquid staking and advanced validator staking. Each route checks its own readiness before signing." : "Select a network to inspect its staking flow. Signing requires a ready watcher and Canton connection."}</p>
    </div>
  </div>;
}
