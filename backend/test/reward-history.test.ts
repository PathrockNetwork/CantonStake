import { test, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { rewardHistoryRoutesFor } from "../src/routes/reward-history.js";
function storage() {
  return { user: { findFirst: mock.fn(async (): Promise<any> => null) }, rewardSweep: { findMany: mock.fn(async (): Promise<any[]> => []) }, rewardEvent: { findMany: mock.fn(async (): Promise<any[]> => []) } };
}

const address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
test("reward history validates parameters before querying storage", async () => {
  const db = storage(); const app = Fastify();
  await app.register(rewardHistoryRoutesFor(db as any));
  const user = db.user.findFirst;
  try {
    for (const query of ["", "?address=no", `?address=${address}&days=91`, `?address=${address}&limit=99999`]) {
      assert.equal((await app.inject(`/api/rewards/history${query}`)).statusCode, 400);
    }
    assert.equal(user.mock.callCount(), 0);
  } finally { mock.restoreAll(); await app.close(); }
});
test("reward history scopes both streams, preserves precision, and paginates chronologically", async () => {
  const db = storage(); const app = Fastify(); await app.register(rewardHistoryRoutesFor(db as any));
  const user = db.user.findFirst; user.mock.mockImplementation(async () => ({ id: "private-user" }));
  const native = db.rewardSweep.findMany; native.mock.mockImplementation(async () => [{ id: "one", sweptAt: new Date("2026-09-20T12:00:00Z"), userPayoutWei: "1000000000000000001", evmTxHash: "tx", position: { contractId: "position-a", chain: "polygon" } }]);
  const cc = db.rewardEvent.findMany; cc.mock.mockImplementation(async () => [{ id: "two", createdAt: new Date("2026-09-20T13:00:00Z"), userShare: "0.75", cantonTxId: "proof", round: { roundNumber: 123 }, position: { contractId: "position-a", chain: "polygon" } }]);
  try {
    const response = await app.inject(`/api/rewards/history?address=${address}&limit=2`);
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.events[0].amount, "0.75"); assert.equal(body.events[0].kind, "cc");
    assert.equal(body.events[1].amount, "1.000000000000000001");
    assert.equal(body.hasMore, false);
    assert.equal((user.mock.calls[0].arguments[0] as any).where.evmAddress, address.toLowerCase());
    for (const query of [native, cc]) assert.equal((query.mock.calls[0].arguments[0] as any).where.userId, "private-user");
    assert(!response.body.includes("private-user"));
    const limited = (await app.inject(`/api/rewards/history?address=${address}&limit=1`)).json();
    assert.equal(limited.events.length, 1); assert.equal(limited.hasMore, true);
  } finally { mock.restoreAll(); await app.close(); }
});
test("unknown accounts are empty and storage failures are explicit", async () => {
  const db = storage(); const app = Fastify(); await app.register(rewardHistoryRoutesFor(db as any));
  const user = db.user.findFirst;
  try {
    assert.deepEqual((await app.inject(`/api/rewards/history?address=${address}`)).json().events, []);
    user.mock.mockImplementation(async () => { throw new Error("private database detail"); });
    const response = await app.inject(`/api/rewards/history?address=${address}`);
    assert.equal(response.statusCode, 503); assert(!response.body.includes("private database detail"));
  } finally { mock.restoreAll(); await app.close(); }
});
