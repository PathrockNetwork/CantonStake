import assert from "node:assert/strict";
import test from "node:test";
import { matchesUnbondProofForRecovery } from "../src/services/lifecycle-recovery.js";

test("unbond recovery binds to the observed unbond transaction", () => {
  assert.equal(matchesUnbondProofForRecovery("Bonded", "new-unbond", "stake", "new-unbond"), true);
  assert.equal(matchesUnbondProofForRecovery("Bonded", "new-unbond", "stake", "old-unbond"), false);
});

test("release recovery binds to this mirror's unbond, not an older released position", () => {
  assert.equal(matchesUnbondProofForRecovery("Unbonding", "withdraw", "new-unbond", "new-unbond"), true);
  assert.equal(matchesUnbondProofForRecovery("Unbonding", "withdraw", "new-unbond", "old-unbond"), false);
  assert.equal(matchesUnbondProofForRecovery("Unbonding", "withdraw", null, "old-unbond"), false);
});
