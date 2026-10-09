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
export interface AppTrafficMeasurement { txCount: number; key: string; previousCursor: string | null; cursor: string }

/** Count this app's own ledger transactions (workflow "cantonstake…") since the last measurement. */
export async function measureAppTransactions(ledger: Pick<CantonClient, "ledgerEnd" | "workflowTransactions">,
  db: Pick<PrismaClient, "watcherCursor">, opts: { synchronizerId: string; provider: string; maxPages?: number }): Promise<AppTrafficMeasurement> {
  const key = `${CURSOR_PREFIX}${opts.synchronizerId}:${opts.provider}`;
  const end = await ledger.ledgerEnd();
  const stored = await db.watcherCursor.findUnique({ where: { key } });
  // First run: start from now rather than counting the whole history into one round.
  let cursor = stored ? Number(stored.lastScannedBlock) : end;
  if (!Number.isSafeInteger(end) || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > end) throw new Error("Stored app traffic cursor or ledger end is invalid");
  let count = 0;
  for (let page = 0; page < (opts.maxPages ?? 50) && cursor < end; page++) {
    const { matching, lastOffset } = await ledger.workflowTransactions("cantonstake", cursor, end);
    if (!Number.isSafeInteger(matching) || matching < 0 || (lastOffset !== null &&
        (!Number.isSafeInteger(lastOffset) || lastOffset <= cursor || lastOffset > end))) throw new Error("App traffic page is malformed or failed to advance");
    if (lastOffset === null && matching !== 0) throw new Error("App traffic page has transactions but no offset");
    count += matching;
    cursor = lastOffset === null ? end : lastOffset;
  }
  if (cursor !== end) throw new Error("App traffic traversal is incomplete; no measurement cursor was advanced");
  // Observation only: the allocator commits the cursor and reward rows together.
  return { txCount: count, key, previousCursor: stored?.lastScannedBlock ?? null, cursor: String(cursor) };
}

export async function commitAppTraffic(db: Pick<PrismaClient, "watcherCursor">, measurement: AppTrafficMeasurement) {
  const { key, previousCursor, cursor } = measurement;
  if (previousCursor === null) await db.watcherCursor.create({ data: { key, lastScannedBlock: cursor } });
  else {
    const claimed = await db.watcherCursor.updateMany({ where: { key, lastScannedBlock: previousCursor }, data: { lastScannedBlock: cursor } });
    if (claimed.count !== 1) throw new Error("App traffic was allocated concurrently; roll back this round");
  }
}
