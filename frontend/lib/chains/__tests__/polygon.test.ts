import { describe, expect, it, vi } from "vitest";
import { mockValidatorShareAbi } from "@/lib/abi";
import { polygonChain } from "@/lib/chains";
import { polygonAdapter } from "@/lib/chains/polygon";
import { validatorsForChain } from "@/lib/validators";
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
}));

vi.mock("@wagmi/core", () => ({
  getPublicClient: vi.fn(),
  readContract: vi.fn(),
  watchContractEvent: vi.fn(),
}));

describe("polygonAdapter", () => {
  it("getValidators returns the static Polygon validator list", async () => {
    await expect(polygonAdapter.getValidators()).resolves.toEqual(
      validatorsForChain("polygon").map((validator) => ({
        address: validator.address,
        name: validator.name,
        apr: validator.apr,
        commission: validator.commission,
        uptime: validator.uptime,
      })),
    );
  });

  it("buildDelegateTx encodes buyVoucher calldata", async () => {
    const validator = validatorsForChain("polygon")[0]!;
    const amount = 123456789n;

    await expect(
      polygonAdapter.buildDelegateTx({
        validator: validator.address,
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

  it("throws VALIDATOR_NOT_FOUND when the validator is unknown", async () => {
    await expect(
      polygonAdapter.buildDelegateTx({
        validator: "0x0000000000000000000000000000000000000000",
        amount: 1n,
        delegator: "0x1111111111111111111111111111111111111111",
      }),
    ).rejects.toMatchObject({
      name: "ChainAdapterError",
      code: "VALIDATOR_NOT_FOUND",
    });
  });
});
