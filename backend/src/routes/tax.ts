/**
 * Tax export HTTP routes.
 *
 *   GET /api/tax/csv?address=0x...&format=koinly
 *
 * Currently only the Koinly schema is implemented; `format` is reserved
 * for future formats (CoinTracker, ZenLedger, etc.). Returns a CSV file
 * with `Content-Disposition: attachment` so browsers prompt a download.
 */

import type { FastifyPluginAsync } from "fastify";
import { buildKoinlyCsv } from "../services/tax-export.js";

const taxRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { address?: string; format?: string } }>(
    "/api/tax/csv",
    async (req, reply) => {
      const { address } = req.query;
      const format = (req.query.format ?? "koinly").toLowerCase();
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return reply.code(400).send({ error: "missing or invalid address" });
      }
      if (format !== "koinly") {
        return reply
          .code(400)
          .send({ error: `unsupported format: ${format}` });
      }

      try {
        const csv = await buildKoinlyCsv(address);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `cantonstake-koinly-${address.slice(0, 8)}-${stamp}.csv`;
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header(
            "content-disposition",
            `attachment; filename="${filename}"`
          )
          .send(csv);
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );
};

export default taxRoutes;
