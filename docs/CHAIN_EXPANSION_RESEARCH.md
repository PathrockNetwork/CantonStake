# Chain Expansion Research — which networks to add next

Status: Research complete — 2026-08-16
Scope: candidates for new staking chains, each evaluated for **testnet** and
**mainnet** paths. Moonbeam/Moonriver was removed from the app the same day
(egress-blocked RPC, offline watcher, lowest-integration maturity) — see git
history.

---

## 1. How we evaluate (derived from this codebase's architecture)

CantonStake's watcher layer already speaks three "integration shapes". A
candidate chain's cost is dominated by which shape it needs:

| Shape | Already used by | New-chain cost |
|---|---|---|
| **A. EVM event logs** (`eth_getLogs` on a staking contract) | Polygon (StakingInfo logger on Sepolia), Monad (staking precompile) | **~days** — new ABI + address, `handleStakeEvent` reuse |
| **B. Cosmos SDK `tx_search` + protobuf `MsgDelegate` decode** | Cosmos Hub theta-testnet | **~hours** — parameterise chain id / RPC / denom; decode path is chain-generic |
| **C. Move-based event query** (GraphQL/REST events) | Sui (`0x3::sui_system::StakeRequest`) | **~days** — sibling types on Aptos |
| **D. Substrate RPC** (pallet storage + events) | — | **~1–2 weeks** — new shape (WebSocket subscriptions or polling `chain_getBlock` extrinsics) |
| **E. Account-model** (no events; poll accounts) | — | **~1–2 weeks+** — new shape (e.g. Solana `getProgramAccounts` on the Stake Program) |

Per-chain criteria beyond the shape:
1. **Delegation model** — users delegate to validators/nominators/pools from
   their own wallet (what the product does). Chains where delegation is
   closed/whitelisted score poorly.
2. **Settlement observability** — the watcher must derive (delegator,
   validator, amount) from settled on-chain data only (our proof trust
   model, docs/PROOF_TRUST_MODEL.md).
3. **Testnet quality** — public RPC + faucet that works without manual
   onboarding.
4. **Egress reality** — this box sits behind a DNS allowlist (it killed
   Moonbeam). Any host we add must be verified reachable *before* writing
   the adapter.
5. **Mainnet story** — TVL/relevance, and whether the same code path flips
   with config (RPC + contract addresses) or needs new capital-flow
   assumptions.

---

## 2. Recommendations at a glance

| Priority | Chain | Shape | Testnet | Mainnet | Why |
|---|---|---|---|---|---|
| **1** | **Celestia** | B (Cosmos SDK) | arabica/mocha, [Celenium faucet](https://celenium.io/faucet) | live, large staked TIA | Reuses the entire Cosmos watcher. Strong brand. Days→hours of work. |
| **2** | **Osmosis** | B (Cosmos SDK) | [faucet.testnet.osmosis.zone](https://faucet.testnet.osmosis.zone/) | live, top-15 staked | Same reuse; DeFi-native audience matches a staking product. |
| **3** | **Aptos** | C (Move) | [official faucet](https://aptos.dev/network/faucet), [Node API](https://api.devnet.aptoslabs.com/v1/spec) | live, top-10 staked | Sui sibling — staking-pool ops documented ([staking pool operations](https://aptos.dev/network/nodes/validator-node/connect-nodes/staking-pool-operations)). Move experience already in-house. |
| **4** | **Polkadot** | D (Substrate) | Westend (faucet via matrix) | live, ~$12B staked | Biggest TVL available via a *new* integration shape; [nomination pools](https://wiki.polkadot.com/learn/learn-nomination-pools/) are 1-DOT-min delegation, ideal UX. |
| **5** | **BNB Chain** | A (EVM) | Chapel testnet faucet | live, top-3 staked | Native staking module on BSC emits EVM events — **exact contract + event ABI must be verified first** (see §4). |
| **6** | **Solana** | E (account) | testnet faucet | live, top-2 staked | Highest TVL, hardest fit: no event logs, `getProgramAccounts` scanning or a Geyser/indexer subscription. Do last, do deliberately. |
| watch | Berachain | A (EVM) | [Bepolia faucet](https://bepolia.faucet.berachain.com/) | live | **Model changed 2026**: BGT no longer user-facing in Proof-of-Liquidity ([docs changelog](https://docs.berachain.com/general/proof-of-liquidity/changelog)) — re-evaluate what "staking" means there before building. |
| watch | Sei, Near, TON, Injective, Neutron | A/B/D | various | various | Viable but no differentiator over the six above; Injective/Neutron ride the same Cosmos shape if a seventh chain is ever wanted. |

For **mainnet of existing chains** (no new code): Polygon mainnet =
StakeManager/logger/ValidatorShares on Ethereum L1 + real POL (config flip);
Cosmos Hub mainnet = point `COSMOS_RPC_URL` at a mainnet RPC. Both are
documented already in `docs/REAL_DATA_MIGRATION.md` §2 (mainnet was
explicitly out of scope of that migration: real capital + Featured App
approval).

---

## 3. Candidate detail

### Tier 1 — same shape we already run (days or less)

**Celestia (TIA)** — Cosmos SDK module-identical to our Cosmos Hub path:
`tx_search` on `message.action='/cosmos.staking.v1beta1.MsgDelegate'` with
u**utia** denom (6 decimals — our `toStakeUnits` handles it). Testnets:
arabica (dev) / mocha (public); faucets via [Celenium](https://celenium.io/faucet).
Watch item: Celestia's "staking" story for users is classic validator
delegation; nothing exotic. Egress check: verify `rpc-celestia-testnet…`
host resolves from this box before starting.

**Osmosis (OSMO)** — same Cosmos shape, `uosmo` (6 decimals). Testnet faucet
at [faucet.testnet.osmosis.zone](https://faucet.testnet.osmosis.zone/).
Superfluid staking exists but *base delegation* is the same MsgDelegate
path — add nothing extra for v1.

**Injective (INJ) / Neutron / Axelar** — also Cosmos SDK; if we want a
seventh chain later they are config-level too. Not recommended before the
shapes above.

**BNB Chain (BNB)** — native staking on BSC (introduced with the staking
module upgrade) is EVM-event-based, which is our cheapest shape, and BNB
sits top-3 by staked value. **Verification needed before commitment** (see
§4): canonical staking contract address, exact event signature for
delegation, and whether delegations are permissionless or gated to a
validator allowlist. Testnet: Chapel (faucet via
[testnet.bnbchain.org](https://testnet.bnbchain.org)).

### Tier 2 — sibling of an existing shape (days)

**Aptos (APT)** — Move like Sui but REST-based: staking pool operations are
documented ([staking pool ops](https://aptos.dev/network/nodes/validator-node/connect-nodes/staking-pool-operations)),
events queryable via the [Node API](https://api.devnet.aptoslabs.com/v1/spec)
(`GET /v1/accounts/{addr}/events/…` or the events-by-type endpoint on
indexed nodes). Stake events live on the staking contract (`0x1::stake`).
Denominator: 8 decimals (`octas`) → `toStakeUnits(x, 8)`. Testnet faucet:
[aptos.dev/network/faucet](https://aptos.dev/network/faucet).

**Berachain (BERA)** — EVM shape, but its 2026 Proof-of-Liquidity rework
removed the user-facing BGT role ([changelog](https://docs.berachain.com/general/proof-of-liquidity/changelog)),
so the thing a staking app would observe changed. Do not build against the
old BGT-boost model. Re-scope after reading the current validator reward
docs; testnet faucet exists ([Bepolia](https://bepolia.faucet.berachain.com/)).

**Sei (SEI)** — EVM v2 on the surface, but native delegation settles on the
consensus layer, not an EVM contract — closer to a new shape than it looks.
Park unless Sei ecosystem presence becomes a goal.

### Tier 3 — new integration shapes (1–2+ weeks each)

**Polkadot (DOT)** — nomination pools (min 1 DOT) are the right UX for us.
Integration = Substrate RPC: watch the `Staking`/`NominationPools` pallet
events in finalized blocks (`chain_subscribeFinalizedHeads` + extrinsic/event
decode, or poll). Westend testnet (free faucet via Matrix bot), mainnet
~$12B staked ([nomination pools wiki](https://wiki.polkadot.com/learn/learn-nomination-pools/),
[explorer](https://polkadot.subscan.io/nomination_pool)). New deps:
`@polkadot/api` (or a light custom decoder). Biggest TVL per unit of
engineering outside the existing shapes.

**Solana (SOL)** — top-2 staked value, but the model is the hardest fit:
delegation = stake accounts authorised to vote accounts; **no event logs**.
Watcher options: poll `getProgramAccounts` filtered on the Stake Program
(heavy), subscribe to program logs + follow stake-account diffs, or run a
Geyser plugin / use an indexer (Yellowstone). Wallet side is standard
(`createStakeAccount`/`delegate`), frontend needs `@solana/web3.js` +
wallet-adapter. Worth it only after tiers 1–2 ship.

**TON / Cardano / Near** — all viable delegation networks, none offer
leverage over the above; Cardano's toolchain (pool certs, hard-to-index
model) and TON's actor-model contracts are each a project of their own.

---

## 4. Verification checklist per chain (run BEFORE writing an adapter)

Same lesson as the MATIC→POL token mixup in the migration plan: verify
against the chain itself, never against an address that merely "has
bytecode".

1. **Egress**: does the public RPC host resolve from this box?
   (`getent hosts <rpc>`; sinkholed = ask for allowlist or pick another
   endpoint — this is what killed Moonbeam.)
2. **Settlement surface**: exact contract/pallet/program + event names +
   field semantics, read from a *real settled transaction* on the testnet.
3. **Decimals** for the stake denom (uatom=6, utia=6, MIST=9, octa=8…) —
   feeds `toStakeUnits()`.
4. **Unbonding semantics**: epoch/checkpoint/era-based? What is the
   authoritative claimable condition (mirrors Polygon's
   `withdrawEpoch + withdrawalDelay <= epoch()` work)?
5. **Faucet**: reachable, no captcha-only path, dispenses the *stake* token
   (not just gas).
6. **Validator listing** for the UI: free public endpoint or on-chain read
   (extends `validator-scoring.ts`).
7. **Daml/frontend touchpoints**: chain id in `ChainConfig`, adapter,
   funding hint, watcher health auto-picks it up.

---

## 5. Suggested sequence

1. **Celestia testnet** — parameterise the Cosmos watcher for a second
   chain (this also finally generalises it: chain config object instead of
   module-level constants).
2. **Aptos testnet** — Move sibling; proves shape C generalises.
3. **Polygon mainnet + Cosmos mainnet** (config + capital + Featured App
   approval decision) — mainnet of what we already run beats a seventh
   testnet for credibility.
4. **Polkadot** — new shape, best TVL-per-effort among the rest.
5. **BNB** — pending §4 verification of the staking module's events.
6. **Solana** — flagship effort, schedule deliberately.

## Sources

- Staking TVL context: [DL News — ETH $120bn staked](https://www.dlnews.com/articles/markets/ethereum-smashes-120bn-staking-record-as-price-surges/), [DeFiLlama chains](https://defillama.com/chains), [Staking Rewards](https://www.stakingrewards.com/)
- Aptos: [faucet](https://aptos.dev/network/faucet), [staking pool operations](https://aptos.dev/network/nodes/validator-node/connect-nodes/staking-pool-operations), [Node API spec](https://api.devnet.aptoslabs.com/v1/spec)
- Celestia: [Celenium faucet](https://celenium.io/faucet), [awesome-celestia](https://github.com/celestiaorg/awesome-celestia)
- Osmosis: [testnet faucet](https://faucet.testnet.osmosis.zone/)
- Polkadot: [nomination pools wiki](https://wiki.polkadot.com/learn/learn-nomination-pools/), [Subscan pools](https://polkadot.subscan.io/nomination_pool), [pallet-nomination-pools docs.rs](https://docs.rs/pallet-nomination-pools/)
- Berachain: [PoL changelog (BGT role removed)](https://docs.berachain.com/general/proof-of-liquidity/changelog), [Bepolia faucet](https://bepolia.faucet.berachain.com/)
- Polygon faucets: [Alchemy Amoy](https://www.alchemy.com/faucets/polygon-amoy), [QuickNode](https://faucet.quicknode.com/polygon/amoy), [Polygon faucet docs](https://docs.polygon.technology/tools/gas/matic-faucet)

---

## 6. Execution log — 2026-08-16 ("make all of them")

All six recommended chains were implemented and deployed. Egress probe
passed for every host (the earlier 403s were Cloudflare bot-filtering of
non-browser UAs, not sinkholes — curl/viem UAs pass).

| Chain | Watcher | Verified live | Validator data | Staking UI |
|---|---|---|---|---|
| Celestia (mocha) | Cosmos tx_search, parameterised | ✅ real delegations decoded within seconds of first poll | 75 validators, live (LCD) | watcher-only for now |
| Osmosis (testnet) | same | ✅ polls ok (sparse testnet activity) | 5 validators, live | watcher-only |
| Aptos (testnet) | REST transactions → `0x1::stake::AddStakeEvent` | ✅ version cursor advancing | 10 pools, live via `0x1::stake::ValidatorSet` | watcher-only |
| Polkadot (Westend) | Substrate block events via `@polkadot/api` over HTTPS | ✅ connected, finalized-head cursor ok | stub (honest) | watcher-only |
| BNB (Chapel) | StakeHub `Delegated` logs | ✅ event shape verified against a **real mainnet delegation** (topic0 `0x24d7bda8…`); testnet is quiet | stub (honest) | watcher-only |
| Solana (testnet) | stake-program signatures → parsed `delegateStake` | ✅ signature polling ok | 485 vote accounts, live | watcher-only |

Implementation notes:
- The Cosmos watcher is now per-network (`COSMOS_NETWORKS`): a new Cosmos
  chain is a config entry, not new code.
- Sui remains unreachable (JSON-RPC deprecated + GraphQL host not
  resolvable) — unchanged, fails loudly.
- Every watcher reports into `/api/watchers`; the frontend disables a
  chain whose watcher is unreachable (Sui today).
- Frontend: all ten chains appear in the selector with per-chain funding
  hints; the six new ones are labelled `watcher` and their CTA says
  "staking UI next" — honest rather than dead-ending.
- Remaining work per chain (tracked here): in-app wallet adapters
  (Keplr suggest-chain for Celestia/Osmosis, Petra for Aptos, Polkadot
  extension, Phantom for Solana, payable `delegate()` for BNB), Polkadot/
  BNB validator listings, unbond watchers beyond Polygon.
