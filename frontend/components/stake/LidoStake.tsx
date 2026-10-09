"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { liveChains } from "@/lib/chains";
import { fetchChainStats, fetchWatcherStatus } from "@/lib/api";
import { StakeChainPicker } from "./StakeChainPicker";
import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { getAccount, sendTransaction } from "wagmi/actions";
import { formatEther, type Hex } from "viem";
import { hoodi } from "viem/chains";
import { AccountPanel, ChainBadge, StatusBadge } from "@/components/account/AccountUI";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { useWalletPicker } from "@/components/WalletPickerProvider";
import { networkMode } from "@/lib/network";
import { wagmiConfig } from "@/lib/wagmi";
import { LIDO, LIDO_QUEUE, assertLidoAccount, lidoAmount, validateLidoAction, validateLidoClaim } from "@/lib/lido";
import { executeLidoAction, type LidoAction } from "@/lib/lido-transactions";
import { useLidoState } from "@/lib/use-lido";

function walletError(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage;
  return error instanceof Error ? error.message : "The wallet action failed. Please try again.";
}

export function LidoStake() {
  const router = useRouter();
  const catalog = useQuery({ queryKey: ["chain-stats"], queryFn: fetchChainStats, refetchInterval: 300000 });
  const watchers = useQuery({ queryKey: ["watcher-status"], queryFn: fetchWatcherStatus, refetchInterval: 30000 });
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { openPicker } = useWalletPicker();
  const query = useLidoState();
  const { state } = query;
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("0.01");
  const [review, setReview] = useState<{ action: LidoAction; value: bigint; context: string; expires: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [transactions, setTransactions] = useState<{ wallet: string; label: string; hash: Hex }[]>([]);
  const mounted = useRef(true);
  const lock = useRef(false);
  const context = `${address?.toLowerCase()}:${chainId}:${action}:${amount}`;
  const current = useRef(context);
  current.current = context;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => { setReview(null); setError(""); setNotice(""); }, [context]);
  const wrongNetwork = !!address && chainId !== hoodi.id;
  const ready = !!address && !wrongNetwork && !!state && now - state.fetchedAt < 30000 && !busy && !switching;
  const accepted = review?.context === context && review.expires > now ? review : null;

  function prepare(kind: LidoAction = action, id?: bigint) {
    if (!ready || !address || !state) return;
    setError(""); setNotice(""); setReview(null);
    try {
      assertLidoAccount(address, getAccount(wagmiConfig));
      const value = kind === "claim" ? id! : lidoAmount(amount);
      if (kind === "claim") validateLidoClaim(state.requests.find(row => row.id === value), address);
      else validateLidoAction(state, address, kind, value);
      setReview({ action: kind, value, context, expires: Date.now() + 120000 });
    } catch (e) { setError(walletError(e)); }
  }
  async function execute() {
    if (!accepted || !ready || !address || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const wallet = address;
    const snapshot = accepted;
    try {
      await executeLidoAction({ action: snapshot.action, amountOrId: snapshot.value, wallet,
        assertCurrent: () => {
          assertLidoAccount(wallet, getAccount(wagmiConfig));
          if (!mounted.current || current.current !== snapshot.context) throw Error("Staking details changed. Review again before signing.");
          if (Date.now() > snapshot.expires) throw Error("Review expired. Review again to continue; any confirmed approval remains valid.");
        },
        send: tx => sendTransaction(wagmiConfig, tx),
        onTransaction: (label, hash, replaces) => {
          if (mounted.current) setTransactions(rows => [...rows.filter(row => row.hash !== replaces), { wallet: wallet.toLowerCase(), label, hash }]);
        },
        onProgress: message => { if (mounted.current && current.current === snapshot.context) setNotice(message); },
      });
      if (mounted.current && current.current === snapshot.context) setNotice(snapshot.action === "deposit"
        ? "Stake confirmed on Hoodi. Your wallet's stETH balance reflects the pooled position."
        : snapshot.action === "withdraw" ? "Withdrawal requested. Claim your test ETH here after Lido finalizes the request."
        : "Withdrawal claimed. Hoodi test ETH was sent to your wallet.");
    } catch (e) {
      if (mounted.current && current.current === snapshot.context) { setNotice(""); setError(walletError(e)); }
    } finally {
      lock.current = false;
      if (mounted.current) { setBusy(false); setReview(null); void query.refetch(); }
    }
  }

  if (networkMode !== "testnet") return <AccountPanel title="Ethereum pool staking" description="Hoodi staking is available on the testnet site only."><Link href="/stake">Back to staking</Link></AccountPanel>;
  return <section className="account-liquid account-lido" aria-label="Ethereum Lido staking">
    <PageMasthead index="02" section="Ethereum · Hoodi testnet" title="Stake ETH." accent="One Lido pool." description="Deposit Hoodi test ETH into Lido and receive test stETH in your wallet. Lido selects the operators; you do not need to choose a validator." note="Test assets only · No 32 ETH minimum for pool deposits" />
    <div className="account-liquid-workspace">
      <AccountPanel title="01 · Select chain" icon="link" description="Choose a network and its staking flow.">
        <StakeChainPicker chains={liveChains()} selectedChainId="ethereum" polygonLiquid busy={busy || switching}
          enabledChainIds={catalog.data?.chains.map(chain => chain.chain)} watchers={watchers.data}
          statusUnavailable={catalog.isError || watchers.isError}
          onSelect={chain => router.push(`/stake?chain=${chain.id}`)} />
      </AccountPanel>
      <AccountPanel title="02 · Lido pool" icon="coin" description="Ethereum pooled liquid staking">
        <ChainBadge symbol="ETH" label="Ethereum · Hoodi" />
        <dl className="account-definition"><div><dt>Receive</dt><dd>Hoodi stETH</dd></div><div><dt>Validator selection</dt><dd>Automatic allocation by Lido</dd></div><div><dt>Withdrawals</dt><dd>Request → wait → claim ETH</dd></div><div><dt>Canton / CC rewards</dt><dd>Not enabled for this route</dd></div></dl>
        <p className="account-muted">The stETH balance changes with Lido's staking reports and wallet transfers. It is not a separate rewards payout or a guaranteed return.</p>
        <p className="account-amount-warning">Use Hoodi ETH, not Sepolia ETH. Test assets have no cash value.</p>
        <a className="account-text-link" href="https://hoodi.ethpandaops.io/" target="_blank" rel="noreferrer">Get Hoodi test ETH ↗</a>
      </AccountPanel>
      <AccountPanel className="account-liquid-form" title="03 · Stake or withdraw" icon="wallet" description="Review your action before signing in your wallet.">
        <div className="account-liquid-tabs" role="group" aria-label="Lido action">
          <button className="account-button" aria-pressed={action === "deposit"} disabled={busy} onClick={() => setAction("deposit")}>Stake ETH</button>
          <button className="account-button" aria-pressed={action === "withdraw"} disabled={busy} onClick={() => setAction("withdraw")}>Withdraw stETH</button>
        </div>
        {address && <p className="account-muted account-connected-wallet">Wallet: {address}</p>}
        <div className="account-liquid-balances account-lido-balances"><p>Hoodi ETH: {address && state ? formatEther(state.balance) : "—"}</p><p>Hoodi stETH: {address && state ? formatEther(state.stETH) : "—"}</p></div>
        <label className="account-stake-amount"><span className="sr-only">Lido amount</span><input aria-label="Lido amount" inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} /><span>{action === "deposit" ? "ETH" : "stETH"}</span></label>
        <p className="account-muted">{action === "deposit" ? "Keep ETH for gas. stETH is minted at the execution-time share rate; the deposit has no minimum-output parameter." : `Request limits: ${state ? `${formatEther(state.minWithdrawal)}–${formatEther(state.maxWithdrawal)} stETH` : "loading"}. Approval is limited to your entered amount. Queued stETH stops earning rewards; finalization time and ETH received can vary.`}</p>
        {wrongNetwork && <p role="status">Switch your wallet to Hoodi to continue.</p>}
        <div className="account-liquid-actions">
          {!address ? <button className="account-button account-button--primary" onClick={openPicker}>Connect wallet</button>
            : wrongNetwork ? <button className="account-button account-button--primary" disabled={busy || switching} onClick={async () => { try { setError(""); await switchChainAsync({ chainId: hoodi.id }); } catch(e) { setError(walletError(e)); } }}>{switching ? "Switching…" : "Switch to Hoodi"}</button>
            : <button className="account-button" disabled={!ready} onClick={() => prepare()}>{action === "deposit" ? "Review stake" : "Review withdrawal"}</button>}
        </div>
        {accepted && <div className="account-liquid-quote" role="status">
          <p><strong>{accepted.action === "claim" ? `Claim withdrawal #${accepted.value}` : `${accepted.action === "deposit" ? "Stake" : "Request withdrawal of"} ${formatEther(accepted.value)} ${accepted.action === "deposit" ? "ETH" : "stETH"}`}</strong></p>
          <p>Network: Hoodi · Recipient: your connected wallet</p>
          <p>{accepted.action === "deposit" ? `Expected stETH: approximately ${formatEther(accepted.value)} (share rounding applies).` : accepted.action === "withdraw" ? "Your wallet may ask for approval, then the withdrawal request. ETH is claimed separately after finalization." : "Claims the finalized ETH amount reserved by Lido for this request."}</p>
          <button className="account-button account-button--primary" disabled={!ready} onClick={execute}>{busy ? "Working…" : accepted.action === "deposit" ? "Confirm stake" : accepted.action === "withdraw" ? "Confirm withdrawal request" : "Confirm claim"}</button>
        </div>}
        {review && !accepted && !busy && <p role="status">Review expired. Review your action again.</p>}
        {busy && <p role="status">Transaction in progress…</p>}
        {state?.paused && <p role="status">Lido deposits are currently paused.</p>}
        {query.isError && <p role="alert">Hoodi staking data unavailable. {walletError(query.error)} <button className="account-button" disabled={busy} onClick={() => void query.refetch()}>Retry</button></p>}
        {error && <p role="alert" className="text-red-400 break-words">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {transactions.filter(tx => tx.wallet === address?.toLowerCase()).map(tx => <a key={tx.hash} className="account-text-link block break-all" href={`https://hoodi.etherscan.io/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.label}: {tx.hash} ↗</a>)}
      </AccountPanel>
    </div>
    <div className="account-liquid-secondary account-lido-secondary">
    <AccountPanel title="Your withdrawal requests" icon="clock" description="Requests are recovered from Hoodi for the connected wallet, including after a refresh.">
      {!address ? <p>Connect your EVM wallet to view requests.</p> : !state ? <p>Withdrawal requests unavailable / loading.</p> : !state.requests.length ? <p>No pending withdrawal requests.</p> : state.requests.map(row => <div className="account-position-actions" key={String(row.id)}>
        <span>#{String(row.id)} · {formatEther(row.amountOfStETH)} stETH requested</span>
        <StatusBadge status={row.isClaimed ? "Completed" : row.isFinalized ? "Ready to claim" : "Pending finalization"} />
        {row.isFinalized && !row.isClaimed && <button className="account-button" disabled={!ready} onClick={() => prepare("claim", row.id)}>Review claim #{String(row.id)}</button>}
      </div>)}
      <p className="account-muted">Claimed requests disappear from your wallet's queue. Transactions remain visible on Hoodi Etherscan.</p>
    </AccountPanel>
    <details className="account-liquid-details"><summary>Pool contracts &amp; position tracking</summary><div>
      <p>Balances and withdrawal requests are read directly from Hoodi. This route does not create a Canton staking position or earn CC rewards.</p>
      <a className="account-text-link block" href={`https://hoodi.etherscan.io/address/${LIDO}`} target="_blank" rel="noreferrer">Lido / stETH contract ↗</a>
      <a className="account-text-link block" href={`https://hoodi.etherscan.io/address/${LIDO_QUEUE}`} target="_blank" rel="noreferrer">Lido withdrawal queue ↗</a>
      <Link className="account-text-link" href="/positions">View your holdings →</Link>
    </div></details>
    </div>
  </section>;
}
