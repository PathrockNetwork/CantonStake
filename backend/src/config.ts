import "dotenv/config";

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

// --- Network mode ----------------------------------------------------------
//
// One deployment serves ONE mode. NETWORK_MODE=mainnet swaps every chain
// endpoint/contract to its mainnet counterpart (defaults below; explicit
// env vars still win). Mainnet additionally requires MAINNET_CONFIRMED=yes
// — the backend refuses to start otherwise, because mainnet means REAL
// CAPITAL at risk (docs/NETWORK_MODES.md).

const NETWORK_MODE = optional("NETWORK_MODE", "testnet").toLowerCase();
const isMainnet = NETWORK_MODE === "mainnet";

/** Mode-aware default: env override wins, else testnet/mainnet value. */
function modeDefault<T>(envKey: string, testnet: T, mainnet: T): T {
  const v = process.env[envKey];
  if (v !== undefined && v !== "") return (typeof testnet === "number" ? Number(v) : v) as T;
  return isMainnet ? mainnet : testnet;
}

export const config = {
  networkMode: (isMainnet ? "mainnet" : "testnet") as "testnet" | "mainnet",
  mainnetConfirmed: optional("MAINNET_CONFIRMED", "no").toLowerCase() === "yes",

  port: Number(optional("PORT", "4000")),
  logLevel: optional("LOG_LEVEL", "info"),
  demoMode: optional("DEMO_MODE", "false").toLowerCase() === "true",

  // Bor (Polygon Amoy) RPC. Used ONLY for POL balance reads and explorer
  // links — Polygon PoS staking does not settle here. `rpc-amoy.polygon.
  // technology` is not resolvable from every network, so the default is the
  // publicnode mirror.
  amoyRpcUrl: modeDefault("AMOY_RPC_URL",
    "https://polygon-amoy-bor-rpc.publicnode.com", // Bor (Amoy)
    "https://polygon-bor-rpc.publicnode.com"       // Bor (mainnet)
  ),

  // --- Polygon PoS staking settlement layer (Phase 2 / T2.1-T2.4) ---
  //
  // StakeManager, the StakingInfo logger and one ValidatorShare per validator
  // live on Ethereum L1 — Sepolia for Amoy, mainnet for Polygon mainnet. All
  // three defaults below were verified on-chain against Sepolia
  // (chainId 11155111) on 2026-08-14; StakeManager.logger() returns the
  // logger address and StakeManager.token() returns POL
  // (0x44499312f493F62f2DFd3C6435Ca3603EbFCeeBa), which the resolver reads at
  // runtime rather than hardcoding.
  // Mainnet default is mevblocker: probed 2026-08-16, the only free
  // endpoint that consistently accepts both eth_call and 50-300-block
  // eth_getLogs windows. publicnode intermittently rejects even 50-block
  // windows as "archive" under load; llamarpc/blockpi were 521; blastapi
  // 400; blxrbdn has no eth_getLogs; ankr/cloudflare need keys; drpc caps
  // below 300. mevblocker requires a User-Agent header — viem's Node fetch
  // sends one, but bare curl/urllib without one get 403. A personal key
  // (Alchemy/Infura/QuickNode) via this env var still overrides and lifts
  // every limit.
  stakeSettlementRpcUrl: modeDefault("STAKE_SETTLEMENT_RPC_URL",
    "https://ethereum-sepolia-rpc.publicnode.com", // Sepolia for Amoy
    "https://rpc.mevblocker.io"                    // Ethereum L1 for mainnet
  ),
  // Failover peer for the settlement client (viem fallback transport):
  // when the primary errors or times out, the request retries here. Empty
  // on testnet — publicnode Sepolia alone has been solid.
  stakeSettlementFallbackRpcUrl: modeDefault("STAKE_SETTLEMENT_FALLBACK_RPC_URL",
    "",
    "https://ethereum-rpc.publicnode.com"
  ),
  // Polygon PoS staking settles on Ethereum L1: Sepolia (11155111) for
  // Amoy, Ethereum (1) for mainnet.
  stakeSettlementChainId: modeDefault("STAKE_SETTLEMENT_CHAIN_ID", 11155111, 1),
  // Verified on-chain 2026-08-16: mainnet StakeManager proxy at
  // 0x5e3ef2…d908 returns token() = POL (0x455e53…c3f6) and logger() =
  // 0xa59c84…512b; Sepolia addresses verified in the real-data migration.
  stakeManagerAddress: modeDefault("POLYGON_STAKE_MANAGER_ADDRESS",
    "0x4AE8f648B1Ec892B6cc68C89cc088583964d08bE",  // Sepolia (Amoy)
    "0x5e3Ef299fDDf15eAa0432E6e66473ace8c13D908"   // Ethereum mainnet
  ),
  stakingLoggerAddress: modeDefault("POLYGON_STAKING_LOGGER_ADDRESS",
    "0x5E3111a5d928D24718c1A7897261D0B9087002ed",  // Sepolia (Amoy)
    "0xa59C847Bd5aC0172Ff4FE912C5d29E5A71A7512B"   // Ethereum mainnet
  ),
  // The validatorId → ValidatorShare registry only changes when a validator
  // joins or leaves, so a long TTL is fine; resolveValidatorShare falls back
  // to a direct StakeManager read on a miss.
  validatorShareCacheTtlSec: Number(
    optional("VALIDATOR_SHARE_CACHE_TTL_SEC", "86400")
  ),
  // Sepolia block time is ~12 s, so a 12 s poll with a 600-block initial
  // lookback covers ~2 h of history on a cold start. MAINNET FREE-TIER
  // LIMIT: publicnode's Ethereum mainnet rejects eth_getLogs ranges above
  // ~64 blocks (verified 2026-08-16: 128 blocked, 64 ok), so mainnet
  // defaults keep every request inside one block-batch. Incremental polls
  // are 1-2 blocks anyway; only the cold-start lookback is affected. A
  // personal RPC key (Alchemy/Infura/QuickNode via STAKE_SETTLEMENT_RPC_URL)
  // removes the cap entirely.
  polygonWatcherPollMs: Number(optional("POLYGON_WATCHER_POLL_MS", "12000")),
  polygonWatcherLookbackBlocks: modeDefault("POLYGON_WATCHER_LOOKBACK_BLOCKS", 600, 50),
  polygonWatcherMaxRange: modeDefault("POLYGON_WATCHER_MAX_BLOCK_RANGE", 5000, 50),

  cantonJsonApiUrl: optional("CANTON_JSON_API_URL", "http://localhost:3975"),
  cantonAppProviderParty: required("CANTON_APP_PROVIDER_PARTY"),
  cantonAuthToken: optional("CANTON_AUTH_TOKEN"),
  cantonDelegatorParty: required("CANTON_DELEGATOR_PARTY"),
  cantonDelegatorAuthToken: optional("CANTON_DELEGATOR_AUTH_TOKEN"),

  featuredAppRightCid: optional("FEATURED_APP_RIGHT_CID"),

  // CIP-0104 (approved 2026-02-12) replaces FeaturedAppActivityMarker with
  // sequencer/mediator-derived traffic attribution. The CIP-0104 path is
  // primary; legacy markers are kept as a backwards-compat fallback during
  // the staged rollout. Set USE_LEGACY_MARKERS=true to emit the legacy
  // marker alongside the OnchainEvent traffic beacon.
  useLegacyMarkers: optional("USE_LEGACY_MARKERS", "false").toLowerCase() === "true",

  // CID of the BeneficiarySplit contract used by RecordStake exercises.
  // Created at setup time with the default 75/25 weights. The orchestrator
  // skips RecordStake when this is unset (keeps demo path working without
  // a configured split).
  beneficiarySplitCid: optional("BENEFICIARY_SPLIT_CID"),

  // PostgreSQL + Prisma
  databaseUrl: optional("DATABASE_URL", "postgresql://cantonstake:cantonstake@localhost:5432/cantonstake"),

  // Redis + BullMQ
  redisUrl: optional("REDIS_URL", "redis://localhost:6379"),

  // CIP-0104 Scan API: per-app activity records the SV emits each network
  // round. Endpoint shape (verified against the LocalNet Scan on
  // 2026-08-14): POST ${scanApiUrl}/v0/events with {"page_size": N}; each
  // returned event carries an optional `app_activity_records` object
  // {round_number, records: [{party, weight}]}. Unset = reward rounds run
  // but mint 0 CC (honest empty attribution, not a fabricated stream).
  scanApiUrl: optional("SCAN_API_URL"),
  // Page size for the /v0/events poll. The LocalNet Scan does not expose a
  // cursor, so this is a single bounded fetch per round tick.
  scanPageSize: Number(optional("SCAN_PAGE_SIZE", "500")),
  // Gross CC the round distributes across the weights above. The LocalNet
  // Scan does not publish a per-round mint pool, so the pool size is a
  // configured constant — the party set and per-party weights are real
  // (from sequencer-derived AppActivityRecords), the pool is labelled.
  scanRoundCcPool: Number(optional("SCAN_ROUND_CC_POOL", "100")),

  // Anthropic API for the live round narrator on /rewards. Falls back to
  // a templated explanation when unset (offline demo path).
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-haiku-4-5"),

  // Validator quality scoring (§4 Tier-A). Free sources, Redis-cached so
  // a single 1-hour refresh covers all per-user lookups. Set
  // VALIDATOR_SCORING_DISABLED=true to suppress the BullMQ refresh job
  // entirely (offline demos that don't need the network call out).
  validatorScoringDisabled:
    optional("VALIDATOR_SCORING_DISABLED", "false").toLowerCase() === "true",
  validatorScoringTtlSec: Number(
    optional("VALIDATOR_SCORING_TTL_SEC", "3600")
  ),
  validatorScoringRefreshSec: Number(
    optional("VALIDATOR_SCORING_REFRESH_SEC", "3600")
  ),

  // Notifications (§4 Tier-A). Each provider is gated on its own credential
  // — set just the ones you want to use. The service silently no-ops on
  // disabled channels, so a partially-configured environment still works.
  telegramBotToken: optional("TELEGRAM_BOT_TOKEN"),
  resendApiKey: optional("RESEND_API_KEY"),
  resendFrom: optional("RESEND_FROM", "alerts@cantonstake.app"),
  // Default Discord webhook for app-wide alerts when a user has none configured.
  // Per-user webhook URLs override this.
  discordDefaultWebhook: optional("DISCORD_DEFAULT_WEBHOOK"),

  // Slashing alerts: emit when a validator's score drops by at least
  // ALERT_SCORE_DROP_THRESHOLD points, even without a jailed transition.
  alertScoreDropThreshold: Number(optional("ALERT_SCORE_DROP_THRESHOLD", "20")),
  alertsDisabled: optional("ALERTS_DISABLED", "false").toLowerCase() === "true",

  // Portfolio cache (§4 Tier-A). Per-(chain, address) Redis snapshots
  // of getDelegations so the frontend's analytics polling doesn't
  // hammer upstream RPCs.
  portfolioCacheTtlSec: Number(optional("PORTFOLIO_CACHE_TTL_SEC", "60")),
  // TVL snapshot cron cadence — drives the over-time chart series.
  portfolioSnapshotIntervalSec: Number(
    optional("PORTFOLIO_SNAPSHOT_INTERVAL_SEC", "300")
  ),
  portfolioSnapshotsDisabled:
    optional("PORTFOLIO_SNAPSHOTS_DISABLED", "false").toLowerCase() === "true",

  // Auto-compound keeper (§4 Tier-A). Permits stored on the User; the
  // keeper scans active permits every interval and exercises compound on
  // their behalf using the keeper signer. Disable for offline demos.
  autoCompoundDisabled:
    optional("AUTO_COMPOUND_DISABLED", "true").toLowerCase() === "true",
  autoCompoundIntervalSec: Number(
    optional("AUTO_COMPOUND_INTERVAL_SEC", "900")
  ),
  // The keeper's signing key for EVM compound calls. NEVER ship a real
  // key in code — load from AWS Secrets Manager / Doppler in prod.
  autoCompoundKeeperKey: optional("AUTO_COMPOUND_KEEPER_KEY"),

  // Per-chain RPC + keeper configuration — testnet defaults across the
  // board. Each is optional; when its keeper credentials are missing
  // the corresponding executor returns status="skipped".
  // Monad Testnet (chain id 10143)
  monadRpcUrl: modeDefault("MONAD_RPC_URL",
    "https://testnet-rpc.monad.xyz",
    "https://rpc.monad.xyz"
  ),
  monadStakingContract: optional("MONAD_STAKING_CONTRACT"),
  // Cosmos Hub theta-testnet — Polypore sentry-01 endpoints
  cosmosRestUrl: modeDefault("COSMOS_REST_URL",
    "https://cosmoshub-testnet.api.kjnodes.com", // theta-testnet
    "https://cosmos-api.polkachu.com"            // Cosmos Hub mainnet
  ),
  cosmosRpcUrl: modeDefault("COSMOS_RPC_URL",
    "https://cosmoshub-testnet.rpc.kjnodes.com", // theta-testnet
    "https://cosmos-rpc.polkachu.com"            // Cosmos Hub mainnet
  ),
  // Celestia mocha testnet (public POPS endpoints, verified reachable
  // 2026-08-16). utia has 6 decimals like uatom.
  celestiaRpcUrl: modeDefault("CELESTIA_RPC_URL",
    "https://rpc-mocha.pops.one",        // mocha testnet
    "https://celestia-rpc.polkachu.com"  // mainnet
  ),
  celestiaRestUrl: modeDefault("CELESTIA_REST_URL",
    "https://api-mocha.pops.one",        // mocha testnet
    "https://celestia-api.polkachu.com"  // mainnet
  ),
  // Osmosis testnet (official endpoints, verified 2026-08-16).
  osmosisRpcUrl: modeDefault("OSMOSIS_RPC_URL",
    "https://rpc.testnet.osmosis.zone", // testnet
    "https://rpc.osmosis.zone"          // mainnet
  ),
  osmosisRestUrl: modeDefault("OSMOSIS_REST_URL",
    "https://lcd.testnet.osmosis.zone", // testnet
    "https://lcd.osmosis.zone"          // mainnet
  ),
  // Aptos testnet fullnode (REST, verified reachable 2026-08-16).
  aptosRestUrl: modeDefault("APTOS_REST_URL",
    "https://fullnode.testnet.aptoslabs.com",
    "https://fullnode.mainnet.aptoslabs.com"
  ),
  // Polkadot Westend testnet (Substrate RPC over HTTPS; Cloudflare-hosted,
  // blocks non-browser UAs — viem/fetch default UA works).
  // Substrate RPC: Westend testnet / Polkadot mainnet — same runtime
  // shapes (nominationPools), different chain.
  polkadotRpcUrl: modeDefault("POLKADOT_RPC_URL",
    "https://westend-rpc.polkadot.io",
    "https://rpc.polkadot.io"
  ),
  // BNB Smart Chain Chapel testnet.
  // StakeHub lives at the same 0x…2002 address on both networks
  // (verified against a real mainnet Delegated event, 2026-08-16).
  bnbRpcUrl: modeDefault("BNB_RPC_URL",
    "https://bsc-testnet-rpc.publicnode.com", // Chapel
    "https://bsc-rpc.publicnode.com"          // BSC mainnet
  ),
  // Solana testnet.
  solanaRpcUrl: modeDefault("SOLANA_RPC_URL",
    "https://api.testnet.solana.com",
    "https://api.mainnet-beta.solana.com"
  ),
  cosmosKeeperMnemonic: optional("COSMOS_KEEPER_MNEMONIC"),
  cosmosKeeperPrefix: optional("COSMOS_KEEPER_PREFIX", "cosmos"),
  cosmosGasPrice: optional("COSMOS_GAS_PRICE", "0.025uatom"),
  // Sui Testnet
  suiRpcUrl: optional("SUI_RPC_URL", "https://fullnode.testnet.sui.io:443"),
  suiKeeperPrivateKey: optional("SUI_KEEPER_PRIVATE_KEY"),

  // Loop SDK CORS proxy. Devnet's edge (Cloudflare-fronted) blocks any
  // origin that's not on its allowlist — including dev/IP origins. We mount
  // a same-origin reverse proxy at /loop-proxy so the SDK calls go through
  // our backend instead of directly to cantonloop.com. Disable in prod
  // once fivenorth allowlists your real origin.
  loopProxyEnabled:
    optional("LOOP_PROXY_ENABLED", "true").toLowerCase() === "true",
  loopProxyUpstream: optional(
    "LOOP_API_UPSTREAM",
    "https://devnet.cantonloop.com"
  ),

  // Observability (§6). Sentry DSN unset = error capture is a no-op.
  // Prometheus /metrics is always available and never gated on env.
  sentryDsn: optional("SENTRY_DSN"),
  sentryEnv: optional("SENTRY_ENV", "development"),
  sentryRelease: optional("SENTRY_RELEASE"),
} as const;
