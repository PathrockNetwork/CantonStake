import assert from "node:assert/strict";
import test from "node:test";
import { assertEvmRpcChainId, assertPolygonSettlementMode } from "../src/services/evm-network.js";

test("Polygon settlement cannot cross the deployment mode boundary", () => {
  assert.doesNotThrow(() => assertPolygonSettlementMode("testnet", 11155111));
  assert.doesNotThrow(() => assertPolygonSettlementMode("mainnet", 1));
  assert.throws(() => assertPolygonSettlementMode("testnet", 1), /must use chain 11155111/);
  assert.throws(() => assertPolygonSettlementMode("mainnet", 11155111), /must use chain 1/);
  assert.throws(() => assertPolygonSettlementMode("testnet", 80002), /must use chain 11155111/);
  assert.throws(() => assertPolygonSettlementMode("testnet", NaN), /must use chain 11155111/);
});

test("accepts only the RPC chain configured for this deployment mode", async () => {
  await assert.doesNotReject(assertEvmRpcChainId({ getChainId: async () => 143 }, 143, "Monad"));
  await assert.rejects(assertEvmRpcChainId({ getChainId: async () => 10143 }, 143, "Monad"), /chain 10143; expected 143/);
  await assert.rejects(assertEvmRpcChainId({ getChainId: async () => NaN }, 56, "BNB"), /expected 56/);
});
