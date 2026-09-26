/** Read-only BSC StakeHub registry, shared by testnet and mainnet scoring. */
import { createPublicClient, formatEther, http, parseAbi, type Address } from "viem";
import { config } from "../config.js";
import { assertEvmRpcChainId } from "./evm-network.js";

export const BNB_STAKE_HUB = "0x0000000000000000000000000000000000002002" as Address;

const stakeHubAbi = parseAbi([
  "function getValidators(uint256 offset, uint256 limit) view returns (address[] operatorAddrs, address[] creditAddrs, uint256 totalLength)",
  "function getValidatorBasicInfo(address operatorAddress) view returns (uint256 createdTime, bool jailed, uint256 jailUntil)",
  "function getValidatorCommission(address operatorAddress) view returns (uint64 rate, uint64 maxRate, uint64 maxChangeRate)",
  "function getValidatorDescription(address operatorAddress) view returns ((string moniker, string identity, string website, string details))",
]);

const stakeCreditAbi = parseAbi([
  "function totalPooledBNB() view returns (uint256)",
]);

const client = createPublicClient({
  chain: {
    id: config.networkMode === "mainnet" ? 56 : 97,
    name: config.networkMode === "mainnet" ? "BNB Smart Chain" : "BNB Smart Chain Testnet",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [config.bnbRpcUrl] } },
  },
  transport: http(config.bnbRpcUrl),
});
export const bnbStakingClient = client;

export interface BnbValidator {
  operator: Address;
  credit: Address;
  name: string;
  commissionPct: number;
  jailed: boolean;
  totalStaked: number;
}

export async function listBnbValidators(): Promise<BnbValidator[]> {
  await assertEvmRpcChainId(client, config.networkMode === "mainnet" ? 56 : 97, "BNB");
  const out: BnbValidator[] = [];
  let offset = 0n;
  const pageSize = 50n;
  let total = 1n;

  while (offset < total) {
    const [operators, credits, count] = await client.readContract({
      address: BNB_STAKE_HUB,
      abi: stakeHubAbi,
      functionName: "getValidators",
      args: [offset, pageSize],
    });
    total = count;
    if (operators.length === 0 || operators.length !== credits.length) break;

    const page = await Promise.all(operators.map(async (operator, i) => {
      const credit = credits[i]!;
      const [basic, commission, description, pooled] = await Promise.allSettled([
        client.readContract({ address: BNB_STAKE_HUB, abi: stakeHubAbi, functionName: "getValidatorBasicInfo", args: [operator] }),
        client.readContract({ address: BNB_STAKE_HUB, abi: stakeHubAbi, functionName: "getValidatorCommission", args: [operator] }),
        client.readContract({ address: BNB_STAKE_HUB, abi: stakeHubAbi, functionName: "getValidatorDescription", args: [operator] }),
        client.readContract({ address: credit, abi: stakeCreditAbi, functionName: "totalPooledBNB" }),
      ]);
      // A failed safety read cannot become a recommended validator.
      const jailed = basic.status !== "fulfilled" || basic.value[1] ||
        commission.status !== "fulfilled" || pooled.status !== "fulfilled";
      const rate = commission.status === "fulfilled" ? Number(commission.value[0]) : 10_000;
      const name = description.status === "fulfilled" && description.value.moniker.trim()
        ? description.value.moniker.trim()
        : `BNB validator ${operator.slice(0, 10)}`;
      return {
        operator,
        credit,
        name,
        commissionPct: rate / 100, // StakeHub: 10,000 = 100%.
        jailed,
        totalStaked: pooled.status === "fulfilled" ? Number(formatEther(pooled.value)) : 0,
      } satisfies BnbValidator;
    }));
    out.push(...page);
    offset += BigInt(operators.length);
  }
  return out;
}
