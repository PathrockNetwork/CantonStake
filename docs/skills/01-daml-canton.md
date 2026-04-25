# Skill: Daml 3.3 + Canton + JSON Ledger API v2

## When to use
Any work involving `daml/`, Canton ledger interactions, template definitions, party authority, `FeaturedAppRight` marker emission, or the backend Canton client.

## Key Files
- `daml/CantonStake/daml/CantonStake/Staking.daml` - core state machine and CIP-47 marker emission
- `daml/CantonStake/daml/CantonStake/Setup.daml` - party/setup flow
- `daml/CantonStake/daml/CantonStake/Test.daml` - Daml tests
- `daml/CantonStake/daml.yaml` - package config, SDK version, data dependencies
- `backend/src/canton.ts` - thin Canton JSON API v2 client
- `backend/src/orchestrator.ts` - maps Amoy events to Daml choices

## State Machine

```text
StakingRequest (Pending intent)
  -> StakingRequest_Accept by appProvider
  -> StakingPosition (Bonded)
  -> StakingPosition_RequestUnbond by delegator
  -> StakingPosition_ConfirmUnbond by appProvider
  -> StakingPosition (Unbonding)
  -> StakingPosition_Release by appProvider
  -> StakingPosition (Released)
  -> StakingPosition_Archive by delegator + appProvider
```

## Marker Rules
- `FeaturedAppActivityMarker` is emitted on:
  - `StakingRequest_Accept` (bond)
  - `StakingPosition_ConfirmUnbond` (unbond)
- No marker is emitted on:
  - `StakingRequest_Cancel`
  - `StakingPosition_RequestUnbond`
  - `StakingPosition_Release`
  - `StakingPosition_Archive`
- Beneficiary split in this repo:
  - `0.25` to `appProvider`
  - `0.75` to `delegator`
- Marker creation depends on `featuredRightCid : Optional (ContractId Featured.FeaturedAppRight)`

## Controllers and Authority
- `StakingRequest`
  - signatory: `delegator`
  - observer: `appProvider`
- `StakingRequest_Cancel`
  - controller: `delegator`
- `StakingRequest_Accept`
  - controller: `appProvider`
- `StakingPosition`
  - signatory: `appProvider`
  - observer: `delegator`
- `StakingPosition_RequestUnbond`
  - controller: `delegator`
- `StakingPosition_ConfirmUnbond`
  - controller: `appProvider`
- `StakingPosition_Release`
  - controller: `appProvider`
- `StakingPosition_Archive`
  - controller: `delegator, appProvider`

Do not assume delegators are backend-only. They directly control some choices in the Daml model.

## JSON Ledger API v2
The repo is on JSON API v2, not v1.

Endpoints used in `backend/src/canton.ts`:

```text
POST /v2/commands/submit-and-wait-for-transaction
POST /v2/state/active-contracts
```

Useful participant endpoints while debugging:

```text
GET /v2/state/ledger-end
GET /docs/openapi
GET /docs/asyncapi
```

## CantonClient Notes
- `createContract(...)` sends `CreateCommand`
- `exerciseChoice(...)` sends `ExerciseCommand`
- `activeContracts(...)` uses party-scoped `filtersByParty`
- Requests use `actAs: [config.cantonAppProviderParty]`
- `CANTON_AUTH_TOKEN` is optional in this repo, but JSON API v2 itself supports JWT auth

## Template IDs
- Current `TEMPLATES` values in `backend/src/canton.ts` are placeholders:
  - `#cantonstake:CantonStake.Staking:StakingRequest`
  - `#cantonstake:CantonStake.Staking:StakingPosition`
- For real participant integration, replace them with package-ID-qualified template IDs from:

```bash
daml damlc inspect-dar .daml/dist/cantonstake-0.0.1.dar
```

## Type Conventions
- `amountPol` is `Decimal` in Daml, not `Text`
- The frontend/backend pass decimal strings over JSON API, which the ledger decodes into Daml `Decimal`
- `EvmProof` contains:
  - `txHash : Text`
  - `blockNumber : Int`
  - `validatorShare : Text`
- `unbondingPeriod` is `RelTime`, represented in JSON as a microseconds object

Example:

```json
{ "microseconds": "60000000" }
```

## LocalNet Notes
- `sdk-version` in `daml/CantonStake/daml.yaml` is `3.3.0`
- App-provider participant JSON API defaults to `http://localhost:2975`
- Party IDs look like `Hint::1220...`
- `splice-api-featured-app-v1.dar` must exist under `.daml/dars/` for featured marker integration

## High-Value External Resources
Use these in roughly this order when working on this repo:

- CN Quickstart
  - best starting point for LocalNet bring-up, Canton Console, and Daml Shell workflows
  - repo: `https://github.com/digital-asset/cn-quickstart`
- Digital Asset Build docs 3.5
  - best source for JSON Ledger API usage, TypeScript examples, package upload, and auth
  - especially useful:
    - `https://docs.digitalasset.com/build/3.5/tutorials/json-api/canton_and_the_json_ledger_api_ts.html`
    - `https://docs.digitalasset.com/build/3.5/sdlc-howtos/applications/develop/manage-daml-packages.html`
    - `https://docs.digitalasset.com/build/3.5/sdlc-howtos/applications/secure/authorization.html`
- Canton docs hub
  - use as the current official navigation entry point for build, operate, and quickstart material
  - `https://docs.canton.network`
- Canton developer resources
  - good high-level landing page when you need the official quickstart/docs/community links in one place
  - `https://www.canton.network/developer-resources`
- Sync docs
  - use for Splice, `FeaturedAppRight`, marker APIs, DevNet/TestNet guidance, and validator flows
  - especially useful:
    - `https://docs.sync.global/app_dev/daml_api/index.html`
    - `https://docs.sync.global/app_dev/testing/index.html`
    - `https://docs.sync.global/app_dev/testing/networks_and_usecases.html`

## Daml Contract Patterns (from Canton Dev Guide)
Reference patterns useful for extending CantonStake's Daml templates:

| Pattern | Use Case | Relevant To |
|---|---|---|
| **AccessControl** | Role-based permissions for contracts | Adding admin/operator roles |
| **Escrow** | Trustless asset holding between parties | Cross-chain bridge collateral |
| **Multisig** | Multi-party authorization | Governing app provider actions |
| **Vesting** | Time-locked token release | CC reward vesting schedules |
| **Timelock** | Delayed execution of choices | Unbonding period enforcement |
| **Voting** | On-chain governance | DAO-style validator selection |

Source: `https://github.com/JohnLilic/canton-dev-guide`

## Daml Development Tools

### DPM Framework
Package manager for Daml projects — useful for dependency management and testing:
- `https://github.com/digital-asset/dpm`

### DAML Studio
Browser-based IDE for writing and testing DAML smart contracts (no local setup needed).
Good for quick prototyping and experimenting with template patterns before integrating into this repo:
- `https://damlstudio.tenzro.network`

### dazl-client (Python)
Python client for DAML ledger — useful for data pipelines, AI integrations, or scripting:
- `https://github.com/digital-asset/dazl-client`

## Additional External Resources
- **Canton 101** — Best starting point for network architecture, APIs, SDKs: `https://canton-101.vercel.app`
- **DAML Getting Started** — Templates, contracts, choices tutorial: `https://docs.daml.com/canton/tutorials/getting_started`
- **Install Canton + DAML SDK** — Local development setup: `https://docs.daml.com/canton/usermanual/installation`
- **Canton Dev Guide** — Opinionated guide: tokenomics, security, Featured App patterns: `https://github.com/JohnLilic/canton-dev-guide`
- **Canton Protocol** — Deep dive into privacy-first architecture: `https://canton.network/protocol`
- **Canton GitHub** — Open-source repo: `https://github.com/digital-asset/canton`
- **Sync.Global Docs** — Network overview, validators, Global Synchronizer: `https://docs.sync.global`

## Optional Resources
- Third-party guides and SDKs can be useful for ideas, but prefer the official Digital Asset and Sync docs when they disagree.

## Common Mistakes
- Do not document or call JSON API v1 endpoints for this repo
- Do not claim all amounts are `Text`; the Daml model uses `Decimal`
- Do not forget that marker emission is inside Daml choices, not a separate backend transaction
- Do not assume the backend party can see every contract; ACS queries are party-scoped
- Do not leave placeholder template IDs in place once the DAR package ID is known
- Do not forget that `FEATURED_APP_RIGHT_CID` must belong to the same app provider party used by the backend
