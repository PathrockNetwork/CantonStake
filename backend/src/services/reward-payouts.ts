import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { CantonCommandError, createdContracts, type CantonClient } from "./canton-ledger-client.js";
import { dsoPartyFor, isCantonParty } from "./canton-network.js";
import { fromUnits, toUnits } from "./daml-decimal.js";
import type { TokenRegistry } from "./token-registry.js";
import { normalizeWalletAddress } from "./wallet-address.js";

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
type Db = Pick<PrismaClient, "rewardEvent" | "rewardPayout" | "user" | "$transaction">;
type Ledger = Pick<CantonClient, "activeInterfaceSnapshot" | "exerciseChoice" | "contractHistory" | "transactionAtOffset" | "transactionById">;

/**
 * Batch unpaid allocations into payouts: one to the treasury, one per staker
 * with a verified Canton identity and wallet. Allocations stay linked to their
 * payout forever, so no share can be planned twice. Unverified shares stay unpaid.
 */
export async function planPayouts(db: Db, cfg: PayoutConfig): Promise<{ planned: number; skippedUsers: number }> {
  const minimum = toUnits(cfg.minimumCc);
  let planned = 0;
  const skippedUsers = new Set<string>();
  await db.$transaction(async tx => {
    /** One payout for a batch of shares; the link makes each share payable exactly once. */
    const createPayout = async (recipient: { kind: "treasury" | "staker"; party: string; userId?: string },
      events: Array<{ id: string; share: string }>, link: "treasuryPayoutId" | "userPayoutId") => {
      const total = events.reduce((sum, e) => sum + toUnits(e.share), 0n);
      if (total === 0n || total < minimum) return;
      const ids = events.map(e => e.id).sort();
      const batchHash = createHash("sha256").update(JSON.stringify(ids)).digest("hex");
      const payout = await tx.rewardPayout.create({ data: { recipientKind: recipient.kind, recipientParty: recipient.party,
        userId: recipient.userId, amount: fromUnits(total), commandId: `cantonstake-payout-${recipient.userId ?? "treasury"}-${batchHash}` } });
      const claimed = await tx.rewardEvent.updateMany({ where: { id: { in: ids }, [link]: null }, data: { [link]: payout.id } });
      if (claimed.count !== ids.length) throw new Error("Reward shares were claimed concurrently; roll back this payout batch");
      planned++;
    };
    const treasuryEvents = await tx.rewardEvent.findMany({ where: { treasuryPayoutId: null }, select: { id: true, treasuryShare: true } });
    await createPayout({ kind: "treasury", party: cfg.treasury }, treasuryEvents.map(e => ({ id: e.id, share: e.treasuryShare })), "treasuryPayoutId");

    // A staker with an unanswered offer accumulates new shares into one later
    // offer instead of being asked to accept one per round.
    const waiting = new Set((await tx.rewardPayout.findMany({ where: { recipientKind: "staker", status: { in: ["planned", "submitting", "uncertain", "pending_acceptance"] } },
      select: { userId: true } })).map(p => p.userId));
    const userEvents = await tx.rewardEvent.findMany({ where: { userPayoutId: null },
      select: { id: true, userId: true, userShare: true, position: { select: { evmAddress: true } },
        user: { select: { cantonPartyId: true, identityVerifiedAt: true, walletVerifications: { select: { walletAddress: true } } } } } });
    const byUser = new Map<string, typeof userEvents>();
    for (const e of userEvents) {
      if (!e.user.identityVerifiedAt || !e.user.walletVerifications.some(v => v.walletAddress === normalizeWalletAddress(e.position.evmAddress))) {
        skippedUsers.add(e.userId); continue; // Verifying one wallet never trusts another old public link.
      }
      let list = byUser.get(e.userId);
      if (!list) byUser.set(e.userId, list = []);
      list.push(e);
    }
    for (const [userId, events] of byUser) {
      if (waiting.has(userId)) continue;
      const party = events[0]!.user.cantonPartyId;
      if (!events[0]!.user.identityVerifiedAt || !isCantonParty(party) || [cfg.hostedDelegator, cfg.provider, cfg.treasury].includes(party)) { skippedUsers.add(userId); continue; }
      await createPayout({ kind: "staker", party, userId }, events.map(e => ({ id: e.id, share: e.userShare })), "userPayoutId");
    }
  }, { isolationLevel: "Serializable" });
  return { planned, skippedUsers: skippedUsers.size };
}

/** Unlocked Amulet holdings of the provider, read from our own participant (trusted admin source). */
async function providerHoldings(ledger: Ledger, cfg: PayoutConfig) {
  const dso = dsoPartyFor(cfg.synchronizerId);
  const { contracts } = await ledger.activeInterfaceSnapshot(HOLDING, AbortSignal.timeout(15_000));
  const holdings = contracts.filter(c => c.synchronizerId === cfg.synchronizerId && c.view.owner === cfg.provider && c.view.lock == null &&
    (c.view.instrumentId as { admin?: string; id?: string } | undefined)?.id === "Amulet" &&
    (c.view.instrumentId as { admin?: string }).admin === dso);
  return { dso: dso!, holdings: holdings.map(h => ({ contractId: h.contractId, amount: toUnits(String(h.view.amount)) })) };
}

/** Positive settlement evidence: receiver-owned CC created in this transaction.
 * An accepted/archived instruction alone is NOT a guarantee of completion:
 * https://docs.sync.global/app_dev/api/splice-api-token-transfer-instruction-v1/Splice-Api-Token-TransferInstructionV1.html
 */
export function hasReceiverSettlement(events: unknown[], recipient: string, amount: string, cfg: PayoutConfig): boolean {
  try {
    const received = events.reduce<bigint>((sum, row) => {
      const event = (row as { CreatedEvent?: { templateId?: string; createArgument?: Record<string, any> } })?.CreatedEvent;
      const arg = event?.createArgument;
      return event?.templateId?.endsWith(":Splice.Amulet:Amulet") && arg?.owner === recipient &&
        arg.dso === dsoPartyFor(cfg.synchronizerId) && typeof arg.amount?.initialAmount === "string"
        ? sum + toUnits(arg.amount.initialAmount) : sum;
    }, 0n);
    return received >= toUnits(amount) && toUnits(amount) > 0n;
  } catch { return false; }
}

async function verifiedOffer(ledger: Ledger, cid: string, recipient: string, amount: string, cfg: PayoutConfig) {
  const snapshot = await ledger.activeInterfaceSnapshot(INSTRUCTION, AbortSignal.timeout(15_000));
  const contract = snapshot.contracts.find(c => c.contractId === cid && c.synchronizerId === cfg.synchronizerId);
  const transfer = contract?.view.transfer as Record<string, any> | undefined;
  return !!transfer && transfer.sender === cfg.provider && transfer.receiver === recipient &&
    transfer.instrumentId?.admin === dsoPartyFor(cfg.synchronizerId) && transfer.instrumentId?.id === "Amulet" &&
    typeof transfer.amount === "string" && toUnits(transfer.amount) === toUnits(amount);
}

/** Submit planned payouts through the token standard as the provider. */
export async function executePayouts(db: Db, ledger: Ledger, registry: TokenRegistry, cfg: PayoutConfig, now = () => new Date()) {
  const results: Array<{ id: string; status: string; error?: string }> = [];
  const pending = await db.rewardPayout.findMany({ where: { status: "planned" }, orderBy: { createdAt: "asc" }, take: 20 });
  // Holdings change only when a transfer consumes them, so re-read after each submission.
  let wallet = pending.length ? await providerHoldings(ledger, cfg) : null;
  for (const payout of pending) {
    // Also protect batches planned by an older, unauthenticated deployment.
    if (payout.recipientKind === "staker") {
      const user = payout.userId ? await db.user.findUnique({ where: { id: payout.userId }, include: { walletVerifications: true } }) : null;
      if (!user?.identityVerifiedAt || user.cantonPartyId !== payout.recipientParty) {
        results.push({ id: payout.id, status: "planned", error: "Recipient ownership must be verified before payment" });
        continue;
      }
      const shares = await db.rewardEvent.findMany({ where: { userPayoutId: payout.id }, select: { userId: true, position: { select: { evmAddress: true } } } });
      if (!shares.length || shares.some(share => share.userId !== payout.userId ||
          !user.walletVerifications.some(v => v.walletAddress === normalizeWalletAddress(share.position.evmAddress)))) {
        results.push({ id: payout.id, status: "planned", error: "Every wallet represented by this payout must have verified ownership" });
        continue;
      }
    } else if (payout.recipientKind !== "treasury" || payout.recipientParty !== cfg.treasury) {
      results.push({ id: payout.id, status: "planned", error: "Recipient does not match the configured treasury" });
      continue;
    }
    const selected = [...wallet!.holdings].sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0).slice(0, 50);
    const available = selected.reduce((sum, h) => sum + h.amount, 0n);
    if (available <= toUnits(payout.amount)) {
      // Leave this and later payouts planned until new coupons top the wallet up.
      results.push({ id: payout.id, status: "planned", error: `Provider wallet holds ${fromUnits(available)} CC, needs more than ${payout.amount} plus fees` });
      break;
    }
    // Claim the row first: a concurrent executor can never submit it too.
    const claimed = await db.rewardPayout.updateMany({ where: { id: payout.id, status: "planned" }, data: { status: "submitting", submittedAt: now() } });
    if (claimed.count !== 1) continue;
    try {
      const { dso } = wallet!;
      const requestedAt = now(), executeBefore = new Date(requestedAt.getTime() + OFFER_TTL_MS);
      const transfer = { sender: cfg.provider, receiver: payout.recipientParty, amount: payout.amount,
        instrumentId: { admin: dso, id: "Amulet" }, requestedAt: requestedAt.toISOString(), executeBefore: executeBefore.toISOString(),
        inputHoldingCids: selected.map(h => h.contractId),
        meta: { values: { "splice.lfdecentralizedtrust.org/reason": `CantonStake reward payout ${payout.id}` } } };
      const factory = await registry.transferFactory({ expectedAdmin: dso, transfer, extraArgs: emptyExtra() });
      const result = await ledger.exerciseChoice({ templateId: FACTORY, contractId: factory.factoryId,
        choice: "TransferFactory_Transfer", commandId: payout.commandId,
        argument: { expectedAdmin: dso, transfer, extraArgs: emptyExtra(factory.choiceContext.choiceContextData) },
        disclosedContracts: factory.choiceContext.disclosedContracts });
      // Save submission evidence before any follow-up read can fail.
      const instruction = createdContracts(result.events).find(c => c.templateId.endsWith(":Splice.AmuletTransferInstruction:AmuletTransferInstruction"));
      await db.rewardPayout.update({ where: { id: payout.id }, data: { transferKind: factory.transferKind,
        updateId: result.transactionId, transferInstructionCid: instruction?.contractId ?? null, executeBefore } });
      const status = result.transactionId && instruction && await verifiedOffer(ledger, instruction.contractId, payout.recipientParty, payout.amount, cfg)
        ? "pending_acceptance" : result.transactionId && !instruction && hasReceiverSettlement(result.events, payout.recipientParty, payout.amount, cfg) ? "completed" : "uncertain";
      await db.rewardPayout.update({ where: { id: payout.id }, data: { status, transferKind: factory.transferKind, updateId: result.transactionId,
        transferInstructionCid: instruction?.contractId ?? null, executeBefore, settledAt: status === "completed" ? now() : null,
        error: status === "uncertain" ? "Submission observed but recipient settlement or pending instruction is not proven; do not resubmit" : null } });
      results.push({ id: payout.id, status });
      if (status === "uncertain") break;
      try { wallet = await providerHoldings(ledger, cfg); }
      catch { break; } // A later balance read cannot erase a proven settlement.
    } catch (error) {
      // Definite ledger/registry refusals fail; anything else may have executed.
      const definite = (error instanceof CantonCommandError && [400, 401, 403, 404, 413, 415, 422].includes(error.status)) ||
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
  const open = await db.rewardPayout.findMany({ where: { OR: [
    { status: "pending_acceptance" },
    { status: { in: ["uncertain", "submitting"] }, OR: [{ updateId: { not: null } }, { transferInstructionCid: { not: null } }] },
  ] }, orderBy: { submittedAt: "asc" }, take: 50 });
  for (const payout of open) {
    const cid = payout.transferInstructionCid;
    if (!cid) {
      if (payout.updateId) {
        const tx = await ledger.transactionById(payout.updateId, undefined, AbortSignal.timeout(10_000));
        if (tx?.updateId === payout.updateId && tx.synchronizerId === cfg.synchronizerId &&
            hasReceiverSettlement(tx.events, payout.recipientParty, payout.amount, cfg)) {
          await db.rewardPayout.updateMany({ where: { id: payout.id, status: payout.status }, data: { status: "completed", settledAt: now(), error: null } });
          results.push({ id: payout.id, status: "completed" });
        }
      }
      continue; // No evidence means manual review, never an automatic resubmit.
    }
    const history = await ledger.contractHistory(cid, undefined, AbortSignal.timeout(10_000));
    const archivedOffset = history?.archived?.archivedEvent.offset;
    if (archivedOffset) {
      // Package-ID template IDs are not valid filters; read every event at that offset.
      const tx = await ledger.transactionAtOffset(archivedOffset, undefined, AbortSignal.timeout(10_000));
      const event = tx?.events.map(e => e.ExercisedEvent).find(e => e?.contractId === cid && e.consuming);
      const matching = history.created?.synchronizerId === cfg.synchronizerId && history.archived?.synchronizerId === cfg.synchronizerId && tx?.synchronizerId === cfg.synchronizerId && !!tx.updateId;
      const status = matching && event?.choice === "TransferInstruction_Accept" &&
          event.actingParties.includes(payout.recipientParty) && hasReceiverSettlement(tx!.events, payout.recipientParty, payout.amount, cfg) ? "completed"
        : matching && event?.choice === "TransferInstruction_Reject" && event.actingParties.includes(payout.recipientParty) ? "rejected"
        : matching && event?.choice === "TransferInstruction_Withdraw" && event.actingParties.includes(cfg.provider) ? "expired" : "uncertain";
      await db.rewardPayout.updateMany({ where: { id: payout.id, status: payout.status }, data: { status,
        settledAt: status === "uncertain" ? null : now(), error: status === "uncertain" ? "Archived instruction lacks verified final settlement evidence; do not resubmit" : null } });
      results.push({ id: payout.id, status });
    } else if (payout.status === "pending_acceptance" && history?.created?.synchronizerId === cfg.synchronizerId &&
        payout.executeBefore && payout.executeBefore < now() && await verifiedOffer(ledger, cid, payout.recipientParty, payout.amount, cfg)) {
      const context = await registry.instructionContext(cid, "withdraw");
      // Serialize withdrawal attempts too. A crash remains uncertain, never retryable by default.
      const claimed = await db.rewardPayout.updateMany({ where: { id: payout.id, status: "pending_acceptance" }, data: { status: "uncertain", error: "Withdrawal requires reconciliation before any retry" } });
      if (claimed.count !== 1) continue;
      await ledger.exerciseChoice({ templateId: INSTRUCTION, contractId: cid, choice: "TransferInstruction_Withdraw",
        commandId: `${payout.commandId}-withdraw`, argument: { extraArgs: emptyExtra(context.choiceContextData) },
        disclosedContracts: context.disclosedContracts });
      // Confirmation is obtained through contract history on the next pass,
      // not assumed from a successful command HTTP response.
      await db.rewardPayout.update({ where: { id: payout.id }, data: { status: "pending_acceptance", error: null } });
      results.push({ id: payout.id, status: "pending_acceptance" });
    }
  }
  return results;
}
