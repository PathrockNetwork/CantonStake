/**
 * Native reward sweep against the REAL Polygon ValidatorShare (P2.5).
 *
 * The mock paid "rewards" out of a balance the owner pre-funded the contract
 * with, accruing at a fixed `aprBasisPoints`. That is not where real yield
 * comes from. On the production contract:
 *
 *   - `getLiquidRewards(delegator)` is the delegator's share of the rewards
 *     the StakeManager has actually distributed to the validator at
 *     checkpoints, minus the validator's commission and anything already
 *     withdrawn. It is protocol yield, not a subsidy.
 *   - `withdrawRewards()` transfers those rewards in the ERC-20 stake token.
 *     Nothing has to be pre-funded, and `evm/scripts/fund.ts` is now a
 *     mock-only script.
 *   - The resulting `DelegatorClaimedRewards(validatorId, user, rewards)`
 *     event is emitted by the shared StakingInfo logger, NOT by the
 *     ValidatorShare, and `rewards` is an indexed topic.
 *
 * Every read here is per-position, because the ValidatorShare address is
 * per-validator (T2.2).
 */

import { encodeFunctionData, type Address } from "viem";
import { prisma } from "../db.js";
import {
  getLiquidRewards,
  resolveValidatorShare,
  settlementClient,
  stakingLoggerAbi,
  stakingLoggerAddress,
  validatorShareAbi,
} from "./validator-share.js";

export class ValidatorShareUnresolved extends Error {
  constructor(positionId: string) {
    super(
      `position ${positionId} has no ValidatorShare recorded — it predates ` +
        `per-validator resolution or was staked on a non-Polygon chain`
    );
    this.name = "ValidatorShareUnresolved";
  }
}

export interface PositionShare {
  positionId: string;
  delegator: Address;
  share: Address;
  validatorId: number | null;
}

/**
 * Resolve the ValidatorShare a position is delegated to.
 *
 * Preference order: the address recorded on the position at bond time, then a
 * live StakeManager lookup from the recorded validator signer. There is no
 * global fallback by design — guessing an address would silently read another
 * validator's book.
 */
export async function shareForPosition(positionId: string): Promise<PositionShare> {
  const position = await prisma.stakingPosition.findFirst({
    where: { OR: [{ id: positionId }, { contractId: positionId }] },
  });
  if (!position) throw new Error(`position not found: ${positionId}`);

  if (position.validatorShare) {
    return {
      positionId: position.id,
      delegator: position.evmAddress as Address,
      share: position.validatorShare as Address,
      validatorId: position.validatorId,
    };
  }

  if (position.validatorAddress) {
    const resolved = await resolveValidatorShare(position.validatorAddress);
    if (resolved) {
      // Backfill so the next read is a single DB hit.
      await prisma.stakingPosition.update({
        where: { id: position.id },
        data: { validatorShare: resolved.share, validatorId: resolved.validatorId },
      });
      return {
        positionId: position.id,
        delegator: position.evmAddress as Address,
        share: resolved.share,
        validatorId: resolved.validatorId,
      };
    }
  }

  throw new ValidatorShareUnresolved(positionId);
}

/** Claimable protocol yield for a position, in wei of the stake token. */
export async function readPendingWei(positionId: string): Promise<bigint> {
  const { share, delegator } = await shareForPosition(positionId);
  return getLiquidRewards(share, delegator);
}

export function encodeWithdrawRewardsCalldata(): `0x${string}` {
  return encodeFunctionData({
    abi: validatorShareAbi,
    functionName: "withdrawRewards",
  });
}

/**
 * Verify that `txHash` really claimed rewards for `expectedFrom`.
 *
 * Matching is done against the logger's DelegatorClaimedRewards event, scoped
 * to the position's validatorId when we know it, so a claim on some other
 * validator in the same block can't be counted.
 */
export async function verifySweepReceipt(
  txHash: `0x${string}`,
  expectedFrom: string,
  validatorId?: number | null
): Promise<{ success: boolean; grossWei: bigint }> {
  const receipt = await settlementClient.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return { success: false, grossWei: 0n };

  const logs = await settlementClient.getContractEvents({
    address: stakingLoggerAddress,
    abi: stakingLoggerAbi,
    eventName: "DelegatorClaimedRewards",
    args: {
      user: expectedFrom as Address,
      ...(validatorId != null ? { validatorId: BigInt(validatorId) } : {}),
    },
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  const match = logs.find((log) => log.transactionHash === txHash);
  if (!match) return { success: false, grossWei: 0n };

  return { success: true, grossWei: match.args.rewards ?? 0n };
}
