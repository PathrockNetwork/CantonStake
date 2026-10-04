import type { FastifyPluginAsync } from "fastify";
import type { canton } from "../canton.js";
import type { prisma } from "../db.js";
import { formatUnits } from "viem";
import { deploymentPositions, type NetworkMode } from "../services/deployment-scope.js";
import { PORTFOLIO_CHAINS, validPortfolioAddress } from "../services/portfolio-recorded.js";
import { normalizeWalletAddress } from "../services/wallet-address.js";

type AccountRewardsQuery = {
  addresses: string[];
  clientNetworkMode: NetworkMode;
  days?: number;
  limit?: number;
  includeRounds?: boolean;
};

/** Read-only batching: one ledger inventory for all connected native wallets.
 * A wallet can own positions under several Canton parties; never scope these
 * reads through User.evmAddress or substitute the hosted test delegator.
 * Allocation records are not evidence of a claimed or transferred CC payment.
 */
export function accountRewardRoutesFor(deps: {
  ledger: Pick<typeof canton, "activeContracts">;
  db: Pick<typeof prisma, "stakingPosition" | "rewardSweep" | "rewardEvent" | "rewardRound">;
  template: string;
  networkMode: NetworkMode;
  loopStakingEnabled: boolean;
}): FastifyPluginAsync {
  return async app => {
    app.post<{ Body: AccountRewardsQuery }>("/api/account/rewards", {
      bodyLimit: 4096,
      schema: { body: { type: "object", additionalProperties: false,
        required: ["addresses", "clientNetworkMode"], properties: {
          addresses: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 120 } },
          clientNetworkMode: { type: "string", enum: ["testnet", "mainnet"] },
          days: { type: "integer", minimum: 1, maximum: 90, default: 30 },
          limit: { type: "integer", minimum: 1, maximum: 250, default: 250 },
          includeRounds: { type: "boolean", default: false },
        } } },
    }, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      if (req.body.clientNetworkMode !== deps.networkMode) {
        return reply.code(409).send({ error: "Reward client network does not match this deployment" });
      }
      const addresses = [...new Set(req.body.addresses.map(normalizeWalletAddress))].sort();
      if (!addresses.every(validPortfolioAddress)) return reply.code(400).send({ error: "Invalid native wallet address" });
      const days = req.body.days ?? 30, limit = req.body.limit ?? 250;
      const since = new Date(Date.now() - days * 86_400_000);
      const chains = PORTFOLIO_CHAINS.flatMap(chain => [chain, `${chain}-${deps.networkMode}`]);
      if (deps.networkMode === "testnet") chains.push("polygon-amoy");
      const position = { evmAddress: { in: addresses }, chain: { in: chains } };
      const positionRead = async () => {
        const contracts = await deps.ledger.activeContracts(deps.template, AbortSignal.timeout(8000));
        const matching = contracts.filter(contract => typeof contract.argument.evmAddress === "string" &&
          addresses.includes(normalizeWalletAddress(contract.argument.evmAddress)));
        const mirrors = await deps.db.stakingPosition.findMany({
          where: { contractId: { in: matching.map(contract => contract.contractId) }, ...position },
          select: { contractId: true, chain: true, validatorAddress: true, validatorShare: true, validatorId: true,
            evmTxHash: true, unbondNonce: true, unbondWithdrawEpoch: true, suiStakedObjectId: true },
        });
        return deploymentPositions(matching, mirrors, deps.networkMode);
      };
      const historyRead = async () => {
        const [native, cc] = await Promise.all([
          // RewardSweep stores Polygon payouts in wei. Other chains have no
          // measured sweep pipeline yet; never label their units as POL.
          deps.db.rewardSweep.findMany({ where: { position: { ...position,
            chain: { in: ["polygon", `polygon-${deps.networkMode}`, ...(deps.networkMode === "testnet" ? ["polygon-amoy"] : [])] } },
            sweptAt: { gte: since } }, orderBy: { sweptAt: "desc" }, take: limit + 1,
            select: { id: true, sweptAt: true, userPayoutWei: true, evmTxHash: true,
              position: { select: { contractId: true, chain: true } } } }),
          deps.db.rewardEvent.findMany({ where: { position, createdAt: { gte: since } },
            orderBy: { createdAt: "desc" }, take: limit + 1,
            select: { id: true, createdAt: true, userShare: true, cantonTxId: true,
              round: { select: { roundNumber: true } }, position: { select: { contractId: true, chain: true } } } }),
        ]);
        const events = [
          ...native.map(event => ({ id: `native-${event.id}`, kind: "native", time: event.sweptAt.toISOString(),
            amount: formatUnits(BigInt(event.userPayoutWei), 18), symbol: "POL", positionId: event.position.contractId,
            chain: event.position.chain, roundNumber: null, transactionId: event.evmTxHash, status: "Recorded" })),
          ...cc.map(event => ({ id: `cc-${event.id}`, kind: "cc", time: event.createdAt.toISOString(), amount: event.userShare,
            symbol: "CC", positionId: event.position.contractId, chain: event.position.chain,
            roundNumber: event.round.roundNumber, transactionId: event.cantonTxId, status: "Attributed" })),
        ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || a.id.localeCompare(b.id));
        return { events: events.slice(0, limit), since: since.toISOString(), hasMore: events.length > limit };
      };
      const roundsRead = async () => {
        if (!req.body.includeRounds) return undefined;
        const rounds = await deps.db.rewardRound.findMany({
          where: { status: { in: ["completed", "processing"] } }, orderBy: { roundNumber: "desc" }, take: 10,
        });
        const events = await deps.db.rewardEvent.findMany({
          where: { position, round: { roundNumber: { in: rounds.map(round => round.roundNumber) } } },
          select: { ccAmount: true, round: { select: { roundNumber: true } } },
        });
        return rounds.map(round => {
          const amounts = events.filter(event => event.round.roundNumber === round.roundNumber).map(event => event.ccAmount);
          // Preserve absence/malformed data; do not turn it into a paid zero.
          const valid = amounts.length > 0 && amounts.every(amount => /^\d+(?:\.\d+)?$/.test(amount));
          const sum = valid ? amounts.reduce((total, amount) => total + Number(amount), 0) : NaN;
          return { roundNumber: round.roundNumber, status: round.status, startedAt: round.startedAt.toISOString(),
            completedAt: round.completedAt?.toISOString() ?? null, totalCcMinted: round.totalCcMinted,
            userCcAttributed: Number.isFinite(sum) ? sum.toFixed(8) : null };
        });
      };
      // Independent sources: a Canton outage cannot erase recorded history,
      // and a history query failure must not display zero CC allocations.
      const [positions, history, rounds] = await Promise.allSettled([positionRead(), historyRead(), roundsRead()]);
      for (const [source, result] of [["positions", positions], ["history", history], ["rounds", rounds]] as const) {
        if (result.status === "rejected") req.log.warn({ source }, "Account reward source unavailable");
      }
      const loop = deps.networkMode === "testnet" && deps.loopStakingEnabled;
      return { networkMode: deps.networkMode, addresses, days, checkedAt: new Date().toISOString(),
        positions: positions.status === "fulfilled" ? positions.value : null,
        history: history.status === "fulfilled" ? history.value : null,
        ...(req.body.includeRounds ? { rounds: rounds.status === "fulfilled" ? rounds.value : null } : {}),
        policy: { ccPayments: loop ? "disabled" : "unverified", beneficiarySplit: loop ? "not_configured" : "unverified" },
      };
    });
  };
}
