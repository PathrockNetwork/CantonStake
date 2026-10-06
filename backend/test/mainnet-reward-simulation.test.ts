import assert from "node:assert/strict";
import test from "node:test";
import { measureAppTransactions, simulateMainnetReward } from "../src/services/mainnet-reward-simulation.js";
import { fromUnits } from "../src/services/daml-decimal.js";

const params = { usdPerMb: 60, bytesPerTx: 4000, freeBytesPerRound: 100_000, rewardToFeeRatio: 1, maxUsdPerTx: 1.5, minRoundUsd: 0.5 };

test("traffic inside the free allowance earns nothing", () => {
  assert.deepEqual(simulateMainnetReward(2, 0.13, params), { txCount: 2, trafficUsd: 0, rewardUsd: 0, rewardCc: 0n });
});

test("rewards refund paid traffic at MainNet prices", () => {
  // 100 tx x 4 KB = 400 KB, 300 KB paid at $60/MB = $18 -> 18 / 0.125 = 144 CC.
  const r = simulateMainnetReward(100, 0.125, params);
  assert.equal(r.trafficUsd, 18);
  assert.equal(fromUnits(r.rewardCc), "144.0000000000");
});

test("rounds under the coupon threshold are burned and the per-tx cap applies", () => {
  // 30 tx = 120 KB, 20 KB paid = $1.20 -> paid; 26 tx = 4 KB paid = $0.24 -> burned.
  assert.ok(simulateMainnetReward(30, 0.13, params).rewardUsd > 0);
  assert.equal(simulateMainnetReward(26, 0.13, params).rewardUsd, 0);
  assert.equal(simulateMainnetReward(1000, 0.13, { ...params, bytesPerTx: 100_000 }).rewardUsd, 1500);
});

test("app traffic is counted from the stored cursor and starts at the ledger end", async () => {
  let cursor: string | null = null;
  const db: any = { watcherCursor: {
    findUnique: async () => (cursor ? { lastScannedBlock: cursor } : null),
    upsert: async (a: any) => { cursor = a.update.lastScannedBlock; },
  } };
  let end = 100;
  const ledger = { ledgerEnd: async () => end,
    workflowTransactions: async (_p: string, begin: number) => begin < end ? { matching: 3, lastOffset: end } : { matching: 0, lastOffset: null } };
  const opts = { synchronizerId: "s", provider: "p" };
  assert.equal(await measureAppTransactions(ledger, db, opts), 0);
  end = 150;
  assert.equal(await measureAppTransactions(ledger, db, opts), 3);
  assert.equal(cursor, "150");
});
