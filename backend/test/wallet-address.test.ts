import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeWalletAddress, sameWalletAddress } from "../src/services/wallet-address.js";

test("preserves case-sensitive Polkadot SS58 and Solana base58 addresses", () => {
  const polkadot = "5GF4poPj97U3JgThX7KHYvSwVbG3SNYWRugHvk8eJoedErFN";
  const solana = "ARdcMV5iHw2uWFGZ9GkYyvNaSRJshFCbDxG7C69c1WHa";
  assert.equal(normalizeWalletAddress(polkadot), polkadot);
  assert.equal(normalizeWalletAddress(solana), solana);
  assert.equal(sameWalletAddress(polkadot, polkadot.toLowerCase()), false);
});

test("normalizes EVM and bech32 addresses for legacy lookups", () => {
  assert.equal(normalizeWalletAddress("0xAbCd"), "0xabcd");
  assert.equal(normalizeWalletAddress("COSMOS1ABC"), "cosmos1abc");
});
