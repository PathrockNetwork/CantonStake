# Staking Integration Roadmap — per-network production paths on the Canton ledger

Produced 2026-09-18 from a 107-agent deep-research pass (25 primary sources fetched,
124 claims extracted, top 25 adversarially verified 3-vote: **22 confirmed, 2 refuted,
1 unverified**), then **extended 2026-09-19 by a three-run parallel follow-up pass**
(305 further agents; 75 claims taken to verification: **67 confirmed, 3 refuted,
5 left unverified by verifier infra errors**). This document is the build plan for
real staking on each supported network, bound to the CantonStake flow: frontend tx →
backend watcher → orchestrator → Daml `StakingPosition` → FeaturedApp attribution.

## How to read this document

| Marker | Meaning |
|---|---|
| ✅ | Survived 3-vote adversarial verification (2/3 refutes needed to kill a claim) |
| ⚠️ | Unverified — extracted from primary docs during the fetch phase only; do **not** build on it without confirming |
| ❌ | **Refuted** by adversarial verification — do not implement as described |

**Coverage after the follow-up pass.** Verified ✅: **Polygon, Monad, BNB, Aptos,
Cosmos Hub, Celestia (core), Polkadot, Solana (native stake accounts), the Canton
JSON Ledger API binding (except latency), and the CIP-0104 spec**. Still unverified
⚠️: **Sui (zero surviving claims across both passes)**, the Osmosis lockup/superfluid
modules and family-wide gas/fee/endpoint details, the Solana liquid-pool comparison
(+ rent-exempt figure, epoch length), the Polkadot signing flow and watcher event
indexes, empirical Canton submit-and-wait latency (+2 orphaned sub-claims), and
CIP-0104 **mainnet activation**. Those subsections are leads, not settled facts.

Sources are overwhelmingly official primary docs plus live on-chain verification
(`eth_getLogs`/`eth_call` on BSC and Polygon, verified ABIs, live RPC/storage reads
on cosmoshub-4/celestia/osmosis/Asset Hub/mainnet-beta on 2026-09-18/19). Caveats:
Aptos docs are marked Beta; Monad's docs are young post-mainnet (mainnet Nov 2025);
verification sessions exhausted web-search budgets, so most follow-up claims rest on
direct primary-source fetches + live chain reproduction rather than a broad web-wide
contradiction sweep.

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
- ✅ **Claimable formula (verified 2-0 in the 2026-09-19 follow-up pass, verbatim
  from docs.monad.xyz/reference/staking/api):** stake undelegated in epoch n becomes
  withdrawable in epoch **n + 1 + WITHDRAWAL_DELAY** if the request lands before the
  boundary block, else epoch **n + 2 + WITHDRAWAL_DELAY**; constants confirmed:
  `WITHDRAWAL_DELAY = 1 epoch`, boundary period `BOUNDARY_BLOCK_PERIOD = 50,000
  blocks`. Still smoke-test the `withdraw` path on-chain before shipping claim UX.

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
3. On-chain smoke test of the now-verified claimable formula's `withdraw` path
   before building the `readyAt` UX.

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

## 5. Cosmos family — Cosmos Hub + Celestia verified ✅, Osmosis partial ⚠️ (follow-up pass 2026-09-19)

The watcher-level integration exists in-repo (config-per-network Cosmos watcher,
`backend/src/multichain-watcher.ts`; see `docs/CHAIN_EXPANSION_RESEARCH.md` §6). The
follow-up pass verified delegation and watcher mechanics against primary docs plus
live chain state on cosmoshub-4, celestia, and osmosis (2026-09-18/19). All params
below were live-queried that day and are governance-changeable on Cosmos Hub and
Osmosis (Celestia's requires a hardfork).

### Verified mechanics

- **Wallet signing (3-0 ×4):** `window.keplr` may be undefined at page load — wait
  for document load and check before any call (undefined after load = not
  installed). Flow: `enable(chainId)` (unlocks + prompts permission for one or more
  chain-ids; throws on cancel) → `getOfflineSigner(chainId)` → `getAccounts()` →
  pass the signer into a CosmJS client. Keplr's own doc example uses the legacy
  Launchpad `SigningCosmosClient` — use **`SigningStargateClient`** for
  cosmoshub-4.
- **Sign mode (3-0 ×2):** `getOfflineSigner(chainId)` returns one signer satisfying
  BOTH the amino `OfflineSigner` and the protobuf `OfflineDirectSigner`;
  `SigningStargateClient` signs **`SIGN_MODE_DIRECT` by default** (it routes by
  `isOfflineDirectSigner(signer)` — there is no sign-mode override parameter).
  Ledger Cosmos accounts cannot sign protobuf docs → use
  `getOfflineSignerAuto` / `getOfflineSignerOnlyAmino` for them.
- **CosmJS (3-0 ×2):** `@cosmjs/stargate`'s default registry already maps
  `/cosmos.staking.v1beta1.MsgDelegate`, `MsgUndelegate`, and
  `/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward` (with
  delegateTokens/undelegateTokens/withdrawRewards helpers). Node 20+, browsers,
  extensions; Webpack 5 needs a Buffer ProvidePlugin plus
  buffer/crypto/events/path/stream/string_decoder fallbacks. The repo is in
  **maintenance mode** — plan for community maintenance of the dependency.
- **Watcher subscription (3-0 ×3, 2-0 ×2) — corrects the pass-1 note:** CometBFT's
  JSON-RPC **`subscribe`/`unsubscribe` over WebSocket at `<node>:26657/websocket`
  IS the currently supported watcher path**. The "deprecated in Tendermint v0.36"
  premise was wrong — it was an internal Go-interface refactor, and CometBFT
  (forked at v0.34) never shipped a v0.36. Live-verified end-to-end on all three
  chains, including a cosmoshub-4 subscription on
  `tm.event='Tx' AND message.action='/cosmos.staking.v1beta1.MsgDelegate'` that
  streamed 2 real delegations in 40s. The same composite-key query syntax
  (`{eventType}.{eventAttribute}={eventValue}`) works for WS subscribe, `tx_search`,
  and `block_search`. Gotchas: event notifications no longer echo the query field
  (detect by absent id + `data.type`); EndBlock events are not per-tx — read
  `block_results`/`finalize_block_events`; the kv tx indexer is default but flagged
  for possible future deprecation; **most public providers reject anonymous WS
  subscriptions** (polkachu HTTP 400, cosmos.directory no-ack, rpc.cosmos.network
  HTTP 525 during testing) → a production watcher needs a dedicated node or a
  WS-guaranteed provider.
- **Message surface (2-1):** released x/staking is exactly seven messages —
  MsgCreateValidator, MsgEditValidator, MsgDelegate, MsgUndelegate,
  MsgCancelUnbondingDelegation, MsgBeginRedelegate, MsgUpdateParams.
  **`MsgWithdrawDelegatorReward` belongs to x/distribution**, not x/staking —
  delegate + withdraw-rewards flows integrate two modules.
- **Delegation mechanics (3-0):** MsgDelegate mints shares at the current exchange
  rate; MsgUndelegate reduces shares immediately and creates an
  `UnbondingDelegation` with `completion_time = block time + UnbondingTime`
  (returned in `MsgUndelegateResponse` — this is the `readyAt` source).
  `MsgCancelUnbondingDelegation` (SDK v0.46+) cancels an in-flight unbond fully or
  partially back to the same validator (needs the original `creation_height`). A
  second unbond at the same creation height keeps the earlier completion_time
  rather than resetting.
- **Event types for the watcher (2-1):** tx-time typed events `delegate`
  (validator, amount), `unbond` (validator, amount, **completion_time RFC3339**),
  `redelegate`, `cancel_unbonding_delegation` (creation_height); maturity emits
  `complete_unbonding` (amount, validator, delegator) at EndBlock (a block event,
  not a tx event). `message.action` carries the **full MsgTypeURL** on SDK
  v0.50.x-era chains (e.g. `/cosmos.staking.v1beta1.MsgUndelegate`) — the legacy
  `begin_unbonding` action string matches zero mainnet txs (refutation probe);
  filter on typed events, never legacy action strings.

### Unbonding periods — live-verified, chain-specific (3-0)

`UnbondingTime` is a chain parameter, not a protocol constant. Live
`/cosmos/staking/v1beta1/params` on 2026-09-19:

| Chain | UnbondingTime |
|---|---|
| Cosmos Hub (cosmoshub-4) | 1814400s = **21 days** |
| Celestia (celestia) | 1213200s ≈ **14.04 days** |
| Osmosis (osmosis) | 1209600s = **14 days** |

Track each entry's `completion_time` instead of hardcoding. Two refuted traps: the
Cosmos SDK README's own examples show conflicting values (3d / 21d / 28d) — only
live params are authoritative — and the competing claim that Cosmos Hub's 21 days
was "only a doc example, not live chain state" was refuted 0-3.

### Celestia specifics (all 3-0)

- Unbonding 1213200s (~14.04 days) at app version 10 — **hardfork-required to
  change** (not governance-variable as on Cosmos Hub/Osmosis).
- **Since CIP-30 (Final, Feb 2025), undelegate/redelegate no longer auto-claims
  rewards** — rewards accrue in x/distribution until the user explicitly sends
  `MsgWithdrawDelegatorReward`. The watcher cannot assume payout on unbond events
  and must index or trigger withdrawals separately.
- Active validator set **structurally capped at 100** (`max_validators=100`, 99
  bonded live at verification); delegation rides the standard message family.
- **No first-party public mainnet RPC** — official docs route production access to
  SLA providers (Grove, Numia, QuickNode) and explicitly warn against free
  community endpoints for production. A Celestia mainnet watcher needs an SLA
  provider or must accept unguaranteed community endpoints.
- Mocha testnet is now **mocha-5** — a hardspoon of mocha-4 after mocha-4's
  2026-09-01 shutdown (celestia-app v9.0.7). Update any config still referencing
  mocha-4.

### Osmosis — partial ⚠️

OSMO delegation is standard MsgDelegate; UnbondingTime live-verified at 14 days;
the publicnode WS endpoint works. **Nothing on the x/lockup module (locktokens
positions, epoch-based unbonding durations) or superfluid staking survived
verification** — that portion remains unresearched; do not build lockup-position
mirrors on assumptions.

**Still unverified across the family:** per-chain gas/fee defaults and transaction
minimums, bech32 prefix details (valoper/valcons), the full mainnet+testnet endpoint
sets, and whether Keplr/Leap ship built-in chain configs for celestia/mocha/osmosis.

---

## 6. Polkadot — verified ✅ (follow-up pass 2026-09-19; signing flow + event indexes still open)

All values below were live-read from chain state on 2026-09-19 at spec 2005000,
**shortly after the staking migration to Asset Hub** — most existing guides predate
it and are stale.

- **⚠→✅ Staking lives on Asset Hub ("Staking Hub"), not the relay chain.**
  Verified by on-chain evidence across multiple verifier sessions: the relay exposes
  **no staking pallet at all** (`staking.activeEra = None`,
  `counterForPoolMembers = 0`, MinJoinBond/MinNominatorBond storage unset), while
  Asset Hub (`polkadot-asset-hub-rpc.polkadot.io`, specName `statemint`) carries all
  staking and nomination-pool storage, constants, and extrinsics. **CantonStake
  watchers must read staking state and submit staking calls against Asset Hub
  endpoints.** (Synthesized from live chain state rather than a standalone voted
  claim — but chain state is the stronger evidence class here.)
- **Minimums (live-read from Asset Hub):** nomination-pool join **1 DOT**
  (`NominationPools.MinJoinBond = 10^10` planck), direct nomination **250 DOT**
  (`Staking.MinNominatorBond = 2.5×10^12` planck), pool creation **500 DOT**
  (`MinCreateBond = 5×10^12`). Practical note: exactly 1.00 DOT total will **not**
  succeed — the joiner needs the 1 DOT bonded plus a small fee balance above the
  0.01 DOT existential deposit. ❌ The pallet-rustdoc worked example implying "2 DOT
  total to join" is refuted 0-3 (it assumes a 1 DOT ED; live ED is 0.01 DOT).
  Pools are the low-minimum self-custodial path; both routes share the same
  staking returns.
- **No fixed minimum guarantees direct-nomination rewards (3-0):** the *minimum
  active nomination* is a dynamic per-era value (snapshot ~238.66 DOT, currently
  below the 250 DOT intent floor) set by the lowest-ranked electing nominator in an
  election capped at ~22,500 nominators. **Read it from chain state every era;
  never hard-code.**
- **Era timing (3-0 ×2):** one era is exactly 24 h by runtime constants
  (`SessionsPerEra = 6` × `Babe.EpochDuration = 2400` slots × 6 s); measured Asset
  Hub pacing ran ~24.3–24.9 h/era, so real-world unbond is ~28.3 days.
  Multi-chain note: Kusama's `bondingDuration` is now 28 eras = **7 days** at its
  6 h eras (not the historical 7 eras) — era-to-day conversion must use each
  chain's era length.
- **Unbond timing (3-0, 3-0, 2-1):** `Staking.BondingDuration = 28` eras
  (live-decoded from metadata) before funds are withdrawable — identical for pool
  members and direct nominators. Withdrawability requires the era boundary to pass
  **plus a withdraw call** (the two-transaction exit pattern).
- **Pool-member lifecycle (3-0, 3-0, 2-1, 2-0):** `join` → `bond_extra` (top-up;
  `bond_extra_other` is the permissionless variant) → `claim_payout` /
  `claim_payout_other` (rewards) → `unbond` (exit) → **`withdrawUnbonded`**
  (snake_case `withdraw_unbonded`) once the bonding duration passes. **The name
  `pool_withdraw` does not exist in live metadata** (0 occurrences in decoded spec
  2005000) — it was renamed `withdraw_unbonded` in the delegate-stake migration;
  `pool_withdraw_unbonded` is a *different*, permissionless call on the pool's
  bonded account. A pool only nominates validators after its root or nominator
  calls `nominate`.
- **Rewards are never automatic (3-0, 2-0):** a payout must be submitted per
  validator-era; anyone can trigger it permissionlessly (`claim_payout` for pool
  members; `payoutNominators`/`payoutStakersByPage` for direct staking), and
  rewards unclaimed for **84 eras (~84 days) are lost**. A backend orchestrator
  must submit payout calls itself or rely on validator payout bots.
- **Still unverified:** the wallet-signing flow (`@polkadot/extension-dapp` vs
  PAPI metadata assumptions post-migration), concrete watcher event indexes
  (e.g. `PayoutStarted`/`Joined`/`Bonded`/`Withdrawn` vs per-era storage polling on
  Asset Hub), and endpoint rate limits. The repo watcher stub targets none of this
  yet.

---

## 7. Solana — native path verified ✅ (follow-up pass 2026-09-19); liquid pools still ⚠️

### Native stake accounts (verified)

- **Program + instruction set (3-0, 2-1):** the Stake program
  `Stake11111111111111111111111111111111111111` (executable on mainnet since
  genesis) enables **exactly 17 instructions**: Initialize(+Checked),
  Authorize(+Checked/WithSeed), DelegateStake, Deactivate, DeactivateDelinquent,
  Merge, Split, Withdraw, SetLockup(+Checked), MoveLamports, MoveStake,
  GetMinimumDelegation. An 18th enum variant, Redelegate, exists but is deprecated
  ("will not be enabled").
- **Two-authority model (3-0 ×2):** stake accounts carry two signing authorities
  set at creation — the **stake authority** signs DelegateStake, Deactivate, Split,
  and Merge; **only the withdraw authority** signs Withdraw (moving un-delegated
  lamports to a wallet) and authority re-assignment via Authorize (AuthorizeChecked
  variants additionally need the new authority's signature). Either authority can
  set a new stake authority. A self-custodial wallet must model both roles.
- **One validator per account (3-0):** a stake account delegates to a single
  validator (the Stake state holds exactly one Delegation/voter_pubkey) —
  delegating fractions or to multiple validators requires **Split** into multiple
  accounts. This is the core design constraint that makes liquid pools multi-account.
- **Epoch-boundary activation/deactivation (3-0 ×2):** fractions of the delegation
  become active/inactive at epoch boundaries at up to ~25%/epoch warm-up/cool-down
  rates (subject to network-wide congestion) — no instant activation, no instant
  withdrawability. **Withdraw releases only unstaked lamports**: while
  `epoch < deactivation_epoch` the full delegated amount plus the rent-exempt
  reserve stays locked. Typical small-stake deactivation completes ~1 epoch after
  the Deactivate tx absent cooldown congestion.
- **`getStakeActivation` is gone (3-0 ×2, live-verified):** removed in **Agave
  v2.0** with no single-method replacement (live probe on api.mainnet-beta.solana.com
  returned Method not found, -32601). Documented replacement recipe:
  `getAccountInfo` the stake account + read the **StakeHistory sysvar**
  (`SysvarStakeHistory111…111`) + `getEpochInfo` for the current epoch, then derive
  activation with warm-up/cool-down-aware math (inactive = lamports − active −
  rent-exempt reserve). Reference implementation:
  github.com/solana-developers/solana-rpc-get-stake-activation. Third-party RPC
  providers may still expose it, but a backend targeting standard Agave endpoints
  cannot rely on it. **Our watcher must implement the derivation recipe.**

### Liquid pools — leads only ⚠️ (unverified)

SPL Stake Pool `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` deposit/withdraw
instructions, Marinade `marinade.deposit`/`liquidUnstake`, and Jito `DepositSol`
remain fetch-phase leads (solana-program.com, docs.marinade.finance,
jito.network) — **none adversarially verified**. Which path (native vs a pool)
fits the self-custodial + per-user Canton-mirror design is an open decision;
native accounts are the verified, auditable default.

**Still unverified:** the numeric rent-exempt minimum for stake accounts and the
~2-day epoch length (both asked, never verified); Solana watcher event/log indexes
vs polling `StakeState` activationEpoch/deactivationEpoch fields.

---

## 8. Sui — STILL zero verified claims after two passes ⚠️ (dedicated pass required)

Both the original pass and the 2026-09-19 follow-up produced **zero surviving
claims** for Sui — `request_add_stake`/`request_withdraw_stake` (and timelocked
variants), next-epoch activation semantics, unbond/claim timing, and
`fullnode.mainnet.sui.io:443` reachability/rate limits are entirely unverified. The
leads below are fetch-phase only (docs.sui.io was fetched both times; its claims
never survived the verifier gauntlet) — **do not build on any of them**:

- ⚠️ Delegation executes through the `sui_system` entry function
  **`request_add_stake`** (shared `SuiSystemState`, `Coin<SUI>`, validator address)
  via `moveCall`; `request_add_stake_mul_coin` accepts `vector<Coin<SUI>>` +
  `Option<u64>`.
- ⚠️ Staking pools are embedded per validator in the system state object; **newly
  requested stake starts earning at the beginning of the next epoch**, not
  immediately. Unbond (timelocked/staked Sui withdrawal) flow unverified.
- ⚠️ Official fullnodes: `https://fullnode.mainnet.sui.io:443` /
  `https://fullnode.testnet.sui.io:443` (+ testnet faucet). Note: the repo's Sui
  watcher currently reports "unreachable" — endpoint reachability itself needs
  fixing before any of this.

---

## 9. Canton ledger binding — verified ✅ (follow-up pass 2026-09-19, design-critical)

The orchestrator's binding to the ledger is implemented in-repo
(`backend/src/canton.ts`, `orchestrator.ts`) against the dev LocalNet. The follow-up
research pass verified the binding topics against live Canton 3.5.x docs and OpenAPI
spec 3.5.18 (fetched 2026-09-18). Findings below carry ✅ from 3-vote verification;
the open items at the end remain.

### Verified binding mechanics

- **Transport (3-0):** Ledger API v2 is exposed through **two bindings wrapping the
  same underlying services** — gRPC (HTTP/2 + protobuf) and JSON REST (HTTP/1.1).
  In Canton 3.x the JSON API runs **inside the participant node**, translating JSON
  HTTP into gRPC v2 calls: default **port 7575**, configured via the participant's
  `http-ledger-api` config section.
- **Auth (3-0 / 2-0 / 2-0):** both bindings authenticate with **RS256-signed JWTs
  obtained via OIDC**, passed as `Authorization: Bearer <token>` (WebSocket variant:
  `Sec-WebSocket-Protocol`); the token must validate against the deployment's
  configured OIDC provider. No primary doc documents token minting or the required
  claim schema — that is deployment-specific auth config. Canton also supports the
  classic **Daml JWT format** (actAs/readAs parties embedded in the token), so
  user-rights mediation below is one of two auth modes.
- **Party scoping for an orchestrator (3-0 / 2-0 / 2-0), two levels:**
  (a) with LAPI User authorization enabled, tokens are scoped per party:
  `/v2/interactive-submission/prepare` requires `readAs` for the submitting party;
  `execute` requires `actAs`/`executeAs`; the `actAs`/`readAs` in JsCommands must
  each be authorized by the token.
  (b) access is mediated by **participant users**: a connection authenticates as the
  user in its token-provider config; an admin user creates users and grants rights;
  the programmatically grantable `canReadAsAnyParty` + `canExecuteAsAnyParty` rights
  let **one orchestrator user act for all parties hosted on that participant**
  (scope: that participant's hosted parties only, not network-wide).
- **Writes (3-0 / 3-0 / 2-0):** every v1 create / exercise-by-id / exercise-by-key /
  create-and-exercise maps to **`POST /v2/commands/submit-and-wait`**, the operation
  wrapped as `CreateCommand` / `ExerciseCommand` / `ExerciseByKeyCommand` /
  `CreateAndExerciseCommand` elements of the `commands` array. Variants:
  `submit-and-wait-for-transaction` (full transaction data back; `-tree` deprecated)
  and `commands/async/submit`. **External parties** (user-signed flows) instead use
  `interactive-submission/prepare` → `execute` with `partySignatures` (execute is
  asynchronous and takes no plain commands). gRPC equivalents: `CommandService`
  (sync) vs `CommandSubmissionService` + `CommandCompletionService` (async).
- **Idempotency for at-least-once event-driven submission (3-0 / 2-0 / 3-0 / 2-0):**
  keyed on the **change ID = (user_id, act_as, command_id)** — an orchestrator must
  keep that triple stable across retries (e.g. `commandId` derived from the source
  tx hash + event id). Optional per-command `deduplicationPeriod`
  (`DeduplicationDuration{seconds,nanos}` | `DeduplicationOffset` | Empty); if
  omitted the participant assumes its configured maximum dedup time, and completions
  echo the actual window used (`DeduplicationPeriod1`) for auditing. A resubmission
  is a duplicate only if the server knows another command with the same change ID in
  that window; **a resubmitted command keeps generating rejections until the original
  submission completes (with rejection) or the effective period elapses since the
  original completion — whichever comes first**. This rejection-until-settled
  behavior is the correct "ledger-side partial failure" signal for a retry loop.
  **Dedup is only guaranteed when all commands go to the same participant node.**
- **Post-commit verification (2-0 / 2-0):** successful submit-and-wait completions
  carry `updateId` ("only set for successfully executed commands") plus a required
  int64 `offset` usable to resume a `CompletionStreamRequest`; the interactive
  execute-and-wait response requires both `updateId` and `completionOffset`.

### Still open before mainnet-grade mirroring

1. **`submit-and-wait` latency/throughput is documented NOWHERE** — plan
   measurements against the CantonStake deployment. (Fetch-phase lead, unverified:
   the Digital Asset ops guide documents *async* submission at 50–1000 ms/command,
   ~1 command/s single-threaded — use as an order-of-magnitude prior only.)
2. Exact OIDC/JWT minting config and required claim schema for a production
   participant (auth-services setup) — deployment-specific, must be configured and
   tested.
3. Two sub-claims left unverified by verifier infra errors (1 valid vote each,
   consistent with verified claims but not proven): (a) each retry carrying a fresh
   `submissionId` UUID while keeping the change ID stable; (b) `commandId` being a
   **required** top-level field of v2 JsCommands (vs optional v1 `meta.commandId`).
   Confirm both against the OpenAPI spec when implementing the retry loop.
4. Empirical latency under load → watcher→ledger backpressure sizing.

---

## 10. CIP-0104 attribution — spec verified ✅ (follow-up pass 2026-09-19; mainnet activation still unconfirmed)

The follow-up pass verified the raw CIP text verbatim
(github.com/canton-foundation/cips/blob/main/cip-0104/cip-0104.md, fetched
2026-09-18). The design-break suspicion is **confirmed at the spec level**:

- **Markers are gone in the spec (3-0):** CIP-0104 "Traffic-Based App Rewards"
  (Status: **Approved 2026-02-12**, still the approved unsuperseded CIP) replaces
  `FeaturedAppActivityMarker`/`AppRewardCoupon`-based attribution with traffic-based
  app activity records ingested by SV apps from **mediator verdicts (mediator scan
  API)** and a **new sequencer traffic scan API**; the splice-amulet Daml is changed
  so neither contract type is created anymore.
- **The app emits nothing (3-0):** reward credit is computed sequencer-side from
  envelope traffic, granted to app provider parties proportional to the envelope
  sizes on which they appear as confirmers (`per_app_traffic_weight` scales
  `envelope_traffic_cost` by total confirmation-request traffic over total
  app-envelope traffic and `num_app_confirmers`, times the right's
  `activityWeight`). The provider-party set is computed deterministically from
  `FeaturedAppRight`s **as of the time the mining round opens**; each confirmation
  request is attributed to the earliest round open when it was sequenced.
- **Earning requirements (2-0):** hold a `FeaturedAppRight` granted via the
  `DsoRules_GrantFeaturedAppRight` governance choice (optional `activityWeight`,
  default 1.0) and generate **confirmed sequencer traffic**. The implementation
  rewards featured apps only; rewards for unfeatured apps are deferred to a future
  CIP.
- **Issuance is thresholded and coupon-batched (2-0):** one app reward coupon per
  round per party whose minting allowance surpasses `appRewardCouponThreshold`
  (Amulet config, default **$0.5**), coupons valid `appRewardCouponLifetime`
  (default **24h**) from creation; sub-threshold rewards are **burned**.
- **Naming:** the CIP text says "app reward coupons" and **never uses the name
  "RewardCouponV2"** — that name is a Splice code-level name (fetch-phase evidence,
  unverified: current Splice main has `Splice.Amulet.RewardCouponV2` contracts whose
  doc comment says they are "currently only used for traffic-based app rewards",
  with off-ledger amounts detailed in `RewardAccountingV2`).

**Not answered by the spec (must be checked against live mainnet before relying on
revenue):** whether the traffic-based computation (rollout **increment 4** of a
5-step incremental rollout, with a mandatory **≥30-day delay** after increment 2)
is actually **activated on mainnet today**. Fetch-phase evidence points that way
(docs.canton.network tokenomics documents traffic-based rewards as the current
mechanism but notes SVs enable it per network by governance vote) — treat activation
as probable-but-unconfirmed. Adjacent flag: **CIP-0116** (Featured App Locking,
approved 2026-05-20) adds Canton-Coin-locking criteria for *retaining* Featured App
designation — relevant to ongoing eligibility.

**Action (unchanged in substance, now spec-backed):** reconcile the repo's
`FeaturedAppActivityMarker` emission path (splice-api-featured-app-v1) and the
`demo-stub` `FEATURED_APP_RIGHT_CID` sentinel with reality before any mainnet
rewards expectation. Under the traffic model the CC-revenue step is not "emit
markers" but "hold a FeaturedAppRight + generate confirmed traffic", plus a
coupon-claim cadence aware of the 24h coupon lifetime and $0.5 threshold.

---

## Open questions (remaining after the 2026-09-19 follow-up pass)

1. **Sui — everything.** Zero surviving claims across two passes: entry/withdraw
   call shapes, epoch semantics, unbond timing, fullnode reachability/rate limits,
   event indexing. Needs a dedicated research pass plus the watcher-endpoint fix.
2. **Osmosis lockup/superfluid** — locktokens positions, epoch-based unbonding,
   x/lockup + x/superfluid events; plus Cosmos-family-wide gas/fee defaults,
   transaction minimums, bech32 prefixes, and the full testnet endpoint sets.
3. **Solana** — native-vs-liquid decision (SPL Stake Pool / Marinade / Jito all
   unverified), the numeric rent-exempt minimum, the ~2-day epoch figure, and
   watcher design (stake-program logs vs polling StakeState fields).
4. **Polkadot** — signing flow on Asset Hub post-migration
   (`@polkadot/extension-dapp` vs PAPI metadata assumptions), concrete watcher
   event indexes vs per-era storage polling, endpoint rate limits.
5. **Canton binding** — empirical `submit-and-wait` latency/throughput under load;
   production OIDC/JWT minting config and claim schema; confirm the two orphaned
   sub-claims (fresh `submissionId` per retry; `commandId` required top-level in
   v2 JsCommands) against the OpenAPI spec when building the retry loop.
6. **CIP-0104** — is the traffic-based computation (rollout increment 4) actually
   activated on mainnet; deployed `appRewardCouponThreshold`/`Lifetime` values;
   what CIP-0116 CC-locking means for retaining the FeaturedAppRight.
7. A standardized per-network risk policy for slippage and gas (Polygon
   `_minSharesToMint` tolerance, BNB share-conversion dust, Monad all-gas-burn
   buffers + 256-slot withdrawId allocation) and how exchange-rate revaluation
   events surface to the Daml ledger.

---

## Build order

**Phase 0 — research gaps: DONE for everything except Sui/Osmosis-lockup (2026-09-19
follow-up pass).** Verified now: Cosmos Hub + Celestia mechanics, Polkadot (on Asset
Hub), Solana native stake accounts, the Canton binding and CIP-0104 spec. Residual
research items (Sui entirely, Osmosis lockup/superfluid, family gas/fee details,
Solana liquid-pool decision, CIP-0104 mainnet activation) do not block Phases 1–6
below.

**Phase 1 — Polygon hardening (live chain, verified).** Off-chain share quoting +
`_minSharesToMint`; persist unbondNonce; `sellVoucher_new` / `unstakeClaimTokens_new`;
epoch-gated `readyAt`; PIP-69 watch.

**Phase 2 — Monad.** Precompile tx builder (payable delegate, conservative gas,
off-chain validation), nine-event watcher, withdrawId allocation service, on-chain
smoke test of the verified claimable formula's `withdraw` path.

**Phase 3 — BNB.** StakeHub watcher (Delegated/Redelegated/Undelegated + Claimed),
shares conversion at quote time, requestNumber persistence + live `unbondPeriod()`.

**Phase 4 — Aptos.** User-signed delegation-pool flow (owner-only moves), event
watch, live lockup read for `readyAt`.

**Phase 5 — Cosmos family (unblocked).** Cosmos Hub first (21-day unbond
live-verified; largest overlap with the existing config-per-network watcher;
CometBFT WS subscribe + typed events per §5), then Celestia (same message family,
~14.04-day hardfork-pinned unbond, CIP-30 no-auto-claim, SLA-provider RPC
required), then Osmosis standard delegation (14d) — lockup/superfluid positions
wait for their own research.

**Phase 6 — Polkadot → Solana → Sui (Polkadot/Solana unblocked, Sui blocked).**
Polkadot nomination pools (1 DOT) against **Asset Hub** endpoints with the
`withdrawUnbonded` lifecycle + payout-orchestration duty (§6); Solana native stake
accounts with the activation-derivation recipe replacing the removed
`getStakeActivation` (§7); Sui last — needs both a dedicated research pass and the
watcher endpoint fix before any build work.

---

## Appendix A — refuted and unverified claims (do-not-build list)

| Claim | Vote | Disposition |
|---|---|---|
| buyVoucher calls `updateValidatorState` and tracks `amountStaked` for liquid rewards | 1-2 ❌ | Use verified ValidatorShare.sol text (§1) |
| `reStake` moves liquid rewards into active stake without minting shares, rate unchanged | 0-3 ❌ | Verify `restake()` against raw source before any restake bookkeeping |
| Monad claimable at `n+1+WITHDRAWAL_DELAY` / `n+2+WITHDRAWAL_DELAY`, delay = 1 epoch | 1-0, 2 errored → **✅ 2-0 in the 2026-09-19 follow-up pass** | Verified verbatim from docs.monad.xyz/reference/staking/api (§2); on-chain smoke test still advised |
| Cosmos SDK x/staking default UnbondingTime is 3 days; Cosmos Hub's 21 days is "only a doc example, not live chain state" | 0-3 ❌ | 21 days is live-verified on cosmoshub-4 (§5); never trust SDK README examples — read live params |
| Staking watcher indexes legacy `begin_unbonding` action; `delegate` event has no `new_shares` attribute | 0-2 ❌ | SDK v0.50.x emits full MsgTypeURL actions (`/cosmos.staking.v1beta1.MsgUndelegate`); filter on typed events (§5) |
| An account needs 2 DOT total to join a Polkadot nomination pool (1 DOT bonded + 1 DOT existential deposit) | 0-3 ❌ | Live ED is 0.01 DOT; practical join ≈ 1 DOT bonded + small fee buffer (§6) |
| Tendermint WebSocket subscribe was deprecated in v0.36 — build watchers on a replacement | premise ❌ | Never shipped: v0.36 was an internal Go-interface refactor, CometBFT forked at v0.34. WS subscribe at `/websocket` IS the supported path (§5) |

## Appendix B — primary sources

*Original pass (2026-09-18):* Polygon docs.polygon.technology delegation reference +
github.com/maticnetwork/contracts `ValidatorShare.sol`; docs.monad.xyz staking
overview + precompile; docs.bnbchain.org staking developer guide + bscscan
`0x…2002`; aptos.dev staking + delegation-pool-operations.

*Follow-up pass (2026-09-18/19) — verified groups:*

- **Cosmos family:** docs.keplr.app/api (+cosmjs.html); github.com/cosmos/cosmjs;
  docs.cosmos.network incl. /cometbft WS-subscription, Indexing-Transactions,
  query-syntax; github.com/cometbft/cometbft rpc/core/README; cosmos-sdk x/staking
  README, staking/distribution tx.proto, keeper/delegation.go;
  celestiaorg/celestia-app specs/parameters_v10.md; docs.celestia.org staking +
  mainnet/mocha network pages; celestiaorg/CIPs cip-030; cosmos chain-registry;
  live REST `/cosmos/staking/v1beta1/params` + WebSocket subscriptions on
  cosmoshub-4, celestia, osmosis.
- **Polkadot:** wiki.polkadot.network/.com learn-nomination-pools, learn-staking,
  chain-state-values; paritytech.github.io/polkadot-sdk
  pallet_nomination_pools; live Asset Hub + relay RPC storage/metadata reads
  (spec 2005000, era 2297–2298).
- **Solana:** solana.com/docs/references/staking/stake-accounts,
  /economics/staking/stake-program, /rpc/deprecated/getstakeactivation,
  /rpc/websocket; docs.rs solana-stake-interface; github.com/solana-program/stake;
  anza-xyz/agave programs/stake/stake_state.rs; live getAccountInfo +
  getStakeActivation probe on api.mainnet-beta.solana.com.
- **Canton:** docs.canton.network json-api.md, ledger-api.md,
  ledger-api-services.md, json-ledger-api-migration-to-v2.md,
  openapi/json-ledger-api/openapi.yaml (3.5.18), appdev deep-dives
  (authorization, command-deduplication), wallet-sdk user-management;
  docs.digitalasset.com operate/3.4 performance; github.com/canton-foundation/cips
  cip-0104 + cip-0116 + index; github.com/canton-network/splice Amulet.daml,
  RewardAccountingV2.daml, AmuletRules.daml; docs.monad.xyz/reference/staking/api.

*Fetch-phase only — zero claims survived verification, do not build on:*
Solana liquid pools (solana-program.com/stake-pool, docs.marinade.finance,
jito.network); Sui (docs.sui.io proof-of-stake / sui_system / validator / gRPC /
events — two passes, zero surviving claims).
