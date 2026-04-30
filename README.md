# CantonStake — Hackathon MVP

A Canton-native delegation staking application that turns real Polygon staking activity into Canton Coin rewards through CIP-47 Featured Application Activity Markers.

> **What this is.** A hackathon-sized, single-chain version of the original CantonStake concept. The original business plan had fatal blockers (Loop SDK cannot run custom DAR, Featured App status requires weeks of governance review, multi-chain scope is a team-of-5 job). This MVP strips it to what's demoable in 10–14 days of solo vibecoded work while preserving the Canton-native economics.

## Architecture in one paragraph

A user submits a `StakingRequest` on Canton. They call `buyVoucher()` on a MockValidatorShare contract on Polygon Amoy with real POL — the contract is our own Solidity deploy but it matches Polygon's production interface exactly, so this flow is a drop-in swap for Ethereum mainnet. A backend orchestrator watches `ShareMinted` events via viem, matches them to the pending StakingRequest, and exercises `StakingRequest_Accept` on the Canton ledger. The Accept choice transitions the position to `Bonded` and emits a `FeaturedAppActivityMarker` with a 75/25 beneficiary split between the delegator's Canton party and the app treasury. Unbonding follows the same pattern in reverse. Release is automatic after the unbonding period elapses.

## What's Canton-native about it

- **On-ledger state machine.** The StakingPosition lifecycle is the source of truth. Polygon is a settlement layer, not a database.
- **CIP-47 compliance.** Markers are emitted only on bond and unbond — the economically meaningful events. Propose steps and the final release do not emit markers, per the fair-usage guidance.
- **Trustless reward distribution.** The 75/25 split is defined in the Daml contract itself via `AppRewardBeneficiary` entries, not by a backend process. Super Validator automation handles the coupon conversion.
- **Self-featuring on DevNet.** For the demo we use the Canton Coin wallet's self-feature flow so markers actually convert into reward coupons. Mainnet Featured App status is a separate governance process and is not required for the hackathon.

## Tracks this fits

**Primary: Track 2 — Financial Applications.** Economic flows, user incentives, network activity. The marker → coupon → CC conversion is visible end-to-end.

**Secondary angle for the pitch:** CantonStake is a reference implementation for how any app provider can attest to off-Canton economic activity and receive proportional featured rewards — a pattern that extends to cross-chain bridges, oracles, and settlement apps.

## Repo layout

```
cantonstake/
├── daml/CantonStake/        Daml 3.3 package
│   ├── daml.yaml
│   └── daml/CantonStake/
│       ├── Staking.daml     State machine + marker emission
│       ├── Setup.daml       Party allocation
│       └── Test.daml        Happy-path + edge case tests
├── evm/                     Hardhat project, Amoy target
│   ├── contracts/
│   │   └── MockValidatorShare.sol
│   └── scripts/deploy.ts
├── backend/                 Node + TypeScript + Fastify
│   └── src/
│       ├── canton.ts        JSON Ledger API client
│       ├── orchestrator.ts  Viem event watcher + release checker
│       ├── config.ts
│       └── index.ts         Fastify HTTP API
├── frontend/                Next.js 14 + wagmi 2 + Tailwind
│   ├── app/
│   │   ├── page.tsx         Editorial landing
│   │   ├── stake/           Core staking flow with live trace
│   │   ├── positions/       Live-polling positions table
│   │   └── rewards/         CC attribution dashboard
│   ├── components/TopNav.tsx
│   └── lib/
│       ├── wagmi.ts         Amoy config
│       ├── abi.ts           MockValidatorShare ABI
│       └── api.ts           Backend client
├── docker-compose.yml       Runs backend + frontend
├── TUTORIAL.md              ← full end-to-end deploy guide
└── README.md                ← you are here
```

## Quickstart (abridged)

Read **[TUTORIAL.md](./TUTORIAL.md)** for the real step-by-step. The short version:

```bash
# 1. CN Quickstart LocalNet (in a sibling directory)
git clone https://github.com/digital-asset/cn-quickstart.git
cd cn-quickstart/quickstart && make install-daml-sdk && make setup && make build && make start

# 2. Deploy MockValidatorShare to Amoy
cd ../../cantonstake/evm
cp .env.example .env && # fill in DEPLOYER_PRIVATE_KEY
npm install && npm run compile && npm run deploy:amoy

# 3. Upload Daml DAR to LocalNet's App Provider participant
cd ../daml/CantonStake
daml build
# (upload via CN Quickstart's Canton Console — see TUTORIAL.md)

# 4. Self-feature the app party on the CC Wallet
# Open http://wallet.localhost:2000 and tap "Self-feature"
# Copy the FeaturedAppRight contract id

# 5. Fill in root .env with all the values
cp .env.example .env

# 6. Check machine/env readiness
powershell -ExecutionPolicy Bypass -File scripts/demo-preflight.ps1

# 7. Launch the app
docker compose up --build
# Open http://localhost:3000
```

Before judging, run **[docs/DEMO_CHECKLIST.md](./docs/DEMO_CHECKLIST.md)** and record the fallback walkthrough in **[docs/DEMO_RECORDING_SCRIPT.md](./docs/DEMO_RECORDING_SCRIPT.md)**.

## Demo script (3 minutes)

1. **Home page.** Show the lifecycle diagram. "One state machine, two ledgers."
2. **Stake page.** Enter 0.5 POL, click Stake. Walk through the 4-step trace: Canton request created → Amoy tx signed → ShareMinted observed → Daml Accept + marker emitted. Point out the Polygonscan link.
3. **Positions page.** Live-polling table shows the new Bonded position. Click Unbond. Walk through the same trace in reverse. Show the 60-second unbonding timer, then the automatic Released state.
4. **Rewards page.** Point at the marker counter incrementing with each bond/unbond. Point at the 75/25 beneficiary split bar — "this is in the Daml contract, not a backend process." Point at the CIP-47 compliance block — "we only mark the events that matter."
5. **Daml Shell.** (Optional flourish) Switch to terminal and run `make shell`, show the actual `FeaturedAppActivityMarker` contracts on the ledger.

## What I deliberately cut vs the original plan

| Original | MVP | Why |
|---|---|---|
| Loop SDK for Canton identity | Direct JSON Ledger API, party allocated in Daml Setup | Loop does not support custom DAR files. Docs: "we only support DAML transactions from the Splice built-in DAR files" |
| Ledger hardware + WalletConnect v2 | MetaMask only | Ledger integration is polish, not proof. One MetaMask popup demos just as well |
| Polygon + Monad + Moonbeam | Polygon Amoy only | Scope; Moonbeam adds @polkadot/api surface |
| Real Polygon staking contracts | MockValidatorShare on Amoy with matching interface | Polygon's real StakeManager is on Ethereum L1, not on Amoy. Our mock accepts real POL and emits real events — honest about what's mocked |
| Production-grade ops and PagerDuty | BullMQ + Redis repeatable jobs | Reliable enough for the demo; production alerting is later |
| Featured App mainnet approval | DevNet self-featuring | Mainnet approval takes weeks of 2/3 SV governance. DevNet lets you demo the full flow today |
| Smart contract audit | Test script + `daml test` | Required before mainnet; not required to win a hackathon |

## Pitch to judges

> CantonStake is the first reference app for turning off-Canton economic activity into on-Canton rewards. We built the complete CIP-47 marker → coupon → reward loop end-to-end. Every Daml choice that represents a real asset movement emits a marker; nothing else does. The beneficiary split is trustless — it's in the contract, not the backend. Today we demoed with POL delegation on Polygon. The same pattern works for any cross-chain activity: bridges, oracles, settlement apps. We built the template.

## Honest risks

- **`.dar` upload to LocalNet is fiddly.** The CN Quickstart ships with its own licensing template. Uploading a new custom package requires the Canton Console or a direct participant API call. Budget half a day for this.
- **`splice-api-featured-app-v1.dar` must be present for the marker integration to compile.** Fetch from the Splice release bundle during setup. Without it, the Daml code compiles but no markers are ever created.
- **Template IDs in `backend/canton.ts` are placeholders.** After `daml build`, run `daml damlc inspect-dar .daml/dist/cantonstake-0.0.1.dar | head -20` to get the real package id and paste into `TEMPLATES`.
- **Reward rounds require Featured App configuration.** Set `FEATURED_APP_RIGHT_CID=demo-stub` for local scheduler demos, or use the actual `FeaturedAppRight` contract id when exercising real marker conversion. The stub is never sent into Daml as a fake contract id.
- **The native protocol fee is stubbed.** `/api/sweep/:positionId` reads `pendingRewards()` from the Amoy mock and records the 5% fee split in Postgres. Production would execute `withdrawRewards()` and split funds on-chain.

See **[TUTORIAL.md](./TUTORIAL.md)** for the complete deploy guide.
