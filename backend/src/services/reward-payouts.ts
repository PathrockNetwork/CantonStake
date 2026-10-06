import type { PrismaClient } from "@prisma/client";
import { CantonCommandError, createdContracts, type CantonClient } from "./canton-ledger-client.js";
import { dsoPartyFor, isCantonParty } from "./canton-network.js";
import { fromUnits, toUnits } from "./daml-decimal.js";
import type { TokenRegistry } from "./token-registry.js";

const HOLDING = "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
const FACTORY = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory";
const INSTRUCTION = "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction";
const OFFER_TTL_MS = 7 * 86_400_000;
const emptyExtra = (context: Record<string, unknown> = { values: {} }) => ({ context, meta: { values: {} } });

export interface PayoutConfig {
  provider: string;
  treasury: string;
  hostedDelegator: string;
  synchronizerId: string;
  minimumCc: string;
}
type Db = Pick<PrismaClient, "rewardEvent" | "rewardPayout" | "$transaction">;
type Ledger = Pick<CantonClient, "activeInterfaceSnapshot" | "exerciseChoice" | "contractHistory" | "transactionAtOffset">;

/**
 * Batch unpaid allocations into payouts: one to the treasury, one per staker
 * with a usable Canton party. Allocations stay linked to their payout forever,
 * so no share can be planned twice. Stakers without a party remain unpaid.
 */
export async function planPayouts(db: Db, cfg: PayoutConfig): Promise<{ planned: number; skippedUsers: number }> {
  const minimum = toUnits(cfg.minimumCc);
  let planned = 0, skippedUsers = 0;
  await db.$transaction(async tx => {
    /** One payout for a batch of shares; the link makes each share payable exactly once. */
    const createPayout = async (recipient: { kind: "treasury" | "staker"; party: string; userId?: string },
      events: Array<{ id: string; share: string }>, link: "treasuryPayoutId" | "userPayoutId") => {
      const total = events.reduce((sum, e) => sum + toUnits(e.share), 0n);
      if (total === 0n || total < minimum) return;
      const ids = events.map(e => e.id).sort();
      const payout = await tx.rewardPayout.create({ data: { recipientKind: recipient.kind, recipientParty: recipient.party,
        userId: recipient.userId, amount: fromUnits(total), commandId: `cantonstake-payout-${recipient.userId ?? "treasury"}-${ids[0]}-${ids.length}` } });
      await tx.rewardEvent.updateMany({ where: { id: { in: ids }, [link]: null }, data: { [link]: payout.id } });
      planned++;
    };
    const treasuryEvents = await tx.rewardEvent.findMany({ where: { treasuryPayoutId: null }, select: { id: true, treasuryShare: true } });
    await createPayout({ kind: "treasury", party: cfg.treasury }, treasuryEvents.map(e => ({ id: e.id, share: e.treasuryShare })), "treasuryPayoutId");

    // A staker with an unanswered offer accumulates new shares into one later
    // offer instead of being asked to accept one per round.
    const waiting = new Set((await tx.rewardPayout.findMany({ where: { recipientKind: "staker", status: "pending_acceptance" },
      select: { userId: true } })).map(p => p.userId));
    const userEvents = await tx.rewardEvent.findMany({ where: { userPayoutId: null },
      select: { id: true, userId: true, userShare: true, user: { select: { cantonPartyId: true } } } });
    const byUser = new Map<string, typeof userEvents>();
    for (const e of userEvents) {
      let list = byUser.get(e.userId);
      if (!list) byUser.set(e.userId, list = []);
      list.push(e);
    }
    for (const [userId, events] of byUser) {
      if (waiting.has(userId)) continue;
      const party = events[0]!.user.cantonPartyId;
      if (!isCantonParty(party) || [cfg.hostedDelegator, cfg.provider, cfg.treasury].includes(party)) { skippedUsers++; continue; }
      await createPayout({ kind: "staker", party, userId }, events.map(e => ({ id: e.id, share: e.userShare })), "userPayoutId");
    }
  });
  return { planned, skippedUsers };
}

/** Unlocked Amulet holdings of the provider, read from our own participant (trusted admin source). */
async function providerHoldings(ledger: Ledger, cfg: PayoutConfig) {
  const dso = dsoPartyFor(cfg.synchronizerId);
  const { contracts } = await ledger.activeInterfaceSnapshot(HOLDING, AbortSignal.timeout(15_000));
  const holdings = contracts.filter(c => c.view.owner === cfg.provider && c.view.lock == null &&
    (c.view.instrumentId as { admin?: string; id?: string } | undefined)?.id === "Amulet" &&
    (c.view.instrumentId as { admin?: string }).admin === dso);
  return { dso: dso!, holdings: holdings.map(h => ({ contractId: h.contractId, amount: toUnits(String(h.view.amount)) })) };
}

/** Submit planned payouts through the token standard as the provider. */
export async function executePayouts(db: Db, ledger: Ledger, registry: TokenRegistry, cfg: PayoutConfig, now = () => new Date()) {
  const results: Array<{ id: string; status: string; error?: string }> = [];
  const pending = await db.rewardPayout.findMany({ where: { status: "planned" }, orderBy: { createdAt: "asc" }, take: 20 });
  // Holdings change only when a transfer consumes them, so re-read after each submission.
  let wallet = pending.length ? await providerHoldings(ledger, cfg) : null;
  for (const payout of pending) {
    const available = wallet!.holdings.reduce((sum, h) => sum + h.amount, 0n);
    if (available <= toUnits(payout.amount)) {
      // Leave this and later payouts planned until new coupons top the wallet up.
      results.push({ id: payout.id, status: "planned", error: `Provider wallet holds ${fromUnits(available)} CC, needs more than ${payout.amount} plus fees` });
      break;
    }
    // Claim the row first: a concurrent executor can never submit it too.
    const claimed = await db.rewardPayout.updateMany({ where: { id: payout.id, status: "planned" }, data: { status: "submitting", submittedAt: now() } });
    if (claimed.count !== 1) continue;
    try {
      const { dso, holdings } = wallet!;
      const requestedAt = now(), executeBefore = new Date(requestedAt.getTime() + OFFER_TTL_MS);
      const transfer = { sender: cfg.provider, receiver: payout.recipientParty, amount: payout.amount,
        instrumentId: { admin: dso, id: "Amulet" }, requestedAt: requestedAt.toISOString(), executeBefore: executeBefore.toISOString(),
        inputHoldingCids: holdings.slice(0, 50).map(h => h.contractId),
        meta: { values: { "splice.lfdecentralizedtrust.org/reason": `CantonStake reward payout ${payout.id}` } } };
      const factory = await registry.transferFactory({ expectedAdmin: dso, transfer, extraArgs: emptyExtra() });
      const result = await ledger.exerciseChoice({ templateId: FACTORY, contractId: factory.factoryId,
        choice: "TransferFactory_Transfer", commandId: payout.commandId,
        argument: { expectedAdmin: dso, transfer, extraArgs: emptyExtra(factory.choiceContext.choiceContextData) },
        disclosedContracts: factory.choiceContext.disclosedContracts });
      const instruction = createdContracts(result.events).find(c => /TransferInstruction$/.test(c.templateId));
      const status = instruction ? "pending_acceptance" : "completed";
      await db.rewardPayout.update({ where: { id: payout.id }, data: { status, transferKind: factory.transferKind, updateId: result.transactionId,
        transferInstructionCid: instruction?.contractId ?? null, executeBefore, settledAt: instruction ? null : now(), error: null } });
      results.push({ id: payout.id, status });
      wallet = await providerHoldings(ledger, cfg);
    } catch (error) {
      // Definite ledger/registry refusals fail; anything else may have executed.
      const definite = (error instanceof CantonCommandError && error.status >= 400 && error.status < 500) ||
        (error instanceof Error && /^Token registry/.test(error.message));
      const status = definite ? "failed" : "uncertain";
      const message = error instanceof Error ? error.message.slice(0, 1000) : String(error);
      await db.rewardPayout.update({ where: { id: payout.id }, data: { status, error: message } });
      results.push({ id: payout.id, status, error: message });
      if (!definite) break;
    }
  }
  return results;
}

/** Follow offers to acceptance, rejection or expiry; withdraw expired offers to unlock the CC. */
export async function reconcilePayouts(db: Db, ledger: Ledger, registry: TokenRegistry, cfg: PayoutConfig, now = () => new Date()) {
  const results: Array<{ id: string; status: string }> = [];
  const open = await db.rewardPayout.findMany({ where: { status: "pending_acceptance" }, take: 50 });
  for (const payout of open) {
    const cid = payout.transferInstructionCid;
    if (!cid) continue;
    const history = await ledger.contractHistory(cid, undefined, AbortSignal.timeout(10_000));
    const archivedOffset = history?.archived?.archivedEvent.offset;
    if (archivedOffset) {
      // Package-ID template IDs are not valid filters; read every event at that offset.
      const tx = await ledger.transactionAtOffset(archivedOffset, undefined, AbortSignal.timeout(10_000));
      const choice = tx?.events.map(e => e.ExercisedEvent).find(e => e?.contractId === cid && e.consuming)?.choice ?? "";
      const status = /Accept/.test(choice) ? "completed" : /Reject/.test(choice) ? "rejected" : "expired";
      await db.rewardPayout.update({ where: { id: payout.id }, data: { status, settledAt: now() } });
      results.push({ id: payout.id, status });
    } else if (history?.created && payout.executeBefore && payout.executeBefore < now()) {
      const context = await registry.instructionContext(cid, "withdraw");
      await ledger.exerciseChoice({ templateId: INSTRUCTION, contractId: cid, choice: "TransferInstruction_Withdraw",
        commandId: `${payout.commandId}-withdraw`, argument: { extraArgs: emptyExtra(context.choiceContextData) },
        disclosedContracts: context.disclosedContracts });
      await db.rewardPayout.update({ where: { id: payout.id }, data: { status: "expired", settledAt: now() } });
      results.push({ id: payout.id, status: "expired" });
    }
  }
  return results;
}
