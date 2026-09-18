# Network Modes — testnet / mainnet switch

Status: Implemented 2026-08-16; two-stack split deployed 2026-09-17

One deployment serves **one** mode. The mode is set server-side and flips
every chain endpoint, contract address, explorer and price source at once —
there is deliberately no per-chain or per-user mix, because mixing a
mainnet wallet with testnet settlement (or the reverse) is how funds get
lost.

## Deployed topology (2026-09-17): two stacks on one box

One parametrized `docker-compose.yml`, two compose projects:

| | mainnet | testnet |
|---|---|---|
| Domain | `cantonstake.pathrocknetwork.org` | `testnet.cantonstake.pathrocknetwork.org` |
| Compose project | `cantonstake` | `cantonstake-testnet` |
| Env file | `.env` | `.env` + `.env.testnet` (later wins) |
| Mode env | `NETWORK_MODE=mainnet`, `MAINNET_CONFIRMED=yes` | `NETWORK_MODE=testnet` |
| Host ports | backend 4001, frontend 3001, pg 5433, redis 6379 | backend 4002, frontend 3002, pg 5434, redis 6380 |
| Containers | `cantonstake-*` | `cantonstake-testnet-*` |
| Volumes | `cantonstake_pgdata` (migrated data) | `cantonstake-testnet_pgdata` (fresh, auto-migrates on boot) |
| Frontend image | `cantonstake-frontend:local` (mode baked at build) | `cantonstake-frontend:testnet` |
| Backend image | `cantonstake-backend:local` (shared; env decides the mode) | same |

Operate them with:

```bash
# mainnet (bare domain)
docker compose -p cantonstake --env-file .env build frontend
docker compose -p cantonstake --env-file .env up -d

# testnet (subdomain) — the testnet file must come last (it wins)
docker compose -p cantonstake-testnet \
  --env-file .env --env-file .env.testnet build frontend
docker compose -p cantonstake-testnet \
  --env-file .env --env-file .env.testnet up -d
```

Caddy routes by hostname (`/etc/caddy/Caddyfile`): `/api/*` and
`/loop-proxy/*` to the stack's backend port, everything else to its
frontend. Both share the dev Canton LocalNet on `:3975` — see the known
gaps below.

## Setting the mode

The mode is **not** a flag you flip on a running deployment — it is baked
into which stack serves which domain:

- backend: `NETWORK_MODE` + `MAINNET_CONFIRMED` arrive via the compose
  env (`environment:` in `docker-compose.yml`, values from `.env` /
  `.env.testnet`); recreate the backend container to change them.
- frontend: `NEXT_PUBLIC_NETWORK_MODE` is a **build arg** — rebuild the
  per-mode frontend image (`build frontend` above), never just restart.
  `.env.testnet` pins `FRONTEND_IMAGE=cantonstake-frontend:testnet` so the
  two builds don't overwrite each other.

## The interlock

`NETWORK_MODE=mainnet` without `MAINNET_CONFIRMED=yes` makes the backend
**refuse to start** (exit 1). Mainnet means real capital in every watcher, reward sweep and gas
payment; it must never happen by accident. The startup log states it
loudly, `/api/health` and `/api/watchers` expose `networkMode`, and the
frontend shows a red **MAINNET — REAL FUNDS** banner plus a mode chip in
System status (taken from the backend at runtime — the backend is what
settles, so it is the source of truth).

## What changes per mode

| Chain | testnet | mainnet |
|---|---|---|
| Polygon (settlement on Ethereum L1) | Sepolia `0x4AE8f648…d08bE` / logger `0x5E3111a5…02ed` | Ethereum `0x5e3ef299…d908` / logger `0xA59C847B…512b` (verified on-chain: `token()` → POL `0x455e53…c3f6`) |
| Cosmos Hub | theta-testnet (kjnodes) | polkachu mainnet RPC/LCD |
| Celestia | mocha (POPS) | polkachu mainnet |
| Osmosis | official testnet | official mainnet |
| Aptos | fullnode.testnet | fullnode.mainnet |
| Polkadot | Westend | Polkadot relay |
| BNB | Chapel | BSC mainnet (same StakeHub `0x…2002`) |
| Solana | testnet | mainnet-beta |
| Monad | testnet RPC | mainnet RPC |
| Prices | fixed reference values (`services/prices.ts` table) | CoinGecko live, 5-min cache, fixed fallback on API errors; `/api/portfolio/*` responses carry `priceSource` (`coingecko` \| `fixed`) |
| Funding hints | per-chain faucet links | suppressed — replaced by the real-funds banner |
| Baked ValidatorShare registry | seeded from `NEXT_PUBLIC_REAL_VALIDATOR_SHARES` snapshot | **not seeded** (Sepolia contracts don't exist on chain 1) — filled only by the live backend fetch |
| Explorers | testnet explorers | Etherscan / Mintscan / Solscan / BscScan / Polkascan / … |

Explicit env overrides (`*_RPC_URL`, `POLYGON_STAKE_MANAGER_ADDRESS`, …)
still win in either mode — the mode only changes the *defaults*.

### Polygon settlement RPC (mainnet)

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

## Known mainnet gaps (do not flip until resolved)

- **The Canton ledger stays LocalNet/DevNet** in both modes. A true
  mainnet posture requires Canton Network mainnet onboarding (Featured App
  approval, 2/3 SV vote — see `docs/REAL_DATA_MIGRATION.md` §2). The CC
  reward side therefore remains a devnet-style simulation even when the
  staking chains are mainnet.
- Sui's watcher is unreachable in both modes (public JSON-RPC deprecated;
  GraphQL host not resolvable from this box).
- Polkadot/BNB validator listings are honest stubs.
- Mainnet volumes: the Celestia/Cosmos tx_search watchers and the Solana
  signature poller were validated on testnet traffic. Before mainnet,
  re-tune poll windows and re-verify event decoding against mainnet
  traffic (the BNB watcher already was — its event shape was verified
  against a real mainnet delegation).
- Auto-compound keepers, if ever enabled on mainnet, move real funds —
  budget caps and monitoring first.
