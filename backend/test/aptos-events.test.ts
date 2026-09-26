import assert from "node:assert/strict";
import test from "node:test";
import { canonicalAptosAddress, decodeAptosDelegationActions, type AptosAccountTransaction } from "../src/services/aptos-events.js";

const sender = `0x${"a".repeat(64)}`;
const pool = `0x${"b".repeat(64)}`;

function tx(kind: "add_stake" | "unlock" | "withdraw", event: "AddStake" | "UnlockStake" | "WithdrawStake"): AptosAccountTransaction {
  const field = kind === "add_stake" ? "amount_added" : kind === "unlock" ? "amount_unlocked" : "amount_withdrawn";
  return { type: "user_transaction", version: "11410906013", sequence_number: "12", hash: "0xhash",
    sender, success: true, timestamp: "1790362518562665",
    payload: { type: "entry_function_payload", function: `0x1::delegation_pool::${kind}`, arguments: [pool, "100000000"] },
    events: [{ type: `0x1::delegation_pool::${event}`, data: { pool_address: pool, delegator_address: sender, [field]: "100000000" } }],
  };
}

test("decodes native delegation-pool stake, unlock, and withdraw events", () => {
  for (const [fn, event, kind] of [
    ["add_stake", "AddStake", "stake"],
    ["unlock", "UnlockStake", "unlock"],
    ["withdraw", "WithdrawStake", "withdraw"],
  ] as const) {
    const actions = decodeAptosDelegationActions(tx(fn, event));
    assert.equal(actions.length, 1);
    assert.equal(actions[0]?.kind, kind);
    assert.equal(actions[0]?.pool, pool);
    assert.equal(actions[0]?.delegator, sender);
    assert.equal(actions[0]?.amountOcta, 100000000n);
  }
});

test("rejects failed, unrelated, and forged-pool transactions", () => {
  const stake = tx("add_stake", "AddStake");
  assert.deepEqual(decodeAptosDelegationActions({ ...stake, success: false }), []);
  assert.deepEqual(decodeAptosDelegationActions({ ...stake, payload: { ...stake.payload, function: "0x1::stake::add_stake" } }), []);
  assert.deepEqual(decodeAptosDelegationActions({ ...stake, events: [{ ...stake.events![0], data: { ...stake.events![0]!.data, pool_address: sender } }] }), []);
  assert.deepEqual(decodeAptosDelegationActions({ ...stake, events: [{ ...stake.events![0], data: { ...stake.events![0]!.data, amount_added: "999" } }] }), []);
  assert.deepEqual(decodeAptosDelegationActions({ ...stake, sender: pool }), []);
});

test("normalizes short Aptos addresses without confusing distinct accounts", () => {
  assert.equal(canonicalAptosAddress("0x1"), `0x${"0".repeat(63)}1`);
  assert.equal(canonicalAptosAddress("0X1"), `0x${"0".repeat(63)}1`);
  assert.equal(canonicalAptosAddress("not-an-address"), null);
});

test("full-share withdrawals bind the actual amount, not the max-u64 request sentinel", () => {
  const withdrawal = tx("withdraw", "WithdrawStake");
  withdrawal.payload!.arguments = [pool, "18446744073709551615"];
  const [action] = decodeAptosDelegationActions(withdrawal);
  assert.equal(action?.kind, "withdraw");
  assert.equal(action?.requestedOcta, (1n << 64n) - 1n);
  assert.equal(action?.amountOcta, 100_000_000n);
});
