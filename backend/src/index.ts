import { rpcUrls } from "./services/rpc-registry.js";
/**
 * Fastify HTTP server exposing a thin API for the frontend.
 *
 * Endpoints:
 *   POST /api/requests          - create a StakingRequest on Canton
 *   GET  /api/positions         - list all StakingPositions for a given evmAddress
 *   GET  /api/requests          - list all pending StakingRequests for a given evmAddress
 *   GET  /api/rewards/:address  - CC reward summary for a delegator
 *   GET  /api/health            - health check
 *
 * Auth: none for the hackathon MVP. In production, tie to the user's
 *       signed-in Canton party via OAuth2 / Keycloak.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createPublicClient, formatEther, http, parseUnits, type Address } from "viem";
import { polygonAmoy } from "viem/chains";
import { config } from "./config.js";
import { canton, cantonDelegator, TEMPLATES } from "./canton.js";
import { startReleaseChecker, featuredRightCidForDaml, extractCreatedContractId } from "./orchestrator.js";
import { startMultichainWatchers, watchersHealth } from "./multichain-watcher.js";
import { prisma } from "./db.js";
import { startRewardScheduler, shutdownRewardSystem, redisConnection, enqueueRound } from "./reward-rounds.js";
import { narrate } from "./services/narrator.js";
import {
  captureException,
  counter,
  renderMetrics,
} from "./services/observability.js";
import {
  startValidatorScoringScheduler,
  shutdownValidatorScoring,
} from "./services/validator-scoring.js";
import { shutdownNotifications } from "./services/notifications.js";
import {
  startPortfolioSnapshotScheduler,
  shutdownPortfolioSnapshots,
} from "./services/portfolio-snapshots.js";
import {
  startAutoCompoundScheduler,
  shutdownAutoCompound,
} from "./services/auto-compound.js";
import sweepRoutes from "./routes/sweep.js";
import rewardHistoryRoutes from "./routes/reward-history.js";
import validatorRoutes from "./routes/validators.js";
import notificationsRoutes from "./routes/notifications.js";
import taxRoutes from "./routes/tax.js";
import portfolioRoutes from "./routes/portfolio.js";
import autoCompoundRoutes from "./routes/auto-compound.js";
import rewardsRoutes from "./routes/rewards.js";
import protocolRoutes from "./routes/protocol.js";
import chainsRoutes from "./routes/chains.js";
import polygonRoutes from "./routes/polygon.js";
import polkadotRoutes from "./routes/polkadot.js";
import readinessRoutes from "./routes/readiness.js";
import loopProxyRoutes from "./routes/loop-proxy.js";
import rpcRoutes from "./routes/rpc.js";
import { normalizeWalletAddress, sameWalletAddress } from "./services/wallet-address.js";
import { assertSolanaNetwork, solanaRpc, SOLANA_STAKE_ACCOUNT_SPACE } from "./services/solana-rpc.js";
import { polkadotApi, POLKADOT_ASSET_HUB, parsePolkadotPoolKey } from "./services/polkadot-rpc.js";
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto";
import { assertEvmRpcChainId } from "./services/evm-network.js";
import { settlementClient } from "./services/validator-share.js";
import { monadStakingClient } from "./services/monad-staking.js";
import { bnbStakingClient } from "./services/bnb-staking.js";
import { assertCosmosRpcNetwork, assertSuiGraphqlNetwork } from "./services/native-network.js";
import { nativeStakeInputError } from "./services/native-staking-input.js";
import { watcherGateError } from "./services/watcher-gate.js";
import { parseAptosDelegationStake } from "./services/aptos-lifecycle.js";

const publicClient = createPublicClient({
  chain: polygonAmoy,
  transport: http(rpcUrls["polygon"], { timeout: 16_000, retryCount: 0 }),
});

const validatorShareAbi = [
  {
    type: "function",
    name: "pendingRewards",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function sumWei(values: string[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value || "0"), 0n);
}

function weiToPol(value: bigint): number {
  return Number(formatEther(value));
}

async function upsertUserIdentity(args: {
  cantonPartyId: string;
  evmAddress?: string;
  displayName?: string;
}) {
  const evmAddress = args.evmAddress
    ? normalizeWalletAddress(args.evmAddress)
    : undefined;

  const existingByParty = await prisma.user.findUnique({
    where: { cantonPartyId: args.cantonPartyId },
  });
  if (existingByParty) {
    if (evmAddress && existingByParty.evmAddress !== evmAddress) {
      const conflict = await prisma.user.findUnique({ where: { evmAddress } });
      if (conflict && conflict.id !== existingByParty.id) {
        await prisma.user.update({
          where: { id: conflict.id },
          data: { evmAddress: null },
        });
      }
    }
    return prisma.user.update({
      where: { id: existingByParty.id },
      data: { evmAddress, displayName: args.displayName },
    });
  }

  if (evmAddress) {
    const existingByAddress = await prisma.user.findUnique({
      where: { evmAddress },
    });
    if (existingByAddress) {
      return prisma.user.update({
        where: { id: existingByAddress.id },
        data: {
          cantonPartyId: args.cantonPartyId,
          displayName: args.displayName,
        },
      });
    }
  }

  return prisma.user.create({
    data: {
      cantonPartyId: args.cantonPartyId,
      evmAddress,
      displayName: args.displayName,
    },
  });
}

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      config.logLevel === "info"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

await app.register(cors, { origin: true });

// --- Mainnet interlock ------------------------------------------------------
//
// NETWORK_MODE=mainnet points every watcher at mainnet contracts with REAL
// capital. That must never happen by accident: require an explicit
// MAINNET_CONFIRMED=yes acknowledgement.
if (config.networkMode === "mainnet") {
  if (!config.mainnetConfirmed) {
    console.error(
      "[network-mode] FATAL: NETWORK_MODE=mainnet without MAINNET_CONFIRMED=yes. " +
        "Mainnet mode moves real funds — set MAINNET_CONFIRMED=yes when that is " +
        "intentional, or unset NETWORK_MODE to stay on testnet."
    );
    process.exit(1);
  }
  console.warn(
    "[network-mode] MAINNET MODE ACTIVE — all watchers follow mainnet " +
      "networks with real capital at risk."
  );
}

// --- Observability hooks ---
//
// onError fires for every uncaught exception out of a route handler.
// We send to Sentry (no-op when SENTRY_DSN is unset) and increment an
// http_errors counter. The original error still propagates to Fastify's
// default error handler — captureException is fire-and-forget.
app.addHook("onError", async (req, _reply, err) => {
  const route = req.routeOptions.url ?? req.url;
  counter("cantonstake_http_errors_total", "Uncaught HTTP errors", {
    method: req.method,
    route,
  });
  captureException(err, {
    tags: { method: req.method, route },
    extra: { url: req.url },
  });
});

app.addHook("onResponse", async (req, reply) => {
  const route = req.routeOptions.url ?? req.url;
  counter("cantonstake_http_requests_total", "HTTP requests", {
    method: req.method,
    route,
    status: String(reply.statusCode),
  });
});

// --- Health ---

// --- Prometheus metrics ---
app.get("/metrics", async (_req, reply) => {
  return reply
    .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
    .send(renderMetrics());
});

// Per-chain watcher reachability. The frontend uses this to disable
// staking on chains whose watcher cannot reach its RPC host (egress
// filtering, deprecated endpoints) — an offline watcher means a stake
// would create a Canton request that never settles.
app.get("/api/watchers", async () => ({
  networkMode: config.networkMode,
  watchers: watchersHealth(),
}));

app.get("/api/health", async () => ({
  status: "ok",
  networkMode: config.networkMode,
  cantonJsonApi: config.cantonJsonApiUrl,
  // Polygon staking settles on Ethereum L1. There is no single validator
  // contract to report — one ValidatorShare exists per validator — so the
  // StakeManager that resolves them is what identifies the deployment.
  stakeManager: config.stakeManagerAddress,
  stakeSettlementChainId: config.stakeSettlementChainId,
  featuredAppRight: config.featuredAppRightCid ? "configured" : "missing",
  time: new Date().toISOString(),
}));

app.get("/api/health/detail", async () => {
  let dbStatus = "unknown";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch {
    dbStatus = "disconnected";
  }

  let redisStatus = "unknown";
  try {
    const pong = await redisConnection.ping();
    redisStatus = pong === "PONG" ? "connected" : "disconnected";
  } catch {
    redisStatus = "disconnected";
  }

  const latestRound = await prisma.rewardRound.findFirst({
    orderBy: { roundNumber: "desc" },
  });
  const warnings = [
    !config.featuredAppRightCid
      ? "FEATURED_APP_RIGHT_CID missing: reward rounds will be skipped"
      : null,
    config.featuredAppRightCid === "demo-stub"
      ? "FEATURED_APP_RIGHT_CID=demo-stub: scheduler runs, Daml marker exercise is disabled"
      : null,
    config.logLevel !== "debug"
      ? "Manual ops triggers (rounds/refresh/autocompound) disabled outside LOG_LEVEL=debug"
      : null,
    !config.scanApiUrl
      ? "SCAN_API_URL unset: reward rounds mint 0 CC (no real attribution source)"
      : null,
    config.useLegacyMarkers
      ? "USE_LEGACY_MARKERS=true: legacy FeaturedAppActivityMarker emission is enabled"
      : null,
    !config.anthropicApiKey
      ? "ANTHROPIC_API_KEY unset: /api/narrator returns rule-based output"
      : null,
    config.alertsDisabled
      ? "ALERTS_DISABLED=true: slashing-monitor diff is a no-op"
      : null,
    !config.telegramBotToken && !config.resendApiKey && !config.discordDefaultWebhook
      ? "no notification provider configured (Telegram/Resend/Discord all unset): alerts will queue but never deliver"
      : null,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    status: "ok",
    cantonJsonApi: config.cantonJsonApiUrl,
    cantonDelegatorParty: config.cantonDelegatorParty,
    stakeManager: config.stakeManagerAddress,
    stakingLogger: config.stakingLoggerAddress,
    stakeSettlementChainId: config.stakeSettlementChainId,
    featuredAppRight: config.featuredAppRightCid ? "configured" : "missing",
    database: dbStatus,
    redis: redisStatus,
    latestRound: latestRound
      ? {
          roundNumber: latestRound.roundNumber,
          status: latestRound.status,
          totalTxns: latestRound.totalTxns,
          totalMarkers: latestRound.totalMarkers,
          markerToTxRatio: latestRound.markerToTxRatio,
        }
      : null,
    warnings,
    time: new Date().toISOString(),
  };
});

// --- Lookup user by EVM address ---

app.get<{ Params: { address: string } }>(
  "/api/users/by-evm/:address",
  async (req, reply) => {
    const address = req.params.address.toLowerCase();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "invalid EVM address" });
    }
    try {
      const user = await prisma.user.findFirst({
        where: { evmAddress: address },
      });
      if (!user) return reply.code(404).send({ error: "user not found" });
      return { user };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  },
);

// --- Upsert user (Loop wallet identity) ---

interface UpsertUserBody {
  cantonPartyId: string;
  evmAddress?: string;
  displayName?: string;
}

app.post<{ Body: UpsertUserBody }>("/api/users", async (req, reply) => {
  const { cantonPartyId, evmAddress, displayName } = req.body;
  if (!cantonPartyId) {
    return reply.code(400).send({ error: "missing cantonPartyId" });
  }
  try {
    const user = await upsertUserIdentity({
      cantonPartyId,
      evmAddress,
      displayName,
    });
    return { user };
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: String(err) });
  }
});

// --- Create a StakingRequest ---

const VALID_CHAINS = new Set([
  "polygon",
  "monad",
  "cosmos",
  "celestia",
  "osmosis",
  "sui",
  "aptos",
  "polkadot",
  "bnb",
  "solana",
]);

interface CreateRequestBody {
  evmAddress: string;
  amountPol: string; // decimal string, e.g. "1.5"
  clientNetworkMode?: "testnet" | "mainnet";
  chain?: string;
  validator?: string;
  stakeAccountAddress?: string;
  delegator?: string; // Loop/Canton party id
}

function canonicalStakeAmount(value: string): string | null {
  const raw = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const integer = whole!.replace(/^0+(?=\d)/, "");
  const decimal = fraction.replace(/0+$/, "");
  // StakingRequest.amountPol is a Daml Decimal (Numeric 10). Reject a
  // nonzero sub-10th-decimal remainder before a wallet transaction is sent.
  if (decimal.length > 10) return null;
  const result = decimal ? `${integer}.${decimal}` : integer;
  return result === "0" ? null : result;
}

app.post<{ Body: CreateRequestBody }>("/api/requests", async (req, reply) => {
  const { evmAddress, validator, stakeAccountAddress } = req.body;
  const amountPol = typeof req.body.amountPol === "string"
    ? canonicalStakeAmount(req.body.amountPol)
    : null;
  const chain = req.body.chain ?? "polygon";
  const delegator = req.body.delegator || config.cantonDelegatorParty;

  // A stale frontend image can otherwise create a mainnet Canton intent and
  // then ask its wallet to sign on testnet (or vice versa). Require every
  // staking client to state the mode it was built for before any ledger write.
  if (req.body.clientNetworkMode !== config.networkMode) {
    return reply.code(409).send({
      error: `Staking client network ${req.body.clientNetworkMode ?? "unknown"} does not match backend ${config.networkMode}; reload the correct deployment`,
    });
  }
  if (!evmAddress || !amountPol) {
    return reply.code(400).send({ error: "address and positive decimal amount are required" });
  }
  if (!VALID_CHAINS.has(chain)) {
    return reply.code(400).send({ error: `invalid chain: ${chain}` });
  }
  // The wall: a chain outside ENABLED_CHAINS is not stakable in this
  // deployment, even though its id is known. 403 (not 400) so the UI can
  // distinguish "typo" from "deliberately walled".
  if (!config.enabledChains.has(chain)) {
    return reply.code(403).send({
      error:
        `chain ${chain} is not open for staking in this deployment ` +
        `(enabled: ${[...config.enabledChains].join(", ")})`,
    });
  }
  // Cosmos / Sui delegator addresses aren't 0x... — we only enforce the
  // EVM regex when the staking chain is EVM-based.
  const isEvmChain = chain === "polygon" || chain === "monad" || chain === "bnb";
  if (isEvmChain && !/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
    return reply.code(400).send({ error: "invalid EVM address" });
  }
  if ((chain === "bnb" || chain === "polygon") &&
      (!validator || !/^0x[a-fA-F0-9]{40}$/.test(validator))) {
    return reply.code(400).send({ error: `${chain} staking requires a validator address` });
  }
  if (chain === "monad" && (!validator || !/^\d+$/.test(validator))) {
    return reply.code(400).send({ error: "Monad staking requires a numeric validator ID" });
  }
  if (chain === "cosmos" || chain === "celestia" || chain === "osmosis" || chain === "sui") {
    const error = nativeStakeInputError(chain, evmAddress, validator, amountPol);
    if (error) return reply.code(400).send({ error });
  }
  if (chain === "aptos" &&
      (!/^0x[a-fA-F0-9]{64}$/.test(evmAddress) || !validator || !/^0x[a-fA-F0-9]{64}$/.test(validator))) {
    return reply.code(400).send({ error: "Aptos staking requires full 32-byte delegator and delegation-pool addresses" });
  }
  if (chain === "solana" &&
      (![evmAddress, validator, stakeAccountAddress].every((value) => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) ||
        stakeAccountAddress === evmAddress || stakeAccountAddress === validator)) {
    return reply.code(400).send({ error: "Solana staking requires distinct wallet, vote-account, and new stake-account public keys" });
  }
  const polkadotPoolId = chain === "polkadot" ? parsePolkadotPoolKey(validator ?? "") : null;
  if (chain === "polkadot") {
    if (polkadotPoolId === null || !/^[1-9A-HJ-NP-Za-km-z]{47,49}$/.test(evmAddress)) {
      return reply.code(400).send({ error: "Polkadot staking requires a canonical wallet address and pool ID" });
    }
    try {
      const canonical = encodeAddress(decodeAddress(evmAddress), config.networkMode === "mainnet" ? 0 : 42);
      if (canonical !== evmAddress) return reply.code(400).send({ error: "Polkadot address does not match this network's SS58 format" });
    } catch {
      return reply.code(400).send({ error: "Invalid Polkadot wallet address" });
    }
  }
  let aptosAmountOcta: bigint | null = null;
  if (chain === "aptos") {
    if (!/^\d+(?:\.\d{1,8})?$/.test(amountPol)) {
      return reply.code(400).send({ error: "APT supports at most 8 decimal places" });
    }
    aptosAmountOcta = parseUnits(amountPol, 8);
    if (aptosAmountOcta < 1_100_000_000n || aptosAmountOcta > 18_446_744_073_709_551_615n) {
      return reply.code(400).send({ error: "Aptos delegation requires at least 11 APT and a u64-sized amount" });
    }
  }
  let solanaAmountLamports: bigint | null = null;
  let solanaRentLamports: string | null = null;
  if (chain === "solana") {
    if (!/^\d+(?:\.\d{1,9})?$/.test(amountPol)) return reply.code(400).send({ error: "SOL supports at most 9 decimal places" });
    solanaAmountLamports = parseUnits(amountPol, 9);
    if (solanaAmountLamports <= 0n || solanaAmountLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
      return reply.code(400).send({ error: "SOL stake amount is outside the supported lamport range" });
    }
  }
  const polkadotAmountPlanck = chain === "polkadot"
    ? parseUnits(amountPol, POLKADOT_ASSET_HUB[config.networkMode].decimals)
    : null;

  const watcherError = watcherGateError(chain, watchersHealth());
  if (watcherError) return reply.code(503).send({ error: watcherError });

  try {
    if (isEvmChain) {
      const rpc = chain === "polygon" ? settlementClient
        : chain === "monad" ? monadStakingClient : bnbStakingClient;
      const expected = chain === "polygon" ? config.stakeSettlementChainId
        : chain === "monad" ? (config.networkMode === "mainnet" ? 143 : 10143)
          : (config.networkMode === "mainnet" ? 56 : 97);
      const label = chain === "polygon" ? "Polygon settlement"
        : chain === "monad" ? "Monad" : "BNB";
      try {
        await assertEvmRpcChainId(rpc, expected, label);
      } catch (error) {
        return reply.code(503).send({
          error: error instanceof Error ? error.message : `${label} RPC chain identity unavailable`,
        });
      }
    }
    if (chain === "cosmos" || chain === "celestia" || chain === "osmosis" || chain === "sui") {
      try {
        if (chain === "sui") await assertSuiGraphqlNetwork();
        else await assertCosmosRpcNetwork(chain);
      } catch (error) {
        return reply.code(503).send({
          error: error instanceof Error ? error.message : `${chain} RPC chain identity unavailable`,
        });
      }
    }
    if (chain === "solana") {
      await assertSolanaNetwork();
      const [minimum, rent, wallet, stakeAccount, votes] = await Promise.all([
        solanaRpc<{ value: number }>("getStakeMinimumDelegation", [{ commitment: "finalized" }]),
        solanaRpc<number>("getMinimumBalanceForRentExemption", [SOLANA_STAKE_ACCOUNT_SPACE]),
        solanaRpc<{ value: { lamports?: number } | null }>("getAccountInfo", [evmAddress, { commitment: "finalized" }]),
        solanaRpc<{ value: unknown | null }>("getAccountInfo", [stakeAccountAddress, { commitment: "finalized" }]),
        solanaRpc<{ current: Array<{ votePubkey: string }> }>("getVoteAccounts"),
      ]);
      if (solanaAmountLamports! < BigInt(minimum.value)) {
        return reply.code(400).send({ error: `Solana minimum delegation is ${minimum.value / 1e9} SOL on this cluster` });
      }
      if (stakeAccount.value !== null) return reply.code(409).send({ error: "Solana stake account already exists; create a fresh one" });
      if (!votes.current?.some((vote) => vote.votePubkey === validator)) {
        return reply.code(400).send({ error: "Selected Solana vote account is not currently active" });
      }
      if (BigInt(wallet.value?.lamports ?? 0) < solanaAmountLamports! + BigInt(rent) + 10_000n) {
        return reply.code(400).send({ error: "Insufficient SOL for the delegation, stake-account rent, and transaction fee" });
      }
      solanaRentLamports = String(rent);
    }
    if (chain === "polkadot") {
      const api = await polkadotApi();
      const [minJoin, pool, member, account] = await Promise.all([
        api.query.nominationPools.minJoinBond(),
        api.query.nominationPools.bondedPools(polkadotPoolId!),
        api.query.nominationPools.poolMembers(evmAddress),
        api.query.system.account(evmAddress),
      ]);
      if (polkadotAmountPlanck! < BigInt(minJoin.toString())) {
        return reply.code(400).send({ error: `Polkadot pool minimum is ${minJoin.toString()} planck on this network` });
      }
      if ((pool.toJSON() as { state?: string } | null)?.state !== "Open") {
        return reply.code(400).send({ error: "Selected Polkadot nomination pool is not open" });
      }
      if (member.toJSON() !== null) {
        return reply.code(409).send({ error: "This wallet is already a nomination-pool member; use a fresh account for a CantonStake position" });
      }
      // Read the u128 codec directly: toJSON() may round large balances via JS numbers.
      const free = BigInt((account as unknown as { data: { free: { toString(): string } } }).data.free.toString());
      const fee = BigInt((await api.tx.nominationPools.join(polkadotAmountPlanck!.toString(), polkadotPoolId!).paymentInfo(evmAddress)).partialFee.toString());
      const reserve = BigInt(api.consts.balances.existentialDeposit.toString());
      if (free < polkadotAmountPlanck! + fee + reserve) {
        return reply.code(400).send({ error: "Insufficient Polkadot balance for the pool stake, transaction fee, and existential deposit" });
      }
    }
    const user = await upsertUserIdentity({ cantonPartyId: delegator, evmAddress });

    // Two indistinguishable pending intents cannot be assigned to distinct
    // on-chain delegation events. Reject the second until the first settles
    // or is cancelled on Canton.
    const activeRequests = await canton.activeContracts(TEMPLATES.StakingRequest);
    const pendingIntents = await prisma.stakingIntent.findMany({
      where: {
        requestContractId: { in: activeRequests.map((r) => r.contractId) },
        chain,
        evmAddress: normalizeWalletAddress(evmAddress),
        amountPol,
        validatorAddress: validator ?? null,
        acceptedAt: null,
      },
    });
    if (pendingIntents.length > 0) {
      return reply.code(409).send({
        error: "An identical staking request is already pending; wait for it to settle or cancel it before retrying.",
      });
    }
    if (chain === "polkadot" && await prisma.stakingIntent.findFirst({ where: {
      requestContractId: { in: activeRequests.map((r) => r.contractId) }, chain: "polkadot",
      evmAddress, acceptedAt: null,
    } })) {
      return reply.code(409).send({ error: "This Polkadot wallet already has a pending pool-join request" });
    }
    if (["bnb", "monad", "cosmos", "celestia", "osmosis", "sui", "aptos", "solana"].includes(chain) && validator) {
      const [pendingForValidator, activeForValidator] = await Promise.all([
        prisma.stakingIntent.findFirst({
          where: {
            requestContractId: { in: activeRequests.map((r) => r.contractId) },
            chain,
            evmAddress: normalizeWalletAddress(evmAddress),
            validatorAddress: { equals: validator, mode: "insensitive" },
            acceptedAt: null,
          },
        }),
        prisma.stakingPosition.findFirst({
          where: {
            chain,
            evmAddress: normalizeWalletAddress(evmAddress),
            status: { in: ["Bonded", "Unbonding"] },
            ...(chain === "bnb"
              ? { OR: [
                  { validatorAddress: { equals: validator, mode: "insensitive" as const } },
                  { validatorShare: { equals: validator, mode: "insensitive" as const } },
                ] }
              : { validatorAddress: validator }),
          },
        }),
      ]);
      if (pendingForValidator || activeForValidator) {
        return reply.code(409).send({
          error: `This ${chain} wallet already has a pending or active position with that validator; choose another validator.`,
        });
      }
    }

    // Use the known Canton delegator party for contract creation — the
    // Loop SDK party may not exist on the local Canton participant.
    const knownDelegator = config.cantonDelegatorParty;

    if (chain === "aptos") {
      const base = rpcUrls["aptos"].replace(/\/$/, "");
      const [ledgerResponse, accountResponse, feeResponse, stakeResponse] = await Promise.all([
        fetch(`${base}/v1`),
        fetch(`${base}/v1/accounts/${evmAddress}`),
        fetch(`${base}/v1/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            function: "0x1::delegation_pool::get_add_stake_fee",
            type_arguments: [],
            arguments: [validator, aptosAmountOcta!.toString()],
          }),
        }),
        fetch(`${base}/v1/view`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ function: "0x1::delegation_pool::get_stake",
            type_arguments: [], arguments: [validator, evmAddress] }),
        }),
      ]);
      if (!ledgerResponse.ok || !accountResponse.ok || !feeResponse.ok || !stakeResponse.ok) {
        return reply.code(503).send({ error: "Aptos fullnode, delegation pool, or wallet account is unavailable; check the pool and fund the account" });
      }
      const fee = await feeResponse.json() as unknown;
      if (!Array.isArray(fee) || !/^\d+$/.test(String(fee[0]))) {
        return reply.code(503).send({ error: "Aptos delegation-pool fee is unavailable" });
      }
      if (aptosAmountOcta! - BigInt(String(fee[0])) < 1_000_000_000n) {
        return reply.code(400).send({ error: "Amount minus the Aptos pool entry fee must credit at least 10 APT" });
      }
      const ledger = await ledgerResponse.json() as { chain_id?: number };
      const expectedChainId = config.networkMode === "mainnet" ? 1 : 2;
      if (ledger.chain_id !== expectedChainId) {
        return reply.code(503).send({ error: `Aptos fullnode is on chain ${ledger.chain_id}, expected ${expectedChainId}` });
      }
      const stake = parseAptosDelegationStake(await stakeResponse.json());
      if (stake.active > 0n || stake.inactive > 0n || stake.pendingInactive > 0n) {
        return reply.code(409).send({ error: "This Aptos wallet already has native stake in that pool; choose another pool. CantonStake tracks the entire wallet/pool delegation, including rewards." });
      }
      const account = await accountResponse.json() as { sequence_number?: string };
      if (!account.sequence_number || !/^\d+$/.test(account.sequence_number)) {
        return reply.code(503).send({ error: "Aptos account sequence is unavailable" });
      }
      const key = `aptos:${expectedChainId}:${evmAddress.toLowerCase()}`;
      // Seed the first account-scoped watcher cursor BEFORE the wallet can
      // broadcast. Never move an existing cursor forward past pending exits.
      await prisma.watcherCursor.upsert({
        where: { key },
        create: { key, lastScannedBlock: account.sequence_number },
        update: {},
      });
    }
    if (chain === "polkadot") {
      const api = await polkadotApi();
      const head = await api.rpc.chain.getFinalizedHead();
      const height = (await api.rpc.chain.getHeader(head)).number.toNumber();
      const key = `polkadot:${POLKADOT_ASSET_HUB[config.networkMode].genesis}`;
      await prisma.watcherCursor.upsert({
        where: { key }, create: { key, lastScannedBlock: String(height) }, update: {},
      });
    }

    const result = await cantonDelegator.createContract({
      templateId: TEMPLATES.StakingRequest,
      argument: {
        delegator: knownDelegator,
        appProvider: config.cantonAppProviderParty,
        evmAddress,
        amountPol,
        requestedAt: new Date().toISOString(),
      },
      actAs: [knownDelegator],
    });
    const requestContractId = extractCreatedContractId(result.events);
    if (!requestContractId) {
      throw new Error("Canton created a StakingRequest but did not return its contract ID; cannot bind network intent");
    }
    await prisma.stakingIntent.create({
      data: {
        requestContractId,
        chain,
        validatorAddress: validator ?? null,
        stakeAccountAddress: chain === "solana" ? stakeAccountAddress : null,
        stakeRentLamports: solanaRentLamports,
        evmAddress: normalizeWalletAddress(evmAddress),
        userId: user.id,
        amountPol,
      },
    });

    req.log.info(
      { chain, validator, evmAddress, amountPol },
      "[requests] StakingRequest created"
    );

    return { ok: true, transactionId: result.transactionId, requestContractId, delegator: knownDelegator, chain,
      ...(solanaRentLamports ? { stakeRentLamports: solanaRentLamports } : {}) };
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: String(err) });
  }
});

// --- List pending requests by EVM address ---

app.get<{ Querystring: { address?: string } }>(
  "/api/requests",
  async (req, reply) => {
    const { address } = req.query;
    try {
      const contracts = await canton.activeContracts(TEMPLATES.StakingRequest);
      const filtered = address
        ? contracts.filter((c) => {
            const a = c.argument as { evmAddress?: string };
            return sameWalletAddress(a.evmAddress, address);
          })
        : contracts;
      return { requests: filtered };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  }
);

// --- List positions by EVM address ---

app.get<{ Querystring: { address?: string } }>(
  "/api/positions",
  async (req, reply) => {
    const { address } = req.query;
    try {
      // Canton owns lifecycle status; Postgres adds chain and tx metadata
      // absent from the current StakingPosition template.
      const contracts = await canton.activeContracts(TEMPLATES.StakingPosition);
      const filtered = address
        ? contracts.filter((c) => {
            const a = c.argument as { evmAddress?: string };
            return sameWalletAddress(a.evmAddress, address);
          })
        : contracts;

      // Canton owns the lifecycle, but the authoritative claim condition on
      // Polygon is checkpoint-based: unstakeClaimTokens_new only succeeds once
      // `unbondWithdrawEpoch + withdrawalDelay() <= epoch()`. That epoch lives
      // on-chain and in the Postgres mirror, never in the Daml contract — the
      // contract's unbondingReadyAt is a cadence-derived ESTIMATE. Attach the
      // mirror's real values so the UI can gate on the epoch instead of a
      // timestamp that drifts whenever checkpoints are slow.
      const mirrors = await prisma.stakingPosition.findMany({
        where: { contractId: { in: filtered.map((c) => c.contractId) } },
        select: {
          contractId: true,
          chain: true,
          validatorAddress: true,
          validatorShare: true,
          validatorId: true,
          evmTxHash: true,
          unbondNonce: true,
          unbondWithdrawEpoch: true,
          suiStakedObjectId: true,
        },
      });
      const byCid = new Map(mirrors.map((m) => [m.contractId, m]));

      return {
        positions: filtered.map((c) => ({
          ...c,
          chainMeta: byCid.get(c.contractId) ?? null,
        })),
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  }
);

// --- Rewards summary (Postgres-backed with actual CC distributed) ---

app.get<{ Params: { address: string } }>(
  "/api/rewards/:address",
  async (req, reply) => {
    const address = normalizeWalletAddress(req.params.address);
    try {
      // Find user by EVM address
      const user = await prisma.user.findFirst({
        where: { evmAddress: address },
      });

      if (!user) {
        return {
          address,
          totalPositions: 0,
          totalBondedPol: 0,
          totalMarkersEmitted: 0,
          estimatedCcEarned: 0,
          totalCcEarned: 0,
          totalUserShare: 0,
          totalTreasuryShare: 0,
          userShare: 0.75,
          appShare: 0.25,
          rewardEventCount: 0,
          totalNativeRewardsSweptWei: "0",
          totalNativeRewardsSweptPol: 0,
          totalProtocolFeeWei: "0",
          totalProtocolFeePol: 0,
          totalUserPayoutWei: "0",
          totalUserPayoutPol: 0,
          rewardSweepCount: 0,
        };
      }

      const positions = await prisma.stakingPosition.findMany({
        where: { userId: user.id },
      });
      const events = await prisma.rewardEvent.findMany({
        where: { userId: user.id },
      });
      const sweeps = await prisma.rewardSweep.findMany({
        where: { userId: user.id },
      });

      const totalCc = events.reduce((s, e) => s + Number(e.ccAmount), 0);
      const totalUser = events.reduce((s, e) => s + Number(e.userShare), 0);
      const totalTreasury = events.reduce((s, e) => s + Number(e.treasuryShare), 0);
      const bondedPol = positions
        .filter((p) => p.status === "Bonded")
        .reduce((s, p) => s + Number(p.amountPol), 0);
      const totalMarkers = positions.reduce((s, p) => s + p.markersEmitted, 0);
      const totalNativeRewardsSweptWei = sumWei(
        sweeps.map((sweep) => sweep.nativeRewardWei)
      );
      const totalProtocolFeeWei = sumWei(
        sweeps.map((sweep) => sweep.protocolFeeWei)
      );
      const totalUserPayoutWei = sumWei(
        sweeps.map((sweep) => sweep.userPayoutWei)
      );

      return {
        address,
        totalPositions: positions.length,
        totalBondedPol: bondedPol,
        totalMarkersEmitted: totalMarkers,
        estimatedCcEarned: totalCc, // keep backward compat
        totalCcEarned: totalCc,
        totalUserShare: totalUser,
        totalTreasuryShare: totalTreasury,
        userShare: 0.75,
        appShare: 0.25,
        rewardEventCount: events.length,
        totalNativeRewardsSweptWei: totalNativeRewardsSweptWei.toString(),
        totalNativeRewardsSweptPol: weiToPol(totalNativeRewardsSweptWei),
        totalProtocolFeeWei: totalProtocolFeeWei.toString(),
        totalProtocolFeePol: weiToPol(totalProtocolFeeWei),
        totalUserPayoutWei: totalUserPayoutWei.toString(),
        totalUserPayoutPol: weiToPol(totalUserPayoutWei),
        rewardSweepCount: sweeps.length,
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  }
);

// --- Narrator (Anthropic-powered live commentary) ---

app.get<{ Params: { address: string } }>(
  "/api/narrator/:address",
  async (req, reply) => {
    const { address } = req.params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "invalid EVM address" });
    }
    try {
      const result = await narrate(address);
      return result;
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  }
);

// --- Manual round trigger (ops aid) ---

app.post("/api/admin/rounds/trigger", async (req, reply) => {
  if (config.logLevel !== "debug") {
    return reply.code(403).send({
      error: "manual round trigger disabled; set LOG_LEVEL=debug",
    });
  }

  try {
    // Compute next round number from DB
    const latestRound = await prisma.rewardRound.findFirst({
      orderBy: { roundNumber: "desc" },
    });
    const roundNumber = (latestRound?.roundNumber ?? 0) + 1;

    await enqueueRound(roundNumber);

    return {
      ok: true,
      roundNumber,
      message: `Round #${roundNumber} enqueued`,
    };
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send({ error: String(err) });
  }
});

// --- Sweep routes ---
await app.register(readinessRoutes);
await app.register(rpcRoutes);
await app.register(sweepRoutes);
await app.register(rewardHistoryRoutes);

// --- Validator scoring routes ---
await app.register(validatorRoutes);

// --- Notifications routes ---
await app.register(notificationsRoutes);

// --- Tax export routes ---
await app.register(taxRoutes);

// --- Portfolio routes ---
await app.register(portfolioRoutes);

// --- Auto-compound routes ---
await app.register(autoCompoundRoutes);

// --- Rewards rounds + analytics history routes ---
await app.register(rewardsRoutes);
await app.register(protocolRoutes);

// --- Chain catalog stats (live APY/TVL/validator count) ---
await app.register(chainsRoutes);

// --- Polygon staking params + validator-share registry ---
await app.register(polygonRoutes);
await app.register(polkadotRoutes);

// --- Loop SDK reverse proxy (CORS bypass for dev origins) ---
await app.register(loopProxyRoutes);

// --- Start ---

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`cantonstake backend listening on :${config.port}`);

await startMultichainWatchers();
startReleaseChecker();
app.log.info("orchestrator running");

// Start the CC reward round scheduler (10-min rounds via BullMQ + Redis)
try {
  await startRewardScheduler();
  app.log.info("CC reward scheduler started");
} catch (err) {
  app.log.warn({ err }, "CC reward scheduler failed to start — rewards paused");
}

// Start the validator quality scoring refresh job (hourly via BullMQ + Redis)
try {
  await startValidatorScoringScheduler();
  app.log.info("validator scoring scheduler started");
} catch (err) {
  app.log.warn({ err }, "validator scoring scheduler failed to start");
}

// Start the portfolio TVL snapshot job (5-min cadence by default)
try {
  await startPortfolioSnapshotScheduler();
  app.log.info("portfolio snapshot scheduler started");
} catch (err) {
  app.log.warn({ err }, "portfolio snapshot scheduler failed to start");
}

// Start the auto-compound keeper (15-min cadence by default; opt-in)
try {
  await startAutoCompoundScheduler();
  app.log.info("auto-compound scheduler started");
} catch (err) {
  app.log.warn({ err }, "auto-compound scheduler failed to start");
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  app.log.info("SIGTERM received, shutting down...");
  await shutdownRewardSystem();
  await shutdownValidatorScoring();
  await shutdownNotifications();
  await shutdownPortfolioSnapshots();
  await shutdownAutoCompound();
  await prisma.$disconnect();
  await app.close();
  process.exit(0);
});
