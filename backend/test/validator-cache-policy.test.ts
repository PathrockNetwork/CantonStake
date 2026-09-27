import assert from "node:assert/strict";
import test from "node:test";
import { expiredEmptyValidatorCatalog, validatorCacheTtlSeconds } from "../src/services/validator-cache-policy.js";

test("empty validator catalogs retry quickly without extending a shorter configured TTL", () => {
  assert.equal(validatorCacheTtlSeconds(0, 3600), 30);
  assert.equal(validatorCacheTtlSeconds(0, 10), 10);
  assert.equal(validatorCacheTtlSeconds(2, 3600), 3600);
});

test("old empty catalogs cannot mask recovery until the old hourly TTL expires", () => {
  const now = Date.parse("2026-09-27T00:00:00Z");
  const snapshot = (age: number) => ({ validators: [], fetchedAt: new Date(now - age).toISOString() });
  assert.equal(expiredEmptyValidatorCatalog(snapshot(29_999), now), false);
  assert.equal(expiredEmptyValidatorCatalog(snapshot(30_000), now), true);
  assert.equal(expiredEmptyValidatorCatalog(snapshot(60_000), now), true);
  assert.equal(expiredEmptyValidatorCatalog(snapshot(-1), now), true);
  assert.equal(expiredEmptyValidatorCatalog({ validators: [], fetchedAt: "invalid" }, now), true);
  assert.equal(expiredEmptyValidatorCatalog({ ...snapshot(60_000), validators: [{}] }, now), false);
});
