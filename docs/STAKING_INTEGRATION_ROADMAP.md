# Staking Integration Roadmap — per-network production paths on the Canton ledger

Produced 2026-09-18 from a 107-agent deep-research pass (25 primary sources fetched,
124 claims extracted, top 25 adversarially verified 3-vote: **22 confirmed, 2 refuted,
1 unverified**). This document is the build plan for real staking on each supported
network, bound to the CantonStake flow: frontend tx → backend watcher → orchestrator →
Daml `StakingPosition` → FeaturedApp attribution.

## How to read this document

| Marker | Meaning |
|---|---|
| ✅ | Survived 3-vote adversarial verification (2/3 refutes needed to kill a claim) |
| ⚠️ | Unverified — extracted from primary docs during the fetch phase only; do **not** build on it without confirming |
| ❌ | **Refuted** by adversarial verification — do not implement as described |

**Coverage warning.** Verified claims exist only for **Polygon, Monad, BNB, Aptos**.
Cosmos Hub, Celestia, Osmosis, Polkadot, Solana, Sui — and every Canton-side topic
(JSON Ledger API party auth, exercise latency, idempotency) and CIP-0104 attribution —
have **zero verified claims**. Those sections are leads, not settled facts. A follow-up
research pass is required before implementing them (see [Build order](#build-order)).

Sources are overwhelmingly official primary docs plus live on-chain verification
(`eth_getLogs`/`eth_call` on BSC and Polygon, verified ABIs). Caveats: Aptos docs are
marked Beta; Monad's docs are young post-mainnet (mainnet Nov 2025).

---

## Cross-cutting rules (hold on every verified network)

1. **Value lives in share tokens whose exchange rates drift.** Polygon VOL/dPOL, BNB
   StakeCredit shares (measured 1.0219 on-chain), Monad and Aptos pool accounting — a
   watcher must read rates and events, never value positions from token balances alone,
   and a fixed-scale client produces drifting quotes.
2. **Every exit is a two-transaction, time-gated flow.** Open the exit, then a separate
   claim gated by epochs (Polygon, Monad) or days (BNB, Aptos lockup). The Daml
   `StakingPosition` lifecycle (`Bonded → Unbonding → Released`) maps 1:1 onto this.
3. **Every entry point carries slippage/precision/gas hazards.** Polygon
   `_minSharesToMint`, BNB lossy integer-division share conversion, Monad's
   all-gas-burning precompile calls — quoting and input validation must happen
   **off-chain**, before the user signs.

Per-network watcher modules should subscribe to the documented event sets and mirror
**value, not tokens**, onto the Canton ledger with idempotent two-phase position
lifecycles.

---

## 1. Polygon PoS — LIVE (verified ✅)

Settlement on Ethereum L1 (mainnet chainId 1; testnet Sepolia 11155111).
StakeManagerProxy `0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908` is the live canonical
contract through the Sept-2024 MATIC→POL migration and July-2025 Heimdall v2 fork.
One ValidatorShare contract **per validator**; the backend already discovers the
registry live (`backend/src/services/validator-share.ts`, served at
`/api/polygon/validator-shares`).

### Verified mechanics

- **Delegate:** `buyVoucher(uint256 _amount, uint256 _minSharesToMint)` on the
  ValidatorShare. Pays pending rewards first (`_withdrawAndTransferReward`), mints
  shares at the *execution-time* `exchangeRate()`, forwards funds via
  `stakeManager.delegationDeposit(validatorId, amountToDeposit, msg.sender)`.
  `_minSharesToMint` is a slippage guard (`"Too much slippage"` revert) — the client
  must quote shares off-chain and set a tolerance; **passing 0 disables the guard**.
  Post-POL mainnet also exposes `buyVoucherPOL` with the same mechanics. Post-POL
  validators become full ERC-20 (dPOL) under executed **PIP-69**, rollout targeted
  early 2026 — share-balance semantics are preserved.
- **Valuation:** position value = `shares × exchangeRate() / precision`. Precision is
  validator-dependent and client math MUST reproduce it:
  `EXCHANGE_RATE_HIGH_PRECISION = 10**29` for validatorId ≥ 8,
  `EXCHANGE_RATE_PRECISION = 100` for foundation validators (id < 8, constant rate,
  no slashing); `REWARD_PRECISION = 10**25` governs reward accounting. Our live
  implementation already handles this split (testnet validators 1–7 report rate 100).
- **Exit:** two-step, epoch-gated. `sellVoucher(claimAmount, maximumSharesToBurn)` —
  or **`sellVoucher_new`** — burns shares at the current rate, transfers accrued liquid
  rewards immediately, records `unbond.withdrawEpoch = stakeManager.epoch()`.
  `unstakeClaimTokens[_new]` reverts `"Incomplete withdrawal period"` until
  `withdrawEpoch + StakeManager.withdrawalDelay() <= epoch` (docs: 80 checkpoints,
  ~30 min each). The delay lives in **StakeManager**, not ValidatorShare. Production
  should use the `_new` variants (exits stored in `unbonds_new`, not hit by the legacy
  "Ongoing exit" re-delegation block — that guard only applies to the legacy
  `sellVoucher` path) and must **persist the unbondNonce** needed for the claim.
- **Watcher events:** StakingInfo logger events (`ShareMinted`,
  `ShareBurnedWithId`, `DelegatorUnstakeWithId`) — already implemented in
  `frontend/lib/chains/polygon.ts` `watchPosition`.

### ❌ Refuted — do not build on these

- "buyVoucher forwards to StakeManager, calls `updateValidatorState`, tracks
  per-delegator `amountStaked`" — vote 1-2. Rely on the verified ValidatorShare.sol
  text above instead.
- "reStake moves accumulated liquid rewards into active stake without minting shares
  (rate unchanged)" — vote 0-3. Do **not** build exact-restake bookkeeping on this
  description; verify `restake()` semantics against raw source before implementing.

### Hardening steps (next work on the live chain)

1. Frontend: quote shares via a static `exchangeRate()` call at quote time and pass
   `SHARE_SLIPPAGE_BPS`-derived `_minSharesToMint` (the constant already exists).
2. Backend: persist `unbondNonce` per position at sell time and drive
   `unstakeClaimTokens_new` from it; surface the epoch gate (`withdrawEpoch +
   withdrawalDelay()`) as `readyAt` instead of a fixed constant.
3. Watch PIP-69 dPOL rollout (early 2026): re-verify `buyVoucher` vs `buyVoucherPOL`
   routing and ERC-20 transferability implications for the UI.

---

## 2. Monad — verified ✅ (not yet production in this repo; watcher stub exists)

Native staking is a **protocol precompile at
`0x0000000000000000000000000000000000001000`** — not deployed bytecode. Entered only
via CALL with a Solidity ABI (`IMonadStaking`, pragma ^0.8.15). Mainnet Nov 2025;
interface unchanged through indexed 2026 data.

### Entry points

- `delegate(uint64 validatorId)` **external payable** — MON amount in `msg.value`
  (minimum `DUST_THRESHOLD` = 1 gwei). Selector `0x84994fec`.
- `undelegate(uint64 validatorId, uint256 amount, uint8 withdrawId)` — starts
  unbonding. Only **active** stake can be undelegated (pending delegations must wait
  until active).
- Withdraw is a separate later call against the (validator, delegator, withdrawId)
  request. Each pair supports **up to 256 concurrent in-flight withdrawals**; ids are
  reusable once the prior withdrawal completes → the orchestrator must allocate and
  track withdrawIds per position.

### Epoch timing

- Changes commit at a boundary block every **50,000 blocks**, then a 5,000-round
  `EPOCH_DELAY_ROUNDS` starts the new epoch. Submitted before the boundary → active in
  epoch n+1; after it (in the delay period) → n+2.
- **Rounds are not blocks** — they increment even on missed proposals. Read position
  via `getEpoch()`/precompile, never modular arithmetic on block numbers.
- Wall-clock epoch length is source-dependent (~4h12m in staking docs vs ~5.5h in the
  FAQ) — display ranges, not point estimates.
- ⚠️ **Unverified (1-0, 2 verifier infra errors):** exact claimable formula
  `n+1+WITHDRAWAL_DELAY` / `n+2+WITHDRAWAL_DELAY`, `WITHDRAWAL_DELAY = 1 epoch`
  (~4–5.5h). Substance corroborated by third-party providers; **test the formula
  on-chain before shipping the claim UX**.

### Backend hazards

- **Fork-testing cannot exercise the precompile** (no code at the address) — testnet
  or mainnet only.
- All view functions are declared **nonpayable** — CALL only, no STATICCALL /
  DELEGATECALL / CALLCODE.
- Calls with **invalid arguments consume ALL supplied gas** (applies to the
  malformed-input class; some business-rule violations revert with reasons) → validate
  inputs off-chain, size gas conservatively.
- EIP-7702 delegation designating the precompile makes every call revert; the account
  is always warm.

### Watcher events (verified ✅)

Nine-event set declared in `IMonadStaking`, present in tx receipts with indexed
fields: `ValidatorRewarded`, `ValidatorCreated`, `ValidatorStatusChanged`,
`Delegate(uint64 indexed validatorId, address indexed delegator, uint256 amount,
uint64 activationEpoch)`, `Undelegate` (adds `withdrawId`), `Withdraw`,
`ClaimRewards`, `CommissionChanged`, `EpochChanged`. Docs explicitly recommend
tracking delegators via these events.

### Implementation steps

1. Replace the watcher stub's assumptions with the nine-event subscription on the
   precompile address; decode `Delegate`/`Undelegate`/`Withdraw`.
2. Frontend tx builder: payable `delegate` with `msg.value`; withdrawId allocation
   service in the backend (next free slot per validator-delegator pair, reuse after
   withdraw).
3. On-chain test of the claimable-epoch formula before building the `readyAt` UX.

---

## 3. BNB Chain — verified ✅ (watcher stub exists)

Staking goes through the **StakeHub system contract at the fixed reserved address
`0x0000000000000000000000000000000000002002`** (live mainnet bytecode verified,
94,176 bytes, contains the delegate selector).

### Entry points

- `delegate(address operatorAddress, bool delegateVotePower)` **external payable** —
  BNB in `msg.value`, forwarded into the validator's per-validator **StakeCredit**
  contract (`IStakeCredit(creditContract).delegate{value:...}` in bsc-genesis-contract
  StakeHub.sol). Minimum delegation enforced via `minDelegationBNBChange`. Selector
  `0x982ef0a7`. (BEP-294 adds a parallel credit-token route — `stakeTo` /
  `delegateCredit` — as a complement.)
- `undelegate(address operatorAddress, uint256 shares)` **non-payable** — consumes
  credit-contract **shares, not BNB**. The dApp must convert the user's BNB position
  via the per-validator credit contract's `getSharesByPooledBNB` /
  `getPooledBNBByShares` — a **lossy integer-division** conversion (delegating 1 BNB
  and immediately undelegating recovers ~1−1e-18 BNB). Shares ≠ BNB: measured live
  ratio 1.0219, drifting because rewards auto-compound daily into pooled BNB.
- Withdraw is a **separate second transaction**: `claim(address operatorAddress,
  uint256 requestNumber)` or `claimBatch(address[], uint256[])`, emitting
  `Claimed(operatorAddress, delegator, bnbAmount)`. The **requestNumber must come
  from StakeHub's `undelegations`/`undelegationInfo` view state, not from the
  Undelegated event**; the BNB transfer executes in the validator's StakeCredit.
- `StakeHub.unbondPeriod()` returned 604800s = **exactly 7 days today**, governance
  bounded 3–30 days → read it on-chain, never hardcode.

### Watcher events

StakeHub provides **no on-chain view of a user's total staked history** — initial
delegation amounts are not saved on-chain; the official FAQ says an off-chain service
must index **`Delegated`, `Redelegated`, `Undelegated`** (vote 2-1, medium
confidence). `Undelegated` emits both shares removed **and the corresponding
`bnbAmount`** explicitly — read the BNB equivalent per event instead of independently
tracking the rate. Credit-contract-level unbond/claim activity may emit additional
events beyond this set; index `Claimed` too.

### Implementation steps

1. Watcher: subscribe to Delegated/Redelegated/Undelegated on `0x…2002` + Claimed on
   StakeCredit contracts; decode `bnbAmount` directly from Undelegated.
2. Frontend: shares conversion via `getSharesByPooledBNB` at quote time; accept the
   dust loss; surface it in the UI.
3. Backend: persist `requestNumber` from `undelegationInfo` per undelegation; drive
   `claim` from it after `unbondPeriod()` (read live, cache with short TTL).

---

## 4. Aptos — verified ✅ (watcher stub exists)

Direct staking to a **validator stake pool** requires **1,000,000 APT minimum**
(max 50,000,000) — the hypothesized "min 1k APT" matches no documented minimum.
Retail-scale goes through **delegation pools**: **10 APT** per-delegator minimum plus
a small mostly-refunded add-stake fee (some UIs use 11; subsequent add-stakes can be
as small as 0.1 APT). A delegation pool only earns rewards once it reaches
1,000,000 APT cumulative to enter the active validator set — below that there are no
rewards to track.

### Lockup (effective unbonding)

Mainnet enforces a **recurring 14-day lockup** (`recurring_lockup_duration_secs`,
governance-set via AIP-94): unlock can be requested any time, but **no staked funds
are withdrawable until the current lockup expires** → effective unbonding 0–14 days
depending on unlock timing. A 2025–2026 AIP sweep found no change; a Feb 2026
reward-rate cut proposal exists — parameters are governance-variable, read/monitor
them.

### Custody model (critical for the orchestrator)

Stake pools separate **Owner / Operator / Voter** personas via the `OwnerCapability`
resource: only the **owner** can add/unlock/withdraw funds and extend lockup. →
The backend **cannot move stakes on user accounts it does not own**; delegation and
unlock must be signed by the user's own Aptos account (self-custody preserved; the
backend can only watch). Gotcha: when a staker unlocks **any** amount, the **full
commission** earned is unlocked (not proportional) — and requesting commission before
lockup end also triggers commission unlock.

### Implementation steps

1. Wallet flow: user-signed `add_stake`/`unlock`/`withdraw` on the delegation pool
   module (user is owner); backend never signs.
2. Watcher: delegation-pool events (add/unlock/withdraw) via Aptos fullnode event
   streams — ⚠️ event types and indexing endpoints are unverified; confirm against
   aptos.dev (docs marked Beta).
3. UI: show lockup-expiry-based `readyAt` (0–14d window), read
   `recurring_lockup_duration_secs` live.

---

## 5. Cosmos family — Cosmos Hub, Celestia, Osmosis — ZERO verified claims ⚠️

The watcher-level integration exists in-repo (config-per-network Cosmos watcher,
`backend/src/multichain-watcher.ts`; see `docs/CHAIN_EXPANSION_RESEARCH.md` §6), but
none of the production integration claims below were adversarially verified. Treat as
unresearched.

- ⚠️ Keplr/Leap wallet signing: `getOfflineSigner(chainId)` returns a single signer
  implementing both OfflineAminoSigner and OfflineDirectSigner, consumed by
  `SigningStargateClient` for `MsgDelegate`/`MsgUndelegate` (docs.keplr.app).
  Pitfall: `window.keplr` is undefined at page load — await initialization.
- ⚠️ Celestia is a Cosmos SDK / CometBFT chain with in-protocol delegation (initial
  validator set of 100) — same `MsgDelegate` message family as Cosmos Hub, no
  separate contract (docs.celestia.org, updated 2026-09-03). The repo's 24h
  theta-testnet unbond constant applies to Celestia testnet only; Cosmos Hub
  mainnet is 21 days.
- ⚠️ Tendermint's legacy WebSocket subscribe/unsubscribe JSON-RPC was deprecated in
  v0.36 and slated for removal in v0.37 — do not build a long-term production watcher
  on it; use the CometBFT RPC event subscription path current for the target chain.
- **Osmosis: nothing fetched even at lead level.** Lockable positions (osmosis
  lockup module) were named in the research question but produced no extracted
  claims. Full follow-up pass needed.

**Before implementing:** verify per chain — message types and gas, unbond period
(governance-variable), event/tx indexing for the watcher (CometBFT RPC vs
gRPC-enabled node), and Keplr chain-registry metadata.

---

## 6. Polkadot — ZERO verified claims ⚠️

- ⚠️ Nomination pools admit members with as little as **1 DOT**; direct nomination
  requires **250 DOT** — pools are the low-minimum self-custodial path
  (wiki.polkadot.com). Both routes share the same staking returns.
- ⚠️ Unbonding is era-based (28 eras ≈ 28 days from general Polkadot knowledge —
  **not verified in this pass**); pools add a separate `pool_withdraw` step after
  `pool_unbond` (matching the two-transaction pattern).
- The repo has a watcher stub; production path (pooled vs direct, signing via
  Polkadot{.js}/PAPI, event indexing) is unresearched. **Verify era timing and the
  pool call sequence before building.**

---

## 7. Solana — ZERO verified claims ⚠️

Two candidate paths; unverified leads from the fetch phase:

- **Native stake accounts:** a stake account delegates to a **single validator**;
  spreading stake requires multiple accounts (split/merge, authorities reusable).
  Delegation/deactivation advance only at **epoch boundaries (~2 days)** in
  fractional warm-up/cool-down steps; after `deactivate-stake` the stake stays locked
  for several cooldown epochs. Partial unstake = split the active stake account first
  (docs.solana.com, docs.anza.xyz, docs.kiln.fi).
- **Liquid pools:** SPL Stake Pool program `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`
  on mainnet-beta and testnet (devnet uses a separate stale-free address); JitoSOL
  deposit via the pool's `DepositSol` instruction (index 14, withdraw-authority PDA
  derivation required); Marinade `marinade.deposit(amountLamports)` /
  `liquidUnstake(amountLamports)` via marinade-ts-sdk.
- The repo watcher stub watches native stake accounts. **Verify:** epoch-boundary
  activation math, rent-exempt minimums, deactivation→withdrawable window, and which
  pool (if any) to support before implementing the Daml mirror.

---

## 8. Sui — ZERO verified claims ⚠️

- ⚠️ Delegation executes through the `sui_system` entry function
  **`request_add_stake`** (shared `SuiSystemState`, `Coin<SUI>`, validator address)
  via `moveCall`; `request_add_stake_mul_coin` accepts `vector<Coin<SUI>>` +
  `Option<u64>` (docs.sui.io framework reference).
- ⚠️ Staking pools are embedded per validator in the system state object; **newly
  requested stake starts earning at the beginning of the next epoch**, not
  immediately. Unbond (timelocked/staked Sui withdrawal) flow unverified.
- ⚠️ Official fullnodes: `https://fullnode.mainnet.sui.io:443` /
  `https://fullnode.testnet.sui.io:443` (+ testnet faucet). Note: the repo's Sui
  watcher currently reports "unreachable" — endpoint reachability itself needs fixing
  before any of this.

---

## 9. Canton ledger binding — ZERO verified claims ⚠️ (design-critical)

The orchestrator's binding to the ledger is implemented in-repo
(`backend/src/canton.ts`, `orchestrator.ts`) against the dev LocalNet, but the
production topics were not verified:

- ⚠️ JSON Ledger API v2: synchronous `POST /v2/commands/submit-and-wait` blocks until
  the command commits and returns `{"updateId": "...", "completionOffset": N}` —
  this defines the latency/confirmation model for event-driven mirroring
  (docs.canton.network JSON API reference).
- ⚠️ Canton 3.x: the JSON API is embedded in the participant node (HTTP/JSON → gRPC
  Ledger API v2), default port 7575, authenticated with **JWT Bearer** tokens — party
  auth is an OIDC-valid bearer token per request, not a separate service.

**Open (must be researched/answered before mainnet-grade mirroring):**

1. Party authorization model for a backend orchestrator acting for the App Provider
   party (token minting/refresh, multi-party, admin endpoints).
2. Expected `submit-and-wait` latency under load and its impact on watcher → ledger
   backpressure.
3. **Idempotency pattern for at-least-once event delivery**: how to key exercises
   (`RecordStake` on `StakingPosition`) on tx-hash/contract-id so chain reorgs and
   duplicated webhook events cannot double-mirror; how to detect a ledger-side partial
   failure after a commit.

---

## 10. CIP-0104 attribution — ZERO verified claims ⚠️ (possible design break)

⚠️ Two unverified fetch-phase leads, sourced from the CIP repo and docs.canton.network,
that **contradict our current marker-based design**:

- CIP-0104 (created 2026-01-29, approved 2026-02-12) reportedly **removes Featured-App
  activity markers (AppActivityRecord-based attribution) in favor of rewards computed
  off-ledger from actual network traffic (fees) burned by an app provider's confirmed
  transactions**, using sequencer and mediator data, with **RewardCouponV2** contracts
  replacing per-transaction activity markers — and "no application code changes
  required".
- Earning still requires holding a **`FeaturedAppRight` granted through DSO
  governance** (`DsoRules_GrantFeaturedAppRight`); app confirmers are determined at
  the time each mining round opens; there are **no user-activity metrics or
  thresholds** in the CIP itself.

**Action:** this must be reconciled with the repo's `FeaturedAppActivityMarker`
emission path (splice-api-featured-app-v1) and the `demo-stub`
`FEATURED_APP_RIGHT_CID` sentinel before any mainnet rewards expectation. If
RewardCouponV2/traffic-based rewards are live on mainnet, markers may be legacy and
the roadmap's CC-revenue step changes from "emit markers" to "generate confirmed
traffic + hold a FeaturedAppRight". **Verify against the merged CIP text and current
Splice release before building anything new here.**

---

## Open questions (from the research pass)

1. Verified integration paths for the six uncovered networks (Cosmos Hub, Celestia,
   Osmosis, Polkadot, Solana, Sui).
2. Canton binding: JSON Ledger API party auth, `RecordStake` exercise latency,
   idempotency for event-driven mirroring (reorgs, at-least-once).
3. CIP-0104: what a Featured App must actually implement to earn CC (registration,
   thresholds, sequencer-side requirements) under the traffic-based model.
4. A standardized per-network risk policy for slippage and gas (Polygon
   `_minSharesToMint` tolerance, BNB share-conversion dust, Monad all-gas-burn
   buffers + 256-slot withdrawId allocation) and how exchange-rate revaluation events
   surface to the Daml ledger.

---

## Build order

**Phase 0 — close the research gaps (blocking).** Re-run the deep-research pass
scoped to: the six uncovered networks, Canton JSON API binding topics, CIP-0104
current state. Nothing below Phase 1 requires it; everything from the Cosmos family
on does.

**Phase 1 — Polygon hardening (live chain, verified).** Off-chain share quoting +
`_minSharesToMint`; persist unbondNonce; `sellVoucher_new` / `unstakeClaimTokens_new`;
epoch-gated `readyAt`; PIP-69 watch.

**Phase 2 — Monad.** Precompile tx builder (payable delegate, conservative gas,
off-chain validation), nine-event watcher, withdrawId allocation service, on-chain
test of the claimable-epoch formula.

**Phase 3 — BNB.** StakeHub watcher (Delegated/Redelegated/Undelegated + Claimed),
shares conversion at quote time, requestNumber persistence + live `unbondPeriod()`.

**Phase 4 — Aptos.** User-signed delegation-pool flow (owner-only moves), event
watch, live lockup read for `readyAt`.

**Phase 5 — Cosmos family (after Phase 0).** Cosmos Hub first (21d unbond, largest
overlap with the existing config-per-network watcher), then Celestia (same message
family), then Osmosis (needs its own research).

**Phase 6 — Polkadot → Solana → Sui (after Phase 0).** Polkadot nomination pools
(1 DOT minimum) as the likely path; Solana native stake accounts vs an SPL pool
decision; Sui last (watcher endpoint first).

---

## Appendix A — refuted and unverified claims (do-not-build list)

| Claim | Vote | Disposition |
|---|---|---|
| buyVoucher calls `updateValidatorState` and tracks `amountStaked` for liquid rewards | 1-2 ❌ | Use verified ValidatorShare.sol text (§1) |
| `reStake` moves liquid rewards into active stake without minting shares, rate unchanged | 0-3 ❌ | Verify `restake()` against raw source before any restake bookkeeping |
| Monad claimable at `n+1+WITHDRAWAL_DELAY` / `n+2+WITHDRAWAL_DELAY`, delay = 1 epoch | 1-0, 2 errored ⚠️ | Low risk (corroborated), but test on-chain before shipping claim UX |

## Appendix B — primary sources (fetched, claim counts)

- Polygon: docs.polygon.technology/pos/reference/contracts/delegation; github.com/maticnetwork/contracts `ValidatorShare.sol`
- Monad: docs.monad.xyz/reference/staking/overview; docs.monad.xyz/developer-essentials/staking/staking-precompile
- BNB: docs.bnbchain.org/bnb-smart-chain/staking/developer-guide/; bscscan.com/address/0x…2002
- Aptos: aptos.dev/network/blockchain/staking; aptos.dev delegation-pool-operations
- Sui: docs.sui.io sui_system + staking_pool references; sdk.mystenlabs.com
- Solana: solana.com/docs/references/staking/stake-accounts; docs.anza.xyz; spl.solana.com/stake-pool; jito.network; github.com/marinade-finance/marinade-ts-sdk; docs.kiln.fi
- Cosmos family: docs.keplr.app/api/use-with/cosmjs; docs.tendermint.com subscription; wiki.polkadot.com nomination pools; docs.celestia.org staking
- Canton: github.com/canton-foundation/cips cip-0104; docs.canton.network tokenomics / M4 JSON API tutorial / JSON API reference

*(Fetch-phase only for the last four groups — claims not adversarially verified.)*
