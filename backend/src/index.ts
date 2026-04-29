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
import { config } from "./config.js";
import { canton, cantonDelegator, TEMPLATES } from "./canton.js";
import { startWatchers, startReleaseChecker } from "./orchestrator.js";
import { prisma } from "./db.js";
import { startRewardScheduler, shutdownRewardSystem, redisConnection, enqueueRound } from "./reward-rounds.js";

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

  return {
    status: "ok",
    cantonJsonApi: config.cantonJsonApiUrl,
    cantonDelegatorParty: config.cantonDelegatorParty,
    validatorShare: config.mockValidatorShare,
    featuredAppRight: config.featuredAppRightCid ? "configured" : "missing",
    database: dbStatus,
    redis: redisStatus,
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
    // Try upsert by cantonPartyId first
    const user = await prisma.user.upsert({
      where: { cantonPartyId },
      update: {
        evmAddress: evmAddress?.toLowerCase(),
        displayName,
      },
      create: {
        cantonPartyId,
        evmAddress: evmAddress?.toLowerCase(),
        displayName,
      },
    });
    return { user };
  } catch (err) {
    // If unique constraint on evmAddress fails, try updating existing user
    if (evmAddress && err instanceof Error && err.message.includes("Unique")) {
      try {
        const existing = await prisma.user.findUnique({
          where: { evmAddress: evmAddress.toLowerCase() },
        });
        if (existing) {
          const updated = await prisma.user.update({
            where: { id: existing.id },
            data: { cantonPartyId, displayName },
          });
          return { user: updated };
        }
      } catch {
        // fall through
      }
    }
    req.log.error(err);
    return reply.code(500).send({ error: String(err) });
  }
});

// --- Create a StakingRequest ---

interface CreateRequestBody {
  evmAddress: string;
  amountPol: string; // decimal string, e.g. "1.5"
  delegator?: string; // ignored; backend uses configured delegator party
}

app.post<{ Body: CreateRequestBody }>("/api/requests", async (req, reply) => {
  const { evmAddress, amountPol } = req.body;

  if (!evmAddress || !amountPol) {
    return reply.code(400).send({ error: "missing required fields" });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
    return reply.code(400).send({ error: "invalid EVM address" });
  }

  try {
    const result = await cantonDelegator.createContract({
      templateId: TEMPLATES.StakingRequest,
      argument: {
        delegator: config.cantonDelegatorParty,
        appProvider: config.cantonAppProviderParty,
        evmAddress,
        amountPol,
        requestedAt: new Date().toISOString(),
      },
    });
    return { ok: true, transactionId: result.transactionId };
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
        };
      }

      const positions = await prisma.stakingPosition.findMany({
        where: { userId: user.id },
      });
      const events = await prisma.rewardEvent.findMany({
        where: { userId: user.id },
      });

      const totalCc = events.reduce((s, e) => s + Number(e.ccAmount), 0);
      const totalUser = events.reduce((s, e) => s + Number(e.userShare), 0);
      const totalTreasury = events.reduce((s, e) => s + Number(e.treasuryShare), 0);
      const bondedPol = positions
        .filter((p) => p.status === "Bonded")
        .reduce((s, p) => s + Number(p.amountPol), 0);
      const totalMarkers = positions.reduce((s, p) => s + p.markersEmitted, 0);

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
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  }
);

// --- Manual round trigger (demo aid) ---

app.post("/api/admin/rounds/trigger", async (req, reply) => {
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
