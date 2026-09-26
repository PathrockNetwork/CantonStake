import assert from "node:assert/strict";
import test from "node:test";
import { runAutoCompoundTickIfEnabled } from "../src/services/auto-compound-gate.js";

test("disabled auto-compound does not execute existing queued ticks", async () => {
  let calls = 0;
  await runAutoCompoundTickIfEnabled(true, async () => { calls++; });
  assert.equal(calls, 0);
  await runAutoCompoundTickIfEnabled(false, async () => { calls++; });
  assert.equal(calls, 1);
});
