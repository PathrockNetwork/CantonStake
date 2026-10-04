# CantonStake: Loop TestNet integration and review handoff

Date: 2026-10-04. Status: **code deployed behind closed activation gates on both domains; real Loop requests, native ownership, cancellation/recovery and unbond preflight staged for all ten TestNet native chains; funded Loop lifecycle not verified**.

See [the production rollout record](production-rollout-2026-10-04.md) for the
running images, verification and preserved data. The user explicitly approved
deployment to both domains with live activation gated. MainNet still needs its
own reviewed integration and operator handoff; the TestNet adapter is not a
MainNet implementation.

## Verification policy

Use the actual Loop TestNet wallet for integration and end-to-end verification.
Do not create mock Loop accounts, fake signer responses, a hosted service account
presented as a user wallet, or a substitute test environment without Loop.
The newly added mock-wallet tests, hosted-account provider/API and hosted request
test script have been removed. Earlier hosted-service receipts are retained as
historical provisioning evidence only. TypeScript/static checks are allowed but
must never be reported as successful live Loop signing or staking.

## External dependency

Five North's [current integration guide](https://cantonloop.notion.site/loop-sdk-integration-guide), linked from the [official SDK repository](https://github.com/fivenorth-io/loop-sdk), describes a review process for custom DARs. The older [SDK overview](https://docs.fivenorth.io/loop-sdk/overview/) still excludes third-party DARs. Obtain written confirmation for CantonStake's exact TestNet package and deployment/vetting on the participant serving Loop TestNet users. Do not interpret SDK network support, an HTTP 200, or deployment on our own participant as that approval.

The guide requests source, a pinned clean commit, workflow documentation, a signing-point map, tests and a signed scope agreement. Contact: `support@cantonloop.com`; suggested subject: `Integration: CantonStake — TestNet custom DAR`. No email or agreement has been sent or signed by the app agent.

## Implemented locally

- The installed `@fivenorth/loop-sdk@0.14.0` routes `testnet` to `https://testnet.cantonloop.com`. Our wrapper now accepts TestNet and rejects unknown network names instead of silently selecting DevNet.
- SDK tickets are bound to the configured network, wallet URL and API/proxy URL. Unscoped legacy or mismatched tickets are removed. App identity is held in memory only after Loop accepts/verifies the session; a cached party ID no longer marks a wallet connected.
- Expired/revoked sessions clear the displayed identity. Signing revalidates the connected account. Connecting alone does not overwrite a user's backend native-wallet association.
- Fresh/restored handshakes independently reverify the real account API's party and public key before displaying a connection. Bounded reads and generation guards prevent a delayed response from reconnecting a logged-out wallet or clearing a newer account. Disconnect invalidates app authority and the loaded SDK before yielding. Live race behavior still needs a real Loop wallet; no mocked wallet test was added.
- `frontend/lib/canton/loop-transactions.ts` builds narrowly scoped request-create, request-cancel and unbond-intent commands. It pins the package and synchronizer, acts only as the connected delegator, and requires operator-attested review of that exact package.
- Wait-mode receipts must include command/update identifiers. Ambiguous timeouts or incomplete acknowledgements require reconciliation; the adapter never retries automatically or sends native funds.
- `.env.testnet.example` now uses Loop TestNet. Real deployment environment files
  remain unchanged; rebuilt application containers retain their existing
  configuration. No private keys are requested.

The staking API now selects the real Loop path when built with
`NEXT_PUBLIC_LOOP_STAKING_FLOW=external`. It covers direct Polygon validator
staking (Ethereum Sepolia settlement), Monad, BNB, Cosmos Hub, Celestia,
Osmosis, Sui, Aptos, Solana and Polkadot. The Cosmos-family path requires a live
Keplr/Leap ADR-36 ownership signature; the other native adapters use their real
wallet's supported ownership-signing mechanism. It does not replace the separate
Amoy liquid-staking route. Smart/multisig ownership remains unsupported; each
adapter's genuine Loop/native wallet round trip still requires verification.

The new backend endpoints are:

- `POST /api/loop/staking/prepare`: verify the bearer session directly at the
  fixed Loop TestNet account endpoint, apply the existing native-chain preflight,
  then store a random, expiring server-owned intent in the existing Redis.
- `POST /api/loop/staking/authorize`: verify that same session and the native
  ownership signature over the exact intent before asking Loop to create it.
- `POST /api/loop/staking/adopt`: reverify authorization, independently observe
  the exact request as the provider on Canton, and atomically bind the real Loop
  user and chain/validator metadata in the existing database schema.

Wallet associations are append-only per verified request, not reassigned. An adopted
request returns a real contract ID and a **null transaction ID**, because an ACS
query does not establish the creating update ID. We do not manufacture a receipt.
Uncertain wallet submissions are reconciled, not automatically recreated. The
client keeps pending attempt context in memory only; reloading or expiry may
require manual reconciliation/cancellation. Pending Canton requests prevent a
fresh preparation for that Loop/native-wallet pair.

Definite pre-submit/session failures or explicit failed Loop receipts clear only
the matching local create attempt, allowing fresh preparation, native consent
and Loop approval. Timeouts, disconnects during submission and missing finalized
receipts retain the original attempt for independent adoption/reconciliation.
This retry correction is source/typecheck verified, not a live Loop round trip.

`LOOP_STAKING_ENABLED` defaults to false. Enablement also requires the exact
`LOOP_REVIEWED_PACKAGE_ID`, protected remote provider configuration, TestNet
synchronizer and Loop TestNet upstream. With this flag enabled, legacy hosted
request creation and unauthenticated identity upserts are blocked on TestNet.
The external frontend checks this readiness before starting its staking flow.
Old LocalNet CC marker/allocation paths are disabled in this mode; no shared
hosted-delegator beneficiary split is used for real Loop users.

Real environment files and MainNet settings were not changed. Updated application
containers were deployed to both domains, without activating the external flow.
The older production request path remains until an explicit cutover;
it is not claimed as Loop integration. No live wallet signing has been verified.

## Pending request recovery and exits

- `POST /api/loop/staking/requests`: authenticate the real Loop party and read
  provider-observed requests from the exact reviewed package. Unadopted requests
  are visible even after the prepare nonce expires; their native chain is not guessed.
- `POST /api/loop/staking/cancel/prepare`: verify the active request and return
  the narrowly scoped Loop Cancel command. Known native acceptance in progress
  and conflicting mirror metadata prevent cancellation.
- `POST /api/loop/staking/cancel/observe`: read contract creation/archive history
  and the archive-offset ledger-effects transaction. Confirm the exact consuming
  Cancel and delegator controller; distinguish Accept from Cancel. A missing ACS
  row or pruning alone is not cancellation proof.
- `POST /api/loop/staking/unbond/prepare`: verify the connected party owns the
  bonded contract and this deployment's native-wallet/chain/validator mirror.
- `POST /api/loop/staking/unbond/observe`: independently read the Loop receipt's
  ledger update, verify the exact non-consuming RequestUnbond and controller,
  and recheck the contract remains bonded before allowing native submission.
- `POST /api/loop/staking/unbond/native-observe`: authenticate the connected
  Loop party and independently read a Cosmos-family native transaction receipt.
  Check the configured TestNet RPC, exact raw-byte hash, wallet, validator,
  micro-denomination, amount and block after the native bond. Read-only: no
  new Loop choice, ownership signer, ledger command or native broadcast.

The Cosmos-family signer records the actual signed-byte hash before broadcasting
and rechecks wallet identity and exact signed message. Pre-broadcast failures
prevent sending; uncertain broadcasts retain the exact hash. Existing MainNet
and legacy Cosmos calls retain CosmJS's original broadcast path. Receipt
recovery keeps missing/pruned receipts guarded. An included failed tx only
clears the guard when it matches the exact recorded hash; an unknown original
broadcast still requires operator reconciliation.

ADR-36 uses an empty sign-doc `chain_id`. Our consent explicitly includes the
native network ID as well as chain, validator, amount, nonce/expiry, Loop party
and Canton deployment. The backend reconstructs the canonical sign document,
derives the expected bech32 address and verifies the actual secp256k1 signature.
Only standard single-key compressed secp256k1 Cosmos accounts are supported.
Reference: [Keplr ADR-36 API](https://docs.keplr.app/api/guide/sign-arbitrary).

At 11:03 UTC, read-only inspection of a real public Cosmos RPC response verified
the compiled gateway classifier does not quarantine a node for the exact
transaction-not-found result. Other internal errors remain retryable and writes
retain no-replay behavior. An actual indexed native undelegation confirmed the
JSON-RPC base64 hash encoding (distinct from GET-route hex). No generated wallet,
fake signer, substitute integration environment or new mocked Loop test was used.
No app/Loop round trip was established by these native protocol checks.

The positions page uses a compact, scrollable pending-request section inside its
existing panel. Ambiguous cancellation attempts survive reload through local
retry-suppression markers; users can reconcile them even after the active request
disappears. These markers and unbond receipt references never authenticate a user
or prove a ledger transaction. No token/signature/private key is newly persisted.
If browser storage is unavailable, signing fails closed.

Loop/native unbond prompts recheck account/network after Loop returns. Definite
EVM user rejection or a proved reverted transaction permits retry; an uncertain
broadcast retains a guard instead of silently sending another transaction.
An explicit compact receipt-recovery UI now accepts a real Loop ledger update ID
or native transaction hash. Loop receipts are independently verified by the
provider before storing the reference. Native checks verify RPC chain identity,
wallet, staking destination, calldata and validator against server-observed
position metadata. They never broadcast or open another signing prompt.
A proved revert of the exact recorded native hash can clear its retry guard;
a user-supplied reverted hash cannot disprove an unknown original broadcast.
Unknown receipt IDs still require operator reconciliation. No automatic replay
or hosted fallback is implemented.

IMPORTANT: `StakingPosition_RequestUnbond` is non-consuming and its body emits no
new state. Provider visibility of its exercise must be verified with a real Loop
transaction. If Canton privacy filtering omits it, the current observe gate
blocks native unstake; a reviewed on-ledger intent/acknowledgement design will
be required. Do not request readAs/actAs over the external user's party as a shortcut.

## Preserving the existing ledger during cutover

The TestNet backend's live health endpoint still reports LocalNet at
`http://host.docker.internal:3975`. Its current position endpoint contains one
bonded 10 MON position. The same user's Amoy holdings endpoint reports
1.849246702846537452 sPOL directly on-chain; its optional Canton liquid registry
entry is currently null. Neither is evidence of a Loop TestNet stake.

The staged `CantonCutoverClient` reads actual primary and legacy contract views,
labels each source, and refuses ambiguous contract origins. Writes to existing
contracts resolve the original participant/package; new staking creates go only
to primary/the real Loop flow. It does not copy identities or ledger contracts.
Both sources must be reachable; it never silently substitutes one for the other.
The separate `LiquidBalance` registry stays on its original participant/operator.

Before enabling the external TestNet backend, explicitly retain the old settings:

- `CANTON_LEGACY_JSON_API_URL`: existing LocalNet JSON API URL.
- `CANTON_LEGACY_AUTH_TOKEN`: existing provider credential via the server's
  secret configuration. Never use the new participant's token or paste it in chat.
- `CANTON_LEGACY_APP_PROVIDER_PARTY`: the existing LocalNet provider party.
- `CANTON_LEGACY_PACKAGE_ID`: exact existing package
  `feae77709df4babd53fd86ca130078d696e4d8955ab95926a72ec474deb90cef`.

These settings are ignored outside external Loop TestNet mode. Legacy positions
retain their original native-wallet-controlled exits; no new hosted staking
request is offered. Backend origin tags select this preservation path, not a
browser storage flag. MainNet runtime settings have not changed; its application
containers now run the gated release.
Readiness and new-intent preparation check that all active deployment database
mirrors remain covered by the configured ledger view; missing positions block
new creates rather than disappear without warning.

Real read-only cutover inventory at 2026-10-04 10:17 UTC:
`backend/scripts/check-canton-cutover.ts` saw zero remote positions/requests,
four legacy positions and one legacy request across the shared provider, and
retained the one TestNet deployment position. Every source matched its provider.
The report contains counts only, performs zero ledger/DB writes, and explicitly
marks write routing, production configuration and Loop round-trip verification
as false. Deployment-local database filters still isolate the shared legacy
provider's MainNet/TestNet records.

The user's primary native-address field remains unique, but the staged external
path now binds wallets per verified request through `StakingIntent` instead of
overwriting that field. The native signature explicitly authorizes association
with the exact Loop party for one intent. A separate Loop-party user is created
without claiming an already occupied primary address; existing users/positions
are never reparented. A Loop party can also use another verified native wallet
without changing its primary address. The watcher retains the verified intent's
user ID when creating the new position. Account reward/history/rounds/analytics,
narrator and export queries scope to each position's actual native wallet.
Unknown-wallet analytics cannot become global. No schema migration, party-key
transfer, legacy reward entitlement transfer or production database write is
part of this change. A real two-wallet/party lifecycle and proof-driven legacy
exits still must be verified before cutover. External-mode narration explicitly
states that CC claims/payments to Loop users remain disabled.

## Existing review candidate (not yet submitted)

- Source: `daml/CantonStake/daml/CantonStake/Staking.daml`.
- Build definition: `daml/CantonStake/daml.yaml`; SDK 3.4.11; package `cantonstake`, version 0.0.2.
- DAR: `daml/CantonStake/.daml/dist/cantonstake-0.0.2.dar`.
- SHA-256: `7e7f28a4fad6b739cf38017a44932109820a00881d6ce1b6b153cc76d5b1df81`.
- Main package ID: `23f7aa9deb68fc275ba97db0c173c9232b4b21315e1dbb8ee82a1a63428faf1e`.
- Dependency: official `splice-api-featured-app-v1`, plus Daml standard packages. Include dependency provenance/version checks in the submission.
- Tests: `daml/CantonStakeTests/` (existing request/cancel, acceptance, unbond and release coverage without a FeaturedAppRight).
- Pin the release commit after committing the reviewed changes; the repository
  includes native adapters, Amoy tooling and UI changes as well as the Loop
  candidate. A clean source commit is not evidence of Five North approval. Build
  the review DAR from that exact commit and verify its package/checksum before
  submitting it; any semantic package change reopens the review gate.
- Confirm the package and artifact naming is acceptable under Five North's guide before submitting. Do not rename the live package during integration: package-name filters and compatibility depend on it.

## Signing-point map

| Template/action | Authority | Intended signing path | Current integration status |
| --- | --- | --- | --- |
| `StakingRequest` create | Delegator signatory | Loop approval | EVM client and backend prepare/authorize/adopt staged behind gates; real wallet verification pending |
| `StakingRequest_Cancel` | Delegator controller | Loop approval | Compact UI, prepare and independent archive-choice observation staged; live wallet verification pending |
| `StakingRequest_Accept` | App provider controller | Our backend/participant | Existing provider workflow; must consume verified Loop request |
| `StakingPosition_RequestUnbond` | Delegator controller | Loop approval | EVM/Cosmos-family UI preflight and independent update observation staged; non-consuming choice visibility needs live verification |
| `StakingPosition_ConfirmUnbond`, `Release` | App provider controller | Our backend after chain proof | Existing provider workflow; full external-party round trip untested |
| `StakingPosition_RecordStake`, `RecordNativeSweep` | App provider controller | Our backend | Existing provider workflow; no user delegation required |
| `StakingPosition_Archive` | Delegator AND app provider | Coordinated multi-party authorization | Not implemented; do not invoke through single-party adapter |
| `BeneficiarySplit`, update/archive | Operator signatory/controller | Our backend/operator | No Loop user authority; existing shared test split is not a per-user reward setup |
| `OnchainEvent`, archive | App provider signatory/controller; delegator observer | Our backend | Observer hosting/privacy is part of custom-DAR review |

We do not request Five North's validator/operator party as a signatory or observer. Loop user parties are distinct from our hosted `CantonStakeTestnetDelegator` service party. Never substitute one for the other.

## Remaining application work and release gates

1. Confirm Five North's exact-package deployment/vetting and run the staged EVM and Cosmos-family paths with real Loop TestNet and native wallets. Backend session verification, expiring consent and independent adoption are implemented but not wallet-verified.
2. Verify the staged Sui, Aptos, Solana and Polkadot ownership/receipt flows with genuine native and Loop wallets before enabling them. Cosmos-family ADR-36 also needs a real Keplr/Leap signature with Loop. Contract/smart EVM and Cosmos multisig accounts require dedicated verification paths; current EVM signatures use EOA verification.
3. Verify staged cancellation/unbond and receipt-recovery UI with real Loop signatures. Unknown Loop update IDs/native broadcast hashes still require operator reconciliation. Verify provider visibility of the non-consuming unbond choice before release. Never implicitly recreate a timed-out request.
4. Verify native wallet/chain changes across every popup and confirmed watcher transitions in a real funded TestNet lifecycle. No new native transaction is sent until independent adoption succeeds.
5. Validate the staged legacy-ledger router's proof-driven write routing, old position exits and append-only wallet association before cutover. Real read coverage passes, but runtime configuration, native/Loop association and write verification are not done. Per-request native consent plus Loop verification replaces destructive identity migration; no existing identity/position/reward was reassigned.
6. Implement per-user beneficiary splits and actual CC claims/transfers separately, after eligibility and economics are verified. The shared service-account split and database allocations cannot substitute for payment to Loop users.

Fresh read-only provisioning check at 2026-10-04 09:55 UTC: 33/33 packages
uploaded/vetted, three service users matched their rights, one matching hosted
75/25 split, zero requests/positions on the remote provider. This does not prove
the application has switched there. The script's protection attestation remains
false when its dedicated acknowledgement variable is omitted; that is not a new
finding that the operator's allowlist was removed.

The same check verified real contract history plus modern ledger-effects lookup
by both offset and update ID using the existing hosted split's creation. It
performed no ledger writes and does not validate a Loop cancellation or unbond.
No DAR was uploaded during the production code rollout. The existing artifact's
checksum was rechecked before committing; perform a fresh reproducible build
against the pinned release commit for the review packet.

Dead mock-party/validator Docker flags and the obsolete mock-party preflight
requirement were removed. Legacy session cleanup remains deliberately: it removes
untrusted cached identities and cross-network tickets; it is not a mock provider.

Actual CC earning/claiming/transfers remain a separate subsequent milestone. Connecting Loop or recording a position does not grant FeaturedApp eligibility or pay rewards. Keep that feature disabled until separately verified.

## Reward collection and hosting follow-up

The real read-only reward diagnostic at 14:14 UTC verified package vetting for
the reward-assignment interface, `splice-amulet` and `splice-wallet`. No provider
FeaturedAppRight or reward coupon was visible. Its optional
`CANTON_TESTNET_LOOP_PARTY_ID` must come from the genuine user's Loop TestNet
wallet; without one, local hosting is unknown rather than assumed from the
hosted delegator. No Loop session, minting delegation, automation or settlement
was proved by the package query.

[Splice minting-delegation documentation](https://docs.sync.global/validator_operator/validator_delegations.html)
requires beneficiary hosting on the delegate's validator, a wallet-onboarded
delegate, and explicit beneficiary proposal/acceptance. Running our own validator
does not establish that a Loop user is hosted there. Any observer-hosting/topology
change needs an agreed operator/Five North path; do not import user signing keys,
substitute a hosted user, or grant the app blanket user `actAs` rights.
The SDK's built-in token transfer is not evidence of coupon collection support.
Confirm the actual Loop-host collection path and modern coupon support before
assigning expiring coupons to user parties.

The treasury share remains 25%; the delegators' 75% still needs an agreed
cross-network allocation rule. Do not add incomparable raw native token amounts
or invent market values for testnet assets. Database allocations, coupon
assignments, minted holdings and settled payments are distinct evidence states.

## Verification gates before enabling the page

- TypeScript/static checks pass; browser popup/QR, account switching, disconnect and reload must be verified with a real TestNet Loop account. No mock wallet is an acceptance substitute.
- Review/deployment confirmed by Five North for this exact package; fresh package changes reopen the review gate.
- A real user approves request creation; our participant independently observes it; cancelling archives only that request.
- Full funded TestNet round trip: Loop request → native stake → correct user position → Loop unbond intent → native unstake/claim → released position. No fabricated chain proof.
- Wrong network/party, expired sessions, amount/validator tampering, replay, cancelled popup, ledger timeout and backend adoption failure cannot broadcast native funds.
- Existing positions and MainNet remain accessible and unchanged.

## Draft operator/Five North request

> We are integrating CantonStake with Loop on Canton TestNet. Our own validator already hosts and vets the application DAR, but users' Loop parties need approval access to custom templates on Loop's participant. Please confirm the custom-DAR review and deployment path for the exact package above, the shared TestNet synchronizer, acceptable package naming and dependency versions, and any wallet signing/UI requirements. We will provide a clean source commit, Daml tests, this signing-point map, a stable DAR artifact and the requested scope agreement. We are not asking for user private keys, blanket delegation or MainNet deployment. The adapter code is deployed behind closed activation gates; the live external-party staking round trip is not enabled yet.
