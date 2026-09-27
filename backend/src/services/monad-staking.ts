import { rpcUrls } from "./rpc-registry.js";
/** Validator IDs and staking data from Monad's 0x1000 precompile. */
import { createPublicClient, formatEther, http, parseAbi, type Address } from "viem";
import { config } from "../config.js";
import { assertEvmRpcChainId } from "./evm-network.js";
import { mapInBatches } from "./batched-map.js";
import { setTimeout as delay } from "node:timers/promises";

const STAKING = "0x0000000000000000000000000000000000001000" as Address;
const abi = parseAbi([
  "function getExecutionValidatorSet(uint32 startIndex) view returns (bool isDone, uint32 nextIndex, uint64[] valIds)",
  "function getValidator(uint64 validatorId) view returns (address authAddress, uint64 flags, uint256 stake, uint256 accRewardPerToken, uint256 commission, uint256 unclaimedRewards, uint256 consensusStake, uint256 consensusCommission, uint256 snapshotStake, uint256 snapshotCommission, bytes secpPubkey, bytes blsPubkey)",
]);

const client = createPublicClient({
  chain: {
    id: config.networkMode === "mainnet" ? 143 : 10143,
    name: config.networkMode === "mainnet" ? "Monad" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrls["monad"]] } },
  },
  transport: http(rpcUrls["monad"], { timeout: 16_000, retryCount: 0 }),
});
export const monadStakingClient = client;

export interface MonadValidator {
  id: string;
  commissionPct: number;
  totalStaked: number;
}

export async function collectMonadValidatorIds(
  readPage: (startIndex: number) => Promise<readonly [boolean, number, readonly bigint[]]>,
): Promise<bigint[]> {
  const ids: bigint[] = [];
  let startIndex = 0;
  for (let page = 0; page < 20; page++) {
    const [isDone, nextIndex, pageIds] = await readPage(startIndex);
    ids.push(...pageIds);
    if (isDone) return ids;
    if (nextIndex <= startIndex || pageIds.length === 0) {
      throw new Error("Monad validator pagination did not advance");
    }
    startIndex = nextIndex;
  }
  throw new Error("Monad validator pagination exceeded 20 pages");
}

export async function listMonadValidators(): Promise<MonadValidator[]> {
  await assertEvmRpcChainId(client, config.networkMode === "mainnet" ? 143 : 10143, "Monad");
  const ids = await collectMonadValidatorIds((startIndex) => client.readContract({
      address: STAKING,
      abi,
      functionName: "getExecutionValidatorSet",
      args: [startIndex],
    }));
  // A mainnet validator set can exceed the gateway's 64 in-flight limit.
  // Leave capacity for settlement watchers and wallet reads during refresh.
  return mapInBatches(ids, 4, async (id) => {
    const state = await client.readContract({
      address: STAKING,
      abi,
      functionName: "getValidator",
      args: [id],
    });
    return {
      id: id.toString(),
      commissionPct: Number(state[4]) / 1e16,
      totalStaked: Number(formatEther(state[2])),
    } satisfies MonadValidator;
  }, () => delay(400)); // Under 10 reads/s, leaving headroom on public 15–25 rps RPCs.
}
