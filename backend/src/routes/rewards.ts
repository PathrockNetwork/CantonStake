/**
 * Reward round + analytics history routes.
 *
 *   GET /api/rewards/rounds?address=0x..&limit=10
 *     Recent completed reward rounds. When address is supplied, joins
 *     AppActivityRecord on the user's Canton party id so the response
 *     includes per-user traffic share + CC.
 *
 *   GET /api/analytics/markers?address=0x..&hours=24
 *     Hourly histogram of FeaturedAppActivityMarker emissions over the
 *     requested window. Drives the analytics chart.
 */

import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";

interface RoundsQuery {
  address?: string;
  limit?: string;
}

interface MarkersQuery {
  address?: string;
  hours?: string;
}

function relativeTime(from: Date | null): string {
  if (!from) return "—";
  const ms = Date.now() - from.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const rewardsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: RoundsQuery }>(
    "/api/rewards/rounds",
    async (req, reply) => {
      const limit = Math.min(
        Math.max(parseInt(req.query.limit ?? "10", 10) || 10, 1),
        100,
      );
      const address = req.query.address?.toLowerCase();

      try {
        const rounds = await prisma.rewardRound.findMany({
          where: { status: { in: ["completed", "processing"] } },
          orderBy: { roundNumber: "desc" },
          take: limit,
        });

        const user = address
          ? await prisma.user.findFirst({ where: { evmAddress: address } })
          : null;

        const userParty = user?.cantonPartyId ?? null;

        const records = userParty
          ? await prisma.appActivityRecord.findMany({
              where: {
                roundNumber: { in: rounds.map((r) => r.roundNumber) },
                party: userParty,
              },
            })
          : [];
        const recordByRound = new Map(
          records.map((r) => [r.roundNumber, r]),
        );

        return {
          rounds: rounds.map((r) => {
            const rec = recordByRound.get(r.roundNumber);
            return {
              roundNumber: r.roundNumber,
              status: r.status,
              startedAt: r.startedAt.toISOString(),
              completedAt: r.completedAt?.toISOString() ?? null,
              relativeTime: relativeTime(r.completedAt ?? r.startedAt),
              totalCcMinted: r.totalCcMinted,
              totalTxns: r.totalTxns,
              totalMarkers: r.totalMarkers,
              userTrafficSharePct: rec ? rec.trafficShare * 100 : null,
              userCcAttributed: rec ? rec.ccAttributed : null,
            };
          }),
        };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    },
  );

  app.get<{ Querystring: MarkersQuery }>(
    "/api/analytics/markers",
    async (req, reply) => {
      const hours = Math.min(
        Math.max(parseInt(req.query.hours ?? "24", 10) || 24, 1),
        24 * 30,
      );
      const address = req.query.address?.toLowerCase();
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const priorSince = new Date(since.getTime() - hours * 60 * 60 * 1000);

      try {
        const userId = address
          ? (await prisma.user.findFirst({ where: { evmAddress: address } }))?.id
          : undefined;

        const events = await prisma.rewardEvent.findMany({
          where: {
            createdAt: { gte: since },
            ...(userId ? { userId } : {}),
          },
          select: { createdAt: true, ccAmount: true },
        });

        const priorEvents = await prisma.rewardEvent.findMany({
          where: {
            createdAt: { gte: priorSince, lt: since },
            ...(userId ? { userId } : {}),
          },
          select: { id: true },
        });

        const buckets = new Array(hours).fill(0).map(() => ({
          markers: 0,
          cc: 0,
        }));
        const startMs = since.getTime();
        const bucketMs = 60 * 60 * 1000;

        for (const ev of events) {
          const idx = Math.floor((ev.createdAt.getTime() - startMs) / bucketMs);
          if (idx >= 0 && idx < buckets.length) {
            buckets[idx]!.markers += 1;
            buckets[idx]!.cc += Number(ev.ccAmount);
          }
        }

        const totalMarkers = events.length;
        const priorTotal = priorEvents.length;
        const deltaPct =
          priorTotal > 0
            ? ((totalMarkers - priorTotal) / priorTotal) * 100
            : null;

        // Bond/unbond breakdown across StakingPosition.status — reflects
        // lifecycle activity (positions currently bonded vs unbonding).
        const positionScope = userId ? { userId } : {};
        const [bondedCount, unbondingCount] = await Promise.all([
          prisma.stakingPosition.count({
            where: { ...positionScope, status: "Bonded" },
          }),
          prisma.stakingPosition.count({
            where: {
              ...positionScope,
              status: { in: ["Unbonding", "Released"] },
            },
          }),
        ]);
        const breakdownTotal = bondedCount + unbondingCount;
        const bondPct =
          breakdownTotal > 0 ? (bondedCount / breakdownTotal) * 100 : 0;
        const unbondPct =
          breakdownTotal > 0 ? (unbondingCount / breakdownTotal) * 100 : 0;

        return {
          since: since.toISOString(),
          hours,
          scope: userId ? "user" : "global",
          series: buckets.map((b, i) => ({
            t: new Date(startMs + i * bucketMs).toISOString(),
            markers: b.markers,
            cc: Number(b.cc.toFixed(8)),
          })),
          insight: {
            totalMarkers,
            priorTotalMarkers: priorTotal,
            deltaPct,
          },
          breakdown: {
            bondCount: bondedCount,
            unbondCount: unbondingCount,
            bondPct: Number(bondPct.toFixed(1)),
            unbondPct: Number(unbondPct.toFixed(1)),
          },
        };
      } catch (err) {
        app.log.error(err);
        return reply.code(500).send({ error: String(err) });
      }
    },
  );

  // CC reward round automation health: success / total + last round status.
  app.get("/api/rewards/health", async (_req, reply) => {
    try {
      const recent = await prisma.rewardRound.findMany({
        orderBy: { roundNumber: "desc" },
        take: 100,
      });

      if (recent.length === 0) {
        return {
          status: "idle",
          totalSampled: 0,
          successRatePct: null,
          lastRound: null,
        };
      }

      const completed = recent.filter((r) => r.status === "completed").length;
      const failed = recent.filter((r) => r.status === "failed").length;
      const skipped = recent.filter((r) => r.status === "skipped").length;
      const successRatePct = (completed / recent.length) * 100;
      const last = recent[0]!;

      return {
        status:
          last.status === "completed"
            ? "ok"
            : last.status === "failed"
              ? "failing"
              : last.status,
        totalSampled: recent.length,
        completed,
        failed,
        skipped,
        successRatePct: Number(successRatePct.toFixed(1)),
        lastRound: {
          roundNumber: last.roundNumber,
          status: last.status,
          completedAt: last.completedAt?.toISOString() ?? null,
          totalCcMinted: last.totalCcMinted,
          totalMarkers: last.totalMarkers,
          error: last.error,
        },
      };
    } catch (err) {
      app.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });
};

export default rewardsRoutes;
