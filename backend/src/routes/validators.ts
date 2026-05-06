/**
 * Validator quality scoring HTTP routes.
 *
 *   GET /api/validators/scores              → all chains, cached
 *   GET /api/validators/scores/:chain       → single chain, cached
 *   POST /api/validators/scores/:chain/refresh → bypass cache, refetch
 *
 * The refresh endpoint is gated behind DEMO_MODE / debug log level so a
 * casual GET in production can't trigger a fanout against the upstream
 * staking APIs.
 */

import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import {
  getAllScores,
  getScores,
  refreshChain,
  type SupportedChain,
} from "../services/validator-scoring.js";

const SUPPORTED: SupportedChain[] = [
  "polygon",
  "moonbeam",
  "monad",
  "cosmos",
  "sui",
];

function isSupported(chain: string): chain is SupportedChain {
  return (SUPPORTED as string[]).includes(chain);
}

const validatorRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/validators/scores", async (_req, reply) => {
    try {
      const scores = await getAllScores();
      return { scores };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });

  app.get<{ Params: { chain: string } }>(
    "/api/validators/scores/:chain",
    async (req, reply) => {
      const { chain } = req.params;
      if (!isSupported(chain)) {
        return reply.code(404).send({ error: `unsupported chain: ${chain}` });
      }
      try {
        const snap = await getScores(chain);
        return snap;
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.post<{ Params: { chain: string } }>(
    "/api/validators/scores/:chain/refresh",
    async (req, reply) => {
      if (!config.demoMode && config.logLevel !== "debug") {
        return reply.code(403).send({
          error:
            "manual refresh disabled; set DEMO_MODE=true or LOG_LEVEL=debug",
        });
      }
      const { chain } = req.params;
      if (!isSupported(chain)) {
        return reply.code(404).send({ error: `unsupported chain: ${chain}` });
      }
      try {
        const snap = await refreshChain(chain);
        return snap;
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );
};

export default validatorRoutes;
