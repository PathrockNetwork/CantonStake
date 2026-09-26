import assert from "node:assert/strict";
import test from "node:test";
import { watcherChainsForLifecycle, watcherGateError, withWatcherFreshness, WATCHER_MAX_AGE_MS } from "../src/services/watcher-gate.js";

test("staking opens only after that chain's watcher reports a successful scan", () => {
  assert.equal(watcherGateError("monad", [{ chain: "monad", status: "ok", lastSuccessAt: new Date().toISOString() }]), null);
  assert.match(watcherGateError("monad", []) ?? "", /successful scan/);
  assert.match(watcherGateError("monad", [{ chain: "bnb", status: "ok" }]) ?? "", /successful scan/);
  assert.match(watcherGateError("monad", [{ chain: "monad", status: "unknown" }]) ?? "", /successful scan/);
  assert.match(watcherGateError("monad", [{ chain: "monad", status: "unreachable", lastError: "RPC timeout" }]) ?? "", /RPC timeout/);
});

test("stale watcher health closes staking even if the last result was ok", () => {
  const now = Date.parse("2026-09-26T00:00:00.000Z");
  const fresh = { chain: "cosmos", status: "ok" as const, lastSuccessAt: new Date(now - WATCHER_MAX_AGE_MS + 1).toISOString(), lastError: null };
  assert.equal(withWatcherFreshness(fresh, now).status, "ok");
  const stale = { ...fresh, lastSuccessAt: new Date(now - WATCHER_MAX_AGE_MS - 1).toISOString() };
  assert.equal(withWatcherFreshness(stale, now).status, "unreachable");
  assert.match(withWatcherFreshness(stale, now).lastError ?? "", /recent scan/);
  assert.equal(withWatcherFreshness({ ...fresh, lastSuccessAt: null }, now).status, "unreachable");
  assert.match(watcherGateError("cosmos", [{ chain: "cosmos", status: "ok", lastSuccessAt: "2020-01-01T00:00:00.000Z" }]) ?? "", /recent scan/);
});

test("walled chains retain watchers while requests or positions remain active", () => {
  const required = watcherChainsForLifecycle(
    ["polygon"],
    ["celestia"],
    ["osmosis", "polkadot-westend", "bnb"],
  );
  assert.deepEqual([...required].sort(), ["bnb", "celestia", "osmosis", "polkadot", "polygon"]);
  assert.equal(required.has("sui"), false);
});
