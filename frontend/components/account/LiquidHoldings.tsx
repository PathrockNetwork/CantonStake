"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { networkMode } from "@/lib/network";
import { AMOY_SPOL, assertLiquidState, fetchLiquidState } from "@/lib/polygon-liquid";
import { AccountEmpty, ChainBadge, StatusBadge } from "./AccountUI";

export function useLiquidHoldings() {
  const { address } = useAccount();
  const enabled = networkMode === "testnet" && !!address;
  const holdings = useQuery({
    queryKey: ["polygon-liquid", address?.toLowerCase() ?? null],
    queryFn: ({ signal }) => fetchLiquidState(address, signal),
    enabled,
    refetchInterval: 15000,
    retry: false,
  });
  // Validate cached responses too: account changes and failed refreshes must
  // never expose another wallet's balance or leave a stale balance actionable.
  let state = enabled && !holdings.isError ? holdings.data : undefined;
  if (state) {
    try { assertLiquidState(state, address); } catch { state = undefined; }
  }
  return { address, state, updatedAt: state ? holdings.dataUpdatedAt : undefined, isLoading: enabled && holdings.isLoading,
    isError: enabled && (holdings.isError || (!!holdings.data && !state)), refetch: holdings.refetch };
}

export function LiquidHoldings({ holdings }: { holdings: ReturnType<typeof useLiquidHoldings> }) {
  const { address, state } = holdings;
  if (networkMode !== "testnet") return null;
  const shares = state ? BigInt(state.sharesBalance!) : null;
  const tracking = state?.tracking;
  return <div className="account-liquid-holdings" id="liquid-holdings">
    {!address ? <AccountEmpty>Connect your EVM wallet to view your Amoy sPOL holdings.</AccountEmpty>
      : !state ? <AccountEmpty>{holdings.isLoading ? "Loading your Amoy sPOL holdings…" : <><span role="status">Amoy sPOL holdings are temporarily unavailable.</span><button className="account-button" onClick={() => void holdings.refetch()}>Retry liquid holdings</button></>}</AccountEmpty>
      : <>
        <div className="account-liquid-holding-grid">
          <div>
            <div className="account-position-heading"><ChainBadge chainId="polygon" symbol="sPOL" label="Polygon Amoy · liquid staking" /><StatusBadge status={shares! > 0n ? "Active" : "No holdings"} /></div>
            <p><span className="account-status account-status--liquid mono">Liquid staking</span></p>
            <div className="account-position-amount"><strong>{formatEther(shares!)} sPOL</strong><span className="account-muted">Current on-chain balance · Test tokens have no cash value.</span></div>
            <p className="account-muted account-liquid-owner">Wallet: {address}</p>
            {shares === 0n && <p className="account-muted">No sPOL is currently held by this wallet. Deposits, transfers and swap exits update this balance.</p>}
          </div>
          <dl className="account-definition">
            <div><dt>Staking type</dt><dd>Pooled liquid staking</dd></div>
            <div><dt>Canton tracking</dt><dd>{tracking === "unavailable" ? "Unavailable" : tracking ? `Recorded at block ${tracking.observedBlock}` : "Not enabled"}</dd></div>
            <div><dt>CC rewards</dt><dd>Disabled</dd></div>
            <div><dt>Exit route</dt><dd>Swap sPOL to Amoy POL</dd></div>
          </dl>
        </div>
        <div className="account-position-actions">
          {shares! > 0n && <Link href="/stake/liquid?action=exit" className="account-button account-button--primary">Swap exit to Amoy POL →</Link>}
          <Link href="/stake/liquid" className="account-button">{shares! > 0n ? "Stake more Amoy POL" : "Stake Amoy POL"}</Link>
          <a href={`https://amoy.polygonscan.com/token/${AMOY_SPOL}?a=${address}`} className="account-text-link" target="_blank" rel="noreferrer">View sPOL on explorer ↗</a>
        </div>
        <p className="account-muted">Swap exits depend on available test liquidity and a fresh quote. Review the amount and fees before approving in your wallet.</p>
      </>}
  </div>;
}
