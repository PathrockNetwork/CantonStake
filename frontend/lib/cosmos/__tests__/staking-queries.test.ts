import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  disconnect: vi.fn(),
  delegations: vi.fn(),
  unbondings: vi.fn(),
  balance: vi.fn(),
  connectComet: vi.fn(),
}));

vi.mock("@cosmjs/tendermint-rpc", () => ({ connectComet: mocks.connectComet }));
vi.mock("@cosmjs/stargate", () => ({
  setupStakingExtension: vi.fn(),
  setupBankExtension: vi.fn(),
  QueryClient: { withExtensions: vi.fn(() => ({ bank: { balance: mocks.balance }, staking: {
    delegatorDelegations: mocks.delegations,
    delegatorUnbondingDelegations: mocks.unbondings,
  } })) },
}));

const { collectCosmosPages, readCosmosBalance, readCosmosPositions } = await import("../staking-queries");
const { cosmosNetworks } = await import("../networks");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectComet.mockResolvedValue({ status: mocks.status, disconnect: mocks.disconnect });
  mocks.status.mockResolvedValue({
    nodeInfo: { network: cosmosNetworks.cosmos.chainId },
    syncInfo: { catchingUp: false },
  });
  mocks.delegations.mockResolvedValue({ delegationResponses: [], pagination: { nextKey: new Uint8Array() } });
  mocks.unbondings.mockResolvedValue({ unbondingResponses: [], pagination: { nextKey: new Uint8Array() } });
  mocks.balance.mockResolvedValue({ denom: "uatom", amount: "1200000" });
});

describe("Cosmos staking RPC reads", () => {
  it("rejects a wrong-network RPC before querying positions", async () => {
    mocks.status.mockResolvedValue({ nodeInfo: { network: "wrong-chain" }, syncInfo: { catchingUp: false } });
    await expect(readCosmosPositions(cosmosNetworks.cosmos, "cosmos1wallet")).rejects.toThrow(/expected/);
    expect(mocks.delegations).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects a syncing RPC before reading balances", async () => {
    mocks.status.mockResolvedValue({
      nodeInfo: { network: cosmosNetworks.cosmos.chainId },
      syncInfo: { catchingUp: true },
    });
    await expect(readCosmosBalance(cosmosNetworks.cosmos, "cosmos1wallet")).rejects.toThrow(/catching up/);
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("decodes bonded and unbonding positions from the selected RPC", async () => {
    mocks.delegations.mockResolvedValue({ delegationResponses: [{
      delegation: { validatorAddress: "cosmosvaloper1validator" },
      balance: { denom: "uatom", amount: "1200000" },
    }], pagination: { nextKey: new Uint8Array() } });
    mocks.unbondings.mockResolvedValue({ unbondingResponses: [{
      validatorAddress: "cosmosvaloper1validator",
      entries: [{ balance: "300000", completionTime: { seconds: 1_800_000_000n } }],
    }], pagination: { nextKey: new Uint8Array() } });
    expect(await readCosmosPositions(cosmosNetworks.cosmos, "cosmos1wallet")).toEqual([
      { validator: "cosmosvaloper1validator", amount: 1_200_000n, status: "bonded" },
      { validator: "cosmosvaloper1validator", amount: 300_000n, status: "unbonding", unbondingReadyAt: 1_800_000_000 },
    ]);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it("reads balances only from the selected chain and bond denom", async () => {
    expect(await readCosmosBalance(cosmosNetworks.cosmos, "cosmos1wallet")).toBe(1_200_000n);
    expect(mocks.balance).toHaveBeenCalledWith("cosmos1wallet", "uatom");
    mocks.balance.mockResolvedValue({ denom: "wrong", amount: "1200000" });
    await expect(readCosmosBalance(cosmosNetworks.cosmos, "cosmos1wallet")).rejects.toThrow(/denom mismatch/);
    expect(mocks.disconnect).toHaveBeenCalledTimes(2);
  });

  it("follows all pages and rejects repeated cursors", async () => {
    const rows = await collectCosmosPages(async (key) => key
      ? { rows: ["second"], nextKey: new Uint8Array() }
      : { rows: ["first"], nextKey: Uint8Array.of(1) });
    expect(rows).toEqual(["first", "second"]);
    await expect(collectCosmosPages(async () => ({ rows: [], nextKey: Uint8Array.of(1) })))
      .rejects.toThrow(/pagination stalled/);
  });
});
