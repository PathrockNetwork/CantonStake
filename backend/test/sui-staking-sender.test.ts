import assert from "node:assert/strict";
import test from "node:test";
import { verifiedSuiStakingSender } from "../src/services/sui-staking-sender.js";

test("accepts an event signer or transaction signer only when it matches the staker", () => {
  assert.equal(verifiedSuiStakingSender("0xAbC", "0xabc", "0xABC"), "0xabc");
  assert.equal(verifiedSuiStakingSender("0xAbC", null, "0xabc"), "0xabc");
  assert.equal(verifiedSuiStakingSender("0xAbC", "0xabc", null), "0xabc");
});

test("system transactions with no signer are not wallet staking proofs", () => {
  assert.equal(verifiedSuiStakingSender("0xabc", null, null), null);
  assert.throws(() => verifiedSuiStakingSender("0xabc", "0xdef", "0xdef"), /does not match/);
  assert.throws(() => verifiedSuiStakingSender("0xabc", "0xabc", "0xdef"), /disagree/);
});
