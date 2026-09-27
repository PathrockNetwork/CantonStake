/**
 * Auto-compound HTTP routes.
 *
 *   GET    /api/autocompound/status         - deployment availability
 *   POST   /api/autocompound/permits        - upsert a permit
 *   GET    /api/autocompound/permits?userId - list permits
 *   DELETE /api/autocompound/permits/:id    - disable
 *   GET    /api/autocompound/permits/:id/runs - run history
 *   POST   /api/autocompound/trigger        - run a tick now (debug)
 */

import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { autoCompoundStatus } from "../services/auto-compound-gate.js";

interface CreatePermitBody {
  userId: string;
  chain: "polygon" | "monad" | "cosmos" | "sui";
  validator: string;
  scope?: "compound" | "claim" | "redelegate";
  signature?: string;
  signaturePayload?: string;
  expiresAt: string;       // ISO timestamp
  maxPerRun?: string;
}

const VALID_CHAINS = new Set([
  "polygon",
  "monad",
  "cosmos",
  "sui",
]);

type Options = {
  db?: Pick<typeof prisma, "autoCompoundPermit" | "autoCompoundRun">;
  disabled?: boolean;
  trigger?: () => Promise<void>;
};

const autoCompoundRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const db = options.db ?? prisma;
  const availability = () => autoCompoundStatus(options.disabled ?? config.autoCompoundDisabled);
  const trigger = options.trigger ?? (async () => {
    const { triggerAutoCompoundTick } = await import("../services/auto-compound.js");
    await triggerAutoCompoundTick();
  });

  app.get("/api/autocompound/status", async () => ({ ...availability(), networkMode: config.networkMode }));

  app.post<{ Body: CreatePermitBody }>(
    "/api/autocompound/permits",
    async (req, reply) => {
      const status = availability();
      if (!status.executionEnabled) {
        return reply.code(403).send({ error: status.reason, status: status.status });
      }
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
      if (!status.supportedChains.includes(chain)) {
        return reply.code(403).send({ error: `Auto-compound is not available for ${chain}` });
      }
      const expires = new Date(expiresAt);
      if (Number.isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
        return reply
          .code(400)
          .send({ error: "expiresAt must be a future ISO timestamp" });
      }

      try {
        const permit = await db.autoCompoundPermit.create({
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
        const permits = await db.autoCompoundPermit.findMany({
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
        const permit = await db.autoCompoundPermit.update({
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
        const runs = await db.autoCompoundRun.findMany({
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
    const status = availability();
    if (!status.executionEnabled) {
      return reply.code(403).send({ error: status.reason, status: status.status });
    }
    if (config.logLevel !== "debug") {
      return reply.code(403).send({
        error: "manual trigger disabled; set LOG_LEVEL=debug",
      });
    }
    try {
      await trigger();
      return { ok: true, message: "auto-compound tick enqueued" };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });
};

export default autoCompoundRoutes;
