import assert from "node:assert/strict";
import test from "node:test";
import { aptosActionAfterPositionStart, aptosUnbondSnapshot, aptosViewAtVersion, aptosWithdrawalCompletesPosition, parseAptosDelegationStake } from "../src/services/aptos-lifecycle.js";
import type { AptosDelegationAction } from "../src/services/aptos-events.js";

const action: AptosDelegationAction = { kind: "unlock", delegator: "0xa", pool: "0xb",
  amountOcta: 1_000_000_000n, requestedOcta: 1_000_000_000n, txHash: "hash",
  version: 11_410_906_013n, timestamp: new Date("2026-09-26T12:00:00Z") };
const base = "https://aptos.example";

test("old exits cannot settle a later position or a later unlock in the same pool", () => {
  assert.equal(aptosActionAfterPositionStart(action, "2026-09-26T11:00:00Z"), true);
  assert.equal(aptosActionAfterPositionStart(action, "2026-09-26T12:01:00Z"), false);
  assert.equal(aptosActionAfterPositionStart(action, "2026-09-26T11:00:00Z", new Date("2026-09-26T12:01:00Z")), false);
  assert.equal(aptosActionAfterPositionStart(action, null), false);
  assert.equal(aptosActionAfterPositionStart(action, "not-a-date"), false);
});

test("reads all unbond proof views at the settled ledger version and records the entire balance", async (t) => {
  const requests: Array<{ url: string; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    requests.push({ url, body });
    return new Response(JSON.stringify(body.function.endsWith("::get_stake")
      ? ["0", "1000000000", "2000000000"] : ["1790500000"]));
  });
  const snapshot = await aptosUnbondSnapshot(base, action);
  assert.equal(snapshot?.amountOcta, 3_000_000_000n);
  assert.equal(snapshot?.readyAt.getTime(), 1_790_500_000_000);
  assert.equal(requests.length, 2);
  for (const request of requests) assert.equal(request.url, `${base}/v1/view?ledger_version=${action.version}`);
  assert.deepEqual(requests[0]?.body, { function: "0x1::delegation_pool::get_stake", type_arguments: [], arguments: [action.pool, action.delegator] });
});

test("partial or empty unlocks do not transition the whole position", async (t) => {
  for (const balances of [["1", "0", "1000000000"], ["0", "0", "0"]]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(JSON.stringify(balances)); });
    assert.equal(await aptosUnbondSnapshot(base, action), null);
    assert.equal(calls, 1);
    t.mock.restoreAll();
  }
});

test("expired lockup is only a projection and never a release proof", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    return new Response(JSON.stringify(body.function.endsWith("::get_stake") ? ["0", "1", "0"] : ["1"]));
  });
  assert.equal((await aptosUnbondSnapshot(base, action))?.readyAt.getTime(), action.timestamp.getTime());
  assert.equal(await aptosWithdrawalCompletesPosition(base, { ...action, kind: "withdraw" }), false);
});

test("release requires zero active, inactive, and pending stake at this withdrawal version", async (t) => {
  // The mocked latest state is already empty. Reading without the version
  // would incorrectly release each of the three partial historical exits.
  for (const balances of [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "1"], ["0", "0", "0"]]) {
    t.mock.method(globalThis, "fetch", async (url: string) => new Response(JSON.stringify(
      url.includes(`ledger_version=${action.version}`) ? balances : ["0", "0", "0"])));
    assert.equal(await aptosWithdrawalCompletesPosition(base, { ...action, kind: "withdraw" }), balances.every(value => value === "0"));
    t.mock.restoreAll();
  }
});

test("pruned state fails closed with no latest-state retry", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("pruned", { status: 410 }); });
  await assert.rejects(aptosWithdrawalCompletesPosition(base, action), /410; use a fullnode retaining/);
  assert.equal(calls, 1);
});

test("rejects missing, negative, rounded-number, and overflowing balances", async (t) => {
  for (const values of [[], ["0", "0"], ["0", "0", "0", "0"], ["0", "-1", "0"], [0, "0", "0"], ["0", "0", "18446744073709551616"]]) {
    assert.throws(() => parseAptosDelegationStake(values), /Invalid Aptos/);
  }
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "missing" })));
  await assert.rejects(aptosViewAtVersion(base, "view", [], 1n), /invalid data/);
  await assert.rejects(aptosViewAtVersion(base, "view", [], -1n), /Invalid Aptos ledger version/);
});
