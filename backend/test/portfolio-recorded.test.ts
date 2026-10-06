import assert from "node:assert/strict";
import test from "node:test";
import { portfolioUsdTotal, recordedDelegations, validPortfolioAddress } from "../src/services/portfolio-recorded.js";
import type { ActiveContract } from "../src/canton.js";

const wallet = "5GF4poPj97U3JgThX7KHYvSwVbG3SNYWRugHvk8eJoedErFN";
const contracts: ActiveContract[] = [
  { contractId: "one", templateId: "StakingPosition", argument: { evmAddress: wallet, amountPol: "1.25", status: "Bonded" } },
  { contractId: "two", templateId: "StakingPosition", argument: { evmAddress: wallet, amountPol: "2", status: "Unbonding" } },
  { contractId: "three", templateId: "StakingPosition", argument: { evmAddress: wallet, amountPol: "3", status: "Released" } },
];

test("projects case-sensitive wallet positions from Canton with mirror chain metadata", () => {
  const mirrors = [
    { contractId: "one", chain: "polkadot", validatorAddress: null, validatorShare: "pool:224" },
    { contractId: "two", chain: "polkadot", validatorAddress: null, validatorShare: "pool:225" },
  ];
  const testnet = recordedDelegations(contracts, mirrors, wallet, "testnet");
  assert.deepEqual(testnet.rows.map((row) => [row.validator, row.amount, row.symbol, row.status]), [
    ["pool:224", "1.25", "WND", "bonded"], ["pool:225", "2", "WND", "unbonding"],
  ]);
  assert.equal(testnet.unclassifiedPositions, 0);
  assert.equal(recordedDelegations(contracts, mirrors, wallet.toLowerCase(), "testnet").rows.length, 0);
  assert.equal(recordedDelegations(contracts, mirrors, wallet, "mainnet").rows[0]?.symbol, "DOT");
});

test("does not invent a chain when a live Canton position has no mirror", () => {
  const result = recordedDelegations(contracts, [], wallet, "testnet");
  assert.equal(result.rows.length, 0);
  assert.equal(result.unclassifiedPositions, 2);
});

test("does not relabel explicit testnet or unknown metadata as mainnet assets", () => {
  for (const chain of ["polygon-amoy", "polygon-testnet", "polkadot-testnet", "polygon-unknown", "polkadot-amoy"]) {
    const result = recordedDelegations(contracts.slice(0, 1), [
      { contractId: "one", chain, validatorAddress: null, validatorShare: null },
    ], wallet, "mainnet");
    assert.equal(result.rows.length, 0, chain);
    assert.equal(result.unclassifiedPositions, 1, chain);
  }
  const mirror = { contractId: "one", chain: "polkadot-mainnet", validatorAddress: null, validatorShare: null };
  assert.equal(recordedDelegations(contracts.slice(0, 1), [mirror], wallet, "mainnet").rows[0]?.symbol, "DOT");
  assert.equal(recordedDelegations(contracts.slice(0, 1), [mirror], wallet, "testnet").unclassifiedPositions, 1);
});

test("accepts supported native wallet shapes without requiring an EVM address", () => {
  for (const address of [wallet, "ARdcMV5iHw2uWFGZ9GkYyvNaSRJshFCbDxG7C69c1WHa",
    `0x${"1".repeat(40)}`, `0x${"1".repeat(64)}`,
    "cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    "celestia1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    "osmo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"])
    assert.equal(validPortfolioAddress(address), true, address);
  for (const address of ["", "0x1234", "0x" + "g".repeat(64), "not-a-wallet", "../../health"])
    assert.equal(validPortfolioAddress(address), false, address);
});

test("does not assign a mainnet price to testnet or incomplete positions", () => {
  const rows = [{ amount: "1.25", symbol: "SUI" }];
  assert.equal(portfolioUsdTotal(rows, { SUI: 2 }, "mainnet", 0), 2.5);
  assert.equal(portfolioUsdTotal(rows, { SUI: 2 }, "testnet", 0), 2.5);
  assert.equal(portfolioUsdTotal([{ amount: "2", symbol: "WND" }], { DOT: 3 }, "testnet", 0), 6);
  assert.equal(portfolioUsdTotal(rows, { SUI: 2 }, "mainnet", 1), null);
  assert.equal(portfolioUsdTotal(rows, {}, "mainnet", 0), null);
  assert.equal(portfolioUsdTotal([{ amount: "Infinity", symbol: "SUI" }], { SUI: 2 }, "mainnet", 0), null);
});
