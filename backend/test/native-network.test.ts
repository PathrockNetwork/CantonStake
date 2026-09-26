import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../src/config.js";
import { assertAptosChainId, assertCosmosRpcNetwork, assertSuiChainIdentifier, assertSuiGraphqlNetwork } from "../src/services/native-network.js";

test("validator catalogs reject Aptos and Sui data from the other mode", () => {
  assert.doesNotThrow(() => assertAptosChainId(config.networkMode === "mainnet" ? 1 : 2));
  assert.throws(() => assertAptosChainId(config.networkMode === "mainnet" ? 2 : 1), /expected/);
  const sui = config.networkMode === "mainnet"
    ? "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S"
    : "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD";
  assert.doesNotThrow(() => assertSuiChainIdentifier(sui));
  assert.throws(() => assertSuiChainIdentifier("wrong-chain"), /expected/);
});

test("Cosmos intent preflight requires the selected chain and a synced RPC", async () => {
  const original = globalThis.fetch;
  const expected = config.networkMode === "mainnet" ? "cosmoshub-4" : "provider";
  try {
    globalThis.fetch = async () => Response.json({ result: {
      node_info: { network: expected }, sync_info: { catching_up: false },
    } });
    await assertCosmosRpcNetwork("cosmos");

    globalThis.fetch = async () => Response.json({ result: {
      node_info: { network: "wrong-chain" }, sync_info: { catching_up: false },
    } });
    await assert.rejects(assertCosmosRpcNetwork("cosmos"), /expected/);

    globalThis.fetch = async () => Response.json({ result: {
      node_info: { network: expected }, sync_info: { catching_up: true },
    } });
    await assert.rejects(assertCosmosRpcNetwork("cosmos"), /catching up/);
  } finally {
    globalThis.fetch = original;
  }
});

test("Sui intent preflight requires the selected GraphQL chain", async () => {
  const original = globalThis.fetch;
  const expected = config.networkMode === "mainnet"
    ? "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S"
    : "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD";
  try {
    globalThis.fetch = async (_url, options) => {
      assert.match(String(options?.body), /chainIdentifier/);
      return Response.json({ data: { chainIdentifier: expected } });
    };
    await assertSuiGraphqlNetwork();

    globalThis.fetch = async () => Response.json({ data: { chainIdentifier: "wrong-chain" } });
    await assert.rejects(assertSuiGraphqlNetwork(), /expected/);
  } finally {
    globalThis.fetch = original;
  }
});
