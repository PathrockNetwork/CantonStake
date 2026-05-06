import { describe, expect, it, vi } from "vitest";
import { mockValidatorShareAbi } from "@/lib/abi";
import { polygonChain } from "@/lib/chains";
import { polygonAdapter } from "@/lib/chains/polygon";
import { encodeFunctionData } from "@/lib/viem-encode-function-data";

vi.mock("@/lib/wagmi", () => ({
  wagmiConfig: {},
}));

vi.mock("@/lib/chains", () => ({
  polygonChain: () => ({
    id: "polygon",
    validatorContract: "0x2222222222222222222222222222222222222222",
    wagmiChain: { id: 80002 },
  }),
  isRealValidatorShare: false,
  resolveValidatorShare: () =>
    "0x2222222222222222222222222222222222222222" as `0x${string}`,
}));

vi.mock("@/lib/validators-live", () => ({
  fetchScoredValidators: vi.fn().mockResolvedValue({
    rows: [
      {
        address: "0x5a10000000000000000000000000000000000001",
        name: "Stakefish",
        apr: 7.8,
        uptime: 99.95,
        commission: 5,
        recommended: true,
      },
    ],
    source: "live",
  }),
}));

vi.mock("@wagmi/core", () => ({
  getPublicClient: vi.fn(),
  readContract: vi.fn(),
  watchContractEvent: vi.fn(),
}));

describe("polygonAdapter", () => {
  it("getValidators returns the live-fetched Polygon validator list", async () => {
    await expect(polygonAdapter.getValidators()).resolves.toEqual([
      {
        address: "0x5a10000000000000000000000000000000000001",
        name: "Stakefish",
        apr: 7.8,
        commission: 5,
        uptime: 99.95,
      },
    ]);
  });

  it("buildDelegateTx encodes buyVoucher calldata", async () => {
    const amount = 123456789n;

    await expect(
      polygonAdapter.buildDelegateTx({
        validator: "0x5a10000000000000000000000000000000000001",
        amount,
        delegator: "0x1111111111111111111111111111111111111111",
      }),
    ).resolves.toEqual({
      kind: "evm",
      to: polygonChain().validatorContract!,
      data: encodeFunctionData({
        abi: mockValidatorShareAbi,
        functionName: "buyVoucher",
        args: [amount, amount],
      }),
      value: amount,
    });
  });

  it("throws VALIDATOR_NOT_FOUND when the validator address is malformed", async () => {
    await expect(
      polygonAdapter.buildDelegateTx({
        validator: "not-an-address",
        amount: 1n,
        delegator: "0x1111111111111111111111111111111111111111",
      }),
    ).rejects.toMatchObject({
      name: "ChainAdapterError",
      code: "VALIDATOR_NOT_FOUND",
    });
  });
});
