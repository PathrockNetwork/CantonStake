import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbiItem,
  type Address,
  type Log,
} from "viem";
import { polygonAmoy } from "viem/chains";
import { config } from "../config.js";
import { prisma } from "../db.js";

const client = createPublicClient({
  chain: polygonAmoy,
  transport: http(config.amoyRpcUrl),
});

const validatorShareAbi = [
  {
    type: "function",
    name: "pendingRewards",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawRewards",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

const claimedRewardsEvent = parseAbiItem(
  "event DelegatorClaimedRewards(address indexed user, uint256 rewards)"
);

export async function readPendingWei(positionId: string): Promise<bigint> {
  const position = await prisma.stakingPosition.findFirst({
    where: { OR: [{ id: positionId }, { contractId: positionId }] },
  });
  if (!position) throw new Error(`position not found: ${positionId}`);

  const rewards = (await client.readContract({
    address: config.mockValidatorShare as Address,
    abi: validatorShareAbi,
    functionName: "pendingRewards",
    args: [position.evmAddress as Address],
  })) as bigint;
  return rewards;
}

export function encodeWithdrawRewardsCalldata(): `0x${string}` {
  return encodeFunctionData({
    abi: validatorShareAbi,
    functionName: "withdrawRewards",
  });
}

export async function verifySweepReceipt(
  txHash: `0x${string}`,
  expectedFrom: string
): Promise<{ success: boolean; grossWei: bigint }> {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return { success: false, grossWei: 0n };

  const logs = await client.getLogs({
    address: config.mockValidatorShare as Address,
    event: claimedRewardsEvent,
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  const match = (logs as Log[]).find((log) => {
    const args = (log as unknown as { args: { user: Address; rewards: bigint } }).args;
    return args.user.toLowerCase() === expectedFrom.toLowerCase();
  });

  if (!match) return { success: false, grossWei: 0n };

  const rewards = (match as unknown as { args: { rewards: bigint } }).args.rewards;
  return { success: true, grossWei: rewards };
}
