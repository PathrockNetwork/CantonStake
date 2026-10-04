/**
 * Cosmos chain adapter — provider testnet or cosmoshub-4 read paths and tx builders.
 *
 * Read paths use the selected network's chain-checked RPC. Tx builders return
 * `kind: "cosmos"` UnsignedTx
 * envelopes; the actual signing happens either:
 *   - in the user's Keplr wallet via `window.keplr.signAmino` (frontend), or
 *   - in the backend auto-compound keeper via @cosmjs/stargate.
 *
 * REStake (references/restake) uses the same shape for its bot. We
 * mirror its MsgDelegate / MsgUndelegate messages and let the signer pick
 * how to broadcast. Unbonded principal releases automatically in EndBlock.
 */

import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";
import { fetchValidatorScores, type ValidatorScore } from "../api";
import { cosmosNetworks, type CosmosChainKey } from "../cosmos/networks";
import { chainById } from "../chains";

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

export function createCosmosAdapter(chainKey: CosmosChainKey): IChainAdapter {
  const network = cosmosNetworks[chainKey];
  const adapter: IChainAdapter = {
  chainId: chainKey,

  async getValidators(): Promise<Validator[]> {
    try {
      const snap = await fetchValidatorScores(chainKey);
      const baseApyPct = chainById(chainKey)?.apy ?? 0;
      return snap.validators.map((v: ValidatorScore) => ({
        address: v.address,
        name: v.name,
        apr: (1 - v.commissionPct / 100) * baseApyPct,
        commission: v.commissionPct,
        uptime: v.uptimePct,
      }));
    } catch (cause) {
      throw toAdapterError(`Failed to load ${network.chainName} validators.`, cause);
    }
  },

  async getDelegations(address: string): Promise<Position[]> {
    try {
      const { readCosmosPositions } = await import("../cosmos/staking-queries");
      return await readCosmosPositions(network, address);
    } catch (cause) {
      throw toAdapterError(
        `Failed to load ${network.chainName} delegations for ${address}.`,
        cause,
      );
    }
  },

  async buildDelegateTx({ validator, amount, delegator }) {
    return {
      kind: "cosmos",
      typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: {
        delegatorAddress: delegator,
        validatorAddress: validator,
        amount: { denom: network.denom, amount: amount.toString() },
      },
    } satisfies UnsignedTx;
  },

  async buildUndelegateTx({ validator, amount, delegator }) {
    return {
      kind: "cosmos",
      typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
      value: {
        delegatorAddress: delegator,
        validatorAddress: validator,
        amount: { denom: network.denom, amount: amount.toString() },
      },
    } satisfies UnsignedTx;
  },

  async buildClaimTx() {
    throw new ChainAdapterError("UNBONDING_PERIOD", `${network.chainName} releases unbonded principal automatically; no claim transaction exists.`);
  },

  async estimateGas(tx) {
    if (tx.kind !== "cosmos") {
      throw networkError(
        `${network.chainName} adapter cannot estimate gas for ${tx.kind} txs.`,
      );
    }
    // Cosmos Hub gas is tiny + chain-set; a sensible default beats a
    // simulate call here. The keeper / Keplr will simulate at sign time.
    return 200_000n;
  },

  watchPosition(address, cb) {
    let cancelled = false;
    const tick = async () => {
      try {
        const positions = await adapter.getDelegations(address);
        if (!cancelled) {
          cb(
            positions[0] ?? {
              validator: "",
              amount: 0n,
              status: "released",
            },
          );
        }
      } catch {
        // Polling errors stay quiet; keep the subscription alive.
      }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  },
  };
  return adapter;
}

export const cosmosAdapter = createCosmosAdapter("cosmos");
export const celestiaAdapter = createCosmosAdapter("celestia");
export const osmosisAdapter = createCosmosAdapter("osmosis");
