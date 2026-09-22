import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregatePositions, readProtocolSummary } from "../src/services/protocol-summary.js";
const now = () => new Date("2026-09-21T00:00:00Z");
const recorded = [{ contractId: "private-id", status: "Bonded", amount: "10", chain: "polygon-amoy", updatedAt: now() }];

test("active lifecycle count excludes released and cancelled; only bonded amounts are valued", () => {
  const summary = aggregatePositions([
    ...recorded, { status: "Bonded", amount: "5.5", chain: "sui" },
    { status: "Pending", amount: "50", chain: "polygon" }, { status: "Unbonding", amount: "60", chain: "polygon" },
    { status: "Released", amount: "1000", chain: "polygon" }, { status: "Cancelled", amount: "1000", chain: "polygon" },
  ]);
  assert.equal(summary.activePositions, 4);
  assert.equal(summary.bondedPositions, 2);
  assert.deepEqual(summary.stakedByChain, { polygon: 10, sui: 5.5 });
  assert(!JSON.stringify(summary).includes("private-id"));
});
test("ledger lifecycle wins over a stale mirror", async () => {
  const summary = await readProtocolSummary({ now, readRecorded: async () => recorded, readLedger: async () => [{ contractId: "private-id", argument: { status: "Released", amountPol: "10" } }] });
  assert.equal(summary.source, "ledger");
  assert.equal(summary.activePositions, 0);
  assert(!JSON.stringify(summary).includes("private-id"));
});
test("failed ledger reads return explicitly recorded data with its actual update time", async () => {
  const summary = await readProtocolSummary({ now, readRecorded: async () => recorded, readLedger: async () => { throw new Error("offline"); } });
  assert.equal(summary.source, "recorded");
  assert.equal(summary.asOf, recorded[0].updatedAt.toISOString());
  assert.deepEqual(summary.stakedByChain, { polygon: 10 });
});
test("two unavailable sources cannot become fake zero totals", async () => {
  await assert.rejects(readProtocolSummary({ now, readRecorded: async () => { throw new Error("DB down"); }, readLedger: async () => { throw new Error("ledger down"); } }));
});
test("invalid amounts never become a complete valuation", () => {
  for (const amount of ["", "-1", "NaN", "Infinity", "1e1000"]) assert.equal(aggregatePositions([{status:"Bonded",amount,chain:"polygon"}]).amountsComplete,false);
});
test("an unclassified EVM position cannot be priced as Polygon", async () => {
  const summary = await readProtocolSummary({ now, readRecorded: async () => [], readLedger: async () => [{ contractId: "unmirrored", argument: { status: "Bonded", amountPol: "10", evmAddress: "0x1234567890123456789012345678901234567890" } }] });
  assert.deepEqual(summary.stakedByChain, { unknown: 10 });
});
