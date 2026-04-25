# Skill: Architecture and Canton Coin Reward Model

## When to use
When reasoning about the end-to-end staking flow, deciding where state should live, understanding marker emission and CC attribution, or evaluating whether a change belongs in Daml, the backend, or the EVM contract.

## Core Principle
The Canton ledger is the source of truth for staking lifecycle state.

- Polygon Amoy is the settlement layer for staking transactions
- Daml records the canonical lifecycle and marker emission
- The backend bridges Amoy events into Daml choices
- The Prisma/BullMQ layer is currently an added persistence and scheduler experiment, not the canonical staking engine

## High-Level Architecture

```text
Frontend (Next.js + wagmi)
  -> calls backend REST API to create StakingRequest
  -> sends EVM txs to MockValidatorShare on Amoy

Backend (Fastify + viem + Canton JSON API v2)
  -> creates and queries Daml contracts
  -> watches ShareMinted / ShareBurnedWithId
  -> exercises Daml choices when EVM events settle
  -> optionally persists reward-round data in PostgreSQL

Canton Ledger (Daml 3.3 + Splice featured app APIs)
  -> StakingRequest
  -> StakingPosition
  -> FeaturedAppActivityMarker

Optional app-layer persistence
  -> PostgreSQL via Prisma
  -> Redis + BullMQ for reward-round jobs
```

## Actual Cross-Chain Flow
Current implementation order:

1. User connects an EVM wallet
2. Frontend calls `POST /api/requests`
3. Backend creates `StakingRequest` on Canton
4. Frontend submits `buyVoucher()` on Amoy
5. Backend watcher sees `ShareMinted`
6. Backend exercises `StakingRequest_Accept`
7. Daml creates `StakingPosition` in `Bonded`
8. Daml emits `FeaturedAppActivityMarker` for the bond event

Unbond flow:

1. User triggers `sellVoucher_new()` from the positions page
2. Backend watcher sees `ShareBurnedWithId`
3. Backend exercises `StakingPosition_ConfirmUnbond`
4. Daml moves position to `Unbonding`
5. Daml emits `FeaturedAppActivityMarker` for the unbond event
6. Release checker later exercises `StakingPosition_Release`

## Marker and Reward Model
What is true in the Daml model:
- markers are emitted on bond and unbond
- markers are not emitted on request creation or final release
- beneficiary split is `75%` delegator and `25%` app treasury
- marker creation uses `FeaturedAppRight_CreateActivityMarker`

What is true in the broader Sync model:
- `FeaturedAppActivityMarker` is on-ledger evidence of app-enabled activity
- Super Validator automation converts markers into reward coupons
- the app does not directly mint Canton Coin just by running its own backend

Do not describe markers as "emitted per reward round." In this repo, markers are tied to Daml business events.

## Current Rewards Reality
There are two layers in the repo:

1. Canonical on-ledger attribution
   - Daml marker emission
   - beneficiary split defined in contract logic

2. App-layer illustrative scheduler
   - `backend/src/reward-rounds.ts`
   - BullMQ + Redis + PostgreSQL
   - mock CC estimates and persistence

The second layer is not yet a full trustworthy reflection of the first. Treat the scheduler as experimental/demo infrastructure unless you verify the Canton-to-DB sync path.

## Current Frontend Identity Model
- active user identity in the app is the EVM wallet
- the Canton delegator party currently comes from `NEXT_PUBLIC_CANTON_DELEGATOR_PARTY`
- `frontend/lib/loop-wallet.ts` exists, but it is not currently wired into the main staking flow

## Current Persistence Model
Prisma schema introduces:
- `User`
- `StakingPosition`
- `RewardRound`
- `RewardEvent`

This is useful for experiments and dashboards, but the Daml lifecycle still defines the real staking state.

## Infrastructure Notes
Current app-layer services in `docker-compose.yml`:
- backend on `4000`
- frontend on `3000`
- postgres on `5432`
- redis on `6379`

The backend also expects a separate LocalNet participant JSON API, typically:

```text
http://localhost:2975
```

or `host.docker.internal:2975` from inside Docker Compose.

## Useful External References
- Sync testing docs
  - use for LocalNet versus DevNet decisions, reset expectations, and app-operator workflows
  - `https://docs.sync.global/app_dev/testing/index.html`
  - `https://docs.sync.global/app_dev/testing/networks_and_usecases.html`
- Sync app overview
  - useful for featured-app process context and broader Splice architecture
  - `https://docs.sync.global/app_dev/overview/index.html`
- Splice Daml APIs
  - use when reasoning about `FeaturedAppRight`, marker creation, and stable public Daml interfaces
  - `https://docs.sync.global/app_dev/daml_api/index.html`
- CN Quickstart
  - best operational reference for the LocalNet-based version of this repo
  - `https://github.com/digital-asset/cn-quickstart`

## Building a Featured App on Canton Network

### What Makes a Featured App
A Featured App actively contributes to Canton Network utility and is recognized by the GSF Tokenomics Committee.

**Requirements:**
1. A running Canton node connected to the Global Synchronizer
2. Active on-chain activity (transactions, contracts)
3. Application of activity markers following the **1.15 marker-to-gas ratio rule**
4. Submit a Featured App request to the Tokenomics Committee

**Key Resources:**
- Canton Network Ecosystem — see live Featured Apps: `https://canton.network`
- Sync.Global Tokenomics — community discussions on Featured App rules: `https://docs.sync.global`
- Canton Dev Guide — Featured App section: `https://github.com/JohnLilic/canton-dev-guide`

### Activity Marker Rules (CIP-47)
- Markers must be emitted as part of real business logic (bond/unbond events)
- The 1.15 marker-to-gas ratio determines how markers translate to CC rewards
- `FeaturedAppRight` contract must be held by the app provider party
- Self-featuring is available on DevNet/LocalNet for testing

## Block Explorers & Data APIs

| Tool | URL | Use Case |
|---|---|---|
| **Lighthouse Explorer** | `https://lighthouse.cantonloop.com` | Browse Canton blocks, transactions, contracts |
| **CCView Explorer** | `https://ccview.io` | Alternative Canton block explorer |
| **CCView Indexing API** | `https://docs.ccview.io` | API for indexing Canton data |
| **Modo Agentic API** | `https://docs.modo.link/agentic-api/intro` | API for indexing Canton data (AI-friendly) |

## AI + Canton Integration Ideas
Canton's privacy-preserving smart contracts enable novel AI applications:

| Direction | Description |
|---|---|
| **On-chain AI agents** | Agents that execute DAML choices based on AI decisions |
| **Data on-chain** | Canton as tamper-proof data layer for AI model outputs |
| **Verified inference** | Record AI inference results on-chain with auditability |
| **Multi-party ML** | Privacy-preserving federated learning via Canton sub-transaction privacy |
| **AI-gated contracts** | Choices requiring AI-generated proofs or scores |

## Design Guidance
- Put canonical staking lifecycle changes in Daml
- Put on-chain staking settlement in the EVM contract
- Put event matching and orchestration in the backend
- Put read-model or experimental reward persistence in Prisma/BullMQ only when it can lag without breaking correctness

## Common Mistakes
- Do not describe the app as requiring a live Loop wallet in the current UI
- Do not say markers are emitted every reward round
- Do not treat PostgreSQL as the source of truth for positions
- Do not imply the backend itself mints real CC directly
- Do not forget the frontend currently creates the Canton request before the EVM stake transaction
