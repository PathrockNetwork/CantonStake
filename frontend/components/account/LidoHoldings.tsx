"use client";
import Link from "next/link";
import { formatEther } from "viem";
import { networkMode } from "@/lib/network";
import { useLidoState } from "@/lib/use-lido";
import { AccountPanel, ChainBadge } from "./AccountUI";

export function LidoHoldings() {
  const query = useLidoState();
  if (networkMode !== "testnet") return null;
  const { state, address } = query;
  return <AccountPanel title="Ethereum · Lido pool" icon="coin" description="Hoodi testnet holdings · Separate from Canton positions and portfolio totals">
    <ChainBadge symbol="ETH" label="Hoodi stETH" />
    {!address ? <p>Connect your EVM wallet to view your stETH.</p> : !state ? <p role="status">{query.isError ? "Lido holdings unavailable." : "Loading Lido holdings…"} {query.isError && <button className="account-button" onClick={() => void query.refetch()}>Retry Lido holdings</button>}</p> : <>
      <div className="account-position-amount"><strong>{formatEther(state.stETH)} stETH</strong></div>
      <p>{state.requests.filter(row => !row.isClaimed).length} withdrawal requests · {state.requests.filter(row => row.isFinalized && !row.isClaimed).length} ready to claim</p>
      <p className="account-muted account-connected-wallet">Wallet: {address}</p>
    </>}
    <p className="account-muted">Test assets only. Canton tracking and CC rewards are not enabled for this pool.</p>
    <Link className="account-button" href="/stake/ethereum">Stake / manage withdrawals →</Link>
  </AccountPanel>;
}
