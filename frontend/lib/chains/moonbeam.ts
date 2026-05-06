/**
 * Moonbeam chain adapter — Moonbase Alpha testnet, parachain-staking
 * via the EVM precompile.
 *
 * Moonbase Alpha is Moonbeam's testnet (chain id 1287). The
 * `parachainStaking` pallet is exposed at the same precompile address
 * 0x0000…0800 across all Moonbeam runtimes (mainnet, Moonriver, Moonbase
 * Alpha) so the EVM call shape doesn't change — only the RPC endpoint
 * and chain id do.
 *
 * Note: Moonbeam's public validator listing API (api.moonbeam.network)
 * only serves mainnet collators, so the validator-scoring service uses
 * mainnet data for display purposes. Real testnet collator selection
 * should query the precompile directly when needed.
 */

import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
} from "viem";
import { moonbaseAlpha } from "viem/chains";
import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";

const MOONBEAM_CHAIN_ID = "moonbeam";
const PARACHAIN_STAKING_PRECOMPILE: Address =
  "0x0000000000000000000000000000000000000800";

// 2-round exit window on Moonbase Alpha (2 hours per round) — much
// shorter than mainnet's 28 days, useful for the demo.
const UNBONDING_SECONDS = 2 * 60 * 60;

const stakingAbi = parseAbi([
  "function delegate(address candidate, uint256 amount, uint256 candidateDelegationCount, uint256 delegatorDelegationCount)",
  "function scheduleRevokeDelegation(address candidate)",
  "function executeDelegationRequest(address delegator, address candidate)",
  "function delegatorBondMore(address candidate, uint256 more)",
  "function delegationAmount(address delegator, address candidate) view returns (uint256)",
]);

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

function isAddress(s: string): s is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

function publicClient() {
  return createPublicClient({ chain: moonbaseAlpha, transport: http() });
}

function evmTx(data: `0x${string}`, value?: bigint): UnsignedTx {
  return value === undefined
    ? { kind: "evm", to: PARACHAIN_STAKING_PRECOMPILE, data }
    : { kind: "evm", to: PARACHAIN_STAKING_PRECOMPILE, data, value };
}

interface MoonbeamApiCollator {
  address: string;
  name?: string;
  commission?: number;
  selfBonded?: string;
  totalCounted?: string;
  isActive?: boolean;
}

export const moonbeamAdapter: IChainAdapter = {
  chainId: MOONBEAM_CHAIN_ID,

  async getValidators(): Promise<Validator[]> {
    try {
      const res = await fetch(
        "https://api.moonbeam.network/api/staking/collators",
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) throw networkError(`Moonbeam API ${res.status}`);
      const body = (await res.json()) as { collators?: MoonbeamApiCollator[] };
      return (body.collators ?? [])
        .filter((c) => c.isActive !== false)
        .map((c) => {
          const commission =
            (c.commission ?? 0) > 100 ? (c.commission ?? 0) / 100 : c.commission ?? 0;
          return {
            address: c.address,
            name: c.name ?? c.address.slice(0, 10),
            apr: 12 * (1 - commission / 100),
            commission,
            uptime: 99.0,
          };
        });
    } catch (cause) {
      throw toAdapterError("Failed to load Moonbeam validators.", cause);
    }
  },

  async getDelegations(address: string): Promise<Position[]> {
    try {
      if (!isAddress(address)) return [];
      // Without an indexer we can't enumerate every collator a user delegates
      // to; the precompile only exposes per-(delegator,candidate) reads. The
      // backend orchestrator persists user→candidate mapping when staking
      // happens through us, so the UI gets its list from there. This
      // adapter only handles the per-candidate balance probe.
      return [];
    } catch (cause) {
      throw toAdapterError(
        `Failed to load Moonbeam delegations for ${address}.`,
        cause,
      );
    }
  },

  async buildDelegateTx({ validator, amount }) {
    if (!isAddress(validator)) {
      throw new ChainAdapterError(
        "VALIDATOR_NOT_FOUND",
        `Invalid Moonbeam collator address ${validator}.`,
      );
    }
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        functionName: "delegate",
        // candidateDelegationCount + delegatorDelegationCount: caller passes
        // a safe overestimate; on-chain validation enforces the cap. Using
        // 300 covers any active collator (max delegations per collator).
        args: [validator, amount, 300n, 100n],
      }),
      amount,
    );
  },

  async buildUndelegateTx({ validator }) {
    if (!isAddress(validator)) {
      throw new ChainAdapterError(
        "VALIDATOR_NOT_FOUND",
        `Invalid Moonbeam collator address ${validator}.`,
      );
    }
    // scheduleRevokeDelegation enqueues the exit; user calls
    // executeDelegationRequest after the 28-day window.
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        functionName: "scheduleRevokeDelegation",
        args: [validator],
      }),
    );
  },

  async buildClaimTx({ validator, delegator }) {
    if (!isAddress(validator) || !isAddress(delegator)) {
      throw new ChainAdapterError(
        "VALIDATOR_NOT_FOUND",
        `Invalid Moonbeam address (validator=${validator}, delegator=${delegator}).`,
      );
    }
    return evmTx(
      encodeFunctionData({
        abi: stakingAbi,
        functionName: "executeDelegationRequest",
        args: [delegator, validator],
      }),
    );
  },

  async estimateGas(tx, from) {
    if (tx.kind !== "evm") {
      throw networkError(
        `Moonbeam adapter cannot estimate gas for ${tx.kind} txs.`,
      );
    }
    return await publicClient().estimateGas({
      account: from as Address,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
    });
  },

  watchPosition() {
    // Moonbeam doesn't expose per-delegator events on the precompile; the
    // backend orchestrator is the source of truth for position changes.
    return () => {};
  },
};

export const moonbeamUnbondingSeconds = UNBONDING_SECONDS;
export const moonbeamPrecompile = PARACHAIN_STAKING_PRECOMPILE;
