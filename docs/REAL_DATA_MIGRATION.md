# Real Data Migration Plan

Converting CantonStake from demo/mock data paths to real on-chain and on-ledger data.

**Status:** Executed — 2026-08-14 (see §8 Execution Log)
**Owner:** unassigned
**Target:** testnet-real (see Assumptions)

---

## 1. Goal

Remove every fabricated data path from CantonStake so that each number the UI shows traces to a real
on-chain event, a real Canton ledger contract, or a real upstream API — and so that every remaining
fallback is honestly labelled as such.

This is **not** primarily a rewrite. An audit of the codebase found that most "mocks" are real code
paths sitting behind config flags. The work splits into three tiers:

- **Tier 1** — real path already implemented, currently disabled by a flag. Flip, verify, delete the dead branch.
- **Tier 2** — genuine engineering gaps. New code required.
- **Tier 3** — honest degradation fallbacks. **Keep these.** Deleting them makes the system less truthful.

---

## 2. Assumptions

These were decided at plan time. Revisit before starting if any is wrong — items marked ⚠ change scope materially.

1. ⚠ **Target is testnet-real, not mainnet.** All five adapters already point at testnets (Polygon Amoy,
   Moonbase Alpha, Monad Testnet, Cosmos theta-testnet, Sui Testnet). Mainnet would additionally require
   real capital at risk and a Featured App approval — a 2/3 Super Validator vote taking weeks
   (`TUTORIAL.md:509`). Testnet-real means: real contracts, real events, real ledger, real validator
   data, testnet tokens.
2. ⚠ **Polygon remains the lead chain.** It is the only chain with a deployed contract and a genuinely
   event-driven watcher. Phases are ordered to take Polygon fully real before touching the other four.
3. **Canton LocalNet is acceptable for Phases 0–1** initially, with DevNet as a follow-on. LocalNet
   supports self-featuring (`docs/skills/05-architecture-cc-model.md:150`), so real `FeaturedAppRight`
   flows can be exercised without network onboarding.
4. **Honest fallbacks stay.** See §6.

---

## 3. Environment constraints

Verified on the current dev box (2026-08-14):

- **`rpc-amoy.polygon.technology` does not resolve** (`ENOTFOUND`) — egress allowlist, not a config bug.
  `fullnode.testnet.sui.io`, `devnet.cantonloop.com` and `registry.npmjs.org` all resolve fine.
  Workaround: `https://polygon-amoy-bor-rpc.publicnode.com` (Bor) and
  `https://ethereum-sepolia-rpc.publicnode.com` (Sepolia) **are** reachable from this box — both
  verified answering JSON-RPC on 2026-08-14.
- **Polygon PoS staking settles on Ethereum, not on the Bor chain.** `StakeManager` and the
  per-validator `ValidatorShare` contracts are deployed on **Sepolia** for Amoy (and Ethereum mainnet
  for Polygon mainnet). The stake token is an ERC-20, so delegating is `approve()` + `buyVoucher()` —
  `buyVoucher` is **not payable** on the real contract, unlike the mock. Independently verified
  on-chain 2026-08-14 (`eth_getCode` returns real bytecode on Sepolia, chainId `0xaa36a7`):
  - StakeManager `0x4AE8f648B1Ec892B6cc68C89cc088583964d08bE`
  - StakingLogger `0x5E3111a5d928D24718c1A7897261D0B9087002ed`
  - Stake token **`0x44499312f493F62f2DFd3C6435Ca3603EbFCeeBa`** (POL) — read from
    `StakeManager.token()`, re-verified 2026-08-14.
    ⚠ An earlier revision of this document listed `0x3fd0A53F4Bf853985a95F4Eb3F9C9FDE1F8e2b53`.
    That is the **legacy MATIC** token. It *is* a deployed contract, so an `eth_getCode` check passes
    on it — but approving it makes every delegation fail. Always read `token()`; never trust
    "the address has bytecode" as proof an address is the right one.
  - The delegator approves the **StakeManager** (it performs the `transferFrom`), not the ValidatorShare.
  Treat this as settled fact, not a hypothesis to re-derive.
- Docker 29.7.2 + Compose v5.4.0 installed; Postgres 16 and Redis 7 running and healthy.
- Backend deps, frontend deps, EVM/Hardhat deps installed. Prisma client generated, all migrations applied.
- No Daml SDK, no cn-quickstart LocalNet, no built DAR (Phase 0 addresses this).

---

## 4. Inventory

### Tier 1 — flag flips (real path exists)

| # | Mock | Location | Real path | Blocked on |
|---|---|---|---|---|
| T1.1 | `MOCK_REWARDS=true` deterministic seeded round stream | `backend/src/scan-poller.ts:39-60` (`mulberry32`, `generateMockRecords`) | `SCAN_API_URL` fetch, already written in same file | Real Scan API (Phase 0) |
| T1.2 | `FEATURED_APP_RIGHT_CID` empty / `demo-stub` → Daml marker exercise skipped | `backend/src/orchestrator.ts:64`, `backend/src/index.ts:213` | Real CID from self-featuring | Real ledger (Phase 0) |
| T1.3 | Mock Loop provider via `NEXT_PUBLIC_MOCK_LOOP_PARTY_ID` | `frontend/lib/canton/loop-provider.ts` | `frontend/lib/canton/loop-sdk-provider.ts`, already enabled | Party must exist on the ledger the backend writes to |
| T1.4 | `featuredRightCid: null` hardcoded on every Accept | `backend/src/multichain-watcher.ts:453`, `backend/src/index.ts:441` | Pass the real CID | T1.2 |

### Tier 2 — real engineering gaps

| # | Gap | Location | Notes |
|---|---|---|---|
| T2.1 | `MockValidatorShare` is a deliberate fake | `evm/contracts/MockValidatorShare.sol:15-24` | Self-documented divergences: 60s unbonding vs real 21 days; 1:1 shares vs dynamic `exchangeRate`; 8% APR simulated via `aprBasisPoints`; rewards paid from a **pre-funded owner balance**, not protocol yield |
| T2.2 | Validator share address is a **single global** | `backend/src/config.ts:21`, `backend/src/multichain-watcher.ts:71,449`, `backend/src/services/nativeSweep.ts:46,69` | Polygon deploys **one ValidatorShare per validator**. Every one of these call sites must become a per-validator lookup. This is the structural core of Phase 2 |
| T2.3 | **`force-accept` accepts unverified proof** | `backend/src/index.ts:396-455` | Takes `evmTxHash` from the request body and passes it to `StakingRequest_Accept` with **no on-chain verification**. A fabricated hash mints a bonded position. Gated behind `DEMO_MODE`, but see T2.4 |
| T2.4 | Non-Polygon chains structurally depend on T2.3 | `backend/src/multichain-watcher.ts:283-292` | Cosmos watcher explicitly punts: *"the actual matching happens via the force-accept endpoint"* and *"In production, you'd decode the protobuf tx to get the actual values"* |
| T2.5 | `${chain}::precompile` placeholder written as proof's validatorShare | `backend/src/multichain-watcher.ts:450`, `backend/src/index.ts:445` | Not a real address for any non-Polygon chain |
| T2.6 | Daml validates nothing about the proof | `daml/CantonStake/daml/CantonStake/Staking.daml:63-67, 206, 302, 336` | `EvmProof` is untyped `Text`/`Int` with no `ensure` clause. The ledger trusts the orchestrator entirely |
| T2.7 | Hardcoded APY base yields | `backend/src/routes/chains.ts:32-36` | Monad flagged in-source as *"best-effort placeholder until Monad publishes mainnet schedule"* |
| T2.8 | Auto-compound non-Polygon executors return `skipped` | `backend/src/services/auto-compound.ts:160-460` | Framework exists for Moonbeam/Monad/Cosmos/Sui; all gated on keeper keys never being set |
| T2.9 | **Daml `Int` sent as JSON number, must be a string** | `orchestrator.ts:290,320,359,391,512`; `multichain-watcher.ts:82,150,218,365,446`; `index.ts:435` | **BLOCKER.** Canton 3.5's JSON API requires Daml `Int` encoded as a JSON *string*. The backend sends numbers, so **every `StakingRequest_Accept`, `ConfirmUnbond` and `Release` 500s.** Confirmed in the live log: `LEDGER_API_INTERNAL_ERROR … "Expected ujson.Str (data: 0)"`. Affects `EvmProof.blockNumber` and `unbondingReadyEpoch`. Independently verified 2026-08-14 — this was invisible while the ledger was mocked, because nothing was actually submitted |

### Tier 3 — honest fallbacks — **DO NOT DELETE**

| Fallback | Location | Why it stays |
|---|---|---|
| `source: "stub"` on empty validator fetch | `backend/src/services/validator-scoring.ts:398` | Means "live fetch returned empty", surfaced to UI. Already live in practice (105 Polygon validators fetched) |
| `source: "stub"` on empty portfolio fetch | `backend/src/services/portfolio-cache.ts:151-164` | Same — file's own comment calls it "honest" |
| Slashing monitor skips `stub`-sourced scores | `backend/src/services/slashing-monitor.ts:51` | Correctly refuses to alert on unreliable data |
| CoinGecko price fallback | `frontend/lib/prices.ts:31,43,62` | Labelled `source: "fallback"`. CC has no public feed |
| Rule-based narrator when `ANTHROPIC_API_KEY` unset | `/api/narrator` | Deterministic, zero-cost default |

---

## 5. Phases

Phases are ordered by dependency. **Do not start a phase before its prerequisites are green.**

### Phase 0 — Real Canton ledger  `[no app source changes]`

**Prereq:** none. **Unblocks:** everything.

- P0.1 Install the Daml SDK (`dpm`), confirm `daml` on PATH.
- P0.2 Clone `digital-asset/cn-quickstart`, `make start`, wait for all containers healthy.
- P0.3 `daml build` the `daml/CantonStake` project → `cantonstake-0.0.1.dar`.
- P0.4 Upload the DAR to the LocalNet app-provider participant.
- P0.5 Read the **actual** party IDs off LocalNet — the ones in `DEPLOY_INSTRUCTIONS.md` are from a
  previous instance and will not match (party IDs embed the participant namespace fingerprint,
  regenerated per init).
- P0.6 Mint `CANTON_AUTH_TOKEN` (HS256 snippet in `DEPLOY_INSTRUCTIONS.md`, substituting the new party ID).
- P0.7 Self-feature at `http://wallet.localhost:2000` → real `FEATURED_APP_RIGHT_CID`.
- P0.8 Run `Setup.daml` to create the `BeneficiarySplit` at 75/25 → `BENEFICIARY_SPLIT_CID`.
- P0.9 Update `.env`, `backend/.env`, `frontend/.env` with all real values.

**Owned files:** `.env`, `backend/.env`, `frontend/.env`, `daml/**`. No backend/frontend source.

**Acceptance:**
- `curl localhost:4001/api/health/detail` returns `featuredAppRight` ≠ `"missing"`.
- Backend logs show **no** `ECONNREFUSED` to `:3975`.
- A stake request creates a real `StakingRequest` contract visible via `/v2/state/active-contracts`.

---

### Phase 1 — Kill the reward mock  `[T1.1, T1.2, T1.4]`

**Prereq:** Phase 0 green.

- P1.1 Set `SCAN_API_URL` to the LocalNet/DevNet Scan API base.
- P1.2 Set `MOCK_REWARDS=false`. Confirm `scan-poller` REAL branch fetches
  `${SCAN_API_URL}/v0/events?app_activity_records=true&round=<n>`.
- P1.3 Verify a full round end-to-end: records ingested → CC distributed → idempotent on
  `(roundNumber, party, eventId)` across a re-poll.
- P1.4 Thread the real `FEATURED_APP_RIGHT_CID` through both Accept call sites, replacing
  `featuredRightCid: null` (T1.4).
- P1.5 **Delete** `mulberry32` and `generateMockRecords` from `scan-poller.ts`, plus `MOCK_REWARDS` /
  `MOCK_REWARDS_SEED` from `config.ts`, all `.env*` files, `docker-compose.yml`, and README/docs references.

**Acceptance:**
- A round completes with `source=live` (not `source=mock`) in the round log line.
- Re-polling the same round creates zero duplicate rows.
- `grep -ri "mock_rewards\|mulberry32" backend/ docs/ *.yml` returns nothing.

---

### Phase 2 — Polygon staking for real  `[T2.1, T2.2]`

**Prereq:** Phase 0 green. **Largest phase. Do it alone, on one chain, end to end.**

**Read §3 first** — the staking contracts are on **Sepolia**, not Amoy, and `buyVoucher` is not
payable. This changes the wallet/chain-switching story materially: the user signs on Sepolia
(chainId 11155111) while POL balances and explorer links still reference Bor.

- P2.1 Build a validator-share resolver: `StakeManager.validators(validatorId).contractAddress` →
  per-validator `ValidatorShare`, cached in Redis.
- P2.2 Refactor the global `config.mockValidatorShare` out of all four call sites (T2.2). This is the
  structural heart of the phase — the address becomes per-position, not per-deployment.
- P2.3 Handle real `exchangeRate` math (`EXCHANGE_RATE_PRECISION = 1e29`) — shares are **not** 1:1.
- P2.4 Handle the real unbonding period, not the mock's 60 seconds. ⚠ An earlier revision of this
  document said "21 days / ~82 checkpoints" — that is the **mainnet** figure. On Amoy/Sepolia,
  `withdrawalDelay()` is **80 checkpoints** at a measured cadence of ~1,039 s ≈ **23 hours**
  (verified live 2026-08-14 via `/api/polygon/staking-params`). Never hardcode either number: read
  the delay and measure the cadence, and key `sellVoucher_new` → `unstakeClaimTokens_new` off real
  checkpoint progress.
- P2.5 Rewards come from protocol yield via `withdrawRewards`/`restake`, **not** a pre-funded balance.
  Remove the funding assumption (`evm/scripts/fund.ts` becomes mock-only).
- P2.6 Flip `NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE=true`, populate `NEXT_PUBLIC_REAL_VALIDATOR_SHARES`.
- P2.7 Update `frontend/lib/chains/polygon.ts` + `frontend/lib/abi.ts` to the real ABI; keep
  `__tests__/polygon.test.ts` green and extend it.
- P2.8 Retire `MockValidatorShare.sol` from the live path (keep it in-repo for local E2E tests only,
  clearly marked).

**Acceptance:**
- A real Amoy delegation to a real validator produces a bonded position with a correct share count
  derived from live `exchangeRate`.
- Unbonding shows a real ~21-day ETA and only becomes claimable after the real checkpoint count.
- No code path references `MOCK_VALIDATOR_SHARE_ADDRESS` outside the local-test harness.

---

### Phase 3 — Close the proof gap  `[T2.3, T2.4, T2.5]`

**Prereq:** Phase 2 merged (it rewrites the same watcher file — **do not run Phases 2 and 3 concurrently**).

- P3.1 Cosmos: decode the protobuf tx to extract real delegator address and amount
  (`multichain-watcher.ts:283-292`) instead of logging and continuing.
- P3.2 Moonbeam / Monad / Sui: same — verified event decode → `handleStakeEvent` with real values.
- P3.3 Replace the `${chain}::precompile` placeholder with each chain's real staking contract/module
  identifier (T2.5).
- P3.4 **Delete `/api/requests/force-accept` entirely** (`index.ts:396-455`) once every chain has a
  verified path. Remove `DEMO_MODE` gating that exists only to guard it.
- P3.5 Decide and record: does `EvmProof` get on-ledger validation (`ensure` clause / attestation), or
  is backend-as-oracle the accepted trust model? (T2.6) Document the answer in `docs/`.

**Acceptance:**
- Every chain confirms a stake from a **verified on-chain event**, never from request-body input.
- `grep -rn "force-accept" backend/ frontend/ docs/` returns nothing outside this plan and changelogs.
- A fabricated tx hash POSTed to any endpoint cannot produce a bonded position.

---

### Phase 4 — Remaining real-data cleanup  `[T2.7, T2.8]`

**Prereq:** Phase 3 green.

- P4.1 Derive APY from real per-chain inflation/reward endpoints, replacing the hardcoded
  `baseYield` constants (`routes/chains.ts:32-36`). Where a chain genuinely has no published schedule
  (Monad), keep an estimate but tag it `source: "estimate"` in the API response — do not silently
  present it as live.
- P4.2 Provision auto-compound keeper keys per chain; take Moonbeam/Monad/Cosmos/Sui executors off
  their permanent `skipped` path and test each against testnet.
- P4.3 Re-audit: `grep -rniE "mock|stub|fake|placeholder|hardcod" backend/src frontend/lib frontend/app`
  and confirm every surviving hit is a Tier 3 honest fallback.

---

## 6. Explicitly out of scope

- Mainnet deployment and the Featured App application (multi-week SV vote).
- Removing Tier 3 fallbacks (§4).
- Replacing the demo `MockValidatorShare` in the **local test harness** — it stays as a fast E2E fixture.

---

## 7. Verification commands

```bash
# Ledger reachable + featured right present
curl -s localhost:4001/api/health/detail | jq '.featuredAppRight, .database, .redis'

# No mock reward path remains (Phase 1 exit)
grep -rniE "mock_rewards|mulberry32|generateMockRecords" backend/ docs/ *.yml

# No global validator-share address remains (Phase 2 exit)
grep -rn "mockValidatorShare\|MOCK_VALIDATOR_SHARE" backend/src frontend/lib

# No unverified accept path remains (Phase 3 exit)
grep -rn "force-accept\|::precompile" backend/src frontend/

# Full mock re-audit (Phase 4 exit)
grep -rniE "mock|stub|fake|placeholder|hardcod" backend/src frontend/lib frontend/app
```

---

## 8. Execution Log — 2026-08-14

All phases executed. Outcomes, deviations discovered during execution, and
the one remaining operator action.

### Phase 0 — Real Canton ledger: DONE (was mostly complete)

Verified rather than rebuilt: DAR built and uploaded, `FEATURED_APP_RIGHT_CID`
and `BENEFICIARY_SPLIT_CID` in env match live ledger contracts exactly
(confirmed via JSON API ACS at the app-provider participant), a real
`StakingRequest` + `StakingPosition` exist on-ledger, no ECONNREFUSED in the
backend log. **Gotcha documented:** this Canton JSON API requires
`activeAtOffset` on ACS queries — without it they silently return offset-0
(empty) results.

### Phase 1 — Kill the reward mock: DONE, with one Tier-2 fix

The "already written" real Scan branch did not match the actual API. The
LocalNet Scan (reachable at `http://scan.localhost:4000/api/scan`, NOT port
2000) exposes only `POST /v0/events` with `{"page_size": N}`; each event
carries `app_activity_records: {round_number, records: [{party, weight}]}`
— not the GET + snake_case CIP-0104 shape the poller assumed.
`scan-poller.ts` was rewritten against the real shape:

- Real parties + weights from sequencer-derived AppActivityRecords; each
  network round is attributed to at most one app round (Redis marker) and
  upsert-idempotent on (roundNumber, party, eventId).
- The Scan publishes no per-round mint pool, so the gross CC per round is a
  **labelled** constant (`SCAN_ROUND_CC_POOL`) — parties/weights real, pool
  configured. Surfaced as such in config + README.
- Real attribution names the *provider* party, so `reward-rounds.ts` now
  distributes the app's round CC across bonded stakers pro-rata bonded
  stake (the app's own distribution rule); per-user visualizer numbers come
  from rewardEvents instead of per-user Scan records.
- Verified live: round #163 ingested network round 7 (`source=scan`, real
  weights 0.357/0.643); round #164 re-poll wrote zero duplicates.
- T1.2/T1.4: real `FEATURED_APP_RIGHT_CID` threaded through all Accept
  sites via `featuredRightCidForDaml()`. T1.3: the Loop direct-connect
  provider now requires a pinned real party (no random-party fabrication).

### Bonus blocker fix — T2.9 (Int as JSON string): FIXED

Fixed centrally in `canton.ts` (`damlEncode`): every JS number in a choice
/ create argument is stringified before submission (Canton 3.5 JSON API
requires Daml Int as string). 80 historical `Expected ujson.Str` Release
failures → 0 after the fix. Also fixed en route: force-accept was
exercising with the delegator token while acting as the provider party
(403).

### Phase 2 — Polygon staking for real: DONE, acceptance proven end-to-end

Most of the engineering (resolver, exchange-rate math, checkpoint-based
unbonding, frontend real-share path) was already in the tree; verified it
against live Sepolia and completed the remainder:

- `GET /api/polygon/staking-params` returns live data: 31 active
  validators, epoch 44474, withdrawalDelay 80 checkpoints, **measured**
  checkpoint cadence 1039s → honest ~23h unbonding ETA (not the mock's
  60s, and not a hardcoded "21 days" — on Amoy the real delay is ~80
  checkpoints × measured cadence).
- End-to-end acceptance without a funded wallet: created a StakingRequest
  matching a **real** ShareMinted event (tx `0x7e3b4e09…`, validator 16),
  let the live watcher decode it → resolve the per-validator ValidatorShare
  (`0xA5DD83ee…`) → exercise `StakingRequest_Accept` on-ledger
  (tx `1220ae4e16…`). Postgres mirror: Bonded position, correct
  validatorId/validatorShare/amountShares (5e18) from the event's real
  `tokens` value. Non-matching real events correctly skipped.
- `MOCK_VALIDATOR_SHARE_ADDRESS` removed from backend env/compose;
  compose now defaults `NEXT_PUBLIC_USE_REAL_VALIDATOR_SHARE=true`. The
  mock contract stays only as the labelled local E2E fixture.
  `evm/scripts/fund.ts` already marked mock-only.

### Phase 3 — Close the proof gap: DONE

- **Cosmos:** decodes real protobuf `TxRaw → MsgDelegate` via cosmjs.
  Found + fixed two live bugs: the Tendermint index needs the full
  typeURL tag (`message.action='/cosmos.staking.v1beta1.MsgDelegate'` —
  the short form matched 0 of ~100k txs), and polling is now
  height-windowed with capped dedup. Verified live: real theta-testnet
  delegations decode with true delegator/validator/amount.
- **Sui:** the old code read nonexistent fields (`delegator`, `amount`);
  StakeRequest actually carries `pool_id` + `stake_amount` with the sender
  as delegator — fixed, MIST scaled 10^-9→10^-18. **Environment blocker:**
  public fullnodes deprecated JSON-RPC and the GraphQL host
  (`sui-testnet.mystenlabs.com`) does not resolve from this box (egress
  allowlist, same class as rpc-amoy). The watcher now fails LOUDLY
  (logged error) instead of silently watching nothing; point
  `SUI_RPC_URL` at a GraphQL-capable reachable endpoint to activate it.
- **Moonbeam/Monad:** pass their real staking precompile addresses as the
  proof's `validatorShare` (Monad also records validatorId).
- **force-accept deleted** from backend + frontend (route 404s; the
  frontend flows now rely on the per-chain watchers). All
  `${chain}::precompile` placeholders gone; the remaining
  `::timer-release` on the non-Polygon *release* path is a commented,
  deliberate not-an-address label for the timer-based fallback.
- **T2.6 decision — backend-as-oracle**, documented in
  `docs/PROOF_TRUST_MODEL.md`: Daml cannot verify external chains, the
  trust anchor is the provider-party token + verified event decode, and
  every position keeps txHash/blockNumber for after-the-fact re-verification.

### Phase 4 — Remaining cleanup: DONE except one operator action

- **T2.7 APY:** Cosmos now derives live staking yield from the chain's own
  x/mint + x/staking modules (`baseYieldSource: "live"`, verified: 20.94%
  base on theta-testnet). Polygon/Moonbeam/Sui are labelled
  `"documented-schedule"`; Monad is labelled `"estimate"` — never shown as
  live.
- **T2.8 auto-compound keepers: REMAINING OPERATOR ACTION.** Executors are
  implemented and honestly self-report `skipped` with reasons when keys
  are unset. Activating them requires generating keeper keys, funding them
  from each testnet's faucet, and storing the secrets — external faucet
  access, not doable from this box. Set `AUTO_COMPOUND_KEEPER_KEY` (EVM)
  and the per-chain keeper secrets when provisioned.
- **P4.3 re-audit:** every surviving mock/stub/fake/placeholder hit is a
  Tier-3 honest fallback (source labels, gated local fixtures, react-query
  `placeholderData`) — none is a fabricated live path.

### §7 verification results

- health: `featuredAppRight: configured`, db/redis connected, rounds
  completing with `source=scan`.
- `mock_rewards|mulberry32|generateMockRecords` → 0 hits (this doc aside).
- `mockValidatorShare|MOCK_VALIDATOR_SHARE` in backend/frontend → only the
  ABI + flag-gated fixture paths.
- `force-accept|::precompile` → 0 source hits (stale `.next` build
  artifacts regenerate).
