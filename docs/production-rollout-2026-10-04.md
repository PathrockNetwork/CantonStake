# Production rollout: Loop hardening and mock cleanup

## Scope

Deploy the current application source to both production domains:

- TestNet: `https://testnet.cantonstake.pathrocknetwork.org`.
- MainNet: `https://cantonstake.pathrocknetwork.org`.

The user deferred MainNet Canton onboarding/approval to the final integration
step. Do not treat this code rollout as enabling real external Loop staking,
Canton MainNet settlement, or CC payments. Preserve the existing `.env` and
`.env.testnet`, databases, volumes, native-chain configuration and old positions.
No DAR upload, ledger transaction or token transfer is part of this rollout.

## Rollback images retained before building

| Service | Image tag |
| --- | --- |
| MainNet backend | `cantonstake-backend:rollback-mainnet-20261004-loop` |
| TestNet backend | `cantonstake-backend:rollback-testnet-20261004-loop` |
| MainNet frontend | `cantonstake-frontend:rollback-mainnet-20261004-loop` |
| TestNet frontend | `cantonstake-frontend:rollback-testnet-20261004-loop` |
| Both backends, before final readiness fix | `cantonstake-backend:rollback-20261004-before-readiness` |

Pre-rollout database counts: MainNet has 2 position mirrors and 0 intents;
TestNet has 1 position mirror and 1 intent. Both have 8 completed migrations.
The current Prisma schema diff contains comments only, not a new migration.

## Resource-aware build and deployment

The server had approximately 2.6 GiB available memory before building. Build
serially; do not run the two frontend compilers simultaneously. Next.js build
worker count is one and its build-only Node heap defaults to 1536 MiB. These
controls do not change runtime container memory limits or Canton configuration.

```bash
docker compose -p cantonstake --env-file .env build backend
docker tag cantonstake-backend:local cantonstake-backend:testnet
bash scripts/build-frontends.sh

# Replace only application containers, never persistence or Canton containers.
docker compose -p cantonstake-testnet --env-file .env --env-file .env.testnet \
  up -d --no-deps --no-build backend frontend
# Verify TestNet before proceeding.
docker compose -p cantonstake --env-file .env \
  up -d --no-deps --no-build backend frontend
node scripts/check-production-domains.mjs
```

If rollback is needed, use the matching project/env files, export
`BACKEND_IMAGE` and `FRONTEND_IMAGE` to the retained tags above, and recreate
only `backend frontend` with `up -d --no-deps --no-build`. Do not reset a
database or copy records between the two modes.

## MainNet integration path, deferred

1. Obtain the existing validator's read-only handoff using
   [`CANTON_MAINNET_NODE_PROMPT.md`](CANTON_MAINNET_NODE_PROMPT.md): verified
   MainNet ledger endpoint, synchronizer/DSO, provider/treasury, dedicated service
   user, protected authentication and uploaded/vetted package identities.
2. Obtain Five North's approval/deployment for the exact DAR on the participant
   serving real Loop MainNet users. Our own node's DAR upload is not that approval.
3. Finish the genuine Loop TestNet funded lifecycle and verify preservation of
   existing position exits. Port all native ownership consent and receipt checks
   to MainNet's own identifiers; the current external adapter is TestNet-only.
4. Explicitly preserve the old ledger when switching providers; never reassign
   old users, native-wallet associations, position contract IDs or entitlements.
5. Implement the agreed per-user CC allocation and actual coupon collection/
   payment flow. Wallet connection, database allocation and coupon assignment
   are not proof of paid CC. Do not reuse TestNet contracts or credentials.
6. Review the MainNet code/configuration changes, verify real-party signing and
   then authorize a separate controlled release. Keep the current external
   signing gate closed until those steps are satisfied.

`/api/readiness` reports the MainNet external-signing blocker and
`ccPaymentsEnabled: false`. Startup rejects accidental MainNet activation of
the TestNet-only adapter. MainNet Loop wallet connection itself continues using
`https://cantonloop.com`; TestNet retains its existing Loop DevNet configuration
until the separate real TestNet participant cutover is approved.

## Verification status

Completed on 2026-10-04. Both domains run the rebuilt application images:

| Service | Running image ID (SHA-256) |
| --- | --- |
| Both backends | `761fbadc33f1af4516612b8a571fe93dccc7e93e63208b60a21244190dfc2a3b` |
| MainNet frontend | `63f41bfc255691518d61468b5a341ca904106e6e226ea61c496f8fe20991e963` |
| TestNet frontend | `01dff7ce4f958af10874240ef1693ce2a2d204340214f978820dbb3bd84a6733` |

- Backend/frontend type checks, both optimized frontend builds, and the existing
  frontend test suite (37 files, 162 tests) passed. These are not real Loop
  wallet lifecycle tests.
- Live HTTP checks passed on both domains: health/readiness, correct deployment
  mode and Polygon settlement chain, five pages, cache controls and disabled
  image optimizer. The removed animation button is absent.
- Real unsigned browser checks passed on both domains after replacement:
  home, staking, positions, rewards and portfolio, correct network indicator,
  no JavaScript page errors or failed application assets. Desktop/mobile
  screenshots were captured without injected wallets or mocked requests.
- Both APIs report reachable Canton and ready application services. External
  Loop staking remains blocked; CC payments remain disabled. MainNet reports no
  supported external Loop staking chains. The compiled MainNet configuration
  rejects `LOOP_STAKING_ENABLED=true` as intended.
- Existing Canton connections still point to the local ledger at
  `http://host.docker.internal:3975`; this release does not establish real
  Canton TestNet or MainNet settlement.
- Position, intent and completed-migration counts are unchanged in both
  databases. The known TestNet wallet's bonded 10 MON position remains readable;
  its Amoy liquid balance remains 1.849246702846537452 sPOL. No new transaction
  was submitted to obtain this evidence.

Private database backups are retained at
`.deploy-backups/production-20261004-loop-8HY2aL/mainnet.dump` and
`testnet.dump` (mode 0600). Both custom-format archives passed a read-only
`pg_restore --list` check. No restore was necessary. PostgreSQL, Redis, Canton,
volumes and deployment environment files were not replaced or changed.

The initial MainNet Compose replacement was interrupted (exit 130), briefly
leaving the backend unavailable. Repeating the same application-only command
completed successfully; readiness was confirmed at 15:10:19 UTC. The replacement
backend's temporary Compose name was restored to `cantonstake-backend` without
another restart. The old backend's exit 137 was not reported as an OOM kill.
The interruption's underlying cause was not established.

At 15:13:57 UTC, available host memory was approximately 3.1 GiB and disk space
129 GiB. Application RAM snapshots were 322 MiB/174 MiB for MainNet/TestNet
backends and 55 MiB/67 MiB for their frontends. These post-restart readings are
not a guarantee of steady-state memory use. Serial frontend builds completed
with the bounded worker/heap settings.

Read-only checks are never reported as wallet approval, funded staking lifecycle
or payment evidence. Genuine external Loop approval/signing and CC economics
remain separate integration gates.

### Final commit preparation and backend follow-up

The user confirmed: deploy both domains and leave live activation gated.
The application source is recorded in these descriptive commits:

- `25870e2`: staking backend, contracts, gated Loop flows and DAR tooling.
- `1ce720f`: wallet-scoped staking/positions/rewards UI and mock-era cleanup.
- `f196ee2`: dual-domain deployment controls and production checker.

Final backend verification found that importing the readiness route also
imported the reward worker through the Loop service. Configuration-only gates
were extracted into `loop-deployment.ts`; preservation checks load the heavier
service only when activation gates pass. This avoids starting worker connections
in read-only readiness tooling. It does not weaken any activation check.

Both backend containers were rebuilt/replaced for this follow-up; frontend
images were unchanged. At 17:29 UTC the public checker passed on both domains,
all four containers matched the image IDs above, and database counts were still
MainNet `2 positions / 0 intents / 8 migrations` and TestNet
`1 position / 1 intent / 8 migrations`.

Final checks passed: backend TypeScript and 115 existing unit tests, frontend
TypeScript and 162 existing tests, DAR CLI unit checks and shell syntax, plus
the five existing Daml lifecycle unit scripts. Java was copied temporarily from
the existing Canton container for those scripts; no remote ledger transaction
was submitted. These checks are not a substitute for genuine Loop acceptance.

Public rollout/integration guides and separate node prompts are retained through
a narrow Git ignore allowlist. Runtime credentials, private wallet keys,
database backups and generated artifacts remain excluded. New commits have
non-empty descriptions and no co-author trailers; no history rewrite or push
is part of this preparation.

## Existing issues observed before rollout

- TestNet Cosmos watcher: `Malformed completion event at 19191244`, with no
  successful scan. The other nine TestNet watchers reported healthy before
  application replacement. Do not label every chain healthy or reset this
  cursor without reconciling its real completion event.
- Final checks show nine healthy TestNet watchers and seven healthy MainNet
  watchers. MainNet Celestia fails on completion event `14492008`, Cosmos on
  `33181516`, and BNB on `eth_getLogs`. Persisted cursors were already stuck
  before this deployment: TestNet Cosmos since September 27, MainNet BNB since
  September 28, and MainNet Celestia/Cosmos since September 29. The rollout
  diff does not change their completion parsing or BNB scan logic. These
  existing failures need a separate event/RPC investigation; their cursors
  were not reset or advanced past unprocessed events.
- Production dependency audit still flags Next.js 14.2.35. The two critical
  advisories reviewed are [Windows-hosted RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36)
  and [AVIF image-optimization RCE](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4).
  These containers run Linux, and the unused image-optimization endpoint remains
  disabled (`images.unoptimized: true`). The public deployment check requires
  `/_next/image` to return 404. These controls are not a clean dependency audit;
  other findings and a framework-major upgrade remain separate required
  security maintenance. No automatic major-version or forced dependency rewrite
  is part of this rollout.
