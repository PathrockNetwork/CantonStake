import assert from "node:assert/strict";
import test from "node:test";
import { executePayouts, planPayouts, reconcilePayouts } from "../src/services/reward-payouts.js";

const FP = "1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a";
const party = (name: string, n: string) => `${name}::${n.repeat(68)}`;
const cfg = { provider: party("Provider", "1"), treasury: party("Treasury", "2"), hostedDelegator: party("Delegator", "3"),
  synchronizerId: `global-domain::${FP}`, minimumCc: "1.0" };
const DSO = `DSO::${FP}`;

function fakeDb(events: Array<Record<string, any>>) {
  const payouts: Array<Record<string, any>> = [];
  const match = (row: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([k, v]) =>
    v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v);
  const db: any = {
    rewardEvent: {
      findMany: async ({ where }: any) => events.filter(e => match(e, where)),
      updateMany: async ({ where, data }: any) => { const rows = events.filter(e => match(e, where)); rows.forEach(r => Object.assign(r, data)); return { count: rows.length }; },
    },
    rewardPayout: {
      create: async ({ data }: any) => { const row = { id: `p${payouts.length + 1}`, status: "planned", createdAt: new Date(), ...data }; payouts.push(row); return row; },
      findMany: async ({ where }: any) => payouts.filter(p => match(p, where)),
      updateMany: async ({ where, data }: any) => { const rows = payouts.filter(p => match(p, where)); rows.forEach(r => Object.assign(r, data)); return { count: rows.length }; },
      update: async ({ where, data }: any) => Object.assign(payouts.find(p => p.id === where.id)!, data),
    },
  };
  db.$transaction = async (fn: any) => fn(db);
  return { db, payouts };
}

const events = () => [
  { id: "e1", userId: "u1", userShare: "75.0000000000", treasuryShare: "25.0000000000", userPayoutId: null, treasuryPayoutId: null, user: { cantonPartyId: party("Loop", "4") } },
  { id: "e2", userId: "u2", userShare: "3.0000000000", treasuryShare: "1.0000000000", userPayoutId: null, treasuryPayoutId: null, user: { cantonPartyId: cfg.hostedDelegator } },
];

test("plans one treasury payout and one per staker with a real party; never twice", async () => {
  const { db, payouts } = fakeDb(events());
  assert.deepEqual(await planPayouts(db, cfg), { planned: 2, skippedUsers: 1 });
  assert.deepEqual(payouts.map(p => [p.recipientKind, p.recipientParty, p.amount]),
    [["treasury", cfg.treasury, "26.0000000000"], ["staker", party("Loop", "4"), "75.0000000000"]]);
  assert.deepEqual(await planPayouts(db, cfg), { planned: 0, skippedUsers: 1 });
});

const holdings = { activeInterfaceSnapshot: async () => ({ offset: "1", contracts: [
  { contractId: "aa", view: { owner: cfg.provider, lock: null, amount: "500.0", instrumentId: { admin: DSO, id: "Amulet" } } },
  { contractId: "bb", view: { owner: cfg.provider, lock: { holders: [] }, amount: "900.0", instrumentId: { admin: DSO, id: "Amulet" } } },
] }) };

test("executes direct and offer transfers with deterministic command IDs and only unlocked holdings", async () => {
  const { db, payouts } = fakeDb(events());
  await planPayouts(db, cfg);
  const submitted: any[] = [];
  const ledger: any = { ...holdings, exerciseChoice: async (args: any) => {
    submitted.push(args);
    return args.argument.transfer.receiver === cfg.treasury
      ? { transactionId: "u-direct", completionOffset: "1", events: [{ CreatedEvent: { contractId: "cc", templateId: "pkg:Splice.Amulet:Amulet" } }] }
      : { transactionId: "u-offer", completionOffset: "2", events: [{ CreatedEvent: { contractId: "dd", templateId: "pkg:Splice.AmuletTransferInstruction:AmuletTransferInstruction" } }] };
  } };
  const registry: any = { transferFactory: async (args: any) => {
    assert.equal(args.expectedAdmin, DSO);
    return { factoryId: "ff", transferKind: args.transfer.receiver === cfg.treasury ? "direct" : "offer",
      choiceContext: { choiceContextData: { values: { k: 1 } }, disclosedContracts: [] } };
  } };
  const results = await executePayouts(db, ledger, registry, cfg);
  assert.deepEqual(results.map(r => r.status), ["completed", "pending_acceptance"]);
  assert.deepEqual(submitted[0].argument.transfer.inputHoldingCids, ["aa"]);
  assert.equal(submitted[0].commandId, payouts[0]!.commandId);
  assert.deepEqual(submitted[0].argument.extraArgs.context, { values: { k: 1 } });
  assert.equal(payouts[1]!.transferInstructionCid, "dd");
});

test("a staker with an unanswered offer gets no second offer until it settles", async () => {
  const { db, payouts } = fakeDb(events());
  payouts.push({ id: "p0", recipientKind: "staker", userId: "u1", status: "pending_acceptance" });
  await planPayouts(db, cfg);
  assert.deepEqual(payouts.filter(p => p.status === "planned").map(p => p.recipientKind), ["treasury"]);
});

test("an underfunded wallet leaves payouts planned instead of failing them", async () => {
  const { db, payouts } = fakeDb(events());
  await planPayouts(db, cfg);
  const poor: any = { activeInterfaceSnapshot: async () => ({ offset: "1", contracts: [
    { contractId: "aa", view: { owner: cfg.provider, lock: null, amount: "10.0", instrumentId: { admin: DSO, id: "Amulet" } } }] }) };
  const results = await executePayouts(db, poor, {} as any, cfg);
  assert.equal(results.length, 1);
  assert.ok(payouts.every(p => p.status === "planned"));
});

test("registry refusals fail each payout; a transport error is uncertain and stops the run", async () => {
  const run = async (error: Error) => {
    const { db, payouts } = fakeDb(events().slice(0, 1));
    await planPayouts(db, cfg);
    await executePayouts(db, { ...holdings } as any, { transferFactory: async () => { throw error; } } as any, cfg);
    return payouts.map(p => p.status);
  };
  assert.deepEqual(await run(new Error("Token registry transfer-factory failed (400)")), ["failed", "failed"]);
  assert.deepEqual(await run(new Error("fetch failed")), ["uncertain", "planned"]);
});

test("reconciles an accepted offer to completed", async () => {
  const { db, payouts } = fakeDb([]);
  payouts.push({ id: "p1", status: "pending_acceptance", transferInstructionCid: "dd", commandId: "c", executeBefore: new Date(Date.now() + 1000) });
  const ledger: any = {
    contractHistory: async () => ({ created: { synchronizerId: "s", createdEvent: { contractId: "dd", templateId: "pkg:M:AmuletTransferInstruction", createArgument: {}, offset: 1 } },
      archived: { synchronizerId: "s", archivedEvent: { contractId: "dd", templateId: "pkg:M:AmuletTransferInstruction", offset: 42 } } }),
    transactionAtOffset: async () => ({ updateId: "x", synchronizerId: "s", events: [{ ExercisedEvent: { contractId: "dd", templateId: "t", choice: "TransferInstruction_Accept", actingParties: [], consuming: true } }] }),
  };
  assert.deepEqual(await reconcilePayouts(db, ledger, {} as any, cfg), [{ id: "p1", status: "completed" }]);
});
