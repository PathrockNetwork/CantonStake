import type { FastifyPluginAsync } from "fastify";
import { canton } from "../canton.js";
import { config } from "../config.js";
import { loopWorkflowGate } from "../services/loop-deployment.js";
import { LOOP_STAKING_CHAINS } from "../services/loop-native-ownership.js";

type Options = { probe?: (signal: AbortSignal) => Promise<void> };

/** Ledger readiness, distinct from backend process liveness. */
const readinessRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const probe = options.probe ?? ((signal: AbortSignal) => {
    canton.assertCanSubmit();
    return canton.probe(signal);
  });
  app.get("/api/readiness", async (_req, reply) => {
    try {
      await probe(AbortSignal.timeout(3_000));
      let loopBlocker = loopWorkflowGate();
      if (config.networkMode === "testnet" && !loopBlocker) {
        const { loopPreservationGate } = await import("../services/loop-staking.js");
        loopBlocker = await loopPreservationGate();
      }
      return { status: "ready", canton: "reachable", networkMode: config.networkMode,
        loopStaking: {
          status: loopBlocker ? "blocked" : "ready", reason: loopBlocker,
          supportedChains: config.networkMode === "testnet" ? LOOP_STAKING_CHAINS : [], ccPaymentsEnabled: false,
        },
        time: new Date().toISOString() };
    } catch (error) {
      app.log.warn({ error }, "Canton participant readiness check failed");
      return reply.code(503).send({ status: "unavailable", canton: "unreachable",
        networkMode: config.networkMode, time: new Date().toISOString() });
    }
  });
};

export default readinessRoutes;
