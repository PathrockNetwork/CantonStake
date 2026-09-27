import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodePolkadotPoolAction, isPolkadotLifecycleEvent, type PolkadotPoolExtrinsic } from "../src/services/polkadot-staking.js";

const wallet = "5GF4poPj97U3JgThX7KHYvSwVbG3SNYWRugHvk8eJoedErFN";
const binding = { wallet, poolId: 224, amountPlanck: 100_000_000_000n };
const at = new Date("2026-09-26T00:00:00Z");
const base: PolkadotPoolExtrinsic = {
  hash: `0x${"a".repeat(64)}`, signer: wallet, section: "nominationPools", method: "join", success: true,
  events: [{ section: "nominationPools", method: "Bonded", data: [wallet, "224", "100000000000", "true"] }],
};

test("lifecycle filtering excludes reward compounds, not joins or exits", () => {
  const bonded = base.events[0]!;
  assert.equal(isPolkadotLifecycleEvent(bonded), true);
  assert.equal(isPolkadotLifecycleEvent({ ...bonded, data: [wallet, "224", "100", "false"] }), false);
  assert.equal(isPolkadotLifecycleEvent({ ...bonded, data: [wallet, "224", "100"] }), false);
  assert.equal(isPolkadotLifecycleEvent({ ...bonded, method: "PaidOut" }), false);
  assert.equal(isPolkadotLifecycleEvent({ ...bonded, section: "balances" }), false);
  assert.equal(isPolkadotLifecycleEvent({ ...bonded, method: "Unbonded" }), true);
  assert.equal(isPolkadotLifecycleEvent({ ...bonded, method: "Withdrawn" }), true);
});

test("accepts only an exact wallet/pool/amount join", () => {
  assert.equal(decodePolkadotPoolAction(base, binding, 123, at)?.kind, "join");
  assert.equal(decodePolkadotPoolAction({ ...base, signer: null }, binding, 123, at), null);
  assert.equal(decodePolkadotPoolAction({ ...base, events: [{ ...base.events[0]!, data: [wallet, "225", "100000000000", "true"] }] }, binding, 123, at), null);
  assert.equal(decodePolkadotPoolAction({ ...base, events: [{ ...base.events[0]!, data: [wallet, "224", "100000000001", "true"] }] }, binding, 123, at), null);
  assert.equal(decodePolkadotPoolAction({ ...base, success: false }, binding, 123, at), null);
});

test("unbond and full withdrawal require matching pallet events", () => {
  const unbond: PolkadotPoolExtrinsic = { ...base, method: "unbond", events: [
    { section: "nominationPools", method: "Unbonded", data: [wallet, "224", "100000000000", "100000000000", "900"] },
  ] };
  assert.equal(decodePolkadotPoolAction(unbond, binding, 124, at)?.kind, "unbond");
  const withdraw: PolkadotPoolExtrinsic = { ...base, method: "withdrawUnbonded", events: [
    { section: "nominationPools", method: "Withdrawn", data: [wallet, "224", "99000000000", "100000000000"] },
    { section: "nominationPools", method: "MemberRemoved", data: ["224", wallet, "99000000000"] },
  ] };
  assert.equal(decodePolkadotPoolAction(withdraw, binding, 125, at)?.kind, "withdraw");
  assert.equal(decodePolkadotPoolAction({ ...withdraw, events: withdraw.events.slice(0, 1) }, binding, 125, at), null);
});
