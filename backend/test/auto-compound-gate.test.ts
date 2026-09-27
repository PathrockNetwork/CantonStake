import assert from "node:assert/strict";
import test from "node:test";
import { autoCompoundStatus, runAutoCompoundTickIfEnabled } from "../src/services/auto-compound-gate.js";

test("disabled auto-compound does not execute existing queued ticks", async () => {
  let calls = 0;
  await runAutoCompoundTickIfEnabled(true, async () => { calls++; });
  assert.equal(calls, 0);
  await runAutoCompoundTickIfEnabled(false, async () => { calls++; });
  assert.equal(calls, 0, "an operator flag must not activate unverified executors");
});

test("availability distinguishes deployment disablement from missing verified routes", () => {
  assert.deepEqual(autoCompoundStatus(true), {
    status: "disabled", executionEnabled: false, supportedChains: [],
    reason: "Auto-compound is disabled for this deployment.",
  });
  const unavailable = autoCompoundStatus(false);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.executionEnabled, false);
  assert.deepEqual(unavailable.supportedChains, []);
  assert.match(unavailable.reason!, /authorization and lifecycle validation/);
});
