/**
 * Monad chain adapter — staking precompile at 0x...1000.
 *
 * Selectors and ABI shape ported from
 * references/staking-sdk-cli/src/staking_sdk_py/constants.py +
 * generateCalldata.py. Validator addresses on Monad are uint64 IDs, so
 * callers pass the validator id as a numeric string (e.g. "42").
 */

import { encodeFunctionData, parseAbi, type Address } from "viem";
import { fetchValidatorScores, type ValidatorScore } from "../api";
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
  "function claim_rewards(uint64 validator_id)",
  "function get_delegator(uint64 validator_id, address delegator) view returns (uint256, uint256, uint256, uint256, uint256, uint64, uint64)",
  "function get_validator(uint64 validator_id) view returns (address, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, bytes, bytes)",
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

interface MonadValidatorRow {
  id?: number | string;
  address?: string;
  name?: string;
  commission?: number;
  total_stake?: string | number;
  active?: boolean;
}

export const monadAdapter: IChainAdapter = {
  chainId: MONAD_CHAIN_ID,

  async getValidators(): Promise<Validator[]> {
    try {
      const snap = await fetchValidatorScores("monad");
      return snap.validators.map((v: ValidatorScore) => ({
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

  async getDelegations(): Promise<Position[]> {
    // Per-delegator query requires the validator id; the orchestrator
    // tracks user→validator mapping. The adapter exposes the read path
    // via get_delegator() but doesn't enumerate without external help.
    return [];
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

  async buildUndelegateTx({ validator, amount }) {
    const valId = toValidatorId(validator);
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        functionName: "undelegate",
        // withdraw_id 0 — caller may bump to support concurrent undelegations.
        args: [valId, amount, 0],
      }),
    );
  },

  async buildClaimTx({ validator }) {
    const valId = toValidatorId(validator);
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        functionName: "claim_rewards",
        args: [valId],
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
