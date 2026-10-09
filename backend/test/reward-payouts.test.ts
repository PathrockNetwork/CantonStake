import assert from "node:assert/strict";
import test from "node:test";
import { executePayouts, hasReceiverSettlement, planPayouts, reconcilePayouts } from "../src/services/reward-payouts.js";

const FP = "1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a";
const party = (name: string, n: string) => `${name}::${n.repeat(68)}`;
const cfg = { provider: party("Provider", "1"), treasury: party("Treasury", "2"), hostedDelegator: party("Delegator", "3"),
  synchronizerId: `global-domain::${FP}`, minimumCc: "1.0" };
const DSO = `DSO::${FP}`;
const wallet = `0x${"a".repeat(40)}`;

function fakeDb(events: Array<Record<string, any>>) {
  const payouts: Array<Record<string, any>> = [];
  const match = (row: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([k, v]) =>
    k === "OR" ? v.some((branch: any) => match(row, branch)) :
    v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) :
    v && typeof v === "object" && "not" in v ? row[k] != null && row[k] !== v.not : row[k] === v);
  const db: any = {
    user: { findUnique: async ({ where }: any) => events.find(e => e.userId === where.id)?.user ?? null },
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
  db.$transaction = async (fn: any, options: any) => {
    assert.equal(options.isolationLevel, "Serializable");
    const before = structuredClone({ events, payouts });
    try { return await fn(db); }
    catch (error) { events.splice(0, events.length, ...before.events); payouts.splice(0, payouts.length, ...before.payouts); throw error; }
  };
  return { db, payouts };
}

const events = () => [
  { id: "e1", userId: "u1", userShare: "75.0000000000", treasuryShare: "25.0000000000", userPayoutId: null, treasuryPayoutId: null,
    position: { evmAddress: wallet }, user: { cantonPartyId: party("Loop", "4"), identityVerifiedAt: new Date(), walletVerifications: [{ walletAddress: wallet }] } },
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
  { contractId: "aa", synchronizerId: cfg.synchronizerId, view: { owner: cfg.provider, lock: null, amount: "500.0", instrumentId: { admin: DSO, id: "Amulet" } } },
  { contractId: "bb", synchronizerId: cfg.synchronizerId, view: { owner: cfg.provider, lock: { holders: [] }, amount: "900.0", instrumentId: { admin: DSO, id: "Amulet" } } },
] }) };
const paidEvent = (owner: string, amount: string) => ({ CreatedEvent: { contractId: "cc", templateId: "pkg:Splice.Amulet:Amulet",
  createArgument: { owner, dso: DSO, amount: { initialAmount: amount } } } });

test("executes direct and offer transfers with deterministic command IDs and only unlocked holdings", async () => {
  const { db, payouts } = fakeDb(events());
  await planPayouts(db, cfg);
  const submitted: any[] = [];
  const ledger: any = { ...holdings, activeInterfaceSnapshot: async (iface: string) => iface.endsWith(":TransferInstruction")
    ? { contracts: [{ contractId: "dd", synchronizerId: cfg.synchronizerId, view: { transfer: {
      sender: cfg.provider, receiver: party("Loop", "4"), amount: "75.0", instrumentId: { admin: DSO, id: "Amulet" } } } }] }
    : holdings.activeInterfaceSnapshot(), exerciseChoice: async (args: any) => {
    submitted.push(args);
    return args.argument.transfer.receiver === cfg.treasury
      ? { transactionId: "u-direct", completionOffset: "1", events: [paidEvent(cfg.treasury, "26.0")] }
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
    { contractId: "aa", synchronizerId: cfg.synchronizerId, view: { owner: cfg.provider, lock: null, amount: "10.0", instrumentId: { admin: DSO, id: "Amulet" } } }] }) };
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
  payouts.push({ id: "p1", status: "pending_acceptance", recipientParty: party("Loop", "4"), amount: "75.0", transferInstructionCid: "dd", commandId: "c", executeBefore: new Date(Date.now() + 1000) });
  const ledger: any = {
    contractHistory: async () => ({ created: { synchronizerId: cfg.synchronizerId, createdEvent: { contractId: "dd", templateId: "pkg:M:AmuletTransferInstruction", createArgument: {}, offset: 1 } },
      archived: { synchronizerId: cfg.synchronizerId, archivedEvent: { contractId: "dd", templateId: "pkg:M:AmuletTransferInstruction", offset: 42 } } }),
    // Package-ID template IDs are rejected as filters by Canton 3.5: read all events at the offset.
    transactionAtOffset: async (offset: number, templateId?: string) => {
      assert.equal(offset, 42);
      assert.equal(templateId, undefined);
      return { updateId: "x", synchronizerId: cfg.synchronizerId, events: [paidEvent(party("Loop", "4"), "75.0"),
        { ExercisedEvent: { contractId: "dd", templateId: "t", choice: "TransferInstruction_Accept", actingParties: [party("Loop", "4")], consuming: true } }] };
    },
  };
  assert.deepEqual(await reconcilePayouts(db, ledger, {} as any, cfg), [{ id: "p1", status: "completed" }]);
});

test("a partial concurrent allocation claim rolls back the entire payout batch", async () => {
  const rows = events();
  const { db, payouts } = fakeDb(rows);
  db.rewardEvent.updateMany = async () => ({ count: 0 });
  await assert.rejects(planPayouts(db, cfg), /claimed concurrently/);
  assert.equal(payouts.length, 0);
  assert(rows.every(row => row.userPayoutId === null && row.treasuryPayoutId === null));
});

test("old unverified links never authorize a new staker payout", async () => {
  const rows = events();
  rows[0]!.user.identityVerifiedAt = undefined;
  const { db, payouts } = fakeDb(rows);
  await planPayouts(db, cfg);
  assert.deepEqual(payouts.map(p => p.recipientKind), ["treasury"]);
});

test("submitting or uncertain batches block further offers to the same user", async () => {
  for (const status of ["planned", "submitting", "uncertain"]) {
    const { db, payouts } = fakeDb(events());
    payouts.push({ id: "old", recipientKind: "staker", userId: "u1", status });
    await planPayouts(db, cfg);
    assert.equal(payouts.filter(p => p.recipientKind === "staker").length, 1);
  }
});

test("missing transfer instructions are not proof that a payout completed", async () => {
  const { db, payouts } = fakeDb(events());
  await planPayouts(db, cfg);
  const ledger: any = { ...holdings, exerciseChoice: async () => ({ transactionId: "observed", events: [] }) };
  const registry: any = { transferFactory: async () => ({ factoryId: "ff", transferKind: "direct", choiceContext: { choiceContextData: {}, disclosedContracts: [] } }) };
  await executePayouts(db, ledger, registry, cfg);
  assert.equal(payouts[0]!.status, "uncertain");
  assert.equal(payouts[0]!.updateId, "observed");
  assert.equal(payouts[0]!.settledAt, null);
  assert.equal(payouts[1]!.status, "planned");
});

test("settlement rejects another owner, another DSO, insufficient amount and malformed amounts", () => {
  assert(hasReceiverSettlement([paidEvent(cfg.treasury, "26.0")], cfg.treasury, "26.0", cfg));
  for (const event of [paidEvent(cfg.provider, "26.0"), paidEvent(cfg.treasury, "25.9"), paidEvent(cfg.treasury, "NaN"),
    { CreatedEvent: { ...paidEvent(cfg.treasury, "26.0").CreatedEvent, createArgument: { owner: cfg.treasury, dso: "wrong", amount: { initialAmount: "26.0" } } } }]) {
    assert(!hasReceiverSettlement([event], cfg.treasury, "26.0", cfg));
  }
});

test("unknown archive choices and missing transaction evidence remain uncertain, never expired or paid", async () => {
  for (const choice of ["Archive", "TransferInstruction_Update", "TransferInstruction_Accept", null]) {
    const { db, payouts } = fakeDb([]);
    payouts.push({ id: "p1", status: "pending_acceptance", recipientParty: party("Loop", "4"), amount: "75.0", transferInstructionCid: "dd" });
    const ledger: any = {
      contractHistory: async () => ({ created: { synchronizerId: cfg.synchronizerId }, archived: { synchronizerId: cfg.synchronizerId, archivedEvent: { offset: 42 } } }),
      transactionAtOffset: async () => choice ? { updateId: "x", synchronizerId: cfg.synchronizerId, events: [{ ExercisedEvent: { contractId: "dd", consuming: true, choice, actingParties: [party("Loop", "4")] } }] } : null,
    };
    await reconcilePayouts(db, ledger, {} as any, cfg);
    assert.equal(payouts[0]!.status, "uncertain");
  }
});

test("an uncertain direct submission can be settled by read-only transaction evidence without resubmission", async () => {
  const { db, payouts } = fakeDb([]);
  payouts.push({ id: "p1", status: "uncertain", recipientParty: cfg.treasury, amount: "26.0", updateId: "known-update" });
  const ledger: any = { transactionById: async () => ({ updateId: "known-update", synchronizerId: cfg.synchronizerId, events: [paidEvent(cfg.treasury, "26.0")] }),
    exerciseChoice: async () => assert.fail("must never resubmit") };
  assert.deepEqual(await reconcilePayouts(db, ledger, {} as any, cfg), [{ id: "p1", status: "completed" }]);
});

test("only the selected 50 holdings count toward funding a payout", async () => {
  const { db, payouts } = fakeDb(events());
  await planPayouts(db, cfg);
  const ledger: any = {
    activeInterfaceSnapshot: async () => ({ contracts: Array.from({ length: 100 }, (_, i) => ({ contractId: `h${i}`,
      synchronizerId: cfg.synchronizerId, view: { owner: cfg.provider, lock: null, amount: "0.3", instrumentId: { admin: DSO, id: "Amulet" } } })) }),
    exerciseChoice: async () => assert.fail("50 selected holdings cannot fund the 26 CC payout"),
  };
  assert.equal((await executePayouts(db, ledger, {} as any, cfg))[0]?.status, "planned");
  assert(payouts.every(p => p.status === "planned"));
});

test("a pre-upgrade planned staker payout is held until its recipient is verified", async () => {
  const rows = events();
  const { db, payouts } = fakeDb(rows);
  payouts.push({ id: "old", status: "planned", recipientKind: "staker", recipientParty: rows[0]!.user.cantonPartyId, userId: "u1", amount: "75.0" });
  rows[0]!.user.identityVerifiedAt = undefined;
  const ledger: any = { ...holdings, exerciseChoice: async () => assert.fail("unverified payout must not be submitted") };
  const result = await executePayouts(db, ledger, {} as any, cfg);
  assert.equal(result[0]?.status, "planned");
  assert.match(result[0]?.error ?? "", /ownership must be verified/);
});

test("verifying one wallet cannot authorize old allocations belonging to another wallet", async () => {
  const rows = events();
  rows.push({ ...rows[0]!, id: "foreign-wallet", position: { evmAddress: `0x${"b".repeat(40)}` }, userShare: "999.0" });
  const { db, payouts } = fakeDb(rows);
  await planPayouts(db, cfg);
  assert.equal(payouts.find(p => p.recipientKind === "staker")?.amount, "75.0000000000");
  assert.equal(rows[2]!.userPayoutId, null);
});

test("a post-settlement holdings outage never demotes an already proven payout", async () => {
  const { db, payouts } = fakeDb(events());
  await planPayouts(db, cfg);
  let reads = 0;
  const ledger: any = { activeInterfaceSnapshot: async () => {
    if (++reads > 1) throw new Error("holdings unavailable");
    return holdings.activeInterfaceSnapshot();
  }, exerciseChoice: async () => ({ transactionId: "settled", events: [paidEvent(cfg.treasury, "26.0")] }) };
  const registry: any = { transferFactory: async () => ({ factoryId: "ff", transferKind: "direct", choiceContext: { choiceContextData: {}, disclosedContracts: [] } }) };
  const result = await executePayouts(db, ledger, registry, cfg);
  assert.equal(result.length, 1);
  assert.equal(payouts[0]!.status, "completed");
});
