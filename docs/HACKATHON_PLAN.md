# CantonStake — Hackathon Execution Plan

**Status:** active · Last updated: 2026-04-24
**Audience:** any agent or contributor picking up the project
**Scope:** what's done, what's broken, what's left to ship a credible MVP demo

---

## 0. Current State (Honest)

### What works
- Daml lifecycle contracts: `StakingRequest` → `StakingPosition` (Pending/Bonded/Unbonding/Released) with FeaturedAppActivityMarker emission on bond/unbond and a 75/25 beneficiary split baked into the contract itself ([daml/CantonStake/daml/CantonStake/Staking.daml](../daml/CantonStake/daml/CantonStake/Staking.daml)).
- EVM mock validator on Polygon Amoy: `MockValidatorShare.sol` with `buyVoucher`, `sellVoucher_new`, `unstakeClaimTokens_new`, matching real Polygon ValidatorShare event signatures ([evm/contracts/MockValidatorShare.sol](../evm/contracts/MockValidatorShare.sol)).
- Backend orchestrator: viem watcher on Amoy → Canton choice exercises ([backend/src/orchestrator.ts](../backend/src/orchestrator.ts)).
- Frontend stake flow: wallet connect, EVM signature, Canton request creation, execution trace UI ([frontend/app/stake/page.tsx](../frontend/app/stake/page.tsx)).
- Wallet plumbing: wagmi v2 with WalletConnect-for-Ledger, mock Loop wallet hook ([frontend/lib/wagmi.ts](../frontend/lib/wagmi.ts), [frontend/lib/loop-wallet.ts](../frontend/lib/loop-wallet.ts)).
- Persistence schema: Prisma models for User, StakingPosition, RewardRound, RewardEvent ([backend/prisma/schema.prisma](../backend/prisma/schema.prisma)).
- 10-min reward round scaffolding via BullMQ + Redis ([backend/src/reward-rounds.ts](../backend/src/reward-rounds.ts)).
- docker-compose with Postgres + Redis + frontend + backend.

### What's broken or missing (in priority order)
1. **Reward engine runs on an empty set.** The orchestrator never writes to Postgres, and nothing else does either. `processRound` will iterate zero `Bonded` positions and mint zero CC. ← **demo blocker**
2. **Loop wallet identity is fake.** `stake/page.tsx` hardcodes `"Alice"` as the Canton party. The Loop hook generates a partyId client-side but never tells the backend.
3. **Rewards page reads stale logic.** `/api/rewards/:address` returns `markersEmitted * 0.1` from Canton, not the actual CC distributed by the BullMQ scheduler.
4. **Double-scheduling in reward-rounds.** Both BullMQ's `limiter` and a Node `setInterval` are gating execution. Won't survive restarts cleanly.
5. **Health check lies about Redis.** `/api/health/detail` reports the URL, not the connection status.
6. **No protocol fee.** PDF lists this as the durable revenue stream; not modeled at all.

---

## 1. P0 — Demo Blockers (do first)

These three together unblock the live demo. Estimated total effort: **half a day to one day**.

### Task 1.1 · Wire orchestrator to Postgres (the critical fix)

**Goal:** every Canton state transition (Bond / Unbond / Release) writes a corresponding row in Postgres so the reward scheduler has data.

**Files to touch:**
- [backend/src/orchestrator.ts](../backend/src/orchestrator.ts) — add Postgres writes after each successful Canton choice.
- [backend/src/reward-rounds.ts](../backend/src/reward-rounds.ts:81-99) — keep reading from Postgres (no change needed once 1.1 is done).
- [backend/src/index.ts](../backend/src/index.ts) — `/api/positions` and `/api/requests` can stay Canton-backed; we don't need to change them.

**Approach (recommended): single-writer, Canton-as-source-of-truth, Postgres as read-replica**

Keep Canton as the canonical source. The orchestrator becomes the only writer to Postgres `User` and `StakingPosition`. Postgres stores:
- `User` — created lazily on first stake
- `StakingPosition` — mirrored from each Canton transition
- `RewardRound`/`RewardEvent` — owned entirely by the scheduler (already correct)

**Implementation sketch:**

In `orchestrator.ts`, add a helper:

```ts
import { prisma } from "./db.js";

async function upsertUserByEvm(evmAddress: string, partyId: string) {
  return prisma.user.upsert({
    where: { evmAddress: evmAddress.toLowerCase() },
    update: { cantonPartyId: partyId },
    create: { evmAddress: evmAddress.toLowerCase(), cantonPartyId: partyId },
  });
}

async function mirrorPosition(args: {
  contractId: string;
  evmAddress: string;
  partyId: string;
  amountPol: string;
  status: "Pending" | "Bonded" | "Unbonding" | "Released";
  evmTxHash?: string;
  cantonTxId?: string;
  unbondingReadyAt?: Date;
}) {
  const user = await upsertUserByEvm(args.evmAddress, args.partyId);
  return prisma.stakingPosition.upsert({
    where: { contractId: args.contractId },
    update: {
      status: args.status,
      cantonTxId: args.cantonTxId,
      evmTxHash: args.evmTxHash,
      unbondingReadyAt: args.unbondingReadyAt,
    },
    create: {
      contractId: args.contractId,
      userId: user.id,
      evmAddress: args.evmAddress.toLowerCase(),
      amountPol: args.amountPol,
      status: args.status,
      cantonTxId: args.cantonTxId,
      evmTxHash: args.evmTxHash,
      unbondingReadyAt: args.unbondingReadyAt,
    },
  });
}
```

Then call `mirrorPosition` at the end of each successful choice exercise in `handleShareMinted`, `handleShareBurned`, and `startReleaseChecker`. The new `StakingPosition` `contractId` comes from the Canton response — you may need to extend `canton.ts` to surface the `createdEvent.contractId` from `submit-and-wait-for-transaction` (currently `SubmitAndWaitResult.events` is typed as `unknown[]`). Parse the events array; the JSON Ledger API returns `events: [{ CreatedEvent: { contractId, ... } }, ...]`.

**Acceptance criteria:**
- Run `make stake` (or equivalent demo flow). After `ShareMinted` is observed, `psql -c "select * from \"StakingPosition\""` shows one row with `status = 'Bonded'`.
- Wait 10 minutes (or trigger a round manually via BullBoard). `RewardEvent` row appears with non-zero `ccAmount`.
- `position.markersEmitted` increments on each round.

**Effort:** 2–3 hours.

---

### Task 1.2 · Wire Loop wallet identity through to backend

**Goal:** the partyId used in `StakingRequest.delegator` is the user's real Loop partyId, not a hardcoded `"Alice"`.

**Files to touch:**
- [frontend/lib/loop-wallet.ts](../frontend/lib/loop-wallet.ts) — on `connect()`, POST the partyId + evmAddress to the backend.
- [frontend/app/stake/page.tsx](../frontend/app/stake/page.tsx:19-20) — replace `DELEGATOR_PARTY` env fallback with `useLoopWallet().partyId`.
- [frontend/components/TopNav.tsx](../frontend/components/TopNav.tsx) — surface a "Connect Loop" button next to the EVM connect button. Show partyId truncated when connected.
- [backend/src/index.ts](../backend/src/index.ts) — add `POST /api/users` that upserts by `cantonPartyId` (and optionally links `evmAddress`).

**Implementation sketch:**

Backend:
```ts
app.post<{ Body: { cantonPartyId: string; evmAddress?: string; displayName?: string } }>(
  "/api/users",
  async (req, reply) => {
    const { cantonPartyId, evmAddress, displayName } = req.body;
    if (!cantonPartyId) return reply.code(400).send({ error: "missing cantonPartyId" });
    const user = await prisma.user.upsert({
      where: { cantonPartyId },
      update: { evmAddress: evmAddress?.toLowerCase(), displayName },
      create: { cantonPartyId, evmAddress: evmAddress?.toLowerCase(), displayName },
    });
    return { user };
  }
);
```

Frontend `stake/page.tsx`:
```ts
const { partyId, isConnected: loopConnected } = useLoopWallet();
// ...
const canStake = isConnected && loopConnected && !wrongNetwork && /* ... */;
// in onStake:
await createStakingRequest({ evmAddress: address, amountPol: amount, delegator: partyId! });
```

The stake button should be disabled with a clear message ("Connect Loop wallet for Canton identity") if EVM is connected but Loop is not.

**Acceptance criteria:**
- Connecting Loop generates a partyId, calls `POST /api/users`, and shows the partyId in TopNav.
- Stake button is disabled until both wallets are connected.
- A new staking request uses the Loop partyId, visible in `psql -c "select \"cantonPartyId\" from \"User\""`.

**Effort:** 2–3 hours.

---

### Task 1.3 · Surface real CC totals on the rewards page

**Goal:** `/api/rewards/:address` returns the actual CC distributed by the scheduler, not a marker-count stub.

**Files to touch:**
- [backend/src/index.ts](../backend/src/index.ts:146-193) — replace the Canton-derived calc with a Postgres aggregate.

**Implementation sketch:**
```ts
app.get<{ Params: { address: string } }>("/api/rewards/:address", async (req, reply) => {
  const address = req.params.address.toLowerCase();
  const user = await prisma.user.findFirst({ where: { evmAddress: address } });
  if (!user) {
    return { address, totalPositions: 0, totalBondedPol: 0, totalCcEarned: 0, totalUserShare: 0, totalTreasuryShare: 0, userShare: 0.75, appShare: 0.25 };
  }
  const positions = await prisma.stakingPosition.findMany({ where: { userId: user.id } });
  const events = await prisma.rewardEvent.findMany({ where: { userId: user.id } });

  const totalCc = events.reduce((s, e) => s + Number(e.ccAmount), 0);
  const totalUser = events.reduce((s, e) => s + Number(e.userShare), 0);
  const totalTreasury = events.reduce((s, e) => s + Number(e.treasuryShare), 0);
  const bondedPol = positions
    .filter(p => p.status === "Bonded")
    .reduce((s, p) => s + Number(p.amountPol), 0);

  return {
    address,
    totalPositions: positions.length,
    totalBondedPol: bondedPol,
    totalMarkersEmitted: positions.reduce((s, p) => s + p.markersEmitted, 0),
    totalCcEarned: totalCc,
    totalUserShare: totalUser,
    totalTreasuryShare: totalTreasury,
    userShare: 0.75,
    appShare: 0.25,
    rewardEventCount: events.length,
  };
});
```

Update `frontend/lib/api.ts` `fetchRewards` return type and the rewards page to display `totalCcEarned` instead of `estimatedCcEarned`.

**Acceptance criteria:**
- After at least one reward round, the rewards page shows a non-zero "CC earned" value matching `select sum("ccAmount") from "RewardEvent"`.
- The 75/25 split bar reflects actual `totalUserShare` / `totalTreasuryShare` totals.

**Effort:** 1 hour.

---

## 2. P1 — Demo Polish

These make the demo less janky. Each is small. Estimated total: **half a day**.

### 2.1 · Use BullMQ repeatable jobs instead of `setInterval`

**File:** [backend/src/reward-rounds.ts](../backend/src/reward-rounds.ts:217-263)

Drop the `setInterval` and the `roundCounter` variable entirely. Replace with:

```ts
export async function startRewardScheduler() {
  await rewardQueue.add(
    "round",
    { triggeredAt: new Date().toISOString() },
    {
      repeat: { every: ROUND_INTERVAL_MS },
      jobId: "cc-round-recurring",  // dedupe key
    }
  );
}
```

Compute `roundNumber` inside `processRound` from `prisma.rewardRound.count() + 1` (or use a Postgres sequence). Removes the in-memory state; survives restarts; idempotent across multi-instance deploy.

Also drop the worker `limiter` block — repeatable jobs already enforce the cadence.

**Effort:** 30 min.

### 2.2 · Real Redis health check

**File:** [backend/src/index.ts](../backend/src/index.ts:44-62)

Import the `connection` from `reward-rounds.ts` (export it) and call `await connection.ping()` in `/api/health/detail`. Report `redis: "connected" | "disconnected"`.

**Effort:** 15 min.

### 2.3 · Manual round trigger endpoint (demo aid)

For live demos you don't want to wait 10 minutes. Add `POST /api/admin/rounds/trigger` that adds a one-off job to `rewardQueue`. Gate it behind `if (config.logLevel === "debug")` or a `DEMO_MODE` env var so it can't be hit in production.

**Effort:** 20 min.

### 2.4 · Show CC balance in TopNav

The mocked `useLoopWallet` already returns `ccBalance`. Display it next to the Loop partyId in TopNav. Replace the `Math.random() * 5` mock with `fetchRewards(partyId).then(r => r.totalCcEarned * 0.75)` so the displayed balance is consistent with the rewards page.

**Effort:** 30 min.

---

## 3. P2 — Plan-Fidelity (nice to have)

### 3.1 · Stub the 5–8% protocol fee

The PDF's most durable revenue stream. Cheap to model:

- Add `protocolFeeBps Int @default(500)` to `StakingPosition` in Prisma schema.
- Add a `swept` boolean and a `lastSweepAt` to `StakingPosition`.
- Add a `RewardSweep` model: `{ id, positionId, nativeRewardWei, protocolFeeWei, userPayoutWei, evmTxHash, sweptAt }`.
- Add a `/api/sweep/:positionId` endpoint that reads `pendingRewards()` from the EVM contract, calculates the 5% fee, and (in mock) just records a `RewardSweep` row. In production this would call `withdrawRewards()` and split.
- Surface "native rewards swept" + "protocol fee paid" totals on the rewards page.

This is judging-friendly: lets you tell a clear two-revenue-streams story.

**Effort:** 2 hours.

### 3.2 · Featured App right gating

Currently `featuredAppRightCid` only changes a log line. Per the PDF, without it, no CC is minted at all.

In `processRound`, gate the entire CC distribution block:
```ts
if (!config.featuredAppRightCid) {
  await prisma.rewardRound.update({
    where: { id: round.id },
    data: { status: "skipped", error: "FEATURED_APP_RIGHT_CID not configured" },
  });
  return;
}
```

For the demo, set `FEATURED_APP_RIGHT_CID` to any non-empty string — that's enough to unblock the path. In production it would be the actual contract ID from the sync.global Featured App approval.

**Effort:** 20 min.

### 3.3 · CIP-47 marker ratio observability

The hackathon guide mentions a "1.15 marker-to-gas ratio rule." Add a derived field on `RewardRound`: `markerToTxRatio = totalMarkers / totalEvmTxns`. Surface it in `/api/health/detail`. Gives a one-glance signal that you're CIP-47 compliant.

**Effort:** 30 min.

---

## 4. Demo Prep

### 4.1 · End-to-end smoke test (run before every demo)

Document this as `docs/DEMO_CHECKLIST.md`:

1. `docker compose up -d postgres redis` → wait for healthy
2. `cd backend && npx prisma migrate deploy && npm run dev`
3. `cd frontend && npm run dev`
4. Verify: `curl localhost:4000/api/health/detail` → all `connected`
5. Visit `localhost:3000/stake`
6. Connect Loop (button generates partyId, persists to backend)
7. Connect MetaMask, switch to Amoy, ensure ≥ 0.5 POL on faucet balance
8. Stake 0.1 POL → trace shows Canton create → EVM tx → orchestrator picks up → Bonded
9. Visit `/positions` → see Bonded position
10. `curl -X POST localhost:4000/api/admin/rounds/trigger` (using 2.3)
11. Visit `/rewards` → see CC earned > 0, 75/25 split bar
12. Click "Unbond" on the position → trace shows sellVoucher → Unbonding state
13. Wait 60s → `/positions` shows Released

If any step fails, the demo isn't ready.

### 4.2 · README + TUTORIAL

The repo doesn't have a top-level README that walks through this. Write:
- `README.md` — what CantonStake is, architecture diagram (ASCII or PNG), 3-line quickstart pointing at TUTORIAL
- `TUTORIAL.md` — full local setup including Canton LocalNet bring-up, env-var explanations, Amoy deployment

Existing skill docs in `docs/skills/` are already comprehensive — link them from the README.

### 4.3 · Verify the Amoy contract on Polygonscan

`evm/scripts/deploy.ts` already deploys; add a `verify.ts` (or use `hardhat-verify` plugin) to verify on Polygonscan. A verified contract address shown live during the demo is high-credibility, low-effort.

**Effort:** 30 min plus Polygonscan API key signup.

### 4.4 · Pre-record a demo video as backup

Live wallet demos break. Record a 3-minute walkthrough of the smoke test (4.1) once everything works. Have it ready to play if anything goes wrong on stage.

---

## 5. Explicit Non-Goals (don't get sidetracked)

These are in the PDF but **not** in scope for the hackathon:

- Moonbeam staking (requires `@polkadot/api`, multi-day effort)
- Monad staking (chain may not even have a working testnet yet)
- Polkadot / Cosmos / Near / Aptos / Sui (Phase 2/3 in the PDF)
- Premium subscription tier
- Cypherock support
- B2B whitelabel
- Smart contract security audit (PDF says non-negotiable for mainnet, but we're on Amoy testnet — call this out as known-pending in the pitch, don't try to do it)
- Real Featured App application (post-hackathon, takes weeks)
- Liquid staking derivatives

If a teammate asks "should we add X?" and X is on this list, the answer is **no, not before judging**.

---

## 6. Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Amoy RPC rate-limits during demo | Medium | Use Alchemy/Infura instead of public RPC; have a backup RPC URL |
| Canton LocalNet flakes during demo | Medium | Pre-record demo video (4.4); run smoke test 30 min before |
| Loop SDK mock looks unconvincing to judges | Low-Medium | Be upfront in pitch: "Loop is mocked at the SDK boundary; real integration is a one-line swap" |
| Reward round doesn't fire in time for live demo | Medium | Manual trigger endpoint (2.3) |
| EVM tx stuck pending | Low | Have a second funded wallet ready |
| `featuredAppRightCid` gating blocks demo | High if 3.2 lands | Make sure `FEATURED_APP_RIGHT_CID=demo-stub` is set in `.env` |

---

## 7. Suggested Order of Operations

If you have **half a day**: do 1.1 + 1.2 + 1.3 only. Demo works.

If you have **one day**: above + all of P1 + 4.1 smoke checklist. Demo is solid.

If you have **two days**: above + 3.1 protocol fee + 3.2 featured-app gating + README + Polygonscan verify + demo video.

Anything more is gravy.

---

## 8. Key File Paths Cheatsheet

| Concern | File |
|---|---|
| Daml staking lifecycle | [daml/CantonStake/daml/CantonStake/Staking.daml](../daml/CantonStake/daml/CantonStake/Staking.daml) |
| EVM mock validator | [evm/contracts/MockValidatorShare.sol](../evm/contracts/MockValidatorShare.sol) |
| Canton client | [backend/src/canton.ts](../backend/src/canton.ts) |
| EVM → Canton orchestrator | [backend/src/orchestrator.ts](../backend/src/orchestrator.ts) |
| HTTP API | [backend/src/index.ts](../backend/src/index.ts) |
| Reward scheduler | [backend/src/reward-rounds.ts](../backend/src/reward-rounds.ts) |
| Prisma schema | [backend/prisma/schema.prisma](../backend/prisma/schema.prisma) |
| Loop wallet hook | [frontend/lib/loop-wallet.ts](../frontend/lib/loop-wallet.ts) |
| wagmi config | [frontend/lib/wagmi.ts](../frontend/lib/wagmi.ts) |
| Stake UI | [frontend/app/stake/page.tsx](../frontend/app/stake/page.tsx) |
| Rewards UI | [frontend/app/rewards/page.tsx](../frontend/app/rewards/page.tsx) |
| Top nav (wallet picker) | [frontend/components/TopNav.tsx](../frontend/components/TopNav.tsx) |
| Skill reference docs | [docs/skills/](skills/) |
