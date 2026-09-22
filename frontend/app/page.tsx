"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { IconArrowRight, IconBolt, IconClock, IconLock, IconShield, I } from "@/components/icons";
import { Logo } from "@/components/primitives/Logo";
import { fetchAnalyticsMarkers, fetchProtocolSummary } from "@/lib/api";
import { isChainEnabled } from "@/lib/chains";
import { isMainnet, networkMode } from "@/lib/network";
import { useRoundCountdown } from "@/lib/use-round-countdown";
import { useProtocolStatus } from "@/lib/use-protocol-status";
import { usePrices } from "@/lib/prices";
import { valueStaked, type ProtocolSummary } from "@/lib/protocol-summary";
import { NetworkGlobe } from "@/components/home/NetworkGlobe";

function DocumentIcon({ size = 24 }: { size?: number }) {
  return <I size={size}><path d="M3 1.5h7l3 3V14H3zM10 1.5V5h3M5.5 7h5M5.5 9.5h5M5.5 12h3" /></I>;
}

function LinkIcon() {
  return <I size={24}><path d="m6.5 10-1 1a2.8 2.8 0 0 1-4-4l3-3a2.8 2.8 0 0 1 4 0m-1 2 1-1a2.8 2.8 0 0 1 4 4l-3 3a2.8 2.8 0 0 1-4 0M6 10l4-4" /></I>;
}

function BarsIcon({ size = 24 }: { size?: number }) {
  return <I size={size}><path d="M2 14V8M6 14V2M10 14V10M14 14V5" /></I>;
}

function CoinsIcon() {
  return <I size={30}><ellipse cx="6" cy="8" rx="5" ry="2" /><path d="M1 8v5c0 2.7 10 2.7 10 0V8M1 10.5c0 2.7 10 2.7 10 0M6 5V3c0-2.7 9-2.7 9 0v7c0 1-1.7 1.8-4 2M6 3c0 2.7 9 2.7 9 0M11 7c2.3-.2 4-1 4-2" /></I>;
}

const LIFECYCLE = [
  { n: "01", title: "Request", text: "Create a staking intent on Canton.", icon: <DocumentIcon /> },
  { n: "02", title: "Bond", text: "Stake natively from your wallet.", icon: <LinkIcon /> },
  { n: "03", title: "Earn", text: "Receive native yield + CC rewards.", icon: <BarsIcon /> },
  { n: "04", title: "Unbond", text: "Wait for the chain’s unbond period.", icon: <IconClock size={24} /> },
  { n: "05", title: "Release", text: "Funds back to your wallet.", icon: <I size={24}><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="m5 8 2 2 4-4" /></I> },
];

const NETWORKS = [
  { id: "polygon", name: "Polygon PoS", symbol: "POL", status: "Coming soon" },
  { id: "cosmos", name: "Cosmos Hub", symbol: "ATOM", status: "Coming soon" },
  { id: "sui", name: "Sui", symbol: "SUI", status: "Coming soon" },
  { id: "monad", name: "Monad", symbol: "MON", status: "Planned" },
] as const;

function NetworkMark({ chain }: { chain: typeof NETWORKS[number]["id"] }) {
  return (
    <span className={`home-network-mark home-network-mark--${chain}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        {chain === "polygon" && <path d="m22 15 5-3 5 3v6l-5 3-5-3v-6l-9 5v6l-5 3-5-3v-6l5-3 5 3m0 6 9-5" stroke="white" strokeWidth="2.6" strokeLinejoin="round" transform="translate(3 -1)" />}
        {chain === "cosmos" && <g stroke="#bbb9ec" strokeWidth=".8"><ellipse cx="20" cy="20" rx="15" ry="5" /><ellipse cx="20" cy="20" rx="15" ry="5" transform="rotate(60 20 20)" /><ellipse cx="20" cy="20" rx="15" ry="5" transform="rotate(120 20 20)" /><circle cx="20" cy="20" r="2.5" fill="#e4dfff" /><circle cx="12.5" cy="7" r="1.5" fill="white" /><circle cx="34" cy="20" r="1.5" fill="white" /></g>}
        {chain === "sui" && <path d="M20 7c-3 6-11 12-11 18a11 11 0 0 0 22 0c0-6-8-12-11-18Zm-4 7c-4 10 13 8 10 19" stroke="#e7f6ff" strokeWidth="2" strokeLinecap="round" />}
        {chain === "monad" && <rect x="10" y="10" width="20" height="20" rx="5" transform="rotate(45 20 20)" stroke="#9981ff" strokeWidth="5" />}
      </svg>
    </span>
  );
}

function compact(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default function HomePage() {
  const { mm, ss } = useRoundCountdown();
  const healthQuery = useProtocolStatus();
  const { health } = healthQuery;
  const markersQuery = useQuery({ queryKey: ["tape-markers"], queryFn: () => fetchAnalyticsMarkers(undefined, 24), refetchInterval: 60_000, retry: 1 });
  const summaryQuery = useQuery<ProtocolSummary>({
    queryKey: ["protocol-summary"],
    queryFn: fetchProtocolSummary,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const { data: prices } = usePrices();
  const summary = summaryQuery.isError ? undefined : summaryQuery.data;
  const activity = markersQuery.isError ? undefined : markersQuery.data;
  const cc24h = activity?.series.reduce((sum, bucket) => sum + bucket.cc, 0);
  const usd = summary && prices ? valueStaked(summary, {
    polygon: prices.polUsd, monad: prices.monUsd, cosmos: prices.atomUsd,
    sui: prices.suiUsd, celestia: prices.tiaUsd, osmosis: prices.osmoUsd,
    aptos: prices.aptUsd, polkadot: prices.dotUsd, bnb: prices.bnbUsd, solana: prices.solUsd,
  }) : null;
  const usdLabel = usd === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: usd < 1000 ? 2 : 1 }).format(usd);
  const healthLabel = !healthQuery.isError && health?.successRatePct != null ? `${health.successRatePct.toFixed(1)}%` : "—";
  const recorded = summary?.source === "recorded";
  const live = healthQuery.live && !recorded;
  const status = recorded ? "Recorded data" : healthQuery.label;
  const unavailable = summaryQuery.isError || markersQuery.isError || healthQuery.isError;
  const refresh = () => { void summaryQuery.refetch(); void markersQuery.refetch(); void healthQuery.refetch(); };

  return (
    <main className="home-reference">
      <section className="home-hero" aria-labelledby="home-heading">
        <div className="home-hero__copy">
          <div className="home-kicker mono"><span /> SELF-CUSTODIAL STAKING <b>×</b> CANTON NETWORK</div>
          <h1 className="display" id="home-heading">Stake any chain.<em>Earn on Canton.</em></h1>
          <p>A self-custodial staking dApp. Stake POL from your own wallet and earn native validator yield plus Canton Coin (CC) rewards, with CC reward rounds every 10 minutes.</p>
          <div className="home-actions">
            <Link className="home-button home-button--primary mono" href="/stake">Start staking <IconArrowRight /></Link>
            <Link className="home-button home-button--secondary mono" href="#how-it-works">Learn more</Link>
          </div>
          <div className="home-trust-row mono">
            <div><IconShield size={30} /><span><b>Self-custodial</b><small>Your keys, your funds</small></span></div>
            <div><DocumentIcon size={30} /><span><b>On-ledger &amp; private</b><small>Built on Canton (Daml)</small></span></div>
            <div><CoinsIcon /><span><b>Dual rewards</b><small>Native yield + CC</small></span></div>
          </div>
        </div>
        <div className="home-hero__visual">
          <NetworkGlobe />
          <span className="home-globe__eyebrow mono">A MORE OPEN<br />FINANCIAL SYSTEM</span>
          <span className="home-globe__caption mono">REAL ACTIVITY.<br />REAL REWARDS.<br />ON CANTON.</span>
          <aside className="home-status mono" aria-label="Canton network status">
            <div className="home-status__heading">CANTON NETWORK</div>
            <div className="home-status__round">
              <strong className={live ? "is-live" : "is-pending"}><i />{status}</strong>
              <span>ROUND <b>{health?.lastRound ? `#${health.lastRound.roundNumber.toLocaleString()}` : "—"}</b></span>
              <span title="Estimated cadence; actual settlement depends on the reward worker.">NEXT ROUND <b className="home-status__timer">{mm}:{ss}</b></span>
              <div className="home-status__signal" aria-hidden="true">{[8, 13, 10, 19, 14, 24, 17, 29].map((height, index) => <i key={index} style={{ height }} />)}</div>
            </div>
            <div className="home-status__activity">
              <dl>
                <div><dt>Active positions</dt><dd>{compact(summary?.activePositions)}</dd></div>
                <div><dt>Value staked (USD)</dt><dd>{usdLabel}</dd></div>
                <div><dt>CC attributed · 24h</dt><dd>{compact(cc24h)}</dd></div>
                <div><dt>Reward health</dt><dd>{healthLabel}</dd></div>
              </dl>
            </div>
            <div className="home-status__foot">ON-LEDGER <b>│</b> PRIVATE <b>│</b> {networkMode.toUpperCase()}</div>
          </aside>
        </div>
      </section>

      <section className="home-supported" aria-labelledby="networks-heading">
        <h2 className="home-section-label mono" id="networks-heading"><span /> Supported chains</h2>
        <div className="home-chain-row">
          {NETWORKS.map((chain) => {
            const enabled = isChainEnabled(chain.id);
            const content = <><NetworkMark chain={chain.id} /><div className="home-chain-card__body"><strong>{chain.name}</strong><small className="mono">{chain.symbol}</small><b className="mono">{enabled ? "Live" : chain.status}</b><p>{enabled ? `Stake ${chain.symbol} and earn native yield + CC rewards.` : `Native ${chain.symbol} yield + CC rewards.`}</p></div>{enabled && <IconArrowRight className="home-chain-card__arrow" />}</>;
            return enabled
              ? <Link href="/stake" key={chain.id} className="home-chain-card home-chain-card--live" aria-label={`Stake ${chain.symbol} on ${networkMode}`}>{content}</Link>
              : <div key={chain.id} className="home-chain-card">{content}</div>;
          })}
          <div className="home-chain-card home-chain-card--future"><span>+</span><small className="mono">More chains<br />coming soon</small></div>
        </div>
      </section>

      <section className="home-metrics" aria-label="Protocol activity and rewards">
        <div className="home-metrics__frame">
          <div className="home-metric"><I size={29}><circle cx="6" cy="4" r="2.5" /><path d="M1 14v-3a5 5 0 0 1 10 0v3M11 2a2.5 2.5 0 0 1 0 5M13 9c2 1 2 3 2 5" /></I><div><strong className="mono">{compact(summary?.activePositions)}<BarsIcon size={21} /></strong><small>ACTIVE POSITIONS<br />ACROSS CHAINS</small></div></div>
          <div className="home-metric"><IconLock size={29} /><div><strong className="mono">{usdLabel}</strong><small>EST. VALUE STAKED<br />{isMainnet && prices?.source.pol === "coingecko" ? "USD · MARKET PRICE" : "USD · INDICATIVE"}</small></div></div>
          <div className="home-metric"><I size={29} fill="#b8e4d5" strokeWidth={0}><path d="M7 1a7 7 0 1 0 8 8H7Z" /><path d="M9 0v7h7a7 7 0 0 0-7-7Z" fill="#00e8a2" /></I><div><strong className="mono">75 / 25</strong><small>REWARD SPLIT<br />ON-LEDGER</small></div></div>
          <div className="home-metric"><IconBolt size={29} /><div><strong className="mono">10 min</strong><small>CC ROUND CADENCE<br />AUTOMATED REWARDS</small></div></div>
          <blockquote>“The promised split<br />is the executed split.”<cite className="mono">BUILT ON CANTON <span /></cite></blockquote>
        </div>
        {recorded && !unavailable && <p className="home-data-notice home-data-notice--recorded" role="status">Canton connection unavailable. Showing recorded position totals{summary.asOf ? ` · last position update ${new Date(summary.asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}. <button type="button" onClick={refresh}>Refresh <IconArrowRight size={12} /></button></p>}
        {unavailable && <p className="home-data-notice" role="status">Some live data is temporarily unavailable. <button type="button" onClick={refresh}>Try again <IconArrowRight size={12} /></button></p>}
      </section>

      <section className="home-lifecycle" id="how-it-works" aria-labelledby="lifecycle-heading">
        <div className="home-lifecycle__intro">
          <div className="home-section-label mono"><span /> How it works</div>
          <h2 className="display" id="lifecycle-heading">One lifecycle.<br />Every chain.</h2>
          <p>From request to release, Canton records every step on-ledger with multi-party consent, ensuring transparency, privacy and automated rewards.</p>
          <Link href="/stake" className="mono">EXPLORE THE PROCESS <IconArrowRight /></Link>
        </div>
        <ol className="home-lifecycle__rail">
          {LIFECYCLE.map((item) => <li className="home-life-card" key={item.n}><div className="home-life-card__top"><b className="mono">{item.n}</b><span>{item.icon}</span></div><h3 className="display">{item.title}</h3><p>{item.text}</p></li>)}
        </ol>
      </section>

      <footer className="home-footer">
        <div><Link href="/" className="home-footer__brand"><Logo size={32} animated={false} /><span className="display">CantonStake</span></Link><small className="mono">Stake any chain. Earn on Canton.</small></div>
        <nav className="mono" aria-label="Footer navigation"><Link href="/dashboard">Dashboard</Link><Link href="/portfolio">Portfolio</Link><Link href="/analytics">Status</Link><Link href="/settings">Settings</Link></nav>
        <div className="mono"><i /> Canton Network <b>—</b> {networkMode.toUpperCase()}</div>
      </footer>
    </main>
  );
}
