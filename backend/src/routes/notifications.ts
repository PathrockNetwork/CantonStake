/**
 * Notifications CRUD — manage a user's NotificationChannels.
 *
 *   POST   /api/notifications/channels         - upsert a channel
 *   GET    /api/notifications/channels?userId  - list a user's channels
 *   DELETE /api/notifications/channels/:id     - disable a channel (soft delete)
 *   POST   /api/notifications/test             - emit a test alert (DEMO_MODE)
 *
 * Auth: none in v1 — pass `userId` in the body / query. Production
 * would tie this to the OAuth2 / Loop session.
 */

import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { emitAlert, type AlertKind } from "../services/notifications.js";

const VALID_KINDS = new Set(["telegram", "email", "discord"]);

interface UpsertChannelBody {
  userId: string;
  kind: "telegram" | "email" | "discord";
  target: string;
  label?: string;
  enabled?: boolean;
}

interface TestBody {
  userId: string;
  kind?: AlertKind;
}

const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: UpsertChannelBody }>(
    "/api/notifications/channels",
    async (req, reply) => {
      const { userId, kind, target, label } = req.body;
      const enabled = req.body.enabled ?? true;
      if (!userId || !kind || !target) {
        return reply.code(400).send({ error: "missing userId / kind / target" });
      }
      if (!VALID_KINDS.has(kind)) {
        return reply.code(400).send({ error: `invalid kind: ${kind}` });
      }
      try {
        const channel = await prisma.notificationChannel.upsert({
          where: { userId_kind_target: { userId, kind, target } },
          update: { enabled, label },
          create: { userId, kind, target, enabled, label },
        });
        return { channel };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.get<{ Querystring: { userId?: string } }>(
    "/api/notifications/channels",
    async (req, reply) => {
      const { userId } = req.query;
      if (!userId) return reply.code(400).send({ error: "missing userId" });
      try {
        const channels = await prisma.notificationChannel.findMany({
          where: { userId },
          orderBy: { createdAt: "asc" },
        });
        return { channels };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/notifications/channels/:id",
    async (req, reply) => {
      try {
        const channel = await prisma.notificationChannel.update({
          where: { id: req.params.id },
          data: { enabled: false },
        });
        return { channel };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );

  app.post<{ Body: TestBody }>(
    "/api/notifications/test",
    async (req, reply) => {
      if (!config.demoMode && config.logLevel !== "debug") {
        return reply.code(403).send({
          error: "test alert disabled; set DEMO_MODE=true or LOG_LEVEL=debug",
        });
      }
      const { userId } = req.body;
      const kind: AlertKind = req.body.kind ?? "validator.score_drop";
      if (!userId) return reply.code(400).send({ error: "missing userId" });
      try {
        const alertId = await emitAlert({
          kind,
          userId,
          chain: "polygon",
          payload: {
            chain: "polygon",
            name: "Test Validator",
            validatorAddress: "0xtest",
            score: 65,
            previousScore: 90,
            delta: -25,
            reason: "test alert from /api/notifications/test",
          },
        });
        return { ok: true, alertId };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    }
  );
};

export default notificationsRoutes;
