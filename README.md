<div align="center">

<img src="frontend/public/brand-mark.png" alt="CantonStake" width="144" />

# CantonStake

**Stake any chain. Earn on Canton.**

Self-custodial multi-chain staking dApp built on Canton Network. Stake from your own wallet and earn Canton Coin (CC) rewards on top of native validator yield, distributed every 10-minute round via an on-ledger 75/25 beneficiary split.

**Polygon (POL) and Cosmos Hub (ATOM) are the most mature paths.** Celestia, Osmosis, Aptos, Sui, Monad, BNB Chain, Solana, and Polkadot have native adapters at lower maturity — see [chain status](#multi-chain-staking) before relying on them.

![Canton Network](https://img.shields.io/badge/Canton-Network-00ff9d?style=flat-square)
![Daml](https://img.shields.io/badge/Daml-3.5-7c4dff?style=flat-square&logo=daml)
![Next.js](https://img.shields.io/badge/Next.js-14-000?style=flat-square&logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-202020?style=flat-square&logo=fastify)
![Prisma](https://img.shields.io/badge/Prisma-5-2d3748?style=flat-square&logo=prisma&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-0.8-363636?style=flat-square&logo=solidity)
![Postgres](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-dc382d?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square&logo=docker&logoColor=white)

[Overview](#overview) · [Architecture](#architecture) · [How It Works](#how-it-works) · [Quick Start](#quick-start) · [API Endpoints](#api-endpoints) · [Security Model](#security-model)

---

</div>

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Environment Variables](#environment-variables)
- [Technology Stack](#technology-stack)
- [Security Model](#security-model)
- [Deployment](#deployment)

---

## Overview

CantonStake unifies multi-chain staking into one self-custodial flow on Canton Network. Each chain adapter bonds your tokens through your own wallet — Wagmi for EVM chains, Keplr for Cosmos, Mysten dapp-kit for Sui, Aptos wallet adapter, Solana Wallet Standard, and Polkadot injected wallets — while the Canton ledger records the canonical lifecycle and routes Canton Coin rewards through an on-ledger beneficiary split contract every 10-minute round.

### The Problem

- Cross-chain staking forces users into N different wallets, dashboards, and claim flows.
- Native staking rewards land in tokens nobody wanted to hold; reinvesting means more friction.
- Liquid-staking protocols custody your assets and concentrate validator power into a handful of operators.
- There is no single view of staking positions across chains.
- No on-ledger guarantee exists that the reward split a protocol promises is the split that runs.

**CantonStake solves this** by treating staking as a single Canton-anchored lifecycle that any chain can plug into. Bonds happen on the chain you pick, with your keys, on your wallet. Canton records each economic transition, and the SV automation pays out CC rewards every round through an immutable `BeneficiarySplit` Daml contract that routes 75% to the user and 25% to the app treasury — encoded on-ledger, not enforced by promise.

---

## Core Features

### Multi-chain staking
Chain adapters route through each network's native wallet primitive (Wagmi for EVM, Keplr/Leap for Cosmos, Mysten dapp-kit for Sui, Aptos wallet adapter, Solana Wallet Standard, and Polkadot injected wallets). They are **not at equal maturity**:

| Chain | Status | Notes |
|---|---|---|
| **Polygon Amoy** | Production path | Real `StakeManager` + per-validator `ValidatorShare` on Sepolia (Polygon PoS settles on Ethereum L1, not Bor). Live `exchangeRate` share math, checkpoint-based unbonding. Read path verified end-to-end against chain; **no user delegation has been broadcast yet** — that needs a funded wallet |
| **Cosmos Hub provider testnet** | Native lifecycle | Real protobuf `MsgDelegate`/`MsgUndelegate` decode and EndBlock completion tracking; 21-day unbonding, automatic principal release |
| **Celestia Mocha-5** | Native lifecycle, needs wallet E2E | Keplr/Leap `utia` delegation and exit, backend event watcher, automatic release; current unbonding is about 14 days |
| **Osmosis osmo-test-5** | Native lifecycle, needs wallet E2E | Keplr/Leap `uosmo` delegation and exit, backend event watcher, automatic release; testnet unbonding is 5 days (mainnet 14 days) |
| **Aptos Testnet** | Native lifecycle, needs funded-wallet E2E | Aptos wallet adapter submits delegation-pool add/unlock/withdraw; account-scoped watcher binds settled events to Canton. One position per wallet/pool is supported; pre-existing native stake is rejected. “Unbond all” exits the entire delegation, including compounded rewards and external additions. Partial external unlocks do not transition the whole Canton position; release requires all native stake balances to be zero at the exact withdrawal ledger version. New stakes require at least 11 APT in the app; the backend checks that the amount after the pool's entry fee credits at least 10 APT. Historical settlement reads fail closed if the fullnode pruned the transaction version: operators need a fullnode retaining that version to resume indexing, not a fallback to today's state. |
| **Sui Testnet** | Native lifecycle | GraphQL `StakingRequestEvent`/`UnstakingRequestEvent` tracking binds each position to its exact `StakedSui` receipt; unstaking releases principal in the same transaction. Requires a Sui wallet and live end-to-end verification |
| **Monad Testnet** | Estimate only | Monad publishes no reward schedule, so its APY is labelled `source: "estimate"` and is never presented as live data |
| **BNB Chain Chapel** | Native lifecycle, needs funded-wallet E2E | Wallet-owned StakeHub delegation, unbonding, and claim with validator-bound settlement events; mainnet uses BNB Chain and the same StakeHub address |
| **Solana Testnet** | Native lifecycle, needs funded-wallet E2E | Wallet-owned stake account, atomic create/initialize/delegate, deactivate, and full withdrawal. Finalized account-scoped signatures are bound to each Canton request. Exit readiness is calculated client-side from the stake account, StakeHistory sysvar, and current epoch because the `getStakeActivation` RPC method was removed. Mainnet mode targets Solana mainnet-beta; use a dedicated RPC for production traffic. |
| **Polkadot Westend Asset Hub** | Native lifecycle, needs funded-wallet E2E | Wallet-owned nomination-pool join, full unbond, and withdrawal. A finalized-extrinsic watcher binds signer, pool, amount, and pallet events to the Canton request. Funds must be on Asset Hub, not the relay chain. Pool balances and commissions come from Asset Hub; pool-specific yield and uptime remain unmeasured estimates. Westend uses 12 decimals and a live minimum of 0.1 WND; mainnet Asset Hub uses 10 decimals and a 1 DOT minimum. Only one pool position per wallet is supported. |

See [`docs/REAL_DATA_MIGRATION.md`](docs/REAL_DATA_MIGRATION.md) for the full mock-to-real audit and what remains.

Verification boundary: the local test suites, TypeScript checks, and frontend
production builds pass in testnet and mainnet modes. Funded-wallet lifecycle
verification is still outstanding; passing a build does not establish a
production-ready staking route. The conservative deployment default enables
only Polygon. Keep backend and frontend enabled-chain lists identical, use
separate deployments/databases for each mode, and validate additional routes
with funded testnet wallets before enabling them on mainnet.

The testnet overlay explicitly enables all ten implemented adapters for testing:
Polygon, Monad, Cosmos Hub, Celestia, Osmosis, Sui, Aptos, Polkadot, BNB Chain,
and Solana. `ENABLED_CHAINS` and `NEXT_PUBLIC_ENABLED_CHAINS` must match. The
searchable staking selector shows each network's RPC status and allows inspecting
unavailable routes without signing. Staking requires a ready chain watcher and
a same-mode Canton readiness check, including a fresh check before the wallet
flow starts. This testnet rollout does not change mainnet's Polygon-only default
or establish funded-wallet lifecycle verification for the additional routes.

At the operator's explicit request on 2026-09-27, the existing mainnet Docker
deployment also opted into all ten networks. Live catalogs, active watchers,
and desktop/mobile network switching were checked during that rollout. This
is not funded-wallet lifecycle certification: that testing and production
Canton onboarding remain outstanding, and the app still connects to LocalNet.
The source defaults remain Polygon-only; production requires matching explicit
backend/frontend allowlists. For future GitHub deployments, set the repository's
`NEXT_PUBLIC_ENABLED_CHAINS` build variable to the same list as the server's
`.env`; the workflow rejects a mismatch rather than silently changing networks.

### Gated production release — 2026-10-04

The updated staking, positions, rewards and genuine Loop integration code is
deployed to both production domains. Existing environment files and records are
preserved. External Loop signing and CC payments remain disabled by explicit
operator decision; readiness/build/browser checks are not proof of a funded
wallet lifecycle. The MainNet adapter still needs its separate implementation
and verified node/package handoff before activation.

See the [rollout record](docs/production-rollout-2026-10-04.md),
[Loop integration and release gates](docs/loop-testnet-integration.md), and the
[TestNet](docs/CANTON_TESTNET_NODE_PROMPT.md) /
[MainNet](docs/CANTON_MAINNET_NODE_PROMPT.md) read-only node handoff prompts.
These public guides are committed; private runtime credentials, database dumps
and test-wallet keys remain excluded.

### Self-custodial by construction
Native staking and exit transactions are signed by the user's wallet. CantonStake's backend observes verified chain events and records the corresponding Daml lifecycle through its app-provider party. The experimental auto-compound keeper is disabled; its permit storage is not yet a verified authorization boundary.

### Canton Coin reward rounds
A legacy BullMQ scheduler records allocations every 10 minutes from the
LocalNet-shaped Scan activity feed. These records are not CC claims or payments.
The scheduler is disabled for the external Loop TestNet workflow; its configured
pool and raw-token weighting are not reused for real multi-network rewards.

The legacy **gross allocation per round is a configured constant**
(`SCAN_ROUND_CC_POOL`), not a network-issued minting allowance. Real TestNet
rewards must be observed through DSO-issued reward coupons, with eligibility,
beneficiary assignment and minting verified separately. See the staged reward
observation section below.

### On-ledger 75/25 beneficiary split
The `BeneficiarySplit` Daml template records recipient weights and enforces
`sum(weights) == 1.0`; it does not itself claim or transfer CC. Its `Update`
choice emits a `BeneficiarySplitUpdated` audit contract. The provisioned hosted
TestNet delegator split cannot substitute for beneficiaries using real Loop
wallets. Per-user assignment and verified minting remain pending.

### Validator quality scoring
Backend service polls each chain's validator source on a 1-hour cron, normalises into a `ScoredValidator` shape, and caches by network mode in Redis. Cosmos Hub, Celestia, and Osmosis validators are read from a chain-ID-verified RPC across all pages; the Cosmos live yield estimate uses that same verified RPC. Composite score combines uptime, commission, slash history, and stake concentration, but uptime and slash history remain unmeasured estimates on chains that do not expose them. The scores drive the staking picker.

### Auto-compound keeper
**Experimental and unavailable.** `/api/autocompound/status` reports deployment availability independently of saved permits. `AUTO_COMPOUND_DISABLED=true` disables execution; setting it to `false` still cannot activate a route that has not completed authorization and lifecycle validation. No routes have passed that gate yet. New permit creation, scheduled jobs, and manual triggers are blocked, including previously queued jobs. Existing permits and run history remain readable, and saved permits can still be revoked. Settings shows the backend status without presenting stored permits as running automation. Verified per-chain authorization and funded-wallet testing are required before a route can be enabled.

### Slashing & reward alerts
Slashing monitor diffs validator scores hourly and emits `validator.score_drop` / `validator.jailed` events. Notifications router fans out to Telegram, Resend (email), and Discord webhooks per the user's configured channels — soft-deletable, audit-logged, idempotent on `(alertId, channelId)`.

### Tax CSV export
`/api/tax/csv?format=koinly` returns a downloadable CSV of every reward event and native sweep keyed to the user's EVM address, in Koinly's import format.

### Live narrator
The backend narrator endpoint can explain recorded activity using Anthropic or
a templated explanation when no API key is set. Its unused frontend component
and API wrapper have been removed; the rewards page uses recorded data instead.

### Connected-wallet rewards (staged)

`POST /api/account/rewards` is read-only and batches up to eight native wallet
addresses into one ledger inventory, deployment-local position metadata,
recorded history and optional round history. The rewards page gets its scope
from connected EVM, Cosmos Hub, Celestia, Osmosis, Sui, Aptos, Solana and Polkadot
wallet hooks; there is no default wallet or hosted-delegator substitution.
Hex/bech32 addresses are normalized; case-sensitive Solana/SS58 keys are not.
The response must match the frontend's network and exact wallet scope.

History remains available if the ledger inventory fails; failed reads are not
converted to zero rewards. The compact scrolling position panel is retained.
CC totals cover the selected period (or latest displayed events if truncated),
not a claimed lifetime payout. Native assets are grouped separately; current
native sweep records are Polygon-only. Round totals and CC allocations are
database records, not proof of CC settlement. External Loop TestNet reports
claims/payments and per-user splits as unconfigured; primary positions show CC
disabled, while preserved legacy allocations remain readable. The rewards page
does not promise a timed payout or a verified 75/25 transfer.

`backend/scripts/check-account-rewards.ts <actual-native-wallet-address>` checks
the staged endpoint against the real TestNet database and both ledger sources
inside a PostgreSQL-enforced read-only transaction. At 2026-10-04 11:25 UTC it
preserved the supplied wallet's one legacy Monad position, read zero history
events and ten recorded rounds, rejected a wrong deployment and invalid/empty
wallet scopes, and made no writes. This is not a Loop wallet integration test,
does not verify native or CC payments, and does not deploy any configuration.

### Cross-chain portfolio view
`/portfolio` aggregates Canton-recorded positions from every connected EVM, Cosmos, Sui, Aptos, Solana, and Polkadot wallet, with bonded/unbonding counts. Cosmos-family wallet reads use chain-ID-checked RPC queries and exhaust pagination. Testnet assets have no real USD valuation; mainnet USD totals are shown only when all active positions have chain metadata and prices. The per-address `/api/portfolio/:address` endpoint combines live Polygon ValidatorShare balances with Canton-recorded native-chain positions and reports unavailable reads or unclassified positions explicitly. Refreshes every 30 seconds.

### Loop wallet integration
Browser flow via `@fivenorth/loop-sdk` for Canton party identity. Deployed origins connect directly to Loop so ticket metadata retains the originating dApp. A Fastify reverse proxy remains available at `/loop-proxy/*` for local origins that Loop's CORS policy does not allow.

The two deployments use separate Loop environments: CantonStake mainnet connects to `https://cantonloop.com`, while CantonStake testnet connects to `https://devnet.cantonloop.com`. Their accounts, party IDs and private keys are independent.

### Multi-wallet picker
A single modal connects Loop, MetaMask/Rabby/Brave/Frame (injected), Coinbase Wallet, Safe, WalletConnect, Keplr, Aptos-standard wallets, and Sui wallets via dapp-kit. Top-nav chips trigger the picker globally via React context.

---

## Architecture

```mermaid
flowchart TB
    subgraph Client["Browser · Next.js 14"]
        UI[Stake / Dashboard / Portfolio]
        WAG[Wagmi · viem]
        KEP[Keplr / Leap]
        DAP[Mysten dapp-kit]
        LSDK[Loop SDK]
        UI --> WAG
        UI --> KEP
        UI --> DAP
        UI --> LSDK
    end

    subgraph Backend["Backend · Fastify + BullMQ"]
        API[HTTP routes]
        ORCH[Event orchestrator]
        ROUND[Round scheduler]
        SCAN[Scan poller · CIP-0104]
        VSC[Validator scoring]
        AC[Auto-compound keeper]
        NOTIF[Notifications]
        PROXY[Loop reverse proxy]
    end

    subgraph Data["Data layer"]
        PG[(PostgreSQL · Prisma)]
        RED[(Redis · BullMQ + cache)]
    end

    subgraph Chains["Chains"]
        CANTON[Canton DevNet · Daml]
        POLY[Polygon Amoy]
        MON[Monad Testnet]
        COS[Cosmos provider testnet]
        SUI[Sui Testnet]
    end

    subgraph External["External"]
        CG[CoinGecko]
        VAL[Public validator APIs]
        ANT[Anthropic]
        TG[Telegram / Resend / Discord]
        SENT[Sentry]
    end

    Client --> API
    LSDK --> PROXY
    PROXY --> CANTON
    API --> PG
    API --> RED
    ORCH --> POLY
    ORCH --> CANTON
    ROUND --> SCAN
    SCAN --> CANTON
    VSC --> VAL
    AC --> POLY
    AC --> MOON
    AC --> MON
    AC --> COS
    AC --> SUI
    UI --> CG
    NOTIF --> TG
    API --> ANT
    Backend --> SENT

    style UI fill:#0f172a,color:#f8fafc
    style WAG fill:#1e293b,color:#f8fafc
    style KEP fill:#1e293b,color:#f8fafc
    style DAP fill:#1e293b,color:#f8fafc
    style LSDK fill:#1e293b,color:#f8fafc
    style API fill:#0f172a,color:#f8fafc
    style ORCH fill:#1e293b,color:#f8fafc
    style ROUND fill:#1e293b,color:#f8fafc
    style SCAN fill:#1e293b,color:#f8fafc
    style VSC fill:#1e293b,color:#f8fafc
    style AC fill:#1e293b,color:#f8fafc
    style NOTIF fill:#1e293b,color:#f8fafc
    style PROXY fill:#1e293b,color:#f8fafc
    style PG fill:#0f172a,color:#f8fafc
    style RED fill:#0f172a,color:#f8fafc
    style CANTON fill:#0f172a,color:#f8fafc
    style POLY fill:#1e293b,color:#f8fafc
    style MOON fill:#1e293b,color:#f8fafc
    style MON fill:#1e293b,color:#f8fafc
    style COS fill:#1e293b,color:#f8fafc
    style SUI fill:#1e293b,color:#f8fafc
```

### Trust Boundaries

| Boundary | Trust Level | Verification |
|---|---|---|
| User's wallet (Loop, MetaMask, Keplr, Sui) | Self-custody | User signs every state-changing tx; keys never reach the backend |
| Daml ledger (Canton DevNet) | Multi-party consent | Signatory + observer parties enforced by Canton consensus |
| Native staking chains | Trust the chain | Settlement guaranteed by each chain's validator set |
| Backend orchestrator | Operator | Only writes to Daml within choices the user consented to; never holds user keys |
| Auto-compound keeper | Disabled / experimental | Scheduled and manual execution are gated; verified permit authorization remains unfinished |
| Loop SDK reverse proxy | Same-origin | Server-to-server upstream; strips Origin/Referer; CORS issued only for trusted origin |
| BeneficiarySplit weights | Operator-rotatable | `Split_Update` archives + recreates with `version + 1` and emits audit beacon |

---

## How It Works

### Position Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: StakingRequest created
    Pending --> Bonded: orchestrator-accept (Polygon event) / force-accept (other chains)
    Pending --> Cancelled: user cancels before accept
    Bonded --> Unbonding: user requests unbond + EVM tx confirms
    Unbonding --> Released: unbonding period elapses + claim tx settles
    Released --> [*]: position archived
    Cancelled --> [*]
```

### Stake Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Next.js Frontend
    participant BE as Fastify Backend
    participant Daml as Canton Ledger
    participant Wallet as Wallet (Wagmi/Keplr/Sui)
    participant Chain as Native Chain
    participant Sched as Round Scheduler

    User->>FE: Pick chain + amount, click Bond
    FE->>BE: POST /api/requests {chain, evmAddress, amountPol, validator}
    BE->>Daml: createContract(StakingRequest)
    Daml-->>BE: contractId
    BE-->>FE: { transactionId, chain }
    FE->>Wallet: signAndBroadcast(delegate tx)
    Wallet->>Chain: tx
    Chain-->>Wallet: receipt
    Note over FE,Chain: Polygon → orchestrator polls ShareMinted event<br/>Other chains → frontend calls force-accept
    BE->>Daml: exerciseChoice(StakingRequest_Accept, EvmProof)
    Daml-->>BE: StakingPosition (status=Bonded)
    Note over Sched: every 10 min
    Sched->>BE: ingest CIP-0104 records
    Sched->>Daml: distribute CC via BeneficiarySplit (75/25)
    Daml-->>FE: position.markersEmitted++ (poll)
    FE-->>User: Stage 5 success animation
```

### Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant FE as Frontend
    participant LoopApi as devnet.cantonloop.com
    participant LMobile as Loop Mobile Wallet
    participant BE as Backend API

    User->>FE: Click Connect Loop
    FE->>LoopApi: POST /api/v1/.connect/pair/tickets
    LoopApi-->>FE: { ticket_id, auth_token }
    FE->>LoopApi: Open authenticated ticket WebSocket
    FE->>User: Show QR code
    User->>LMobile: Scan QR
    LMobile->>LoopApi: handshake_accept
    LoopApi-->>FE: WS handshake_accept
    FE->>FE: localStorage persists partyId
    FE->>BE: POST /api/users (cantonPartyId, evmAddress)
```

---

## Quick Start

**Prerequisites**

- Node.js 22+ (required by the Sui SDK; Docker uses Node 22)
- Docker + Docker Compose
- Canton CN Quickstart LocalNet (for local Canton ledger) — or remote DevNet credentials
- Testnet tokens for whichever chain(s) you want to demo (faucet links below)

### Automated Setup

```bash
git clone https://github.com/your-org/cantonstake.git
cd cantonstake

cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Fill in: CANTON_APP_PROVIDER_PARTY,
# CANTON_DELEGATOR_PARTY, NEXT_PUBLIC_BACKEND_URL (optionally
# NEXT_PUBLIC_REAL_VALIDATOR_SHARES for the Polygon share registry).

docker compose up --build
```

### Start the Application

```bash
docker compose up -d
docker compose logs -f backend frontend
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3001 |
| Backend API | http://localhost:4001 |
| Backend health | http://localhost:4001/api/health/detail |
| Prometheus metrics | http://localhost:4001/metrics |
| PostgreSQL | localhost:5433 |
| Redis | localhost:6379 |

### Manual Setup

1. **Canton LocalNet** — start the CN Quickstart in a separate terminal:

```bash
cd ../cn-quickstart/quickstart
make start
```

2. **Polygon ValidatorShare registry** — there is no single staking
   contract: Polygon's StakeManager deploys one ValidatorShare per
   validator. The backend discovers them live from the settlement chain's
   StakeManager and serves the map at `/api/polygon/validator-shares`.
   Optionally pin a build-time snapshot in the frontend
   (`NEXT_PUBLIC_REAL_VALIDATOR_SHARES`, JSON `{validator: contract}`).

3. **Backend** (separate terminal):

```bash
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run dev
```

4. **Frontend** (separate terminal):

```bash
cd frontend
npm ci
npm run dev
```

### Faucet Setup

Each demo chain needs testnet tokens. Grab them before running the full flow:

- **Polygon Amoy** — https://faucet.polygon.technology/
- **Monad Testnet** — https://faucet.monad.xyz/
- **Cosmos Hub provider testnet** — https://faucet.polypore.xyz/
- **Sui Testnet** — `#testnet-faucet` on the Sui Discord (`!faucet 0x...`)

---

## Project Structure

```
cantonstake/
├── frontend/                          # Next.js 14 app
│   ├── app/
│   │   ├── page.tsx                   # Marketing landing
│   │   ├── stake/                     # Multi-chain staking flow
│   │   ├── dashboard/                 # Connected user overview
│   │   ├── positions/                 # Per-position lifecycle + sweep
│   │   ├── portfolio/                 # Cross-chain aggregate
│   │   ├── rewards/                   # Connected-wallet positions + recorded rewards
│   │   ├── analytics/                 # Marker history + insights
│   │   ├── settings/                  # Auto-compound permits + alert channels
│   │   └── providers.tsx              # Wagmi + dapp-kit + Sui + WalletPicker
│   ├── components/
│   │   ├── chrome/                    # TopNav, PriceTape, CCRoundTicker
│   │   ├── primitives/                # Banner, Btn, Card, Chip, EmptyState
│   │   ├── trace/                     # Live trace pubsub
│   │   ├── WalletPickerModal.tsx      # Loop + EVM + Cosmos + Sui in one modal
│   │   └── WalletPickerProvider.tsx   # Global picker context
│   ├── lib/
│   │   ├── api.ts                     # Typed backend client
│   │   ├── chains.ts                  # Chain catalog + chainFromAddress heuristic
│   │   ├── chains/                    # Per-chain IChainAdapter implementations
│   │   ├── canton/                    # Real Loop SDK provider and signing workflow
│   │   ├── cosmos/use-cosmos-wallet   # Keplr / Leap React hook
│   │   ├── sui/use-sui-wallet         # Mysten dapp-kit wrapper
│   │   ├── prices.ts                  # CoinGecko POL price + CC env
│   │   ├── position-chain-map.ts      # localStorage chain lookup
│   │   ├── validators-live.ts         # Backend-fetched validator scores
│   │   └── wagmi.ts                   # EVM connectors + chain list
│   ├── Dockerfile                     # Multi-stage with BuildKit cache + standalone output
│   └── .env.example
├── backend/                           # Fastify + Prisma + BullMQ
│   ├── src/
│   │   ├── index.ts                   # HTTP server + route registration
│   │   ├── orchestrator.ts            # Polygon ShareMinted/Burned event watcher
│   │   ├── reward-rounds.ts           # 10-min CC distribution scheduler
│   │   ├── scan-poller.ts             # CIP-0104 AppActivityRecord ingestion
│   │   ├── canton.ts                  # Canton JSON Ledger API client
│   │   ├── config.ts                  # Env wiring
│   │   ├── routes/
│   │   │   ├── chains.ts              # GET /api/chains/stats
│   │   │   ├── rewards.ts             # rounds + analytics + health
│   │   │   ├── portfolio.ts           # cross-chain aggregator
│   │   │   ├── auto-compound.ts       # permit CRUD
│   │   │   ├── notifications.ts       # alert channel CRUD
│   │   │   ├── validators.ts          # validator scoring
│   │   │   ├── sweep.ts               # native reward sweep
│   │   │   ├── tax.ts                 # Koinly CSV export
│   │   │   └── loop-proxy.ts          # Loop API CORS bypass
│   │   └── services/
│   │       ├── auto-compound.ts       # per-chain executors (5 chains)
│   │       ├── validator-scoring.ts   # public-API ingestion + Redis cache
│   │       ├── notifications.ts       # Telegram / Resend / Discord fan-out
│   │       ├── slashing-monitor.ts    # validator score-drop alerts
│   │       ├── nativeSweep.ts         # Real Polygon validator reward sweep
│   │       ├── narrator.ts            # Anthropic-powered round commentary
│   │       └── observability.ts       # Prometheus + Sentry
│   ├── prisma/schema.prisma           # User, StakingPosition, RewardRound, etc.
│   ├── Dockerfile                     # Multi-stage with prod-deps prune
│   └── .env.example
├── daml/CantonStake/                  # Daml templates
│   └── daml/CantonStake/
│       ├── Staking.daml               # StakingRequest, StakingPosition, BeneficiarySplit
│       └── Setup.daml
├── evm/                               # Hardhat / liquid-staking tools
│   ├── contracts/TestWrappedPOL.sol   # Amoy test-token wrapping
│   └── scripts/                       # sPOL deployment and round-trip checks
├── docker-compose.yml                 # Local stack (Postgres, Redis, frontend, backend)
├── .github/workflows/deploy.yml       # GHCR build + SSH-deploy CI
└── references/                        # Vendored upstream repos (loop-sdk, restake, sui-staker-ui, etc.)
```

---

## API Endpoints

All routes return JSON. POST/PUT/DELETE expect `Content-Type: application/json`.

| Header | Description |
|---|---|
| `Content-Type: application/json` | Required for write requests |
| `Authorization: Bearer ...` | Currently unused (v1 has no auth); production would tie to Loop / OAuth2 |

### Health & Observability

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/health` | Liveness + key configuration | none |
| GET | `/api/readiness` | Canton ledger API reachability (503 when unavailable; separate from process liveness) | none |
| GET | `/api/watchers` | Per-chain watcher reachability and network mode | none |
| GET | `/api/health/detail` | Detailed health + warnings array | none |
| GET | `/metrics` | Prometheus exposition format | none |

### Users

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/users` | Upsert (cantonPartyId, evmAddress, displayName) | none |
| GET | `/api/users/by-evm/:address` | Lookup user record by EVM address | none |

### Staking

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/requests` | Create StakingRequest on Canton (chain-agnostic) | none |
| GET | `/api/requests` | List pending StakingRequests, filter by `?address=` | none |
| GET | `/api/positions` | List active StakingPositions, filter by `?address=` | none |

`POST /api/requests` requires `clientNetworkMode` (`testnet` or `mainnet`)
matching the backend deployment. It returns 409 on a missing/mismatched mode
and 503 until the selected chain's settlement watcher has completed a
successful scan; neither case creates a Canton request.

### Rewards

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/rewards/:address` | Lifetime CC + sweep summary for a user | none |
| GET | `/api/rewards/rounds` | Recent rounds, optional `?address=` for user share | none |
| GET | `/api/rewards/health` | Round automation success rate + last round | none |
| GET | `/api/narrator/:address` | Anthropic-powered round narration | none |
| POST | `/api/sweep/:positionId` | Trigger native reward sweep | none |

### Analytics

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/analytics/markers` | Hourly marker histogram + window-over-window delta | none |
| GET | `/api/chains/stats` | Per-chain validator count, APY estimate, source | none |
| GET | `/api/portfolio/:address` | Cross-chain delegation aggregate | none |
| GET | `/api/portfolio/:address/series` | TVL snapshot time series | none |
| GET | `/api/tax/csv` | Koinly-format CSV (`?address=&format=koinly`) | none |

### Validators

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/validators/scores` | All chains, cached snapshots | none |
| GET | `/api/validators/scores/:chain` | Single chain | none |
| POST | `/api/validators/scores/:chain/refresh` | Force re-fetch | LOG_LEVEL=debug |

### Auto-Compound

| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/autocompound/status` | Deployment availability and verified routes | none |
| POST | `/api/autocompound/permits` | Create permit; currently blocked until a route is verified and enabled | none |
| GET | `/api/autocompound/permits` | List permits for `?userId=` | none |
| DELETE | `/api/autocompound/permits/:id` | Soft-disable permit | none |
| GET | `/api/autocompound/permits/:id/runs` | Run history (last 50) | none |
| POST | `/api/autocompound/trigger` | Manual tick; currently unavailable; requires an enabled verified route | LOG_LEVEL=debug |

### Notifications

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/notifications/channels` | Upsert (kind, target, label) | none |
| GET | `/api/notifications/channels` | List channels for `?userId=` | none |
| DELETE | `/api/notifications/channels/:id` | Soft-disable channel | none |
| POST | `/api/notifications/test` | Emit a test alert | LOG_LEVEL=debug |

### Loop SDK Proxy

| Method | Path | Description | Auth |
|---|---|---|---|
| ANY | `/loop-proxy/*` | HTTP + WS reverse proxy to `LOOP_API_UPSTREAM` | none |

---

## Network Modes

One deployment serves one network mode — `NETWORK_MODE=testnet|mainnet`
swaps every chain endpoint/contract at once, with a hard
`MAINNET_CONFIRMED=yes` interlock for mainnet and a visible mode badge in
the UI. See **[docs/NETWORK_MODES.md](docs/NETWORK_MODES.md)** for the full
per-chain table and the known mainnet gaps.

### Polygon Amoy liquid staking (testnet only)

Testnet `/stake` defaults Polygon to the official Amoy sPOL deposit and a
liquidity-backed swap exit, both paid with native Amoy test POL. The same flow is
available at `/stake/liquid`. Direct validator delegation remains an advanced
option at `/stake?polygon=validator`; that separate flow needs Sepolia test POL
and Sepolia ETH. Mainnet continues to use its existing validator flow.

The liquid backend requires `SPOL_TEST_ENABLED=true` and the configured
`SPOL_TEST_ROUTER`, `SPOL_TEST_QUOTER`, `SPOL_TEST_WRAPPER`, and `SPOL_TEST_POOL`.
Frontend and backend must be deployed together: balances now identify their
wallet, and quotes identify their chain, token and swap contracts. The UI fails
closed against an older or mismatched API response.

Safeguards include connected-wallet balance isolation, explicit Amoy switching,
fresh transaction simulation and gas checks, a 1-token transaction limit,
30-second quotes, 1% swap slippage, and a 5% price-impact limit measured against
the pool's pre-trade spot. The pool price can differ substantially from the
protocol redemption value; these limits do not guarantee a profitable round
trip. New approvals are limited to the requested amount. If approval outlasts a
quote, review a fresh quote; the allowance is reused rather than approved again.
The official deposit method has no on-chain minimum-output parameter.

Canton tracking is optional public-balance evidence, not validator delegation
or CC payout entitlement. CC rewards remain disabled. The self-seeded swap pool
is a test fixture with finite liquidity. The queued cross-chain redemption
fallback is **not implemented or enabled**; the UI never calls the sPOL bridge
burn as a local withdrawal. No mainnet liquidity route is enabled by this work.

Verification commands (run from the indicated package directory):

- Frontend: `npm test` and `npm run typecheck`.
- Backend: `node_modules/.bin/tsx --test test/*.test.ts` and `npm run typecheck`.
- Backend live reads only: `node_modules/.bin/tsx scripts/check-liquid-readonly.ts`.
  This checks real quotes, disables Canton writes, and does not sign transactions.
- EVM local swap fixture: `node_modules/.bin/hardhat run --no-compile --config v3-test.config.cjs scripts/test-spol-v3-local.cjs`.
- EVM deployed-contract fork: `node_modules/.bin/hardhat run --no-compile --config spol-test.config.cjs scripts/check-spol-amoy-roundtrip.cjs`.
  Requires an Amoy RPC that serves historical state. Only an explicit `PASS`
  result establishes success; a timeout or EDR/RPC error is not a pass, even if
  the Hardhat launcher returns exit code zero. This tests a swap, not canonical
  redemption, and local fork events are not Canton evidence.

## Canton DAR build and deployment workflows

DAR releases are separate from Docker application deployments. These scripts
do not restart services, create parties, delete old packages, or pay CC rewards.
Requirements: Node.js 18+, the Daml SDK pinned by the selected project's
`daml.yaml`, and its dependency DARs. Java is also needed for `daml test`.

```bash
# Local build only; no upload. Add --run-tests when Daml tests/Java are available.
bash scripts/build-canton-dar.sh

# Non-mutating server compatibility check; prints artifact identity and confirmation.
bash scripts/validate-canton-dar.sh --network testnet

# Explicit remote write: validates again, uploads, requests vetting, checks packages.
# Replace the placeholder with the exact SHA-256 printed by validation.
bash scripts/upload-canton-dar.sh --network testnet --confirm 'testnet:<SHA256>'

# Test the deployment safeguards without any network writes.
node --test scripts/canton-dar.test.mjs

# Regression-test the built application DAR in a separate, never-uploaded package.
# Requires Java on PATH; the test dependency currently pins cantonstake 0.0.2.
(cd daml/CantonStakeTests && daml test)
```

The verified TestNet endpoint and synchronizer are in
[`scripts/canton-dar.targets.json`](scripts/canton-dar.targets.json). MainNet and
DevNet deliberately have no default target. Configure each from its node handoff
using **both** dedicated variables, then use the same validate/upload scripts:

```bash
export CANTON_DAR_MAINNET_JSON_API_URL='https://<verified-mainnet-host>/<json-api-prefix>'
export CANTON_DAR_MAINNET_SYNCHRONIZER_ID='<complete-mainnet-synchronizer-id>'
bash scripts/validate-canton-dar.sh --network mainnet
bash scripts/upload-canton-dar.sh --network mainnet --confirm 'mainnet:<SHA256>'
```

For DevNet use `CANTON_DAR_DEVNET_JSON_API_URL`,
`CANTON_DAR_DEVNET_SYNCHRONIZER_ID` and `--network devnet`. No production
`.env` files are loaded or shared between networks. Where authentication is
required, supply `--token-file /path/to/private-token` or securely inject
`CANTON_DAR_<NETWORK>_AUTH_TOKEN`; never put tokens in arguments, target JSON,
committed files, or Actions logs. HTTPS is required; redirects are refused.
The target configuration is operator-supplied, not independent proof of network
identity. Verify the endpoint/synchronizer mapping before approving a release.

Use `--project daml/LiquidStake` for that separate package, `--dar PATH` for a
specific artifact and `--expected-sha256 HASH` to pin an artifact's bytes.
Bump the Daml package version before publishing changed code, validate upgrade
compatibility, and preserve old packages/contracts needed by active positions.
Uploads are not retried automatically: a timeout can mean the write completed.
Inspect the node before retrying.

Every successful local build and every attempted remote workflow writes a
private JSON audit receipt under `.deploy-backups/canton-dar/` (gitignored),
including target, checksum, main/dependency package IDs and stage outcomes.
`--receipt PATH` selects a new receipt file; existing files are refused.
Upload checks that all bundled packages are visible afterwards. It records
vetting as requested/accepted, **not independently verified**; confirm topology
propagation on the node. No service-user or staking test is implied by upload.

For GitHub Actions or another CI system, invoke validation in a job with the
required SDK/dependency DARs and node connectivity. Keep upload in a separately
approved job with the same artifact/checksum and protected network-specific
secrets. The existing automatic Docker deployment workflow is unchanged.

**DAR release status (2026-10-03):** `cantonstake-0.0.2.dar` fixes the
`StakingPosition_RequestUnbond` archival defect by making the intent choice
non-consuming. Five local lifecycle regressions and 17 deployment-safeguard
tests pass. It was validated, uploaded and its vetting independently observed
on the public TestNet participant/synchronizer. MainNet, application endpoints,
parties and service users were not changed. The separate `CantonStakeTests`
package is local-only; its Daml Script dependencies are not in the app DAR.
The old `0.0.1` DAR still has the defect and must not be activated. CC reward
attribution/claiming remains unverified; package deployment does not establish
that the application is connected to the public node or can pay rewards.

API contract: [JSON Ledger API DAR validation and upload](https://archived.docs.digitalasset.com/build/3.5/reference/json-api/openapi.html).

## Environment Variables

### Backend — `backend/.env`

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `4000` |
| `LOG_LEVEL` | Pino log level | `info` |
| `SCAN_API_URL` | Canton Scan API base for CIP-0104 attribution (unset = rounds mint 0 CC) | empty |
| `SCAN_PAGE_SIZE` | Page size for the Scan /v0/events poll | `500` |
| `SCAN_ROUND_CC_POOL` | Gross CC distributed per network round (configured — the Scan publishes no mint pool; parties + weights are real) | `100` |
| `AMOY_RPC_URL` | Polygon Bor/Amoy RPC override (not the staking settlement chain) | mode-selected |
| `STAKE_SETTLEMENT_RPC_URL` / `STAKE_SETTLEMENT_FALLBACK_RPC_URL` | Polygon Ethereum L1 primary/fallback RPC overrides | mode-selected |
| `STAKE_SETTLEMENT_CHAIN_ID` | Polygon settlement chain; must match the deployment mode | `11155111` testnet / `1` mainnet |
| `POLYGON_STAKE_MANAGER_ADDRESS` / `POLYGON_STAKING_LOGGER_ADDRESS` | Polygon settlement contract overrides | mode-selected |
| `CANTON_JSON_API_URL` | Canton JSON Ledger API | `http://localhost:3975` |
| `CANTON_APP_PROVIDER_PARTY` | App provider party id | required |
| `CANTON_AUTH_TOKEN` | Bearer token (or empty if auth disabled) | empty |
| `CANTON_DELEGATOR_PARTY` | Default delegator party | required |
| `FEATURED_APP_RIGHT_CID` | CID of self-featured FeaturedAppRight | empty |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://cantonstake:cantonstake@localhost:5432/cantonstake` |
| `REDIS_URL` | Redis URL | `redis://localhost:6379` |
| `SCAN_API_URL` | CIP-0104 SV Scan API endpoint | empty |
| `ANTHROPIC_API_KEY` | Powers `/api/narrator` | empty |
| `ANTHROPIC_MODEL` | Claude model id | `claude-haiku-4-5` |
| `VALIDATOR_SCORING_DISABLED` | Skip scheduler | `false` |
| `TELEGRAM_BOT_TOKEN` | Telegram alerts | empty |
| `RESEND_API_KEY` | Email alerts | empty |
| `DISCORD_DEFAULT_WEBHOOK` | Fallback Discord webhook | empty |
| `AUTO_COMPOUND_DISABLED` | Skip keeper | `true` |
| `AUTO_COMPOUND_KEEPER_KEY` | EVM keeper signing key | empty |
| `MONAD_RPC_URL` | Monad Testnet RPC | `https://testnet-rpc.monad.xyz` |
| `COSMOS_REST_URL` | provider-testnet REST (mainnet is mode-selected) | `https://cosmoshub-testnet.api.kjnodes.com` |
| `COSMOS_RPC_URL` | provider-testnet RPC (mainnet is mode-selected) | `https://cosmoshub-testnet.rpc.kjnodes.com` |
| `COSMOS_KEEPER_MNEMONIC` | Cosmos auto-compound keeper mnemonic | empty |
| `SUI_GRAPHQL_URL` | Sui indexed events and validators (mode-selected) | `https://graphql.testnet.sui.io/graphql` |
| `CELESTIA_RPC_URL` / `CELESTIA_REST_URL` | Celestia mocha testnet RPC/LCD | POPS public endpoints |
| `OSMOSIS_RPC_URL` / `OSMOSIS_REST_URL` | Osmosis testnet RPC/LCD | official endpoints |
| `APTOS_REST_URL` / `APTOS_INDEXER_URL` | Aptos fullnode and delegated-pool indexer (mode-selected) | official Aptos endpoints |
| `APTOS_REST_URL` | Aptos testnet fullnode REST | `https://fullnode.testnet.aptoslabs.com` |
| `POLKADOT_RPC_URL` | Polkadot nomination-pool Asset Hub RPC (mode-selected) | `https://westend-asset-hub-rpc.polkadot.io` |
| `RPC_FALLBACK_URLS` | Server-only ordered backup URL arrays by pool name; see RPC failover below | `{}` (mode-selected built-in backups) |
| `BNB_RPC_URL` | BNB Chain Chapel RPC (StakeHub `0x…2002`) | publicnode |
| `SOLANA_RPC_URL` | Solana testnet RPC | `https://api.testnet.solana.com` |
| `SUI_KEEPER_PRIVATE_KEY` | Sui keeper private key | empty |
| `LOOP_PROXY_ENABLED` | Enable `/loop-proxy/*` reverse proxy | `true` |
| `LOOP_API_UPSTREAM` | Upstream URL the proxy forwards to | `https://devnet.cantonloop.com` |
| `SENTRY_DSN` | Sentry DSN | empty |

### Frontend — `frontend/.env`

For Docker deployments, set browser-facing overrides in the matching Compose
env file before building. `NEXT_PUBLIC_*` values are baked into each frontend
image, so changing them requires rebuilding that mode's image; a container
restart alone will not update the browser bundle. Leave optional overrides
blank to use mode-selected defaults.

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Backend API base | `http://localhost:4001` |
| `NEXT_PUBLIC_REAL_VALIDATOR_SHARES` | JSON map `{validator: contract}` (build-time snapshot; the live registry comes from the backend) | `{}` |
| `NEXT_PUBLIC_POLYGON_SETTLEMENT_CHAIN_ID` / `NEXT_PUBLIC_POLYGON_STAKE_MANAGER` / `NEXT_PUBLIC_POLYGON_STAKING_LOGGER` / `NEXT_PUBLIC_POLYGON_STAKE_TOKEN` | Polygon settlement overrides; chain ID must match the mode (11155111 testnet / 1 mainnet) | mode-selected |
| `NEXT_PUBLIC_SHARE_SLIPPAGE_BPS` | Polygon ValidatorShare share-conversion slippage | `50` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project id | empty |
| `NEXT_PUBLIC_LOOP_NETWORK` | `local` / `devnet` / `mainnet` | `devnet` |
| `NEXT_PUBLIC_LOOP_SDK_ENABLED` | Real Loop SDK on/off | `true` |
| `NEXT_PUBLIC_LOOP_USE_BACKEND_PROXY` | Route Loop API via `/loop-proxy` for unallowlisted dev origins | `false` |
| `NEXT_PUBLIC_LOOP_API_URL` | Override the SDK's apiUrl | empty |
| `NEXT_PUBLIC_LOOP_WALLET_URL` | Override the SDK's walletUrl | empty |
| `NEXT_PUBLIC_CC_USD` | CC price fallback | `0.16` |
| `NEXT_PUBLIC_COSMOS_CHAIN_ID` | Cosmos chain id; an override must match the selected mode | `provider` (testnet) / `cosmoshub-4` (mainnet) |
| `NEXT_PUBLIC_COSMOS_CHAIN_NAME` | Display name for Keplr suggest | mode-selected |
| `NEXT_PUBLIC_COSMOS_COIN_DENOM` | Display denom | `ATOM` |
| `NEXT_PUBLIC_COSMOS_COIN_MINIMAL_DENOM` | Base denom; incompatible overrides are rejected | `uatom` |
| `NEXT_PUBLIC_COSMOS_COIN_DECIMALS` | Decimals; incompatible overrides are rejected | `6` |
| `NEXT_PUBLIC_COSMOS_COIN_TYPE` | BIP-44 coin type | `118` |
| `NEXT_PUBLIC_REQUIRE_CONNECT_WALL` | Force /connect on landing | `false` |

---

## Technology Stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, standalone output) |
| Language | TypeScript 5 |
| State / data | TanStack Query v5 |
| EVM | Wagmi v2 + viem v2 |
| Cosmos | Keplr / Leap browser extension + `@cosmjs/stargate` |
| Sui | `@mysten/dapp-kit-react` + `@mysten/sui` GraphQL |
| Canton | `@fivenorth/loop-sdk` |
| Styling | Inline tokens + Tailwind CSS |
| Testing | Vitest |

### Backend

| Layer | Technology |
|---|---|
| Runtime | Node 22 |
| HTTP | Fastify 5 with `@fastify/cors`, `@fastify/http-proxy` |
| ORM | Prisma 5 |
| Database | PostgreSQL 16 |
| Cache / Queues | Redis 7 + BullMQ |
| EVM | viem |
| Cosmos | `@cosmjs/stargate` + `cosmjs-types` |
| Sui | `@mysten/sui` (jsonRpc client) |
| AI | Anthropic SDK |
| Observability | Pino · Prometheus exposition · Sentry |

### Blockchain & Domain

| Layer | Technology |
|---|---|
| Canonical ledger | Canton DevNet · Daml 3.5 |
| Reward attribution | CIP-0104 (App Activity Records) with CIP-0047 fallback |
| Beneficiary split | On-ledger Daml `BeneficiarySplit` template (75/25 default) |
| Polygon staking | Real per-validator `ValidatorShare` on Ethereum settlement (Sepolia for testnet, Ethereum mainnet for mainnet) |
| Monad staking | Staking precompile (`0x...1000`) on Monad Testnet |
| Cosmos staking | x/staking on provider testnet; EndBlock verifies automatic unbond completion |
| Sui staking | `0x3::sui_system::request_add_stake` on Sui Testnet |

### Security & Auth

| Layer | Technology |
|---|---|
| Loop identity | Passkey/biometric handshake via `@fivenorth/loop-sdk` |
| EVM native transactions | User-wallet signatures; auto-compound permit verification is unfinished |
| Cosmos native transactions | Keplr/Leap signatures; keeper Authz integration is unfinished |
| Optional CORS fallback | `/loop-proxy` Fastify reverse proxy for unallowlisted local origins |
| Secrets | `.env` files; recommended `fly secrets` / Doppler in prod |

---

## Security Model

Native staking transactions use the user's wallet; the backend verifies settlement before recording the corresponding Canton lifecycle. This remains a hackathon MVP: request APIs need production authentication, and experimental keeper authorization is unfinished and disabled by default.

### Key Security Properties

| Property | Implementation |
|---|---|
| Self-custody | All staking/unstaking signatures originate from the user's wallet |
| On-ledger reward routing | `BeneficiarySplit` Daml contract enforces `sum(weights) == 1.0` |
| Auto-compound scope | Execution disabled by default; stored signatures are not yet cryptographically verified |
| Reward distribution idempotency | `(roundNumber, party, eventId)` unique constraint on `AppActivityRecord` |
| Alert delivery idempotency | `(alertId, channelId)` unique on `AlertDelivery` — retries don't double-send |
| Audit trail | Every economic transition emits `OnchainEvent` (CIP-0104) + lifecycle log on `RewardRound` |
| Featured App attribution | Sequencer + mediator traffic, signed by SVs each round |

### Attack Resistance

| Attack Vector | Status | Mechanism |
|---|---|---|
| Operator redirects rewards away from users | ✅ Mitigated | `BeneficiarySplit` weights enforced on-ledger; rotations emit audit beacon |
| Stale or forged auto-compound permit replayed | ⚠️ Unfinished | Keep execution disabled; expiry/enabled checks do not replace signature verification |
| Auto-compound exceeds user's authorised cap | ⚠️ Unfinished | Stored caps are not a verified wallet authorization; keep execution disabled |
| Same activity record double-counted across replays | ✅ Mitigated | Prisma `@@unique([roundNumber, party, eventId])` |
| Notification spam from re-emitted alerts | ✅ Mitigated | `dedupKey` on `AlertEvent` + `(alertId, channelId)` unique on delivery |
| Cross-origin abuse of Loop SDK proxy | ⚠️ Partial | `@fastify/cors` reflects request origin; rate limiting + per-origin allowlist recommended for prod |
| Validator slashing affecting active stakes | ⚠️ Partial | Slashing monitor diffs scores hourly + alerts; manual user action required to redelegate |
| Polygon mock fixture path in frontend | ✅ Resolved | Adapter ships only the real per-validator `ValidatorShare` path; registry served by `/api/polygon/validator-shares` |
| Keeper key leak | ⚠️ Partial | Keep keeper execution disabled and keys unprovisioned until authorization is verified; signed permit scope is not enforced cryptographically |

---

## Deployment

### Security release preparation (2026-10-08)

The staged identity migration adds nullable `User.identityVerifiedAt` and
per-wallet `UserWalletVerification` proofs without rewriting existing identities,
positions or rewards. Apply migrations before
starting the new backend (the image entrypoint already does this). Deploy the
updated frontend alongside it: legacy staking requests now require genuine Loop
authentication, a native-wallet signature bound to the exact request, and a
one-use expiring nonce. Profile edits require the genuine Loop session and can
only update the display name, never wallets or reward recipients.

Old public wallet links are **not automatically trusted** for new CC payouts.
Users can use **Settings → Verify reward recipient** with their real Loop and
EVM wallets, without staking again or transferring funds. Conflicting old links
require operator investigation; never fix them by reassigning positions or
blindly marking users verified. Existing external Loop/native stake adoption
also records verification, while preserving the primary wallet.
Each wallet represented in a staker payout must have its own verified consent;
verifying one wallet never trusts historical allocations from another wallet.

Payout batches atomically claim every share under Serializable isolation.
Only selected input holdings count toward funding. A transfer response without
receiver-owned CC evidence is `uncertain`, not `completed`. Accepted instructions
may remain pending according to the [token-standard contract](https://docs.sync.global/app_dev/api/splice-api-token-transfer-instruction-v1/Splice-Api-Token-TransferInstructionV1.html).
Unknown archives, timeouts and interrupted submissions must not be resubmitted.
Recovery can read stored transaction IDs and instruction history; absent proof,
keep the batch under review. Failed/rejected/expired shares remain linked to
their original batch for operator recovery, not automatically paid a second time.

The Compose defaults bind PostgreSQL and app ports to loopback; backend/database
traffic still uses the unchanged private `postgres:5432` address. Existing
database credentials and persisted volumes are unchanged. Explicit service
`*_BIND_IP` overrides are available for reviewed proxy layouts. CPU/RAM budgets,
health checks, bounded logs, a 10-connection Prisma pool and Redis `noeviction`
are configurable. These defaults require container recreation to take effect;
building images alone does not apply them. Verify the proxy reaches loopback
before the rollout, and apply persistence-service changes in a separate reviewed
maintenance step. Do not stop LocalNet while any deployment still uses it.

The deployment workflow now validates each backup's nonempty custom-format
archive index and records its SHA-256 before applying migrations. This is **not
proof of a full restore**: an operator still needs an isolated restore drill and
off-host backup/retention evidence. Do not restore over a live production database
as a test or rotate its password without coordinating every client.

Remaining release gates: supported RPC access for unavailable MainNet chains,
the MainNet application identities/authenticated runtime handoff and cutover,
Five North approval and a genuine funded Loop lifecycle, and any unpatched
transitive wallet-library advisories. DAR deployment itself is already evidenced
by the 2026-10-05 MainNet upload/inventory/vetting receipts (33 packages, topology
serial 32); do not upload it again merely to resolve the runtime handoff.
`LOOP_STAKING_ENABLED` and exact-package approval settings are not enabled by
these code changes. Test-network traffic-model allocations remain estimates
capped by observed coupons, not measured MainNet income.

### RPC failover

All app-owned chain clients (backend watchers/catalogs and browser SDK reads)
use `/api/rpc/<testnet|mainnet>/<pool>`. Primary URLs are configured **only on
the backend** with the existing `*_RPC_URL`, `*_REST_URL`, `APTOS_INDEXER_URL`
and `SUI_GRAPHQL_URL` variables. Legacy `NEXT_PUBLIC_*` RPC/REST/indexer URL
variables no longer select providers; move overrides to the corresponding
backend setting. `NEXT_PUBLIC_BACKEND_URL` must reach the matching deployment.
Wallet extensions can still use their own RPCs when signing/submitting; the
app cannot change an extension's provider configuration.

The gateway verifies each endpoint against the deployment's chain ID/genesis
(and Cosmos RPC sync state), caches identity for 30 seconds, uses a 4-second
per-exchange timeout and 14-second read budget, and cools failed providers down
for 15–120 seconds before reconsidering them. Transport failures, malformed
responses, rate limits and recognized provider errors trigger read failover.
Contract reverts and normal missing-account responses are passed through.
Original block heights, ledger versions, parameters and GraphQL cursors are
never replaced by “latest”. All configured endpoints failing closes the flow.
Chain-ID checks prevent configuration mistakes; they are not cryptographic
proof that a third-party provider is honest.

Writes may select a backup **before dispatch**, during the identity probe.
Once dispatched, an ambiguous submission is not automatically sent again: the
response tells the caller to check the transaction hash. Solana finality uses
HTTP polling through the pool, without a second signature or transaction.
Sui GraphQL submissions have a separate 80-second response timeout after the
bounded identity preflight; its read requests still use fast failover. The
gateway preserves the Sui SDK's client-protocol-version header.
There is no WebSocket proxy, node-admin API, arbitrary destination URL or
server-side account signing. Request sizes, batch sizes, response sizes and
in-flight work are bounded; add edge authentication/rate limits appropriate
to your paid-provider budget before opening this MVP publicly.

`GET /api/rpc/status` is a passive status snapshot: selected endpoint number,
hostname (no URL path/query/API key), cooldown, last successful request and
failover count. An unused endpoint is `unchecked`, not verified healthy.
Expired cooldowns report `retry_due` until a request succeeds; idle success
observations become `stale` after 60 seconds.
`redundancy` means more than one URL is configured, not independent operators
or a currently healthy backup. Watcher health is separate: a watcher can fail
while recording on Canton even when its chain RPC is healthy.

Set `RPC_FALLBACK_URLS` to a JSON map of ordered backup arrays (maximum five
total distinct URLs per pool). It replaces built-in backups for the named
pool; the primary remains first. Example structure (replace these example
hosts with your provider URLs; do not deploy these placeholders):

```dotenv
RPC_FALLBACK_URLS={"sui":["https://sui-provider.example/graphql"],"aptos-indexer":["https://aptos-provider.example/v1/graphql"]}
```

Available pool keys: `settlement`, `polygon`, `monad`, `bnb`, `cosmos`,
`cosmos-rest`, `celestia`, `celestia-rest`, `osmosis`, `osmosis-rest`, `aptos`,
`aptos-indexer`, `sui`, `solana`, `polkadot`. Keep separate maps in `.env` and
`.env.testnet` (`RPC_FALLBACK_URLS={}` in the testnet overlay clears an inherited
mainnet map). Backend recreation applies endpoint changes without rebuilding
the browser bundle. A gateway-code rollout requires rebuilding both images.

Built-in backups cover Polygon settlement/native RPC, Monad, BNB, Cosmos Hub,
Celestia, Osmosis, Aptos REST, the Aptos mainnet indexer, Solana and Polkadot
Asset Hub. Aptos REST/indexer's alternate hosts are both Aptos Labs; Osmosis
testnet's defaults are both Osmosis.
These help with endpoint failures but not necessarily an operator-wide outage.
Celestia mainnet uses kjnodes first and itrocket as its first fallback: both
served the historical finalization results required for unbond completion
during the 2026-09-27 rollout. Publicnode remains a recent-history fallback.
Monad validator reads are paced in four-item batches; BNB's four-read validator
lookups are also bounded. Concurrent refreshes for one chain share a fetch so
they do not multiply RPC load or starve settlement watchers.
BNB MainNet now includes PublicNode and dRPC backups rather than relying on
official public dataseeds, whose [`eth_getLogs` is disabled](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/).
On 2026-10-08, both alternatives answered chain 56/head probes; PublicNode also
answered a 2,001-block historical StakeHub log query. dRPC rate-limited the log
probe: it is redundancy, not a guaranteed healthy watcher source. Explicit
`RPC_FALLBACK_URLS.bnb` settings override these defaults and need separate review.
**Sui GraphQL and the Aptos testnet indexer require operator-supplied compatible
backups**; they deliberately report no redundancy until configured. Do not use
another network, obsolete Sui JSON-RPC, or a dead legacy alias as a backup.

Endpoint references: [Monad networks](https://docs.monad.xyz/developer-essentials/network-information),
[Cosmos Hub provider testnet](https://www.polkachu.com/testnets/cosmos),
[Celestia Mocha](https://docs.celestia.org/operate/networks/mocha-testnet/),
[Cosmos chain registry](https://github.com/cosmos/chain-registry),
[Aptos networks](https://aptos.dev/network/nodes/networks),
[Solana clusters](https://solana.com/docs/references/clusters),
[Polkadot.js endpoints](https://github.com/polkadot-js/apps/tree/master/packages/apps-config/src/endpoints),
[Sui providers](https://docs.sui.io/develop/accessing-data/rpc-providers).
Public endpoints carry no production SLA; configure independent providers for
production and verify their historical-state retention and method support.

### VPS via Docker Compose

Production uses the existing `cantonstake` Compose project and `.env`; testnet
uses a separate project and `.env.testnet`. Keep both databases and their named
volumes intact. This is still a hackathon MVP, not a claim that every staking
route is safe for public mainnet use: leave unverified chains and automation
disabled.

```bash
ssh root@your-vps
cd /path/to/existing/cantonstake
# Use the checked production workflow below. It pins images to the release
# commit, checks network settings, backs up PostgreSQL before migrations,
# and checks backend, frontend and Canton readiness after restarting.
# Do not use `down -v` or prune the previous release's rollback images.
```

### Frontend → Vercel

```bash
cd frontend
vercel link
vercel env pull .env.local
vercel --prod
```

### Backend → Fly.io

```bash
cd backend
fly launch --no-deploy --copy-config
fly secrets set \
  CANTON_APP_PROVIDER_PARTY=... CANTON_DELEGATOR_PARTY=... \
  AMOY_RPC_URL=... \
  DATABASE_URL=postgresql://... REDIS_URL=rediss://... \
  ANTHROPIC_API_KEY=... TELEGRAM_BOT_TOKEN=... RESEND_API_KEY=... \
  AUTO_COMPOUND_KEEPER_KEY=0x... SENTRY_DSN=https://... \
  -a cantonstake-backend
fly deploy --remote-only
```

### CI → GitHub Actions (GHCR + SSH)

```bash
# Workflow: .github/workflows/deploy.yml
# Push to main → builds + pushes to ghcr.io/<owner>/cantonstake-{frontend,backend}
# → deploys the commit-tagged images to the existing production project.
# Configure secrets: SSH_HOST, SSH_USER, SSH_PRIVATE_KEY, DEPLOY_PATH,
# NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID; optional SSH_PORT (default 22).
# Required repository variables:
#   NEXT_PUBLIC_NETWORK_MODE=mainnet
#   NEXT_PUBLIC_LOOP_NETWORK=mainnet
#   NEXT_PUBLIC_BACKEND_URL=<same public API URL as production .env>
# Set NEXT_PUBLIC_ENABLED_CHAINS to the existing enabled chain list (default
# polygon); both sides must match. Mirror custom NEXT_PUBLIC_* contract
# settings into repository vars. Provider URLs/backups remain server-only.
# The VPS requires Docker Compose, jq, the current docker-compose.yml, its
# existing .env, and already-running PostgreSQL/Redis services. Authenticate
# Docker to GHCR on the VPS if the packages are private.
git push origin main
```

The workflow stops before building if required configuration is missing, and
before restarting if the server's mode, API URL or enabled chains disagree.
Database dumps are retained with restricted permissions in `.deploy-backups/`;
keep that directory out of version control and apply an operator-managed
retention policy. A failed post-deploy check does **not** automatically undo
database migrations: inspect the failure and migration compatibility before
selecting previous image tags or restoring a backup. The workflow does not
update the testnet stack, configure Canton MainNet access, or enable additional
staking routes.

---

<div align="center">

**Stake any chain. Earn on Canton.** — Self-custody by construction.

</div>
## Canton TestNet cutover gate (2026-10-04)

The remote TestNet application parties and service users have been confirmed by
read-only API checks. CantonStake `0.0.2` and all 33 bundled packages are currently
vetted for the supplied participant/synchronizer. This is provisioning evidence,
not proof that the production application has been switched to that participant.

Run the scoped, read-only check from `backend/`:

```bash
node_modules/.bin/tsx scripts/check-canton-testnet.ts
```

It does not load production `.env`, submit commands, upload packages, change
rights, or transfer CC. A dedicated TestNet bearer token may be provided through
`CANTON_TESTNET_LEDGER_TOKEN` when authenticated access has been provisioned;
never supply it as a command argument. If several matching splits exist, select
the operator-confirmed active CID through `CANTON_TESTNET_BENEFICIARY_SPLIT_CID`.
The report deliberately keeps `cutoverReady: false`: read-only provisioning
checks cannot establish a safe, end-to-end production cutover.

Remaining deployment gates:

- The operator applied an API allowlist on 2026-10-04: app server
  `169.58.171.187` and node `149.50.116.129`, with other sources denied.
  App-host ledger access was verified HTTP 200; denial from an untrusted host
  was reported by the operator. Direct upstream ports still require protection.
  IP protection does not make Ledger service users authentication boundaries;
  authenticated access is required before funded/MainNet-grade operation.
- Keep `CANTON_WRITE_ACCESS_PROTECTED=false` until that protection is independently
  verified. Setting it to `true` only acknowledges external access controls;
  **the flag does not secure the node**. Runtime configuration is unchanged.
- Only one matching active 75/25 split remained at the 2026-10-04 01:50 UTC
  recheck. The app did not archive either contract. Revalidate before cutover.
- Preserve existing LocalNet-tracked positions, exit flows and liquid-balance
  records during cutover. Do not replace their party/contract identifiers blindly.
- The operator confirmed participant-signed hosted service identities on the
  node, but these are **not an end-user Loop wallet**. The app integration must
  use real Loop TestNet accounts. The staged hosted-account provider and its
  capability endpoint have been removed; no hosted-wallet fallback is offered.
- An earlier hosted-service TestNet create/observe/cancel check passed, with verified cleanup and
  unchanged staking positions. No EVM transactions, token transfers or stake
  accepts were performed. This is historical provisioning evidence, **not Loop
  integration validation**. Its receipt is retained:
  `.deploy-backups/canton-testnet-workflow/1791078894862-24afd4a6-e5d9-47bf-af6a-2fff2679fd42.json`.
  That hosted-service test helper and the newly added mock Loop-wallet tests
  have been removed. Do not create substitute wallet/test environments to
  validate the Loop workflow. Static checks do not establish live integration.
- Full Loop signing requires Five North review/deployment of the exact custom
  package on the participant hosting Loop users. Native-wallet linking,
  independent backend adoption of Loop-signed requests, preservation of legacy
  positions, and a real Loop TestNet lifecycle remain unverified. No production
  cutover or actual CC transfers have been performed. Database allocations are
  not CC payments.

The 3.5 node requires package-name identifiers in ACS filters. Commands select
the validated package through `packageIdSelectionPreference`; do not replace
the filter's `#cantonstake` identifier with a package hash. See
[Digital Asset's package-preference documentation](https://docs.digitalasset.com/build/3.5/tutorials/app-dev/external_signing_submission.html).

### Staged real TestNet reward observation

`POST /api/loop/rewards/entitlements` uses the actual connected Loop TestNet
session, verifies its party through Loop, and reads the configured primary
provider's reward-assignment interface at an explicit ledger offset. It does
not fall back to the hosted delegator or mix legacy LocalNet allocation records.
The compact section inside Rewards → How rewards work shows exact decimal
minting entitlements separately from recorded allocations, balances and payouts.

The observer verifies the reviewed interface, TestNet synchronizer, DSO
signatory, implementing template, provider/beneficiary, decimal precision and
expiry. Missing or failed interface views are unavailable, not zero. Visibility
is limited to provider-visible active coupons; an archived coupon does not prove
minting, and an empty snapshot does not establish zero lifetime earnings.

Run the real read-only node diagnostic from the application host:

```bash
cd backend
node_modules/.bin/tsx scripts/check-canton-rewards-readonly.ts
```

It does not load production environment files, generate wallets, submit commands,
assign coupons, claim rewards or transfer funds. Package vetting is paginated
to completion within a fixed bound; incomplete inventory fails the check.
At **2026-10-04 14:05 UTC**, the actual node returned ledger offset `2137797`:
the reviewed reward-assignment interface `1.0.0` was installed/vetted, five
`splice-amulet` versions (`0.1.19` through `0.1.23`) were vetted, and the app
provider had **no active FeaturedAppRight and no visible reward coupons**.
The empty query passed; positive coupon-view decoding, real Loop authorization,
assignment, minting and settlement were **not** verified by this diagnostic.

The [reward-assignment API](https://docs.sync.global/app_dev/api/splice-api-reward-assignment-v1/Splice-Api-RewardAssignmentV1.html)
lets providers divide unassigned minting rights among beneficiaries. Assignment
is not payment; real Loop beneficiary collection still needs verification.
[CIP-0104](https://github.com/canton-foundation/cips/blob/main/cip-0104/cip-0104.md)
specifies featured-only traffic-based rewards in its proposed implementation.
Do not promise an unfeatured per-round payout or create arbitrary `AppActivity`
contracts to manufacture eligibility. Installed packages alone do not establish
network activation, actual coupon issuance or live economic parameters.

Remaining gates are the exact package's approval on Loop's hosting participant,
a genuine Loop wallet lifecycle, applicable provider reward eligibility, an
agreed allocation policy across unlike native assets, and verified beneficiary
collection/payment evidence. Production configuration and deployments remain
unchanged; CC payments stay disabled.

Follow-up at **2026-10-04 14:14 UTC** also verified that `splice-wallet`
versions `0.1.20`–`0.1.24` are installed/vetted. This is package evidence, not
working minting automation. The diagnostic optionally accepts the **public**
party ID from the real Loop TestNet wallet through
`CANTON_TESTNET_LOOP_PARTY_ID` and reads whether that party is locally hosted;
without it, hosting is explicitly unknown. No hosted service identity is used
as a default. The [documented minting-delegation automation](https://docs.sync.global/validator_operator/validator_delegations.html)
requires beneficiary hosting on the delegate's validator and explicit user
authorization. Do not assume our hosted provider can collect for a user hosted
only on Loop's validator, or grant it the user's `actAs` rights as a shortcut.

The real SDK wrapper now validates party **and public key** through Loop's
account API before displaying a new/restored connection. Reads are bounded;
disconnect clears app authorization and the loaded SDK synchronously. Generation
guards prevent delayed verification or SDK loading from restoring a disconnected
session or clearing a newer account. These are staged source changes: live
connection/signing race checks still require a real Loop wallet, and static
checks are not a substitute.

### Staged real Loop TestNet request handoff

The native request path (direct Polygon validator staking, Monad, BNB,
Cosmos Hub, Celestia, Osmosis, Sui, Solana, Aptos and Polkadot) now has
`/api/loop/staking/prepare`, `/authorize`, and `/adopt` endpoints. They verify the
actual Loop TestNet bearer session, require a native-wallet signature over a
random expiring intent, and independently observe the exact Canton contract
before associating it with the user and validator. Existing wallet associations
are not silently reassigned. No mock wallet is used for integration verification.

Association is now append-only per request: the native consent explicitly binds
that wallet to the connected Loop party for one intent, then the independently
observed contract is mirrored in `StakingIntent`. A wallet already used by a
legacy party can create a new request under its Loop party without changing the
old user's primary wallet, moving positions, or transferring reward entitlement.
An existing Loop party may likewise use another explicitly verified native
wallet. Rewards summary/history, rounds, analytics, narrator and export queries
follow each position's native address, not the party's primary wallet field.
Unknown-wallet analytics stays empty/account-scoped rather than falling back to
global totals. Adoption refuses requests with an already recorded native stake
hash even while Canton acceptance is still being processed. No database schema
or production data migration is needed. These paths still require real Loop
wallet verification before activation; static checks do not prove it.

`NEXT_PUBLIC_LOOP_STAKING_FLOW=external` selects that client path. Backend
`LOOP_STAKING_ENABLED=false` remains the default; exact-package review through
`LOOP_REVIEWED_PACKAGE_ID` and the protected remote TestNet configuration are
required before it can run. The readiness response exposes any blocking reason.
These settings are provided in the TestNet example only; running deployments
were not changed. The separate Amoy liquid route is not replaced by this path.

The positions panel now recovers pending requests from the provider's ledger
view, including unadopted requests after the Redis nonce expires. Cancellation
is signed in Loop and independently checked against the archive's consuming
choice; absence from the active-contract list is not cancellation proof.
Unconfirmed attempts remain available for read-only reconciliation after reload.
Unbonding now asks Loop to approve the delegator-controlled intent before the
native EVM transaction. The provider must observe the exact ledger exercise;
uncertain submissions block native broadcast. Receipt references and native
broadcast retry guards are local metadata, never authentication or ledger proof.
The external watcher rejects unadopted requests instead of guessing Polygon.

Receipt recovery now checks an existing Loop update ID or native EVM hash without
submitting another transaction. A proved revert of the exact recorded native
hash can clear its guard; arbitrary hashes and unknown original broadcasts cannot.

Optional `CANTON_LEGACY_*` settings preserve the existing LocalNet during the
remote TestNet cutover. Reads retain source tags; lifecycle writes resolve the
contract's original participant/package instead of copying contracts or identities.
The separate Amoy LiquidBalance registry retains its original ledger/operator.
Only old positions retain their original native-wallet-controlled exit flow;
new staking requests cannot fall back to hosted signing. Readiness and request
preparation block new creates if active database positions disappear from the
configured ledger view. `backend/scripts/check-canton-cutover.ts` verifies actual
read coverage without submitting commands; proof-driven write routing remains untested.

Still pending: actual Loop custom-DAR deployment approval, real wallet validation,
operator recovery when original receipt IDs are unknown,
live verification of preserved exits and append-only wallet association,
and real per-user CC settlement.
The staged external mode disables inherited LocalNet CC marker/allocation paths.
TypeScript/static checks are not end-to-end wallet or payout proof.

### Staged Polkadot Loop workflow

The actual selected extension signs the expiring native consent through
[`signRaw`](https://polkadot.js.org/docs/extension/cookbook/), with backend
verification against the exact canonical Westend SS58 account. Only standard
Ed25519/Sr25519 accounts are accepted; no substitute signer, generated wallet,
ECDSA/multisig bypass or hosted Loop fallback is offered. Consent binds the
Westend Asset Hub genesis, nomination pool, amount, connected Loop party and
reviewed Canton deployment. Extension source, permission and current account
are checked around signing; account removal/revocation disconnects the UI.

External native extrinsics use the real extension's `signPayload` separately
from broadcast. The unchanged call, account, genesis and native signature are
checked. Unbond saves the real signed-extrinsic hash before dispatch; missing
browser storage blocks dispatch, and an uncertain response retains the guard.
The provider must independently observe the exact Loop unbond approval first.
Mainnet/legacy signing retains its original extension submission path.

Read-only receipt recovery also takes the finalized native block hash because
Substrate's RPC has no generic transaction-by-hash lookup. That value is only a
lookup hint: recovery checks the canonical finalized block, exact SCALE hash,
parent execution metadata, direct wallet-signed unbond call, exact pool/member
points, dispatch result, pallet event and full historical unbond state. Partial
unbonds, batches/proxies, unavailable historical state and unverified receipts
cannot clear a guard. Same-block membership changes that cannot be established
from the parent/block-end snapshots fail closed. Only a proved failure of the
exact saved native attempt permits retry. Known finalized block hashes are
saved for recovery; ambiguous broadcasts require the wallet/explorer reference.
Finality polling hashes raw extrinsic bytes rather than trying to decode every
unrelated v5 transaction through a v4 `SignedBlock` type.

At 2026-10-04 13:41 UTC, `backend/scripts/check-polkadot-loop-readonly.ts` verified
the actual checked Westend genesis, nomination-pool runtime and finalized
metadata over 64 real blocks. The window contained no signed extrinsics or
full-unbond calls, so native-signature reconstruction, personal wallet consent
and position-bound receipt recovery remain unverified. Submission is classified
as a write and is not automatically replayed; no transaction was sent. Both
TypeScript checks and 18 existing relevant unit tests passed. No mock wallet,
listening server or replacement Loop environment was created. Production
configuration, deployment, Canton commands and CC transfers were not changed.

### Staged Aptos Loop workflow

The connected Aptos wallet signs real ownership consent using the wallet
standard's [message-signing flow](https://petra.app/docs/signing-a-message).
Only standard Ed25519 accounts are supported here; keyless, multisig, account
abstraction and other schemes remain unverified. The backend reconstructs the
exact accepted wrapper and deterministic consent nonce, verifies Ed25519, checks
TestNet chain ID 2 and compares the derived key against the current on-chain
`authentication_key`. It does not equate an original address with a rotated key.
The expiring consent itself binds the wallet, validator, amount, Loop party,
native network and reviewed Canton deployment. No signature/key is newly persisted.

External native transactions build through the checked RPC, sign separately,
verify unchanged raw bytes and the actual sender authenticator, then recheck
the connected wallet/network/current authentication key. Unstake saves the real
SDK-derived signed-transaction hash before broadcast; missing browser storage
prevents broadcast and an uncertain response retains the guard. Loop approval
must already be independently observed before unlocking a position.

The RPC plugin now parses only the Aptos signed-transaction/view BCS media types,
limits them to their exact Aptos routes and forwards the original bytes. The
real SDK's binary submission is classified as a write and never automatically
replayed after dispatch. Other application endpoints remain JSON. Legacy/mainnet
wallet signing keeps its original path.

Read-only unlock recovery checks the exact committed hash, wallet, delegation
pool, later ledger version and native unlock entry function. Successful receipts
must also prove the full wallet/pool unlock at that historical version; current
balances and partial external unlocks cannot substitute. Missing/pruned state
or unavailable RPCs retain the guard. Only a proved failure of the exact saved
attempt permits retry. The existing proof-driven watcher confirms unbonding and
release; this change does not enable CC claims or payments.

At 2026-10-04 13:27 UTC, `backend/scripts/check-aptos-loop-readonly.ts` verified an
actual public TestNet unlock's native signature and SDK-derived transaction hash,
matched authentication-key derivation with the SDK/current public account,
rejected that signature as personal consent, read its complete historical unlock
and successfully forwarded a genuine read-only BCS view through the staged pool
client to a verified upstream. No prior AddStake receipt was indexed for that
operator's commission unlock, so position-bound recovery remains unverified.
No wallet, listening server, simulation or transaction submission was created.
Both TypeScript checks and 35 existing Aptos/readiness/RPC tests passed. This is
protocol evidence, not live Loop signing, a CantonStake round trip or payout proof;
the BCS HTTP route and signed submission still need deployment/live verification.
Production configuration and deployments were not changed.

### Staged Solana Loop workflow

Solana's real connected wallet signs the exact UTF-8 ownership consent; the
backend verifies its canonical 64-byte Ed25519 signature against the actual
case-sensitive public key. Consent binds TestNet's genesis hash, vote account,
amount, fresh stake account and RPC-checked rent. Those account/rent values are
retained during Loop adoption in the existing `StakingIntent` fields and checked
again before native staking. No default wallet, substitute user signer or mock
environment was added. The existing ephemeral stake-account key is used only
for the real native account-creation transaction, not as the user's wallet.

External unstaking requires Loop approval independently observed by the provider,
plus the original verified stake account and bond slot. The native wallet signs
separately from broadcast; unchanged message bytes and actual signatures are
checked, the current wallet/network is rechecked, and the signature is saved
before broadcast. Read-only recovery accepts only the exact legacy, single-signer,
single-instruction deactivation emitted by this flow. It verifies raw transaction
bytes/signature, wallet, authority, stake account and a later finalized slot using
[Solana signature statuses](https://solana.com/docs/rpc/http/getsignaturestatuses)
and [transaction receipts](https://solana.com/docs/rpc/http/gettransaction).
Only a finalized failure of the exact saved attempt permits retry; missing or
expired receipts, unknown signatures and RPC outages retain the guard.

At 2026-10-04 12:03 UTC, `backend/scripts/check-solana-loop-readonly.ts` read an
actual public deactivation and its prior delegation, verified the real native
signature and rejected its use as personal consent. It correctly rejected that
durable-nonce/multi-instruction transaction as retry-recovery proof. The bounded
inventory found no matching single-instruction deactivation, so positive recovery
and real wallet signing remain unverified. Both TypeScript checks and 13 existing
Solana/readiness unit tests passed; these are not Loop round-trip evidence.
Production configuration, deployments and CC settlement were not changed.

### Staged Sui Loop workflow

Sui uses the real dapp-kit wallet's personal-message signature for the expiring
native ownership consent, followed by the same Loop-signed Canton request and
independent provider observation. The backend checks the Sui personal-message
intent, exact wallet address and consent, including TestNet's genesis identifier.
Only standard single-key Ed25519/secp256k1/secp256r1 accounts are supported;
zkLogin, passkeys and multisig are not silently accepted. Signatures remain
transient; no mock wallet or substitute hosted signer was added.

Unstaking requires a reviewed primary position with a verified StakedSui object,
pool and original bond checkpoint. Loop approves the existing unbond choice;
the provider independently checks the ledger-effects receipt before any native
withdrawal. The provider is the StakingPosition signatory, which is entitled to
see non-consuming exercises under [Daml's choice visibility rules](https://docs.digitalasset.com/build/3.4/reference/daml/choices.html).
This does not require changing the DAR or adding a synthetic reward marker.
Actual Loop-to-provider observation still requires live wallet verification.

The external Sui exit builds through the verified network, signs separately,
checks unchanged transaction bytes and the real native signature, then saves
the actual case-sensitive digest before broadcast. Storage failure prevents
broadcast; a lost response retains the retry guard. Read-only reconciliation
checks the original raw transaction bytes/digest, sender, single withdrawal
call, exact system/receipt objects and a later checkpoint. Only a proved failure
of the exact saved digest may clear a known-attempt guard; unknown broadcasts
and missing receipts never authorize a retry. Legacy/mainnet signing stays on
its original SDK path. The existing watcher performs native-proof-driven
ConfirmUnbond/Release; this change does not enable CC settlement.

At 2026-10-04 11:42 UTC, `backend/scripts/check-sui-loop-readonly.ts` read an
actual public TestNet unstake and its historical StakedSui object, verified the
raw digest and native transaction signature, rejected that transaction signature
as personal consent, and rejected a different receipt object. No wallet was
generated and no transaction was submitted. This checks real receipt decoding,
not a CantonStake stake, Loop round trip, live personal-consent flow or payout.
Production settings were not changed.

### Staged Cosmos-family Loop workflow

Cosmos Hub `provider`, Celestia `mocha-5` and Osmosis `osmo-test-5` now use the
same real Loop prepare/authorize/adopt path. Keplr/Leap signs an off-chain
ADR-36 consent before the Loop contract create. The backend reconstructs the
sign document, derives the bech32 address from the compressed public key and
verifies the signature over the exact intent. Because ADR-36's `chain_id` is
empty, the consent also explicitly names the native TestNet network, validator,
amount, nonce, expiry, Loop party and Canton deployment. No native wallet keys
or ownership signatures are newly persisted. Cosmos multisig/other key types
and smart EVM accounts remain unsupported.

Native unbond waits for an independently observed Loop approval. The staged
Cosmos signer rechecks the live wallet/RPC, checks the signed staking message,
and records its genuine signed-byte hash before broadcasting. A signing
rejection creates no broadcast guard; an uncertain broadcast retains the hash
for recovery. MainNet/legacy Cosmos calls retain the original CosmJS
`signAndBroadcast` path. Recovery is authenticated and read-only through
`/api/loop/staking/unbond/native-observe`: it checks the native network, raw tx
hash, wallet, validator, micro-denomination, exact amount and block after the
on-ledger native bond. A missing/pruned receipt is not permission to retry.

The RPC pool now distinguishes CometBFT's exact transaction-not-found response
from provider outages for transaction reads only. Writes and other internal
errors retain their existing failover/no-replay rules. At 2026-10-04 11:03 UTC,
the compiled classifier was checked against a real public TestNet response with
zero writes. A real indexed Cosmos undelegation was also read through the live
gateway; its JSON-RPC hash encoding is base64, not GET-route hex. These are
protocol/read-path checks, **not Loop wallet, native round-trip or payout proof**.
Backend build and frontend typecheck pass. Runtime configuration is unchanged;
exact-package review, genuine Loop/Keplr signing and funded lifecycle verification
are still required before activating this path.
