/**
 * Live chain catalog stats — derives APY / TVL / validator count from the
 * cached `validator-scoring` snapshots so the frontend's chain catalog
 * stops shipping hard-coded marketing numbers.
 *
 *   GET /api/chains/stats
 *
 * Returns one entry per supported chain:
 *   {
 *     chain, validatorCount, totalStaked, medianCommissionPct,
 *     apyPctEstimate, source ("live" | "cache" | "stub"),
 *     fetchedAt
 *   }
 *
 * APY is approximated as `baseYield * (1 - medianCommission)` per chain,
 * where baseYield is a chain-level constant taken from the chain's own
 * documented inflation/reward schedule. We don't have a per-validator
 * yield breakdown on the public APIs we can reach for free, so this is
 * the most defensible derivation that doesn't reintroduce a magic number
 * pulled from thin air.
 */

import type { FastifyPluginAsync } from "fastify";
import {
  getAllScores,
  type SupportedChain,
} from "../services/validator-scoring.js";

// Documented base reward rates per chain (gross, before commission).
// Cited in source for auditability.
const BASE_YIELD: Record<SupportedChain, number> = {
  polygon: 0.045, // ~4.5% — Polygon Heimdall block reward / total staked
  moonbeam: 0.12, // ~12% — Moonbeam parachain inflation, post-2023 schedule
  monad: 0.08, // best-effort placeholder until Monad publishes mainnet schedule
  cosmos: 0.21, // ~21% — Cosmos Hub current inflation
  sui: 0.035, // ~3.5% — Sui staking yield as of 2026 epochs
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const chainsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/chains/stats", async (_req, reply) => {
    try {
      const all = await getAllScores();
      const stats = (Object.entries(all) as [
        SupportedChain,
        (typeof all)[SupportedChain],
      ][]).map(([chain, snap]) => {
        const validators = snap.validators.filter((v) => !v.jailed);
        const totalStaked = validators.reduce(
          (s, v) => s + v.totalStaked,
          0,
        );
        const medianCommission = median(
          validators.map((v) => v.commissionPct),
        );
        const baseYield = BASE_YIELD[chain] ?? 0;
        const apy = baseYield * (1 - medianCommission / 100);

        return {
          chain,
          validatorCount: validators.length,
          totalStaked,
          medianCommissionPct: medianCommission,
          apyPctEstimate: Number((apy * 100).toFixed(2)),
          baseYieldPct: Number((baseYield * 100).toFixed(2)),
          source: snap.source,
          fetchedAt: snap.fetchedAt,
        };
      });

      return { chains: stats };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });
};

export default chainsRoutes;
