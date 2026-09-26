import assert from "node:assert/strict";
import test from "node:test";
import { toBech32 } from "@cosmjs/encoding";
import { nativeStakeInputError } from "../src/services/native-staking-input.js";

test("Cosmos-family requests need checksummed wallet/operator addresses and base-unit precision", () => {
  const bytes = new Uint8Array(20).fill(7);
  for (const [chain, prefix] of [
    ["cosmos", "cosmos"], ["celestia", "celestia"], ["osmosis", "osmo"],
  ] as const) {
    const wallet = toBech32(prefix, bytes);
    const validator = toBech32(`${prefix}valoper`, bytes);
    assert.equal(nativeStakeInputError(chain, wallet, validator, "1.123456"), null);
    assert.match(nativeStakeInputError(chain, wallet, validator, "1.1234567") ?? "", /6 decimal/);
    assert.match(nativeStakeInputError(chain, wallet, wallet, "1") ?? "", /validator/);
    assert.match(nativeStakeInputError(chain, `${wallet.slice(0, -1)}x`, validator, "1") ?? "", /wallet/);
  }
});

test("Sui requests need full native addresses and MIST precision", () => {
  const wallet = `0x${"a".repeat(64)}`;
  const validator = `0x${"b".repeat(64)}`;
  assert.equal(nativeStakeInputError("sui", wallet, validator, "1.123456789"), null);
  assert.match(nativeStakeInputError("sui", wallet, validator, "1.1234567891") ?? "", /9 decimal/);
  assert.match(nativeStakeInputError("sui", "0x1", validator, "1") ?? "", /32-byte/);
  assert.match(nativeStakeInputError("sui", wallet, undefined, "1") ?? "", /validator/);
});
