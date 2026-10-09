import type { Metadata } from "next";
import Link from "next/link";
import { isMainnet } from "@/lib/network";
import { IconArrowRight } from "@/components/icons";
import "./about.css";

export const metadata: Metadata = {
  title: "About CantonStake — How it works",
  description: "How CantonStake connects wallet-signed staking, native network confirmations, Canton position records, and rewards. Explore the architecture and supported routes.",
};

const steps = [
  ["Connect", "Your identity and your assets", "For Canton-tracked routes, connect Loop to identify your Canton party, then a compatible wallet for the network you want to stake on. Your network wallet signs the asset transactions."],
  ["Choose", "A network and a staking route", "Native routes let you choose a validator or staking pool where supported. Review the asset, amount, network, fees and exit conditions. The Hoodi Lido route pools ETH without asking you to choose a validator."],
  ["Confirm", "Sign from your own wallet", "CantonStake prepares the request; your wallet asks you to approve it. Tokens enter the selected network’s staking contracts or accounts. Native assets are not bridged to Canton by this flow."],
  ["Track", "Follow the position through its lifecycle", "For integrated routes, backend watchers verify network confirmations and update Canton records. Follow positions, unbonding and release in the app. Independent pools show their own balances and withdrawal state."],
];
const layers = [
  ["01 / INTERFACE", "Wallets & transaction review", "Next.js, React and TypeScript provide the interface. Chain-specific wallet adapters connect accounts, select networks and request signatures."],
  ["02 / NATIVE NETWORKS", "Staking & settlement", "Each adapter speaks the network’s transaction format. Delegation, receipt tokens, unbonding and withdrawal settle on that network under its own rules."],
  ["03 / VERIFICATION", "API & chain watchers", "A Fastify/TypeScript service reads RPC data and checks settled events against the relevant request. PostgreSQL stores application records; Redis supports caches and background jobs."],
  ["04 / CANTON", "Position records & reward accounting", "Daml contracts represent the integrated staking lifecycle and beneficiary records. Reward observation, eligibility, allocation and payment are separate steps."],
];
const routes = [
  ["Polygon PoS", "POL", isMainnet ? "ValidatorShare delegation, settled on Ethereum mainnet." : "Amoy POL → sPOL test pool; advanced ValidatorShare delegation settles on Sepolia."],
  ["Cosmos Hub · Celestia · Osmosis", "ATOM · TIA · OSMO", "Cosmos delegation and undelegation through compatible wallets, with network-specific unbonding periods."],
  ["Sui", "SUI", "Native staking with a StakedSui receipt; unstaking is tied to that position’s receipt."],
  ["Aptos", "APT", "Delegation-pool add stake, unlock and withdraw operations."],
  ["Monad", "MON", "Native staking precompile transactions and confirmation tracking."],
  ["BNB Chain", "BNB", "StakeHub delegation, unbonding and claim operations."],
  ["Solana", "SOL", "Wallet-controlled stake accounts: create, delegate, deactivate and withdraw."],
  ["Polkadot", isMainnet ? "DOT" : "WND", "Nomination-pool join, unbond and withdrawal on Asset Hub."],
];

export default function AboutPage() {
  return <main className="about-page">
    <header className="about-hero">
      <span className="about-eyebrow mono">ABOUT CANTONSTAKE / {isMainnet ? "MAINNET" : "TESTNET"}</span>
      <h1 className="display">Your stake, across networks.<br /><em>A shared view on Canton.</em></h1>
      <p>CantonStake brings multi-chain staking into one interface. You sign with your own wallet, assets stake on their native network, and supported routes use Canton to record the position’s lifecycle and reward accounting.</p>
      <div className="about-principles"><span>Wallet-signed transactions</span><span>Native network settlement</span><span>Canton-linked records</span></div>
      <div className="about-actions"><Link className="home-button home-button--primary mono" href="/stake">Explore staking <IconArrowRight /></Link><a className="home-button home-button--secondary mono" href="#technical">Technical overview ↓</a></div>
    </header>

    <nav className="about-index mono" aria-label="On this page"><a href="#how-it-works">How it works</a><a href="#rewards">Rewards</a><a href="#technical">Architecture</a><a href="#routes">Networks</a><a href="#details">Technical details</a></nav>

    <section id="how-it-works" className="about-section" aria-labelledby="how-heading">
      <div className="about-section-heading"><span className="about-eyebrow mono">01 / THE FLOW</span><h2 id="how-heading" className="display">From connection to withdrawal.</h2><p>The network determines how staking and exits work. Canton adds records for integrated routes.</p></div>
      <ol className="about-steps">{steps.map(([title, subtitle, text], i) => <li key={title}><span className="about-step-number mono">0{i + 1}</span><h3>{title}</h3><strong>{subtitle}</strong><p>{text}</p></li>)}</ol>
    </section>

    <section id="rewards" className="about-section" aria-labelledby="rewards-heading">
      <div className="about-section-heading"><span className="about-eyebrow mono">02 / TWO DISTINCT REWARD SOURCES</span><h2 id="rewards-heading" className="display">Native yield and Canton Coin.</h2></div>
      <div className="about-two-column">
        <article className="about-card"><span className="about-tag mono">NATIVE NETWORK</span><h3>Rewards from the staking route</h3><p>Validator or pool rewards follow the source network’s rules. They may accrue in a staking balance, a receipt token, or a claimable amount. Commission, activation and unbonding vary by route.</p><p>Displayed yield and validator scores can include estimates. They describe available data, not guaranteed returns.</p></article>
        <article className="about-card"><span className="about-tag mono">CANTON COIN / CC</span><h3>Separate eligibility and settlement</h3><p>CC rewards depend on the deployment, supported route, verified identity and enabled reward services. Connecting a wallet or creating a staking position does not by itself establish a CC payment.</p><p>The 75/25 user/app split is represented in beneficiary accounting. A recorded split or allocation is not proof of a transfer. Round timers indicate accounting cadence, not a guaranteed payout deadline.</p><Link href="/rewards">View your reward records <span aria-hidden="true">↗</span></Link></article>
      </div>
    </section>

    <section id="technical" className="about-section" aria-labelledby="technical-heading">
      <div className="about-section-heading"><span className="about-eyebrow mono">03 / TECHNICAL OVERVIEW</span><h2 id="technical-heading" className="display">Four parts, one workflow.</h2><p>The native chain is the source of truth for asset settlement. Canton records the corresponding application state for integrated routes.</p></div>
      <div className="about-architecture">{layers.map(([label, title, text]) => <article className="about-card" key={title}><span className="about-eyebrow mono">{label}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
      <div className="about-note"><strong>The verification boundary</strong><p>CantonStake’s backend acts as an observer and submits the chain evidence to Canton. Daml does not independently query or cryptographically verify the source network. Correct tracking therefore depends on the watcher, its RPC inputs and the app provider’s authorization.</p></div>
    </section>

    <section id="routes" className="about-section" aria-labelledby="routes-heading">
      <div className="about-section-heading"><span className="about-eyebrow mono">04 / NETWORK ADAPTERS</span><h2 id="routes-heading" className="display">One interface. Different staking mechanics.</h2><p>These are implemented routes. Deployment configuration and current readiness determine which can accept a new stake. Check the homepage’s availability badges before opening a route.</p></div>
      <div className="about-route-list">{routes.map(([name, symbol, text]) => <article key={name}><div><h3>{name}</h3><span className="mono">{symbol}</span></div><p>{text}</p></article>)}</div>
      {!isMainnet && <div className="about-two-column about-pools">
        <article className="about-card"><span className="about-tag mono">ETHEREUM / HOODI</span><h3>Lido pooled staking</h3><p>Deposit test ETH for stETH without selecting a validator. Exits use Lido’s withdrawal request, finalization and claim process. This route reads pool state directly and does not create Canton positions or enable CC rewards.</p><Link href="/stake/ethereum">Open the Hoodi pool ↗</Link></article>
        <article className="about-card"><span className="about-tag mono">POLYGON / AMOY</span><h3>The sPOL test route</h3><p>Deposit Amoy POL for sPOL. The test exit uses a liquidity swap back to native POL, so quotes and available liquidity matter; it is not protocol redemption. This is separate from direct Polygon validator delegation on Sepolia.</p><Link href="/stake?chain=polygon">Open the Amoy route ↗</Link></article>
      </div>}
      <Link className="about-text-link" href="/#networks-heading">Check current network availability <span aria-hidden="true">↗</span></Link>
    </section>

    <section id="details" className="about-section" aria-labelledby="details-heading">
      <div className="about-section-heading"><span className="about-eyebrow mono">05 / UNDER THE HOOD</span><h2 id="details-heading" className="display">The details that matter.</h2><p>Expand a topic for a closer look at identity, data, contracts and operations.</p></div>
      <div className="about-details">
        <details><summary>Wallets, identity and signing</summary><div><p>Loop supplies the Canton party identity for integrated workflows. EVM wallets connect through wagmi and viem; Cosmos-family chains use compatible Cosmos wallets; Sui, Aptos, Solana and Polkadot use their respective wallet adapters.</p><p>Your network wallet signs asset transactions. A Canton identity, a native wallet address and a reward beneficiary are different concepts. Their association and eligibility are checked for the selected workflow; the app does not ask for your seed phrase.</p></div></details>
        <details><summary>Contracts and the position lifecycle</summary><div><p>Native operations are chain-specific. Integrated Canton records model a staking request and the position’s Bonded, Unbonding and Released states. Watchers reconcile confirmed chain activity with the associated request before recording transitions.</p><p>PostgreSQL mirrors application metadata and event history. Transaction references and network explorers let you inspect the source-chain activity. Receipt-token holdings for independent pools follow their own lifecycle.</p></div></details>
        <details><summary>Readiness, RPC data and validator information</summary><div><p>Readiness checks distinguish a reachable backend, a reachable Canton participant, a fresh chain watcher and an enabled staking workflow. Pool routes additionally check their own contract state. Failed or stale reads must not be presented as fresh availability.</p><p>Validator data is normalized and cached across networks. Some metrics are measured; others remain estimates where the source chain does not expose them. An availability badge confirms the checks behind that route, not completion of every possible funded-wallet scenario.</p></div></details>
        <details><summary>Rewards, history and automation</summary><div><p>Native rewards and CC are accounted for separately. The reward view distinguishes recorded allocations, observed reward evidence and settlement where available. Historical records can remain readable when a live ledger read fails.</p><p>Background jobs support scanning, accounting and monitoring. A saved auto-compound preference or permit does not mean execution is active; automation depends on the deployment’s authorization and route gates. The staking flow does not promise automatic compounding.</p></div></details>
        <details><summary>Mainnet, testnet and deployment isolation</summary><div><p>Mainnet and testnet run as separate deployments with separate configuration and data. Chain IDs, enabled routes and wallet scope must match the selected deployment. Test assets do not carry a mainnet value.</p><p>The Canton environment is configured separately from each native chain. “Testnet” in the interface does not mean every integration uses the same test network: Ethereum’s Lido pool uses Hoodi, the Polygon liquid route uses Amoy, and advanced Polygon validator staking uses Sepolia.</p><p>{isMainnet ? "This page describes the mainnet deployment. The Hoodi and Amoy pool interfaces are available on the separate testnet site." : "This page describes the testnet deployment. Test-route availability does not establish mainnet availability or settlement."}</p></div></details>
        <details><summary>Application stack and operating model</summary><div><p>The browser interface uses Next.js, React, TypeScript and TanStack Query. The backend uses Fastify and TypeScript, Prisma with PostgreSQL, Redis caches and BullMQ jobs. Canton application contracts are written in Daml; EVM integrations use Solidity contracts and native staking interfaces.</p><p>Docker Compose runs the application services. Health and readiness endpoints serve different purposes: process liveness alone cannot confirm that staking, indexing or reward payments are ready. Account pages scope reads to the connected wallets and the active deployment.</p></div></details>
      </div>
    </section>
    <footer className="about-footer"><div><h2 className="display">Explore the route before you sign.</h2><p>Check availability, review network-specific terms, then connect your wallets.</p></div><Link className="home-button home-button--primary mono" href="/stake">Open staking <IconArrowRight /></Link></footer>
  </main>;
}
