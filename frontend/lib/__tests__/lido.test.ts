import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { hoodi } from "viem/chains";
import { LIDO, LIDO_QUEUE, assertLidoAccount, assertLidoMode, lidoAbi, lidoAmount, lidoClient, lidoTransaction, queueAbi, readLidoState, validateLidoAction, validateLidoClaim, type LidoState } from "../lido";
import { assertSettledTransaction, executeLidoAction, type LidoSend } from "../lido-transactions";

const wallet = "0x0000000000000000000000000000000000000011" as Address;
const other = "0x0000000000000000000000000000000000000022" as Address;
const hash = `0x${"a".repeat(64)}` as Hex;
const state = (): LidoState => ({ wallet, block: 100n, fetchedAt: Date.now(), paused: false, stakeLimit: parseEther("100"), withdrawalPaused: false, minWithdrawal: 100n, maxWithdrawal: parseEther("1000"), balance: parseEther("2"), stETH: parseEther("1"), allowance: 0n, requests: [] });

describe("Hoodi Lido policy", () => {
  it("preserves exact wei and rejects rounded, malformed or zero amounts", () => {
    expect(lidoAmount("0.000000000000000001")).toBe(1n);
    expect(lidoAmount("0.01")).toBe(10n ** 16n);
    for (const input of ["", "0", "-1", "1e3", " 1", "01", "0.0000000000000000001", "Infinity"])
      expect(() => lidoAmount(input)).toThrow();
  });
  it("rejects mainnet, Sepolia and a changed wallet", () => {
    expect(() => assertLidoMode("mainnet")).toThrow();
    expect(() => assertLidoAccount(wallet, { address: wallet, chainId: hoodi.id })).not.toThrow();
    for (const account of [{ address: wallet, chainId: 1 }, { address: wallet, chainId: 11155111 }, { address: other, chainId: hoodi.id }, {}])
      expect(() => assertLidoAccount(wallet, account)).toThrow();
  });
  it("fails closed on stale balances, pauses, limits and insufficient funds", () => {
    for (const patch of [{ wallet: other }, { fetchedAt: Date.now() - 31000 }, { paused: true }, { stakeLimit: 0n }, { balance: 100n }])
      expect(() => validateLidoAction({ ...state(), ...patch }, wallet, "deposit", 100n)).toThrow();
    for (const patch of [{ withdrawalPaused: true }, { minWithdrawal: 101n }, { maxWithdrawal: 99n }, { stETH: 99n }])
      expect(() => validateLidoAction({ ...state(), ...patch }, wallet, "withdraw", 100n)).toThrow();
  });
  it("pins contracts, exact approval, withdrawal ownership and no referral", () => {
    const deposit = lidoTransaction("deposit", 100n, wallet);
    expect(deposit.to).toBe(LIDO); expect(deposit.value).toBe(100n);
    expect(decodeFunctionData({ abi: lidoAbi, data: deposit.data }).args).toEqual([zeroAddress]);
    const approval = lidoTransaction("approve", 100n, wallet);
    expect(approval.to).toBe(LIDO); expect(approval.value).toBe(0n);
    expect(decodeFunctionData({ abi: erc20Abi, data: approval.data }).args).toEqual([LIDO_QUEUE, 100n]);
    const request = lidoTransaction("withdraw", 100n, wallet);
    expect(request.to).toBe(LIDO_QUEUE);
    expect(decodeFunctionData({ abi: queueAbi, data: request.data }).args).toEqual([[100n], wallet]);
  });
  it("only permits finalized, unclaimed requests owned by the wallet", () => {
    const request = { id: 1n, owner: wallet, amountOfStETH: 100n, amountOfShares: 99n, timestamp: 0n, isFinalized: true, isClaimed: false };
    expect(() => validateLidoClaim(request, wallet)).not.toThrow();
    for (const row of [undefined, { ...request, owner: other }, { ...request, isFinalized: false }, { ...request, isClaimed: true }])
      expect(() => validateLidoClaim(row, wallet)).toThrow();
  });
  it("rejects replaced or cancelled transactions", () => {
    const expected = lidoTransaction("deposit", 100n, wallet);
    const actual = { from: wallet, to: expected.to, input: expected.data, value: 100n };
    expect(() => assertSettledTransaction(actual, wallet, expected)).not.toThrow();
    for (const patch of [{ from: other }, { to: wallet }, { value: 0n }, { input: "0x" as Hex }])
      expect(() => assertSettledTransaction({ ...actual, ...patch }, wallet, expected)).toThrow();
  });
});

function engine() {
  let account = wallet;
  let current = state();
  let last = lidoTransaction("deposit", 100n, wallet);
  const readState = vi.fn(async () => current);
  const client = {
    call: vi.fn(async () => ({})), estimateGas: vi.fn(async () => 100000n),
    estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: 10n, maxPriorityFeePerGas: 1n })),
    getBalance: vi.fn(async () => parseEther("2")),
    waitForTransactionReceipt: vi.fn(async () => ({ transactionHash: hash, status: "success", logs: [] })),
    getTransaction: vi.fn(async () => ({ from: wallet, to: last.to, input: last.data, value: last.value })),
  };
  const send = vi.fn(async (tx: Parameters<LidoSend>[0]) => { last = tx; return hash; });
  const run = (action: "deposit" | "withdraw" | "claim" = "deposit") => executeLidoAction({ action, amountOrId: 100n, wallet,
    assertCurrent: () => assertLidoAccount(wallet, { address: account, chainId: hoodi.id }),
    send, readState: readState as typeof readLidoState, client: client as unknown as typeof lidoClient,
    onTransaction: vi.fn(), onProgress: vi.fn(),
  });
  return { client, send, readState, run, setAccount: (a: Address) => { account = a; }, update: (patch: Partial<LidoState>) => { current = { ...current, ...patch }; } };
}
describe("Lido signing boundaries", () => {
  it("submits a withdrawal only after exact approval and matching queue evidence", async () => {
    const e = engine();
    e.client.waitForTransactionReceipt.mockImplementationOnce(async () => { e.update({ allowance: 100n }); return { transactionHash: hash, status: "success", logs: [] }; });
    e.client.waitForTransactionReceipt.mockResolvedValueOnce({ transactionHash: hash, status: "success", logs: [{
      address: LIDO_QUEUE, topics: encodeEventTopics({ abi: queueAbi, eventName: "WithdrawalRequested", args: { requestId: 7n, requestor: wallet, owner: wallet } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [100n, 99n]),
    }] } as never);
    await expect(e.run("withdraw")).resolves.toBeUndefined();
    expect(e.send).toHaveBeenCalledTimes(2);
    expect(decodeFunctionData({ abi: queueAbi, data: e.send.mock.calls[1][0].data }).args).toEqual([[100n], wallet]);
  });
  it("claims only after verifying ownership and the matching claim receipt", async () => {
    const e = engine();
    e.update({ requests: [{ id: 100n, owner: wallet, amountOfStETH: 100n, amountOfShares: 99n, timestamp: 0n, isFinalized: true, isClaimed: false }] });
    e.client.waitForTransactionReceipt.mockResolvedValueOnce({ transactionHash: hash, status: "success", logs: [{
      address: LIDO_QUEUE, topics: encodeEventTopics({ abi: queueAbi, eventName: "WithdrawalClaimed", args: { requestId: 100n, owner: wallet, receiver: wallet } }),
      data: encodeAbiParameters([{ type: "uint256" }], [99n]),
    }] } as never);
    await expect(e.run("claim")).resolves.toBeUndefined(); expect(e.send).toHaveBeenCalledTimes(1);
  });
  it("stops before signing on failed simulation or insufficient gas balance", async () => {
    const e = engine(); e.client.call.mockRejectedValueOnce(Error("Simulation failed"));
    await expect(e.run()).rejects.toThrow("Simulation failed"); expect(e.send).not.toHaveBeenCalled();
    e.client.getBalance.mockResolvedValueOnce(0n);
    await expect(e.run()).rejects.toThrow("gas"); expect(e.send).not.toHaveBeenCalled();
  });
  it("does not submit a withdrawal if the wallet changes during approval", async () => {
    const e = engine();
    e.client.waitForTransactionReceipt.mockImplementationOnce(async () => { e.setAccount(other); return { transactionHash: hash, status: "success", logs: [] }; });
    await expect(e.run("withdraw")).rejects.toThrow("Wallet or network changed");
    expect(e.send).toHaveBeenCalledTimes(1);
    expect(decodeFunctionData({ abi: erc20Abi, data: e.send.mock.calls[0][0].data }).functionName).toBe("approve");
  });
  it("rechecks the withdrawal pause after approval", async () => {
    const e = engine();
    e.client.waitForTransactionReceipt.mockImplementationOnce(async () => { e.update({ allowance: 100n, withdrawalPaused: true }); return { transactionHash: hash, status: "success", logs: [] }; });
    await expect(e.run("withdraw")).rejects.toThrow("paused"); expect(e.send).toHaveBeenCalledTimes(1);
  });
  it("requires deposit event evidence and accepts a matching confirmed deposit", async () => {
    const e = engine();
    await expect(e.run()).rejects.toThrow("evidence is missing");
    e.client.waitForTransactionReceipt.mockResolvedValueOnce({ transactionHash: hash, status: "success", logs: [{
      address: LIDO, topics: encodeEventTopics({ abi: lidoAbi, eventName: "Submitted", args: { sender: wallet } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [100n, zeroAddress]),
    }] } as never);
    await expect(e.run()).resolves.toBeUndefined();
  });
  it("never submits a claim for an unowned or pending request", async () => {
    const e = engine(); await expect(e.run("claim")).rejects.toThrow("not ready"); expect(e.send).not.toHaveBeenCalled();
  });
});

describe("Lido read verification", () => {
  it("rejects a wrong chain before reading contract data", async () => {
    const readContract = vi.fn();
    const client = { getChainId: async () => 1, readContract } as unknown as typeof lidoClient;
    await expect(readLidoState(wallet, client)).rejects.toThrow("wrong network");
    expect(readContract).not.toHaveBeenCalled();
  });
  it("rejects a stale RPC and a mismatched locator", async () => {
    const readContract = vi.fn(async () => other);
    const client = { getChainId: async () => hoodi.id, getBlock: vi.fn(async () => ({ number: 100n, timestamp: 1n })), readContract };
    await expect(readLidoState(wallet, client as unknown as typeof lidoClient)).rejects.toThrow("stale");
    client.getBlock.mockResolvedValueOnce({ number: 100n, timestamp: BigInt(Math.floor(Date.now()/1000)) });
    await expect(readLidoState(wallet, client as unknown as typeof lidoClient)).rejects.toThrow("configuration changed");
  });
});
