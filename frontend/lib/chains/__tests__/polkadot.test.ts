import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ fetchPositions: vi.fn() }));

import { polkadotAdapter } from "../polkadot";
import { polkadotNetwork } from "../../polkadot/network";

describe("Polkadot nomination-pool adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("binds join plans to a live pool and minimum", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
      genesis: polkadotNetwork.genesis, decimals: polkadotNetwork.decimals,
      minJoinPlanck: "100000000000", pools: [{ id: 224, name: "Pool #224", commissionPct: 0 }],
    }) })));
    expect(await polkadotAdapter.buildDelegateTx({ validator: "pool:224", amount: 100_000_000_000n, delegator: "wallet" }))
      .toEqual({ kind: "substrate", method: "nominationPools.join", args: ["100000000000", 224] });
    await expect(polkadotAdapter.buildDelegateTx({ validator: "pool:224", amount: 99n, delegator: "wallet" }))
      .rejects.toThrow("minimum");
  });

  it("rejects wrong-network pool lists and invalid pool keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
      genesis: "0xwrong", decimals: polkadotNetwork.decimals, minJoinPlanck: "1", pools: [],
    }) })));
    await expect(polkadotAdapter.getValidators()).rejects.toThrow("wrong Asset Hub network");
    await expect(polkadotAdapter.buildClaimTx({ validator: "validator:224", delegator: "wallet" }))
      .rejects.toThrow("nomination pool");
  });
});
