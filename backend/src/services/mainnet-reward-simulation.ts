import type { PrismaClient } from "@prisma/client";
import type { CantonClient } from "./canton-ledger-client.js";
import { toUnits } from "./daml-decimal.js";

/**
 * MainNet app-reward model for test networks, where a handful of featured
 * apps share a pool that thousands share on MainNet. On MainNet an app's
 * rewards refund the traffic it pays for (Tokenomics Committee coupon
 * guidance: coupons <= 1.0x qualifying fees), traffic costs $60/MB (CIP-0084),
 * each featured app gets free traffic per round, and rounds under the coupon
 * threshold are burned (CIP-0104).
 */
export interface MainnetRewardParams {
  usdPerMb: number;
  bytesPerTx: number;
  freeBytesPerRound: number;
  rewardToFeeRatio: number;
  maxUsdPerTx: number;
  minRoundUsd: number;
}

export interface SimulatedReward { txCount: number; trafficUsd: number; rewardUsd: number; rewardCc: bigint }

export function simulateMainnetReward(txCount: number, ccUsd: number, p: MainnetRewardParams): SimulatedReward {
  const paidBytes = Math.max(0, txCount * p.bytesPerTx - p.freeBytesPerRound);
  const trafficUsd = paidBytes / 1_000_000 * p.usdPerMb;
  const capped = Math.min(trafficUsd * p.rewardToFeeRatio, txCount * p.maxUsdPerTx);
  const rewardUsd = capped >= p.minRoundUsd ? capped : 0;
  const cc = ccUsd > 0 ? rewardUsd / ccUsd : 0;
  return { txCount, trafficUsd, rewardUsd, rewardCc: cc > 0 && Number.isFinite(cc) ? toUnits(cc.toFixed(10)) : 0n };
}

const CURSOR_PREFIX = "canton-app-traffic:";

/** Count this app's own ledger transactions (workflow "cantonstake…") since the last measurement. */
export async function measureAppTransactions(ledger: Pick<CantonClient, "ledgerEnd" | "workflowTransactions">,
  db: Pick<PrismaClient, "watcherCursor">, opts: { synchronizerId: string; provider: string; maxPages?: number }): Promise<number> {
  const key = `${CURSOR_PREFIX}${opts.synchronizerId}:${opts.provider}`;
  const end = await ledger.ledgerEnd();
  const stored = await db.watcherCursor.findUnique({ where: { key } });
  // First run: start from now rather than counting the whole history into one round.
  let cursor = stored ? Number(stored.lastScannedBlock) : end;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Stored app traffic cursor is invalid");
  let count = 0;
  for (let page = 0; page < (opts.maxPages ?? 50) && cursor < end; page++) {
    const { matching, lastOffset } = await ledger.workflowTransactions("cantonstake", cursor, end);
    count += matching;
    cursor = lastOffset === null || lastOffset <= cursor ? end : lastOffset;
  }
  await db.watcherCursor.upsert({ where: { key }, create: { key, lastScannedBlock: String(cursor) }, update: { lastScannedBlock: String(cursor) } });
  return count;
}
