import { createPublicClient, encodeFunctionData, erc20Abi, http, parseAbi, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { hoodi } from "viem/chains";
import { networkMode } from "./network";

// Official deployments: https://docs.lido.fi/deployed-contracts/hoodi/
export const LIDO = "0x3508A952176b3c15387C97BE809eaffB1982176a" as const;
export const LIDO_QUEUE = "0xfe56573178f1bcdf53F01A6E9977670dcBBD9186" as const;
export const LIDO_LOCATOR = "0xe2EF9536DAAAEBFf5b1c130957AB3E80056b06D8" as const;
export const HOODI_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
export const lidoClient = createPublicClient({ chain: hoodi, transport: http(HOODI_RPC, { timeout: 15000, retryCount: 1 }) });
export const lidoAbi = parseAbi([
  "function submit(address) payable returns (uint256)",
  "function isStakingPaused() view returns (bool)",
  "function getCurrentStakeLimit() view returns (uint256)",
  "function getSharesByPooledEth(uint256) view returns (uint256)",
  "function getPooledEthByShares(uint256) view returns (uint256)",
  "event Submitted(address indexed sender, uint256 amount, address referral)",
]);
export const queueAbi = parseAbi([
  "function STETH() view returns (address)",
  "function isPaused() view returns (bool)",
  "function MIN_STETH_WITHDRAWAL_AMOUNT() view returns (uint256)",
  "function MAX_STETH_WITHDRAWAL_AMOUNT() view returns (uint256)",
  "function getWithdrawalRequests(address) view returns (uint256[])",
  "function getWithdrawalStatus(uint256[]) view returns ((uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])",
  "function requestWithdrawals(uint256[],address) returns (uint256[])",
  "function claimWithdrawal(uint256)",
  "event WithdrawalRequested(uint256 indexed requestId, address indexed requestor, address indexed owner, uint256 amountOfStETH, uint256 amountOfShares)",
  "event WithdrawalClaimed(uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 amountOfETH)",
]);
const locatorAbi = parseAbi(["function lido() view returns (address)", "function withdrawalQueue() view returns (address)"]);

export type LidoWithdrawal = { id: bigint; amountOfStETH: bigint; amountOfShares: bigint; owner: Address; timestamp: bigint; isFinalized: boolean; isClaimed: boolean };
export type LidoState = {
  wallet?: Address; block: bigint; fetchedAt: number; paused: boolean; stakeLimit: bigint;
  withdrawalPaused: boolean; minWithdrawal: bigint; maxWithdrawal: bigint;
  balance: bigint; stETH: bigint; allowance: bigint; requests: LidoWithdrawal[];
};
export function assertLidoMode(mode: string = networkMode) {
  if (mode !== "testnet") throw Error("Hoodi Lido staking is available only on testnet.");
}
export function lidoAmount(input: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(input)) throw Error("Enter a positive amount with at most 18 decimal places.");
  const value = parseEther(input);
  if (value <= 0n || value >= 2n ** 256n) throw Error("Enter a valid positive amount.");
  return value;
}
export function assertLidoAccount(expected: Address, account: { address?: string; chainId?: number }, mode = networkMode) {
  assertLidoMode(mode);
  if (account.address?.toLowerCase() !== expected.toLowerCase() || account.chainId !== hoodi.id)
    throw Error("Wallet or network changed. Switch to Hoodi and review again.");
}
export function validateLidoAction(state: LidoState, wallet: Address, action: "deposit" | "withdraw", amount: bigint) {
  if (state.wallet?.toLowerCase() !== wallet.toLowerCase()) throw Error("Wallet balance does not match.");
  if (Date.now() - state.fetchedAt > 30000) throw Error("Balances expired. Refresh before signing.");
  if (amount <= 0n) throw Error("Enter a positive amount.");
  if (action === "deposit") {
    if (state.paused || amount > state.stakeLimit) throw Error("Lido deposits are paused or the pool deposit limit is exceeded.");
    if (amount >= state.balance) throw Error("Insufficient Hoodi ETH. Leave ETH for gas.");
  } else {
    if (state.withdrawalPaused) throw Error("Lido withdrawal requests are paused.");
    if (amount > state.stETH) throw Error("Amount exceeds your stETH balance.");
    if (amount < state.minWithdrawal || amount > state.maxWithdrawal) throw Error("Amount is outside Lido's withdrawal request limits.");
  }
}
export function validateLidoClaim(request: LidoWithdrawal | undefined, wallet: Address) {
  if (!request || request.owner.toLowerCase() !== wallet.toLowerCase() || !request.isFinalized || request.isClaimed)
    throw Error("This withdrawal is not ready to claim for your wallet.");
}
export function lidoTransaction(action: "deposit" | "approve" | "withdraw" | "claim", amountOrId: bigint, wallet: Address): { to: Address; data: Hex; value: bigint } {
  if (amountOrId <= 0n) throw Error("Invalid amount or request ID.");
  if (action === "deposit") return { to: LIDO, data: encodeFunctionData({ abi: lidoAbi, functionName: "submit", args: [zeroAddress] }), value: amountOrId };
  if (action === "approve") return { to: LIDO, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [LIDO_QUEUE, amountOrId] }), value: 0n };
  if (action === "withdraw") return { to: LIDO_QUEUE, data: encodeFunctionData({ abi: queueAbi, functionName: "requestWithdrawals", args: [[amountOrId], wallet] }), value: 0n };
  return { to: LIDO_QUEUE, data: encodeFunctionData({ abi: queueAbi, functionName: "claimWithdrawal", args: [amountOrId] }), value: 0n };
}

export async function readLidoState(wallet?: Address, client = lidoClient): Promise<LidoState> {
  assertLidoMode();
  if (await client.getChainId() !== hoodi.id) throw Error("Hoodi RPC returned the wrong network.");
  const block = await client.getBlock();
  if (Date.now() / 1000 - Number(block.timestamp) > 180) throw Error("Hoodi RPC is stale.");
  const at = { blockNumber: block.number };
  const [pool, queue, token] = await Promise.all([
    client.readContract({ address: LIDO_LOCATOR, abi: locatorAbi, functionName: "lido", ...at }),
    client.readContract({ address: LIDO_LOCATOR, abi: locatorAbi, functionName: "withdrawalQueue", ...at }),
    client.readContract({ address: LIDO_QUEUE, abi: queueAbi, functionName: "STETH", ...at }),
  ]);
  if (pool.toLowerCase() !== LIDO.toLowerCase() || queue.toLowerCase() !== LIDO_QUEUE.toLowerCase() || token.toLowerCase() !== LIDO.toLowerCase())
    throw Error("Lido contract configuration changed. Staking is unavailable.");
  const [paused, stakeLimit, withdrawalPaused, minWithdrawal, maxWithdrawal, balance, stETH, allowance, ids] = await Promise.all([
    client.readContract({ address: LIDO, abi: lidoAbi, functionName: "isStakingPaused", ...at }),
    client.readContract({ address: LIDO, abi: lidoAbi, functionName: "getCurrentStakeLimit", ...at }),
    client.readContract({ address: LIDO_QUEUE, abi: queueAbi, functionName: "isPaused", ...at }),
    client.readContract({ address: LIDO_QUEUE, abi: queueAbi, functionName: "MIN_STETH_WITHDRAWAL_AMOUNT", ...at }),
    client.readContract({ address: LIDO_QUEUE, abi: queueAbi, functionName: "MAX_STETH_WITHDRAWAL_AMOUNT", ...at }),
    wallet ? client.getBalance({ address: wallet, ...at }) : 0n,
    wallet ? client.readContract({ address: LIDO, abi: erc20Abi, functionName: "balanceOf", args: [wallet], ...at }) : 0n,
    wallet ? client.readContract({ address: LIDO, abi: erc20Abi, functionName: "allowance", args: [wallet, LIDO_QUEUE], ...at }) : 0n,
    wallet ? client.readContract({ address: LIDO_QUEUE, abi: queueAbi, functionName: "getWithdrawalRequests", args: [wallet], ...at }) : [],
  ]);
  // Chunk status calls so a wallet with many requests remains readable.
  const requests: LidoWithdrawal[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const statuses = await client.readContract({ address: LIDO_QUEUE, abi: queueAbi, functionName: "getWithdrawalStatus", args: [batch], ...at });
    requests.push(...statuses.map((status, j) => ({ ...status, id: batch[j] })));
  }
  return { wallet, block: block.number, fetchedAt: Date.now(), paused, stakeLimit, withdrawalPaused, minWithdrawal, maxWithdrawal, balance, stETH, allowance, requests };
}
