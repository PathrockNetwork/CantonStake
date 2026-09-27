import assert from "node:assert/strict";
import test from "node:test";
import type { Validator } from "cosmjs-types/cosmos/staking/v1beta1/staking";
import { collectBondedValidators, cosmosCommissionPercent } from "../src/services/cosmos-validator-catalog.js";
import { assertCosmosChainIdentity } from "../src/services/native-network.js";
import { config } from "../src/config.js";

test("Cosmos protobuf commissions decode 18-decimal atomics into percentages", () => {
  for (const [raw, pct] of [
    ["0", 0], ["1", 1e-16], ["50000000000000000", 5],
    ["100000000000000000", 10], ["200000000000000000", 20],
    ["123456789000000000", 12.3456789], ["1000000000000000000", 100],
  ] as const) {
    assert.equal(cosmosCommissionPercent(raw), pct);
    const netApr = 21 * (1 - cosmosCommissionPercent(raw) / 100);
    assert.ok(netApr >= 0 && netApr <= 21);
  }
});

test("Cosmos protobuf commission rejects missing, REST-formatted, and invalid rates", () => {
  for (const raw of [undefined, "", "0.05", "-1", "NaN", "Infinity", "1e17", " 0", "1000000000000000001"]) {
    assert.throws(() => cosmosCommissionPercent(raw), /commission/i);
  }
});

test("Cosmos-family catalogs reject validators from the other network mode", () => {
  const ids = config.networkMode === "mainnet"
    ? { cosmos: "cosmoshub-4", celestia: "celestia", osmosis: "osmosis-1" }
    : { cosmos: "provider", celestia: "mocha-5", osmosis: "osmo-test-5" };
  for (const [chain, id] of Object.entries(ids)) {
    const name = chain as keyof typeof ids;
    assert.doesNotThrow(() => assertCosmosChainIdentity(name, id, false));
    assert.throws(() => assertCosmosChainIdentity(name, "wrong-chain", false), /expected/);
    assert.throws(() => assertCosmosChainIdentity(name, id, true), /catching up/);
  }
});

test("Cosmos validator catalog follows all pages", async () => {
  const keys: Array<Uint8Array | undefined> = [];
  const rows = await collectBondedValidators(async (key) => {
    keys.push(key);
    return key
      ? { validators: [{ operatorAddress: "second" } as Validator], pagination: { nextKey: new Uint8Array(), total: 0n } }
      : { validators: [{ operatorAddress: "first" } as Validator], pagination: { nextKey: Uint8Array.of(1), total: 0n } };
  });
  assert.deepEqual(rows.map((v) => v.operatorAddress), ["first", "second"]);
  assert.deepEqual(keys.map((key) => key?.[0]), [undefined, 1]);
});

test("Cosmos validator catalog fails closed on a repeated cursor", async () => {
  await assert.rejects(
    collectBondedValidators(async () => ({ validators: [], pagination: { nextKey: Uint8Array.of(1), total: 0n } })),
    /pagination stalled/,
  );
});
