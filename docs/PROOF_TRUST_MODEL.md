# EvmProof Trust Model

Status: Decided — 2026-08-14 (Real Data Migration, Phase 3 / T2.6)

## Question

`StakingRequest_Accept` and `StakingPosition_ConfirmUnbond` take an
`EvmProof` (txHash, blockNumber, validatorShare) that the Daml layer does
not validate — the fields are `Text`/`Int` with no `ensure` clause. Two
options were on the table:

1. **On-ledger validation** — Daml `ensure` clauses or an attestation
   bridge verifying the proof against the originating chain.
2. **Backend-as-oracle** — the backend only ever submits proofs it derived
   itself from verified on-chain events, and the ledger trusts it.

## Decision

**Backend-as-oracle**, with the oracle's inputs verifiable after the fact.

### Why

- Validating an EVM/Sui/Cosmos proof *inside* Daml is not expressible:
  Daml choices cannot perform chain RPC calls, and the Canton↔EVM
  attestation bridge that would make on-ledger verification possible does
  not exist in this stack. An `ensure` clause could only check shape
  (non-empty hash), which adds no real security.
- The trust anchor is therefore *who can submit*, not *what the ledger
  checks*. `StakingRequest_Accept` is controlled by the app provider
  party; only the backend holds that party's token. Every proof the
  backend submits is derived from a decoded, settled on-chain event —
  never from request-body input (the force-accept endpoint that took
  client-supplied tx hashes was deleted in Phase 3).

### What the oracle actually verifies, per chain

| Chain | Source of truth | What is decoded |
|---|---|---|
| Polygon | StakingInfo logger on Sepolia (settlement L1) | `ShareMinted` / `ShareBurnedWithId` events; ValidatorShare resolved per validatorId from `StakeManager.validators()` |
| Moonbeam | ParachainStaking precompile `0x…800` | `Delegated(delegator, candidate, amount)` logs |
| Monad | staking precompile `0x…1000` | `Delegate(delegator, validatorId, amount)` logs |
| Cosmos | Tendermint `tx_search` | protobuf `TxRaw → TxBody → MsgDelegate` (delegator, validator operator, amount); failed txs (code ≠ 0) skipped |
| Sui | fullnode event stream | `0x3::sui_system::StakeRequest` (`pool_id`, `stake_amount`, sender) |

In every case: no decoded settled event → no bonded position. A tx hash
POSTed to any API endpoint cannot produce one.

### Residual risks (accepted)

- **Compromise of the app provider token** lets an attacker forge proofs.
  Mitigation is operational (token secrecy, rotation), not cryptographic.
- **Watcher RPC trust**: the oracle believes what the chain RPC returns.
  Using multiple/reputable RPCs per chain narrows but does not remove this.
- **Matching, not verification, is the remaining client-side surface**: a
  StakingRequest is accepted when a real event matches its (address,
  amount, chain) — someone else's real delegation can settle a request you
  created with their address and amount. Bounded by the fact that funds
  custody in *their* wallet; the ledger position is informational.

### Audit trail

Each Accept stores the originating tx hash + block number on the ledger
position (`EvmProof`) and mirrors it to Postgres (`evmTxHash`,
`validatorShare`, `validatorId`), so every bonded position can be
independently re-verified against the source chain after the fact.
