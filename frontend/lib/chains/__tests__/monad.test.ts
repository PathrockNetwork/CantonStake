import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

const DELEGATOR = "0x1111111111111111111111111111111111111111";
const readContract = vi.fn();
const fetchValidatorScores = vi.fn();
vi.mock("@wagmi/core", () => ({ readContract: (...args: unknown[]) => readContract(...args) }));
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/chains", () => ({ monadEvmChain: { id: 10143 } }));
vi.mock("@/lib/api", () => ({ fetchValidatorScores: (...args: unknown[]) => fetchValidatorScores(...args) }));

const { monadAdapter } = await import("@/lib/chains/monad");
const abi = parseAbi([
  "function delegate(uint64 validatorId) payable",
  "function undelegate(uint64 validatorId, uint256 amount, uint8 withdrawId)",
  "function withdraw(uint64 validatorId, uint8 withdrawId)",
]);

beforeEach(() => {
  fetchValidatorScores.mockReset().mockResolvedValue({ validators: [
    { address: "17", name: "Monad Validator #17", commissionPct: 5, uptimePct: 99, jailed: false },
    { address: "0x1234", name: "Wrong identifier", commissionPct: 5, uptimePct: 99, jailed: false },
  ] });
  readContract.mockReset().mockImplementation((_config: unknown, args: { functionName: string }) => {
    if (args.functionName === "getDelegations") return Promise.resolve([true, 0n, [17n]]);
    if (args.functionName === "getDelegator") return Promise.resolve([1000n, 0n, 0n, 0n, 0n, 0n, 0n]);
    if (args.functionName === "getWithdrawalRequest") return Promise.resolve([0n, 0n, 0n]);
    if (args.functionName === "getEpoch") return Promise.resolve([2n, false]);
    throw new Error(`Unexpected read ${args.functionName}`);
  });
});

describe("Monad staking adapter", () => {
  it("offers only numeric validator IDs from the selected network", async () => {
    expect(await monadAdapter.getValidators()).toEqual([{
      address: "17", name: "Monad Validator #17", apr: 7.6, commission: 5, uptime: 99,
    }]);
  });

  it("reads live delegations by validator ID", async () => {
    expect(await monadAdapter.getDelegations(DELEGATOR)).toEqual([
      { validator: "17", amount: 1000n, status: "bonded" },
    ]);
  });

  it("does not return a partial portfolio after the delegation page cap", async () => {
    readContract.mockImplementation((_config: unknown, args: { functionName: string; args: [string, bigint] }) => {
      if (args.functionName !== "getDelegations") throw new Error("unexpected delegator read");
      const start = args.args[1];
      return Promise.resolve([false, start + 1n, [start + 1n]]);
    });
    await expect(monadAdapter.getDelegations(DELEGATOR)).rejects.toMatchObject({ code: "NETWORK" });
    expect(readContract).toHaveBeenCalledTimes(20);
  });

  it("builds undelegate only for active stake with a free withdrawal slot", async () => {
    const tx = await monadAdapter.buildUndelegateTx({ validator: "17", amount: 500n, delegator: DELEGATOR });
    if (tx.kind !== "evm") throw new Error("expected EVM tx");
    expect(decodeFunctionData({ abi, data: tx.data })).toEqual({ functionName: "undelegate", args: [17n, 1000n, 0] });
    readContract.mockImplementation((_config: unknown, args: { functionName: string }) =>
      Promise.resolve(args.functionName === "getWithdrawalRequest" ? [1n, 0n, 0n] : [1000n, 0n, 0n, 0n, 0n, 0n, 0n]));
    await expect(monadAdapter.buildUndelegateTx({ validator: "17", amount: 500n, delegator: DELEGATOR }))
      .rejects.toMatchObject({ code: "UNBONDING_PERIOD" });
  });

  it("withdraws principal rather than claiming rewards", async () => {
    readContract.mockImplementation((_config: unknown, args: { functionName: string }) =>
      Promise.resolve(args.functionName === "getEpoch" ? [2n, false] : [500n, 0n, 1n]));
    const tx = await monadAdapter.buildClaimTx({ validator: "17", delegator: DELEGATOR });
    if (tx.kind !== "evm") throw new Error("expected EVM tx");
    expect(decodeFunctionData({ abi, data: tx.data })).toEqual({ functionName: "withdraw", args: [17n, 0] });
    readContract.mockImplementation((_config: unknown, args: { functionName: string }) =>
      Promise.resolve(args.functionName === "getEpoch" ? [1n, false] : [500n, 0n, 1n]));
    await expect(monadAdapter.buildClaimTx({ validator: "17", delegator: DELEGATOR }))
      .rejects.toMatchObject({ code: "UNBONDING_PERIOD" });
  });
});
