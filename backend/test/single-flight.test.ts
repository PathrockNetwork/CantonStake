import assert from "node:assert/strict";
import test from "node:test";
import { createSingleFlight } from "../src/services/single-flight.js";

test("concurrent same-chain reads share one fetch and different chains remain independent", async () => {
  const once = createSingleFlight<string, number>();
  let reads = 0;
  const read = async () => ++reads;
  const first = once("monad", read);
  const second = once("monad", read);
  const other = once("bnb", read);
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.deepEqual(await Promise.all([first, second, other]), [1, 1, 2]);
  assert.equal(await once("monad", read), 3);
});

test("failed reads propagate and do not prevent the next attempt", async () => {
  const once = createSingleFlight<string, number>();
  const failing = once("monad", async () => { throw new Error("RPC unavailable"); });
  assert.equal(once("monad", async () => 1), failing);
  await assert.rejects(failing, /RPC unavailable/);
  assert.equal(await once("monad", async () => 2), 2);
});
