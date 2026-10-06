import assert from "node:assert/strict";
import test from "node:test";
import { allocateRound, parseCoupon, syncProviderCoupons } from "../src/services/canton-reward-coupons.js";
import { fromUnits, toUnits } from "../src/services/daml-decimal.js";

const FP = "1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a";
const SYNC = `global-domain::${FP}`, DSO = `DSO::${FP}`;
const PROVIDER = `Provider::${"1".repeat(68)}`;

test("exact decimal round trip", () => {
  assert.equal(fromUnits(toUnits("119.896452946")), "119.8964529460");
  assert.equal(fromUnits(toUnits("0")), "0.0000000000");
  assert.equal(fromUnits(toUnits("12.5"), { trim: true }), "12.5");
  assert.equal(fromUnits(toUnits("3"), { trim: true }), "3");
  assert.throws(() => toUnits("-1"));
  assert.throws(() => toUnits("1.12345678901"));
});

test("allocation is stake-weighted, 75/25, and sums exactly to the earned CC", () => {
  const allocations = allocateRound("100.0000000001", [
    { positionId: "a", userId: "u1", stake: "10.0000000000" },
    { positionId: "b", userId: "u2", stake: "20.0000000000" },
  ]);
  const sum = allocations.reduce((s, a) => s + toUnits(a.total), 0n);
  assert.equal(fromUnits(sum), "100.0000000001");
  for (const a of allocations) assert.equal(toUnits(a.userShare) + toUnits(a.treasuryShare), toUnits(a.total));
  assert.equal(allocations[1]!.total, "66.6666666667");
  assert.equal(allocations[1]!.userShare, "50.0000000000");
  // The 1-unit rounding remainder goes to the treasury, never to a staker.
  assert.equal(allocations[0]!.total, "33.3333333334");
  assert.equal(allocations[0]!.userShare, "24.9999999999");
});

test("nothing is allocated without stake or earnings", () => {
  assert.deepEqual(allocateRound("5.0000000000", []), []);
  assert.deepEqual(allocateRound("0", [{ positionId: "a", userId: "u", stake: "1" }]), []);
});

test("coupons must come from this network's DSO for this provider", () => {
  const argument = { dso: DSO, provider: PROVIDER, round: { number: "64178" }, amount: "119.8964529460" };
  assert.deepEqual(parseCoupon(argument, SYNC, PROVIDER), { networkRound: 64178, amount: "119.8964529460" });
  assert.throws(() => parseCoupon({ ...argument, dso: `DSO::${"2".repeat(68)}` }, SYNC, PROVIDER));
  assert.throws(() => parseCoupon({ ...argument, provider: `Other::${"3".repeat(68)}` }, SYNC, PROVIDER));
});

test("sync records creates and archives, then advances the cursor", async () => {
  const rows = new Map<string, Record<string, unknown>>();
  let cursor: string | null = null;
  const db = {
    watcherCursor: {
      findUnique: async () => (cursor ? { lastScannedBlock: cursor } : null),
      upsert: async (args: { update: { lastScannedBlock: string } }) => { cursor = args.update.lastScannedBlock; },
    },
    providerRewardCoupon: {
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        for (const row of args.data) if (!rows.has(row.contractId as string)) rows.set(row.contractId as string, { ...row });
      },
      updateMany: async (args: { where: { contractId: string }; data: Record<string, unknown> }) => {
        const row = rows.get(args.where.contractId);
        if (row && !row.archivedOffset) Object.assign(row, args.data);
      },
    },
  };
  const ledger = {
    ledgerEnd: async () => 300,
    templateEvents: async (_t: string, begin: number) => begin >= 250 ? { events: [], lastOffset: null } : { events: [
      { kind: "created" as const, contractId: "c1", templateId: "x", offset: 200, effectiveAt: "2026-10-06T03:46:31Z",
        argument: { dso: DSO, provider: PROVIDER, round: { number: "64178" }, amount: "119.8964529460" } },
      { kind: "archived" as const, contractId: "c1", templateId: "x", offset: 250, effectiveAt: "2026-10-06T03:50:00Z", argument: null },
    ], lastOffset: 250 },
  };
  const result = await syncProviderCoupons(ledger, db as never, { synchronizerId: SYNC, provider: PROVIDER });
  assert.deepEqual(result, { created: 1, archived: 1, cursor: 300 });
  assert.equal(rows.get("c1")!.amount, "119.8964529460");
  assert.equal(rows.get("c1")!.archivedOffset, "250");
  assert.equal(cursor, "300");
});
