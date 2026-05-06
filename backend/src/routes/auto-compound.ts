/**
 * Auto-compound HTTP routes.
 *
 *   POST   /api/autocompound/permits        - upsert a permit
 *   GET    /api/autocompound/permits?userId - list permits
 *   DELETE /api/autocompound/permits/:id    - disable
 *   GET    /api/autocompound/permits/:id/runs - run history
 *   POST   /api/autocompound/trigger        - run a tick now (DEMO_MODE)
 */

import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { triggerAutoCompoundTick } from "../services/auto-compound.js";

interface CreatePermitBody {
  userId: string;
  chain: "polygon" | "moonbeam" | "monad" | "cosmos" | "sui";
  validator: string;
  scope?: "compound" | "claim" | "redelegate";
  signature?: string;
  signaturePayload?: string;
  expiresAt: string;       // ISO timestamp
  maxPerRun?: string;
}

const VALID_CHAINS = new Set([
  "polygon",
  "moonbeam",
  "monad",
  "cosmos",
  "sui",
]);

const autoCompoundRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreatePermitBody }>(
    "/api/autocompound/permits",
    async (req, reply) => {
      const {
        userId,
        chain,
        validator,
        scope = "compound",
        signature,
        signaturePayload,
        expiresAt,
        maxPerRun,
      } = req.body;
      if (!userId || !chain || !validator || !expiresAt) {
        return reply
          .code(400)
          .send({ error: "missing userId / chain / validator / expiresAt" });
      }
      if (!VALID_CHAINS.has(chain)) {
        return reply.code(400).send({ error: `invalid chain: ${chain}` });
      }
      const expires = new Date(expiresAt);
      if (Number.isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
        return reply
          .code(400)
          .send({ error: "expiresAt must be a future ISO timestamp" });
      }

      try {
        const permit = await prisma.autoCompoundPermit.create({
          data: {
            userId,
            chain,
            validator,
            scope,
            signature: signature ?? null,
            signaturePayload: signaturePayload ?? null,
            expiresAt: expires,
            maxPerRun: maxPerRun ?? null,
          },
        });
        return { permit };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.get<{ Querystring: { userId?: string } }>(
    "/api/autocompound/permits",
    async (req, reply) => {
      const { userId } = req.query;
      if (!userId) return reply.code(400).send({ error: "missing userId" });
      try {
        const permits = await prisma.autoCompoundPermit.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
        });
        return { permits };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/autocompound/permits/:id",
    async (req, reply) => {
      try {
        const permit = await prisma.autoCompoundPermit.update({
          where: { id: req.params.id },
          data: { enabled: false },
        });
        return { permit };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/autocompound/permits/:id/runs",
    async (req, reply) => {
      try {
        const runs = await prisma.autoCompoundRun.findMany({
          where: { permitId: req.params.id },
          orderBy: { startedAt: "desc" },
          take: 50,
        });
        return { runs };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.post("/api/autocompound/trigger", async (_req, reply) => {
    if (!config.demoMode && config.logLevel !== "debug") {
      return reply.code(403).send({
        error: "manual trigger disabled; set DEMO_MODE=true or LOG_LEVEL=debug",
      });
    }
    try {
      await triggerAutoCompoundTick();
      return { ok: true, message: "auto-compound tick enqueued" };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });
};

export default autoCompoundRoutes;
