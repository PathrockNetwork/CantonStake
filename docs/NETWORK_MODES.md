# Network Modes — testnet / mainnet switch

Status: Implemented 2026-08-16

One deployment serves **one** mode. The mode is set server-side and flips
every chain endpoint, contract address, explorer and price source at once —
there is deliberately no per-chain or per-user mix, because mixing a
mainnet wallet with testnet settlement (or the reverse) is how funds get
lost.

## Setting the mode

```bash
# backend/.env
NETWORK_MODE=mainnet          # default: testnet
MAINNET_CONFIRMED=yes         # REQUIRED when mode=mainnet — see below

# frontend/.env (baked at build time; must match the backend)
NEXT_PUBLIC_NETWORK_MODE=mainnet
```

Then: `systemctl restart cantonstake-backend` and
`cd frontend && npm run build && systemctl restart cantonstake-frontend`.

The natural production topology is **two deployments** (e.g.
`cantonstake.…` = mainnet, `staging.cantonstake.…` = testnet) — Caddy can
serve both from this box.

## The interlock

`NETWORK_MODE=mainnet` without `MAINNET_CONFIRMED=yes` makes the backend
**refuse to start** (exit 1). `DEMO_MODE=true` is also rejected in mainnet
mode. Mainnet means real capital in every watcher, reward sweep and gas
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
| Prices | fixed reference values | CoinGecko live (labelled `coingecko`), fixed fallback |
| Funding hints | per-chain faucet links | suppressed — replaced by the real-funds banner |
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
