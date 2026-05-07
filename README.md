<div align="center">

# CantonStake

**Stake any chain. Earn on Canton.**

Self-custodial multi-chain staking dApp built on Canton Network. Stake POL, GLMR, MON, ATOM, or SUI from your own wallet and earn Canton Coin (CC) rewards on top of native validator yield, distributed every 10-minute round via an on-ledger 75/25 beneficiary split.

![Canton Network](https://img.shields.io/badge/Canton-Network-00ff9d?style=flat-square)
![Daml](https://img.shields.io/badge/Daml-3.5-7c4dff?style=flat-square&logo=daml)
![Next.js](https://img.shields.io/badge/Next.js-14-000?style=flat-square&logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-202020?style=flat-square&logo=fastify)
![Prisma](https://img.shields.io/badge/Prisma-5-2d3748?style=flat-square&logo=prisma&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-MockValidatorShare-363636?style=flat-square&logo=solidity)
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

CantonStake unifies multi-chain staking into one self-custodial flow on Canton Network. Each chain adapter bonds your tokens through your own wallet — Wagmi for EVM chains, Keplr for Cosmos, Mysten dapp-kit for Sui — while the Canton ledger records the canonical lifecycle and routes Canton Coin rewards through an on-ledger beneficiary split contract every 10-minute round.

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
Five testnet chain adapters wired end-to-end: Polygon Amoy, Moonbase Alpha, Monad Testnet, Cosmos Hub theta-testnet, and Sui Testnet. Each routes through its native wallet primitive (Wagmi for EVM, Keplr/Leap for Cosmos, Mysten dapp-kit for Sui).

### Self-custodial by construction
Keys never leave the user's wallet. CantonStake's backend orchestrator only observes chain events and exercises Daml choices on the user's behalf within the scope they signed for. The auto-compound keeper holds its own EVM signing key only to broadcast pre-authorised compound transactions.

### Canton Coin reward rounds
A BullMQ scheduler ticks every 10 minutes, ingests CIP-0104 `AppActivityRecord` entries from the SV Scan API, and distributes CC across active bonded positions. Idempotent on `(roundNumber, party, eventId)` so re-polling never double-credits.

### On-ledger 75/25 beneficiary split
The `BeneficiarySplit` Daml template enforces `sum(weights) == 1.0` and routes CC to the delegator's Loop party and the app treasury at distribution time. Operator can rotate weights via `Split_Update`, which emits a `BeneficiarySplitUpdated` audit beacon.

### Validator quality scoring
Backend service polls each chain's public validator API on a 1-hour cron, normalises into a `ScoredValidator` shape, and caches in Redis. Composite score combines uptime, commission, slash history, and stake concentration. Drives the validator picker UI on the staking flow.

### Auto-compound keeper
Per-chain executors broadcast claim+restake on the user's behalf within their signed permit's scope and expiry. Polygon uses EIP-712, Cosmos uses MsgGrant Authz, Moonbeam uses parachain-staking precompile bonds, Monad uses its staking precompile's `compound()`, and Sui re-stakes via `request_add_stake`.

### Slashing & reward alerts
Slashing monitor diffs validator scores hourly and emits `validator.score_drop` / `validator.jailed` events. Notifications router fans out to Telegram, Resend (email), and Discord webhooks per the user's configured channels — soft-deletable, audit-logged, idempotent on `(alertId, channelId)`.

### Tax CSV export
`/api/tax/csv?format=koinly` returns a downloadable CSV of every reward event and native sweep keyed to the user's EVM address, in Koinly's import format.

### Live narrator
The `/rewards` page surfaces an Anthropic-powered live commentary on the current round, contextualised with the user's lifetime CC, latest round share, and milestone crossings (10/100/1000 CC). Falls back to a templated explainer when no API key is set.

### Cross-chain portfolio view
`/portfolio` aggregates delegations across all five adapters into one table, with bonded/unbonding counts, USD totals, and per-row source tags (`live` / `cache` / `stub`). Refreshes every 30 seconds.

### Loop wallet integration
Browser flow via `@fivenorth/loop-sdk` for Canton party identity. Bypasses Loop devnet's CORS allowlist via a Fastify reverse proxy at `/loop-proxy/*` so dev origins work without fivenorth-side allowlisting.

### Multi-wallet picker
A single modal connects Loop, MetaMask/Rabby/Brave/Frame (injected), Coinbase Wallet, Safe, WalletConnect, Keplr, and any Sui wallet via dapp-kit. Top-nav chips trigger the picker globally via React context.

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
        MOON[Moonbase Alpha]
        MON[Monad Testnet]
        COS[Cosmos theta-testnet]
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
| Auto-compound keeper | Bounded | EIP-712 signature scope + `expiresAt` + `maxPerRun` enforced before broadcast |
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
    participant Proxy as Backend /loop-proxy
    participant LoopApi as devnet.cantonloop.com
    participant LMobile as Loop Mobile Wallet
    participant BE as Backend API

    User->>FE: Click Connect Loop
    FE->>Proxy: POST /api/v1/.connect/pair/tickets (origin stripped)
    Proxy->>LoopApi: same request, server-to-server
    LoopApi-->>Proxy: { ticket_id }
    Proxy-->>FE: { ticket_id }
    FE->>FE: Open WS wss://.../loop-proxy/api/v1/.connect/pair/ws/{tid}
    FE->>User: Show QR code
    User->>LMobile: Scan QR
    LMobile->>LoopApi: handshake_accept
    LoopApi->>Proxy: WS message
    Proxy-->>FE: WS message
    FE->>FE: localStorage persists partyId
    FE->>BE: POST /api/users (cantonPartyId, evmAddress)
```

---

## Quick Start

**Prerequisites**

- Node.js 20+
- Docker + Docker Compose
- Canton CN Quickstart LocalNet (for local Canton ledger) — or remote DevNet credentials
- Testnet tokens for whichever chain(s) you want to demo (faucet links below)

### Automated Setup

```bash
git clone https://github.com/your-org/cantonstake.git
cd cantonstake

cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Fill in: MOCK_VALIDATOR_SHARE_ADDRESS, CANTON_APP_PROVIDER_PARTY,
# CANTON_DELEGATOR_PARTY, NEXT_PUBLIC_BACKEND_URL, NEXT_PUBLIC_MOCK_VALIDATOR_SHARE.

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

2. **Deploy the MockValidatorShare** to Polygon Amoy:

```bash
cd evm
npm install
npm run deploy:amoy
# Copy the deployed address into backend/.env (MOCK_VALIDATOR_SHARE_ADDRESS)
# and frontend/.env (NEXT_PUBLIC_MOCK_VALIDATOR_SHARE).
```

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
- **Moonbase Alpha** — https://faucet.moonbeam.network/
- **Monad Testnet** — https://faucet.monad.xyz/
- **Cosmos theta-testnet** — `#testnet-faucet` channel on the Cosmos Discord
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
| POST | `/api/requests/force-accept` | Demo-mode-gated: progress non-Polygon stake to Bonded | DEMO_MODE |
| GET | `/api/positions` | List active StakingPositions, filter by `?address=` | none |

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
| POST | `/api/validators/scores/:chain/refresh` | Force re-fetch | DEMO_MODE / debug |

### Auto-Compound

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/autocompound/permits` | Create permit (chain, validator, sig, expiry) | none |
| GET | `/api/autocompound/permits` | List permits for `?userId=` | none |
| DELETE | `/api/autocompound/permits/:id` | Soft-disable permit | none |
| GET | `/api/autocompound/permits/:id/runs` | Run history (last 50) | none |
| POST | `/api/autocompound/trigger` | Manual tick | DEMO_MODE / debug |

### Notifications

| Method | Path | Description | Auth |
|---|---|---|---|
| POST | `/api/notifications/channels` | Upsert (kind, target, label) | none |
| GET | `/api/notifications/channels` | List channels for `?userId=` | none |
| DELETE | `/api/notifications/channels/:id` | Soft-disable channel | none |
| POST | `/api/notifications/test` | Emit a test alert | DEMO_MODE / debug |

### Loop SDK Proxy

| Method | Path | Description | Auth |
|---|---|---|---|
| ANY | `/loop-proxy/*` | HTTP + WS reverse proxy to `LOOP_API_UPSTREAM` | none |

---

## Environment Variables

### Backend — `backend/.env`

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `4000` |
| `LOG_LEVEL` | Pino log level | `info` |
| `DEMO_MODE` | Enables demo-only routes | `false` |
| `MOCK_REWARDS` | Use seeded record stream instead of Scan API | `false` |
| `MOCK_REWARDS_SEED` | Deterministic seed for round generation | `20260505` |
| `AMOY_RPC_URL` | Polygon Amoy JSON-RPC | `https://rpc-amoy.polygon.technology` |
| `MOCK_VALIDATOR_SHARE_ADDRESS` | Deployed mock contract address | required |
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
| `MOONBEAM_RPC_URL` | Moonbase Alpha RPC | `https://rpc.api.moonbase.moonbeam.network` |
| `MONAD_RPC_URL` | Monad Testnet RPC | `https://testnet-rpc.monad.xyz` |
| `COSMOS_REST_URL` | theta-testnet REST | `https://rest.sentry-01.theta-testnet.polypore.xyz` |
| `COSMOS_RPC_URL` | theta-testnet RPC | `https://rpc.sentry-01.theta-testnet.polypore.xyz` |
| `COSMOS_KEEPER_MNEMONIC` | Cosmos auto-compound keeper mnemonic | empty |
| `SUI_RPC_URL` | Sui Testnet RPC | `https://fullnode.testnet.sui.io:443` |
| `SUI_KEEPER_PRIVATE_KEY` | Sui keeper private key | empty |
| `LOOP_PROXY_ENABLED` | Enable `/loop-proxy/*` reverse proxy | `true` |
| `LOOP_API_UPSTREAM` | Upstream URL the proxy forwards to | `https://devnet.cantonloop.com` |
| `SENTRY_DSN` | Sentry DSN | empty |

### Frontend — `frontend/.env`

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Backend API base | `http://localhost:4001` |
| `NEXT_PUBLIC_MOCK_VALIDATOR_SHARE` | Mock contract address | required |
| `NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE` | Toggle real Polygon ValidatorShare path | `false` |
| `NEXT_PUBLIC_REAL_VALIDATOR_SHARES` | JSON map `{validator: contract}` | `{}` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project id | empty |
| `NEXT_PUBLIC_LOOP_NETWORK` | `local` / `devnet` / `mainnet` | `devnet` |
| `NEXT_PUBLIC_LOOP_SDK_ENABLED` | Real Loop SDK on/off | `true` |
| `NEXT_PUBLIC_LOOP_USE_BACKEND_PROXY` | Route Loop API via `/loop-proxy` | `true` |
| `NEXT_PUBLIC_LOOP_API_URL` | Override the SDK's apiUrl | empty |
| `NEXT_PUBLIC_LOOP_WALLET_URL` | Override the SDK's walletUrl | empty |
| `NEXT_PUBLIC_CC_USD` | CC price fallback | `0.16` |
| `NEXT_PUBLIC_SUI_NETWORK` | Sui dapp-kit default network | `testnet` |
| `NEXT_PUBLIC_SUI_RPC_URL` | Sui RPC URL | `https://fullnode.testnet.sui.io:443` |
| `NEXT_PUBLIC_COSMOS_CHAIN_ID` | Cosmos chain id | `theta-testnet-001` |
| `NEXT_PUBLIC_COSMOS_CHAIN_NAME` | Display name for Keplr suggest | `Cosmos Hub Theta Testnet` |
| `NEXT_PUBLIC_COSMOS_RPC` | RPC | `https://rpc.sentry-01.theta-testnet.polypore.xyz` |
| `NEXT_PUBLIC_COSMOS_REST` | REST | `https://rest.sentry-01.theta-testnet.polypore.xyz` |
| `NEXT_PUBLIC_COSMOS_COIN_DENOM` | Display denom | `ATOM` |
| `NEXT_PUBLIC_COSMOS_COIN_MINIMAL_DENOM` | Base denom | `uatom` |
| `NEXT_PUBLIC_COSMOS_COIN_DECIMALS` | Decimals | `6` |
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
| Sui | `@mysten/dapp-kit` + `@mysten/sui` |
| Canton | `@fivenorth/loop-sdk` |
| Styling | Inline tokens + Tailwind CSS |
| Testing | Vitest |

### Backend

| Layer | Technology |
|---|---|
| Runtime | Node 20 |
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
| Polygon staking | MockValidatorShare on Amoy (real `ValidatorShare` swap behind feature flag) |
| Moonbeam staking | Parachain-staking precompile (`0x...0800`) on Moonbase Alpha |
| Monad staking | Staking precompile (`0x...1000`) on Monad Testnet |
| Cosmos staking | x/staking + Authz `MsgGrant` on theta-testnet |
| Sui staking | `0x3::sui_system::request_add_stake` on Sui Testnet |

### Security & Auth

| Layer | Technology |
|---|---|
| Loop identity | Passkey/biometric handshake via `@fivenorth/loop-sdk` |
| EVM auth | Wallet signature (`personal_sign` / EIP-712 for permits) |
| Cosmos auth | `MsgGrant` Authz with bounded scope + expiry |
| CORS bypass | `/loop-proxy` Fastify reverse proxy with stripped Origin/Referer |
| Secrets | `.env` files; recommended `fly secrets` / Doppler in prod |

---

## Security Model

CantonStake is self-custodial by design — keys never leave the user's wallet, and every Daml choice the orchestrator exercises is bounded by what the user signed for.

### Key Security Properties

| Property | Implementation |
|---|---|
| Self-custody | All staking/unstaking signatures originate from the user's wallet |
| On-ledger reward routing | `BeneficiarySplit` Daml contract enforces `sum(weights) == 1.0` |
| Auto-compound scope | Per-chain executor verifies `signature` + checks `expiresAt` + `maxPerRun` cap before broadcast |
| Reward distribution idempotency | `(roundNumber, party, eventId)` unique constraint on `AppActivityRecord` |
| Alert delivery idempotency | `(alertId, channelId)` unique on `AlertDelivery` — retries don't double-send |
| Audit trail | Every economic transition emits `OnchainEvent` (CIP-0104) + lifecycle log on `RewardRound` |
| Featured App attribution | Sequencer + mediator traffic, signed by SVs each round |

### Attack Resistance

| Attack Vector | Status | Mechanism |
|---|---|---|
| Operator redirects rewards away from users | ✅ Mitigated | `BeneficiarySplit` weights enforced on-ledger; rotations emit audit beacon |
| Stale or expired auto-compound permit replayed | ✅ Mitigated | Keeper checks `expiresAt > now` and `enabled === true` before each tick |
| Auto-compound exceeds user's authorised cap | ✅ Mitigated | `maxPerRun` enforced per chain; pending rewards over the cap → `status="skipped"` |
| Same activity record double-counted across replays | ✅ Mitigated | Prisma `@@unique([roundNumber, party, eventId])` |
| Notification spam from re-emitted alerts | ✅ Mitigated | `dedupKey` on `AlertEvent` + `(alertId, channelId)` unique on delivery |
| Cross-origin abuse of Loop SDK proxy | ⚠️ Partial | `@fastify/cors` reflects request origin; rate limiting + per-origin allowlist recommended for prod |
| Backend `force-accept` route abused | ✅ Mitigated | Gated behind `DEMO_MODE=true` / `LOG_LEVEL=debug` |
| Validator slashing affecting active stakes | ⚠️ Partial | Slashing monitor diffs scores hourly + alerts; manual user action required to redelegate |
| MockValidatorShare deployed in production | ❌ Open | Demo-only; flip `NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE=true` + populate `NEXT_PUBLIC_REAL_VALIDATOR_SHARES` for real Polygon `ValidatorShare` |
| Keeper key leak | ⚠️ Partial | `AUTO_COMPOUND_KEEPER_KEY` recommended in secrets manager (AWS / Doppler); only acts within signed permit scope so blast radius is bounded |

---

## Deployment

### VPS via Docker Compose

```bash
ssh root@your-vps
cd /opt/cantonstake
git pull
export FRONTEND_IMAGE=ghcr.io/your-org/cantonstake-frontend:latest
export BACKEND_IMAGE=ghcr.io/your-org/cantonstake-backend:latest
docker compose pull
docker compose up -d
docker image prune -f
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
  MOCK_VALIDATOR_SHARE_ADDRESS=0x... AMOY_RPC_URL=... \
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
# → SSHes into the VPS at SSH_HOST and runs docker compose pull && up -d.
# Configure secrets: SSH_HOST, SSH_USER, SSH_PRIVATE_KEY, DEPLOY_PATH,
# NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID; vars: NEXT_PUBLIC_BACKEND_URL etc.
git push origin main
```

---

<div align="center">

**Stake any chain. Earn on Canton.** — Self-custody by construction.

</div>
