import assert from "node:assert/strict";
import test from "node:test";
import { collectMonadValidatorIds } from "../src/services/monad-staking.js";

test("Monad validator catalog follows every page", async () => {
  const starts: number[] = [];
  const ids = await collectMonadValidatorIds(async (start) => {
    starts.push(start);
    return start === 0 ? [false, 2, [3n, 4n]] : [true, 2, [7n]];
  });
  assert.deepEqual(starts, [0, 2]);
  assert.deepEqual(ids, [3n, 4n, 7n]);
});

test("Monad validator catalog rejects a stalled cursor", async () => {
  await assert.rejects(
    collectMonadValidatorIds(async () => [false, 0, [3n]]),
    /pagination did not advance/,
  );
});

test("Monad validator catalog rejects an incomplete page cap", async () => {
  let pages = 0;
  await assert.rejects(
    collectMonadValidatorIds(async (start) => {
      pages++;
      return [false, start + 1, [BigInt(start + 1)]];
    }),
    /exceeded 20 pages/,
  );
  assert.equal(pages, 20);
});
