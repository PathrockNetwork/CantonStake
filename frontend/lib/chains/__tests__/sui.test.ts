import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ fetchValidatorScores: vi.fn() }));

const { suiAdapter, suiUnbondingSeconds } = await import("@/lib/chains/sui");
const { suiNetwork } = await import("@/lib/sui/network");

afterEach(() => vi.unstubAllGlobals());

describe("Sui GraphQL staking adapter", () => {
  it("paginates owned StakedSui receipts and distinguishes active from pending", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {
        chainIdentifier: suiNetwork.identifier,
        epoch: { epochId: 15 },
        address: { objects: { nodes: [{ contents: { json: {
          pool_id: "0xpool1", principal: "1000000000", stake_activation_epoch: "14",
        } } }], pageInfo: { hasNextPage: true, endCursor: "next" } } },
      } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {
        chainIdentifier: suiNetwork.identifier,
        epoch: { epochId: 15 },
        address: { objects: { nodes: [{ contents: { json: {
          pool_id: "0xpool2", principal: "2000000000", stake_activation_epoch: "16",
        } } }], pageInfo: { hasNextPage: false, endCursor: null } } },
      } }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await suiAdapter.getDelegations("0xowner")).toEqual([
      { validator: "0xpool1", amount: 1_000_000_000n, status: "bonded" },
      { validator: "0xpool2", amount: 2_000_000_000n, status: "pending" },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).variables.after).toBe("next");
  });

  it("rejects owned stake receipts from a GraphQL endpoint on another network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: {
      chainIdentifier: "wrong-network",
      epoch: { epochId: 15 },
      address: { objects: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    } }) })));
    await expect(suiAdapter.getDelegations("0xowner")).rejects.toThrow(/does not match/);
  });

  it("does not fabricate a second Sui claim or amount-only unstake transaction", async () => {
    expect(suiUnbondingSeconds).toBe(0);
    await expect(suiAdapter.buildUndelegateTx({ validator: "0xpool", amount: 1n, delegator: "0xowner" }))
      .rejects.toThrow(/receipt ID/);
    await expect(suiAdapter.buildClaimTx({ validator: "0xpool", delegator: "0xowner" }))
      .rejects.toThrow(/no second claim/);
  });
});
