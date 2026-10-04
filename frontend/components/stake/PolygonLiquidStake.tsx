"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { getAccount, getPublicClient, sendTransaction, waitForTransactionReceipt } from "@wagmi/core";
import { decodeEventLog, encodeFunctionData, erc20Abi, formatEther, parseAbi, parseEther, parseGwei, type Address, type Hex } from "viem";
import { wagmiConfig } from "@/lib/wagmi";
import { isMainnet } from "@/lib/network";
import { useWalletPicker } from "@/components/WalletPickerProvider";
import { AccountPanel, ChainBadge } from "@/components/account/AccountUI";
import { PageMasthead } from "@/components/primitives/PageMasthead";
import { AMOY_LIQUID_CHAIN, AMOY_SPOL, assertLiquidQuote, fetchLiquidState, liquidAmount, liquidRouteKey, type LiquidDirection, type LiquidQuote } from "@/lib/polygon-liquid";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4001";
const buyAbi = parseAbi(["function buySPOL(uint256) payable", "event sPOLMinted(address indexed user,uint256 amountPOL,uint256 amountSPOL)"]);
const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)",
  "function unwrapWETH9(uint256,address) payable",
  "function multicall(bytes[]) payable returns(bytes[])",
]);
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API + path, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}
export function PolygonLiquidStake({ onDirect, onBusyChange, networkPicker, initialDirection = "deposit" }: { onDirect?: () => void; onBusyChange?: (busy: boolean) => void; networkPicker?: ReactNode; initialDirection?: LiquidDirection }) {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { openPicker } = useWalletPicker();
  const [amount, setAmount] = useState("0.01");
  const [direction, setDirection] = useState<LiquidDirection>(initialDirection);
  const [review, setReview] = useState<{ quote: LiquidQuote; context: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [transactions, setTransactions] = useState<{ wallet: string; label: string; hash: Hex }[]>([]);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const mounted = useRef(true);
  const quoteRequest = useRef(0);
  const context = `${address?.toLowerCase() ?? ""}:${chainId}:${direction}:${amount}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const status = useQuery({
    queryKey: ["polygon-liquid", address?.toLowerCase() ?? null],
    queryFn: ({ signal }) => fetchLiquidState(address, signal),
    enabled: !isMainnet,
    refetchInterval: 15000,
    retry: false,
  });
  // A failed refresh must not leave old balances actionable.
  const state = status.isError ? undefined : status.data;
  const wrongNetwork = !!address && chainId !== AMOY_LIQUID_CHAIN;
  const quote = review?.context === context ? review.quote : null;
  const quoteFresh = !!quote && quote.expiresAt > now;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => { setReview(null); setError(""); setNotice(""); }, [address, chainId, direction, amount]);
  useEffect(() => { setDirection(initialDirection); }, [initialDirection]);
  useEffect(() => { onBusyChange?.(busy || switching); }, [busy, switching, onBusyChange]);

  async function getQuote() {
    if (!state || lock.current) return;
    const request = ++quoteRequest.current;
    const acceptedContext = context;
    setQuoting(true); setError(""); setReview(null);
    try {
      const value = liquidAmount(amount);
      const result = await api<LiquidQuote>(`/api/polygon/liquid/quote?direction=${direction}&amount=${value}`);
      assertLiquidQuote(result, state, direction, value);
      if (mounted.current && currentContext.current === acceptedContext && request === quoteRequest.current) {
        setReview({ quote: result, context: acceptedContext }); setNow(Date.now());
      }
    } catch (e) {
      if (mounted.current && currentContext.current === acceptedContext && request === quoteRequest.current) setError((e as Error).message);
    } finally { if (request === quoteRequest.current) setQuoting(false); }
  }

  async function execute() {
    if (!address || !state || !quote || lock.current || isMainnet) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const wallet = address;
    const acceptedContext = context;
    const accepted = quote;
    const assertWallet = () => {
      const account = getAccount(wagmiConfig);
      if (!mounted.current || currentContext.current !== acceptedContext || account.address?.toLowerCase() !== wallet.toLowerCase() || account.chainId !== AMOY_LIQUID_CHAIN)
        throw Error("Wallet, network or amount changed. Review again before signing.");
    };
    try {
      assertWallet();
      const value = liquidAmount(amount);
      const freshState = await fetchLiquidState(wallet);
      assertWallet();
      assertLiquidQuote(accepted, freshState, direction, value);
      const client = getPublicClient(wagmiConfig, { chainId: AMOY_LIQUID_CHAIN });
      if (!client || await client.getChainId() !== AMOY_LIQUID_CHAIN) throw Error("Amoy RPC is unavailable or on the wrong network");
      const freshQuote = async () => {
        const result = await api<LiquidQuote>(`/api/polygon/liquid/quote?direction=${direction}&amount=${value}`);
        assertWallet();
        assertLiquidQuote(result, freshState, direction, value);
        assertLiquidQuote(accepted, freshState, direction, value);
        if (BigInt(result.amountOut) < BigInt(accepted.minimumOut)) throw Error("Price moved beyond your reviewed tolerance. Get a new quote.");
      };
      const send = async (label: string, to: Address, data: Hex, native = 0n) => {
        assertWallet();
        await client.call({ account: wallet, to, data, value: native });
        const estimated = await client.estimateGas({ account: wallet, to, data, value: native });
        const gas = (estimated * 120n + 99n) / 100n;
        if (gas > 500000n) throw Error("Gas estimate exceeds the test-route safety limit");
        const maxFeePerGas = parseGwei("100");
        if (await client.getBalance({ address: wallet }) < native + gas * maxFeePerGas) throw Error("Insufficient Amoy test POL for the amount and maximum gas fee");
        assertWallet();
        assertLiquidQuote(accepted, freshState, direction, value);
        const hash = await sendTransaction(wagmiConfig, { account: wallet, chainId: AMOY_LIQUID_CHAIN, to, data, value: native, gas, maxPriorityFeePerGas: parseGwei("35"), maxFeePerGas });
        setTransactions(rows => [...rows, { wallet: wallet.toLowerCase(), label, hash }]);
        if (currentContext.current === acceptedContext) setNotice(`${label}: waiting for Amoy confirmation…`);
        const receipt = await waitForTransactionReceipt(wagmiConfig, { chainId: AMOY_LIQUID_CHAIN, hash, confirmations: 2 });
        if (receipt.status !== "success") throw Error(`${label} reverted`);
        const settled = await client.getTransaction({ hash: receipt.transactionHash });
        if (settled.from.toLowerCase() !== wallet.toLowerCase() || settled.to?.toLowerCase() !== to.toLowerCase() || settled.input !== data || settled.value !== native)
          throw Error(`${label} was replaced or cancelled. Inspect the transaction before retrying.`);
        if (receipt.transactionHash !== hash) setTransactions(rows => rows.map(row => row.hash === hash ? { ...row, hash: receipt.transactionHash } : row));
        assertWallet();
        return receipt;
      };
      if (direction === "deposit") {
        if (freshState.paused || !freshState.rateFresh) throw Error("Deposit paused or exchange rate stale");
        if (value > BigInt(freshState.nativeBalance!)) throw Error("Amount exceeds your connected wallet's Amoy test POL balance");
        await freshQuote();
        const receipt = await send("Deposit", AMOY_SPOL, encodeFunctionData({ abi: buyAbi, functionName: "buySPOL", args: [value] }), value);
        const minted = receipt.logs.filter(log => log.address.toLowerCase() === AMOY_SPOL).some(log => {
          try {
            const event = decodeEventLog({ abi: buyAbi, data: log.data, topics: log.topics });
            return event.args.user.toLowerCase() === wallet.toLowerCase() && event.args.amountPOL === value && event.args.amountSPOL > 0n;
          } catch { return false; }
        });
        if (!minted) throw Error("Transaction confirmed but expected sPOL mint evidence is missing. Check the receipt; do not retry blindly.");
      } else {
        if (value > BigInt(freshState.sharesBalance!)) throw Error("Amount exceeds your connected wallet's sPOL balance");
        await freshQuote();
        const allowance = await client.readContract({ address: AMOY_SPOL, abi: erc20Abi, functionName: "allowance", args: [wallet, freshState.router] });
        if (allowance < value) {
          await send("Approve sPOL", AMOY_SPOL, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [freshState.router, value] }));
          if (accepted.expiresAt <= Date.now()) throw Error("Approval confirmed. Get a fresh quote, then swap; no second approval is needed for this amount.");
        }
        await freshQuote();
        const minimum = BigInt(accepted.minimumOut);
        const swap = encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn: AMOY_SPOL, tokenOut: freshState.wrapper, fee: 100, recipient: freshState.router, deadline: BigInt(Math.floor(accepted.expiresAt / 1000)), amountIn: value, amountOutMinimum: minimum, sqrtPriceLimitX96: 0n }] });
        const unwrap = encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [minimum, wallet] });
        await send("Swap to native POL", freshState.router, encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[swap, unwrap]] }));
      }
      setNotice("Confirmed on Amoy. Registered Canton holdings follow after 12 blocks and the next observation cycle. No CC rewards are allocated.");
      setReview(null);
      await status.refetch();
    } catch (e) {
      if (mounted.current && currentContext.current === acceptedContext) setError((e as Error).message);
    } finally { lock.current = false; setBusy(false); }
  }

  async function track() {
    if (!address || lock.current || wrongNetwork || isMainnet) return;
    lock.current = true; setBusy(true); setError("");
    const wallet = address;
    const acceptedContext = context;
    try {
      const issuedAt = Date.now();
      const message = `CantonStake Amoy sPOL balance tracking\nWallet: ${wallet.toLowerCase()}\nChain: 80002\nIssued at: ${issuedAt}\nRecords public token balances on Canton. No token approval or CC reward entitlement.`;
      const signature = await signMessageAsync({ account: wallet, message });
      if (!mounted.current || currentContext.current !== acceptedContext || getAccount(wagmiConfig).address?.toLowerCase() !== wallet.toLowerCase() || getAccount(wagmiConfig).chainId !== AMOY_LIQUID_CHAIN) throw Error("Wallet or network changed; tracking was not submitted");
      await api("/api/polygon/liquid/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, issuedAt, signature }) });
      if (mounted.current && currentContext.current === acceptedContext && getAccount(wagmiConfig).address?.toLowerCase() === wallet.toLowerCase()) {
        setNotice("Canton balance tracking enabled. This records holdings, not CC reward entitlement.");
        await status.refetch();
      }
    } catch (e) { if (mounted.current && currentContext.current === acceptedContext) setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  if (isMainnet) return <AccountPanel title="Liquid staking test" icon="shield" description="This route is available only on the testnet deployment."><Link href="/stake">Back to mainnet staking</Link></AccountPanel>;
  const routeChanged = !!quote && !!state && liquidRouteKey(quote) !== liquidRouteKey(state);
  const canExecute = !!address && !wrongNetwork && !!state && quoteFresh && !routeChanged && !busy && !switching && (direction === "exit" || (!state.paused && state.rateFresh));
  return <section className="account-liquid" aria-label="Polygon liquid staking">
    <PageMasthead index="02" section="Stake on Canton · Amoy testnet" title="Stake." accent="Your POL. Your wallet." description="Liquid stake Amoy POL and receive sPOL. Deposits, gas and swap exits stay on Amoy—no Sepolia ETH needed." note="Self-custodial. Pooled staking. Test assets only." />
    {wrongNetwork && <div className="account-notice account-notice--error" role="status"><p>Your wallet is on chain {chainId ?? "unknown"}. Switch to Amoy to use test POL.</p><button className="account-button" disabled={busy || switching} onClick={async () => { try { setError(""); await switchChainAsync({ chainId: AMOY_LIQUID_CHAIN }); } catch (e) { setError((e as Error).message); } }}>{switching ? "Switching…" : "Switch to Polygon Amoy"}</button></div>}
    <div className={`account-liquid-workspace${networkPicker ? "" : " account-liquid-workspace--standalone"}`}>
      {networkPicker && <AccountPanel title="01 · Select chain" icon="link" description="Choose a network and its staking flow.">{networkPicker}</AccountPanel>}
      <AccountPanel title={`${networkPicker ? "02" : "01"} · Choose token`} icon="coin" description={direction === "deposit" ? "Native POL in. Pooled sPOL out." : "Pooled sPOL in. Native POL out."}>
        <div className="account-token-selected"><ChainBadge chainId="polygon" symbol="POL" label={direction === "deposit" ? "POL" : "sPOL"} /><span className="account-status account-status--good mono">Selected</span></div>
        <p className="account-muted">Pooled staking: this route does not select an individual validator.</p>
        <dl className="account-definition"><div><dt>Network</dt><dd>Polygon Amoy</dd></div><div><dt>Gas token</dt><dd>Amoy POL</dd></div><div><dt>You receive</dt><dd>{direction === "deposit" ? "sPOL" : "POL"}</dd></div>{direction === "deposit" && <div><dt>Deposit fee</dt><dd>{state ? `${state.safetyFeeBps / 100}%` : "—"}</dd></div>}<div><dt>CC rewards</dt><dd>Disabled</dd></div></dl>
        <p className="account-amount-warning">Test tokens only · No cash value. Swap liquidity is supplied for testing, not guaranteed. CC rewards are disabled.</p>
      </AccountPanel>
    <AccountPanel title={`${networkPicker ? "03" : "02"} · Enter amount`} icon="wallet" description="Review a quote before signing in your wallet." className="account-liquid-form">
      <div className="account-liquid-tabs" role="group" aria-label="Staking action"><button className="account-button" disabled={busy} aria-pressed={direction === "deposit"} onClick={() => setDirection("deposit")}>Stake Amoy POL</button><button className="account-button" disabled={busy} aria-pressed={direction === "exit"} onClick={() => setDirection("exit")}>Swap exit to Amoy POL</button></div>
      {address && <p className="account-muted account-connected-wallet">Connected wallet: {address}</p>}
      <div className="account-amount-balance"><div className="account-liquid-balances"><p>Amoy test POL: {address && state?.nativeBalance != null ? formatEther(BigInt(state.nativeBalance)) : address ? "Unavailable / loading" : "Connect wallet"}</p><p>Amoy sPOL: {address && state?.sharesBalance != null ? formatEther(BigInt(state.sharesBalance)) : "—"}</p></div>
      <button className="account-button" aria-label="Max (1-token test limit)" disabled={!state || !address || busy} onClick={() => {
        const balance = BigInt((direction === "deposit" ? state?.nativeBalance : state?.sharesBalance) || "0");
        const available = direction === "deposit" ? balance - parseEther("0.02") : balance;
        setAmount(formatEther(available <= 0n ? 0n : available > parseEther("1") ? parseEther("1") : available));
      }}>Max</button></div>
      <label className="account-stake-amount"><span className="sr-only">Liquid stake amount</span><input aria-label="Liquid stake amount" inputMode="decimal" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /><span>{direction === "deposit" ? "POL" : "sPOL"}</span></label>
      <p className="account-muted">{direction === "deposit" ? "Amoy test POL" : "Amoy sPOL"} · 1-token test limit</p>
      <p className="account-muted my-3">{direction === "deposit" ? `Deposit safety fee: ${state ? state.safetyFeeBps / 100 : "—"}%. Keep POL for gas. The official contract uses its execution-time rate and has no minimum-output parameter.` : "Swap exit, not canonical unbonding. 1% slippage tolerance; maximum 5% price impact against the pool's spot price. The pool price can differ from redemption value."}</p>
      {quote && <div className="account-liquid-quote" role="status"><p>Quoted output: {formatEther(BigInt(quote.amountOut))} {direction === "deposit" ? "sPOL" : "POL"}</p>{direction === "exit" && <p>Minimum received: {formatEther(BigInt(quote.minimumOut))} POL · Pool price impact: {(quote.priceImpactBps! / 100).toFixed(2)}%</p>}<p>{quoteFresh ? `Quote expires in ${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))}s` : "Quote expired. Refresh before signing."}</p></div>}
      {routeChanged && <p role="alert">Swap configuration changed. Get a new quote.</p>}
      <div className="account-liquid-actions"><button className="account-button" disabled={!state || busy || quoting} onClick={getQuote}>{quoting ? "Quoting…" : "Get fresh quote"}</button>{!address ? <button className="account-button account-button--primary" onClick={openPicker}>Connect wallet</button> : <button className="account-button account-button--primary" disabled={!canExecute} onClick={execute}>{busy ? "Working…" : direction === "deposit" ? "Confirm Amoy deposit" : "Confirm approval / swap"}</button>}</div>
      {state && direction === "deposit" && (state.paused || !state.rateFresh) && <p role="alert">Deposits unavailable: the contract is paused or its rate is stale.</p>}
      {status.isError && <p role="alert">Liquid route unavailable: {status.error.message}. No transaction will be submitted.</p>}
      {error && <p role="alert" className="text-red-400 break-words">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {transactions.filter(tx => tx.wallet === address?.toLowerCase()).map(tx => <a key={tx.hash} className="account-text-link block break-all" href={`https://amoy.polygonscan.com/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.label}: {tx.hash} ↗</a>)}
    </AccountPanel>
    </div>
    <div className="account-liquid-secondary">
    <details className="account-liquid-details">
      <summary>Canton balance tracking <span>Optional</span></summary>
      <div><p className="account-muted">Optional, signed registration of your public holdings.</p>
        <p>{state?.tracking && state.tracking !== "unavailable" ? `${formatEther(BigInt(state.tracking.shares))} sPOL recorded at block ${state.tracking.observedBlock}` : state?.tracking === "unavailable" ? "Canton tracking unavailable; on-chain funds are unaffected." : "Tracking not enabled."}</p>
        <p className="account-muted">12-block observations, checked every minute. Balance evidence is not a reward payout.</p>
        <button className="account-button" disabled={!address || !state || wrongNetwork || busy || switching} onClick={track}>Enable / refresh Canton tracking</button></div>
    </details>
    <details className="account-liquid-details">
      <summary>Advanced routes &amp; exit limitations</summary>
      <div>{onDirect ? <button className="account-text-link" disabled={busy || switching} onClick={onDirect}>Advanced: direct validator staking on Sepolia →</button> : <Link className="account-text-link" href="/stake?polygon=validator">Advanced: direct validator staking on Sepolia →</Link>}
      <p className="account-muted">Direct validator staking requires Sepolia test POL and Sepolia ETH for gas.</p>
      <p className="account-muted">The relayed bridge → Sepolia redemption → Amoy return route is disabled until its full settlement and recovery tests pass. No sPOL bridge-burn action is exposed here. If swap liquidity is unavailable, keep your shares; do not burn them expecting an immediate POL refund.</p>
      <button className="account-button" disabled>Queued exit unavailable</button>
      </div>
    </details>
    </div>
  </section>;
}
