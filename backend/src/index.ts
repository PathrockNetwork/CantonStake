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
import { createPublicClient, formatEther, http, type Address } from "viem";
import { polygonAmoy } from "viem/chains";
import { config } from "./config.js";
import { canton, cantonDelegator, TEMPLATES } from "./canton.js";
import { startWatchers, startReleaseChecker } from "./orchestrator.js";
import { prisma } from "./db.js";
import { startRewardScheduler, shutdownRewardSystem, redisConnection, enqueueRound } from "./reward-rounds.js";
import sweepRoutes from "./routes/sweep.js";

const publicClient = createPublicClient({
  chain: polygonAmoy,
  transport: http(config.amoyRpcUrl),
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

function normalizeEvmAddress(address: string): string {
  return address.toLowerCase();
}

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
    ? normalizeEvmAddress(args.evmAddress)
    : undefined;

  const existingByParty = await prisma.user.findUnique({
    where: { cantonPartyId: args.cantonPartyId },
  });
  if (existingByParty) {
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

// --- Health ---

app.get("/api/health", async () => ({
  status: "ok",
  cantonJsonApi: config.cantonJsonApiUrl,
  validatorShare: config.mockValidatorShare,
  featuredAppRight: config.featuredAppRightCid ? "configured" : "missing",
  demoMode: config.demoMode,
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
    !config.demoMode && config.logLevel !== "debug"
      ? "Manual reward trigger disabled outside DEMO_MODE/debug"
      : null,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    status: "ok",
    cantonJsonApi: config.cantonJsonApiUrl,
    cantonDelegatorParty: config.cantonDelegatorParty,
    validatorShare: config.mockValidatorShare,
    featuredAppRight: config.featuredAppRightCid ? "configured" : "missing",
    demoMode: config.demoMode,
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

interface CreateRequestBody {
  evmAddress: string;
  amountPol: string; // decimal string, e.g. "1.5"
  delegator?: string; // Loop/Canton party id
}

app.post<{ Body: CreateRequestBody }>("/api/requests", async (req, reply) => {
  const { evmAddress, amountPol } = req.body;
  const delegator = req.body.delegator || config.cantonDelegatorParty;

  if (!evmAddress || !amountPol) {
    return reply.code(400).send({ error: "missing required fields" });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
    return reply.code(400).send({ error: "invalid EVM address" });
  }

  try {
    await upsertUserIdentity({ cantonPartyId: delegator, evmAddress });

    const result = await cantonDelegator.createContract({
      templateId: TEMPLATES.StakingRequest,
      argument: {
        delegator,
        appProvider: config.cantonAppProviderParty,
        evmAddress,
        amountPol,
        requestedAt: new Date().toISOString(),
      },
      actAs: [delegator],
    });
    return { ok: true, transactionId: result.transactionId, delegator };
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
            return a.evmAddress?.toLowerCase() === address.toLowerCase();
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
      const contracts = await canton.activeContracts(TEMPLATES.StakingPosition);
      const filtered = address
        ? contracts.filter((c) => {
            const a = c.argument as { evmAddress?: string };
            return a.evmAddress?.toLowerCase() === address.toLowerCase();
          })
        : contracts;
      return { positions: filtered };
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
    const address = req.params.address.toLowerCase();
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

// --- Native reward sweep stub (5% protocol fee) ---

app.post<{ Params: { positionId: string }; Body: { evmTxHash?: string } }>(
  "/api/sweep/:positionId",
  async (req, reply) => {
    const { positionId } = req.params;
    try {
      const position = await prisma.stakingPosition.findFirst({
        where: {
          OR: [{ id: positionId }, { contractId: positionId }],
        },
        include: { user: true },
      });

      if (!position) {
        return reply.code(404).send({ error: "position not found" });
      }

      const rewardsWei = (await publicClient.readContract({
        address: config.mockValidatorShare as Address,
        abi: validatorShareAbi,
        functionName: "pendingRewards",
        args: [position.evmAddress as Address],
      })) as bigint;
      const protocolFeeWei =
        (rewardsWei * BigInt(position.protocolFeeBps)) / 10_000n;
      const userPayoutWei = rewardsWei - protocolFeeWei;

      const sweep = await prisma.rewardSweep.create({
        data: {
          userId: position.userId,
          positionId: position.id,
          nativeRewardWei: rewardsWei.toString(),
          protocolFeeWei: protocolFeeWei.toString(),
          userPayoutWei: userPayoutWei.toString(),
          protocolFeeBps: position.protocolFeeBps,
          evmTxHash: req.body?.evmTxHash,
        },
      });

      await prisma.stakingPosition.update({
        where: { id: position.id },
        data: { swept: true, lastSweepAt: sweep.sweptAt },
      });

      return {
        ok: true,
        sweep: {
          ...sweep,
          nativeRewardPol: weiToPol(rewardsWei),
          protocolFeePol: weiToPol(protocolFeeWei),
          userPayoutPol: weiToPol(userPayoutWei),
        },
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  }
);

// --- Manual round trigger (demo aid) ---

app.post("/api/admin/rounds/trigger", async (req, reply) => {
  if (!config.demoMode && config.logLevel !== "debug") {
    return reply.code(403).send({
      error: "manual round trigger disabled; set DEMO_MODE=true or LOG_LEVEL=debug",
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
await app.register(sweepRoutes);

// --- Start ---

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`cantonstake backend listening on :${config.port}`);

startWatchers();
startReleaseChecker();
app.log.info("orchestrator running");

// Start the CC reward round scheduler (10-min rounds via BullMQ + Redis)
try {
  await startRewardScheduler();
  app.log.info("CC reward scheduler started");
} catch (err) {
  app.log.warn({ err }, "CC reward scheduler failed to start — rewards paused");
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  app.log.info("SIGTERM received, shutting down...");
  await shutdownRewardSystem();
  await prisma.$disconnect();
  await app.close();
  process.exit(0);
});
