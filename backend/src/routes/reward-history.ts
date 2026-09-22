import type { FastifyPluginAsync } from "fastify";
import { formatUnits } from "viem";
import { prisma } from "../db.js";

/** Account-scoped, read-only history for the native and CC reward panels. */
export function rewardHistoryRoutesFor(db: Pick<typeof prisma, "user" | "rewardSweep" | "rewardEvent">): FastifyPluginAsync {
return async (app) => {
  app.get<{ Querystring: { address: string; days?: number; limit?: number } }>("/api/rewards/history", {
    schema: { querystring: { type: "object", required: ["address"], properties: {
      address: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
      days: { type: "integer", minimum: 1, maximum: 90, default: 30 },
      limit: { type: "integer", minimum: 1, maximum: 250, default: 100 },
    } } },
  }, async (req, reply) => {
    const days = req.query.days ?? 30, limit = req.query.limit ?? 100;
    const since = new Date(Date.now() - days * 86_400_000);
    try {
      const user = await db.user.findFirst({ where: { evmAddress: req.query.address.toLowerCase() }, select: { id: true } });
      if (!user) return { events: [], since: since.toISOString(), hasMore: false };
      const [native, cc] = await Promise.all([
        db.rewardSweep.findMany({ where: { userId: user.id, sweptAt: { gte: since } }, orderBy: { sweptAt: "desc" }, take: limit + 1,
          select: { id: true, sweptAt: true, userPayoutWei: true, evmTxHash: true, position: { select: { contractId: true, chain: true } } } }),
        db.rewardEvent.findMany({ where: { userId: user.id, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: limit + 1,
          select: { id: true, createdAt: true, userShare: true, cantonTxId: true, round: { select: { roundNumber: true } }, position: { select: { contractId: true, chain: true } } } }),
      ]);
      const events = [
        ...native.map(event => ({ id: `native-${event.id}`, kind: "native", time: event.sweptAt.toISOString(), amount: formatUnits(BigInt(event.userPayoutWei), 18), symbol: "POL", positionId: event.position.contractId, chain: event.position.chain, roundNumber: null, transactionId: event.evmTxHash, status: "Recorded" })),
        ...cc.map(event => ({ id: `cc-${event.id}`, kind: "cc", time: event.createdAt.toISOString(), amount: event.userShare, symbol: "CC", positionId: event.position.contractId, chain: event.position.chain, roundNumber: event.round.roundNumber, transactionId: event.cantonTxId, status: "Attributed" })),
      ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
      return { events: events.slice(0, limit), since: since.toISOString(), hasMore: events.length > limit };
    } catch (error) {
      req.log.error(error, "Unable to read account reward history");
      return reply.code(503).send({ error: "Reward history is temporarily unavailable" });
    }
  });
};
}
export default rewardHistoryRoutesFor(prisma);
