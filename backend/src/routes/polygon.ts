/**
 * Polygon PoS staking parameters + validator-share registry.
 *
 *   GET  /api/polygon/staking-params   → settlement chain, StakeManager,
 *                                        stake token, current checkpoint
 *                                        epoch, withdrawal delay and the
 *                                        MEASURED checkpoint cadence
 *   GET  /api/polygon/validator-shares → signer → ValidatorShare map
 *   POST /api/polygon/refresh          → drop the Redis cache (gated)
 *
 * The frontend uses `staking-params` to show a truthful unbonding ETA
 * instead of a hardcoded "21 days", and `validator-shares` as the dynamic
 * counterpart to NEXT_PUBLIC_REAL_VALIDATOR_SHARES.
 */

import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import {
  getPolygonStakingParams,
  invalidateValidatorShareCache,
  listActiveValidatorShares,
  validatorShareMap,
} from "../services/validator-share.js";

const polygonRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/polygon/staking-params", async (_req, reply) => {
    try {
      return await getPolygonStakingParams();
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: String(err) });
    }
  });

  app.get("/api/polygon/validator-shares", async (_req, reply) => {
    try {
      const [validators, map] = await Promise.all([
        listActiveValidatorShares(),
        validatorShareMap(),
      ]);
      return {
        settlementChainId: config.stakeSettlementChainId,
        stakeManager: config.stakeManagerAddress,
        count: validators.length,
        validators,
        map,
      };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: String(err) });
    }
  });

  app.post("/api/polygon/refresh", async (req, reply) => {
    if (!config.demoMode && config.logLevel !== "debug") {
      return reply.code(403).send({
        error: "manual refresh disabled; set DEMO_MODE=true or LOG_LEVEL=debug",
      });
    }
    try {
      const cleared = await invalidateValidatorShareCache();
      return { ok: true, cleared };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });
};

export default polygonRoutes;
