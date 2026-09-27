import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../src/config.js";
import { rpcDefinitions } from "../src/services/rpc-registry.js";

test("Celestia mainnet prefers historical-result providers without changing testnet routes", () => {
  const mainnet = config.networkMode === "mainnet";
  assert.equal(rpcDefinitions.celestia.chainId, mainnet ? "celestia" : "mocha-5");
  assert.equal(rpcDefinitions.celestia.primary, config.celestiaRpcUrl);
  if (!process.env.CELESTIA_RPC_URL) {
    assert.equal(rpcDefinitions.celestia.primary, mainnet
      ? "https://celestia.rpc.kjnodes.com" : "https://rpc-mocha.pops.one");
  }
  assert.deepEqual(rpcDefinitions.celestia.backups, mainnet
    ? ["https://celestia-mainnet-rpc.itrocket.net", "https://celestia-rpc.publicnode.com"]
    : ["https://rpc-1.testnet.celestia.nodes.guru", "https://celestia-testnet-rpc.itrocket.net"]);
});
