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

export const config = {
  port: Number(optional("PORT", "4000")),
  logLevel: optional("LOG_LEVEL", "info"),
  demoMode: optional("DEMO_MODE", "false").toLowerCase() === "true",

  amoyRpcUrl: optional("AMOY_RPC_URL", "https://rpc-amoy.polygon.technology"),
  mockValidatorShare: required("MOCK_VALIDATOR_SHARE_ADDRESS"),

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

  // CIP-0104 Scan API: per-app activity records the SV emits each round.
  // Endpoint shape: GET ${scanApiUrl}/v0/events?app_activity_records=true
  // Unset on offline demo / LocalNet — paired with MOCK_REWARDS=1.
  scanApiUrl: optional("SCAN_API_URL"),

  // Offline demo mode: synthesises a deterministic seeded round stream so
  // the visualiser shows a believable CC accrual without LocalNet, Scan
  // API, or real Featured App approval. Round outputs are reproducible
  // run-to-run for predictable demo timing.
  mockRewards: optional("MOCK_REWARDS", "false").toLowerCase() === "true",
  mockRewardsSeed: Number(optional("MOCK_REWARDS_SEED", "20260505")),

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

  // Per-chain RPC + keeper configuration. Each is optional — when its
  // credentials are missing the corresponding executor returns
  // status="skipped" with reason="missing keeper credentials".
  moonbeamRpcUrl: optional("MOONBEAM_RPC_URL", "https://rpc.api.moonbeam.network"),
  monadRpcUrl: optional("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz"),
  monadStakingContract: optional("MONAD_STAKING_CONTRACT"),
  cosmosRestUrl: optional("COSMOS_REST_URL", "https://rest.cosmos.directory/cosmoshub"),
  cosmosRpcUrl: optional("COSMOS_RPC_URL", "https://rpc.cosmos.directory/cosmoshub"),
  cosmosKeeperMnemonic: optional("COSMOS_KEEPER_MNEMONIC"),
  cosmosKeeperPrefix: optional("COSMOS_KEEPER_PREFIX", "cosmos"),
  cosmosGasPrice: optional("COSMOS_GAS_PRICE", "0.025uatom"),
  suiRpcUrl: optional("SUI_RPC_URL", "https://fullnode.mainnet.sui.io"),
  suiKeeperPrivateKey: optional("SUI_KEEPER_PRIVATE_KEY"),

  // Observability (§6). Sentry DSN unset = error capture is a no-op.
  // Prometheus /metrics is always available and never gated on env.
  sentryDsn: optional("SENTRY_DSN"),
  sentryEnv: optional("SENTRY_ENV", "development"),
  sentryRelease: optional("SENTRY_RELEASE"),
} as const;
