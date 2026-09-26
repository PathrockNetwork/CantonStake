import assert from "node:assert/strict";
import test from "node:test";
import type { ApiPromise } from "@polkadot/api";
import { config } from "../src/config.js";
import { POLKADOT_ASSET_HUB } from "../src/services/polkadot-rpc.js";
import { comparePoolPoints, listPolkadotPoolScoreRows } from "../src/services/polkadot-pool-scores.js";

test("Polkadot pool ordering preserves u128 point precision", () => {
  assert.equal(comparePoolPoints({ points: "9007199254740993" }, { points: "9007199254740992" }), -1);
  assert.equal(comparePoolPoints({ points: "9007199254740992" }, { points: "9007199254740993" }), 1);
});

test("Polkadot pool scores use runtime balances, not share points", async () => {
  const pool = (id: number, points: string, state = "Open") => [
    { args: [{ toString: () => String(id) }] },
    { toJSON: () => ({ state, points, commission: { current: [100_000_000, "owner"] } }) },
  ];
  const decimals = POLKADOT_ASSET_HUB[config.networkMode].decimals;
  const unit = 10n ** BigInt(decimals);
  const calls: number[] = [];
  const api = {
    call: { nominationPoolsApi: { poolBalance: async (id: number) => {
      calls.push(id);
      if (id === 2) throw new Error("one pool unavailable");
      return { toString: () => (id === 1 ? 25n * unit : 0n).toString() };
    } } },
    query: { nominationPools: {
      bondedPools: { entries: async () => [pool(1, "999999999999999"), pool(2, "500"), pool(3, "200"), pool(4, "100", "Blocked")] },
      metadata: { multi: async (ids: number[]) => ids.map((id) => ({ toHex: () =>
        `0x${Buffer.from(`Pool ${id}`).toString("hex")}` })) },
    } },
  } as unknown as ApiPromise;
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const rows = await listPolkadotPoolScoreRows(api);
    assert.deepEqual(rows, [{ address: "pool:1", name: "Pool 1", commissionPct: 10, totalStaked: 25 }]);
    assert.deepEqual(calls, [1, 2, 3]);
  } finally {
    console.warn = previousWarn;
  }
});

test("Polkadot pool scores fail closed without the balance runtime API", async () => {
  const api = { call: { nominationPoolsApi: {} } } as unknown as ApiPromise;
  await assert.rejects(listPolkadotPoolScoreRows(api), /poolBalance/);
});
