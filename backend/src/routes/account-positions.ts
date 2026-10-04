import type { FastifyPluginAsync } from "fastify";
import type { canton } from "../canton.js";
import type { prisma } from "../db.js";
import { deploymentPositions, type NetworkMode } from "../services/deployment-scope.js";
import { sameWalletAddress } from "../services/wallet-address.js";

export function accountPositionRoutesFor(deps: {
  ledger: Pick<typeof canton, "activeContracts">;
  db: Pick<typeof prisma, "stakingPosition" | "stakingIntent">;
  templates: { StakingPosition: string; StakingRequest: string };
  networkMode: NetworkMode;
}): FastifyPluginAsync {
  return async app => {
    app.get<{ Querystring: { address?: string } }>("/api/positions", async (req, reply) => {
      try {
        const active = await deps.ledger.activeContracts(deps.templates.StakingPosition);
        const matching = active.filter(c => !req.query.address || sameWalletAddress(c.argument.evmAddress as string | undefined, req.query.address));
        const mirrors = await deps.db.stakingPosition.findMany({
          where: { contractId: { in: matching.map(c => c.contractId) } },
          select: { contractId: true, chain: true, validatorAddress: true, validatorShare: true, validatorId: true,
            evmTxHash: true, unbondNonce: true, unbondWithdrawEpoch: true, suiStakedObjectId: true },
        });
        // Canton supplies lifecycle and amount. Only this deployment's
        // database can establish ownership and settlement-chain metadata.
        return reply.header("Cache-Control", "no-store").send({ positions: deploymentPositions(matching, mirrors, deps.networkMode) });
      } catch (error) {
        req.log.error(error, "Unable to read deployment positions");
        return reply.header("Cache-Control", "no-store").code(503).send({ error: "Positions are temporarily unavailable" });
      }
    });
    app.get<{ Querystring: { address?: string } }>("/api/requests", async (req, reply) => {
      try {
        const active = await deps.ledger.activeContracts(deps.templates.StakingRequest);
        const matching = active.filter(c => !req.query.address || sameWalletAddress(c.argument.evmAddress as string | undefined, req.query.address));
        const intents = await deps.db.stakingIntent.findMany({
          where: { requestContractId: { in: matching.map(c => c.contractId) }, acceptedAt: null },
          select: { requestContractId: true, chain: true },
        });
        const mirrors = intents.map(i => ({ contractId: i.requestContractId, chain: i.chain }));
        const requests = deploymentPositions(matching, mirrors, deps.networkMode).map(({ chainMeta, ...contract }) => contract);
        return reply.header("Cache-Control", "no-store").send({ requests });
      } catch (error) {
        req.log.error(error, "Unable to read deployment requests");
        return reply.header("Cache-Control", "no-store").code(503).send({ error: "Staking requests are temporarily unavailable" });
      }
    });
  };
}
