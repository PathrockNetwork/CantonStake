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
import { canton, TEMPLATES } from "./canton.js";
import { startWatchers, startReleaseChecker } from "./orchestrator.js";
import { prisma } from "./db.js";
import { startRewardScheduler, shutdownRewardSystem } from "./reward-rounds.js";

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

  return {
    status: "ok",
    cantonJsonApi: config.cantonJsonApiUrl,
    validatorShare: config.mockValidatorShare,
    featuredAppRight: config.featuredAppRightCid ? "configured" : "missing",
    database: dbStatus,
    redis: config.redisUrl,
    time: new Date().toISOString(),
  };
});

// --- Create a StakingRequest ---

interface CreateRequestBody {
  evmAddress: string;
  amountPol: string; // decimal string, e.g. "1.5"
  delegator: string; // Canton party ID
}

app.post<{ Body: CreateRequestBody }>("/api/requests", async (req, reply) => {
  const { evmAddress, amountPol, delegator } = req.body;

  if (!evmAddress || !amountPol || !delegator) {
    return reply.code(400).send({ error: "missing required fields" });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(evmAddress)) {
    return reply.code(400).send({ error: "invalid EVM address" });
  }

  try {
    const result = await canton.createContract({
      templateId: TEMPLATES.StakingRequest,
      argument: {
        delegator,
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

// --- Rewards summary (count markers emitted across all user's positions) ---

app.get<{ Params: { address: string } }>(
  "/api/rewards/:address",
  async (req, reply) => {
    const { address } = req.params;
    try {
      const contracts = await canton.activeContracts(TEMPLATES.StakingPosition);
      const userPositions = contracts.filter((c) => {
        const a = c.argument as { evmAddress?: string };
        return a.evmAddress?.toLowerCase() === address.toLowerCase();
      });

      let totalMarkers = 0;
      let totalStaked = 0;
      for (const p of userPositions) {
        const arg = p.argument as {
          markersEmitted?: number;
          amountPol?: string;
          status?: string;
        };
        totalMarkers += arg.markersEmitted ?? 0;
        if (arg.status === "Bonded") {
          totalStaked += Number(arg.amountPol ?? "0");
        }
      }

      // Illustrative CC estimate using the reward mechanics from the
      // original business plan: 62% of ~516M CC monthly pool, share
      // proportional to transaction activity. For the hackathon this is
      // a mock calculation — the real per-round allocation depends on
      // network-wide activity and the burn-mint equilibrium.
      const mockCcPerMarker = 0.1; // dev illustration only
      const estimatedCc = totalMarkers * mockCcPerMarker;

      return {
        address,
        totalPositions: userPositions.length,
        totalBondedPol: totalStaked,
        totalMarkersEmitted: totalMarkers,
        estimatedCcEarned: estimatedCc,
        userShare: 0.75,
        appShare: 0.25,
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  }
);

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
