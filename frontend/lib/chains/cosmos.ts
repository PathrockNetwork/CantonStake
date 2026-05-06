/**
 * Cosmos chain adapter — Cosmos Hub (cosmoshub-4) read paths + tx builders.
 *
 * Read paths (validators, delegations) hit the public Cosmos REST API
 * (cosmos.directory). Tx builders return `kind: "cosmos"` UnsignedTx
 * envelopes; the actual signing happens either:
 *   - in the user's Keplr wallet via `window.keplr.signAmino` (frontend), or
 *   - in the backend auto-compound keeper via @cosmjs/stargate.
 *
 * REStake (references/restake) uses the same shape for its bot. We
 * mirror its message types — MsgDelegate / MsgUndelegate /
 * MsgWithdrawDelegatorReward — and let the signer pick how to broadcast.
 */

import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";

const COSMOS_CHAIN_ID = "cosmos";
const COSMOS_REST = "https://rest.cosmos.directory/cosmoshub";
const UATOM_PER_ATOM = 1_000_000n;
// Cosmos Hub unbonding period — currently 21 days, mirrors x/staking param.
const UNBONDING_SECONDS = 21 * 24 * 60 * 60;

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

interface CosmosRestValidator {
  operator_address: string;
  description?: { moniker?: string };
  commission?: { commission_rates?: { rate?: string } };
  tokens?: string;
  jailed?: boolean;
  status?: string;
}

interface CosmosRestDelegation {
  delegation: {
    delegator_address: string;
    validator_address: string;
    shares: string;
  };
  balance: { denom: string; amount: string };
}

interface CosmosRestUnbonding {
  delegator_address: string;
  validator_address: string;
  entries: Array<{
    creation_height: string;
    completion_time: string;
    initial_balance: string;
    balance: string;
  }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw networkError(`Cosmos REST ${url} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const cosmosAdapter: IChainAdapter = {
  chainId: COSMOS_CHAIN_ID,

  async getValidators(): Promise<Validator[]> {
    try {
      const body = await fetchJson<{ validators?: CosmosRestValidator[] }>(
        `${COSMOS_REST}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=200`,
      );
      const rows = body.validators ?? [];
      return rows
        .filter((v) => !v.jailed)
        .map((v) => ({
          address: v.operator_address,
          name: v.description?.moniker ?? v.operator_address.slice(0, 14),
          apr:
            (1 -
              Number(v.commission?.commission_rates?.rate ?? "0.05")) *
            21,
          commission:
            Number(v.commission?.commission_rates?.rate ?? "0.05") * 100,
          uptime: 99.0,
        }));
    } catch (cause) {
      throw toAdapterError("Failed to load Cosmos validators.", cause);
    }
  },

  async getDelegations(address: string): Promise<Position[]> {
    try {
      const [delegations, unbondings] = await Promise.all([
        fetchJson<{ delegation_responses?: CosmosRestDelegation[] }>(
          `${COSMOS_REST}/cosmos/staking/v1beta1/delegations/${encodeURIComponent(address)}`,
        ),
        fetchJson<{ unbonding_responses?: CosmosRestUnbonding[] }>(
          `${COSMOS_REST}/cosmos/staking/v1beta1/delegators/${encodeURIComponent(address)}/unbonding_delegations`,
        ),
      ]);

      const out: Position[] = [];
      for (const d of delegations.delegation_responses ?? []) {
        const amount = BigInt(d.balance.amount || "0");
        if (amount > 0n) {
          out.push({
            validator: d.delegation.validator_address,
            amount,
            status: "bonded",
          });
        }
      }
      for (const u of unbondings.unbonding_responses ?? []) {
        for (const entry of u.entries) {
          out.push({
            validator: u.validator_address,
            amount: BigInt(entry.balance || "0"),
            status: "unbonding",
            unbondingReadyAt:
              new Date(entry.completion_time).getTime() / 1000,
          });
        }
      }
      return out;
    } catch (cause) {
      throw toAdapterError(
        `Failed to load Cosmos delegations for ${address}.`,
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
        amount: { denom: "uatom", amount: amount.toString() },
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
        amount: { denom: "uatom", amount: amount.toString() },
      },
    } satisfies UnsignedTx;
  },

  async buildClaimTx({ validator, delegator }) {
    return {
      kind: "cosmos",
      typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
      value: {
        delegatorAddress: delegator,
        validatorAddress: validator,
      },
    } satisfies UnsignedTx;
  },

  async estimateGas(tx) {
    if (tx.kind !== "cosmos") {
      throw networkError(
        `Cosmos adapter cannot estimate gas for ${tx.kind} txs.`,
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
        const positions = await cosmosAdapter.getDelegations(address);
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

export const cosmosUnbondingSeconds = UNBONDING_SECONDS;
export const cosmosDenomScale = UATOM_PER_ATOM;
