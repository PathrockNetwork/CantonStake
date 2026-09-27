import assert from "node:assert/strict";
import test from "node:test";
import { mapInBatches } from "../src/services/batched-map.js";

test("batched reads bound concurrency and preserve values and original indices", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapInBatches(Array.from({ length: 11 }, (_, i) => i + 10), 4, async (value, index) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return { value, index };
  });
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(result, Array.from({ length: 11 }, (_, index) => ({ value: index + 10, index })));
});

test("failed reads reject without starting later batches", async () => {
  const started: number[] = [];
  await assert.rejects(mapInBatches([1, 2, 3, 4], 2, async (value) => {
    started.push(value);
    if (value === 1) throw new Error("RPC unavailable");
    return value;
  }), /RPC unavailable/);
  assert.deepEqual(started, [1, 2]);
});

test("empty batches make no reads and invalid concurrency is rejected", async () => {
  const map = async () => { throw new Error("must not run"); };
  assert.deepEqual(await mapInBatches([], 4, map), []);
  for (const size of [0, -1, 0.5, Infinity, NaN]) {
    await assert.rejects(mapInBatches([], size, map), /positive integer/);
  }
});

test("pacing happens only between completed batches", async () => {
  const events: string[] = [];
  await mapInBatches([1, 2, 3, 4, 5], 2, async (value) => {
    events.push(`read:${value}`);
    return value;
  }, async () => { events.push("pause"); });
  assert.deepEqual(events, ["read:1", "read:2", "pause", "read:3", "read:4", "pause", "read:5"]);
});
