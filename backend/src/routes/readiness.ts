import type { FastifyPluginAsync } from "fastify";
import { canton } from "../canton.js";
import { config } from "../config.js";

type Options = { probe?: (signal: AbortSignal) => Promise<void> };

/** Ledger readiness, distinct from backend process liveness. */
const readinessRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const probe = options.probe ?? ((signal: AbortSignal) => canton.probe(signal));
  app.get("/api/readiness", async (_req, reply) => {
    try {
      await probe(AbortSignal.timeout(3_000));
      return { status: "ready", canton: "reachable", networkMode: config.networkMode,
        time: new Date().toISOString() };
    } catch (error) {
      app.log.warn({ error }, "Canton participant readiness check failed");
      return reply.code(503).send({ status: "unavailable", canton: "unreachable",
        networkMode: config.networkMode, time: new Date().toISOString() });
    }
  });
};

export default readinessRoutes;
