/**
 * Monad chain adapter — staking precompile at 0x...1000.
 *
 * Selectors and ABI shape ported from
 * references/staking-sdk-cli/src/staking_sdk_py/constants.py +
 * generateCalldata.py. Validator addresses on Monad are uint64 IDs, so
 * callers pass the validator id as a numeric string (e.g. "42").
 */

import { readContract } from "@wagmi/core";
import { encodeFunctionData, isAddress, parseAbi, type Address } from "viem";
import { fetchValidatorScores, type ValidatorScore } from "../api";
import { monadEvmChain } from "../chains";
import { wagmiConfig } from "../wagmi";
import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";

const MONAD_CHAIN_ID = "monad";
const STAKING_CONTRACT: Address =
  "0x0000000000000000000000000000000000001000";

const stakingAbi = parseAbi([
  "function delegate(uint64 validator_id) payable",
  "function undelegate(uint64 validator_id, uint256 amount, uint8 withdraw_id)",
  "function withdraw(uint64 validator_id, uint8 withdraw_id)",
  "function compound(uint64 validator_id)",
  "function claimRewards(uint64 validator_id)",
  "function getDelegator(uint64 validator_id, address delegator) view returns (uint256, uint256, uint256, uint256, uint256, uint64, uint64)",
  "function getValidator(uint64 validator_id) view returns (address, uint64, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, bytes, bytes)",
  "function getDelegations(address delegator, uint64 startValId) view returns (bool isDone, uint64 nextValId, uint64[] valIds)",
  "function getWithdrawalRequest(uint64 validator_id, address delegator, uint8 withdraw_id) view returns (uint256 withdrawalAmount, uint256 accRewardPerToken, uint64 withdrawEpoch)",
  "function getEpoch() view returns (uint64 epoch, bool inEpochDelayPeriod)",
]);

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

function toValidatorId(input: string): bigint {
  // Accept either "42" or a hex address fallback (validator-info's address
  // field). We normalise to a uint64 — if non-numeric, raise.
  if (/^\d+$/.test(input)) return BigInt(input);
  throw new ChainAdapterError(
    "VALIDATOR_NOT_FOUND",
    `Monad validator must be a numeric id (got ${input}).`,
  );
}

function evmTx(data: `0x${string}`, value?: bigint): UnsignedTx {
  return value === undefined
    ? { kind: "evm", to: STAKING_CONTRACT, data }
    : { kind: "evm", to: STAKING_CONTRACT, data, value };
}

export const monadAdapter: IChainAdapter = {
  chainId: MONAD_CHAIN_ID,

  async getValidators(): Promise<Validator[]> {
    try {
      const snap = await fetchValidatorScores("monad");
      return snap.validators.filter((v: ValidatorScore) => !v.jailed && /^\d+$/.test(v.address)).map((v: ValidatorScore) => ({
        address: v.address,
        name: v.name,
        apr: 8 * (1 - v.commissionPct / 100),
        commission: v.commissionPct,
        uptime: v.uptimePct,
      }));
    } catch (cause) {
      throw toAdapterError("Failed to load Monad validators.", cause);
    }
  },

  async getDelegations(address): Promise<Position[]> {
    if (!isAddress(address)) return [];
    const ids: bigint[] = [];
    let startValId = 0n;
    let complete = false;
    for (let page = 0; page < 20; page++) {
      const [isDone, nextValId, pageIds] = await readContract(wagmiConfig, {
        chainId: monadEvmChain.id,
        address: STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: "getDelegations",
        args: [address, startValId],
      });
      ids.push(...pageIds);
      if (isDone) {
        complete = true;
        break;
      }
      if (nextValId <= startValId || pageIds.length === 0) throw networkError("Monad delegation pagination did not advance.");
      startValId = nextValId;
    }
    if (!complete) throw networkError("Monad delegation pagination exceeded the 20-page safety limit.");
    const rows = await Promise.all(ids.map(async (id) => {
      const state = await readContract(wagmiConfig, {
        chainId: monadEvmChain.id,
        address: STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: "getDelegator",
        args: [id, address],
      });
      const amount = state[0] + state[3] + state[4];
      return amount > 0n
        ? { validator: id.toString(), amount, status: "bonded" as const }
        : null;
    }));
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },

  async buildDelegateTx({ validator, amount }) {
    const valId = toValidatorId(validator);
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        functionName: "delegate",
        args: [valId],
      }),
      amount,
    );
  },

  async buildUndelegateTx({ validator, amount, delegator }) {
    const valId = toValidatorId(validator);
    if (!isAddress(delegator)) throw networkError("Invalid Monad delegator address.");
    const [state, withdrawal] = await Promise.all([
      readContract(wagmiConfig, { chainId: monadEvmChain.id, address: STAKING_CONTRACT, abi: stakingAbi, functionName: "getDelegator", args: [valId, delegator] }),
      readContract(wagmiConfig, { chainId: monadEvmChain.id, address: STAKING_CONTRACT, abi: stakingAbi, functionName: "getWithdrawalRequest", args: [valId, delegator, 0] }),
    ]);
    if (amount <= 0n || state[0] === 0n) {
      throw new ChainAdapterError("INSUFFICIENT_BALANCE", "No active Monad stake can be undelegated yet.");
    }
    if (state[3] > 0n || state[4] > 0n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", "Wait for this Monad delegation to activate before withdrawing it.");
    }
    if (withdrawal[0] > 0n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", "Monad withdrawal slot 0 is already occupied. Withdraw it before unbonding again.");
    }
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        functionName: "undelegate",
        // withdraw_id 0 — caller may bump to support concurrent undelegations.
        // One position per wallet/validator: close the full active stake,
        // including any compounded rewards and after any slash adjustment.
        args: [valId, state[0], 0],
      }),
    );
  },

  async buildClaimTx({ validator, delegator }) {
    const valId = toValidatorId(validator);
    if (!isAddress(delegator)) throw networkError("Invalid Monad delegator address.");
    const [withdrawal, epoch] = await Promise.all([
      readContract(wagmiConfig, {
        chainId: monadEvmChain.id,
        address: STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: "getWithdrawalRequest",
        args: [valId, delegator, 0],
      }),
      readContract(wagmiConfig, {
        chainId: monadEvmChain.id,
        address: STAKING_CONTRACT,
        abi: stakingAbi,
        functionName: "getEpoch",
      }),
    ]);
    if (withdrawal[0] === 0n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", "No Monad withdrawal is pending in slot 0.");
    }
    if (epoch[0] < withdrawal[2] + 1n) {
      throw new ChainAdapterError("UNBONDING_PERIOD", `Monad withdrawal is not claimable until epoch ${withdrawal[2] + 1n}.`);
    }
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        // Position claim means withdraw the principal after undelegation;
        // claimRewards is a separate, immediate reward-only action.
        functionName: "withdraw",
        args: [valId, 0],
      }),
    );
  },

  async estimateGas(tx) {
    if (tx.kind !== "evm") {
      throw networkError(`Monad adapter cannot estimate gas for ${tx.kind} txs.`);
    }
    // Monad gas is competitive with EVM L1 staking calls; a modest constant
    // is fine here — we don't want to require an RPC client config in the
    // browser bundle just to estimate, and on-chain estimation happens at
    // sign time anyway.
    return 250_000n;
  },

  watchPosition() {
    return () => {};
  },
};

export const monadStakingContract = STAKING_CONTRACT;
