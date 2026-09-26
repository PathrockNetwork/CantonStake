import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchValidatorScores = vi.fn();
vi.mock("@/lib/api", () => ({ fetchValidatorScores: (...args: unknown[]) => fetchValidatorScores(...args) }));

const { cosmosAdapter, celestiaAdapter, osmosisAdapter } = await import("@/lib/chains/cosmos");
const { cosmosNetworks } = await import("@/lib/cosmos/networks");

beforeEach(() => {
  fetchValidatorScores.mockReset().mockResolvedValue({ validators: [{
    address: "osmovaloper1validator", name: "Validator", commissionPct: 5, uptimePct: 99,
  }] });
});

describe("Cosmos-family adapters", () => {
  it.each([
    ["cosmos", cosmosAdapter, "uatom"],
    ["celestia", celestiaAdapter, "utia"],
    ["osmosis", osmosisAdapter, "uosmo"],
  ] as const)("builds %s staking messages with its own bond denom", async (chain, adapter, denom) => {
    expect(adapter.chainId).toBe(chain);
    const args = { validator: "valoper1validator", delegator: "delegator1wallet", amount: 1_000_000n };
    const delegate = await adapter.buildDelegateTx(args);
    const undelegate = await adapter.buildUndelegateTx(args);
    expect(delegate).toMatchObject({ kind: "cosmos", value: { amount: { denom, amount: "1000000" } } });
    expect(undelegate).toMatchObject({ kind: "cosmos", value: { amount: { denom, amount: "1000000" } } });
    const validators = await adapter.getValidators();
    const baseApy = { cosmos: 21, celestia: 10, osmosis: 12 }[chain];
    expect(validators[0]?.apr).toBeCloseTo(baseApy * 0.95);
    expect(fetchValidatorScores).toHaveBeenCalledWith(chain);
  });

  it("keeps each mode's chain IDs and wallet prefixes distinct", () => {
    const mainnet = process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet";
    expect(cosmosNetworks.celestia).toMatchObject({ chainId: mainnet ? "celestia" : "mocha-5", prefix: "celestia", denom: "utia" });
    expect(cosmosNetworks.osmosis).toMatchObject({ chainId: mainnet ? "osmosis-1" : "osmo-test-5", prefix: "osmo", denom: "uosmo" });
  });
});
