"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHAINS, isChainEnabled } from "@/lib/chains";
import { networkMode } from "@/lib/network";
import { NETWORK_LOGOS } from "@/components/account/ChainBadge";
import { IconArrowRight } from "@/components/icons";
import { fetchLiquidState } from "@/lib/polygon-liquid";
import { nativeAvailability, poolAvailability, type HomeReadiness, type HomeWatchers, type NetworkAvailability } from "@/lib/home-networks";

const names: Record<string, string> = { polygon: "Polygon PoS", cosmos: "Cosmos Hub", sui: "Sui", monad: "Monad", celestia: "Celestia", osmosis: "Osmosis", aptos: "Aptos", polkadot: "Polkadot", bnb: "BNB Chain", solana: "Solana" };
const order = ["polygon", "cosmos", "sui", "monad", "celestia", "osmosis", "aptos", "polkadot", "bnb", "solana"];
const backend = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001").replace(/\/$/, "");
async function readStatus<T>(path: string, readiness = false): Promise<T> {
  const response = await fetch(`${backend}${path}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok && !(readiness && response.status === 503)) throw Error("Network status unavailable");
  return response.json();
}
function NetworkCard({ id, name, symbol, route, href, availability, pool }: {
  id: string; name: string; symbol: string; route: string; href: string; availability: NetworkAvailability; pool?: string;
}) {
  return <Link href={href} data-network={id} data-status={availability.label}
    className={`home-chain-card${availability.tone === "ready" ? " home-chain-card--live" : ""}`}
    aria-label={`${name}: ${availability.label}. View staking route`}>
    <span className={`home-network-mark home-network-mark--${id}`} aria-hidden="true">
      <img src={id === "ethereum" ? "/networks/ethereum.svg" : NETWORK_LOGOS[id as keyof typeof NETWORK_LOGOS]} width="38" height="38" alt="" />
    </span>
    <div className="home-chain-card__body"><strong>{name}</strong><small className="mono">{symbol} · {route}</small>
      <b className="mono" data-tone={availability.tone}>{availability.label}</b>
      <p>{pool || availability.detail}</p>
      {pool && availability.tone === "unavailable" && <p>{availability.detail}</p>}
    </div><IconArrowRight className="home-chain-card__arrow" />
  </Link>;
}

export function SupportedNetworks() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const options = { refetchInterval: 30000, retry: false as const };
  const readiness = useQuery({ queryKey: ["home-network-readiness", networkMode], queryFn: () => readStatus<HomeReadiness>("/api/readiness", true), ...options });
  const watchers = useQuery({ queryKey: ["home-network-watchers", networkMode], queryFn: () => readStatus<HomeWatchers>("/api/watchers"), ...options });
  const catalog = useQuery({ queryKey: ["home-network-catalog", networkMode], queryFn: () => readStatus<{ chains: Array<{ chain: string }> }>("/api/chains/stats"), ...options });
  const amoy = useQuery({ queryKey: ["home-amoy-pool"], enabled: networkMode === "testnet" && isChainEnabled("polygon"), queryFn: async () => {
    const state = await fetchLiquidState(undefined, AbortSignal.timeout(12000));
    return { paused: state.paused, available: state.rateFresh };
  }, ...options });
  const hoodi = useQuery({ queryKey: ["home-hoodi-pool"], enabled: networkMode === "testnet", queryFn: async () => {
    const { readLidoState } = await import("@/lib/lido");
    const state = await readLidoState();
    return { paused: state.paused, available: state.stakeLimit > 0n };
  }, ...options });
  const snapshot = <T,>(q: { data?: T; isError: boolean; dataUpdatedAt: number }) => ({ data: q.data, failed: q.isError, updatedAt: q.dataUpdatedAt });
  const chains = [...CHAINS].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return <section className="home-supported" aria-labelledby="networks-heading">
    <h2 className="home-section-label mono" id="networks-heading"><span /> Supported chains</h2>
    <p className="home-network-caption">{chains.length + (networkMode === "testnet" ? 1 : 0)} networks · {networkMode === "testnet" ? "Testnet" : "Mainnet"} · Current staking availability</p>
    <div className="home-chain-row" data-mode={networkMode}>
      {chains.map(chain => {
        const pool = chain.id === "polygon" && networkMode === "testnet" && isChainEnabled("polygon");
        const availability = pool ? poolAvailability(snapshot(amoy), now) : nativeAvailability({ id: chain.id,
          configured: isChainEnabled(chain.id), adapter: chain.hasAdapter !== false, mode: networkMode,
          externalLoop: process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external", now,
          readiness: snapshot(readiness), watchers: snapshot(watchers), catalog: snapshot(catalog) });
        return <NetworkCard key={chain.id} id={chain.id} name={names[chain.id] ?? chain.name} symbol={chain.symbol}
          route={pool ? "Amoy pool" : networkMode === "testnet" ? "Testnet validators" : "Validators"}
          availability={availability} href={`/stake?chain=${chain.id}`}
          pool={pool ? "POL → sPOL on Amoy. Pool status is independent of the advanced Sepolia validator route." : undefined} />;
      })}
      {networkMode === "testnet" && <NetworkCard id="ethereum" name="Ethereum" symbol="ETH" route="Hoodi · Lido pool"
        href="/stake/ethereum" availability={poolAvailability(snapshot(hoodi), now)} pool="ETH → stETH. No validator selection. Canton tracking and CC rewards are not enabled." />}
    </div>
    <p className="home-network-caption">Availability is checked periodically and again before signing. CC rewards depend on the route, account eligibility and the rewards service.</p>
  </section>;
}
