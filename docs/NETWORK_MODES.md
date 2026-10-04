# Network Modes — testnet / mainnet switch

Status: Implemented 2026-08-16; two-stack split deployed 2026-09-17

One deployment serves **one** mode. The mode is set server-side and flips
every chain endpoint, contract address, explorer and price source at once —
there is deliberately no per-chain or per-user mix, because mixing a
mainnet wallet with testnet settlement (or the reverse) is how funds get
lost.

## Deployed topology (updated 2026-10-04): two stacks on one box

One parametrized `docker-compose.yml`, two compose projects:

| | mainnet | testnet |
|---|---|---|
| Domain | `cantonstake.pathrocknetwork.org` | `testnet.cantonstake.pathrocknetwork.org` |
| Compose project | `cantonstake` | `cantonstake-testnet` |
| Env file | `.env` | `.env` + `.env.testnet` (later wins) |
| Mode env | `NETWORK_MODE=mainnet`, `MAINNET_CONFIRMED=yes` | `NETWORK_MODE=testnet` |
| Loop network | `mainnet` (`https://cantonloop.com`) | `devnet` (`https://devnet.cantonloop.com`) |
| Host ports | backend 4001, frontend 3001, pg 5433, redis 6379 | backend 4002, frontend 3002, pg 5434, redis 6380 |
| Containers | `cantonstake-*` | `cantonstake-testnet-*` |
| Volumes | `cantonstake_pgdata` (migrated data) | `cantonstake-testnet_pgdata` (fresh, auto-migrates on boot) |
| Frontend image | `cantonstake-frontend:local` (mode baked at build) | `cantonstake-frontend:testnet` |
| Backend image | `cantonstake-backend:local` (same compiled code; env decides mode) | `cantonstake-backend:testnet` |

Operate them with:

```bash
# Fast path after frontend changes: validate once and build both images
# serially with independent persistent Next.js caches. Parallel builds require
# FRONTEND_BUILD_PARALLEL=true and sufficient spare memory.
./scripts/build-frontends.sh

# mainnet (bare domain)
docker compose -p cantonstake --env-file .env build frontend
docker compose -p cantonstake --env-file .env up -d

# testnet (subdomain) — the testnet file must come last (it wins)
docker compose -p cantonstake-testnet \
  --env-file .env --env-file .env.testnet build frontend
docker compose -p cantonstake-testnet \
  --env-file .env --env-file .env.testnet up -d
```

The paired script keeps one-off builds safe: `SKIP_FRONTEND_BUILD_CHECKS`
defaults to `false`, so direct Compose builds still run Next.js validation.
Only the paired workflow sets it after `npm run typecheck` succeeds. Builds are
serial by default and Next.js uses one build worker with a bounded compiler heap
so the live Canton services retain memory headroom.

### 2026-10-04 staged Loop deployment

Both domains can run the updated source while retaining their existing ledger
and wallet settings. `/api/readiness` now reports external Loop signing and CC
payment readiness explicitly on **both** modes. A reachable ledger is not proof
of external-wallet signing or Canton MainNet settlement. MainNet external
signing remains blocked; setting `LOOP_STAKING_ENABLED=true` there fails startup
instead of falling through to hosted TestNet-era submissions. The existing
native staking paths and position exits remain unchanged while that flag is off.

Run `node scripts/check-production-domains.mjs` after rollout for read-only
domain routing, document delivery, mode isolation and signing-gate checks.
The remaining MainNet operator handoff is
[`CANTON_MAINNET_NODE_PROMPT.md`](CANTON_MAINNET_NODE_PROMPT.md). Do not change
the live MainNet Canton endpoint or enable new signing until its own parties,
package approval, user signing and funded lifecycle have been verified.

Caddy routes by hostname (`/etc/caddy/Caddyfile`): `/api/*` and
`/loop-proxy/*` to the stack's backend port, everything else to its
frontend. Both share the dev Canton LocalNet on `:3975` — see the known
gaps below.

### Shared-ledger read isolation

Positions and pending requests must have a matching record in the serving
deployment's PostgreSQL database. Canton party visibility alone does not
prove that a contract belongs to mainnet or testnet. `/api/positions` joins
only local position mirrors; `/api/requests` joins only local pending intents.
Explicit `-mainnet`, `-testnet` and `polygon-amoy` metadata must also match
the deployment's mode. Unmirrored contracts are omitted, not guessed as
Polygon based on their EVM address. Database failures return an unavailable
response instead of falling back to the shared ledger.

Portfolio reads and public protocol totals use the same local-ownership
boundary. The two databases/volumes must remain separate; bare chain names
such as `monad` inherit the owning deployment's network mode. This prevents
cross-domain position leakage but does not replace separate Canton network
onboarding or application authentication.

## Setting the mode

The mode is **not** a flag you flip on a running deployment — it is baked
into which stack serves which domain:

- backend: `NETWORK_MODE` + `MAINNET_CONFIRMED` arrive via the compose
  env (`environment:` in `docker-compose.yml`, values from `.env` /
  `.env.testnet`); recreate the backend container to change them.
- frontend: `NEXT_PUBLIC_NETWORK_MODE` is a **build arg** — rebuild the
  per-mode frontend image (`build frontend` above), never just restart.
  `.env.testnet` pins `FRONTEND_IMAGE=cantonstake-frontend:testnet` so the
  two builds don't overwrite each other. The browser-facing Polygon
  settlement addresses (`NEXT_PUBLIC_POLYGON_*`) are build args too; set them
  in the matching Compose env file and rebuild that mode's image. Native RPC
  settings stay server-side; frontend reads use the matching backend gateway.
  Empty contract overrides retain mode-selected defaults.
- Staking requests include the frontend's baked `clientNetworkMode`. The
  backend rejects missing or mismatched modes with HTTP 409 before writing a
  Canton request; the stake page also disables signing until `/api/watchers`
  confirms that its backend is running the same mode.
- An enabled chain must also have completed a successful settlement-watcher
  scan within the last three minutes. Until then, the backend rejects new
  staking requests with HTTP 503 and the stake page disables signing;
  existing positions remain readable. A stuck polling loop cannot retain an
  indefinitely green watcher status.
- Closing a chain to new stakes does not stop its watcher while pending
  requests or bonded/unbonding positions remain. Exits continue to be
  observed and recorded on Canton.
- Loop: `.env` pins `NEXT_PUBLIC_LOOP_NETWORK=mainnet`; `.env.testnet`
  overrides it with `devnet`. The two Loop environments have separate
  accounts, credentials, party IDs and private keys.

## The interlock

`NETWORK_MODE=mainnet` without `MAINNET_CONFIRMED=yes` makes the backend
**refuse to start** (exit 1). Mainnet means real capital in every watcher, reward sweep and gas
payment; it must never happen by accident. The startup log states it
loudly, `/api/health` and `/api/watchers` expose `networkMode`, and the
frontend identifies its baked deployment mode through the network switch and
requires matching backend readiness before signing. The old mainnet page banner
and unused System status panel were removed at the user's request; transaction
and network-mismatch warnings remain.

## What changes per mode

| Chain | testnet | mainnet |
|---|---|---|
| Polygon (settlement on Ethereum L1) | Sepolia `0x4AE8f648…d08bE` / logger `0x5E3111a5…02ed` | Ethereum `0x5e3ef299…d908` / logger `0xA59C847B…512b` (verified on-chain: `token()` → POL `0x455e53…c3f6`) |
| Cosmos Hub | provider testnet (kjnodes; chain ID `provider`) | polkachu mainnet RPC/LCD |
| Celestia | mocha (POPS) | polkachu mainnet |
| Osmosis | official testnet | official mainnet |
| Sui | `graphql.testnet.sui.io` (wallet, events, validators) | `graphql.mainnet.sui.io` (wallet, events, validators) |
| Aptos | fullnode.testnet | fullnode.mainnet |
| Polkadot | Westend **Asset Hub** nomination pools (WND, 12 decimals) | Polkadot **Asset Hub** nomination pools (DOT, 10 decimals); staking does not use the relay-chain RPC |
| BNB | Chapel | BSC mainnet (same StakeHub `0x…2002`) |
| Solana | testnet | mainnet-beta |
| Monad | testnet RPC | mainnet RPC |
| Prices | backend fixed reference values are indicative only; the frontend does not present testnet positions as USD value | CoinGecko live, 5-min cache, fixed fallback on API errors; `/api/portfolio/*` responses carry `priceSource` (`coingecko` \| `fixed`) |
| Funding hints | per-chain faucet links | suppressed; real-funds transaction warnings remain |
| Baked ValidatorShare registry | seeded from `NEXT_PUBLIC_REAL_VALIDATOR_SHARES` snapshot | **not seeded** (Sepolia contracts don't exist on chain 1) — filled only by the live backend fetch |
| Explorers | testnet explorers | Etherscan / Mintscan / Solscan / BscScan / Polkascan / … |

Explicit env overrides (`*_RPC_URL`, `POLYGON_STAKE_MANAGER_ADDRESS`, …)
still win in either mode — the mode only changes the *defaults*.
Sui GraphQL, Solana RPC, and both Aptos fullnode and indexer reads are
checked against their mode's chain identifier before their data is used.

### Historical Polygon settlement RPC check (2026-08-16)

The following is an earlier diagnostic snapshot, not a current provider
availability guarantee. Current requests use the mode-bound backend RPC pool
and its configured, identity-checked fallback endpoints.

Probed 2026-08-16 across free Ethereum L1 endpoints: **mevblocker**
(`https://rpc.mevblocker.io`) is the primary — the only one accepting both
`eth_call` and 50–300-block `eth_getLogs` windows — with **publicnode** as
per-request failover (viem `fallback` transport). Neither is reliable
alone: mevblocker occasionally stalls getLogs past the 10 s timeout,
publicnode rate-limits sustained pollers with a misleading "archive"
rejection. A personal key (Alchemy/Infura/QuickNode) via
`STAKE_SETTLEMENT_RPC_URL` overrides both and lifts every limit. Mainnet
watcher caps default to a 50-block lookback / 50-block batch — do not pin
`POLYGON_WATCHER_LOOKBACK_BLOCKS` higher without a keyed RPC (a stale
5000-block pin wedged the watcher in archive territory until 2026-08-16).

Verified live on mainnet 2026-08-16: 138 active validators with
per-validator `minAmount` (127 × 1 POL, 11 × none), epoch 109374,
`/api/polygon/validator-shares` and the polygon watcher green. The
StakeManager and logger mainnet addresses had mangled EIP-55 checksums
(accepted by raw JSON-RPC probes, rejected by viem) — corrected in the
same pass.

## Known integration gaps (do not enable new flows until resolved)

- **The deployed Canton ledger remains LocalNet** in both modes. Native
  staking MainNet mode does not establish Canton MainNet settlement. Separate
  protected endpoints, parties, service authorization, exact-package approval
  and genuine Loop signing must be integrated before cutover. Recorded reward
  allocations are not actual CC claims or payments; app reward eligibility and
  beneficiary collection require separate verification.
- Sui GraphQL is reachable in both modes (checked 2026-09-26). Testnet
  system-epoch staking events can have no event or transaction sender; the
  watcher ignores these only when they do not match a tracked request or
  position. A matching event without sender proof remains unresolved rather
  than being credited. Funded-wallet end-to-end tests remain necessary.
- Polkadot's staking picker and validator-scoring endpoint read live open
  Asset Hub nomination pools. BNB validator listings come from StakeHub.
  Pool-specific Polkadot yield and historical BNB signing uptime are not
  measured.
- Mainnet volumes: the Celestia/Cosmos tx_search watchers and the Solana
  signature poller were validated on testnet traffic. Before mainnet,
  re-tune poll windows and re-verify event decoding against mainnet
  traffic (the BNB watcher already was — its event shape was verified
  against a real mainnet delegation).
- Auto-compound keepers, if ever enabled on mainnet, move real funds —
  budget caps and monitoring first.
