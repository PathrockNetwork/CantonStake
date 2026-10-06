import type { PrismaClient } from "@prisma/client";
import type { CantonClient } from "./canton-ledger-client.js";
import { dsoPartyFor, isCantonParty } from "./canton-network.js";
import { fromUnits, toUnits } from "./daml-decimal.js";

/** DSO-issued app reward coupon (traffic- or marker-based) for a provider party. */
export const REWARD_COUPON_TEMPLATE = "#splice-amulet:Splice.Amulet:RewardCouponV2";
const CURSOR_PREFIX = "canton-reward-coupons:";

export interface RoundAllocationInput { positionId: string; userId: string; stake: string }
export interface RoundAllocation { positionId: string; userId: string; total: string; userShare: string; treasuryShare: string }

/**
 * Split `totalCc` across positions pro rata by stake, then 75/25 between the
 * staker and the treasury. Exact: allocations always sum to `totalCc`; the
 * rounding remainder goes to a treasury share, never to a staker. Returns no
 * allocations when nothing was earned or nothing is staked.
 */
export function allocateRound(totalCc: string, positions: RoundAllocationInput[]): RoundAllocation[] {
  const total = toUnits(totalCc);
  const stakes = positions.map(p => toUnits(p.stake));
  const totalStake = stakes.reduce((sum, stake) => sum + stake, 0n);
  if (total === 0n || totalStake === 0n) return [];
  const shares = stakes.map(stake => total * stake / totalStake);
  // Floor division leaves at most (positions - 1) units; assign them to the treasury.
  const remainder = total - shares.reduce((sum, share) => sum + share, 0n);
  return positions.map((position, index) => {
    const userShare = shares[index]! * 75n / 100n;
    const share = shares[index]! + (index === 0 ? remainder : 0n);
    return { positionId: position.positionId, userId: position.userId, total: fromUnits(share),
      userShare: fromUnits(userShare), treasuryShare: fromUnits(share - userShare) };
  });
}

/** Validate a created RewardCouponV2 against the configured network and provider. */
export function parseCoupon(argument: Record<string, unknown> | null, synchronizerId: string, provider: string): { networkRound: number; amount: string } {
  const dso = dsoPartyFor(synchronizerId);
  const round = Number((argument?.round as { number?: unknown } | undefined)?.number);
  const amount = argument?.amount;
  if (!dso || argument?.dso !== dso || argument?.provider !== provider || !isCantonParty(provider) ||
      !Number.isSafeInteger(round) || round < 0 || typeof amount !== "string") {
    throw new Error("Reward coupon does not belong to this network's DSO and provider");
  }
  toUnits(amount);
  return { networkRound: round, amount };
}

type CouponStore = Pick<PrismaClient, "watcherCursor" | "providerRewardCoupon">;

/**
 * Pull every coupon create/archive for the provider since the stored cursor.
 * Idempotent: re-reading a page skips known coupons. Never moves funds.
 */
export async function syncProviderCoupons(ledger: Pick<CantonClient, "ledgerEnd" | "templateEvents">, db: CouponStore,
  opts: { synchronizerId: string; provider: string; maxPages?: number }): Promise<{ created: number; archived: number; cursor: number }> {
  const key = `${CURSOR_PREFIX}${opts.synchronizerId}:${opts.provider}`;
  const stored = await db.watcherCursor.findUnique({ where: { key } });
  let cursor = stored ? Number(stored.lastScannedBlock) : 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Stored reward coupon cursor is invalid");
  const end = await ledger.ledgerEnd();
  let created = 0, archived = 0;
  for (let page = 0; page < (opts.maxPages ?? 50) && cursor < end; page++) {
    const { events, lastOffset } = await ledger.templateEvents(REWARD_COUPON_TEMPLATE, cursor, end);
    const at = (effectiveAt: string | null) => effectiveAt ? new Date(effectiveAt) : new Date();
    const creates = events.filter(e => e.kind === "created").map(e => ({ contractId: e.contractId,
      synchronizerId: opts.synchronizerId, providerParty: opts.provider, createdOffset: String(e.offset),
      createdAt: at(e.effectiveAt), ...parseCoupon(e.argument, opts.synchronizerId, opts.provider) }));
    if (creates.length) await db.providerRewardCoupon.createMany({ data: creates, skipDuplicates: true });
    for (const e of events.filter(e => e.kind === "archived")) {
      await db.providerRewardCoupon.updateMany({ where: { contractId: e.contractId, archivedOffset: null },
        data: { archivedOffset: String(e.offset), archivedAt: at(e.effectiveAt) } });
    }
    created += creates.length;
    archived += events.length - creates.length;
    // An empty page means nothing visible remains up to `end`.
    cursor = lastOffset === null || lastOffset <= cursor ? end : lastOffset;
    await db.watcherCursor.upsert({ where: { key }, create: { key, lastScannedBlock: String(cursor) }, update: { lastScannedBlock: String(cursor) } });
  }
  return { created, archived, cursor };
}
