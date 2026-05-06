import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import {
  readPendingWei,
  encodeWithdrawRewardsCalldata,
  verifySweepReceipt,
} from "../services/nativeSweep.js";
import { recordNativeSweep } from "../orchestrator.js";
import { config } from "../config.js";
import { createPublicClient, http } from "viem";
import { polygonAmoy } from "viem/chains";
import type { Address } from "viem";

const PROTOCOL_FEE_BPS = Number(process.env.PROTOCOL_FEE_BPS || "500");

// Public client for reading from Polygon Amoy
const publicClient = createPublicClient({
  chain: polygonAmoy,
  transport: http(process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology"),
});

// MockValidatorShare ABI for pendingRewards call
const validatorShareAbi = [
  {
    inputs: [{ internalType: "address", name: "delegator", type: "address" }],
    name: "pendingRewards",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function weiToPol(value: bigint): number {
  return Number(value) / 1e18;
}

export default async function sweepRoutes(app: FastifyInstance) {
  // Main sweep endpoint - handles the full sweep flow
  app.post<{
    Params: { positionId: string };
    Body: { evmTxHash?: string };
  }>("/api/sweep/:positionId", async (req, reply) => {
    const { positionId } = req.params;
    try {
      const position = await prisma.stakingPosition.findFirst({
        where: {
          OR: [{ id: positionId }, { contractId: positionId }],
        },
        include: { user: true },
      });

      if (!position) {
        return reply.code(404).send({ error: "position not found" });
      }

      const rewardsWei = (await publicClient.readContract({
        address: config.mockValidatorShare as Address,
        abi: validatorShareAbi,
        functionName: "pendingRewards",
        args: [position.evmAddress as Address],
      })) as bigint;

      const protocolFeeWei =
        (rewardsWei * BigInt(position.protocolFeeBps)) / 10_000n;
      const userPayoutWei = rewardsWei - protocolFeeWei;

      const sweep = await prisma.rewardSweep.create({
        data: {
          userId: position.userId,
          positionId: position.id,
          nativeRewardWei: rewardsWei.toString(),
          protocolFeeWei: protocolFeeWei.toString(),
          userPayoutWei: userPayoutWei.toString(),
          protocolFeeBps: position.protocolFeeBps,
          evmTxHash: req.body?.evmTxHash,
        },
      });

      await prisma.stakingPosition.update({
        where: { id: position.id },
        data: { swept: true, lastSweepAt: sweep.sweptAt },
      });

      req.log.info(
        { positionId, rewardsWei: rewardsWei.toString(), protocolFeeWei: protocolFeeWei.toString(), userPayoutWei: userPayoutWei.toString() },
        "sweep completed"
      );

      return {
        ok: true,
        sweep: {
          ...sweep,
          nativeRewardPol: weiToPol(rewardsWei),
          protocolFeePol: weiToPol(protocolFeeWei),
          userPayoutPol: weiToPol(userPayoutWei),
        },
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });

  app.post<{
    Params: { positionId: string };
  }>("/api/sweep/:positionId/prepare", async (req, reply) => {
    const { positionId } = req.params;
    try {
      const position = await prisma.stakingPosition.findFirst({
        where: { OR: [{ id: positionId }, { contractId: positionId }] },
      });
      if (!position) return reply.code(404).send({ error: "position not found" });
      if (position.status !== "Bonded" && position.status !== "Unbonding") {
        return reply.code(400).send({ error: `position is ${position.status}, must be Bonded or Unbonding` });
      }

      const pendingWei = await readPendingWei(positionId);
      req.log.info({ positionId, pendingWei: pendingWei.toString() }, "sweep prepare");

      return {
        positionId: position.id,
        validatorAddress: config.mockValidatorShare,
        pendingWei: pendingWei.toString(),
        protocolFeeBps: PROTOCOL_FEE_BPS,
        callData: encodeWithdrawRewardsCalldata(),
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });

  app.post<{
    Params: { positionId: string };
    Body: { txHash: string; grossWei: string };
  }>("/api/sweep/:positionId/record", async (req, reply) => {
    const { positionId } = req.params;
    const { txHash, grossWei: grossWeiStr } = req.body;
    if (!txHash || !grossWeiStr) {
      return reply.code(400).send({ error: "missing txHash or grossWei" });
    }

    try {
      const position = await prisma.stakingPosition.findFirst({
        where: { OR: [{ id: positionId }, { contractId: positionId }] },
        include: { user: true },
      });
      if (!position) return reply.code(404).send({ error: "position not found" });

      const delegatorAddress = position.evmAddress;
      const { success, grossWei: onChainGross } = await verifySweepReceipt(
        txHash as `0x${string}`,
        delegatorAddress
      );
      if (!success) {
        return reply.code(422).send({ error: "receipt verification failed: no matching DelegatorClaimedRewards event" });
      }

      const grossWei = BigInt(grossWeiStr);
      const feeWei = (grossWei * BigInt(PROTOCOL_FEE_BPS)) / 10_000n;
      const netWei = grossWei - feeWei;

      const sweep = await prisma.rewardSweep.create({
        data: {
          userId: position.userId,
          positionId: position.id,
          nativeRewardWei: grossWei.toString(),
          protocolFeeWei: feeWei.toString(),
          userPayoutWei: netWei.toString(),
          protocolFeeBps: PROTOCOL_FEE_BPS,
          evmTxHash: txHash,
        },
      });

      await prisma.stakingPosition.update({
        where: { id: position.id },
        data: { swept: true, lastSweepAt: sweep.sweptAt },
      });

      let cantonUpdateId: string | null = null;
      try {
        cantonUpdateId = await recordNativeSweep({
          positionId: position.id,
          grossWei,
          feeWei,
          netWei,
          txHash,
        });
      } catch (err) {
        req.log.warn({ err }, "Daml RecordNativeSweep failed — sweep persisted but not recorded on Canton");
      }

      req.log.info(
        { positionId, grossWei: grossWei.toString(), feeWei: feeWei.toString(), netWei: netWei.toString(), cantonUpdateId },
        "sweep recorded"
      );

      return {
        ok: true,
        sweep: {
          id: sweep.id,
          positionId: sweep.positionId,
          nativeRewardWei: sweep.nativeRewardWei,
          protocolFeeWei: sweep.protocolFeeWei,
          userPayoutWei: sweep.userPayoutWei,
          evmTxHash: sweep.evmTxHash,
          sweptAt: sweep.sweptAt,
          cantonUpdateId,
        },
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: String(err) });
    }
  });
}
