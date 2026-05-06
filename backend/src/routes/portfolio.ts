/**
 * Portfolio HTTP routes.
 *
 *   GET /api/portfolio/:address          → aggregate snapshot (live + cached)
 *   GET /api/portfolio/:address/series   → TvlSnapshot time series for chart
 */

import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import { getPortfolio } from "../services/portfolio-cache.js";

const portfolioRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { address: string };
    Querystring: { refresh?: string };
  }>("/api/portfolio/:address", async (req, reply) => {
    const { address } = req.params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "invalid EVM address" });
    }
    try {
      const snap = await getPortfolio(address, {
        forceRefresh: req.query.refresh === "true",
      });
      return snap;
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });

  app.get<{
    Params: { address: string };
    Querystring: { hours?: string };
  }>("/api/portfolio/:address/series", async (req, reply) => {
    const { address } = req.params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "invalid EVM address" });
    }
    const hours = Math.max(1, Math.min(720, Number(req.query.hours ?? "24")));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    try {
      const series = await prisma.tvlSnapshot.findMany({
        where: { evmAddress: address.toLowerCase(), snapshotAt: { gte: since } },
        orderBy: { snapshotAt: "asc" },
      });
      return {
        address: address.toLowerCase(),
        windowHours: hours,
        series: series.map((s) => ({
          at: s.snapshotAt.toISOString(),
          totalUsd: s.totalUsd,
          perChain: s.perChain,
        })),
      };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });
};

export default portfolioRoutes;
