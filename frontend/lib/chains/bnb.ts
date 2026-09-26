/** Native BNB staking through the BSC StakeHub system contract. */
import { getPublicClient, readContract } from "@wagmi/core";
import { encodeFunctionData, isAddress, parseAbi, type Address } from "viem";
import { fetchValidatorScores, type ValidatorScore } from "../api";
import { bnbEvmChain } from "../chains";
import { wagmiConfig } from "../wagmi";
import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";

export const BNB_STAKE_HUB: Address =
  "0x0000000000000000000000000000000000002002";

const stakeHubAbi = parseAbi([
  "function delegate(address operatorAddress, bool delegateVotePower) payable",
  "function undelegate(address operatorAddress, uint256 shares)",
  "function claim(address operatorAddress, uint256 requestNumber)",
  "function getValidators(uint256 offset, uint256 limit) view returns (address[] operatorAddrs, address[] creditAddrs, uint256 totalLength)",
  "function minDelegationBNBChange() view returns (uint256)",
]);

const stakeCreditAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function getPooledBNB(address account) view returns (uint256)",
  "function getSharesByPooledBNB(uint256 amount) view returns (uint256)",
  "function pendingUnbondRequest(address account) view returns (uint256)",
  "function claimableUnbondRequest(address account) view returns (uint256)",
]);

type BnbValidator = ValidatorScore & { stakingCredit: Address };

function networkError(message: string, cause?: unknown): ChainAdapterError {
  return new ChainAdapterError("NETWORK", message, cause);
}

function operatorAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new ChainAdapterError("VALIDATOR_NOT_FOUND", `Invalid BNB validator operator: ${value}`);
  }
  return value;
}

function bnbClient() {
  const client = getPublicClient(wagmiConfig, { chainId: bnbEvmChain.id });
  if (!client) throw networkError("BNB public client is not configured.");
  return client;
}

async function eligibleValidators(): Promise<BnbValidator[]> {
  const snapshot = await fetchValidatorScores("bnb");
  // Never fabricate a validator or its StakeCredit address from the catalog.
  return snapshot.validators.filter((v): v is BnbValidator =>
    !v.jailed && isAddress(v.address) && !!v.stakingCredit &&
    isAddress(v.stakingCredit) && v.stakingCredit.toLowerCase() !==
      "0x0000000000000000000000000000000000000000",
  );
}

async function creditFor(operator: Address): Promise<Address> {
  // Recheck the operator→credit mapping at the signing chain. A stale API
  // snapshot must not direct an undelegation to another validator's shares.
  const client = bnbClient();
  let offset = 0n;
  let total = 1n;
  while (offset < total) {
    const [operators, credits, count] = await client.readContract({
      address: BNB_STAKE_HUB,
      abi: stakeHubAbi,
      functionName: "getValidators",
      args: [offset, 50n],
    });
    total = count;
    const index = operators.findIndex((value) => value.toLowerCase() === operator.toLowerCase());
    if (index >= 0 && credits[index] && isAddress(credits[index])) return credits[index];
    if (operators.length === 0) break;
    offset += BigInt(operators.length);
  }
  throw new ChainAdapterError("VALIDATOR_NOT_FOUND", `BNB validator ${operator} is not registered in StakeHub.`);
}

export const bnbAdapter: IChainAdapter = {
  chainId: "bnb",

  async getValidators(): Promise<Validator[]> {
    try {
      return (await eligibleValidators()).map((v) => ({
        address: v.address,
        name: v.name,
        // Neither StakeHub nor the scoring API supplies a measured APR.
        apr: 0,
        commission: v.commissionPct,
        uptime: v.uptimePct,
      }));
    } catch (cause) {
      throw networkError("Failed to load BNB validators.", cause);
    }
  },

  async getDelegations(address: string): Promise<Position[]> {
    if (!isAddress(address)) return [];
    const validators = await eligibleValidators();
    const results = await Promise.allSettled(validators.map(async (validator) => {
      const amount = await readContract(wagmiConfig, {
        chainId: bnbEvmChain.id,
        address: validator.stakingCredit,
        abi: stakeCreditAbi,
        functionName: "getPooledBNB",
        args: [address],
      });
      return amount > 0n
        ? { validator: validator.address, amount, status: "bonded" as const }
        : null;
    }));
    if (results.some((result) => result.status === "rejected")) {
      throw networkError("Could not read all BNB delegations.");
    }
    return results.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    );
  },

  async buildDelegateTx({ validator, amount, delegator }) {
    if (amount <= 0n) throw new ChainAdapterError("INSUFFICIENT_BALANCE", "Stake amount must be positive.");
    const operator = operatorAddress(validator);
    if (!isAddress(delegator)) throw networkError("Invalid BNB delegator address.");
    const credit = await creditFor(operator);
    const [existingShares, minimum] = await Promise.all([
      readContract(wagmiConfig, {
        chainId: bnbEvmChain.id,
        address: credit,
        abi: stakeCreditAbi,
        functionName: "balanceOf",
        args: [delegator],
      }),
      readContract(wagmiConfig, {
        chainId: bnbEvmChain.id,
        address: BNB_STAKE_HUB,
        abi: stakeHubAbi,
        functionName: "minDelegationBNBChange",
      }),
    ]);
    if (amount < minimum) {
      throw new ChainAdapterError("INSUFFICIENT_BALANCE", "BNB delegation is below StakeHub's current minimum.");
    }
    if (existingShares > 0n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", "This wallet already has a BNB delegation to that validator; choose another validator until multi-position accounting is available.");
    }
    return {
      kind: "evm",
      to: BNB_STAKE_HUB,
      data: encodeFunctionData({
        abi: stakeHubAbi,
        functionName: "delegate",
        args: [operator, false],
      }),
      value: amount,
    };
  },

  async buildUndelegateTx({ validator, amount, delegator }) {
    const operator = operatorAddress(validator);
    if (!isAddress(delegator)) throw networkError("Invalid BNB delegator address.");
    if (amount <= 0n) throw new ChainAdapterError("INSUFFICIENT_BALANCE", "Unstake amount must be positive.");
    const credit = await creditFor(operator);
    const [ownedShares, pendingRequests] = await Promise.all([
      readContract(wagmiConfig, { chainId: bnbEvmChain.id, address: credit, abi: stakeCreditAbi, functionName: "balanceOf", args: [delegator] }),
      readContract(wagmiConfig, { chainId: bnbEvmChain.id, address: credit, abi: stakeCreditAbi, functionName: "pendingUnbondRequest", args: [delegator] }),
    ]);
    if (pendingRequests > 0n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", "A BNB unbond is already pending for this validator.");
    }
    if (ownedShares <= 0n) {
      throw new ChainAdapterError("INSUFFICIENT_BALANCE", "Insufficient BNB delegation shares.");
    }
    // One Canton position represents a full delegation. Burn all of its
    // credit shares so auto-compounded rewards do not leave a dust position.
    return {
      kind: "evm",
      to: BNB_STAKE_HUB,
      data: encodeFunctionData({ abi: stakeHubAbi, functionName: "undelegate", args: [operator, ownedShares] }),
    };
  },

  async buildClaimTx({ validator, delegator }) {
    const operator = operatorAddress(validator);
    if (!isAddress(delegator)) throw networkError("Invalid BNB delegator address.");
    const credit = await creditFor(operator);
    const claimable = await readContract(wagmiConfig, {
      chainId: bnbEvmChain.id,
      address: credit,
      abi: stakeCreditAbi,
      functionName: "claimableUnbondRequest",
      args: [delegator],
    });
    if (claimable === 0n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", "No BNB unbond request is claimable yet.");
    }
    return {
      kind: "evm",
      to: BNB_STAKE_HUB,
      // BSC StakeHub requestNumber 0 claims all mature undelegations.
      data: encodeFunctionData({ abi: stakeHubAbi, functionName: "claim", args: [operator, 0n] }),
    };
  },

  async estimateGas(tx: UnsignedTx, from: string): Promise<bigint> {
    if (tx.kind !== "evm" || !isAddress(from)) throw networkError("Invalid BNB gas estimate request.");
    return bnbClient().estimateGas({ account: from, to: tx.to, data: tx.data, value: tx.value });
  },

  watchPosition(address, cb) {
    let active = true;
    const poll = async () => {
      try {
        const positions = await bnbAdapter.getDelegations(address);
        if (active) positions.forEach(cb);
      } catch {
        // A read failure is not a position-state change.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => { active = false; clearInterval(timer); };
  },
};
