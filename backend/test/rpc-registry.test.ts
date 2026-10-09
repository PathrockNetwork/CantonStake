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

test("BNB mainnet includes log-capable alternatives without leaking them into testnet", () => {
  assert.deepEqual(rpcDefinitions.bnb.backups, config.networkMode === "mainnet"
    ? ["https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"]
    : ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"]);
  assert.equal(rpcDefinitions.bnb.chainId, config.networkMode === "mainnet" ? "56" : "97");
});
