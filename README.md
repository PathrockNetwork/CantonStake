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

### Self-custodial by construction
Native staking and exit transactions are signed by the user's wallet. CantonStake's backend observes verified chain events and records the corresponding Daml lifecycle through its app-provider party. The experimental auto-compound keeper is disabled; its permit storage is not yet a verified authorization boundary.

### Canton Coin reward rounds
A BullMQ scheduler ticks every 10 minutes, ingests CIP-0104 `AppActivityRecord` entries from the SV Scan API, and distributes CC across active bonded positions pro-rata bonded stake. Idempotent on `(roundNumber, party, eventId)` so re-polling never double-credits.

Parties and traffic weights are read live from the Scan API. The Scan publishes no per-round mint pool, so the **gross CC per round is a configured constant** (`SCAN_ROUND_CC_POOL`) rather than a network-sourced figure — labelled as such rather than presented as live.

### On-ledger 75/25 beneficiary split
The `BeneficiarySplit` Daml template enforces `sum(weights) == 1.0` and routes CC to the delegator's Loop party and the app treasury at distribution time. Operator can rotate weights via `Split_Update`, which emits a `BeneficiarySplitUpdated` audit beacon.

### Validator quality scoring
Backend service polls each chain's validator source on a 1-hour cron, normalises into a `ScoredValidator` shape, and caches by network mode in Redis. Cosmos Hub, Celestia, and Osmosis validators are read from a chain-ID-verified RPC across all pages; the Cosmos live yield estimate uses that same verified RPC. Composite score combines uptime, commission, slash history, and stake concentration, but uptime and slash history remain unmeasured estimates on chains that do not expose them. The scores drive the staking picker.

### Auto-compound keeper
**Experimental and unavailable.** `/api/autocompound/status` reports deployment availability independently of saved permits. `AUTO_COMPOUND_DISABLED=true` disables execution; setting it to `false` still cannot activate a route that has not completed authorization and lifecycle validation. No routes have passed that gate yet. New permit creation, scheduled jobs, and manual triggers are blocked, including previously queued jobs. Existing permits and run history remain readable, and saved permits can still be revoked. Settings shows the backend status without presenting stored permits as running automation. Verified per-chain authorization and funded-wallet testing are required before a route can be enabled.

### Slashing & reward alerts
Slashing monitor diffs validator scores hourly and emits `validator.score_drop` / `validator.jailed` events. Notifications router fans out to Telegram, Resend (email), and Discord webhooks per the user's configured channels — soft-deletable, audit-logged, idempotent on `(alertId, channelId)`.

### Tax CSV export
`/api/tax/csv?format=koinly` returns a downloadable CSV of every reward event and native sweep keyed to the user's EVM address, in Koinly's import format.

### Live narrator
The `/rewards` page surfaces an Anthropic-powered live commentary on the current round, contextualised with the user's lifetime CC, latest round share, and milestone crossings (10/100/1000 CC). Falls back to a templated explainer when no API key is set.

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
│   │   ├── rewards/                   # CC rewards + narrator
│   │   ├── analytics/                 # Marker history + insights
│   │   ├── settings/                  # Auto-compound permits + alert channels
│   │   └── providers.tsx              # Wagmi + dapp-kit + Sui + WalletPicker
│   ├── components/
│   │   ├── chrome/                    # TopNav, PriceTape, CCRoundTicker, SystemStatus
│   │   ├── diagrams/                  # LifecycleDiagram, BeneficiaryPipeline, RoundVisualizer
│   │   ├── primitives/                # Banner, Btn, Card, Chip, EmptyState
│   │   ├── trace/                     # Live trace pubsub
│   │   ├── WalletPickerModal.tsx      # Loop + EVM + Cosmos + Sui in one modal
│   │   └── WalletPickerProvider.tsx   # Global picker context
│   ├── lib/
│   │   ├── api.ts                     # Typed backend client
│   │   ├── chains.ts                  # Chain catalog + chainFromAddress heuristic
│   │   ├── chains/                    # Per-chain IChainAdapter implementations
│   │   ├── canton/                    # Loop SDK + mock providers
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
│   │       ├── nativeSweep.ts         # MockValidatorShare reward sweep
│   │       ├── narrator.ts            # Anthropic-powered round commentary
│   │       └── observability.ts       # Prometheus + Sentry
│   ├── prisma/schema.prisma           # User, StakingPosition, RewardRound, etc.
│   ├── Dockerfile                     # Multi-stage with prod-deps prune
│   └── .env.example
├── daml/CantonStake/                  # Daml templates
│   └── daml/CantonStake/
│       ├── Staking.daml               # StakingRequest, StakingPosition, BeneficiarySplit
│       └── Setup.daml
├── evm/                               # Hardhat / MockValidatorShare
│   ├── contracts/MockValidatorShare.sol
│   └── scripts/                       # deploy, fund, verify
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
