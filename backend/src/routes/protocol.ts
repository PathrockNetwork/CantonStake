import type { FastifyPluginAsync } from "fastify";
import { canton, TEMPLATES } from "../canton.js";
import { prisma } from "../db.js";
import { readProtocolSummary } from "../services/protocol-summary.js";

const protocolRoutes: FastifyPluginAsync = async (app) => {
  type Snapshot = Awaited<ReturnType<typeof readProtocolSummary>>;
  let cache: { value: Snapshot; expiresAt: number } | undefined;
  let inflight: Promise<Snapshot> | undefined;

  app.get("/api/protocol/summary", async (_request, reply) => {
    try {
      if (!cache || cache.expiresAt < Date.now()) {
        inflight ??= readProtocolSummary({
          readLedger: () => canton.activeContracts(TEMPLATES.StakingPosition, AbortSignal.timeout(4_000)),
          readRecorded: async () => {
            const positions = await prisma.stakingPosition.findMany({
              select: { contractId: true, status: true, amountPol: true, chain: true, updatedAt: true },
            });
            return positions.map(({ amountPol, ...position }) => ({ ...position, amount: amountPol }));
          },
          now: () => new Date(),
        }).then((value) => {
          cache = { value, expiresAt: Date.now() + 30_000 };
          return value;
        }).finally(() => { inflight = undefined; });
        await inflight;
      }
      return reply.header("Cache-Control", "public, max-age=10, stale-while-revalidate=20").send(cache!.value);
    } catch {
      return reply.header("Cache-Control", "no-store").code(503).send({ error: "Protocol totals are temporarily unavailable." });
    }
  });
};

export default protocolRoutes;
