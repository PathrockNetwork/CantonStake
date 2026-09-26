import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";

const OPERATOR = "0x696606f04f7597F444265657C8c13039Fd759b14";
const CREDIT = "0x4AFc633E7B6bEB8e552ccddbE06Cca3754991E9A";
const DELEGATOR = "0x1111111111111111111111111111111111111111";

const readContract = vi.fn();
const hubRead = vi.fn();
vi.mock("@wagmi/core", () => ({
  getPublicClient: () => ({ readContract: hubRead, estimateGas: vi.fn().mockResolvedValue(120_000n) }),
  readContract: (...args: unknown[]) => readContract(...args),
}));
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@/lib/chains", () => ({ bnbEvmChain: { id: 97 } }));

const fetchValidatorScores = vi.fn();
vi.mock("@/lib/api", () => ({ fetchValidatorScores: (...args: unknown[]) => fetchValidatorScores(...args) }));

const { bnbAdapter, BNB_STAKE_HUB } = await import("@/lib/chains/bnb");
const abi = parseAbi([
  "function delegate(address operatorAddress, bool delegateVotePower) payable",
  "function undelegate(address operatorAddress, uint256 shares)",
  "function claim(address operatorAddress, uint256 requestNumber)",
]);

beforeEach(() => {
  fetchValidatorScores.mockReset().mockResolvedValue({ validators: [{
    address: OPERATOR, stakingCredit: CREDIT, name: "Seoraksan", jailed: false,
    commissionPct: 10, uptimePct: 100,
  }] });
  hubRead.mockReset().mockResolvedValue([[OPERATOR], [CREDIT], 1n]);
  readContract.mockReset().mockImplementation((_config: unknown, args: { functionName: string }) => {
    if (args.functionName === "balanceOf") return Promise.resolve(900n);
    if (args.functionName === "getPooledBNB") return Promise.resolve(1000n);
    if (args.functionName === "getSharesByPooledBNB") return Promise.resolve(450n);
    if (args.functionName === "minDelegationBNBChange") return Promise.resolve(10n ** 18n);
    if (args.functionName === "pendingUnbondRequest") return Promise.resolve(0n);
    if (args.functionName === "claimableUnbondRequest") return Promise.resolve(1n);
    throw new Error(`Unexpected read ${args.functionName}`);
  });
});

describe("BNB StakeHub adapter", () => {
  it("uses only live, non-jailed validators with credit contracts", async () => {
    expect(await bnbAdapter.getValidators()).toEqual([{
      address: OPERATOR, name: "Seoraksan", apr: 0, commission: 10, uptime: 100,
    }]);
    fetchValidatorScores.mockResolvedValueOnce({ validators: [{ address: OPERATOR, jailed: false }] });
    expect(await bnbAdapter.getValidators()).toEqual([]);
  });

  it("builds payable delegation to the registered operator", async () => {
    readContract.mockResolvedValueOnce(0n);
    const tx = await bnbAdapter.buildDelegateTx({ validator: OPERATOR, amount: 10n ** 18n, delegator: DELEGATOR });
    expect(tx).toMatchObject({ kind: "evm", to: BNB_STAKE_HUB, value: 10n ** 18n });
    if (tx.kind !== "evm") throw new Error("expected EVM transaction");
    expect(decodeFunctionData({ abi, data: tx.data })).toEqual({ functionName: "delegate", args: [OPERATOR, false] });
  });

  it("unbonds all owned shares so compounded rewards leave no dust", async () => {
    const partial = await bnbAdapter.buildUndelegateTx({ validator: OPERATOR, amount: 500n, delegator: DELEGATOR });
    const full = await bnbAdapter.buildUndelegateTx({ validator: OPERATOR, amount: 1000n, delegator: DELEGATOR });
    if (partial.kind !== "evm" || full.kind !== "evm") throw new Error("expected EVM transactions");
    expect(decodeFunctionData({ abi, data: partial.data }).args).toEqual([OPERATOR, 900n]);
    expect(decodeFunctionData({ abi, data: full.data }).args).toEqual([OPERATOR, 900n]);
  });

  it("refuses an operator absent from the on-chain registry", async () => {
    hubRead.mockResolvedValueOnce([[], [], 0n]);
    await expect(bnbAdapter.buildDelegateTx({ validator: OPERATOR, amount: 1n, delegator: DELEGATOR }))
      .rejects.toMatchObject({ code: "VALIDATOR_NOT_FOUND" });
  });

  it("claims all mature requests through request number zero", async () => {
    const tx = await bnbAdapter.buildClaimTx({ validator: OPERATOR, delegator: DELEGATOR });
    if (tx.kind !== "evm") throw new Error("expected EVM transaction");
    expect(decodeFunctionData({ abi, data: tx.data })).toEqual({ functionName: "claim", args: [OPERATOR, 0n] });
  });
});
